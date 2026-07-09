import { z } from "zod";

import { idSchema, isoDateTimeSchema, jsonObjectSchema } from "./ids";

/**
 * An actor ref identifies who or what caused an event.
 */
export const actorRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    platform: z.string().min(1),
    platformUserId: z.string().min(1),
    paramUserId: z.string().optional(),
    displayName: z.string().optional(),
    username: z.string().optional(),
    isBot: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("param"),
    runtime: z.string().optional(),
  }),
  z.object({
    kind: z.literal("task_agent"),
    taskSessionId: idSchema,
    taskRunId: idSchema.optional(),
    agentType: z.string().min(1),
  }),
  z.object({
    kind: z.literal("tool"),
    toolName: z.string().min(1),
  }),
  z.object({
    kind: z.literal("scheduler"),
    scheduleId: idSchema.optional(),
  }),
  z.object({
    kind: z.literal("admin"),
    paramUserId: z.string().optional(),
    platformUserId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("system"),
    component: z.string().min(1),
  }),
]);

export type ActorRef = z.infer<typeof actorRefSchema>;

/**
 * Platform refs preserve routing facts without forcing the core to understand
 * Telegram internals.
 */
export const platformRefSchema = z.object({
  platform: z.string().min(1),
  accountId: z.string().optional(),
  chatId: z.string().optional(),
  chatType: z.string().optional(),
  messageThreadId: z.string().optional(),
  channelId: z.string().optional(),
  threadId: z.string().optional(),
});

export type PlatformRef = z.infer<typeof platformRefSchema>;

export const rawPayloadRefSchema = z.object({
  provider: z.string().min(1),
  kind: z.string().min(1),
  storage: z.enum(["inline", "object_store", "file", "database"]),
  ref: z.string().optional(),
  json: jsonObjectSchema.optional(),
  hash: z.string().optional(),
});

export type RawPayloadRef = z.infer<typeof rawPayloadRefSchema>;

/* -------------------------------------------------------------------------- */
/* Shared content types                                                       */
/* -------------------------------------------------------------------------- */

export const textEntitySchema = z.object({
  type: z.string().min(1),
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
  value: z.string().optional(),
});

export type TextEntity = z.infer<typeof textEntitySchema>;

export const mentionRefSchema = z.object({
  platformUserId: z.string().optional(),
  username: z.string().optional(),
  text: z.string(),
  isParam: z.boolean(),
});

export type MentionRef = z.infer<typeof mentionRefSchema>;

export const replyTargetSchema = z.object({
  platformMessageId: z.string().optional(),
  eventId: idSchema.optional(),
  sender: actorRefSchema.optional(),
});

export type ReplyTarget = z.infer<typeof replyTargetSchema>;

export const attachmentRefSchema = z.object({
  attachmentId: idSchema,
  kind: z.string().min(1),
  platformFileId: z.string().optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  storageRef: z.string().optional(),
  caption: z.string().optional(),
});

export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

export const reactionRefSchema = z.object({
  kind: z.string().min(1),
  emoji: z.string().optional(),
  customEmojiId: z.string().optional(),
});

export type ReactionRef = z.infer<typeof reactionRefSchema>;

export const artifactRefSchema = z.object({
  artifactId: idSchema,
  kind: z.string().min(1),
  title: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  hash: z.string().optional(),
});

export type ArtifactRef = z.infer<typeof artifactRefSchema>;

/* -------------------------------------------------------------------------- */
/* Steering inbox                                                             */
/* -------------------------------------------------------------------------- */

export const steeringPrioritySchema = z.enum([
  "soft",
  "strong",
  "hard_control",
]);

export type SteeringPriority = z.infer<typeof steeringPrioritySchema>;

export const steeringInboxItemSchema = z.object({
  inboxItemId: idSchema,
  actorRunId: idSchema,
  sessionId: idSchema,
  eventId: idSchema,
  priority: steeringPrioritySchema,
  tags: z.array(z.string()),
  reason: z.string(),
  createdAt: isoDateTimeSchema,
  consumedAt: isoDateTimeSchema.optional(),
});

export type SteeringInboxItem = z.infer<typeof steeringInboxItemSchema>;
