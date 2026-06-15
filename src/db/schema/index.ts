import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export type JsonObject = Record<string, unknown>;

export const jobStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type JobStatus = (typeof jobStatuses)[number];

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz("created_at").notNull().defaultNow();
const updatedAt = () => timestamptz("updated_at").notNull().defaultNow();
const jsonObject = (name: string) => jsonb(name).$type<JsonObject>();

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  displayName: text("display_name"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userAccounts = pgTable(
  "user_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    platformUserId: text("platform_user_id").notNull(),
    username: text("username"),
    displayName: text("display_name"),
    isBot: boolean("is_bot").notNull().default(false),
    firstSeenAt: timestamptz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    rawProfile: jsonObject("raw_profile"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("user_accounts_platform_user_unique").on(
      table.platform,
      table.platformUserId,
    ),
    index("user_accounts_user_id_idx").on(table.userId),
  ],
);

export const trustedUsers = pgTable(
  "trusted_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    platformUserId: text("platform_user_id").notNull(),
    trustScope: text("trust_scope").notNull(),
    scopeRef: jsonObject("scope_ref"),
    status: text("status").notNull().default("active"),
    addedByUserId: uuid("added_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    addedAt: timestamptz("added_at").notNull().defaultNow(),
    revokedAt: timestamptz("revoked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "trusted_users_trust_scope_check",
      sql`${table.trustScope} in ('global', 'chat', 'project', 'server_admin')`,
    ),
    check(
      "trusted_users_status_check",
      sql`${table.status} in ('active', 'revoked')`,
    ),
    index("trusted_users_platform_user_idx").on(
      table.platform,
      table.platformUserId,
    ),
    index("trusted_users_user_id_idx").on(table.userId),
    index("trusted_users_status_idx").on(table.status),
  ],
);

export const channelAccounts = pgTable(
  "channel_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    platform: text("platform").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull().default("active"),
    config: jsonObject("config").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("channel_accounts_platform_label_unique").on(
      table.platform,
      table.label,
    ),
    check(
      "channel_accounts_status_check",
      sql`${table.status} in ('active', 'disabled')`,
    ),
    index("channel_accounts_status_idx").on(table.status),
  ],
);

