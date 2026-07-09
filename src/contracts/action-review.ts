import { z } from "zod";

import { actorRefSchema } from "./common";
import { idSchema, isoDateTimeSchema, jsonObjectSchema } from "./ids";

export const trustScopeSchema = z.enum([
  "global",
  "chat",
  "project",
  "server_admin",
]);

export type TrustScope = z.infer<typeof trustScopeSchema>;

export const actionKindSchema = z.enum([
  "tool_call",
  "send_external_message",
  "config_change",
  "server_action",
  "schedule_create",
  "schedule_update",
  "memory_sensitive",
  "ui_theme_persist",
]);

export type ActionKind = z.infer<typeof actionKindSchema>;

export const riskLabelSchema = z.enum([
  "safe",
  "low",
  "medium",
  "high",
  "critical",
]);

export type RiskLabel = z.infer<typeof riskLabelSchema>;

/**
 * `approval_request` output payload. Approval is for the exact proposed action.
 */
export const approvalRequestOutputPayloadSchema = z.object({
  approvalId: idSchema,
  actionKind: z.union([actionKindSchema, z.string().min(1)]),
  requesterEventIds: z.array(idSchema),
  requestedBy: actorRefSchema.optional(),
  title: z.string().min(1),
  summary: z.string(),
  exactPreview: z.string(),
  proposedAction: jsonObjectSchema,
  requiredTrustScope: z.union([trustScopeSchema, z.string().min(1)]),
  expiresAt: isoDateTimeSchema.optional(),
});

export type ApprovalRequestOutputPayload = z.infer<
  typeof approvalRequestOutputPayloadSchema
>;

/**
 * `approval.response` event payload. Requester and approver are separate.
 */
export const approvalResponsePayloadSchema = z.object({
  approvalId: idSchema,
  decision: z.enum(["approved", "rejected", "expired", "revoked"]),
  approver: actorRefSchema,
  decisionText: z.string().optional(),
  decidedAt: isoDateTimeSchema,
});

export type ApprovalResponsePayload = z.infer<
  typeof approvalResponsePayloadSchema
>;

/**
 * Result of the auto-review classification pass.
 */
export const actionReviewDecisionSchema = z.object({
  decision: z.enum([
    "auto_allowed",
    "needs_approval",
    "denied",
    "not_applicable",
  ]),
  risk: riskLabelSchema,
  requiredTrustScope: trustScopeSchema.optional(),
  reasonCode: z.string(),
  reason: z.string(),
  senderVerified: z.boolean(),
  requesterIsTrusted: z.boolean(),
});

export type ActionReviewDecision = z.infer<typeof actionReviewDecisionSchema>;
