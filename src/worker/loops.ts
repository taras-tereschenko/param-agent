import {
  approvalsRepository,
  jobsRepository,
  runsRepository,
} from "../db/repositories";
import type { NormalizedInbound } from "../channels";
import { ingestInboundEvent, ingestInternalEvent } from "../orchestrator/router";
import { startActorRun } from "../orchestrator/run-queue";
import { buildTelegramSessionRoute } from "../orchestrator/session-resolver";
import { defaultBatchPolicy, isDirectlyAddressed } from "../orchestrator/batching";
import {
  isTrustedForScope,
  type ResolvedTrustedUser,
} from "../action-review/trusted-users";
import { resolveApprovalResponse } from "../action-review/approval-response";
import type { ActorRef, PlatformRef, RawPayloadRef } from "../contracts/common";
import { idempotencyKeys } from "../contracts/ids";
import type { TrustScope } from "../contracts/action-review";
import { logger } from "../observability/logger";
import { ToolExecutor, type ActionReviewPort } from "../tools/executor";
import { buildToolResult } from "../tools/result";
import {
  runActorInvocation,
  type ActorInvocationDeps,
} from "./actor-invocation";
import { buildDefaultToolset } from "./dispatch";

export type WorkerDeps = ActorInvocationDeps & {
  workerId: string;
  accountLabel: string;
  trustedUsers: ResolvedTrustedUser[];
  toolset: ReturnType<typeof buildDefaultToolset>;
  /** Answer a Telegram callback query (stops the button spinner). */
  answerCallback?: (callbackId: string) => Promise<void>;
};

// Explicit approval verbs only. Casual "ok"/"yes"/"no" must NOT resolve a
// pending consequential action (that caused accidental approvals). The durable
// fix is inline-button approval bound to a specific approval id.
const APPROVE = /^\/?(approve|approved|confirm)\b/i;
const DENY = /^\/?(deny|denied|decline|reject)\b/i;

/**
 * Handle one normalized inbound event: persist it (deduped, with raw payload),
 * handle trusted approval replies, then batch-schedule an actor run. Batching
 * is implicit: a run is queued with a debounce delay, and messages arriving
 * while it is queued/active become context for it instead of each starting a
 * run. One active run per session is enforced by the DB.
 */
export async function handleInbound(
  deps: WorkerDeps,
  inbound: NormalizedInbound,
  rawRef?: RawPayloadRef,
): Promise<void> {
  const source = inbound.source as ActorRef;
  const platform = inbound.platform as PlatformRef;
  const route = buildTelegramSessionRoute({
    accountId: deps.accountLabel,
    chatType: inbound.access.chatType,
    platformChatId: inbound.access.chatId,
    platformUserId: source.kind === "user" ? source.platformUserId : undefined,
    messageThreadId: inbound.access.messageThreadId,
  });

  const result = await ingestInboundEvent(deps.db, {
    platform: "telegram",
    accountLabel: deps.accountLabel,
    eventType: inbound.kind,
    direction: "inbound",
    visibility: "chat_visible",
    dedupeKey: inbound.dedupeKey,
    occurredAt: inbound.occurredAt,
    source,
    platformRef: platform,
    payload: inbound.payload,
    raw: rawRef,
    route,
    chatType: inbound.access.chatType,
    chatTitle: inbound.chatTitle,
  });

  // Always answer callback queries so the button spinner clears, even on dupes.
  if (inbound.kind === "chat.action.callback" && deps.answerCallback) {
    const callbackId = (inbound.payload as { callbackId?: string }).callbackId;
    if (callbackId) {
      await deps.answerCallback(callbackId).catch(() => undefined);
    }
  }

  if (!result.inserted) {
    return; // duplicate update; nothing to do
  }

  // Do not wake the actor for archived/blocked sessions.
  if (result.session.status !== "active") {
    return;
  }

  // Trusted approve/deny replies resolve a pending approval instead of waking
  // the actor normally.
  if (inbound.kind === "chat.message.received" && source.kind === "user") {
    const handled = await maybeHandleApprovalReply(deps, {
      sessionId: result.sessionId,
      eventId: result.eventId,
      text: (inbound.payload as { text?: string }).text,
      requester: source,
      platform: source.platform,
      chatId: inbound.access.chatId,
      topicId: inbound.access.messageThreadId,
    });
    if (handled) {
      return;
    }
  }

  const wakesActor =
    inbound.kind === "chat.message.received" ||
    inbound.kind === "chat.action.callback";
  if (!wakesActor) {
    return;
  }

  const active = await runsRepository.findActiveRunForSession(
    deps.db,
    result.sessionId,
  );
  if (active) {
    // Same-session activity during an active/queued run becomes steering
    // context; the run observes it via the context builder.
    return;
  }

  // Batch: directly-addressed messages flush quickly; ambient chatter waits.
  const mechanical =
    inbound.kind === "chat.message.received"
      ? (inbound.payload as { mechanical?: Record<string, boolean> }).mechanical
      : undefined;
  const addressed =
    inbound.kind === "chat.action.callback" ||
    isDirectlyAddressed({
      isDirectMessage: mechanical?.isDirectMessage,
      mentionsParam: mechanical?.mentionsParam,
      repliesToParam: mechanical?.repliesToParam,
      hasCommandLikeText: mechanical?.hasCommandLikeText,
    });
  const delayMs = addressed
    ? defaultBatchPolicy.directDebounceMs
    : defaultBatchPolicy.ambientDebounceMs;

  await startActorRun(deps.db, {
    sessionId: result.sessionId,
    runType: "normal_chat",
    runtime: deps.config.actor.defaultRuntime,
    triggerEventId: result.eventId,
    dueAt: new Date(Date.now() + delayMs),
  });
}