export const platformChats = pgTable(
  "platform_chats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    platform: text("platform").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "cascade" }),
    platformChatId: text("platform_chat_id").notNull(),
    chatType: text("chat_type").notNull(),
    title: text("title"),
    messageThreadId: text("message_thread_id"),
    rawChat: jsonObject("raw_chat"),
    firstSeenAt: timestamptz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("platform_chats_route_unique").on(
      table.platform,
      table.accountId,
      table.platformChatId,
      sql`coalesce(${table.messageThreadId}, '')`,
    ),
    index("platform_chats_account_idx").on(table.accountId),
    index("platform_chats_platform_chat_idx").on(
      table.platform,
      table.platformChatId,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionKey: text("session_key").notNull(),
    platform: text("platform").notNull(),
    routeType: text("route_type").notNull(),
    platformChatId: text("platform_chat_id").notNull(),
    messageThreadId: text("message_thread_id"),
    parentSessionId: uuid("parent_session_id").references(
      (): AnyPgColumn => sessions.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("active"),
    policyId: text("policy_id"),
    summaryCheckpointId: uuid("summary_checkpoint_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastEventAt: timestamptz("last_event_at"),
    lastActorRunId: uuid("last_actor_run_id"),
    activeRunId: uuid("active_run_id"),
    lastEventIdSeenByActor: uuid("last_event_id_seen_by_actor"),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    uniqueIndex("sessions_session_key_unique").on(table.sessionKey),
    check(
      "sessions_status_check",
      sql`${table.status} in ('active', 'archived', 'blocked')`,
    ),
    index("sessions_status_idx").on(table.status),
    index("sessions_parent_session_id_idx").on(table.parentSessionId),
    index("sessions_last_event_at_idx").on(sql`${table.lastEventAt} desc`),
  ],
);

export const sessionParticipants = pgTable(
  "session_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    platformUserId: text("platform_user_id").notNull(),
    role: text("role").notNull().default("member"),
    firstSeenAt: timestamptz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("session_participants_session_platform_user_unique").on(
      table.sessionId,
      table.platformUserId,
    ),
    index("session_participants_session_id_idx").on(table.sessionId),
    index("session_participants_user_id_idx").on(table.userId),
  ],
);

export const rawPayloads = pgTable(
  "raw_payloads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    hash: text("hash"),
    storage: text("storage").notNull(),
    ref: text("ref"),
    json: jsonObject("json"),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "raw_payloads_storage_check",
      sql`${table.storage} in ('inline', 'object_store', 'file', 'database')`,
    ),
    index("raw_payloads_provider_kind_idx").on(table.provider, table.kind),
    index("raw_payloads_hash_idx").on(table.hash),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schemaVersion: integer("schema_version").notNull().default(1),
    type: text("type").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    direction: text("direction").notNull(),
    visibility: text("visibility").notNull(),
    occurredAt: timestamptz("occurred_at").notNull(),
    receivedAt: timestamptz("received_at"),
    persistedAt: timestamptz("persisted_at").notNull().defaultNow(),
    source: jsonObject("source").notNull(),
    platform: jsonObject("platform"),
    dedupeKey: text("dedupe_key").notNull(),
    correlationId: uuid("correlation_id"),
    parentEventId: uuid("parent_event_id").references(
      (): AnyPgColumn => events.id,
      { onDelete: "restrict" },
    ),
    rootEventId: uuid("root_event_id").references(
      (): AnyPgColumn => events.id,
      { onDelete: "restrict" },
    ),
    actorRunId: uuid("actor_run_id"),
    jobId: uuid("job_id"),
    approvalId: uuid("approval_id"),
    payload: jsonObject("payload").notNull().default(sql`'{}'::jsonb`),
    raw: jsonObject("raw"),
  },
  (table) => [
    uniqueIndex("events_dedupe_key_unique").on(table.dedupeKey),
    check(
      "events_direction_check",
      sql`${table.direction} in ('inbound', 'outbound', 'internal')`,
    ),
    check(
      "events_visibility_check",
      sql`${table.visibility} in ('chat_visible', 'internal', 'admin')`,
    ),
    index("events_session_occurred_at_idx").on(
      table.sessionId,
      sql`${table.occurredAt} desc`,
    ),
    index("events_session_id_idx").on(table.sessionId, table.id),
    index("events_type_occurred_at_idx").on(
      table.type,
      sql`${table.occurredAt} desc`,
    ),
    index("events_actor_run_id_idx").on(table.actorRunId),
    index("events_job_id_idx").on(table.jobId),
    index("events_approval_id_idx").on(table.approvalId),
    index("events_correlation_id_idx").on(table.correlationId),
  ],
);

export const actorRuns = pgTable(
  "actor_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    triggerEventId: uuid("trigger_event_id").references(() => events.id, {
      onDelete: "restrict",
    }),
    runType: text("run_type").notNull(),
    status: text("status").notNull().default("queued"),
    runtime: text("runtime").notNull(),
    model: text("model"),
    startedAt: timestamptz("started_at"),
    completedAt: timestamptz("completed_at"),
    lastHeartbeatAt: timestamptz("last_heartbeat_at"),
    lockOwner: text("lock_owner"),
    lockExpiresAt: timestamptz("lock_expires_at"),
    lastConsumedEventId: uuid("last_consumed_event_id").references(
      () => events.id,
      { onDelete: "restrict" },
    ),
    promptSnapshotRef: text("prompt_snapshot_ref"),
    contextSnapshotRef: text("context_snapshot_ref"),
    error: jsonObject("error"),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "actor_runs_status_check",
      sql`${table.status} in ('queued', 'building_context', 'running', 'waiting_tool', 'waiting_approval', 'compacting', 'completed', 'failed', 'cancelled', 'interrupted')`,
    ),
    uniqueIndex("actor_runs_one_active_per_session_idx")
      .on(table.sessionId)
      .where(
        sql`${table.status} in ('queued', 'building_context', 'running', 'waiting_tool', 'waiting_approval', 'compacting')`,
      ),
    index("actor_runs_session_created_at_idx").on(
      table.sessionId,
      sql`${table.createdAt} desc`,
    ),
    index("actor_runs_status_idx").on(table.status),
    index("actor_runs_lock_expires_at_idx").on(table.lockExpiresAt),
  ],
);

