import { asc, desc, eq } from "drizzle-orm";

import type { ParamDb } from "../client";
import {
  events,
  rawPayloads,
  type Event,
  type NewEvent,
  type NewRawPayload,
  type RawPayload,
} from "../schema";

export async function insertEvent(
  db: ParamDb,
  event: NewEvent,
): Promise<{ event: Event; inserted: boolean }> {
  const [inserted] = await db
    .insert(events)
    .values(event)
    .onConflictDoNothing({ target: events.dedupeKey })
    .returning();

  if (inserted) {
    return { event: inserted, inserted: true };
  }

  const [existing] = await db
    .select()
    .from(events)
    .where(eq(events.dedupeKey, event.dedupeKey))
    .limit(1);

  if (!existing) {
    throw new Error(`event dedupe lookup failed: ${event.dedupeKey}`);
  }

  return { event: existing, inserted: false };
}

export async function listSessionEvents(
  db: ParamDb,
  sessionId: string,
  limit = 100,
): Promise<Event[]> {
  const recentEvents = await db
    .select()
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(desc(events.occurredAt), desc(events.persistedAt))
    .limit(limit);

  return recentEvents.reverse();
}

export async function insertRawPayload(
  db: ParamDb,
  rawPayload: NewRawPayload,
): Promise<RawPayload> {
  const [inserted] = await db
    .insert(rawPayloads)
    .values(rawPayload)
    .returning();

  if (!inserted) {
    throw new Error("raw payload insert did not return a row");
  }

  return inserted;
}

export const eventsRepository = {
  insertEvent,
  insertRawPayload,
  listSessionEvents,
};
