import { eq, isNotNull } from "drizzle-orm";

import type { ParamDb } from "../client";
import { sessions } from "../schema";

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

/**
 * Resolve a session by its deterministic key, creating it if missing. Uses an
 * upsert on the unique session_key so concurrent workers converge on one row.
 */
export async function resolveOrCreateSession(
  db: ParamDb,
  input: NewSession,
): Promise<Session> {
  const [row] = await db
    .insert(sessions)
    .values(input)
    .onConflictDoUpdate({
      target: sessions.sessionKey,
      set: { updatedAt: new Date() },
    })
    .returning();

  if (!row) {
    throw new Error(`session upsert failed: ${input.sessionKey}`);
  }
  return row;
}

export async function getSessionById(
  db: ParamDb,
  id: string,
): Promise<Session | undefined> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  return row;
}

export async function getSessionByKey(
  db: ParamDb,
  sessionKey: string,
): Promise<Session | undefined> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionKey, sessionKey))
    .limit(1);
  return row;
}

export async function touchSession(
  db: ParamDb,
  id: string,
  lastEventAt: Date,
): Promise<void> {
  await db
    .update(sessions)
    .set({ lastEventAt, updatedAt: new Date() })
    .where(eq(sessions.id, id));
}

export async function setActiveRun(
  db: ParamDb,
  sessionId: string,
  activeRunId: string | null,
): Promise<void> {
  await db
    .update(sessions)
    .set({ activeRunId, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export async function setLastEventSeenByActor(
  db: ParamDb,
  sessionId: string,
  eventId: string,
  actorRunId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({
      lastEventIdSeenByActor: eventId,
      lastActorRunId: actorRunId,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));
}

/**
 * Sessions still marked with an active run — used by recovery to find sessions
 * whose worker died mid-run.
 */
export async function findSessionsWithActiveRun(
  db: ParamDb,
): Promise<Session[]> {
  return db
    .select()
    .from(sessions)
    .where(isNotNull(sessions.activeRunId));
}

export const sessionsRepository = {
  resolveOrCreateSession,
  getSessionById,
  getSessionByKey,
  touchSession,
  setActiveRun,
  setLastEventSeenByActor,
  findSessionsWithActiveRun,
};
