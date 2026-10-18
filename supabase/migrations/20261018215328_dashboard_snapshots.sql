-- dashboard_snapshots (08.7-01, D-464, INSIGHT-15): the two snapshot tables every panel reads, with their
-- admin-only and own-or-admin select policies (D-462); no write policy — only the builder definer writes.
CREATE TABLE "dashboard_member_snapshots" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_day" date NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"band" text NOT NULL,
	"band_d30" text,
	"band_d60" text,
	"last_active_at" timestamp with time zone,
	"active_days_30" integer DEFAULT 0 NOT NULL,
	"strong_30" integer DEFAULT 0 NOT NULL,
	"top_community_id" uuid,
	"has_push" boolean DEFAULT false NOT NULL,
	"community_bands" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"insights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activity" jsonb,
	CONSTRAINT "dashboard_member_snapshots_tenant_id_membership_id_pk" PRIMARY KEY("tenant_id","membership_id"),
	CONSTRAINT "dashboard_member_snapshots_band_chk" CHECK ("dashboard_member_snapshots"."band" in ('new','superfan','engaged','occasional','at_risk','inactive') and ("dashboard_member_snapshots"."band_d30" is null or "dashboard_member_snapshots"."band_d30" in ('new','superfan','engaged','occasional','at_risk','inactive')) and ("dashboard_member_snapshots"."band_d60" is null or "dashboard_member_snapshots"."band_d60" in ('new','superfan','engaged','occasional','at_risk','inactive')))
);
--> statement-breakpoint
ALTER TABLE "dashboard_member_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dashboard_snapshots" (
	"tenant_id" uuid NOT NULL,
	"snapshot_day" date NOT NULL,
	"payload_version" integer NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"windows" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "dashboard_snapshots_tenant_id_snapshot_day_pk" PRIMARY KEY("tenant_id","snapshot_day")
);
--> statement-breakpoint
ALTER TABLE "dashboard_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboard_member_snapshots" ADD CONSTRAINT "dashboard_member_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_member_snapshots" ADD CONSTRAINT "dashboard_member_snapshots_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_member_snapshots" ADD CONSTRAINT "dashboard_member_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_snapshots" ADD CONSTRAINT "dashboard_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboard_member_snapshots_tenant_user_idx" ON "dashboard_member_snapshots" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "dashboard_member_snapshots_tenant_band_idx" ON "dashboard_member_snapshots" USING btree ("tenant_id","band","last_active_at");--> statement-breakpoint
CREATE POLICY "dashboard_member_snapshots_select_own_or_admin" ON "dashboard_member_snapshots" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id() and (user_id = app.user_id() or app.tenant_role() = 'admin_tenant'));--> statement-breakpoint
CREATE POLICY "dashboard_snapshots_select_admin" ON "dashboard_snapshots" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');