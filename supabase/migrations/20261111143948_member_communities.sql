-- member_communities (10-03, MCOMM-01, MCOMM-07, MPUB-04, MPUB-07; D-706, D-707, D-708, D-718) — the
-- GENERATED half of the member communities: the stamped `kind` ('organization' default, so every existing row
-- backfills as the organization's), the two CHECKs (the closed vocabulary and the EXACT sentinel position
-- 1000000 for a member row), the partial creator index, and the four RESTRICTIVE policies that only narrow
-- `communities_tenant_isolation` (the kind insert gate, the member update and delete gates, and the
-- hidden-creator select gate). The select gate calls `app.member_community_hidden_ids()`, declared by the
-- hand-written `*_member_communities_functions.sql` that sorts BEFORE this file (EP-54).
--
-- Expand-only (MPUB-07): one ADD COLUMN with a constant default, two new constraints that every existing row
-- already satisfies, one index and four policies. Nothing is dropped or changed in type, and no row is
-- touched: it applies on a fresh tenant project and on an existing one through the ledgered `migrateAll`.
ALTER TABLE "communities" ADD COLUMN "kind" text DEFAULT 'organization' NOT NULL;--> statement-breakpoint
CREATE INDEX "communities_tenant_creator_idx" ON "communities" USING btree ("tenant_id","created_by_user_id") WHERE kind = 'member' and deleted_at is null;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_kind_chk" CHECK ("communities"."kind" in ('organization','member'));--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_member_position_chk" CHECK ("communities"."kind" = 'organization' or "communities"."position" = 1000000);--> statement-breakpoint
CREATE POLICY "communities_kind_insert_gate" ON "communities" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((app.tenant_role() = 'member' and kind = 'member' and created_by_user_id = app.user_id() and position = 1000000 and (select app.social_enabled())) or (app.tenant_role() <> 'member' and kind = 'organization'));--> statement-breakpoint
CREATE POLICY "communities_member_update_gate" ON "communities" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (app.tenant_role() <> 'member' or created_by_user_id = app.user_id()) WITH CHECK (app.tenant_role() <> 'member' or (kind = 'member' and created_by_user_id = app.user_id()));--> statement-breakpoint
CREATE POLICY "communities_member_delete_gate" ON "communities" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (app.tenant_role() <> 'member');--> statement-breakpoint
CREATE POLICY "communities_member_hidden_gate" ON "communities" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (kind = 'organization' or id <> all (coalesce((select app.member_community_hidden_ids()), '{}'::uuid[])));