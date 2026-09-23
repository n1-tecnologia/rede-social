CREATE TABLE "feed_link_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text,
	"description" text,
	"site_name" text,
	"provider" text,
	"provider_video_id" text,
	"image_asset_id" uuid,
	"failure_reason" text,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_link_previews_status_chk" CHECK ("feed_link_previews"."status" in ('pending','resolved','failed'))
);
--> statement-breakpoint
ALTER TABLE "feed_link_previews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD COLUMN "link_preview_id" uuid;--> statement-breakpoint
ALTER TABLE "feed_link_previews" ADD CONSTRAINT "feed_link_previews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_link_previews" ADD CONSTRAINT "feed_link_previews_image_asset_id_media_assets_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_link_previews_tenant_url_uq" ON "feed_link_previews" USING btree ("tenant_id","url_hash");--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_link_preview_id_feed_link_previews_id_fk" FOREIGN KEY ("link_preview_id") REFERENCES "public"."feed_link_previews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "feed_link_previews_tenant_isolation" ON "feed_link_previews" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());