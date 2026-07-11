import { sql } from "drizzle-orm";

import type { ParamDb } from "../db/client";
import { memoryCandidates, memoryRecords } from "../db/schema";
import type {
  MemoryCandidatePayload,
  MemoryScope,
  MemorySensitivity,
  MemorySubjectRef,
} from "../contracts/memory";
import { logger } from "../observability/logger";
import { MEMORY_EMBEDDING_DIM } from "../db/schema/extended";
import type { MaybeEmbeddingProvider } from "./embeddings";

export type StoreMemoryInput = {
  scope: MemoryScope;
  subjectRef: MemorySubjectRef;
  text: string;
  provenanceNote: string;
  confidence: number;
  sensitivity: MemorySensitivity;
  sourceEventIds: string[];
  createdByRunId?: string | null;
};

/**
 * Store a durable memory record, maintain its full-text search vector, and —
 * when an embedding provider is supplied — its pgvector embedding for semantic
 * search. Embedding is best-effort: a provider failure stores the record
 * without a vector (keyword/FTS still work) rather than dropping the memory.
 */
export async function storeMemory(
  db: ParamDb,
  input: StoreMemoryInput,
  embedProvider?: MaybeEmbeddingProvider,
): Promise<{ id: string }> {
  let embedding: number[] | undefined;
  if (embedProvider) {
    try {
      const [vec] = await embedProvider.embed([input.text]);
      // Only store a vector whose width matches the fixed column, or the insert
      // would throw (pgvector dimension mismatch) and fail the whole run. A
      // mismatch (misconfigured model) degrades to no-vector, keeping FTS/keyword.
      if (vec && vec.length === MEMORY_EMBEDDING_DIM) {
        embedding = vec;
      } else if (vec && vec.length > 0) {
        logger.child("memory").warn("embedding dimension mismatch; storing without vector", {
          got: vec.length,
          expected: MEMORY_EMBEDDING_DIM,
        });
      }
    } catch (error) {
      logger.child("memory").warn("embed-on-write failed; storing without vector", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const [row] = await db
    .insert(memoryRecords)
    .values({
      scope: input.scope,
      subjectRef: input.subjectRef as Record<string, unknown>,
      text: input.text,
      normalizedText: input.text.toLowerCase(),
      provenanceNote: input.provenanceNote,
      confidence: input.confidence.toFixed(3),
      sensitivity: input.sensitivity,
      sourceEventIds: input.sourceEventIds,
      createdByRunId: input.createdByRunId ?? null,
      ...(embedding ? { embedding } : {}),
    })
    .returning({ id: memoryRecords.id });
  if (!row) {
    throw new Error("memory insert failed");
  }
  await db.execute(
    sql`update memory_records set search_vector = to_tsvector('english', ${input.text}) where id = ${row.id}::uuid`,
  );
  return row;
}

export async function storeCandidate(
  db: ParamDb,
  candidate: MemoryCandidatePayload,
  createdByRunId?: string | null,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(memoryCandidates)
    .values({
      operation: candidate.operation,
      scope: candidate.scope,
      subjectRef: (candidate.subjectRef ?? {}) as Record<string, unknown>,
      text: candidate.text,
      confidence: candidate.confidence.toFixed(3),
      sensitivity: candidate.sensitivity,
      sourceEventIds: candidate.sourceEventIds,
      provenanceNote: candidate.provenanceNote,
      status: "pending",
      createdByRunId: createdByRunId ?? null,
    })
    .returning({ id: memoryCandidates.id });
  if (!row) {
    throw new Error("memory candidate insert failed");
  }
  return row;
}

export async function markMemoryUsed(
  db: ParamDb,
  ids: string[],
  now = new Date(),
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await db
    .update(memoryRecords)
    .set({ lastUsedAt: now })
    .where(sql`${memoryRecords.id} = any(${ids}::uuid[])`);
}
