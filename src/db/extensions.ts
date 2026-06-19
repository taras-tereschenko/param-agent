import { sql } from "drizzle-orm";

import type { ParamDb } from "./client";

export const requiredDatabaseExtensions = [
  "pgcrypto",
  "vector",
] as const;

export const coreDatabaseTables = [
  "users",
  "user_accounts",
  "trusted_users",
  "channel_accounts",
  "platform_chats",
  "sessions",
  "session_participants",
  "events",
  "raw_payloads",
  "actor_runs",
  "actor_outputs",
  "delivery_attempts",
  "jobs",
  "audit_log",
] as const;

export const coreDatabaseIndexes = [
  "actor_runs_one_active_per_session_idx",
  "events_dedupe_key_unique",
  "jobs_idempotency_key_unique",
  "platform_chats_route_unique",
  "sessions_session_key_unique",
] as const;

export const coreDatabaseConstraints = [
  "actor_runs_status_check",
  "events_direction_check",
  "events_visibility_check",
  "jobs_status_check",
  "jobs_attempt_count_check",
  "jobs_max_attempts_check",
  "sessions_status_check",
] as const;

export type RequiredDatabaseExtension =
  (typeof requiredDatabaseExtensions)[number];
export type CoreDatabaseTable = (typeof coreDatabaseTables)[number];
export type CoreDatabaseIndex = (typeof coreDatabaseIndexes)[number];
export type CoreDatabaseConstraint = (typeof coreDatabaseConstraints)[number];

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

export async function listMissingCoreDatabaseTables(
  db: ParamDb,
): Promise<CoreDatabaseTable[]> {
  const rows = await db.execute<{ table_name: CoreDatabaseTable }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'users',
        'user_accounts',
        'trusted_users',
        'channel_accounts',
        'platform_chats',
        'sessions',
        'session_participants',
        'events',
        'raw_payloads',
        'actor_runs',
        'actor_outputs',
        'delivery_attempts',
        'jobs',
        'audit_log'
      )
  `);
  const existing = new Set(rows.map((row) => row.table_name));

  return coreDatabaseTables.filter((table) => !existing.has(table));
}

export async function listMissingCoreDatabaseIndexes(
  db: ParamDb,
): Promise<CoreDatabaseIndex[]> {
  const rows = await db.execute<{ indexname: CoreDatabaseIndex }>(sql`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'actor_runs_one_active_per_session_idx',
        'events_dedupe_key_unique',
        'jobs_idempotency_key_unique',
        'platform_chats_route_unique',
        'sessions_session_key_unique'
      )
  `);
  const existing = new Set(rows.map((row) => row.indexname));

  return coreDatabaseIndexes.filter((index) => !existing.has(index));
}

export async function listMissingCoreDatabaseConstraints(
  db: ParamDb,
): Promise<CoreDatabaseConstraint[]> {
  const rows = await db.execute<{
    constraint_name: CoreDatabaseConstraint;
  }>(sql`
    select constraint_name
    from information_schema.table_constraints
    where table_schema = 'public'
      and constraint_name in (
        'actor_runs_status_check',
        'events_direction_check',
        'events_visibility_check',
        'jobs_status_check',
        'jobs_attempt_count_check',
        'jobs_max_attempts_check',
        'sessions_status_check'
      )
  `);
  const existing = new Set(rows.map((row) => row.constraint_name));

  return coreDatabaseConstraints.filter(
    (constraint) => !existing.has(constraint),
  );
}
