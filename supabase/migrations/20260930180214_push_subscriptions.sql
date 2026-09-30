CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_tenant_endpoint_uq" ON "push_subscriptions" USING btree ("tenant_id","endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_tenant_user_idx" ON "push_subscriptions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "push_subscriptions_owner_select" ON "push_subscriptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id() and user_id = app.user_id());--> statement-breakpoint
CREATE POLICY "push_subscriptions_owner_delete" ON "push_subscriptions" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = app.tenant_id() and user_id = app.user_id());