-- HAND-ORDERED (04-04). `drizzle-kit generate` emits this file's statements in its own order and put
-- `feed_post_media_kind_fk` BEFORE the `feed_posts_id_media_kind_uq` it references, which Postgres
-- refuses with 42830 ("there is no unique constraint matching given keys for referenced table").
-- The only change made by hand is the ORDER: the parent's unique constraint is hoisted above the
-- composite foreign key that targets it. No object was added, removed or altered, so
-- `pnpm db:generate` still reports "No schema changes" against the snapshot beside this file.
--
-- If a future regeneration rewrites this file, re-apply the same hoist. The constraint it enables is
-- D-53's gallery-XOR-video rule — see the `feedPostMedia` docblock in
-- `packages/modules/feed/db/schema.ts`.
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_id_media_kind_uq" UNIQUE("id","media_kind");--> statement-breakpoint
CREATE TABLE "feed_post_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"post_media_kind" text NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_post_media_kind_chk" CHECK ((kind = 'image' and post_media_kind = 'gallery')
       or (kind = 'video' and post_media_kind = 'video')
       or (kind = 'file' and post_media_kind in ('none','gallery','video')))
);
--> statement-breakpoint
ALTER TABLE "feed_post_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feed_post_media" ADD CONSTRAINT "feed_post_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_post_media" ADD CONSTRAINT "feed_post_media_post_id_feed_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."feed_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_post_media" ADD CONSTRAINT "feed_post_media_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_post_media" ADD CONSTRAINT "feed_post_media_kind_fk" FOREIGN KEY ("post_id","post_media_kind") REFERENCES "public"."feed_posts"("id","media_kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_post_media_video_uq" ON "feed_post_media" USING btree ("post_id") WHERE kind = 'video';--> statement-breakpoint
CREATE UNIQUE INDEX "feed_post_media_position_uq" ON "feed_post_media" USING btree ("post_id","kind","position");--> statement-breakpoint
CREATE INDEX "feed_post_media_tenant_post_idx" ON "feed_post_media" USING btree ("tenant_id","post_id","position");--> statement-breakpoint
CREATE POLICY "feed_post_media_tenant_isolation" ON "feed_post_media" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
