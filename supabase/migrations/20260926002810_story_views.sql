-- story_views (05.2-10) — HIGHLIGHT-06 / D-105: a member's SEEN state, server-side, one row per
-- (tenant, user, story), so the tenant circle's ring and its resume point are identical on every
-- device (D-79's device-local variant stays rejected).
--
-- THE FILE IS GENERATED, and only generated: `drizzle-kit generate --name=story_views` from
-- `packages/modules/stories/db/schema.ts` (`storyViews`), byte for byte below this header.
-- `pnpm db:generate` is a no-op against it. It is CREATE-ONLY on purpose: it lands between file 1
-- (`*_story_highlights.sql`) and plan 11's drop-only file, and 05.2-11's rehearsal replays the three
-- in order, so nothing here may drop, rename or rewrite an existing table.
--
-- What each statement is for:
--   - `story_views_uq (tenant_id, user_id, story_id)` — the idempotency arbiter the write's
--     `on conflict … do nothing` names, tenant-first (040), and the index the story projection's
--     constant-tenant `exists` subplan scans (the story-first order measured as a Seq Scan).
--   - `story_views_tenant_isolation` — the tenant lane (layer 3); `020-tenant-isolation.sql` proves
--     it invisible and unwritable across tenants, with positive controls.
--   - `story_id` cascades with its story; `user_id` does not (users are never deleted).
--
-- PRIVACY: in this phase the API reads only the caller's own rows. No endpoint, event, payload or
-- log line exposes who saw what, and no count exists — "quem viu" is V2, on this same table.

CREATE TABLE "story_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_views_uq" ON "story_views" USING btree ("tenant_id","user_id","story_id");--> statement-breakpoint
CREATE POLICY "story_views_tenant_isolation" ON "story_views" AS PERMISSIVE FOR ALL TO "authenticated" USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());