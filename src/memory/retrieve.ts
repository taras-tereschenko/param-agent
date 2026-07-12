import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";

import type { ParamDb } from "../db/client";
import { memoryRecords } from "../db/schema";
import type { MemoryScope, MemorySubjectRef, MemoryView } from "../contracts/memory";
import { logger } from "../observability/logger";
import { MEMORY_EMBEDDING_DIM } from "../db/schema/extended";
import type { MaybeEmbeddingProvider } from "./embeddings";
import { rankMemories, type RankableMemory } from "./rank";
import {
  buildRetrievalScopeFilters,
  recordMatchesFilters,
  type MemoryRetrievalContext,
} from "./scopes";
import { markMemoryUsed } from "./store";

export type StoredMemoryLike = {
  id: string;
  scope: MemoryScope | string;
  subjectRef: MemorySubjectRef;
  status: string;
  text: string;
  confidence: number;
  sensitivity: "low" | "medium" | "high";
  provenanceNote: string;
  createdAt: string;
  updatedAt?: string;
  /** Cosine similarity to the query (0..1) when a pgvector search ran. */
  similarity?: number;
};

/**
 * Pure scoped selection + ranking. Enforces scope isolation (group memory never
 * surfaces in a DM; private user memory never surfaces in a group) then ranks
 * by keyword/confidence/recency. Testable without a database.
 */
export function selectMemories(
  records: StoredMemoryLike[],
  ctx: MemoryRetrievalContext,
  query: string,
  limit = 8,
): MemoryView[] {
  const filters = buildRetrievalScopeFilters(ctx);
  const matched = records.filter((record) =>
    recordMatchesFilters(
      { scope: record.scope, subjectRef: record.subjectRef, status: record.status },
      filters,
    ),
  );
  const candidates: RankableMemory[] = matched.map(toView);
  return rankMemories(query, candidates, limit);
}

/**
 * Bound on how many scoped rows we pull into memory to rank. A single subject
 * (user/group/session) rarely has this many memories; the cap is a safety valve
 * so a pathological subject cannot pull an unbounded set into the process. We
 * fetch the most-recent rows within the subject scope, then rank.
 */
const MAX_SCOPED_FETCH = 200;

/** Retrieve scoped, ranked memory for a session and mark the used records. */
export async function retrieveMemories(
  db: ParamDb,
  ctx: MemoryRetrievalContext,
  query: string,
  limit = 8,
  provider?: MaybeEmbeddingProvider,
): Promise<MemoryView[]> {
  // Drop any filter whose subjectRef has no truthy identifying value: an empty
  // `{}` would make `subject_ref @> '{}'` match EVERY row (all scopes/all
  // users). Not reachable today (ids are always set) but a hard guard against a
  // future caller producing an empty subjectRef.
  const filters = buildRetrievalScopeFilters(ctx).filter((filter) =>
    Object.values(filter.subjectRef).some(
      (v) => typeof v === "string" && v.length > 0,
    ),
  );
  if (filters.length === 0) {
    return [];
  }
  // Push the (scope, subject_ref) allow-list into SQL as a containment OR so we
  // fetch ONLY this session's/user's/group's rows — not every subject's rows in
  // the scope (which would load all users' private memory into the process).
  // The subject_ref GIN index (jsonb_path_ops) serves the @> containment. The
  // in-memory selectMemories() below is still the authoritative isolation gate.
  const scopeConditions: SQL[] = filters.map((filter) =>
    and(
      eq(memoryRecords.scope, filter.scope),
      sql`${memoryRecords.subjectRef} @> ${JSON.stringify(filter.subjectRef)}::jsonb`,
    ),
  ) as SQL[];

  // Semantic search: when an embedding provider is configured, embed the query
  // and let pgvector rank by cosine distance (nulls — rows without an embedding
  // — sort last). Best-effort: an embed failure falls back to recency ordering
  // + keyword ranking, never breaks retrieval.
  let vecLiteral: string | undefined;
  if (provider && query.trim().length > 0) {
    try {
      const [vec] = await provider.embed([query]);
      // Match the column width or skip vector search (keyword fallback) — a
      // mismatched vector would error in the `<=>` distance operator.
      if (vec && vec.length === MEMORY_EMBEDDING_DIM) {
        vecLiteral = `[${vec.join(",")}]`;
      } else if (vec && vec.length > 0) {
        logger.child("memory").warn("query embedding dimension mismatch; keyword fallback", {
          got: vec.length,
          expected: MEMORY_EMBEDDING_DIM,
        });
      }
    } catch (error) {
      logger.child("memory").warn("query embed failed; keyword fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const similarityExpr = vecLiteral
    ? sql<
        number | null
      >`1 - (${memoryRecords.embedding} <=> ${vecLiteral}::vector)`
    : sql<number | null>`null`;

  const rows = await db
    .select({
      id: memoryRecords.id,
      scope: memoryRecords.scope,
      subjectRef: memoryRecords.subjectRef,
      status: memoryRecords.status,
      text: memoryRecords.text,
      confidence: memoryRecords.confidence,
      sensitivity: memoryRecords.sensitivity,
      provenanceNote: memoryRecords.provenanceNote,
      createdAt: memoryRecords.createdAt,
      updatedAt: memoryRecords.updatedAt,
      similarity: similarityExpr,
    })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.status, "active"), or(...scopeConditions)))
    .orderBy(
      vecLiteral
        ? sql`${memoryRecords.embedding} <=> ${vecLiteral}::vector`
        : desc(memoryRecords.updatedAt),
    )
    .limit(MAX_SCOPED_FETCH);

  const records: StoredMemoryLike[] = rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    subjectRef: (row.subjectRef ?? {}) as MemorySubjectRef,
    status: row.status,
    text: row.text,
    confidence: Number(row.confidence),
    sensitivity: row.sensitivity as "low" | "medium" | "high",
    provenanceNote: row.provenanceNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
    similarity: row.similarity == null ? undefined : Number(row.similarity),
  }));

  const ranked = selectMemories(records, ctx, query, limit);
  await markMemoryUsed(db, ranked.map((view) => view.id));
  return ranked;
}

function toView(record: StoredMemoryLike): RankableMemory {
  return {
    id: record.id,
    scope: record.scope as MemoryScope,
    subject: subjectLabel(record.subjectRef),
    text: record.text,
    confidence: record.confidence,
    sensitivity: record.sensitivity,
    provenanceNote: record.provenanceNote,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    similarity: record.similarity,
  };
}

function subjectLabel(ref: MemorySubjectRef): string | undefined {
  return (
    ref.paramUserId ??
    ref.groupChatId ??
    ref.projectId ??
    ref.agentType ??
    undefined
  );
}
