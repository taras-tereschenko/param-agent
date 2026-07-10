import type { ParamDb } from "../db/client";
import { jobsRepository } from "../db/repositories";
import { runsRepository, sessionsRepository } from "../db/repositories";
import type { NewActorRun } from "../db/repositories/runs";
import type { PromptRunType } from "../contracts/prompt";

/** Lease applied to a new actor run so a crashed/orphaned run is recoverable. */
export const ACTOR_RUN_LEASE_SECONDS = 300;

/** Job types (docs/DATABASE.md). */
export type ParamJobType =
  | "actor_invocation"
  | "batch_review"
  | "memory_review"
  | "compaction"
  | "task_agent_run"
  | "scheduled_check"
  | "ambient_wake"
  | "tool_execution"
  | "delivery_retry"
  | "approval_timeout"
  | "recovery_scan";

export type EnqueueOptions = {
  dueAt?: Date;
  priority?: number;
  maxAttempts?: number;
  idempotencyKey?: string;
};

export async function enqueueJob(
  db: ParamDb,
  type: ParamJobType,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
) {
  return jobsRepository.enqueueJob(db, {
    type,
    payload,
    priority: options.priority ?? 0,
    dueAt: options.dueAt ?? new Date(),
    maxAttempts: options.maxAttempts ?? 3,
    idempotencyKey: options.idempotencyKey ?? null,
  });
}

/**
 * Create the single active actor run for a session and enqueue its invocation
 * job. Returns undefined when a run is already active for the session (the
 * partial unique index rejects the second run) so callers can skip.
 */
export async function startActorRun(
  db: ParamDb,
  input: {
    sessionId: string;
    runType: PromptRunType;
    runtime: string;
    triggerEventId?: string | null;
    metadata?: Record<string, unknown>;
    /**
     * Delay before the run's job becomes due. Non-zero delays implement
     * batching: messages arriving while this run is queued/active become
     * context for it instead of each starting their own run.
     */
    dueAt?: Date;
  },
): Promise<{ runId: string; jobId: string } | undefined> {
  const now = new Date();
  const runValues: NewActorRun = {
    sessionId: input.sessionId,
    runType: input.runType,
    runtime: input.runtime,
    status: "queued",
    triggerEventId: input.triggerEventId ?? null,
    metadata: input.metadata ?? {},
    // Lease from birth so recovery can reclaim a run whose worker never
    // processed it or crashed (findExpiredActiveRuns filters on lockExpiresAt).
    lockExpiresAt: new Date(now.getTime() + ACTOR_RUN_LEASE_SECONDS * 1000),
  };
  const run = await runsRepository.createActorRun(db, runValues);
  if (!run) {
    return undefined;
  }
  // Mark the session as having an active run so recovery can find wedged
  // sessions and so ingest treats concurrent messages as steering.
  await sessionsRepository.setActiveRun(db, input.sessionId, run.id);
  const job = await enqueueJob(
    db,
    "actor_invocation",
    { actorRunId: run.id, sessionId: input.sessionId, runType: input.runType },
    { idempotencyKey: `actor_invocation:${run.id}`, dueAt: input.dueAt },
  );
  return { runId: run.id, jobId: job.id };
}
