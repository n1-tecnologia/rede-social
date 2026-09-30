ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "subject_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "subject_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "object_type" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "object_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_user_dedupe_uq" ON "notifications" USING btree ("tenant_id","user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_unread_list_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE read_at is null;--> statement-breakpoint
CREATE INDEX "notifications_read_list_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE read_at is not null;--> statement-breakpoint
CREATE INDEX "notifications_unseen_idx" ON "notifications" USING btree ("tenant_id","user_id") WHERE seen_at is null;--> statement-breakpoint
CREATE INDEX "notifications_subject_idx" ON "notifications" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "notifications_object_idx" ON "notifications" USING btree ("tenant_id","object_type","object_id") WHERE object_id is not null;--> statement-breakpoint
CREATE POLICY "notifications_owner_select" ON "notifications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = app.tenant_id() and user_id = app.user_id());--> statement-breakpoint
CREATE POLICY "notifications_owner_update" ON "notifications" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = app.tenant_id() and user_id = app.user_id()) WITH CHECK (tenant_id = app.tenant_id() and user_id = app.user_id());