import type { JsonObject } from "../schema";
import type { ParamDb } from "../client";
import { auditLog, decisionRecords, healthChecks } from "../schema";

export type WriteAuditInput = {
  eventType: string;
  actor?: JsonObject;
  sessionId?: string | null;
  eventId?: string | null;
  actorRunId?: string | null;
  approvalId?: string | null;
  toolCallId?: string | null;
  target?: JsonObject | null;
  summary: string;
  metadata?: JsonObject;
};

export async function writeAudit(
  db: ParamDb,
  input: WriteAuditInput,
): Promise<void> {
  await db.insert(auditLog).values({
    eventType: input.eventType,
    actor: input.actor ?? {},
    sessionId: input.sessionId ?? null,
    eventId: input.eventId ?? null,
    actorRunId: input.actorRunId ?? null,
    approvalId: input.approvalId ?? null,
    toolCallId: input.toolCallId ?? null,
    target: input.target ?? null,
    summary: input.summary,
    metadata: input.metadata ?? {},
  });
}

export type WriteDecisionInput = {
  actorRunId?: string | null;
  sessionId?: string | null;
  triggerEventId?: string | null;
  decision: string;
  reasonCode: string;
  shortReason: string;
  evidenceRefs?: JsonObject;
  memoryUsedIds?: JsonObject;
  ignoredMemoryIds?: JsonObject;
  steeringEventIds?: JsonObject;
  policyRefs?: JsonObject;
};

export async function writeDecision(
  db: ParamDb,
  input: WriteDecisionInput,
): Promise<void> {
  await db.insert(decisionRecords).values({
    actorRunId: input.actorRunId ?? null,
    sessionId: input.sessionId ?? null,
    triggerEventId: input.triggerEventId ?? null,
    decision: input.decision,
    reasonCode: input.reasonCode,
    shortReason: input.shortReason,
    evidenceRefs: input.evidenceRefs,
    memoryUsedIds: input.memoryUsedIds,
    ignoredMemoryIds: input.ignoredMemoryIds,
    steeringEventIds: input.steeringEventIds,
    policyRefs: input.policyRefs,
  });
}

export async function writeHealthCheck(
  db: ParamDb,
  input: {
    checkName: string;
    status: string;
    summary: string;
    details?: JsonObject;
  },
): Promise<void> {
  await db.insert(healthChecks).values({
    checkName: input.checkName,
    status: input.status,
    summary: input.summary,
    details: input.details,
  });
}

export const auditRepository = {
  writeAudit,
  writeDecision,
  writeHealthCheck,
};
