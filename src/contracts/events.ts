import { z } from "zod";

import { approvalResponsePayloadSchema } from "./action-review";
import { actorOutputTypeSchema } from "./actor-output";
import {
  actorRefSchema,
  attachmentRefSchema,
  mentionRefSchema,
  platformRefSchema,
  rawPayloadRefSchema,
  reactionRefSchema,
  replyTargetSchema,
  textEntitySchema,
} from "./common";
import { idSchema, isoDateTimeSchema, jsonObjectSchema } from "./ids";
import { memoryCandidatePayloadSchema } from "./memory";
import { runtimeEventPayloadSchema } from "./runtime";
import { toolResultPayloadSchema } from "./tool";
import { artifactRefSchema } from "./common";

export const paramEventTypeSchema = z.enum([
  "chat.message.received",
  "chat.message.edited",
  "chat.message.deleted",
  "chat.reaction.changed",
  "chat.action.callback",
  "chat.mini_app.result",
  "approval.response",
  "ambient.wake",
  "task.result",
  "runtime.event",
  "tool.result",
  "delivery.succeeded",
  "delivery.failed",
  "system.recovery",
  "admin.command",
]);

export type ParamEventType = z.infer<typeof paramEventTypeSchema>;

export const eventDirectionSchema = z.enum([
  "inbound",
  "outbound",
  "internal",
]);
export const eventVisibilitySchema = z.enum([
  "chat_visible",
  "internal",
  "admin",
]);

/* -------------------------------------------------------------------------- */
/* Event payloads                                                             */
/* -------------------------------------------------------------------------- */

export const messageMechanicalSchema = z.object({
  mentionsParam: z.boolean(),
  repliesToParam: z.boolean(),
  isDirectMessage: z.boolean(),
  isGroupMessage: z.boolean(),
  isTopicMessage: z.boolean(),
  hasCommandLikeText: z.boolean(),
});

export type MessageMechanical = z.infer<typeof messageMechanicalSchema>;

export const chatMessageReceivedPayloadSchema = z.object({
  platformMessageId: z.string().min(1),
  text: z.string().optional(),
  textEntities: z.array(textEntitySchema).optional(),
  attachments: z.array(attachmentRefSchema).optional(),
  replyTo: replyTargetSchema.optional(),
  mentions: z.array(mentionRefSchema).optional(),
  mechanical: messageMechanicalSchema,
});

export type ChatMessageReceivedPayload = z.infer<
  typeof chatMessageReceivedPayloadSchema
>;

export const chatMessageEditedPayloadSchema = z.object({
  platformMessageId: z.string().min(1),
  originalEventId: idSchema.optional(),
  text: z.string().optional(),
  textEntities: z.array(textEntitySchema).optional(),
  attachments: z.array(attachmentRefSchema).optional(),
  editedAt: isoDateTimeSchema.optional(),
});

export const chatMessageDeletedPayloadSchema = z.object({
  platformMessageId: z.string().min(1),
  originalEventId: idSchema.optional(),
  deletedAt: isoDateTimeSchema.optional(),
});

export const chatReactionChangedPayloadSchema = z.object({
  targetPlatformMessageId: z.string().min(1),
  targetEventId: idSchema.optional(),
  oldReactions: z.array(reactionRefSchema).optional(),
  newReactions: z.array(reactionRefSchema),
  changedBy: actorRefSchema.optional(),
});

export const chatActionCallbackPayloadSchema = z.object({
  callbackId: z.string().min(1),
  surfaceId: idSchema.optional(),
  actionId: z.string().min(1),
  value: jsonObjectSchema.optional(),
  platformMessageId: z.string().optional(),
});

export const miniAppResultPayloadSchema = z.object({
  surfaceId: idSchema,
  interactionId: idSchema,
  result: jsonObjectSchema,
});

export const ambientWakePayloadSchema = z.object({
  intent: z.enum([
    "quiet_chat_wake",
    "check_in",
    "topic_seed",
    "joke_drop",
    "meme_drop",
    "follow_up",
    "daily_recap",
    "memory_review",
    "server_health",
    "research_watch",
    "unfinished_task_ping",
  ]),
  reason: z.string(),
  vibe: z.string().optional(),
  allowedOutputs: z.array(actorOutputTypeSchema),
  maxVisibleMessages: z.number().int().nonnegative().optional(),
  cooldownContext: z.object({
    lastProactiveAt: isoDateTimeSchema.optional(),
    proactiveMessagesToday: z.number().int().nonnegative(),
    lastParamMessageAt: isoDateTimeSchema.optional(),
    sessionBusy: z.boolean(),
  }),
  createdBy: actorRefSchema,
  scheduleId: idSchema.optional(),
  approvalId: idSchema.optional(),
});

