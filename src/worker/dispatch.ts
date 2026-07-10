import type { ParamConfig } from "../config/schema";
import type { ParamDb } from "../db/client";
import type { ActorOutputDraft } from "../contracts/actor-output";
import type { ActorRef } from "../contracts/common";
import { idempotencyKeys, newId } from "../contracts/ids";
import type { ToolDefinition } from "../contracts/tool";
import { classifyRisk } from "../action-review/classify";
import { decideActionReview } from "../action-review/policy";
import { isTrustedForScope, type ResolvedTrustedUser } from "../action-review/trusted-users";
import { createApprovalRequest } from "../action-review/approval-request";
import { ToolRegistry } from "../tools/registry";
import { buildToolResult } from "../tools/result";
import type { ToolHandler } from "../tools/executor";
import { ToolExecutor, type ActionReviewPort } from "../tools/executor";
import { registerLocalTools } from "../tools/local/system";
import { processStatus, selfManagementTools } from "../ops/self-management";
import { TaskAgentRegistry } from "../task-agents/registry";
import { buildTaskRunPlan } from "../task-agents/spawn";
import { spawnTaskAgent } from "../task-agents/supervisor";
import { reviewMemoryCandidate } from "../memory/review";
import { storeCandidate, storeMemory } from "../memory/store";
import { ingestInternalEvent } from "../orchestrator/router";
import { auditRepository } from "../db/repositories";
import { logger } from "../observability/logger";

export type DispatchContext = {
  runId: string;
  sessionId: string;
  routeType: string;
  platformChatId: string;
  messageThreadId?: string;
  requester?: ActorRef;
  requesterEventIds: string[];
};

export type DispatchDeps = {
  db: ParamDb;
  config: ParamConfig;
  trustedUsers: ResolvedTrustedUser[];
  toolRegistry: ToolRegistry;
  toolHandlers: Map<string, ToolHandler>;
  taskAgentRegistry: TaskAgentRegistry;
};

const log = logger.child("dispatch");

function approvalExpiry(deps: DispatchDeps): Date {
  const minutes = deps.config.actionReview.approvalTimeoutMinutes;
  return new Date(Date.now() + minutes * 60_000);
}

/**
 * Build the default tool registry + handlers: safe local read tools plus the
 * self-management tool definitions (consequential ones are approval-gated by
 * policy; only service.status has a safe handler wired here).
 */
export function buildDefaultToolset(): {
  registry: ToolRegistry;
  handlers: Map<string, ToolHandler>;
} {
  const registry = new ToolRegistry();
  const handlers = new Map<string, ToolHandler>();
  registerLocalTools(registry, handlers);
  for (const def of selfManagementTools) {
    if (!registry.has(def.name)) {
      registry.register(def);
    }
  }
  handlers.set("service.status", {
    async execute() {
      return processStatus();
    },
  });
  return { registry, handlers };
}

/**
 * Route the non-visible actor outputs (tool_call, approval_request,
 * spawn_task_agent, memory_candidate) through their safety pipelines. Every
 * consequential tool call passes Param Action Review here; nothing executes a
 * consequential action without auto-review clearance or a trusted approval.
 */
export type DispatchResult = {
  /** A tool actually executed and produced a result this turn (so the actor
   *  should be re-woken to see it and continue — the agentic loop). */
  ranTool: boolean;
};

export async function dispatchOutputs(
  deps: DispatchDeps,
  ctx: DispatchContext,
  drafts: ActorOutputDraft[],
): Promise<DispatchResult> {
  let ranTool = false;
  for (const draft of drafts) {
    switch (draft.type) {
      case "tool_call":
        if (await dispatchToolCall(deps, ctx, draft.payload)) {
          ranTool = true;
        }
        break;
      case "approval_request":
        await dispatchApprovalRequest(deps, ctx, draft.payload);
        break;
      case "spawn_task_agent":
        await dispatchSpawn(deps, ctx, draft.payload);
        break;
      case "memory_candidate":
        await dispatchMemoryCandidate(deps, ctx, draft.payload);
        break;
      default:
        break; // message/react/no_reply/render_ui/run_summary/done handled elsewhere
    }
  }
  return { ranTool };
}

