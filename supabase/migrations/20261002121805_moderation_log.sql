CREATE TABLE "moderation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"target_membership_id" uuid NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"reason" text,
	"excerpt" text,
	"details" jsonb,
	CONSTRAINT "moderation_log_action_chk" CHECK ("moderation_log"."action" in ('comment_removed','member_blocked','member_unblocked','role_changed')),
	CONSTRAINT "moderation_log_subject_chk" CHECK ((("moderation_log"."action" = 'comment_removed') = ("moderation_log"."subject_type" is not null and "moderation_log"."subject_id" is not null))
        and ("moderation_log"."subject_type" is null or "moderation_log"."subject_type" in ('post_comment','story_comment'))),
	CONSTRAINT "moderation_log_reason_len_chk" CHECK ("moderation_log"."reason" is null or char_length("moderation_log"."reason") between 1 and 500),
	CONSTRAINT "moderation_log_excerpt_len_chk" CHECK ("moderation_log"."excerpt" is null or char_length("moderation_log"."excerpt") <= 280),
	CONSTRAINT "moderation_log_details_chk" CHECK (("moderation_log"."action" = 'role_changed') = ("moderation_log"."details" is not null))
);
--> statement-breakpoint
ALTER TABLE "moderation_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_log_tenant_created_idx" ON "moderation_log" USING btree ("tenant_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_log_tenant_action_created_idx" ON "moderation_log" USING btree ("tenant_id","action","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "moderation_log_tenant_select" ON "moderation_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "moderation_log_tenant_insert" ON "moderation_log" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = app.tenant_id() and actor_user_id = app.user_id());