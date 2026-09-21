CREATE TABLE "member_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_asset_id" uuid,
	"nudge_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_avatar_asset_id_media_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_profiles_membership_uq" ON "member_profiles" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "member_profiles_tenant_user_idx" ON "member_profiles" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "member_profiles_tenant_select" ON "member_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "member_profiles_self_update" ON "member_profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = app.tenant_id() and user_id = app.user_id()) WITH CHECK (tenant_id = app.tenant_id() and user_id = app.user_id());