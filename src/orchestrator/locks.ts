import { sql } from "drizzle-orm";

import type { ParamDb } from "../db/client";
import { advisoryLockKey } from "../shared/locks";

/**
 * Run `fn` while holding a Postgres transaction-scoped advisory lock for the
 * session. This serializes work per session (e.g. flushing a batch into a run)
 * without a dedicated lock table. The lock is released when the transaction
 * commits or rolls back.
 */
export async function withSessionLock<T>(
  db: ParamDb,
  sessionId: string,
  fn: (tx: ParamDb) => Promise<T>,
): Promise<T> {
  const key = advisoryLockKey("session", sessionId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${key})`);
    return fn(tx as unknown as ParamDb);
  });
}

/**
 * Try to acquire a session advisory lock without blocking. Returns true when
 * acquired. Must be called inside a transaction; the lock releases on commit.
 */
export async function trySessionLock(
  tx: ParamDb,
  sessionId: string,
): Promise<boolean> {
  const key = advisoryLockKey("session", sessionId);
  const rows = await tx.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(${key}) as locked`,
  );
  return rows[0]?.locked === true;
}
