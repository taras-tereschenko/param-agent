import type { ParamDb } from "../db/client";
import {
  auditRepository,
  eventsRepository,
  identityRepository,
  sessionsRepository,
} from "../db/repositories";
import type { Session } from "../db/repositories/sessions";
import type { ActorRef, PlatformRef, RawPayloadRef } from "../contracts/common";
import type { ParamEventType } from "../contracts/events";
import { validateEventPayload } from "../contracts/events";
import { newId } from "../contracts/ids";
import type { SessionRouteType } from "./session-resolver";

export type IngestInput = {
  platform: string;
  accountLabel: string;
  eventType: ParamEventType;
  direction: "inbound" | "internal";
  visibility: "chat_visible" | "internal" | "admin";
  dedupeKey: string;
  occurredAt: string;
  receivedAt?: string;
  source: ActorRef;
  platformRef: PlatformRef;
  payload: Record<string, unknown>;
  raw?: RawPayloadRef;
  route: {
    routeType: SessionRouteType;
    sessionKey: string;
    platformChatId: string;
    messageThreadId?: string;
  };
  chatType: string;
  chatTitle?: string;
};

export type IngestResult = {
  sessionId: string;
  eventId: string;
  inserted: boolean;
  session: Session;
};

/**
 * Persist a normalized inbound channel event: resolve its durable session,
 * record the raw payload and normalized event (deduped), and update session
 * state. Idempotent on `dedupeKey` — a duplicate update never creates a second
 * event.
 */
export async function ingestInboundEvent(
  db: ParamDb,
  input: IngestInput,
): Promise<IngestResult> {
  // Validate the payload against its declared contract before persisting.
  validateEventPayload(input.eventType, input.payload);

  const account = await identityRepository.ensureChannelAccount(
    db,
    input.platform,
    input.accountLabel,
  );

  await identityRepository.upsertPlatformChat(db, {
    platform: input.platform,
    accountId: account.id,
    platformChatId: input.route.platformChatId,
    chatType: input.chatType,
    title: input.chatTitle ?? null,
    messageThreadId: input.route.messageThreadId ?? null,
  });

  const session = await sessionsRepository.resolveOrCreateSession(db, {
    sessionKey: input.route.sessionKey,
    platform: input.platform,
    routeType: input.route.routeType,
    platformChatId: input.route.platformChatId,
    messageThreadId: input.route.messageThreadId ?? null,
  });

  if (input.source.kind === "user") {
    const userAccount = await identityRepository.upsertUserAccount(db, {
      platform: input.source.platform,
      platformUserId: input.source.platformUserId,
      username: input.source.username ?? null,
      displayName: input.source.displayName ?? null,
      isBot: input.source.isBot ?? false,
    });
    await identityRepository.upsertParticipant(db, {
      sessionId: session.id,
      userId: userAccount.userId,
      platformUserId: input.source.platformUserId,
    });
  }

  // Persist the raw payload separately for audit/replay, and reference it.
  let rawRef: RawPayloadRef | undefined = input.raw;
  if (input.raw) {
    const stored = await eventsRepository.insertRawPayload(db, {
      provider: input.raw.provider,
      kind: input.raw.kind,
      hash: input.raw.hash ?? null,
      storage: "database",
      ref: null,
      json: input.raw.json ?? null,
    });
    rawRef = {
      provider: input.raw.provider,
      kind: input.raw.kind,
      storage: "database",
      ref: stored.id,
      hash: input.raw.hash,
    };
  }

  const occurredAt = new Date(input.occurredAt);
  const { event, inserted } = await eventsRepository.insertEvent(db, {
    id: newId(),
    type: input.eventType,
    sessionId: session.id,
    direction: input.direction,
    visibility: input.visibility,
    occurredAt,
    receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
    source: input.source as unknown as Record<string, unknown>,
    platform: input.platformRef as unknown as Record<string, unknown>,
    dedupeKey: input.dedupeKey,
    payload: input.payload,
    raw: rawRef as unknown as Record<string, unknown> | undefined,
  });

  if (inserted) {
    await sessionsRepository.touchSession(db, session.id, occurredAt);
  }

  return { sessionId: session.id, eventId: event.id, inserted, session };
}

/** Persist an internal (non-channel) event such as ambient.wake or task.result. */
export async function ingestInternalEvent(
  db: ParamDb,
  input: {
    sessionId: string;
    eventType: ParamEventType;
    dedupeKey: string;
    source: ActorRef;
    payload: Record<string, unknown>;
    occurredAt?: string;
    correlationId?: string;
    actorRunId?: string;
  },
): Promise<{ eventId: string; inserted: boolean }> {
  validateEventPayload(input.eventType, input.payload);
  const { event, inserted } = await eventsRepository.insertEvent(db, {
    id: newId(),
    type: input.eventType,
    sessionId: input.sessionId,
    direction: "internal",
    visibility: "internal",
    occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    receivedAt: new Date(),
    source: input.source as unknown as Record<string, unknown>,
    dedupeKey: input.dedupeKey,
    correlationId: input.correlationId ?? null,
    actorRunId: input.actorRunId ?? null,
    payload: input.payload,
  });
  return { eventId: event.id, inserted };
}

/** Record an audit row for an ingest-side security decision (e.g. denied). */
export async function auditIngestDecision(
  db: ParamDb,
  input: { summary: string; target?: Record<string, unknown>; sessionId?: string },
): Promise<void> {
  await auditRepository.writeAudit(db, {
    eventType: "channel.ingest",
    summary: input.summary,
    target: input.target,
    sessionId: input.sessionId ?? null,
  });
}
