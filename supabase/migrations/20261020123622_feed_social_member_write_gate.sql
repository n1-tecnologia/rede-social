-- feed_social_member_write_gate (09-14, WR-07; SOCIAL-03, SOCIAL-06; D-473, T-04-54 [informational]; T-09-49)
-- — generated from `packages/modules/feed/db/schema.ts`: five RESTRICTIVE policies that stop the MEMBER lane
-- from hard-deleting a post or a comment it did not write and from inserting, updating or deleting a
-- `feed_post_media` row of a post it did not write. Restrictive policies AND with the tenant isolation policy
-- and can only narrow it; the admin and the system lanes (any non-`member` claim) keep every write the service
-- issues today. A null role makes the predicate null, which denies (fail closed).
--
-- The UPDATE half of WR-07 is NOT a policy and is the next file (`*_feed_member_update_guard.sql`): a
-- restrictive UPDATE policy would silently zero the like and comment counters, which move as the invoker.
-- Expand-only: five `CREATE POLICY`, nothing dropped or renamed.
CREATE POLICY "feed_comments_member_delete_gate" ON "feed_comments" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (app.tenant_role() <> 'member' or author_user_id = app.user_id());--> statement-breakpoint
CREATE POLICY "feed_post_media_member_insert_gate" ON "feed_post_media" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (app.tenant_role() <> 'member' or exists (select 1 from public.feed_posts p where p.id = feed_post_media.post_id and p.author_user_id = app.user_id()));--> statement-breakpoint
CREATE POLICY "feed_post_media_member_update_gate" ON "feed_post_media" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (app.tenant_role() <> 'member' or exists (select 1 from public.feed_posts p where p.id = feed_post_media.post_id and p.author_user_id = app.user_id())) WITH CHECK (app.tenant_role() <> 'member' or exists (select 1 from public.feed_posts p where p.id = feed_post_media.post_id and p.author_user_id = app.user_id()));--> statement-breakpoint
CREATE POLICY "feed_post_media_member_delete_gate" ON "feed_post_media" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (app.tenant_role() <> 'member' or exists (select 1 from public.feed_posts p where p.id = feed_post_media.post_id and p.author_user_id = app.user_id()));--> statement-breakpoint
CREATE POLICY "feed_posts_member_delete_gate" ON "feed_posts" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (app.tenant_role() <> 'member' or author_user_id = app.user_id());