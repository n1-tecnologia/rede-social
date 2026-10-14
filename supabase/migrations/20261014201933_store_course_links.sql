-- store_course_links (08.4-01, SC 4, STORE-22, COURSE-08, COURSE-11; D-418) — the store takes
-- ownership of the course and live unlock links, as it owns `store_product_communities`. GENERATED
-- by drizzle-kit from packages/modules/store/db/schema.ts; every statement below is drizzle-kit's,
-- unchanged, and the run is CREATE-ONLY (the courses schema is untouched in this run, so
-- drizzle-kit asks no interactive question):
--
--   1. `store_product_courses (tenant_id, product_id, course_id, created_at)` and
--      `store_product_lives (tenant_id, product_id, live_id, created_at)`, RLS enabled on each, FKs
--      to `tenants` and `store_products` on delete cascade;
--   2. unique `store_product_courses_uq` / `store_product_lives_uq` and the gate lookups
--      `store_product_courses_tenant_course_idx` / `store_product_lives_tenant_live_idx`;
--   3. the four tenant-read, admin-claim-write policies of each table (CR-01).
--
-- `course_id` / `live_id` are bare uuids here: their FKs to `courses(id)` / `course_lives(id)`, the
-- TRUNCATE revoke, the carry-over of the 08.3 link rows and the swap of the four gate bodies are
-- hand SQL in the next file, `*_store_course_links_functions.sql`. The 08.3 tables are dropped by a
-- later, separate file (a `language sql` body is not a dependency: dropping first would break the
-- gate at its next call).

CREATE TABLE "store_product_courses" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_product_courses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_product_lives" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"live_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_product_lives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_product_courses" ADD CONSTRAINT "store_product_courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_courses" ADD CONSTRAINT "store_product_courses_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."store_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_lives" ADD CONSTRAINT "store_product_lives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_lives" ADD CONSTRAINT "store_product_lives_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."store_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_product_courses_uq" ON "store_product_courses" USING btree ("tenant_id","product_id","course_id");--> statement-breakpoint
CREATE INDEX "store_product_courses_tenant_course_idx" ON "store_product_courses" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_product_lives_uq" ON "store_product_lives" USING btree ("tenant_id","product_id","live_id");--> statement-breakpoint
CREATE INDEX "store_product_lives_tenant_live_idx" ON "store_product_lives" USING btree ("tenant_id","live_id");--> statement-breakpoint
CREATE POLICY "store_product_courses_select_tenant" ON "store_product_courses" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "store_product_courses_insert_admin" ON "store_product_courses" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');--> statement-breakpoint
CREATE POLICY "store_product_courses_update_admin" ON "store_product_courses" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant') WITH CHECK (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');--> statement-breakpoint
CREATE POLICY "store_product_courses_delete_admin" ON "store_product_courses" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');--> statement-breakpoint
CREATE POLICY "store_product_lives_select_tenant" ON "store_product_lives" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "store_product_lives_insert_admin" ON "store_product_lives" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');--> statement-breakpoint
CREATE POLICY "store_product_lives_update_admin" ON "store_product_lives" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant') WITH CHECK (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');--> statement-breakpoint
CREATE POLICY "store_product_lives_delete_admin" ON "store_product_lives" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');