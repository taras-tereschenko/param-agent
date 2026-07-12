import { randomUUID } from "node:crypto";

import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

import type {
  ActorInference,
  ActorInferenceRequest,
  ActorInferenceResult,
} from "../../actor/inference";
import type { ActorOutputDraft } from "../../contracts/actor-output";
import { logger } from "../../observability/logger";

const log = logger.child("openai-actor");

/**
 * Direct OpenAI API chat-brain via the AI SDK.
 *
 * Uses `generateObject` so the provider constrains the output to Param's schema
 * — unlike the codex-CLI path, it cannot silently emit unparseable prose. This
 * is the recommended production brain for a user-provided OPENAI_API_KEY:
 * headless, no interactive login.
 *
 * The model emits a compact per-type shape; we map it to full ActorOutputDraft
 * envelopes here (generating ids, applying payload defaults) so the model never
 * has to produce internal fields. Consequential tool calls are still gated by
 * Action Review downstream — the brain only *proposes*.
 */
const noReplyReasonSchema = z.enum([
  "nothing_to_add",
  "chat_busy",
  "not_my_moment",
  "reaction_would_be_too_much",
  "waiting_for_more_context",
  "cooldown",
  "blocked_by_policy",
  "other",
]);
const doneStatusSchema = z.enum([
  "completed",
  "waiting_approval",
  "blocked",
  "cancelled",
  "failed",
]);
const memoryScopeSchema = z.enum([
  "user",
  "group",
  "session",
  "project",
  "agent",
]);
const sensitivitySchema = z.enum(["low", "medium", "high"]);

// Compact, model-facing output shapes (a plain union → JSON-schema `anyOf`).
const modelOutputSchema = z.union([
  z.object({ type: z.literal("message"), text: z.string() }),
  z.object({
    type: z.literal("react_to_message"),
    targetEventId: z.string(),
    emoji: z.string(),
  }),
  z.object({ type: z.literal("no_reply"), reason: noReplyReasonSchema }),
  z.object({
    type: z.literal("tool_call"),
    toolName: z.string(),
    input: z.record(z.string(), z.unknown()),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("spawn_task_agent"),
    taskType: z.string(),
    goal: z.string(),
  }),
  z.object({
    type: z.literal("memory_candidate"),
    operation: z.enum(["create", "update", "forget"]),
    scope: memoryScopeSchema,
    text: z.string(),
    confidence: z.number(),
    sensitivity: sensitivitySchema,
    provenanceNote: z.string(),
  }),
  z.object({
    type: z.literal("run_summary"),
    summary: z.string(),
    decisions: z.array(z.string()),
  }),
  z.object({ type: z.literal("done"), status: doneStatusSchema }),
]);

const responseSchema = z.object({
  outputs: z.array(modelOutputSchema).min(1),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

export function toDraft(o: ModelOutput): ActorOutputDraft {
  switch (o.type) {
    case "message":
      return {
        type: "message",
        payload: {
          text: o.text,
          parseMode: "plain",
          style: "param_chat",
          visible: true,
        },
      };
    case "react_to_message":
      return {
        type: "react_to_message",
        payload: { targetEventId: o.targetEventId, emoji: o.emoji },
      };
    case "no_reply":
      return { type: "no_reply", payload: { reason: o.reason } };
    case "tool_call":
      return {
        type: "tool_call",
        payload: {
          toolCallId: randomUUID(),
          toolName: o.toolName,
          input: o.input as Record<string, never>,
          reason: o.reason,
        },
      };
    case "spawn_task_agent":
      return {
        type: "spawn_task_agent",
        payload: {
          taskType: o.taskType,
          goal: o.goal,
          reportTo: "session_actor",
        },
      };
    case "memory_candidate":
      return {
        type: "memory_candidate",
        payload: {
          candidateId: randomUUID(),
          operation: o.operation,
          scope: o.scope,
          text: o.text,
          confidence: Math.min(1, Math.max(0, o.confidence)),
          sensitivity: o.sensitivity,
          sourceEventIds: [],
          provenanceNote: o.provenanceNote,
        },
      };
    case "run_summary":
      return {
        type: "run_summary",
        payload: { summary: o.summary, decisions: o.decisions },
      };
    case "done":
      return { type: "done", payload: { status: o.status } };
  }
}

const SAFE_FALLBACK: ActorOutputDraft[] = [
  { type: "no_reply", payload: { reason: "nothing_to_add" } },
  { type: "done", payload: { status: "completed" } },
];

const OUTPUT_INSTRUCTION = [
  "Produce your Param outputs for this turn as a JSON object with an `outputs`",
  "array. Usually you just reply (message) or stay quiet (no_reply). When it",
  "genuinely helps, you may also: call a tool (tool_call — consequential ones",
  "are reviewed/approved by the system, so just propose it), spawn a task agent",
  "(spawn_task_agent), or propose a memory (memory_candidate). Use only what the",
  "moment needs, keep it natural, and always end the array with a done output.",
].join(" ");

export type OpenAiApiActorOptions = {
  apiKey?: string;
  model?: string;
  /** Injectable model, primarily for tests. */
  languageModel?: LanguageModel;
  timeoutMs?: number;
};

export class OpenAiApiActor implements ActorInference {
  readonly name = "openai";
  readonly description =
    "direct OpenAI API chat-brain (structured output via the AI SDK)";

  private readonly apiKey?: string;
  private readonly modelId: string;
  private readonly languageModel?: LanguageModel;
  private readonly timeoutMs: number;

  constructor(opts: OpenAiApiActorOptions = {}) {
    this.apiKey = opts.apiKey ?? Bun.env.OPENAI_API_KEY;
    // || not ??: an empty string (`PARAM_OPENAI_MODEL=` in .env) must fall
    // through to the default, not become the model id.
    this.modelId =
      opts.model?.trim() || Bun.env.PARAM_OPENAI_MODEL?.trim() || "gpt-4o-mini";
    this.languageModel = opts.languageModel;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  isAvailable(): boolean {
    return Boolean(this.languageModel ?? this.apiKey);
  }

  private resolveModel(): LanguageModel {
    if (this.languageModel) return this.languageModel;
    return createOpenAI({ apiKey: this.apiKey })(this.modelId);
  }

  async run(request: ActorInferenceRequest): Promise<ActorInferenceResult> {
    try {
      const { object } = await generateObject({
        model: this.resolveModel(),
        schema: responseSchema,
        // OpenAI strict structured-output mode rejects this schema (a union
        // emits `anyOf`/optional fields strict forbids). Non-strict json_schema
        // still guides the model and generateObject validates the result.
        providerOptions: { openai: { strictJsonSchema: false } },
        system: request.renderedPrompt,
        prompt: OUTPUT_INSTRUCTION,
        abortSignal: AbortSignal.timeout(this.timeoutMs),
      });
      const drafts = object.outputs.map(toDraft);
      return {
        drafts: drafts.length ? drafts : SAFE_FALLBACK,
        provider: "openai",
        raw: object,
      };
    } catch (error) {
      log.warn("openai actor failed; staying quiet", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { drafts: SAFE_FALLBACK, provider: "openai" };
    }
  }
}
