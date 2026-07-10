import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import {
  actorOutputs,
  actorRuns,
  events,
  sessions,
  users,
  type JsonObject,
} from "./index";

/** Default embedding dimension. Change requires a migration + reindex. */
export const MEMORY_EMBEDDING_DIM = 1536;

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz("created_at").notNull().defaultNow();
const updatedAt = () => timestamptz("updated_at").notNull().defaultNow();
const jsonObject = (name: string) => jsonb(name).$type<JsonObject>();

/** Postgres full-text search column. Managed by explicit SQL indexing. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/* -------------------------------------------------------------------------- */
/* Memory                                                                     */
/* -------------------------------------------------------------------------- */

export const memoryRecords = pgTable(
  "memory_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: text("scope").notNull(),
    subjectRef: jsonObject("subject_ref").notNull().default(sql`'{}'::jsonb`),
    text: text("text").notNull(),
    normalizedText: text("normalized_text"),
    provenanceNote: text("provenance_note").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    sensitivity: text("sensitivity").notNull().default("low"),
    status: text("status").notNull().default("active"),
    sourceEventIds: text("source_event_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdByRunId: uuid("created_by_run_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastUsedAt: timestamptz("last_used_at"),
    expiresAt: timestamptz("expires_at"),
    embedding: vector("embedding", { dimensions: MEMORY_EMBEDDING_DIM }),
    searchVector: tsvector("search_vector"),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    check(
      "memory_records_scope_check",
      sql`${table.scope} in ('user', 'group', 'session', 'project', 'agent')`,
    ),
    check(
      "memory_records_sensitivity_check",
      sql`${table.sensitivity} in ('low', 'medium', 'high')`,
    ),
    check(
      "memory_records_status_check",
      sql`${table.status} in ('active', 'superseded', 'forgotten')`,
    ),
    index("memory_records_scope_status_idx").on(table.scope, table.status),
    index("memory_records_last_used_at_idx").on(
      sql`${table.lastUsedAt} desc`,
    ),
  ],
);

export const memoryCandidates = pgTable(
  "memory_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operation: text("operation").notNull(),
    scope: text("scope").notNull(),
    subjectRef: jsonObject("subject_ref").notNull().default(sql`'{}'::jsonb`),
    text: text("text").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    sensitivity: text("sensitivity").notNull().default("low"),
    sourceEventIds: text("source_event_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    provenanceNote: text("provenance_note").notNull(),
    status: text("status").notNull().default("pending"),
    reviewResult: jsonObject("review_result"),
    createdByRunId: uuid("created_by_run_id"),
    createdAt: createdAt(),
    reviewedAt: timestamptz("reviewed_at"),
  },
  (table) => [
    check(
      "memory_candidates_operation_check",
      sql`${table.operation} in ('create', 'update', 'forget')`,
    ),
    check(
      "memory_candidates_status_check",
      sql`${table.status} in ('pending', 'accepted', 'rejected', 'merged')`,
    ),
    index("memory_candidates_status_idx").on(table.status),
  ],
);

