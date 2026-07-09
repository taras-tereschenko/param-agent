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