type ApprovalReplyContext = {
  sessionId: string;
  eventId: string;
  text: string | undefined;
  requester: Extract<ActorRef, { kind: "user" }>;
  platform: string;
  chatId: string;
  topicId?: string;
};

/**
 * If a trusted user replies approve/deny, resolve the session's pending
 * approval and (on approval of a tool_call) execute it. Returns true when the
 * message was consumed as an approval reply.
 */
async function maybeHandleApprovalReply(
  deps: WorkerDeps,
  ctx: ApprovalReplyContext,
): Promise<boolean> {
  const text = (ctx.text ?? "").trim();
  const isApprove = APPROVE.test(text);
  const isDeny = DENY.test(text);
  if (!isApprove && !isDeny) {
    return false;
  }
  const pending = await approvalsRepository.findPendingForSession(
    deps.db,
    ctx.sessionId,
  );
  if (pending.length === 0) {
    return false;
  }
  const approval = pending[0]!;
  const approverIsTrusted = isTrustedForScope(
    ctx.requester.platformUserId,
    approval.requiredTrustScope as TrustScope,
    { platform: ctx.platform, chatId: ctx.chatId, topicId: ctx.topicId },
    deps.trustedUsers,
  );

  const resolution = await resolveApprovalResponse(deps.db, {
    approvalId: approval.id,
    decision: isApprove ? "approved" : "rejected",
    approver: ctx.requester,
    approverIsTrusted,
    decisionEventId: ctx.eventId,
    currentProposedAction: approval.proposedAction,
  });

  // A non-trusted "approve", or a requester trying to approve their own request,
  // must not silently pass; leave the message to wake the actor (it can
  // explain) and do not consume it.
  if (
    resolution.status === "not_trusted" ||
    resolution.status === "self_approval"
  ) {
    return false;
  }

  if (resolution.status === "approved" && resolution.action) {
    await executeApprovedAction(deps, ctx.sessionId, resolution.action);
  }
  return true;
}

