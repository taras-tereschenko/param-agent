import { and, eq, inArray } from "drizzle-orm";

import type { ParamDb } from "../db/client";
import { memoryRecords } from "../db/schema";
import type { MemoryScope, MemorySubjectRef, MemoryView } from "../contracts/memory";
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

/** Retrieve scoped, ranked memory for a session and mark the used records. */
export async function retrieveMemories(
  db: ParamDb,
  ctx: MemoryRetrievalContext,
  query: string,
  limit = 8,
): Promise<MemoryView[]> {
  const filters = buildRetrievalScopeFilters(ctx);
  if (filters.length === 0) {
    return [];
  }
  const scopes = [...new Set(filters.map((f) => f.scope))];
  const rows = await db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.status, "active"),
        inArray(memoryRecords.scope, scopes),
      ),
    );

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
