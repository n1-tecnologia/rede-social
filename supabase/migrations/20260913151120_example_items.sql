CREATE TABLE "example_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "example_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "example_items" ADD CONSTRAINT "example_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "example_items" ADD CONSTRAINT "example_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "example_items_tenant_created_idx" ON "example_items" USING btree ("tenant_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "example_items_tenant_isolation" ON "example_items" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());