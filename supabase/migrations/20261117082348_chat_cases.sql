CREATE TABLE "chat_case_counters" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_case_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"from_state" text,
	"to_state" text,
	"field" text,
	"from_value" text,
	"to_value" text,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_case_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "case_number" integer;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_case_counters" ADD CONSTRAINT "chat_case_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_case_events" ADD CONSTRAINT "chat_case_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_case_events" ADD CONSTRAINT "chat_case_events_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_case_events" ADD CONSTRAINT "chat_case_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_case_events" ADD CONSTRAINT "chat_case_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;