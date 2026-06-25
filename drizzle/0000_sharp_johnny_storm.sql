CREATE TABLE "param_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" text NOT NULL,
	"scope" text DEFAULT 'principal' NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"source" text DEFAULT 'agent' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"provenance" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "param_profiles" (
	"principal_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "param_memories" ADD CONSTRAINT "param_memories_principal_id_param_profiles_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."param_profiles"("principal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "param_memories_principal_scope_category_unique" ON "param_memories" USING btree ("principal_id","scope","category");--> statement-breakpoint
CREATE INDEX "param_memories_principal_scope_idx" ON "param_memories" USING btree ("principal_id","scope");--> statement-breakpoint
CREATE INDEX "param_memories_principal_category_idx" ON "param_memories" USING btree ("principal_id","category");