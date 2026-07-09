import type { ParamDb } from "../db/client";
import { sessionsRepository } from "../db/repositories";
import { taskRuns } from "../db/schema";
import { enqueueJob } from "../orchestrator/run-queue";
import { deriveSessionKey } from "../orchestrator/session-resolver";
import { newId } from "../contracts/ids";
import type { TaskRunPlan } from "./spawn";

export type SpawnTaskAgentInput = {
  parentSessionId: string;
  requestedByRunId?: string | null;
  requestedByOutputId?: string | null;
  plan: TaskRunPlan;
};

/**
 * Spawn a task agent: create an isolated child task session, a durable task_run
 * row, and enqueue its job. The task reports back to the parent Session Actor
 * via a task.result event.
 */
export async function spawnTaskAgent(
  db: ParamDb,
  input: SpawnTaskAgentInput,
): Promise<{ taskRunId: string; taskSessionId: string; jobId: string }> {
  const taskRef = newId();
  const sessionKey = deriveSessionKey({
    platform: "param",
    accountId: "task",
    routeType: "task",
    taskSessionRef: taskRef,
  });

  const taskSession = await sessionsRepository.resolveOrCreateSession(db, {
    sessionKey,
    platform: "param",
    routeType: "task",
    platformChatId: taskRef,
    parentSessionId: input.parentSessionId,
    metadata: { taskType: input.plan.taskType },
  });

  const [run] = await db
    .insert(taskRuns)
    .values({
      parentSessionId: input.parentSessionId,
      taskSessionId: taskSession.id,
      requestedByRunId: input.requestedByRunId ?? null,
      requestedByOutputId: input.requestedByOutputId ?? null,
      taskType: input.plan.taskType,
      goal: input.plan.goal,
      status: "queued",
      runtime: input.plan.runtime,
      budget: input.plan.budget as unknown as Record<string, unknown>,
    })
    .returning({ id: taskRuns.id });
  if (!run) {
    throw new Error("task run insert failed");
  }

  const job = await enqueueJob(
    db,
    "task_agent_run",
    {
      taskRunId: run.id,
      taskSessionId: taskSession.id,
      parentSessionId: input.parentSessionId,
      plan: input.plan as unknown as Record<string, unknown>,
    },
    { idempotencyKey: `task_agent_run:${run.id}` },
  );

  return {
    taskRunId: run.id,
    taskSessionId: taskSession.id,
    jobId: job.id,
  };
}
