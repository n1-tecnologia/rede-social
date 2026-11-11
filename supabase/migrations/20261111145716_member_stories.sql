-- member_stories (10-04, MSTORY-04, MSTORY-08, MPUB-04, MPUB-07; D-705, D-716, D-718; T-10-09, T-10-10) — the
-- database half of the MEMBER STORY audience.
--
--   1. `stories.visibility text not null default 'tenant'` with `stories_visibility_chk`
--      (`'tenant'` | `'followers'`). The default backfills every existing story as the organization's voice:
--      no row is rewritten by hand and none changes audience.
--   2. `stories_social_insert_gate` (RESTRICTIVE, insert): a `member` lane inserts only `'followers'` while
--      `social` is on; every other lane inserts only `'tenant'` (a forged audience raises 42501).
--   3. `stories_audience_gate` (RESTRICTIVE, select): organization stories pass for everyone; a member story
--      passes for its author, its LIVE followers and the moderator/system lanes while `social` is on, and
--      for everyone who reads a community whose HIGHLIGHT holds it, with `social` on or off (branch 3,
--      D-716; the inner `communities` read runs under the caller's RLS, so a blocked or removed creator's
--      community, D-708, closes it). The branch is the per-row `exists` form; the A10 measurement that
--      chose it is `.planning/phases/10-rede-social-member-stories-and-communities/10-04-SPIKE.md`.
--   4. `feed_comments_story_gate` / `feed_likes_story_gate` (select) and their `*_story_insert_gate`
--      twins (insert): a story's like or comment is read and written only by a lane that reads the story
--      (an inner `exists` under the stories gate). Before this migration story likes and comments carried no
--      story gate (RESEARCH Pitfall); rows without `story_id` pass untouched.
--
-- Sorts AFTER `*_feed_member_update_allowlist.sql` (10-03). EXPAND-ONLY (MPUB-07): one column with a
-- default, one CHECK, six policies; no table or column dropped, renamed or retyped; no row touched.
-- The applied 10-03 migrations are not edited.

ALTER TABLE "stories" ADD COLUMN "visibility" text DEFAULT 'tenant' NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_visibility_chk" CHECK ("stories"."visibility" in ('tenant','followers'));--> statement-breakpoint
CREATE POLICY "feed_comments_story_gate" ON "feed_comments" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (story_id is null or exists (select 1 from public.stories s where s.id = feed_comments.story_id));--> statement-breakpoint
CREATE POLICY "feed_comments_story_insert_gate" ON "feed_comments" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (story_id is null or exists (select 1 from public.stories s where s.id = feed_comments.story_id));--> statement-breakpoint
CREATE POLICY "feed_likes_story_gate" ON "feed_likes" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (story_id is null or exists (select 1 from public.stories s where s.id = feed_likes.story_id));--> statement-breakpoint
CREATE POLICY "feed_likes_story_insert_gate" ON "feed_likes" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (story_id is null or exists (select 1 from public.stories s where s.id = feed_likes.story_id));--> statement-breakpoint
CREATE POLICY "stories_audience_gate" ON "stories" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (visibility = 'tenant'
        or ((select app.social_enabled()) and ((select (app.tenant_role() = 'admin_tenant' or app.user_id() = '00000000-0000-0000-0000-000000000000'::uuid)) or author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))))
        or exists (
          select 1
            from public.story_highlight_items i
            join public.story_highlights h on h.id = i.highlight_id and h.tenant_id = i.tenant_id
           where i.story_id = stories.id
             and h.community_id is not null
             and exists (
               select 1 from public.communities c
                where c.id = h.community_id
                  and c.tenant_id = app.tenant_id()
                  and c.deleted_at is null)));--> statement-breakpoint
CREATE POLICY "stories_social_insert_gate" ON "stories" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((app.tenant_role() = 'member' and visibility = 'followers' and (select app.social_enabled())) or (app.tenant_role() <> 'member' and visibility = 'tenant'));