export const actorOutputs = pgTable(
  "actor_outputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schemaVersion: integer("schema_version").notNull().default(1),
    type: text("type").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    actorRunId: uuid("actor_run_id")
      .notNull()
      .references(() => actorRuns.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    createdAt: createdAt(),
    causedByEventIds: text("caused_by_event_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonObject("payload").notNull().default(sql`'{}'::jsonb`),
    validationStatus: text("validation_status").notNull().default("pending"),
    validationError: jsonObject("validation_error"),
    deliveryStatus: text("delivery_status").notNull().default("pending"),
  },
  (table) => [
    uniqueIndex("actor_outputs_run_sequence_unique").on(
      table.actorRunId,
      table.sequence,
    ),
    uniqueIndex("actor_outputs_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    check(
      "actor_outputs_validation_status_check",
      sql`${table.validationStatus} in ('pending', 'valid', 'invalid')`,
    ),
    check(
      "actor_outputs_delivery_status_check",
      sql`${table.deliveryStatus} in ('pending', 'not_applicable', 'running', 'succeeded', 'failed')`,
    ),
    index("actor_outputs_session_created_at_idx").on(
      table.sessionId,
      sql`${table.createdAt} desc`,
    ),
    index("actor_outputs_run_sequence_idx").on(table.actorRunId, table.sequence),
    index("actor_outputs_type_idx").on(table.type),
    index("actor_outputs_delivery_status_idx").on(table.deliveryStatus),
  ],
);

export const deliveryAttempts = pgTable(
  "delivery_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outputId: uuid("output_id")
      .notNull()
      .references(() => actorOutputs.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    platform: text("platform").notNull(),
    adapter: text("adapter").notNull(),
    target: jsonObject("target").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull(),
    platformMessageId: text("platform_message_id"),
    error: jsonObject("error"),
    startedAt: timestamptz("started_at"),
    completedAt: timestamptz("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("delivery_attempts_output_target_attempt_unique").on(
      table.outputId,
      table.platform,
      table.adapter,
      table.attempt,
    ),
    check(
      "delivery_attempts_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed')`,
    ),
    index("delivery_attempts_session_id_idx").on(table.sessionId),
    index("delivery_attempts_output_id_idx").on(table.outputId),
    index("delivery_attempts_status_idx").on(table.status),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    payload: jsonObject("payload").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    dueAt: timestamptz("due_at").notNull().defaultNow(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockOwner: text("lock_owner"),
    lockExpiresAt: timestamptz("lock_expires_at"),
    lastError: jsonObject("last_error"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    check(
      "jobs_status_check",
      sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'cancelled')`,
    ),
    check("jobs_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check("jobs_max_attempts_check", sql`${table.maxAttempts} > 0`),
    uniqueIndex("jobs_idempotency_key_unique")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("jobs_claim_idx").on(
      table.status,
      table.dueAt,
      sql`${table.priority} desc`,
    ),
    index("jobs_lock_expires_at_idx").on(table.lockExpiresAt),
    index("jobs_type_status_idx").on(table.type, table.status),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: text("event_type").notNull(),
    actor: jsonObject("actor").notNull().default(sql`'{}'::jsonb`),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "restrict",
    }),
    eventId: uuid("event_id").references(() => events.id, {
      onDelete: "restrict",
    }),
    actorRunId: uuid("actor_run_id").references(() => actorRuns.id, {
      onDelete: "restrict",
    }),
    approvalId: uuid("approval_id"),
    toolCallId: uuid("tool_call_id"),
    target: jsonObject("target"),
    summary: text("summary").notNull(),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_log_event_type_idx").on(table.eventType),
    index("audit_log_session_id_idx").on(table.sessionId),
    index("audit_log_event_id_idx").on(table.eventId),
    index("audit_log_actor_run_id_idx").on(table.actorRunId),
    index("audit_log_approval_id_idx").on(table.approvalId),
    index("audit_log_created_at_idx").on(sql`${table.createdAt} desc`),
  ],
);

export const schema = {
  users,
  userAccounts,
  trustedUsers,
  channelAccounts,
  platformChats,
  sessions,
  sessionParticipants,
  rawPayloads,
  events,
  actorRuns,
  actorOutputs,
  deliveryAttempts,
  jobs,
  auditLog,
};

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type RawPayload = typeof rawPayloads.$inferSelect;
export type NewRawPayload = typeof rawPayloads.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
