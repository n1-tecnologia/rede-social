-- feed_community_audience (10-03, MCOMM-08, MPUB-04, MPUB-07; D-701, D-702, D-708, D-718) — the GENERATED half
-- of the third post audience. `feed_posts.visibility` gains `'community'`: a post in a MEMBER-created community,
-- readable by whoever reads that community, never in Início, Explorar or Reels "Todos". It is an INSERT gate
-- branch for the owner of an active member community (plus ONE reserved branch that calls the kernel stub
-- `app.community_action_allowed`, which answers false until the Escopo phase, so no behaviour changes), a
-- select-gate branch with no `social` term (D-718) and no follow test (D-701), and the new RESTRICTIVE
-- `feed_posts_member_hidden_community_gate` (a blocked or departed creator's posts leave every read, D-708).
-- Both functions it calls are declared by `*_member_communities_functions.sql`, which sorts earlier.
--
-- Expand-only (MPUB-07): the two CHECKs are dropped and re-added WIDER (the 09-07 `moderation_log` precedent),
-- so every existing row still satisfies them and no row is touched; one policy is added and two are altered in
-- place. No table or column is dropped or changed in type.
ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_visibility_chk";--> statement-breakpoint
ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_visibility_shape_chk";--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_visibility_chk" CHECK ("feed_posts"."visibility" in ('tenant','followers','community'));--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_visibility_shape_chk" CHECK ("feed_posts"."visibility" = 'tenant' or ("feed_posts"."visibility" = 'followers' and "feed_posts"."community_id" is null) or ("feed_posts"."visibility" = 'community' and "feed_posts"."community_id" is not null));--> statement-breakpoint
CREATE POLICY "feed_posts_member_hidden_community_gate" ON "feed_posts" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (community_id is null or community_id <> all (coalesce((select app.member_community_hidden_ids()), '{}'::uuid[])));--> statement-breakpoint
ALTER POLICY "feed_posts_social_gate" ON "feed_posts" TO authenticated USING (visibility = 'tenant' or visibility = 'community' or ((select app.social_enabled()) and ((select (app.tenant_role() = 'admin_tenant' or app.user_id() = '00000000-0000-0000-0000-000000000000'::uuid)) or author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])))));--> statement-breakpoint
ALTER POLICY "feed_posts_social_insert_gate" ON "feed_posts" TO authenticated WITH CHECK ((app.tenant_role() = 'member' and visibility = 'followers' and community_id is null and (select app.social_enabled())) or (app.tenant_role() <> 'member' and visibility = 'tenant') or (app.tenant_role() = 'member' and visibility = 'community' and community_id is not null and (select app.social_enabled()) and exists (select 1 from public.communities c where c.id = community_id and c.tenant_id = app.tenant_id() and c.kind = 'member' and c.created_by_user_id = app.user_id() and c.status = 'active' and c.deleted_at is null)) or (app.tenant_role() = 'member' and visibility = 'community' and community_id is not null and app.community_action_allowed(community_id, 'post')));