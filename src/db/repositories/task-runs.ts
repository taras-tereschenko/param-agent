import { eq } from "drizzle-orm";

import type { ParamDb } from "../client";
import { taskRuns } from "../schema";

/**
 * Task-run lifecycle writes. The row is created queued by the supervisor; the
 * worker moves it running -> completed/failed as it executes and records the
 * honest outcome (error preserved).
 */
export const taskRunsRepository = {
  /** Current status of a task run (for the job-retry idempotency guard). */
  async getStatus(db: ParamDb, id: string): Promise<string | undefined> {
    const rows = await db
      .select({ status: taskRuns.status })
      .from(taskRuns)
      .where(eq(taskRuns.id, id))
      .limit(1);
    return rows[0]?.status;
  },

  async markRunning(db: ParamDb, id: string): Promise<void> {
    await db
      .update(taskRuns)
      .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(taskRuns.id, id));
  },

  async markFinished(
    db: ParamDb,
    id: string,
    outcome: {
      status: "completed" | "failed";
      error?: { code: string; message: string };
    },
    resultEventId?: string,
  ): Promise<void> {
    await db
      .update(taskRuns)
      .set({
        status: outcome.status,
        completedAt: new Date(),
        updatedAt: new Date(),
        error: outcome.error ?? null,
        ...(resultEventId ? { resultEventId } : {}),
      })
      .where(eq(taskRuns.id, id));
  },
};
