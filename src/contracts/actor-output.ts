import { z } from "zod";

import { approvalRequestOutputPayloadSchema } from "./action-review";
import { attachmentRefSchema } from "./common";
import { idSchema, isoDateTimeSchema, jsonObjectSchema } from "./ids";
import { memoryCandidatePayloadSchema } from "./memory";
import { runtimeNameSchema } from "./runtime";
import { toolApprovalModeSchema, toolRiskLevelSchema } from "./tool";
import { renderUiOutputPayloadSchema } from "./ui";

export const actorOutputTypeSchema = z.enum([
  "message",
  "react_to_message",
  "no_reply",
  "tool_call",
  "spawn_task_agent",
  "approval_request",
  "memory_candidate",
  "render_ui",
  "run_summary",
  "done",
]);

export type ActorOutputType = z.infer<typeof actorOutputTypeSchema>;

/* -------------------------------------------------------------------------- */
/* Output payloads                                                            */
/* -------------------------------------------------------------------------- */

export const messageOutputPayloadSchema = z.object({
  text: z.string().min(1),
  replyToEventId: idSchema.optional(),
  attachments: z.array(attachmentRefSchema).optional(),
  parseMode: z.literal("plain").default("plain"),
  style: z.literal("param_chat").default("param_chat"),
  visible: z.literal(true).default(true),
});

export type MessageOutputPayload = z.infer<typeof messageOutputPayloadSchema>;

export const reactToMessageOutputPayloadSchema = z.object({
  targetEventId: idSchema,
  emoji: z.string().min(1),
  reason: z.string().optional(),
});

export type ReactToMessageOutputPayload = z.infer<
  typeof reactToMessageOutputPayloadSchema
>;

export const noReplyOutputPayloadSchema = z.object({
  reason: z.enum([
    "nothing_to_add",
    "chat_busy",
    "not_my_moment",
    "reaction_would_be_too_much",
    "waiting_for_more_context",
    "cooldown",
    "blocked_by_policy",
    "other",
  ]),
  note: z.string().optional(),
});

export type NoReplyOutputPayload = z.infer<typeof noReplyOutputPayloadSchema>;

export const toolCallOutputPayloadSchema = z.object({
  toolCallId: idSchema,
  toolName: z.string().min(1),
  input: jsonObjectSchema,
  reason: z.string(),
  riskHint: toolRiskLevelSchema.optional(),
  approvalPreference: toolApprovalModeSchema.optional(),
});

export type ToolCallOutputPayload = z.infer<
  typeof toolCallOutputPayloadSchema
>;

export const spawnTaskAgentOutputPayloadSchema = z.object({
  taskType: z.union([
    z.enum([
      "research",
      "coding",
      "image",
      "browser",
      "memory",
      "cli",
      "server",
    ]),
    z.string().min(1),
  ]),
  goal: z.string().min(1),
  preferredRuntime: runtimeNameSchema.optional(),
  contextEventIds: z.array(idSchema).optional(),
  memoryScope: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  budget: z
    .object({
      maxTokens: z.number().int().positive().optional(),
      maxCostUsd: z.number().positive().optional(),
      timeoutSeconds: z.number().int().positive().optional(),
      maxToolCalls: z.number().int().nonnegative().optional(),
    })
    .optional(),
  approvalPreference: toolApprovalModeSchema.optional(),
  reportTo: z.literal("session_actor").default("session_actor"),
});

export type SpawnTaskAgentOutputPayload = z.infer<
  typeof spawnTaskAgentOutputPayloadSchema
>;

export const runSummaryOutputPayloadSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  openLoops: z.array(z.string()).optional(),
  memoryHints: z.array(z.string()).optional(),
  memoryUsed: z.array(idSchema).optional(),
  ignoredMemory: z
    .array(z.object({ id: idSchema, reason: z.string() }))
    .optional(),
  consumedSteeringEventIds: z.array(idSchema).optional(),
  preSendRefreshEventIds: z.array(idSchema).optional(),
  nextSuggestedWakeAt: isoDateTimeSchema.optional(),
});

export type RunSummaryOutputPayload = z.infer<
  typeof runSummaryOutputPayloadSchema
>;

export const doneOutputPayloadSchema = z.object({
  status: z.enum([
    "completed",
    "waiting_approval",
    "blocked",
    "cancelled",
    "failed",
  ]),
  reason: z.string().optional(),
});

export type DoneOutputPayload = z.infer<typeof doneOutputPayloadSchema>;

/* -------------------------------------------------------------------------- */
/* Draft + envelope unions                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What the inference layer returns for a single intent: type + payload. The
 * runner assigns envelope fields (ids, sequence, idempotency).
 */
export const actorOutputDraftSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), payload: messageOutputPayloadSchema }),
  z.object({
    type: z.literal("react_to_message"),
    payload: reactToMessageOutputPayloadSchema,
  }),
  z.object({ type: z.literal("no_reply"), payload: noReplyOutputPayloadSchema }),
  z.object({
    type: z.literal("tool_call"),
    payload: toolCallOutputPayloadSchema,
  }),
  z.object({
    type: z.literal("spawn_task_agent"),
    payload: spawnTaskAgentOutputPayloadSchema,
  }),
  z.object({
    type: z.literal("approval_request"),
    payload: approvalRequestOutputPayloadSchema,
  }),
  z.object({
    type: z.literal("memory_candidate"),
    payload: memoryCandidatePayloadSchema,
  }),
  z.object({
    type: z.literal("render_ui"),
    payload: renderUiOutputPayloadSchema,
  }),
  z.object({
    type: z.literal("run_summary"),
    payload: runSummaryOutputPayloadSchema,
  }),
  z.object({ type: z.literal("done"), payload: doneOutputPayloadSchema }),
]);

export type ActorOutputDraft = z.infer<typeof actorOutputDraftSchema>;

const actorOutputEnvelopeBaseSchema = z.object({
  schemaVersion: z.literal(1),
  outputId: idSchema,
  sessionId: idSchema,
  actorRunId: idSchema,
  sequence: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  causedByEventIds: z.array(idSchema),
  idempotencyKey: z.string().min(1),
});

/** A fully-formed, stored actor output. */
export const actorOutputSchema = actorOutputEnvelopeBaseSchema.and(
  actorOutputDraftSchema,
);

export type ActorOutput = z.infer<typeof actorOutputSchema>;

/** Payload validators keyed by output type (used for stored-row validation). */
export const actorOutputPayloadSchemas = {
  message: messageOutputPayloadSchema,
  react_to_message: reactToMessageOutputPayloadSchema,
  no_reply: noReplyOutputPayloadSchema,
  tool_call: toolCallOutputPayloadSchema,
  spawn_task_agent: spawnTaskAgentOutputPayloadSchema,
  approval_request: approvalRequestOutputPayloadSchema,
  memory_candidate: memoryCandidatePayloadSchema,
  render_ui: renderUiOutputPayloadSchema,
  run_summary: runSummaryOutputPayloadSchema,
  done: doneOutputPayloadSchema,
} satisfies Record<ActorOutputType, z.ZodTypeAny>;

/** Visible output types that require the style guard + delivery pipeline. */
export const visibleOutputTypes: ActorOutputType[] = [
  "message",
  "react_to_message",
];
