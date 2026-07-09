import type { MemoryView } from "../contracts/memory";

export type RankableMemory = MemoryView & {
  /** Optional cosine similarity when an embedding provider ran. */
  similarity?: number;
};

/**
 * Rank retrieved memories by a blend of keyword overlap, semantic similarity
 * (when available), confidence, and recency. Keyword + scope retrieval works
 * without any embedding model; similarity only boosts when present.
 */
export function rankMemories(
  query: string,
  candidates: RankableMemory[],
  limit = 8,
): MemoryView[] {
  const queryTerms = tokenize(query);
  const scored = candidates.map((memory) => {
    const overlap = keywordOverlap(queryTerms, tokenize(memory.text));
    const similarity = memory.similarity ?? 0;
    const recency = recencyBoost(memory.updatedAt ?? memory.createdAt);
    const score =
      overlap * 2 + similarity * 3 + memory.confidence * 1 + recency * 0.5;
    return { memory, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => stripSimilarity(entry.memory));
}

export function keywordOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const setB = new Set(b);
  const hits = a.filter((term) => setB.has(term)).length;
  return hits / a.length;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function recencyBoost(iso?: string): number {
  if (!iso) return 0;
  const ageMs = Date.now() - new Date(iso).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);
  if (days < 1) return 1;
  if (days < 7) return 0.6;
  if (days < 30) return 0.3;
  return 0.1;
}

function stripSimilarity(memory: RankableMemory): MemoryView {
  const { similarity: _similarity, ...view } = memory;
  return view;
}
