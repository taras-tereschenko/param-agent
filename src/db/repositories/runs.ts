import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";

import type { ParamDb } from "../client";
import { actorOutputs, actorRuns, deliveryAttempts } from "../schema";

export type ActorRun = typeof actorRuns.$inferSelect;
export type NewActorRun = typeof actorRuns.$inferInsert;
export type ActorOutputRow = typeof actorOutputs.$inferSelect;
export type NewActorOutputRow = typeof actorOutputs.$inferInsert;
export type DeliveryAttempt = typeof deliveryAttempts.$inferSelect;
export type NewDeliveryAttempt = typeof deliveryAttempts.$inferInsert;

/** Active run statuses that the partial unique index guards against. */
export const activeRunStatuses = [
  "queued",
  "building_context",
  "running",
  "waiting_tool",
  "waiting_approval",
  "compacting",
] as const;

/**
 * Create the single active run for a session. Relies on the partial unique
 * index `actor_runs_one_active_per_session_idx` to reject a second active run.
 * Returns `undefined` when a run is already active (conflict).
 */
export async function createActorRun(
  db: ParamDb,
  input: NewActorRun,
): Promise<ActorRun | undefined> {
  const rows = await db
    .insert(actorRuns)
    .values(input)
    .onConflictDoNothing()
    .returning();
  return rows[0];
}

export async function findActiveRunForSession(
  db: ParamDb,
  sessionId: string,
): Promise<ActorRun | undefined> {
  const [row] = await db
    .select()
    .from(actorRuns)
    .where(
      and(
        eq(actorRuns.sessionId, sessionId),
        inArray(actorRuns.status, [...activeRunStatuses]),
      ),
    )
    .limit(1);
  return row;
}

export async function heartbeatRun(
  db: ParamDb,
  runId: string,
  workerId: string,
  leaseSeconds: number,
  now = new Date(),
): Promise<void> {
  await db
    .update(actorRuns)
    .set({
      lastHeartbeatAt: now,
      lockOwner: workerId,
      lockExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
      updatedAt: now,
    })
    .where(eq(actorRuns.id, runId));
}

export async function markRunStatus(
  db: ParamDb,
  runId: string,
  status: string,
  now = new Date(),
): Promise<void> {
  await db
    .update(actorRuns)
    .set({
      status,
      startedAt: status === "running" ? now : undefined,
      completedAt: isTerminalRunStatus(status) ? now : undefined,
      lockOwner: isTerminalRunStatus(status) ? null : undefined,
      lockExpiresAt: isTerminalRunStatus(status) ? null : undefined,
      updatedAt: now,
    })
    .where(eq(actorRuns.id, runId));
}

export async function failRun(
  db: ParamDb,
  runId: string,
  error: Record<string, unknown>,
  now = new Date(),
): Promise<void> {
  await db
    .update(actorRuns)
    .set({
      status: "failed",
      error,
      completedAt: now,
      lockOwner: null,
      lockExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(actorRuns.id, runId));
}

/** Active runs whose lock expired — recovery candidates after a crash/reboot. */
export async function findExpiredActiveRuns(
  db: ParamDb,
  now = new Date(),
  limit = 100,
): Promise<ActorRun[]> {
  return db
    .select()
    .from(actorRuns)
    .where(
      and(
        inArray(actorRuns.status, [...activeRunStatuses]),
        lte(actorRuns.lockExpiresAt, now),
      ),
    )
    .orderBy(asc(actorRuns.lockExpiresAt))
    .limit(limit);
}

/* ----------------------------- actor outputs ----------------------------- */

export async function insertActorOutput(
  db: ParamDb,
  input: NewActorOutputRow,
): Promise<{ output: ActorOutputRow; inserted: boolean }> {
  const [inserted] = await db
    .insert(actorOutputs)
    .values(input)
    .onConflictDoNothing({ target: actorOutputs.idempotencyKey })
    .returning();

  if (inserted) {
    return { output: inserted, inserted: true };
  }

  const [existing] = await db
    .select()
    .from(actorOutputs)
    .where(eq(actorOutputs.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (!existing) {
    throw new Error(`actor output idempotency lookup failed`);
  }
  return { output: existing, inserted: false };
}

export async function listOutputsForRun(
  db: ParamDb,
  actorRunId: string,
): Promise<ActorOutputRow[]> {
  return db
    .select()
    .from(actorOutputs)
    .where(eq(actorOutputs.actorRunId, actorRunId))
    .orderBy(asc(actorOutputs.sequence));
}

export async function setOutputValidation(
  db: ParamDb,
  outputId: string,
  status: "valid" | "invalid",
  error?: Record<string, unknown>,
): Promise<void> {
  await db
    .update(actorOutputs)
    .set({ validationStatus: status, validationError: error ?? null })
    .where(eq(actorOutputs.id, outputId));
}

export async function setOutputDelivery(
  db: ParamDb,
  outputId: string,
  status: "pending" | "not_applicable" | "running" | "succeeded" | "failed",
): Promise<void> {
  await db
    .update(actorOutputs)
    .set({ deliveryStatus: status })
    .where(eq(actorOutputs.id, outputId));
}

/* --------------------------- delivery attempts --------------------------- */

export async function createDeliveryAttempt(
  db: ParamDb,
  input: NewDeliveryAttempt,
): Promise<DeliveryAttempt> {
  const [row] = await db
    .insert(deliveryAttempts)
    .values(input)
    .returning();
  if (!row) {
    throw new Error("delivery attempt insert failed");
  }
  return row;
}

export async function completeDeliveryAttempt(
  db: ParamDb,
  attemptId: string,
  platformMessageId: string | null,
  now = new Date(),
): Promise<void> {
  await db
    .update(deliveryAttempts)
    .set({
      status: "succeeded",
      platformMessageId,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(deliveryAttempts.id, attemptId));
}

export async function failDeliveryAttempt(
  db: ParamDb,
  attemptId: string,
  error: Record<string, unknown>,
  now = new Date(),
): Promise<void> {
  await db
    .update(deliveryAttempts)
    .set({ status: "failed", error, completedAt: now, updatedAt: now })
    .where(eq(deliveryAttempts.id, attemptId));
}

export async function findStuckDeliveryAttempts(
  db: ParamDb,
  limit = 100,
): Promise<DeliveryAttempt[]> {
  return db
    .select()
    .from(deliveryAttempts)
    .where(eq(deliveryAttempts.status, "running"))
    .orderBy(desc(deliveryAttempts.createdAt))
    .limit(limit);
}

export function isTerminalRunStatus(status: string): boolean {
  return ["completed", "failed", "cancelled", "interrupted"].includes(status);
}

export const runsRepository = {
  createActorRun,
  findActiveRunForSession,
  heartbeatRun,
  markRunStatus,
  failRun,
  findExpiredActiveRuns,
  insertActorOutput,
  listOutputsForRun,
  setOutputValidation,
  setOutputDelivery,
  createDeliveryAttempt,
  completeDeliveryAttempt,
  failDeliveryAttempt,
  findStuckDeliveryAttempts,
};