export type AmbientWakePayload = z.infer<typeof ambientWakePayloadSchema>;

export const taskResultPayloadSchema = z.object({
  taskSessionId: idSchema,
  taskRunId: idSchema,
  status: z.enum(["completed", "failed", "cancelled", "waiting_approval"]),
  title: z.string().optional(),
  summary: z.string(),
  artifacts: z.array(artifactRefSchema).optional(),
  evidenceEventIds: z.array(idSchema).optional(),
  toolTraceRefs: z.array(idSchema).optional(),
  memoryCandidates: z.array(memoryCandidatePayloadSchema).optional(),
  proposedActions: z.array(jsonObjectSchema).optional(),
  followUpSuggestions: z.array(z.string()).optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export type TaskResultPayload = z.infer<typeof taskResultPayloadSchema>;

export const deliverySucceededPayloadSchema = z.object({
  outputId: idSchema,
  platformMessageId: z.string().optional(),
  deliveredAt: isoDateTimeSchema,
  adapter: z.string(),
});

export const deliveryFailedPayloadSchema = z.object({
  outputId: idSchema,
  failedAt: isoDateTimeSchema,
  adapter: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

export const systemRecoveryPayloadSchema = z.object({
  kind: z.string(),
  summary: z.string(),
  repaired: z.array(z.string()).optional(),
  details: jsonObjectSchema.optional(),
});

export const adminCommandPayloadSchema = z.object({
  command: z.string(),
  args: jsonObjectSchema.optional(),
});

/** Per-type payload validators. */
export const eventPayloadSchemas = {
  "chat.message.received": chatMessageReceivedPayloadSchema,
  "chat.message.edited": chatMessageEditedPayloadSchema,
  "chat.message.deleted": chatMessageDeletedPayloadSchema,
  "chat.reaction.changed": chatReactionChangedPayloadSchema,
  "chat.action.callback": chatActionCallbackPayloadSchema,
  "chat.mini_app.result": miniAppResultPayloadSchema,
  "approval.response": approvalResponsePayloadSchema,
  "ambient.wake": ambientWakePayloadSchema,
  "task.result": taskResultPayloadSchema,
  "runtime.event": runtimeEventPayloadSchema,
  "tool.result": toolResultPayloadSchema,
  "delivery.succeeded": deliverySucceededPayloadSchema,
  "delivery.failed": deliveryFailedPayloadSchema,
  "system.recovery": systemRecoveryPayloadSchema,
  "admin.command": adminCommandPayloadSchema,
} satisfies Record<ParamEventType, z.ZodTypeAny>;

/* -------------------------------------------------------------------------- */
/* Envelope                                                                   */
/* -------------------------------------------------------------------------- */

export const paramEventEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: idSchema,
  type: paramEventTypeSchema,
  sessionId: idSchema,
  direction: eventDirectionSchema,
  visibility: eventVisibilitySchema,
  occurredAt: isoDateTimeSchema,
  receivedAt: isoDateTimeSchema.optional(),
  persistedAt: isoDateTimeSchema,
  source: actorRefSchema,
  platform: platformRefSchema.optional(),
  dedupeKey: z.string().min(1),
  correlationId: idSchema.optional(),
  parentEventId: idSchema.optional(),
  rootEventId: idSchema.optional(),
  actorRunId: idSchema.optional(),
  jobId: idSchema.optional(),
  approvalId: idSchema.optional(),
  payload: jsonObjectSchema,
  raw: rawPayloadRefSchema.optional(),
});

export type ParamEvent<TPayload = Record<string, unknown>> = Omit<
  z.infer<typeof paramEventEnvelopeSchema>,
  "payload"
> & { payload: TPayload };

/** Validate an event's payload against its declared type. */
export function validateEventPayload(
  type: ParamEventType,
  payload: unknown,
): unknown {
  return eventPayloadSchemas[type].parse(payload);
}
