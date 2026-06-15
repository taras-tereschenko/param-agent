import { sql } from "drizzle-orm";

import type { ParamDb } from "./client";

export const requiredDatabaseExtensions = [
  "pgcrypto",
  "vector",
] as const;

export type RequiredDatabaseExtension =
  (typeof requiredDatabaseExtensions)[number];

export async function ensureDatabaseExtensions(db: ParamDb): Promise<void> {
  await db.execute(sql`create extension if not exists pgcrypto`);
  await db.execute(sql`create extension if not exists vector`);
}

export async function listMissingDatabaseExtensions(
  db: ParamDb,
): Promise<RequiredDatabaseExtension[]> {
  const rows = await db.execute<{ extname: RequiredDatabaseExtension }>(sql`
    select extname
    from pg_extension
    where extname in ('pgcrypto', 'vector')
  `);
  const installed = new Set(rows.map((row) => row.extname));

  return requiredDatabaseExtensions.filter(
    (extension) => !installed.has(extension),
  );
}

export async function checkDatabaseConnection(db: ParamDb): Promise<void> {
  await db.execute(sql`select 1`);
}
