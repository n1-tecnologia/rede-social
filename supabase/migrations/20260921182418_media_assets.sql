CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'supabase' NOT NULL,
	"provider_asset_id" text,
	"playback_id" text,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"aspect_ratio" text,
	"variant_widths" integer[] DEFAULT '{}'::int[] NOT NULL,
	"filename" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_assets_kind_chk" CHECK ("media_assets"."kind" in ('image','video','file')),
	CONSTRAINT "media_assets_purpose_chk" CHECK ("media_assets"."purpose" in ('avatar','post','cover','story','attachment')),
	CONSTRAINT "media_assets_status_chk" CHECK ("media_assets"."status" in ('pending','processing','ready','failed','rejected','deleted')),
	CONSTRAINT "media_assets_provider_chk" CHECK ("media_assets"."provider" in ('supabase','mux'))
);
--> statement-breakpoint
ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_tenant_status_created_idx" ON "media_assets" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_tenant_owner_idx" ON "media_assets" USING btree ("tenant_id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_provider_asset_uq" ON "media_assets" USING btree ("provider","provider_asset_id") WHERE provider_asset_id is not null;--> statement-breakpoint
CREATE POLICY "media_assets_tenant_select" ON "media_assets" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id() and deleted_at is null);