async function executeApprovedAction(
  deps: WorkerDeps,
  sessionId: string,
  action: Record<string, unknown>,
): Promise<void> {
  const toolName = action.toolName as string | undefined;
  const toolCallId = (action.toolCallId as string | undefined) ?? "approved";
  if (!toolName) {
    return; // non-tool approvals are recorded; execution handled elsewhere
  }
  const allowPort: ActionReviewPort = {
    async authorize() {
      return { allowed: true, reason: "trusted approval granted" };
    },
  };
  const executor = new ToolExecutor(
    deps.toolset.registry,
    deps.toolset.handlers,
    allowPort,
    { safeAutoRunTools: deps.config.actionReview.safeAutoRunTools, requesterIsTrusted: true },
  );
  let result;
  try {
    result = await executor.run({
      toolCallId,
      toolName,
      input: (action.input as Record<string, unknown>) ?? {},
      reason: "approved by trusted user",
    });
  } catch (error) {
    result = buildToolResult({
      toolCallId,
      toolName,
      status: "failed",
      error: {
        code: "execution_error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
  await ingestInternalEvent(deps.db, {
    sessionId,
    eventType: "tool.result",
    dedupeKey: `tool.result:approved:${idempotencyKeys.toolCall(toolCallId, toolName)}`,
    source: { kind: "tool", toolName },
    payload: result as unknown as Record<string, unknown>,
  });
  // Close the loop: re-wake the actor so it reports the approved tool's result.
  await wakeActorForResult(deps, sessionId);
}

/**
 * Re-wake the Session Actor after an internal result (approved tool, task
 * result) so it can observe the outcome and continue. Skips if a run is already
 * active for the session (that run will pick up the new event).
 */
async function wakeActorForResult(
  deps: WorkerDeps,
  sessionId: string,
): Promise<void> {
  const active = await runsRepository.findActiveRunForSession(
    deps.db,
    sessionId,
  );
  if (active) {
    return;
  }
  await startActorRun(deps.db, {
    sessionId,
    runType: "normal_chat",
    runtime: deps.config.actor.defaultRuntime,
    dueAt: new Date(Date.now() + 500),
  });
}

/** Claim and run a single due job. Returns whether a job was processed. */
export async function runJobsOnce(deps: WorkerDeps): Promise<boolean> {
  const job = await jobsRepository.claimNextJob(deps.db, {
    workerId: deps.workerId,
    leaseSeconds: 60,
  });
  if (!job) {
    return false;
  }

  try {
    await dispatchJob(deps, job);
    await jobsRepository.completeJob(deps.db, job.id, {
      workerId: deps.workerId,
    });
  } catch (error) {
    logger.error("job failed", {
      jobId: job.id,
      type: job.type,
      error: error instanceof Error ? error.message : String(error),
    });
    await jobsRepository.failJob(deps.db, job.id, {
      workerId: deps.workerId,
      error: { message: error instanceof Error ? error.message : String(error) },
      retryAt: new Date(Date.now() + 30_000),
    });
  }
  return true;
}

async function dispatchJob(
  deps: WorkerDeps,
  job: { type: string; payload: Record<string, unknown> },
): Promise<void> {
  switch (job.type) {
    case "actor_invocation": {
      const actorRunId = job.payload.actorRunId as string;
      await runActorInvocation(deps, actorRunId);
      return;
    }
    case "ambient_wake": {
      const sessionId = job.payload.sessionId as string | undefined;
      if (!sessionId) {
        return;
      }
      // Persist the wake as an event (the "wake -> event -> actor reads room"
      // chain) then let the actor decide whether to speak.
      const wake = job.payload.wake as Record<string, unknown> | undefined;
      if (wake) {
        await ingestInternalEvent(deps.db, {
          sessionId,
          eventType: "ambient.wake",
          dedupeKey: `ambient.wake:${job.payload.dedupeKey ?? idempotencyKeys.toolCall(sessionId, "wake")}`,
          source: { kind: "scheduler" },
          payload: wake,
        }).catch(() => undefined);
      }
      const active = await runsRepository.findActiveRunForSession(
        deps.db,
        sessionId,
      );
      if (!active) {
        await startActorRun(deps.db, {
          sessionId,
          runType: "ambient_wake",
          runtime: deps.config.actor.defaultRuntime,
        });
      }
      return;
    }
    case "task_agent_run": {
      // Task runtimes are not executable in this environment (no proven
      // runtime). Report an honest failure result so the run does not hang.
      const taskRunId = job.payload.taskRunId as string | undefined;
      const parentSessionId = job.payload.parentSessionId as string | undefined;
      if (parentSessionId && taskRunId) {
        await ingestInternalEvent(deps.db, {
          sessionId: parentSessionId,
          eventType: "task.result",
          dedupeKey: `task.result:${taskRunId}`,
          source: { kind: "system", component: "task-agent" },
          payload: {
            taskSessionId: (job.payload.taskSessionId as string) ?? taskRunId,
            taskRunId,
            status: "failed",
            summary: "task runtime is not available in this deployment",
            error: {
              code: "runtime_unavailable",
              message: "no proven task runtime configured",
            },
          },
        }).catch(() => undefined);
        // Wake the parent so the actor can report the task outcome to the user.
        await wakeActorForResult(deps, parentSessionId);
      }
      return;
    }
    default:
      logger.warn("unhandled job type; completing", { type: job.type });
      return;
  }
}

/** Periodic maintenance: expire overdue approvals. */
export async function runMaintenanceOnce(deps: WorkerDeps): Promise<void> {
  await approvalsRepository.expireDueApprovals(deps.db);
}
