CREATE TABLE "tenant_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"role" text DEFAULT 'admin_tenant' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_invites_role_chk" CHECK ("tenant_invites"."role" in ('admin_tenant')),
	CONSTRAINT "tenant_invites_status_chk" CHECK ("tenant_invites"."status" in ('pending','sent','accepted','expired'))
);
--> statement-breakpoint
ALTER TABLE "tenant_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "verification_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "dns_records" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "verify_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "tenant_invites" ADD CONSTRAINT "tenant_invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invites" ADD CONSTRAINT "tenant_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invites" ADD CONSTRAINT "tenant_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_invites_tenant_idx" ON "tenant_invites" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_invites_tenant_email_key" ON "tenant_invites" USING btree ("tenant_id","email");--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_verification_status_chk" CHECK ("tenant_domains"."verification_status" in ('pending','verified','expired','failed'));