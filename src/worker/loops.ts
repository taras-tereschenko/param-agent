import { jobsRepository } from "../db/repositories";
import type { NormalizedInbound } from "../channels";
import { ingestInboundEvent } from "../orchestrator/router";
import { runsRepository } from "../db/repositories";
import { startActorRun } from "../orchestrator/run-queue";
import { buildTelegramSessionRoute } from "../orchestrator/session-resolver";
import type { ActorRef, PlatformRef } from "../contracts/common";
import { logger } from "../observability/logger";
import {
  runActorInvocation,
  type ActorInvocationDeps,
} from "./actor-invocation";

export type WorkerDeps = ActorInvocationDeps & {
  workerId: string;
  accountLabel: string;
};

/**
 * Handle one normalized inbound Telegram event: persist it (deduped), then
 * start an actor run for the session when none is active. The jobs loop runs
 * the actor asynchronously — one active run per session is enforced by the DB.
 */
export async function handleInbound(
  deps: WorkerDeps,
  inbound: NormalizedInbound,
): Promise<void> {
  const source = inbound.source as ActorRef;
  const platform = inbound.platform as PlatformRef;
  const route = buildTelegramSessionRoute({
    accountId: deps.accountLabel,
    chatType: inbound.access.chatType,
    platformChatId: inbound.access.chatId,
    platformUserId:
      source.kind === "user" ? source.platformUserId : undefined,
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
    route,
    chatType: inbound.access.chatType,
  });

  if (!result.inserted) {
    return; // duplicate update; nothing to do
  }

  // Only chat messages/callbacks should wake the actor.
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
    // Same-session activity during an active run becomes steering context; the
    // active run will observe it via the context builder on its next turn.
    return;
  }

  await startActorRun(deps.db, {
    sessionId: result.sessionId,
    runType: "normal_chat",
    runtime: deps.config.actor.defaultRuntime,
    triggerEventId: result.eventId,
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
      // An ambient wake becomes an actor run that decides whether to speak.
      const sessionId = job.payload.sessionId as string;
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
    default:
      logger.warn("unhandled job type; completing", { type: job.type });
      return;
  }
}

/** One scheduler tick placeholder — real due-schedule loading is DB-backed. */
export async function runSchedulerOnce(_deps: WorkerDeps): Promise<void> {
  // The pure scheduler (fireDueSchedules) is wired here once schedules exist in
  // the DB. No-op when there are no active schedules.
}
