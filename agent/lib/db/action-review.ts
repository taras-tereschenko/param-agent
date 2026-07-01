import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { TelegramChannelState } from "eve/channels/telegram";
import { telegramUserIdFromAuth } from "../telegram-auth.js";
import { getDb, type ParamDb } from "./client.js";
import { paramActionReviews, type NewParamActionReview } from "./schema.js";

type ActionReviewStatus = "requested" | "completed" | "failed" | "rejected";
type JsonSafe =
  | null
  | boolean
  | number
  | string
  | readonly JsonSafe[]
  | { readonly [key: string]: JsonSafe };

interface PrincipalForAudit {
  readonly attributes: Readonly<Record<string, string | readonly string[]>>;
  readonly authenticator?: string;
  readonly principalId: string;
  readonly principalType: string;
}

interface SessionContextForAudit {
  readonly session: {
    readonly auth?: {
      readonly current?: PrincipalForAudit | null;
      readonly initiator?: PrincipalForAudit | null;
    };
    readonly id: string;
    readonly turn?: {
      readonly id?: string;
      readonly sequence?: number;
    };
  };
}

interface ActionForAudit {
  readonly callId: string;
  readonly input?: unknown;
  readonly kind: string;
  readonly toolName?: string;
}

interface InputOptionForAudit {
  readonly description?: string;
  readonly id: string;
  readonly label: string;
  readonly style?: string;
}

export interface ActionReviewRequestForAudit {
  readonly action: ActionForAudit;
  readonly allowFreeform?: boolean;
  readonly display?: string;
  readonly options?: readonly InputOptionForAudit[];
  readonly prompt: string;
  readonly requestId: string;
}

export interface InputRequestedEventForAudit {
  readonly sequence: number;
  readonly stepIndex: number;
  readonly turnId: string;
}

export interface ActionResultEventForAudit {
  readonly error?: unknown;
  readonly result: {
    readonly callId: string;
    readonly [key: string]: unknown;
  };
  readonly status: "completed" | "failed" | "rejected";
}

export function jsonForAudit(value: unknown): JsonSafe {
  return normalizeJson(value, new WeakSet<object>());
}

export function jsonObjectForAudit(value: unknown): Record<string, unknown> {
  const normalized = jsonForAudit(value);
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    return normalized as Record<string, unknown>;
  }

  return { value: normalized };
}

export function stableActionReviewHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(jsonForAudit(value))).digest("hex");
}

export function buildActionReviewRequestRecord(input: {
  readonly ctx: SessionContextForAudit;
  readonly event: InputRequestedEventForAudit;
  readonly request: ActionReviewRequestForAudit;
  readonly state: TelegramChannelState;
}): NewParamActionReview {
  const requester = input.ctx.session.auth?.current ?? input.ctx.session.auth?.initiator ?? null;
  const proposal = jsonObjectForAudit({
    action: input.request.action,
    allowFreeform: input.request.allowFreeform,
    channel: telegramStateSnapshot(input.state),
    display: input.request.display,
    options: input.request.options,
    prompt: input.request.prompt,
    requestId: input.request.requestId,
    requester: principalSnapshot(requester),
    session: {
      id: input.ctx.session.id,
      turnId: input.event.turnId,
      turnSequence: input.ctx.session.turn?.sequence ?? null,
    },
  });

  return {
    actionKind: input.request.action.kind,
    callId: input.request.action.callId,
    channel: "telegram",
    chatId: input.state.chatId,
    chatType: input.state.chatType,
    conversationId: input.state.conversationId,
    messageThreadId:
      input.state.messageThreadId === null ? null : String(input.state.messageThreadId),
    proposal,
    proposalHash: stableActionReviewHash(proposal),
    requestId: input.request.requestId,
    requesterPrincipalId: requester?.principalId ?? null,
    requesterPrincipalType: requester?.principalType ?? null,
    requesterTelegramUserId: input.state.triggeringUserId ?? null,
    sequence: input.event.sequence,
    sessionId: input.ctx.session.id,
    status: "requested",
    stepIndex: input.event.stepIndex,
    toolName: input.request.action.toolName ?? input.request.action.kind,
    turnId: input.event.turnId,
    turnSequence: input.ctx.session.turn?.sequence ?? null,
  };
}

