CREATE TABLE "approval_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_id" uuid NOT NULL,
	"session_id" uuid,
	"platform_message_id" text,
	"sent_to" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"requester_event_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"requested_by" jsonb,
	"action_kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"exact_preview" text NOT NULL,
	"proposed_action" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposal_hash" text NOT NULL,
	"required_trust_scope" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" jsonb,
	"decision_event_id" uuid,
	CONSTRAINT "approvals_status_check" CHECK ("approvals"."status" in ('pending', 'approved', 'rejected', 'expired', 'revoked', 'superseded')),
	CONSTRAINT "approvals_trust_scope_check" CHECK ("approvals"."required_trust_scope" in ('global', 'chat', 'project', 'server_admin'))
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"owner_session_id" uuid,
	"owner_run_id" uuid,
	"path" text,
	"url" text,
	"hash" text,
	"mime_type" text,
	"size_bytes" integer,
	"retention_policy" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"scope_ref" jsonb,
	"key" text NOT NULL,
	"value" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_run_id" uuid,
	"session_id" uuid,
	"trigger_event_id" uuid,
	"decision" text NOT NULL,
	"reason_code" text NOT NULL,
	"short_reason" text NOT NULL,
	"evidence_refs" jsonb,
	"memory_used_ids" jsonb,
	"ignored_memory_ids" jsonb,
	"steering_event_ids" jsonb,
	"policy_refs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_name" text NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"transport" text NOT NULL,
	"command" text,
	"args" jsonb,
	"url" text,
	"env_refs" jsonb,
	"trust_status" text DEFAULT 'untrusted' NOT NULL,
	"config_hash" text,
	"enabled" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation" text NOT NULL,
	"scope" text NOT NULL,
	"subject_ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"text" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"sensitivity" text DEFAULT 'low' NOT NULL,
	"source_event_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"provenance_note" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_result" jsonb,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "memory_candidates_operation_check" CHECK ("memory_candidates"."operation" in ('create', 'update', 'forget')),
	CONSTRAINT "memory_candidates_status_check" CHECK ("memory_candidates"."status" in ('pending', 'accepted', 'rejected', 'merged'))
);
--> statement-breakpoint
CREATE TABLE "memory_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"linked_type" text NOT NULL,
	"linked_id" text NOT NULL,
	"relationship" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"subject_ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"text" text NOT NULL,
	"normalized_text" text,
	"provenance_note" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"sensitivity" text DEFAULT 'low' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_event_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"embedding" vector(1536),
	"search_vector" "tsvector",
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "memory_records_scope_check" CHECK ("memory_records"."scope" in ('user', 'group', 'session', 'project', 'agent')),
	CONSTRAINT "memory_records_sensitivity_check" CHECK ("memory_records"."sensitivity" in ('low', 'medium', 'high')),
	CONSTRAINT "memory_records_status_check" CHECK ("memory_records"."status" in ('active', 'superseded', 'forgotten'))
);
--> statement-breakpoint
CREATE TABLE "schedule_fires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"planned_for" timestamp with time zone NOT NULL,
	"fired_at" timestamp with time zone,
	"status" text DEFAULT 'planned' NOT NULL,
	"job_id" uuid,
	"event_id" uuid,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_fires_status_check" CHECK ("schedule_fires"."status" in ('planned', 'fired', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"intent" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"schedule_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_hours" jsonb,
	"cooldown_policy" jsonb,
	"limits" jsonb,
	"created_by" jsonb,
	"approval_id" uuid,
	"last_fired_at" timestamp with time zone,
	"next_fire_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "schedules_kind_check" CHECK ("schedules"."kind" in ('ambient_wake', 'memory_review', 'server_check', 'research_watch', 'custom_task')),
	CONSTRAINT "schedules_status_check" CHECK ("schedules"."status" in ('active', 'paused', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "skill_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content_hash" text,
	"size_bytes" integer,
	"summary" text,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"mode" text DEFAULT 'enabled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_tool_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"reason" text,
	"required" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"install_url" text,
	"skills_url" text,
	"local_path" text,
	"content_hash" text,
	"trust_status" text DEFAULT 'untrusted' NOT NULL,
	"enabled" text DEFAULT 'false' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_by_user_id" uuid,
	"installed_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_event_id" uuid,
	"to_event_id" uuid,
	"summary" text NOT NULL,
	"open_loops" jsonb,
	"memory_handoff_notes" jsonb,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "summaries_kind_check" CHECK ("summaries"."kind" in ('session_summary', 'run_checkpoint', 'task_summary', 'memory_review_summary'))
);
--> statement-breakpoint
CREATE TABLE "task_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"runtime" text NOT NULL,
	"description" text NOT NULL,
	"default_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_budget" jsonb,
	"enabled" text DEFAULT 'true' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_session_id" uuid NOT NULL,
	"task_session_id" uuid,
	"requested_by_run_id" uuid,
	"requested_by_output_id" uuid,
	"task_type" text NOT NULL,
	"goal" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"runtime" text NOT NULL,
	"budget" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result_event_id" uuid,
	"artifacts" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_runs_status_check" CHECK ("task_runs"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled', 'waiting_approval'))
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"output_id" uuid,
	"actor_run_id" uuid,
	"session_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_level" text NOT NULL,
	"approval_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result_event_id" uuid,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_calls_status_check" CHECK ("tool_calls"."status" in ('pending', 'waiting_approval', 'running', 'succeeded', 'failed', 'cancelled', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "tool_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"version" text,
	"description" text NOT NULL,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"risk_level" text NOT NULL,
	"approval_mode" text NOT NULL,
	"execution_mode" text,
	"enabled" text DEFAULT 'true' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_notifications" ADD CONSTRAINT "approval_notifications_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_notifications" ADD CONSTRAINT "approval_notifications_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_owner_session_id_sessions_id_fk" FOREIGN KEY ("owner_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_overrides" ADD CONSTRAINT "config_overrides_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_actor_run_id_actor_runs_id_fk" FOREIGN KEY ("actor_run_id") REFERENCES "public"."actor_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_trigger_event_id_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_links" ADD CONSTRAINT "memory_links_memory_id_memory_records_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_fires" ADD CONSTRAINT "schedule_fires_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_fires" ADD CONSTRAINT "schedule_fires_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_files" ADD CONSTRAINT "skill_files_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_scopes" ADD CONSTRAINT "skill_scopes_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_tool_requirements" ADD CONSTRAINT "skill_tool_requirements_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_installed_by_user_id_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_parent_session_id_sessions_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_session_id_sessions_id_fk" FOREIGN KEY ("task_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_output_id_actor_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."actor_outputs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_actor_run_id_actor_runs_id_fk" FOREIGN KEY ("actor_run_id") REFERENCES "public"."actor_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_notifications_approval_id_idx" ON "approval_notifications" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "approvals_session_status_idx" ON "approvals" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "approvals_status_expires_at_idx" ON "approvals" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "approvals_created_by_run_id_idx" ON "approvals" USING btree ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "artifacts_owner_session_idx" ON "artifacts" USING btree ("owner_session_id");--> statement-breakpoint
CREATE INDEX "config_overrides_scope_key_idx" ON "config_overrides" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "decision_records_session_idx" ON "decision_records" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "decision_records_actor_run_idx" ON "decision_records" USING btree ("actor_run_id");--> statement-breakpoint
CREATE INDEX "health_checks_name_checked_at_idx" ON "health_checks" USING btree ("check_name","checked_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_name_unique" ON "mcp_servers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "memory_candidates_status_idx" ON "memory_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "memory_links_memory_id_idx" ON "memory_links" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "memory_links_linked_idx" ON "memory_links" USING btree ("linked_type","linked_id");--> statement-breakpoint
CREATE INDEX "memory_records_scope_status_idx" ON "memory_records" USING btree ("scope","status");--> statement-breakpoint
CREATE INDEX "memory_records_last_used_at_idx" ON "memory_records" USING btree ("last_used_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_fires_unique" ON "schedule_fires" USING btree ("schedule_id","planned_for","session_id");--> statement-breakpoint
CREATE INDEX "schedule_fires_schedule_id_idx" ON "schedule_fires" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedules_status_next_fire_idx" ON "schedules" USING btree ("status","next_fire_at");--> statement-breakpoint
CREATE INDEX "schedules_session_kind_idx" ON "schedules" USING btree ("session_id","kind");--> statement-breakpoint
CREATE INDEX "skill_files_skill_id_idx" ON "skill_files" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_scopes_skill_id_idx" ON "skill_scopes" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_tool_requirements_skill_id_idx" ON "skill_tool_requirements" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_source_slug_unique" ON "skills" USING btree ("source","slug");--> statement-breakpoint
CREATE INDEX "skills_trust_status_idx" ON "skills" USING btree ("trust_status");--> statement-breakpoint
CREATE INDEX "summaries_session_created_at_idx" ON "summaries" USING btree ("session_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "summaries_session_to_event_idx" ON "summaries" USING btree ("session_id","to_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_agents_type_unique" ON "task_agents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "task_runs_parent_session_idx" ON "task_runs" USING btree ("parent_session_id");--> statement-breakpoint
CREATE INDEX "task_runs_status_idx" ON "task_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tool_calls_session_id_idx" ON "tool_calls" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tool_calls_actor_run_id_idx" ON "tool_calls" USING btree ("actor_run_id");--> statement-breakpoint
CREATE INDEX "tool_calls_status_idx" ON "tool_calls" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_definitions_name_unique" ON "tool_definitions" USING btree ("name");--> statement-breakpoint
CREATE INDEX "tool_definitions_source_idx" ON "tool_definitions" USING btree ("source");