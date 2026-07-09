import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * Portable id primitives used at module boundaries.
 *
 * Database rows use native Postgres UUIDs. External references, idempotency
 * keys, dedupe keys, platform ids, and contract aliases are strings.
 */
export type Id = string;
export type IsoDateTime = string;
export type JsonObject = Record<string, unknown>;

export type SessionId = Id;
export type EventId = Id;
export type RunId = Id;
export type JobId = Id;
export type ApprovalId = Id;
export type OutputId = Id;
export type ScheduleId = Id;
export type ToolCallId = Id;
export type MemoryId = Id;
export type TaskRunId = Id;
export type SurfaceId = Id;

export const idSchema = z.string().min(1);
export const uuidSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime();
export const jsonObjectSchema = z.record(z.string(), z.unknown());

export function newId(): Id {
  return randomUUID();
}

export function nowIso(): IsoDateTime {
  return new Date().toISOString();
}

/**
 * Stable idempotency/dedupe key builders.
 *
 * These match the formats documented in docs/CONTRACTS.md so that duplicate
 * inputs never create duplicate visible messages, tool calls, or approvals.
 */
export const idempotencyKeys = {
  telegramUpdate(accountId: string, updateId: number | string): string {
    return `telegram:update:${accountId}:${updateId}`;
  },
  incomingMessage(
    accountId: string,
    chatId: string,
    messageId: number | string,
  ): string {
    return `telegram:message:${accountId}:${chatId}:${messageId}`;
  },
  ambientWake(
    scheduleId: string,
    plannedFor: string,
    sessionId: string,
  ): string {
    return `ambient:${scheduleId}:${plannedFor}:${sessionId}`;
  },
  actorOutput(runId: string, sequence: number): string {
    return `output:${runId}:${sequence}`;
  },
  toolCall(runId: string, toolCallId: string): string {
    return `tool:${runId}:${toolCallId}`;
  },
  delivery(outputId: string, adapterTarget: string): string {
    return `delivery:${outputId}:${adapterTarget}`;
  },
  approvalResponse(
    approvalId: string,
    approver: string,
    decisionId: string,
  ): string {
    return `approval:${approvalId}:${approver}:${decisionId}`;
  },
} as const;
