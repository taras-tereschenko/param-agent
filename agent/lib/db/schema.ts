import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const paramProfiles = pgTable("param_profiles", {
  principalId: text("principal_id").primaryKey(),
  displayName: text("display_name"),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en"),
  bio: text("bio").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paramMemories = pgTable(
  "param_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalId: text("principal_id")
      .notNull()
      .references(() => paramProfiles.principalId, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("principal"),
    category: text("category").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull().default("agent"),
    confidence: real("confidence").notNull().default(1),
    provenance: text("provenance"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("param_memories_principal_scope_category_unique").on(
      table.principalId,
      table.scope,
      table.category,
    ),
    index("param_memories_principal_scope_idx").on(table.principalId, table.scope),
    index("param_memories_principal_category_idx").on(table.principalId, table.category),
  ],
);

export type ParamProfile = typeof paramProfiles.$inferSelect;
export type NewParamProfile = typeof paramProfiles.$inferInsert;
export type ParamMemory = typeof paramMemories.$inferSelect;
export type NewParamMemory = typeof paramMemories.$inferInsert;

export const paramActionReviews = pgTable(
  "param_action_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: text("request_id").notNull(),
    callId: text("call_id").notNull(),
    sessionId: text("session_id").notNull(),
    turnId: text("turn_id").notNull(),
    turnSequence: integer("turn_sequence"),
    stepIndex: integer("step_index").notNull(),
    sequence: integer("sequence").notNull(),
    channel: text("channel").notNull().default("telegram"),
    chatId: text("chat_id"),
    chatType: text("chat_type"),
    conversationId: text("conversation_id"),
    messageThreadId: text("message_thread_id"),
    requesterPrincipalId: text("requester_principal_id"),
    requesterPrincipalType: text("requester_principal_type"),
    requesterTelegramUserId: text("requester_telegram_user_id"),
    approverPrincipalId: text("approver_principal_id"),
    approverPrincipalType: text("approver_principal_type"),
    approverTelegramUserId: text("approver_telegram_user_id"),
    toolName: text("tool_name").notNull(),
    actionKind: text("action_kind").notNull(),
    proposalHash: text("proposal_hash").notNull(),
    proposal: jsonb("proposal")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("requested"),
    resultStatus: text("result_status"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: jsonb("error").$type<Record<string, unknown>>(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("param_action_reviews_request_id_unique").on(table.requestId),
    uniqueIndex("param_action_reviews_call_id_unique").on(table.callId),
    index("param_action_reviews_session_turn_idx").on(table.sessionId, table.turnId),
    index("param_action_reviews_status_requested_idx").on(table.status, table.requestedAt),
    index("param_action_reviews_proposal_hash_idx").on(table.proposalHash),
    check(
      "param_action_reviews_status_check",
      sql`${table.status} in ('requested', 'completed', 'failed', 'rejected')`,
    ),
  ],
);

export type ParamActionReview = typeof paramActionReviews.$inferSelect;
export type NewParamActionReview = typeof paramActionReviews.$inferInsert;
