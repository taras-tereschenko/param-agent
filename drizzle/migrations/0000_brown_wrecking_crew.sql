CREATE TABLE "actor_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"type" text NOT NULL,
	"session_id" uuid NOT NULL,
	"actor_run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"caused_by_event_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_status" text DEFAULT 'pending' NOT NULL,
	"validation_error" jsonb,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "actor_outputs_validation_status_check" CHECK ("actor_outputs"."validation_status" in ('pending', 'valid', 'invalid')),
	CONSTRAINT "actor_outputs_delivery_status_check" CHECK ("actor_outputs"."delivery_status" in ('pending', 'not_applicable', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "actor_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"trigger_event_id" uuid,
	"run_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"runtime" text NOT NULL,
	"model" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"lock_owner" text,
	"lock_expires_at" timestamp with time zone,
	"last_consumed_event_id" uuid,
	"prompt_snapshot_ref" text,
	"context_snapshot_ref" text,
	"error" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actor_runs_status_check" CHECK ("actor_runs"."status" in ('queued', 'building_context', 'running', 'waiting_tool', 'waiting_approval', 'compacting', 'completed', 'failed', 'cancelled', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"actor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session_id" uuid,
	"event_id" uuid,
	"actor_run_id" uuid,
	"approval_id" uuid,
	"tool_call_id" uuid,
	"target" jsonb,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_accounts_status_check" CHECK ("channel_accounts"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"output_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"adapter" text NOT NULL,
	"target" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer NOT NULL,
	"platform_message_id" text,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_attempts_status_check" CHECK ("delivery_attempts"."status" in ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"type" text NOT NULL,
	"session_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"visibility" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone,
	"persisted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" jsonb NOT NULL,
	"platform" jsonb,
	"dedupe_key" text NOT NULL,
	"correlation_id" uuid,
	"parent_event_id" uuid,
	"root_event_id" uuid,
	"actor_run_id" uuid,
	"job_id" uuid,
	"approval_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw" jsonb,
	CONSTRAINT "events_direction_check" CHECK ("events"."direction" in ('inbound', 'outbound', 'internal')),
	CONSTRAINT "events_visibility_check" CHECK ("events"."visibility" in ('chat_visible', 'internal', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"lock_owner" text,
	"lock_expires_at" timestamp with time zone,
	"last_error" jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "jobs_attempt_count_check" CHECK ("jobs"."attempt_count" >= 0),
	CONSTRAINT "jobs_max_attempts_check" CHECK ("jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "platform_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"account_id" uuid NOT NULL,
	"platform_chat_id" text NOT NULL,
	"chat_type" text NOT NULL,
	"title" text,
	"message_thread_id" text,
	"raw_chat" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"hash" text,
	"storage" text NOT NULL,
	"ref" text,
	"json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_payloads_storage_check" CHECK ("raw_payloads"."storage" in ('inline', 'object_store', 'file', 'database'))
);
--> statement-breakpoint
CREATE TABLE "session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid,
	"platform_user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_key" text NOT NULL,
	"platform" text NOT NULL,
	"route_type" text NOT NULL,
	"platform_chat_id" text NOT NULL,
	"message_thread_id" text,
	"parent_session_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"policy_id" text,
	"summary_checkpoint_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_actor_run_id" uuid,
	"active_run_id" uuid,
	"last_event_id_seen_by_actor" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "sessions_status_check" CHECK ("sessions"."status" in ('active', 'archived', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "trusted_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"trust_scope" text NOT NULL,
	"scope_ref" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"added_by_user_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_users_trust_scope_check" CHECK ("trusted_users"."trust_scope" in ('global', 'chat', 'project', 'server_admin')),
	CONSTRAINT "trusted_users_status_check" CHECK ("trusted_users"."status" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"username" text,
	"display_name" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_profile" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actor_outputs" ADD CONSTRAINT "actor_outputs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_outputs" ADD CONSTRAINT "actor_outputs_actor_run_id_actor_runs_id_fk" FOREIGN KEY ("actor_run_id") REFERENCES "public"."actor_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_runs" ADD CONSTRAINT "actor_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_runs" ADD CONSTRAINT "actor_runs_trigger_event_id_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_runs" ADD CONSTRAINT "actor_runs_last_consumed_event_id_events_id_fk" FOREIGN KEY ("last_consumed_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_run_id_actor_runs_id_fk" FOREIGN KEY ("actor_run_id") REFERENCES "public"."actor_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_output_id_actor_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."actor_outputs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_parent_event_id_events_id_fk" FOREIGN KEY ("parent_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_root_event_id_events_id_fk" FOREIGN KEY ("root_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_chats" ADD CONSTRAINT "platform_chats_account_id_channel_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_parent_session_id_sessions_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_users" ADD CONSTRAINT "trusted_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_users" ADD CONSTRAINT "trusted_users_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "actor_outputs_run_sequence_unique" ON "actor_outputs" USING btree ("actor_run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "actor_outputs_idempotency_key_unique" ON "actor_outputs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "actor_outputs_session_created_at_idx" ON "actor_outputs" USING btree ("session_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "actor_outputs_run_sequence_idx" ON "actor_outputs" USING btree ("actor_run_id","sequence");--> statement-breakpoint
CREATE INDEX "actor_outputs_type_idx" ON "actor_outputs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "actor_outputs_delivery_status_idx" ON "actor_outputs" USING btree ("delivery_status");--> statement-breakpoint
CREATE UNIQUE INDEX "actor_runs_one_active_per_session_idx" ON "actor_runs" USING btree ("session_id") WHERE "actor_runs"."status" in ('queued', 'building_context', 'running', 'waiting_tool', 'waiting_approval', 'compacting');--> statement-breakpoint
CREATE INDEX "actor_runs_session_created_at_idx" ON "actor_runs" USING btree ("session_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "actor_runs_status_idx" ON "actor_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "actor_runs_lock_expires_at_idx" ON "actor_runs" USING btree ("lock_expires_at");--> statement-breakpoint
CREATE INDEX "audit_log_event_type_idx" ON "audit_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_log_session_id_idx" ON "audit_log" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "audit_log_event_id_idx" ON "audit_log" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_run_id_idx" ON "audit_log" USING btree ("actor_run_id");--> statement-breakpoint
CREATE INDEX "audit_log_approval_id_idx" ON "audit_log" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "channel_accounts_platform_label_unique" ON "channel_accounts" USING btree ("platform","label");--> statement-breakpoint
CREATE INDEX "channel_accounts_status_idx" ON "channel_accounts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_attempts_output_target_attempt_unique" ON "delivery_attempts" USING btree ("output_id","platform","adapter","attempt");--> statement-breakpoint
CREATE INDEX "delivery_attempts_session_id_idx" ON "delivery_attempts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "delivery_attempts_output_id_idx" ON "delivery_attempts" USING btree ("output_id");--> statement-breakpoint
CREATE INDEX "delivery_attempts_status_idx" ON "delivery_attempts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "events_dedupe_key_unique" ON "events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "events_session_occurred_at_idx" ON "events" USING btree ("session_id","occurred_at" desc);--> statement-breakpoint
CREATE INDEX "events_session_id_idx" ON "events" USING btree ("session_id","id");--> statement-breakpoint
CREATE INDEX "events_type_occurred_at_idx" ON "events" USING btree ("type","occurred_at" desc);--> statement-breakpoint
CREATE INDEX "events_actor_run_id_idx" ON "events" USING btree ("actor_run_id");--> statement-breakpoint
CREATE INDEX "events_job_id_idx" ON "events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "events_approval_id_idx" ON "events" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "events_correlation_id_idx" ON "events" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_key_unique" ON "jobs" USING btree ("idempotency_key") WHERE "jobs"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","due_at","priority" desc);--> statement-breakpoint
CREATE INDEX "jobs_lock_expires_at_idx" ON "jobs" USING btree ("lock_expires_at");--> statement-breakpoint
CREATE INDEX "jobs_type_status_idx" ON "jobs" USING btree ("type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_chats_route_unique" ON "platform_chats" USING btree ("platform","account_id","platform_chat_id",coalesce("message_thread_id", ''));--> statement-breakpoint
CREATE INDEX "platform_chats_account_idx" ON "platform_chats" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "platform_chats_platform_chat_idx" ON "platform_chats" USING btree ("platform","platform_chat_id");--> statement-breakpoint
CREATE INDEX "raw_payloads_provider_kind_idx" ON "raw_payloads" USING btree ("provider","kind");--> statement-breakpoint
CREATE INDEX "raw_payloads_hash_idx" ON "raw_payloads" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "session_participants_session_platform_user_unique" ON "session_participants" USING btree ("session_id","platform_user_id");--> statement-breakpoint
CREATE INDEX "session_participants_session_id_idx" ON "session_participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_participants_user_id_idx" ON "session_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_session_key_unique" ON "sessions" USING btree ("session_key");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_parent_session_id_idx" ON "sessions" USING btree ("parent_session_id");--> statement-breakpoint
CREATE INDEX "sessions_last_event_at_idx" ON "sessions" USING btree ("last_event_at" desc);--> statement-breakpoint
CREATE INDEX "trusted_users_platform_user_idx" ON "trusted_users" USING btree ("platform","platform_user_id");--> statement-breakpoint
CREATE INDEX "trusted_users_user_id_idx" ON "trusted_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trusted_users_status_idx" ON "trusted_users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_platform_user_unique" ON "user_accounts" USING btree ("platform","platform_user_id");--> statement-breakpoint
CREATE INDEX "user_accounts_user_id_idx" ON "user_accounts" USING btree ("user_id");