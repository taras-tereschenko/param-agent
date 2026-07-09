import { z } from "zod";

import { artifactRefSchema } from "./common";
import { idSchema, jsonObjectSchema } from "./ids";

export const runtimeNameSchema = z.union([
  z.enum(["codex", "opencode", "antigravity", "image", "browser"]),
  z.string().min(1),
]);

export type RuntimeName = z.infer<typeof runtimeNameSchema>;

/**
 * `runtime.event` payload streamed from runtime adapters for traceability.
 */
export const runtimeEventPayloadSchema = z.object({
  runtime: runtimeNameSchema,
  runtimeRunId: z.string().optional(),
  kind: z.enum([
    "started",
    "stdout",
    "stderr",
    "tool_request",
    "tool_result",
    "artifact",
    "checkpoint",
    "output_buffered",
    "steering_ack",
    "cancel_requested",
    "cancelled",
    "usage",
    "completed",
    "failed",
  ]),
  text: z.string().optional(),
  data: jsonObjectSchema.optional(),
  artifact: artifactRefSchema.optional(),
});

export type RuntimeEventPayload = z.infer<typeof runtimeEventPayloadSchema>;

/**
 * Adapters report capabilities. Param core must work when most are false.
 */
export const runtimeAdapterCapabilitiesSchema = z.object({
  runtime: runtimeNameSchema,
  supportsLiveSteering: z.boolean(),
  supportsCancel: z.boolean(),
  supportsCheckpointRefresh: z.boolean(),
  supportsToolInterception: z.boolean(),
  supportsOutputBuffering: z.boolean(),
  supportsArtifacts: z.boolean(),
  supportsUsage: z.boolean(),
});

export type RuntimeAdapterCapabilities = z.infer<
  typeof runtimeAdapterCapabilitiesSchema
>;

export const runtimeWorkspaceSpecSchema = z.object({
  root: z.string().min(1),
  runDir: z.string().min(1),
  mode: z.enum(["read_only", "scoped_write", "full_workspace"]),
  cleanupAfterDays: z.number().int().positive().optional(),
});

export type RuntimeWorkspaceSpec = z.infer<typeof runtimeWorkspaceSpecSchema>;

export const runtimeEnvironmentSpecSchema = z.object({
  variables: z.record(z.string(), z.string()),
  secretRefs: z.array(z.string()),
  inheritProcessEnv: z.literal(false),
});

export type RuntimeEnvironmentSpec = z.infer<
  typeof runtimeEnvironmentSpecSchema
>;

export const runtimeBudgetSpecSchema = z.object({
  timeoutSeconds: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
  maxToolCalls: z.number().int().nonnegative().optional(),
  maxOutputBytes: z.number().int().positive().optional(),
  maxArtifacts: z.number().int().nonnegative().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
});

export type RuntimeBudgetSpec = z.infer<typeof runtimeBudgetSpecSchema>;

export const runtimeAdapterRunRequestSchema = z.object({
  schemaVersion: z.literal(1),
  runtime: runtimeNameSchema,
  runKind: z.enum(["actor", "task", "memory_review", "compaction", "admin"]),
  actorRunId: idSchema.optional(),
  taskRunId: idSchema.optional(),
  sessionId: idSchema,
  parentSessionId: idSchema.optional(),
  promptPacketRef: z.string().optional(),
  taskContextRef: z.string().optional(),
  workspace: runtimeWorkspaceSpecSchema,
  environment: runtimeEnvironmentSpecSchema,
  allowedTools: z.array(z.string()),
  approvalPolicyRef: z.string(),
  budget: runtimeBudgetSpecSchema,
  outputMode: z.enum(["buffered", "checkpointed_stream"]),
  idempotencyKey: z.string().min(1),
});

export type RuntimeAdapterRunRequest = z.infer<
  typeof runtimeAdapterRunRequestSchema
>;

/** Structured runtime failure codes (docs/RUNTIME_ADAPTERS.md). */
export const runtimeFailureCodeSchema = z.enum([
  "command_missing",
  "auth_missing",
  "provider_error",
  "model_refused",
  "context_too_large",
  "timeout",
  "budget_exceeded",
  "process_crashed",
  "parse_failure",
  "unsupported_capability",
  "tool_interception_failed",
  "approval_denied",
  "cancellation_requested",
]);

export type RuntimeFailureCode = z.infer<typeof runtimeFailureCodeSchema>;
