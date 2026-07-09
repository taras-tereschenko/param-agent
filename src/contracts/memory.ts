import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./ids";

export const memoryScopeSchema = z.enum([
  "user",
  "group",
  "session",
  "project",
  "agent",
]);

export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memorySensitivitySchema = z.enum(["low", "medium", "high"]);

export type MemorySensitivity = z.infer<typeof memorySensitivitySchema>;

export const memorySubjectRefSchema = z.object({
  paramUserId: z.string().optional(),
  sessionId: idSchema.optional(),
  projectId: z.string().optional(),
  groupChatId: z.string().optional(),
  agentType: z.string().optional(),
});

export type MemorySubjectRef = z.infer<typeof memorySubjectRefSchema>;

/**
 * `memory_candidate` proposes memory for review. Candidates are not
 * automatically trusted facts.
 */
export const memoryCandidatePayloadSchema = z.object({
  candidateId: idSchema,
  operation: z.enum(["create", "update", "forget"]),
  scope: memoryScopeSchema,
  subjectRef: memorySubjectRefSchema.optional(),
  text: z.string().min(1),
  confidence: z.number().min(0).max(1),
  sensitivity: memorySensitivitySchema,
  sourceEventIds: z.array(idSchema),
  provenanceNote: z.string(),
});

export type MemoryCandidatePayload = z.infer<
  typeof memoryCandidatePayloadSchema
>;

/**
 * A memory entry as shown to the actor: evidence with provenance, not truth.
 */
export const memoryViewSchema = z.object({
  id: idSchema,
  scope: memoryScopeSchema,
  subject: z.string().optional(),
  text: z.string(),
  confidence: z.number().min(0).max(1),
  sensitivity: memorySensitivitySchema,
  provenanceNote: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema.optional(),
});

export type MemoryView = z.infer<typeof memoryViewSchema>;
