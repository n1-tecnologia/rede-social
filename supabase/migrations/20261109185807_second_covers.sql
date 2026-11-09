ALTER TABLE "course_modules" ADD COLUMN "cover_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "top_cover_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "course_tracks" ADD COLUMN "top_cover_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "top_cover_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "poster_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_top_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("top_cover_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tracks" ADD CONSTRAINT "course_tracks_top_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("top_cover_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_top_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("top_cover_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_poster_asset_id_media_assets_id_fk" FOREIGN KEY ("poster_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;