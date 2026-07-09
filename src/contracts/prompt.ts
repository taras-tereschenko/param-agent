import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./ids";

export const promptRunTypeSchema = z.enum([
  "normal_chat",
  "ambient_wake",
  "memory_review",
  "approval",
  "task_result",
  "compaction",
  "admin",
]);

export type PromptRunType = z.infer<typeof promptRunTypeSchema>;

export const promptLayerSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  content: z.string(),
  /** When true, the content is a verbatim, non-editable base (e.g. the human
   * text agent prompt). Compilers must never rewrite verbatim layers. */
  verbatim: z.boolean().default(false),
});

export type PromptLayer = z.infer<typeof promptLayerSchema>;

export const styleGuardPolicySchema = z.object({
  version: z.string(),
  enabled: z.boolean(),
  rewriteOnFailure: z.boolean(),
  maxVisibleMessagesPerRun: z.number().int().positive(),
});

export type StyleGuardPolicy = z.infer<typeof styleGuardPolicySchema>;

export const platformCapabilitySummarySchema = z.object({
  platform: z.string(),
  supportsText: z.boolean(),
  supportsReactions: z.boolean(),
  availableReactions: z.array(z.string()).optional(),
  supportsReplies: z.boolean(),
  supportsFiles: z.boolean(),
  supportsInlineButtons: z.boolean(),
  supportsRichMessage: z.boolean(),
  supportsMiniApps: z.boolean(),
  notes: z.array(z.string()).optional(),
});

export type PlatformCapabilitySummary = z.infer<
  typeof platformCapabilitySummarySchema
>;

export const promptApprovalPolicySchema = z.object({
  requireApprovalForConsequential: z.boolean(),
  safeAutoRunTools: z.array(z.string()),
  requesterIsTrusted: z.boolean().optional(),
});

export type PromptApprovalPolicy = z.infer<typeof promptApprovalPolicySchema>;

export const promptContextRefsSchema = z.object({
  eventIds: z.array(idSchema),
  memoryIds: z.array(idSchema),
  summaryIds: z.array(idSchema).optional(),
  steeringEventIds: z.array(idSchema).optional(),
});

export type PromptContextRefs = z.infer<typeof promptContextRefsSchema>;

export const promptPacketSchema = z.object({
  schemaVersion: z.literal(1),
  promptId: idSchema,
  actorRunId: idSchema,
  sessionId: idSchema,
  runType: promptRunTypeSchema,
  createdAt: isoDateTimeSchema,
  layers: z.array(promptLayerSchema),
  allowedOutputs: z.array(z.string()),
  styleGuard: styleGuardPolicySchema,
  approvalPolicy: promptApprovalPolicySchema,
  platformCapabilities: platformCapabilitySummarySchema,
  contextRefs: promptContextRefsSchema,
});

export type PromptPacket = z.infer<typeof promptPacketSchema>;

/** Prompt contract versions (docs/PROMPTS.md). */
export const promptVersions = {
  voice: "voice:param_friend_v1",
  contracts: "contracts:default_v1",
  styleGuard: "style_guard:param_chat_v1",
} as const;
