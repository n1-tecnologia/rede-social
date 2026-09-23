CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_asset_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"post_count" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "communities_status_chk" CHECK ("communities"."status" in ('active','archived'))
);
--> statement-breakpoint
ALTER TABLE "communities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "community_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "community_members_role_chk" CHECK ("community_members"."role" in ('member','moderator'))
);
--> statement-breakpoint
ALTER TABLE "community_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communities_tenant_activity_idx" ON "communities" USING btree ("tenant_id","last_activity_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE status = 'active' and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "communities_tenant_slug_uq" ON "communities" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "community_members_tenant_community_user_uq" ON "community_members" USING btree ("tenant_id","community_id","user_id");--> statement-breakpoint
CREATE POLICY "communities_tenant_isolation" ON "communities" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "community_members_tenant_isolation" ON "community_members" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());