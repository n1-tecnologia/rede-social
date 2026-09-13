CREATE TABLE "tenant_modules" (
	"tenant_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_modules_tenant_id_module_key_pk" PRIMARY KEY("tenant_id","module_key"),
	CONSTRAINT "tenant_modules_key_chk" CHECK ("tenant_modules"."module_key" in ('feed','communities','stories','events','chat','notifications','example'))
);
--> statement-breakpoint
ALTER TABLE "tenant_modules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_modules_tenant_select" ON "tenant_modules" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id());