function requesterTrusted(
  deps: DispatchDeps,
  ctx: DispatchContext,
  requiredScope: "global" | "chat" | "project" | "server_admin",
): boolean {
  if (ctx.requester?.kind !== "user") {
    return false;
  }
  return isTrustedForScope(
    ctx.requester.platformUserId,
    requiredScope,
    {
      platform: ctx.requester.platform,
      chatId: ctx.platformChatId,
      topicId: ctx.messageThreadId,
    },
    deps.trustedUsers,
  );
}

async function dispatchToolCall(
  deps: DispatchDeps,
  ctx: DispatchContext,
  payload: Extract<ActorOutputDraft, { type: "tool_call" }>["payload"],
): Promise<boolean> {
  const def = deps.toolRegistry.get(payload.toolName);
  if (!def) {
    await emitToolResult(deps, ctx, payload.toolCallId, payload.toolName, {
      status: "failed",
      error: { code: "unknown_tool", message: `no such tool: ${payload.toolName}` },
    });
    return false;
  }

  const classification = classifyRisk({
    actionKind: "tool_call",
    toolRiskLevel: def.riskLevel,
  });
  const isSafeAutoRun =
    def.riskLevel === "safe_read" &&
    deps.config.actionReview.safeAutoRunTools.includes(def.name);
  const decision = decideActionReview({
    classification,
    requesterVerified: ctx.requester !== undefined,
    requesterTrustedInScope: requesterTrusted(
      deps,
      ctx,
      classification.requiredTrustScope,
    ),
    isSafeAutoRun,
  });

  if (decision.decision === "auto_allowed") {
    await executeTool(deps, ctx, def, payload);
    return true;
  }

  if (decision.decision === "needs_approval") {
    const approvalId = newId();
    await createApprovalRequest(deps.db, {
      sessionId: ctx.sessionId,
      actorRunId: ctx.runId,
      request: {
        approvalId,
        actionKind: "tool_call",
        requesterEventIds: ctx.requesterEventIds,
        requestedBy: ctx.requester,
        title: `run ${def.name}`,
        summary: payload.reason,
        exactPreview: `${def.name}(${JSON.stringify(payload.input)})`,
        proposedAction: {
          toolName: def.name,
          input: payload.input,
          toolCallId: payload.toolCallId,
        },
        requiredTrustScope: classification.requiredTrustScope,
      },
      requiredTrustScope: classification.requiredTrustScope,
      expiresAt: approvalExpiry(deps),
    });
    await emitToolResult(deps, ctx, payload.toolCallId, def.name, {
      status: "blocked",
      error: { code: "awaiting_approval", message: decision.reason },
    });
    return false;
  }

  // denied / not_applicable
  await emitToolResult(deps, ctx, payload.toolCallId, def.name, {
    status: "blocked",
    error: { code: "denied", message: decision.reason },
  });
  return false;
}

async function executeTool(
  deps: DispatchDeps,
  ctx: DispatchContext,
  def: ToolDefinition,
  payload: Extract<ActorOutputDraft, { type: "tool_call" }>["payload"],
): Promise<void> {
  // Action Review already cleared this call; the executor runs it with an
  // allow-port (the policy gate lives above).
  const allowPort: ActionReviewPort = {
    async authorize() {
      return { allowed: true, reason: "cleared by Action Review" };
    },
  };
  const executor = new ToolExecutor(
    deps.toolRegistry,
    deps.toolHandlers,
    allowPort,
    {
      safeAutoRunTools: deps.config.actionReview.safeAutoRunTools,
      requesterIsTrusted: true,
    },
  );
  const result = await executor.run(payload);
  await ingestInternalEvent(deps.db, {
    sessionId: ctx.sessionId,
    eventType: "tool.result",
    dedupeKey: `tool.result:${idempotencyKeys.toolCall(ctx.runId, payload.toolCallId)}`,
    source: { kind: "tool", toolName: def.name },
    actorRunId: ctx.runId,
    payload: result as unknown as Record<string, unknown>,
  });
}

