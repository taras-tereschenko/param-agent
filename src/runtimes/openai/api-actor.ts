import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

import type {
  ActorInference,
  ActorInferenceRequest,
  ActorInferenceResult,
} from "../../actor/inference";
import type { ActorOutputDraft } from "../../contracts/actor-output";
import {
  doneOutputPayloadSchema,
  messageOutputPayloadSchema,
  noReplyOutputPayloadSchema,
  reactToMessageOutputPayloadSchema,
} from "../../contracts/actor-output";
import { logger } from "../../observability/logger";

const log = logger.child("openai-actor");

/**
 * Direct OpenAI API chat-brain via the AI SDK.
 *
 * Unlike the codex-CLI path (which parses free-form stdout and silently stays
 * quiet when the model doesn't emit a bare JSON array), this uses
 * `generateObject` so the provider ENFORCES the output schema — the free-form
 * failure mode is eliminated. This is the recommended production brain for a
 * user-provided OPENAI_API_KEY: headless, no interactive login.
 *
 * Scope: the conversational output subset (message / react / no_reply / done).
 * Heavier outputs (tools, task agents, UI) are intentionally out of scope for
 * this first API brain and remain available via the codex path.
 */
const chatDraftSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), payload: messageOutputPayloadSchema }),
  z.object({
    type: z.literal("react_to_message"),
    payload: reactToMessageOutputPayloadSchema,
  }),
  z.object({
    type: z.literal("no_reply"),
    payload: noReplyOutputPayloadSchema,
  }),
  z.object({ type: z.literal("done"), payload: doneOutputPayloadSchema }),
]);

const responseSchema = z.object({
  outputs: z.array(chatDraftSchema).min(1),
});

const SAFE_FALLBACK: ActorOutputDraft[] = [
  { type: "no_reply", payload: { reason: "nothing_to_add" } },
  { type: "done", payload: { status: "completed" } },
];

const OUTPUT_INSTRUCTION = [
  "Produce your Param outputs for this turn as a JSON object with an",
  '`outputs` array. Each element is {"type", "payload"} using only the allowed',
  "output types (message / react_to_message / no_reply / done). If you should",
  'stay quiet, return a single no_reply. Always end with a done output.',
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
    this.modelId = opts.model ?? Bun.env.PARAM_OPENAI_MODEL ?? "gpt-4o-mini";
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
        system: request.renderedPrompt,
        prompt: OUTPUT_INSTRUCTION,
        abortSignal: AbortSignal.timeout(this.timeoutMs),
      });
      const drafts = object.outputs as ActorOutputDraft[];
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
