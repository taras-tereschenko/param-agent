import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { ParamDb } from "../client";
import {
  events,
  rawPayloads,
  type Event,
  type NewEvent,
  type NewRawPayload,
  type RawPayload,
} from "../schema";

const jsonObjectSchema = z.record(z.string(), z.unknown());

const eventJsonSchema = z.object({
  source: jsonObjectSchema,
  platform: jsonObjectSchema.optional().nullable(),
  payload: jsonObjectSchema.optional(),
  raw: jsonObjectSchema.optional().nullable(),
});

const rawPayloadJsonSchema = z.object({
  json: jsonObjectSchema.optional().nullable(),
});

export async function insertEvent(
  db: ParamDb,
  event: NewEvent,
): Promise<{ event: Event; inserted: boolean }> {
  validateEventJsonColumns(event);

  const [inserted] = await db
    .insert(events)
    .values(event)
    .onConflictDoNothing({ target: events.dedupeKey })
    .returning();

  if (inserted) {
    return { event: validateStoredEvent(inserted), inserted: true };
  }

  const [existing] = await db
    .select()
    .from(events)
    .where(eq(events.dedupeKey, event.dedupeKey))
    .limit(1);

  if (!existing) {
    throw new Error(`event dedupe lookup failed: ${event.dedupeKey}`);
  }

  return { event: validateStoredEvent(existing), inserted: false };
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
    .orderBy(desc(events.occurredAt), desc(events.persistedAt), desc(events.id))
    .limit(limit);

  return recentEvents.map(validateStoredEvent).reverse();
}

export async function insertRawPayload(
  db: ParamDb,
  rawPayload: NewRawPayload,
): Promise<RawPayload> {
  validateRawPayloadJsonColumns(rawPayload);

  const [inserted] = await db
    .insert(rawPayloads)
    .values(rawPayload)
    .returning();

  if (!inserted) {
    throw new Error("raw payload insert did not return a row");
  }

  return validateStoredRawPayload(inserted);
}

export function validateEventJsonColumns(event: Pick<
  NewEvent | Event,
  "source" | "platform" | "payload" | "raw"
>): void {
  eventJsonSchema.parse({
    source: event.source,
    platform: event.platform,
    payload: event.payload,
    raw: event.raw,
  });
}

export function validateRawPayloadJsonColumns(
  rawPayload: Pick<NewRawPayload | RawPayload, "json">,
): void {
  rawPayloadJsonSchema.parse({ json: rawPayload.json });
}

function validateStoredEvent(event: Event): Event {
  validateEventJsonColumns(event);
  return event;
}

function validateStoredRawPayload(rawPayload: RawPayload): RawPayload {
  validateRawPayloadJsonColumns(rawPayload);
  return rawPayload;
}

export const eventsRepository = {
  insertEvent,
  insertRawPayload,
  listSessionEvents,
};