async function emitToolResult(
  deps: DispatchDeps,
  ctx: DispatchContext,
  toolCallId: string,
  toolName: string,
  outcome: {
    status: "succeeded" | "failed" | "cancelled" | "blocked";
    error?: { code: string; message: string };
  },
): Promise<void> {
  const result = buildToolResult({
    toolCallId,
    toolName,
    status: outcome.status,
    error: outcome.error,
  });
  await ingestInternalEvent(deps.db, {
    sessionId: ctx.sessionId,
    eventType: "tool.result",
    dedupeKey: `tool.result:${idempotencyKeys.toolCall(ctx.runId, toolCallId)}`,
    source: { kind: "tool", toolName },
    actorRunId: ctx.runId,
    payload: result as unknown as Record<string, unknown>,
  });
}

async function dispatchApprovalRequest(
  deps: DispatchDeps,
  ctx: DispatchContext,
  payload: Extract<ActorOutputDraft, { type: "approval_request" }>["payload"],
): Promise<void> {
  // SECURITY: derive the required trust scope AUTHORITATIVELY from the action
  // kind, not from the actor-supplied value. A prompt-injected actor must not
  // be able to downgrade a server action to only need chat-level trust. Use the
  // stricter of the classified scope and any actor-supplied scope.
  const classified = classifyRisk({ actionKind: payload.actionKind });
  const supplied =
    payload.requiredTrustScope === "chat" ||
    payload.requiredTrustScope === "project" ||
    payload.requiredTrustScope === "server_admin" ||
    payload.requiredTrustScope === "global"
      ? payload.requiredTrustScope
      : undefined;
  const scope = stricterScope(classified.requiredTrustScope, supplied);
  await createApprovalRequest(deps.db, {
    sessionId: ctx.sessionId,
    actorRunId: ctx.runId,
    request: { ...payload, requiredTrustScope: scope },
    requiredTrustScope: scope,
    expiresAt: approvalExpiry(deps),
  });
}

const SCOPE_RANK: Record<string, number> = {
  chat: 1,
  project: 1,
  global: 2,
  server_admin: 3,
};

function stricterScope(
  classified: "global" | "chat" | "project" | "server_admin",
  supplied?: "global" | "chat" | "project" | "server_admin",
): "global" | "chat" | "project" | "server_admin" {
  if (!supplied) return classified;
  return (SCOPE_RANK[supplied] ?? 0) > (SCOPE_RANK[classified] ?? 0)
    ? supplied
    : classified;
}

async function dispatchSpawn(
  deps: DispatchDeps,
  ctx: DispatchContext,
  payload: Extract<ActorOutputDraft, { type: "spawn_task_agent" }>["payload"],
): Promise<void> {
  const plan = buildTaskRunPlan(payload, { registry: deps.taskAgentRegistry });
  if (!plan.ok) {
    log.warn("task spawn rejected", { reason: plan.error });
    return;
  }
  await spawnTaskAgent(deps.db, {
    parentSessionId: ctx.sessionId,
    requestedByRunId: ctx.runId,
    plan: plan.plan,
  });
}

async function dispatchMemoryCandidate(
  deps: DispatchDeps,
  ctx: DispatchContext,
  payload: Extract<ActorOutputDraft, { type: "memory_candidate" }>["payload"],
): Promise<void> {
  const fromGroup = ctx.routeType === "group" || ctx.routeType === "topic";
  const review = reviewMemoryCandidate(payload, { fromGroup });
  if (review.decision === "reject") {
    await storeCandidate(deps.db, { ...payload, operation: payload.operation }, ctx.runId);
    await auditRepository.writeAudit(deps.db, {
      eventType: "memory.candidate_rejected",
      sessionId: ctx.sessionId,
      actorRunId: ctx.runId,
      summary: `memory candidate rejected: ${review.reason}`,
    });
    return;
  }
  const candidate = review.candidate;
  if (candidate.operation === "create" || candidate.operation === "update") {
    await storeMemory(deps.db, {
      scope: candidate.scope,
      subjectRef: candidate.subjectRef ?? {},
      text: candidate.text,
      provenanceNote: candidate.provenanceNote,
      confidence: candidate.confidence,
      sensitivity: candidate.sensitivity,
      sourceEventIds: candidate.sourceEventIds,
      createdByRunId: ctx.runId,
    });
  }
}
