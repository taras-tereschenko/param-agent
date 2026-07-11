import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";

import type { ParamConfig } from "../config/schema";
import { logger } from "../observability/logger";

/**
 * Embedding provider seam. Semantic memory search uses pgvector when a provider
 * is configured; retrieval still works (keyword + scope) when none is present.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** No embedding provider configured — retrieval falls back to keyword + scope. */
export const noEmbeddingProvider = null;

export type MaybeEmbeddingProvider = EmbeddingProvider | null;

/**
 * OpenAI embedding provider (AI SDK `embedMany`). Used to embed memory text on
 * write and the query at retrieval time so pgvector cosine search can rank by
 * meaning, not just keyword overlap.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly dimensions: number;
  private readonly model: ReturnType<
    ReturnType<typeof createOpenAI>["textEmbeddingModel"]
  >;

  constructor(opts: {
    apiKey: string;
    model?: string;
    dimensions?: number;
    baseURL?: string;
  }) {
    const openai = createOpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = openai.textEmbeddingModel(
      opts.model ?? "text-embedding-3-small",
    );
    this.dimensions = opts.dimensions ?? 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const { embeddings } = await embedMany({ model: this.model, values: texts });
    return embeddings;
  }
}

/**
 * Resolve the embedding provider from config + env. Returns null (keyword-only
 * retrieval) when memory embeddings are disabled or no OpenAI key is present —
 * never throws, so a missing key degrades gracefully instead of breaking a turn.
 */
export function resolveEmbeddingProvider(
  config: ParamConfig,
  env: Record<string, string | undefined> = Bun.env,
): MaybeEmbeddingProvider {
  const memory = config.memory;
  if (!memory || !memory.enabled) {
    return null;
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    logger
      .child("memory")
      .info("no OPENAI_API_KEY; semantic memory falls back to keyword search");
    return null;
  }
  return new OpenAiEmbeddingProvider({
    apiKey,
    model: memory.embeddingModel,
    dimensions: memory.embeddingDimensions,
    baseURL: env.OPENAI_BASE_URL?.trim() || undefined,
  });
}

export function hasEmbeddings(
  provider: MaybeEmbeddingProvider,
): provider is EmbeddingProvider {
  return provider !== null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
