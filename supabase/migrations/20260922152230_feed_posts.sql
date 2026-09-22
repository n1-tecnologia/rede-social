CREATE TABLE "feed_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"community_id" uuid,
	"caption" text DEFAULT '' NOT NULL,
	"media_kind" text DEFAULT 'none' NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "feed_posts_media_kind_chk" CHECK ("feed_posts"."media_kind" in ('none','gallery','video'))
);
--> statement-breakpoint
ALTER TABLE "feed_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_posts_tenant_community_created_idx" ON "feed_posts" USING btree ("tenant_id","community_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feed_posts_tenant_author_idx" ON "feed_posts" USING btree ("tenant_id","author_user_id");--> statement-breakpoint
CREATE POLICY "feed_posts_tenant_isolation" ON "feed_posts" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());