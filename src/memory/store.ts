import { sql } from "drizzle-orm";

import type { ParamDb } from "../db/client";
import { memoryCandidates, memoryRecords } from "../db/schema";
import type {
  MemoryCandidatePayload,
  MemoryScope,
  MemorySensitivity,
  MemorySubjectRef,
} from "../contracts/memory";

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

/** Store a durable memory record and maintain its full-text search vector. */
export async function storeMemory(
  db: ParamDb,
  input: StoreMemoryInput,
): Promise<{ id: string }> {
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
    .where(sql`${memoryRecords.id} = any(${ids})`);
}