export function buildActionReviewResultUpdate(input: {
  readonly ctx: SessionContextForAudit;
  readonly event: ActionResultEventForAudit;
  readonly now?: Date;
  readonly state?: TelegramChannelState;
}) {
  const approver = input.ctx.session.auth?.current ?? null;
  const fallbackTelegramUserId = input.state?.triggeringUserId ?? null;
  const now = input.now ?? new Date();

  return {
    approverPrincipalId:
      approver?.principalId ?? telegramPrincipalIdFromUserId(fallbackTelegramUserId),
    approverPrincipalType: approver?.principalType ?? (fallbackTelegramUserId ? "user" : null),
    approverTelegramUserId: telegramUserIdFromAuth(approver) ?? fallbackTelegramUserId,
    error: input.event.error === undefined ? null : jsonObjectForAudit(input.event.error),
    resolvedAt: now,
    result: jsonObjectForAudit(input.event.result),
    resultStatus: input.event.status,
    status: actionReviewStatus(input.event.status),
    updatedAt: now,
  };
}

export async function recordActionReviewRequested(
  input: Parameters<typeof buildActionReviewRequestRecord>[0],
  db: ParamDb = getDb(),
) {
  const record = buildActionReviewRequestRecord(input);
  const now = new Date();

  await db
    .insert(paramActionReviews)
    .values(record)
    .onConflictDoUpdate({
      set: {
        actionKind: record.actionKind,
        callId: record.callId,
        channel: record.channel,
        chatId: record.chatId,
        chatType: record.chatType,
        conversationId: record.conversationId,
        error: null,
        messageThreadId: record.messageThreadId,
        proposal: record.proposal,
        proposalHash: record.proposalHash,
        requesterPrincipalId: record.requesterPrincipalId,
        requesterPrincipalType: record.requesterPrincipalType,
        requesterTelegramUserId: record.requesterTelegramUserId,
        resolvedAt: null,
        result: null,
        resultStatus: null,
        sequence: record.sequence,
        sessionId: record.sessionId,
        status: "requested",
        stepIndex: record.stepIndex,
        toolName: record.toolName,
        turnId: record.turnId,
        turnSequence: record.turnSequence,
        updatedAt: now,
      },
      target: paramActionReviews.requestId,
    });

  return record;
}

export async function recordActionReviewResult(input: {
  readonly ctx: SessionContextForAudit;
  readonly event: ActionResultEventForAudit;
  readonly state?: TelegramChannelState;
}, db: ParamDb = getDb()) {
  const update = buildActionReviewResultUpdate(input);
  const updated = await db
    .update(paramActionReviews)
    .set(update)
    .where(eq(paramActionReviews.callId, input.event.result.callId))
    .returning({ id: paramActionReviews.id });

  return updated.length;
}

function actionReviewStatus(status: ActionResultEventForAudit["status"]): ActionReviewStatus {
  return status;
}

function normalizeJson(value: unknown, seen: WeakSet<object>): JsonSafe {
  if (value === null) return null;

  if (typeof value === "string" || typeof value === "boolean") return value;

  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "bigint") return value.toString();

  if (typeof value === "undefined") return null;

  if (typeof value === "function" || typeof value === "symbol") return String(value);

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
    };
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeJson(item, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    const normalized: Record<string, JsonSafe> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        normalized[key] = normalizeJson(entry, seen);
      }
    }

    seen.delete(value);
    return normalized;
  }

  return null;
}

function principalSnapshot(principal: PrincipalForAudit | null | undefined) {
  if (!principal) return null;

  return {
    authenticator: principal.authenticator,
    principalId: principal.principalId,
    principalType: principal.principalType,
  };
}

function telegramStateSnapshot(state: TelegramChannelState) {
  return {
    chatId: state.chatId,
    chatType: state.chatType,
    conversationId: state.conversationId,
    messageThreadId: state.messageThreadId,
    triggeringUserId: state.triggeringUserId ?? null,
  };
}

function telegramPrincipalIdFromUserId(userId: string | null) {
  return userId ? `telegram:${userId}` : null;
}
