CREATE TABLE "param_action_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"call_id" text NOT NULL,
	"session_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"turn_sequence" integer,
	"step_index" integer NOT NULL,
	"sequence" integer NOT NULL,
	"channel" text DEFAULT 'telegram' NOT NULL,
	"chat_id" text,
	"chat_type" text,
	"conversation_id" text,
	"message_thread_id" text,
	"requester_principal_id" text,
	"requester_principal_type" text,
	"requester_telegram_user_id" text,
	"approver_principal_id" text,
	"approver_principal_type" text,
	"approver_telegram_user_id" text,
	"tool_name" text NOT NULL,
	"action_kind" text NOT NULL,
	"proposal_hash" text NOT NULL,
	"proposal" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"result_status" text,
	"result" jsonb,
	"error" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "param_action_reviews_status_check" CHECK ("param_action_reviews"."status" in ('requested', 'completed', 'failed', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "param_action_reviews_request_id_unique" ON "param_action_reviews" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "param_action_reviews_call_id_unique" ON "param_action_reviews" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "param_action_reviews_session_turn_idx" ON "param_action_reviews" USING btree ("session_id","turn_id");--> statement-breakpoint
CREATE INDEX "param_action_reviews_status_requested_idx" ON "param_action_reviews" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "param_action_reviews_proposal_hash_idx" ON "param_action_reviews" USING btree ("proposal_hash");