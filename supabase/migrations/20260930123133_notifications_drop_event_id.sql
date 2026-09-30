DROP INDEX "notifications_event_user_uq";--> statement-breakpoint
DROP INDEX "notifications_tenant_user_read_idx";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "event_id";--> statement-breakpoint
DROP POLICY "notifications_tenant_isolation" ON "notifications" CASCADE;