CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text_version" integer NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "consent_records_kind_chk" CHECK ("consent_records"."kind" in ('tenant_rules','platform_terms'))
);
--> statement-breakpoint
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_records_tenant_user_kind_version_uq" ON "consent_records" USING btree ("tenant_id","user_id","kind","text_version");--> statement-breakpoint
CREATE INDEX "consent_records_tenant_user_idx" ON "consent_records" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "consent_records_self_select" ON "consent_records" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id() and user_id = app.user_id());