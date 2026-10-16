-- courses_member_area (08.6-01, D-444, D-446, COURSE-39): the own-row live-reminder opt-in table `course_live_reminders`,
-- its fire-time index and its three own-row policies (no update policy: on/off is insert/delete). Generated, expand-only.
CREATE TABLE "course_live_reminders" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"live_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_live_reminders_tenant_id_user_id_live_id_pk" PRIMARY KEY("tenant_id","user_id","live_id")
);
--> statement-breakpoint
ALTER TABLE "course_live_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_live_reminders" ADD CONSTRAINT "course_live_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_live_reminders" ADD CONSTRAINT "course_live_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_live_reminders" ADD CONSTRAINT "course_live_reminders_live_id_course_lives_id_fk" FOREIGN KEY ("live_id") REFERENCES "public"."course_lives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_live_reminders_tenant_live_idx" ON "course_live_reminders" USING btree ("tenant_id","live_id");--> statement-breakpoint
CREATE POLICY "course_live_reminders_select_own" ON "course_live_reminders" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id() and user_id = app.user_id());--> statement-breakpoint
CREATE POLICY "course_live_reminders_insert_own" ON "course_live_reminders" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = app.tenant_id() and user_id = app.user_id() and app.tenant_role() is distinct from 'admin_tenant' and live_id <> all (coalesce((select app.live_locked_ids()), '{}'::uuid[])));--> statement-breakpoint
CREATE POLICY "course_live_reminders_delete_own" ON "course_live_reminders" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = app.tenant_id() and user_id = app.user_id());