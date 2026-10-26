-- feed_posts_deleted_community_gate (09.3-06, PEND-05; D-555, D-556, D-544 [informational]) — the
-- structural backstop that hides a soft-deleted community's posts from every tenant lane. GENERATED
-- by drizzle-kit from packages/modules/feed/db/schema.ts; the one statement below is drizzle-kit's,
-- unchanged. It sorts AFTER `*_community_soft_delete_gate.sql`, which creates the function it calls
-- (`app.community_deleted_ids()`).
--
-- Restrictive, so it ANDs with `feed_posts_tenant_isolation` and every other gate and can only
-- narrow. The comments and likes gates test the post through an inner `exists (select 1 from
-- feed_posts)`, so a hidden post hides its comments and refuses likes (42501) with no change to them.
-- No row is touched: clearing `deleted_at` on the community shows everything again.

CREATE POLICY "feed_posts_deleted_community_gate" ON "feed_posts" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (community_id is null or community_id <> all (coalesce((select app.community_deleted_ids()), '{}'::uuid[])));
