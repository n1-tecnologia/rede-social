CREATE TABLE "media_provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_provider_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_provider_chk";--> statement-breakpoint
CREATE INDEX "media_provider_events_received_idx" ON "media_provider_events" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_provider_chk" CHECK ("media_assets"."provider" in ('supabase','mux','fake'));