export const memoryLinks = pgTable(
  "memory_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memoryRecords.id, { onDelete: "cascade" }),
    linkedType: text("linked_type").notNull(),
    linkedId: text("linked_id").notNull(),
    relationship: text("relationship").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("memory_links_memory_id_idx").on(table.memoryId),
    index("memory_links_linked_idx").on(table.linkedType, table.linkedId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Summaries                                                                  */
/* -------------------------------------------------------------------------- */

export const summaries = pgTable(
  "summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    fromEventId: uuid("from_event_id"),
    toEventId: uuid("to_event_id"),
    summary: text("summary").notNull(),
    openLoops: jsonObject("open_loops"),
    memoryHandoffNotes: jsonObject("memory_handoff_notes"),
    createdByRunId: uuid("created_by_run_id"),
    createdAt: createdAt(),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    check(
      "summaries_kind_check",
      sql`${table.kind} in ('session_summary', 'run_checkpoint', 'task_summary', 'memory_review_summary')`,
    ),
    index("summaries_session_created_at_idx").on(
      table.sessionId,
      sql`${table.createdAt} desc`,
    ),
    index("summaries_session_to_event_idx").on(
      table.sessionId,
      table.toEventId,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Approvals                                                                  */
/* -------------------------------------------------------------------------- */

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    requesterEventIds: text("requester_event_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    requestedBy: jsonObject("requested_by"),
    actionKind: text("action_kind").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    exactPreview: text("exact_preview").notNull(),
    proposedAction: jsonObject("proposed_action")
      .notNull()
      .default(sql`'{}'::jsonb`),
    proposalHash: text("proposal_hash").notNull(),
    requiredTrustScope: text("required_trust_scope").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamptz("expires_at"),
    createdByRunId: uuid("created_by_run_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    decidedAt: timestamptz("decided_at"),
    decidedBy: jsonObject("decided_by"),
    decisionEventId: uuid("decision_event_id"),
  },
  (table) => [
    check(
      "approvals_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected', 'expired', 'revoked', 'superseded')`,
    ),
    check(
      "approvals_trust_scope_check",
      sql`${table.requiredTrustScope} in ('global', 'chat', 'project', 'server_admin')`,
    ),
    index("approvals_session_status_idx").on(table.sessionId, table.status),
    index("approvals_status_expires_at_idx").on(
      table.status,
      table.expiresAt,
    ),
    index("approvals_created_by_run_id_idx").on(table.createdByRunId),
  ],
);

export const approvalNotifications = pgTable(
  "approval_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approvals.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    platformMessageId: text("platform_message_id"),
    sentTo: jsonObject("sent_to").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("sent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("approval_notifications_approval_id_idx").on(table.approvalId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Schedules                                                                  */
/* -------------------------------------------------------------------------- */

export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    intent: text("intent").notNull(),
    status: text("status").notNull().default("active"),
    scheduleSpec: jsonObject("schedule_spec")
      .notNull()
      .default(sql`'{}'::jsonb`),
    activeHours: jsonObject("active_hours"),
    cooldownPolicy: jsonObject("cooldown_policy"),
    limits: jsonObject("limits"),
    createdBy: jsonObject("created_by"),
    approvalId: uuid("approval_id"),
    lastFiredAt: timestamptz("last_fired_at"),
    nextFireAt: timestamptz("next_fire_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    check(
      "schedules_kind_check",
      sql`${table.kind} in ('ambient_wake', 'memory_review', 'server_check', 'research_watch', 'custom_task')`,
    ),
    check(
      "schedules_status_check",
      sql`${table.status} in ('active', 'paused', 'completed', 'cancelled')`,
    ),
    index("schedules_status_next_fire_idx").on(
      table.status,
      table.nextFireAt,
    ),
    index("schedules_session_kind_idx").on(table.sessionId, table.kind),
  ],
);

export const scheduleFires = pgTable(
  "schedule_fires",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    plannedFor: timestamptz("planned_for").notNull(),
    firedAt: timestamptz("fired_at"),
    status: text("status").notNull().default("planned"),
    jobId: uuid("job_id"),
    eventId: uuid("event_id"),
    skipReason: text("skip_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("schedule_fires_unique").on(
      table.scheduleId,
      table.plannedFor,
      table.sessionId,
    ),
    check(
      "schedule_fires_status_check",
      sql`${table.status} in ('planned', 'fired', 'skipped', 'failed')`,
    ),
    index("schedule_fires_schedule_id_idx").on(table.scheduleId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

export const toolDefinitions = pgTable(
  "tool_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    source: text("source").notNull(),
    version: text("version"),
    description: text("description").notNull(),
    inputSchema: jsonObject("input_schema"),
    outputSchema: jsonObject("output_schema"),
    riskLevel: text("risk_level").notNull(),
    approvalMode: text("approval_mode").notNull(),
    executionMode: text("execution_mode"),
    enabled: text("enabled").notNull().default("true"),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("tool_definitions_name_unique").on(table.name),
    index("tool_definitions_source_idx").on(table.source),
  ],
);

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    transport: text("transport").notNull(),
    command: text("command"),
    args: jsonObject("args"),
    url: text("url"),
    envRefs: jsonObject("env_refs"),
    trustStatus: text("trust_status").notNull().default("untrusted"),
    configHash: text("config_hash"),
    enabled: text("enabled").notNull().default("true"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("mcp_servers_name_unique").on(table.name)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outputId: uuid("output_id").references(() => actorOutputs.id, {
      onDelete: "set null",
    }),
    actorRunId: uuid("actor_run_id").references(() => actorRuns.id, {
      onDelete: "set null",
    }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    toolName: text("tool_name").notNull(),
    input: jsonObject("input").notNull().default(sql`'{}'::jsonb`),
    riskLevel: text("risk_level").notNull(),
    approvalId: uuid("approval_id"),
    status: text("status").notNull().default("pending"),
    startedAt: timestamptz("started_at"),
    completedAt: timestamptz("completed_at"),
    resultEventId: uuid("result_event_id"),
    error: jsonObject("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "tool_calls_status_check",
      sql`${table.status} in ('pending', 'waiting_approval', 'running', 'succeeded', 'failed', 'cancelled', 'blocked')`,
    ),
    index("tool_calls_session_id_idx").on(table.sessionId),
    index("tool_calls_actor_run_id_idx").on(table.actorRunId),
    index("tool_calls_status_idx").on(table.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* Task agents                                                                */
/* -------------------------------------------------------------------------- */

export const taskAgents = pgTable(
  "task_agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    runtime: text("runtime").notNull(),
    description: text("description").notNull(),
    defaultTools: text("default_tools")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    defaultBudget: jsonObject("default_budget"),
    enabled: text("enabled").notNull().default("true"),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("task_agents_type_unique").on(table.type)],
);

export const taskRuns = pgTable(
  "task_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentSessionId: uuid("parent_session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    taskSessionId: uuid("task_session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    requestedByRunId: uuid("requested_by_run_id"),
    requestedByOutputId: uuid("requested_by_output_id"),
    taskType: text("task_type").notNull(),
    goal: text("goal").notNull(),
    status: text("status").notNull().default("queued"),
    runtime: text("runtime").notNull(),
    budget: jsonObject("budget"),
    startedAt: timestamptz("started_at"),
    completedAt: timestamptz("completed_at"),
    resultEventId: uuid("result_event_id"),
    artifacts: jsonObject("artifacts"),
    error: jsonObject("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "task_runs_status_check",
      sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'cancelled', 'waiting_approval')`,
    ),
    index("task_runs_parent_session_idx").on(table.parentSessionId),
    index("task_runs_status_idx").on(table.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* Skills                                                                     */
/* -------------------------------------------------------------------------- */

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    installUrl: text("install_url"),
    skillsUrl: text("skills_url"),
    localPath: text("local_path"),
    contentHash: text("content_hash"),
    trustStatus: text("trust_status").notNull().default("untrusted"),
    enabled: text("enabled").notNull().default("false"),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
    installedByUserId: uuid("installed_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    installedAt: timestamptz("installed_at"),
    reviewedAt: timestamptz("reviewed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("skills_source_slug_unique").on(table.source, table.slug),
    index("skills_trust_status_idx").on(table.trustStatus),
  ],
);

export const skillFiles = pgTable(
  "skill_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    contentHash: text("content_hash"),
    sizeBytes: integer("size_bytes"),
    summary: text("summary"),
    indexedAt: timestamptz("indexed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("skill_files_skill_id_idx").on(table.skillId)],
);

export const skillScopes = pgTable(
  "skill_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id"),
    mode: text("mode").notNull().default("enabled"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("skill_scopes_skill_id_idx").on(table.skillId)],
);

export const skillToolRequirements = pgTable(
  "skill_tool_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    reason: text("reason"),
    required: text("required").notNull().default("false"),
    createdAt: createdAt(),
  },
  (table) => [
    index("skill_tool_requirements_skill_id_idx").on(table.skillId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Artifacts / config / observability                                         */
/* -------------------------------------------------------------------------- */

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    title: text("title"),
    ownerSessionId: uuid("owner_session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    ownerRunId: uuid("owner_run_id"),
    path: text("path"),
    url: text("url"),
    hash: text("hash"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    retentionPolicy: text("retention_policy"),
    metadata: jsonObject("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("artifacts_owner_session_idx").on(table.ownerSessionId)],
);

export const configOverrides = pgTable(
  "config_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: text("scope").notNull(),
    scopeRef: jsonObject("scope_ref"),
    key: text("key").notNull(),
    value: jsonObject("value"),
    status: text("status").notNull().default("active"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("config_overrides_scope_key_idx").on(table.scope, table.key)],
);

export const decisionRecords = pgTable(
  "decision_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorRunId: uuid("actor_run_id").references(() => actorRuns.id, {
      onDelete: "cascade",
    }),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    triggerEventId: uuid("trigger_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    decision: text("decision").notNull(),
    reasonCode: text("reason_code").notNull(),
    shortReason: text("short_reason").notNull(),
    evidenceRefs: jsonObject("evidence_refs"),
    memoryUsedIds: jsonObject("memory_used_ids"),
    ignoredMemoryIds: jsonObject("ignored_memory_ids"),
    steeringEventIds: jsonObject("steering_event_ids"),
    policyRefs: jsonObject("policy_refs"),
    createdAt: createdAt(),
  },
  (table) => [
    index("decision_records_session_idx").on(table.sessionId),
    index("decision_records_actor_run_idx").on(table.actorRunId),
  ],
);

export const healthChecks = pgTable(
  "health_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    checkName: text("check_name").notNull(),
    status: text("status").notNull(),
    summary: text("summary").notNull(),
    details: jsonObject("details"),
    checkedAt: timestamptz("checked_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    index("health_checks_name_checked_at_idx").on(
      table.checkName,
      sql`${table.checkedAt} desc`,
    ),
  ],
);

export const skillAudits = pgTable(
  "skill_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    riskLevel: text("risk_level"),
    summary: text("summary"),
    raw: jsonObject("raw"),
    auditedAt: timestamptz("audited_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [index("skill_audits_skill_id_idx").on(table.skillId)],
);

export const traceRefs = pgTable(
  "trace_refs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceId: text("trace_id").notNull(),
    actorRunId: uuid("actor_run_id"),
    jobId: uuid("job_id"),
    toolCallId: uuid("tool_call_id"),
    runtimeCallId: text("runtime_call_id"),
    exporter: text("exporter"),
    artifactId: uuid("artifact_id"),
    metadata: jsonObject("metadata"),
    createdAt: createdAt(),
  },
  (table) => [
    index("trace_refs_trace_id_idx").on(table.traceId),
    index("trace_refs_actor_run_id_idx").on(table.actorRunId),
  ],
);

export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    metricName: text("metric_name").notNull(),
    labels: jsonObject("labels"),
    value: numeric("value").notNull(),
    observedAt: timestamptz("observed_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    index("metric_snapshots_name_observed_at_idx").on(
      table.metricName,
      sql`${table.observedAt} desc`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Aggregate + inferred types                                                 */
/* -------------------------------------------------------------------------- */

export const extendedSchema = {
  memoryRecords,
  memoryCandidates,
  memoryLinks,
  summaries,
  approvals,
  approvalNotifications,
  schedules,
  scheduleFires,
  toolDefinitions,
  mcpServers,
  toolCalls,
  taskAgents,
  taskRuns,
  skills,
  skillFiles,
  skillScopes,
  skillToolRequirements,
  artifacts,
  configOverrides,
  decisionRecords,
  healthChecks,
  skillAudits,
  traceRefs,
  metricSnapshots,
};

export type MemoryRecord = typeof memoryRecords.$inferSelect;
export type NewMemoryRecord = typeof memoryRecords.$inferInsert;
export type MemoryCandidate = typeof memoryCandidates.$inferSelect;
export type NewMemoryCandidate = typeof memoryCandidates.$inferInsert;
export type Summary = typeof summaries.$inferSelect;
export type NewSummary = typeof summaries.$inferInsert;
export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
export type ApprovalNotification = typeof approvalNotifications.$inferSelect;
export type NewApprovalNotification =
  typeof approvalNotifications.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;
export type ScheduleFire = typeof scheduleFires.$inferSelect;
export type NewScheduleFire = typeof scheduleFires.$inferInsert;
export type ToolDefinitionRow = typeof toolDefinitions.$inferSelect;
export type NewToolDefinitionRow = typeof toolDefinitions.$inferInsert;
export type McpServerRow = typeof mcpServers.$inferSelect;
export type NewMcpServerRow = typeof mcpServers.$inferInsert;
export type ToolCall = typeof toolCalls.$inferSelect;
export type NewToolCall = typeof toolCalls.$inferInsert;
export type TaskRun = typeof taskRuns.$inferSelect;
export type NewTaskRun = typeof taskRuns.$inferInsert;
export type SkillRow = typeof skills.$inferSelect;
export type NewSkillRow = typeof skills.$inferInsert;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type NewArtifactRow = typeof artifacts.$inferInsert;
export type DecisionRecord = typeof decisionRecords.$inferSelect;
export type NewDecisionRecord = typeof decisionRecords.$inferInsert;
export type HealthCheckRow = typeof healthChecks.$inferSelect;
export type NewHealthCheckRow = typeof healthChecks.$inferInsert;
