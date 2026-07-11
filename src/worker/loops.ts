import {
  approvalsRepository,
  jobsRepository,
  runsRepository,
  schedulesRepository,
  taskRunsRepository,
} from "../db/repositories";
import type { NormalizedInbound } from "../channels";
import { ingestInboundEvent, ingestInternalEvent } from "../orchestrator/router";
import {
  enqueueJob,
  startActorRun,
  type ParamJobType,
} from "../orchestrator/run-queue";
import { fireDueSchedules } from "../scheduler/due-jobs";
import { buildTelegramSessionRoute } from "../orchestrator/session-resolver";
import { defaultBatchPolicy, isDirectlyAddressed } from "../orchestrator/batching";
import {
  isTrustedForScope,
  type ResolvedTrustedUser,
} from "../action-review/trusted-users";
import { resolveApprovalResponse } from "../action-review/approval-response";
import { parseApprovalCallback } from "../action-review/approval-buttons";
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
import type { TaskRunPlan } from "../task-agents/spawn";
import type {
  TaskExecutionOutcome,
  TaskRuntimeRegistry,
} from "../task-agents/executor";

export type WorkerDeps = ActorInvocationDeps & {
  workerId: string;
  accountLabel: string;
  trustedUsers: ResolvedTrustedUser[];
  toolset: ReturnType<typeof buildDefaultToolset>;
  /** Answer a Telegram callback query (stops the button spinner). */
  answerCallback?: (callbackId: string) => Promise<void>;
  /** Runtime executors for spawned task agents (codex/opencode). */
  taskExecutors?: TaskRuntimeRegistry;
  /**
   * Process ONE raw Telegram update through the normalize/access/ingest
   * pipeline (webhook intake). Wired to the adapter when polling is configured.
   */
  processWebhookUpdate?: (update: unknown) => Promise<void>;
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

  // Inline-button approval decision — bound to a specific approval id (safer
  // than a free-text reply). Resolves that approval and executes if approved.
  if (inbound.kind === "chat.action.callback" && source.kind === "user") {
    const handled = await maybeHandleApprovalCallback(deps, {
      payload: inbound.payload,
      sessionId: result.sessionId,
      eventId: result.eventId,
      presser: source,
      chatId: inbound.access.chatId,
      topicId: inbound.access.messageThreadId,
    });
    if (handled) {
      return;
    }
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

/**
 * Resolve an inline-button approval decision. The button's callback data
 * carries the approval id, so the tap resolves EXACTLY that approval (trust +
 * requester≠approver enforced in resolveApprovalResponse). Returns true when the
 * callback was an approval button (consumed).
 */
async function maybeHandleApprovalCallback(
  deps: WorkerDeps,
  ctx: {
    payload: unknown;
    sessionId: string;
    eventId: string;
    presser: Extract<ActorRef, { kind: "user" }>;
    chatId: string;
    topicId?: string;
  },
): Promise<boolean> {
  const payload = ctx.payload as {
    actionId?: string;
    value?: Record<string, unknown>;
  };
  const parsed = parseApprovalCallback(payload.actionId ?? "", payload.value);
  if (!parsed) {
    return false;
  }
  const approval = await approvalsRepository.getApprovalById(
    deps.db,
    parsed.approvalId,
  );
  if (!approval) {
    return true; // an approval button, but the approval is gone — still consumed
  }
  const approverIsTrusted = isTrustedForScope(
    ctx.presser.platformUserId,
    approval.requiredTrustScope as TrustScope,
    { platform: ctx.presser.platform, chatId: ctx.chatId, topicId: ctx.topicId },
    deps.trustedUsers,
  );
  const resolution = await resolveApprovalResponse(deps.db, {
    approvalId: parsed.approvalId,
    decision: parsed.decision,
    approver: ctx.presser,
    approverIsTrusted,
    decisionEventId: ctx.eventId,
    currentProposedAction: approval.proposedAction,
  });
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
      const taskRunId = job.payload.taskRunId as string | undefined;
      const parentSessionId = job.payload.parentSessionId as string | undefined;
      const taskSessionId = job.payload.taskSessionId as string | undefined;
      const plan = job.payload.plan as TaskRunPlan | undefined;
      if (!parentSessionId || !taskRunId) {
        return;
      }

      // Resolve the runtime executor for this task's runtime. If none is
      // configured/available, report an HONEST unavailable outcome (never a
      // fabricated success) so the parent can tell the user the truth.
      const executor = plan
        ? deps.taskExecutors?.resolve(plan.runtime)
        : undefined;

      let outcome: TaskExecutionOutcome;
      if (!plan) {
        outcome = {
          status: "failed",
          summary: "task plan missing from job payload",
          error: { code: "invalid_job", message: "no plan on task_agent_run" },
        };
      } else if (!executor || !(await executor.isAvailable())) {
        outcome = {
          status: "failed",
          summary: `no runtime available for task type "${plan.taskType}" (runtime: ${plan.runtime})`,
          error: {
            code: "runtime_unavailable",
            message: "no proven task runtime configured",
          },
        };
      } else {
        await taskRunsRepository.markRunning(deps.db, taskRunId);
        try {
          outcome = await executor.run(plan);
        } catch (error) {
          outcome = {
            status: "failed",
            summary: "task execution threw",
            error: {
              code: "execution_error",
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }

      await taskRunsRepository
        .markFinished(deps.db, taskRunId, outcome)
        .catch(() => undefined);

      await ingestInternalEvent(deps.db, {
        sessionId: parentSessionId,
        eventType: "task.result",
        dedupeKey: `task.result:${taskRunId}`,
        source: { kind: "system", component: "task-agent" },
        payload: {
          taskSessionId: taskSessionId ?? taskRunId,
          taskRunId,
          status: outcome.status,
          summary: outcome.summary,
          ...(outcome.followUpSuggestions
            ? { followUpSuggestions: outcome.followUpSuggestions }
            : {}),
          ...(outcome.error ? { error: outcome.error } : {}),
        },
      }).catch(() => undefined);
      // Wake the parent so the actor can report the task outcome to the user.
      await wakeActorForResult(deps, parentSessionId);
      return;
    }
    case "telegram_webhook_update": {
      // Webhook intake enqueued by the app process. Normalize + access-check +
      // ingest through the SAME adapter pipeline as polling (dedupe is handled
      // downstream by the event dedupeKey), so webhook and polling behave
      // identically. No-op if this worker has no Telegram adapter configured.
      const account = job.payload.account as string | undefined;
      // The adapter is bound to THIS worker's account (its access lists +
      // accountId). Never route another account's update through it, or access
      // decisions/session routing would be attributed to the wrong account.
      if (account !== undefined && account !== deps.accountLabel) {
        logger.warn("webhook update for a different account; skipping", {
          account,
          expected: deps.accountLabel,
        });
        return;
      }
      const update = job.payload.update;
      if (update && deps.processWebhookUpdate) {
        await deps.processWebhookUpdate(update);
      }
      return;
    }
    default:
      logger.warn("unhandled job type; completing", { type: job.type });
      return;
  }
}

/** Periodic maintenance: expire overdue approvals + fire due proactive wakes. */
export async function runMaintenanceOnce(deps: WorkerDeps): Promise<void> {
  await approvalsRepository.expireDueApprovals(deps.db);
  await fireScheduledWakes(deps);
}

/**
 * Fire proactive schedules whose time has come: enqueue an ambient_wake job
 * (dedupe-keyed) for each allowed schedule, then advance its next fire time.
 * The ambient_wake handler persists a wake event and lets the actor read the
 * room (it may still stay quiet).
 */
async function fireScheduledWakes(deps: WorkerDeps): Promise<void> {
  const now = new Date();
  const due = await schedulesRepository.listDueSchedules(deps.db, now);
  if (due.length === 0) {
    return;
  }
  const enqueue = {
    async enqueue(
      type: string,
      payload: Record<string, unknown>,
      opts: { dueAt: Date; idempotencyKey: string },
    ): Promise<void> {
      await enqueueJob(deps.db, type as ParamJobType, payload, {
        dueAt: opts.dueAt,
        idempotencyKey: opts.idempotencyKey,
      });
    },
  };
  const { fired } = await fireDueSchedules(due, enqueue, now);
  for (const id of fired) {
    const schedule = due.find((s) => s.id === id);
    if (schedule) {
      await schedulesRepository.recordScheduleFired(
        deps.db,
        id,
        schedule.spec,
        now,
      );
    }
  }
}
