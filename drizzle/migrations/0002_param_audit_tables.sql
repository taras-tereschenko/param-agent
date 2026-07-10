CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_name" text NOT NULL,
	"labels" jsonb,
	"value" numeric NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"risk_level" text,
	"summary" text,
	"raw" jsonb,
	"audited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" text NOT NULL,
	"actor_run_id" uuid,
	"job_id" uuid,
	"tool_call_id" uuid,
	"runtime_call_id" text,
	"exporter" text,
	"artifact_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_audits" ADD CONSTRAINT "skill_audits_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metric_snapshots_name_observed_at_idx" ON "metric_snapshots" USING btree ("metric_name","observed_at" desc);--> statement-breakpoint
CREATE INDEX "skill_audits_skill_id_idx" ON "skill_audits" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "trace_refs_trace_id_idx" ON "trace_refs" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "trace_refs_actor_run_id_idx" ON "trace_refs" USING btree ("actor_run_id");