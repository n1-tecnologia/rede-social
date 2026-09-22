CREATE TABLE "feed_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"post_id" uuid,
	"story_id" uuid,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"depth" smallint DEFAULT 0 NOT NULL,
	"parent_id" uuid,
	"parent_depth" smallint,
	"like_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "feed_comments_id_depth_uq" UNIQUE("id","depth"),
	CONSTRAINT "feed_comments_parent_shape_chk" CHECK ((parent_id is null and parent_depth is null and depth = 0)
       or (parent_id is not null and parent_depth = 0 and depth = 1)),
	CONSTRAINT "feed_comments_target_chk" CHECK (num_nonnulls(post_id, story_id) = 1)
);
--> statement-breakpoint
ALTER TABLE "feed_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feed_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"post_id" uuid,
	"comment_id" uuid,
	"story_id" uuid,
	"kind" text DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_likes_target_chk" CHECK (num_nonnulls(post_id, comment_id, story_id) = 1)
);
--> statement-breakpoint
ALTER TABLE "feed_likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "feed_posts_tenant_community_created_idx";--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_post_id_feed_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."feed_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_parent_fk" FOREIGN KEY ("parent_id","parent_depth") REFERENCES "public"."feed_comments"("id","depth") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_likes" ADD CONSTRAINT "feed_likes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_likes" ADD CONSTRAINT "feed_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_likes" ADD CONSTRAINT "feed_likes_post_id_feed_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."feed_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_likes" ADD CONSTRAINT "feed_likes_comment_id_feed_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."feed_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_comments_tenant_post_root_idx" ON "feed_comments" USING btree ("tenant_id","post_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE parent_id is null;--> statement-breakpoint
CREATE INDEX "feed_comments_tenant_parent_idx" ON "feed_comments" USING btree ("tenant_id","parent_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_likes_post_uq" ON "feed_likes" USING btree ("user_id","post_id") WHERE post_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_likes_comment_uq" ON "feed_likes" USING btree ("user_id","comment_id") WHERE comment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_likes_story_uq" ON "feed_likes" USING btree ("user_id","story_id") WHERE story_id is not null;--> statement-breakpoint
CREATE INDEX "feed_likes_tenant_post_idx" ON "feed_likes" USING btree ("tenant_id","post_id");--> statement-breakpoint
CREATE INDEX "feed_posts_tenant_created_idx" ON "feed_posts" USING btree ("tenant_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE community_id is null;--> statement-breakpoint
CREATE INDEX "feed_posts_tenant_community_created_idx" ON "feed_posts" USING btree ("tenant_id","community_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE POLICY "feed_comments_tenant_isolation" ON "feed_comments" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "feed_likes_tenant_isolation" ON "feed_likes" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());