import type { ParamDb } from "../db/client";
import { jobsRepository } from "../db/repositories";
import { runsRepository } from "../db/repositories";
import type { NewActorRun } from "../db/repositories/runs";
import type { PromptRunType } from "../contracts/prompt";

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
  },
): Promise<{ runId: string; jobId: string } | undefined> {
  const runValues: NewActorRun = {
    sessionId: input.sessionId,
    runType: input.runType,
    runtime: input.runtime,
    status: "queued",
    triggerEventId: input.triggerEventId ?? null,
    metadata: input.metadata ?? {},
  };
  const run = await runsRepository.createActorRun(db, runValues);
  if (!run) {
    return undefined;
  }
  const job = await enqueueJob(
    db,
    "actor_invocation",
    { actorRunId: run.id, sessionId: input.sessionId, runType: input.runType },
    { idempotencyKey: `actor_invocation:${run.id}` },
  );
  return { runId: run.id, jobId: job.id };
}
