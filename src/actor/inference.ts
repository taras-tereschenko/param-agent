import type { ActorOutputDraft } from "../contracts/actor-output";
import type { PromptPacket, PromptRunType } from "../contracts/prompt";

/** Lightweight view of the latest context for rule-based / mock actors. */
export type LatestContext = {
  text?: string;
  fromDisplayName?: string;
  mentionsParam?: boolean;
  repliesToParam?: boolean;
  isDirectMessage?: boolean;
  isGroupMessage?: boolean;
  latestEventId?: string;
};

export type ActorInferenceRequest = {
  promptPacket: PromptPacket;
  renderedPrompt: string;
  runType: PromptRunType;
  allowedOutputs: string[];
  latest?: LatestContext;
  steering?: { priority: string; text?: string }[];
};

export type ActorInferenceUsage = {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

export type ActorInferenceResult = {
  drafts: ActorOutputDraft[];
  /** Raw provider output (redacted upstream) stored for audit. */
  raw?: unknown;
  usage?: ActorInferenceUsage;
  provider: string;
};

/**
 * The Session Actor inference boundary. Runtime adapters (Codex chat-brain when
 * proven), model providers, or the deterministic MockActor implement this. Param
 * core never assumes a specific provider — the path is proven and documented
 * separately (see docs/CODEX_CHAT_BRAIN_PROOF.md).
 */
export interface ActorInference {
  readonly name: string;
  readonly description: string;
  isAvailable(): Promise<boolean> | boolean;
  run(request: ActorInferenceRequest): Promise<ActorInferenceResult>;
}
