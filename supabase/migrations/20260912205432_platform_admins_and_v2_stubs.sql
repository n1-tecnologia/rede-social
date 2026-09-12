CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'support' NOT NULL,
	"subject" text,
	"created_by_user_id" uuid,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_conversations_kind_chk" CHECK ("chat_conversations"."kind" in ('support','direct','group'))
);
--> statement-breakpoint
ALTER TABLE "chat_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_participants" (
	"conversation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"last_read_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "chat_participants_role_chk" CHECK ("chat_participants"."role" in ('member','support','admin'))
);
--> statement-breakpoint
ALTER TABLE "chat_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversations_one_support_per_member" ON "chat_conversations" USING btree ("tenant_id","created_by_user_id") WHERE kind = 'support';--> statement-breakpoint
CREATE INDEX "chat_conversations_tenant_last_message_idx" ON "chat_conversations" USING btree ("tenant_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_conversation_seq_uq" ON "chat_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "chat_messages_tenant_conversation_seq_idx" ON "chat_messages" USING btree ("tenant_id","conversation_id","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "chat_participants_tenant_user_idx" ON "chat_participants" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_user_uq" ON "notifications" USING btree ("event_id","user_id") WHERE event_id is not null;--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_read_idx" ON "notifications" USING btree ("tenant_id","user_id","read_at");--> statement-breakpoint
CREATE POLICY "chat_conversations_tenant_isolation" ON "chat_conversations" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "chat_messages_tenant_isolation" ON "chat_messages" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "chat_participants_tenant_isolation" ON "chat_participants" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "notifications_tenant_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());