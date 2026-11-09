CREATE TABLE "store_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_categories_tenant_slug_uq" UNIQUE("tenant_id","slug"),
	CONSTRAINT "store_categories_slug_chk" CHECK ("store_categories"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$'),
	CONSTRAINT "store_categories_icon_chk" CHECK ("store_categories"."icon" ~ '^[a-z0-9-]{1,32}$'),
	CONSTRAINT "store_categories_name_chk" CHECK (char_length("store_categories"."name") between 1 and 30),
	CONSTRAINT "store_categories_position_chk" CHECK ("store_categories"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_front" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"promo_product_id" uuid,
	"featured_product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"categories_seeded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_front_featured_chk" CHECK (cardinality("store_front"."featured_product_ids") <= 5)
);
--> statement-breakpoint
ALTER TABLE "store_front" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "store_categories" ADD CONSTRAINT "store_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_front" ADD CONSTRAINT "store_front_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_front" ADD CONSTRAINT "store_front_promo_product_id_store_products_id_fk" FOREIGN KEY ("promo_product_id") REFERENCES "public"."store_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_categories_tenant_name_uq" ON "store_categories" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "store_categories_tenant_position_idx" ON "store_categories" USING btree ("tenant_id","position");--> statement-breakpoint
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_category_id_store_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."store_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_products_tenant_category_idx" ON "store_products" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE POLICY "store_categories_select_tenant" ON "store_categories" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "store_categories_insert_admin" ON "store_categories" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');--> statement-breakpoint
CREATE POLICY "store_categories_update_admin" ON "store_categories" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant') WITH CHECK (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');--> statement-breakpoint
CREATE POLICY "store_categories_delete_admin" ON "store_categories" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');--> statement-breakpoint
CREATE POLICY "store_front_select_tenant" ON "store_front" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id());--> statement-breakpoint
CREATE POLICY "store_front_insert_admin" ON "store_front" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');--> statement-breakpoint
CREATE POLICY "store_front_update_admin" ON "store_front" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant') WITH CHECK (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');--> statement-breakpoint
CREATE POLICY "store_front_delete_admin" ON "store_front" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant');