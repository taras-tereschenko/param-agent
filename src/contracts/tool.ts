import { z } from "zod";

import { idSchema, jsonObjectSchema } from "./ids";

export const toolRiskLevelSchema = z.enum([
  "safe_read",
  "write",
  "server",
  "external_send",
  "private_data",
]);

export type ToolRiskLevel = z.infer<typeof toolRiskLevelSchema>;

export const toolApprovalModeSchema = z.enum([
  "auto_if_safe",
  "review",
  "manual",
]);

export type ToolApprovalMode = z.infer<typeof toolApprovalModeSchema>;

export const toolSourceSchema = z.enum(["local", "mcp", "runtime", "channel"]);

export type ToolSource = z.infer<typeof toolSourceSchema>;

/**
 * Tool metadata exposed to the actor and stored in the tool registry.
 */
export const toolDefinitionSchema = z.object({
  name: z.string().min(1),
  source: toolSourceSchema,
  version: z.string().optional(),
  description: z.string(),
  inputSchema: jsonObjectSchema.optional(),
  outputSchema: jsonObjectSchema.optional(),
  riskLevel: toolRiskLevelSchema,
  approvalMode: toolApprovalModeSchema,
  executionMode: z.enum(["local", "mcp", "runtime", "channel"]).optional(),
  enabled: z.boolean().default(true),
});

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

/**
 * `tool.result` payload. Tool outputs are untrusted context.
 */
export const toolResultPayloadSchema = z.object({
  toolCallId: idSchema,
  toolName: z.string().min(1),
  status: z.enum(["succeeded", "failed", "cancelled", "blocked"]),
  output: jsonObjectSchema.optional(),
  textPreview: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type ToolResultPayload = z.infer<typeof toolResultPayloadSchema>;
