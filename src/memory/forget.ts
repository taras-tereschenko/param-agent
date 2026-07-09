import { eq } from "drizzle-orm";

import type { ParamDb } from "../db/client";
import { memoryRecords } from "../db/schema";

/** Soft-forget a memory record (status -> forgotten). Never hard-deletes. */
export async function forgetMemory(
  db: ParamDb,
  id: string,
  now = new Date(),
): Promise<void> {
  await db
    .update(memoryRecords)
    .set({ status: "forgotten", updatedAt: now })
    .where(eq(memoryRecords.id, id));
}

/** Mark a memory superseded by a newer record. */
export async function supersedeMemory(
  db: ParamDb,
  id: string,
  now = new Date(),
): Promise<void> {
  await db
    .update(memoryRecords)
    .set({ status: "superseded", updatedAt: now })
    .where(eq(memoryRecords.id, id));
}
