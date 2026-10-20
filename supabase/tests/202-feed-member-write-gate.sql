begin;
-- 202-feed-member-write-gate.sql — what the MEMBER lane may not write, executed inside Postgres (09-14,
-- WR-07; SOCIAL-03, SOCIAL-06; D-473, T-04-54 [informational]; T-09-49, T-09-50). Numbered 202 after 201.
--
-- The service decides authorship (`updatePost` and `softDeletePost` filter on `author_user_id`, nothing in it
-- hard-deletes). This file proves the DATABASE refuses what a regressed statement would try, and that the
-- legitimate writers keep working:
--
-- 1. THE CATALOG: five RESTRICTIVE policies (`feed_posts_member_delete_gate`, `feed_post_media_member_insert_gate`,
--    `feed_post_media_member_update_gate`, `feed_post_media_member_delete_gate`, `feed_comments_member_delete_gate`),
--    each for `authenticated`, each for one command. The guard function is SECURITY INVOKER with an empty
--    search_path, and the trigger is BEFORE UPDATE FOR EACH ROW on feed_posts. A documented ABSENCE: no guard
--    trigger on feed_comments (planning decision 3 of 09-14: the D-334 cascade and the like counter move rows
--    of other members legitimately).
-- 2. DELETE: a member's hard delete of a post, a comment or a media row it did not write touches ZERO rows
--    (a USING-filtered delete matches nothing and raises nothing); the author's touches one; the admin's one.
-- 3. MEDIA WRITES: a member cannot insert (42501) or update (zero rows) a media row of a post it did not write;
--    the author and the admin can.
-- 4. THE UPDATE GUARD (BEFORE UPDATE, not an UPDATE policy: the counter triggers run as the invoker, and a
--    USING-filtered UPDATE matches zero rows WITHOUT an error, so the like and comment counts of every post a
--    member reacts to would drift silently): on a post it did not write a member may move ONLY like_count and
--    comment_count; nobody in a member lane may move author_user_id, visibility, community_id or tenant_id;
--    the author edits and soft-deletes their own; the admin soft-deletes with deleted_by_user_id; the system
--    lane and the staff lane are not held.
-- 5. THE COUNTER REGRESSION (the reason the review's UPDATE policy was NOT used): like, unlike, comment,
--    soft-delete on an organization post and on a followee's post move the counts, and the D-334 cascade (an
--    author deletes their own root comment together with another member's reply) drops the count by 2.
--
-- Fixture ids use the `20200000-…` prefix and the tenants `pgtap-fwrite-a` / `pgtap-fwrite-b`. Like its
-- siblings, this file ROLLS BACK.
select plan(61);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-fwrite-a', 'Feed write A', '20200000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-fwrite-b', 'Feed write B', '20200000-0000-4000-8000-000000000011');
select tests.auth_user('admin@fwrite-a.local', '20200000-0000-4000-8000-000000000002');
select tests.auth_user('support@fwrite-a.local', '20200000-0000-4000-8000-000000000003');
select tests.auth_user('m1@fwrite-a.local', '20200000-0000-4000-8000-000000000004');
select tests.auth_user('m2@fwrite-a.local', '20200000-0000-4000-8000-000000000005');
select tests.auth_user('m3@fwrite-a.local', '20200000-0000-4000-8000-000000000006');
select tests.auth_user('k@fwrite-b.local', '20200000-0000-4000-8000-000000000012');
insert into public.memberships (tenant_id, user_id, role, status) values
  ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000002', 'admin_tenant', 'active'),
  ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000003', 'support_tenant', 'active'),
  ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'member', 'active'),
  ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000005', 'member', 'active'),
  ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000006', 'member', 'active'),
  ('20200000-0000-4000-8000-000000000011', '20200000-0000-4000-8000-000000000012', 'member', 'active');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('20200000-0000-4000-8000-000000000001', 'social', true),
  ('20200000-0000-4000-8000-000000000011', 'social', true);
-- M2 follows M1 (so M2 can read M1's followers posts); M3 follows nobody.
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000005', '20200000-0000-4000-8000-000000000004');
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, description) values
  ('20200000-0000-4000-8000-0000000000c1', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000002', 'Um', 'um', '');
-- ORG: the admin's organization post (visible to every lane; the counter target). Pa: M1's followers post
-- with a gallery (the subject of the negatives). Pb, Pc: M1's gallery posts whose media row the author and
-- the admin delete. Pd, Pe: M1's posts the author and the admin hard-delete. Pf, Pg: soft-delete targets.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, media_kind) values
  ('20200000-0000-4000-8000-000000000b01', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000002', 'organizacao', 'tenant', 'none'),
  ('20200000-0000-4000-8000-000000000b11', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'de M1', 'followers', 'gallery'),
  ('20200000-0000-4000-8000-000000000b12', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'de M1, b', 'followers', 'gallery'),
  ('20200000-0000-4000-8000-000000000b13', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'de M1, c', 'followers', 'gallery'),
  ('20200000-0000-4000-8000-000000000b14', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'de M1, d', 'followers', 'none'),
  ('20200000-0000-4000-8000-000000000b15', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'de M1, e', 'followers', 'none'),
  ('20200000-0000-4000-8000-000000000b16', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'de M1, f', 'followers', 'none'),
  ('20200000-0000-4000-8000-000000000b17', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'de M1, g', 'followers', 'none');
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('20200000-0000-4000-8000-0000000000a1', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20200000-0000-4000-8000-0000000000a2', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20200000-0000-4000-8000-0000000000a3', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20200000-0000-4000-8000-0000000000a4', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20200000-0000-4000-8000-0000000000a5', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('20200000-0000-4000-8000-0000000000a6', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}');
insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position) values
  ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b11', 'gallery', '20200000-0000-4000-8000-0000000000a1', 'image', 0),
  ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b12', 'gallery', '20200000-0000-4000-8000-0000000000a2', 'image', 0),
  ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b13', 'gallery', '20200000-0000-4000-8000-0000000000a3', 'image', 0);
-- Comments on ORG (the counter target): c11 root by M1 with c12 reply by M3 (the D-334 cascade), c13 by M1
-- (the author hard-deletes), c14 by M1 (the admin hard-deletes). ORG.comment_count is 4 after these.
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind) values
  ('20200000-0000-4000-8000-000000000c11', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b01', '20200000-0000-4000-8000-000000000004', 'raiz de M1', 0, null, null, null),
  ('20200000-0000-4000-8000-000000000c13', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b01', '20200000-0000-4000-8000-000000000004', 'de M1, 13', 0, null, null, null),
  ('20200000-0000-4000-8000-000000000c14', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b01', '20200000-0000-4000-8000-000000000004', 'de M1, 14', 0, null, null, null);
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind) values
  ('20200000-0000-4000-8000-000000000c12', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b01', '20200000-0000-4000-8000-000000000006', 'resposta de M3', 1, '20200000-0000-4000-8000-000000000c11', 0, 'post');

-- ── 1. the catalog ─────────────────────────────────────────────────────────────────────────────
select is((select permissive || '/' || cmd || '/' || roles::text from pg_policies
            where schemaname = 'public' and tablename = 'feed_posts' and policyname = 'feed_posts_member_delete_gate'),
  'RESTRICTIVE/DELETE/{authenticated}', '1: feed_posts_member_delete_gate is RESTRICTIVE, for DELETE, to authenticated');
select is((select permissive || '/' || cmd || '/' || roles::text from pg_policies
            where schemaname = 'public' and tablename = 'feed_post_media' and policyname = 'feed_post_media_member_insert_gate'),
  'RESTRICTIVE/INSERT/{authenticated}', '1: feed_post_media_member_insert_gate is RESTRICTIVE, for INSERT, to authenticated');
select is((select permissive || '/' || cmd || '/' || roles::text from pg_policies
            where schemaname = 'public' and tablename = 'feed_post_media' and policyname = 'feed_post_media_member_update_gate'),
  'RESTRICTIVE/UPDATE/{authenticated}', '1: feed_post_media_member_update_gate is RESTRICTIVE, for UPDATE, to authenticated');
select is((select permissive || '/' || cmd || '/' || roles::text from pg_policies
            where schemaname = 'public' and tablename = 'feed_post_media' and policyname = 'feed_post_media_member_delete_gate'),
  'RESTRICTIVE/DELETE/{authenticated}', '1: feed_post_media_member_delete_gate is RESTRICTIVE, for DELETE, to authenticated');
select is((select permissive || '/' || cmd || '/' || roles::text from pg_policies
            where schemaname = 'public' and tablename = 'feed_comments' and policyname = 'feed_comments_member_delete_gate'),
  'RESTRICTIVE/DELETE/{authenticated}', '1: feed_comments_member_delete_gate is RESTRICTIVE, for DELETE, to authenticated');
select is((select prosecdef from pg_proc where oid = to_regprocedure('app.feed_posts_member_update_guard()')), false,
  '1: the guard function is SECURITY INVOKER (not definer)');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = to_regprocedure('app.feed_posts_member_update_guard()')),
  '1: the guard function pins search_path to the empty string');
select is((select tgtype::int from pg_trigger
            where tgrelid = 'public.feed_posts'::regclass and tgname = 'feed_posts_member_update_guard' and not tgisinternal),
  19, '1: the guard trigger is BEFORE UPDATE FOR EACH ROW on public.feed_posts (tgtype 19)');
select is_empty(
  $$ select 1 from pg_trigger where tgrelid = 'public.feed_comments'::regclass and not tgisinternal and tgname like '%guard%' $$,
  '1: no guard trigger exists on feed_comments (deliberate non-guard, 09-14 planning decision 3)');

-- ── 2. DELETE: not what you did not write ──────────────────────────────────────────────────────
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000005');
select results_eq(
  $$ with d as (delete from public.feed_posts where id = '20200000-0000-4000-8000-000000000b11' returning 1) select count(*)::int from d $$,
  ARRAY[0], '2: the follower M2 hard-deletes M1''s post: zero rows');
select results_eq(
  $$ with d as (delete from public.feed_comments where id = '20200000-0000-4000-8000-000000000c13' returning 1) select count(*)::int from d $$,
  ARRAY[0], '2: M2 hard-deletes M1''s comment: zero rows');
select results_eq(
  $$ with d as (delete from public.feed_post_media where post_id = '20200000-0000-4000-8000-000000000b11' returning 1) select count(*)::int from d $$,
  ARRAY[0], '2: M2 hard-deletes the media row of M1''s post: zero rows');
reset role;
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004');
select results_eq(
  $$ with d as (delete from public.feed_posts where id = '20200000-0000-4000-8000-000000000b14' returning 1) select count(*)::int from d $$,
  ARRAY[1], '2: the author M1 hard-deletes their own post: one row (positive control)');
select results_eq(
  $$ with d as (delete from public.feed_comments where id = '20200000-0000-4000-8000-000000000c13' returning 1) select count(*)::int from d $$,
  ARRAY[1], '2: M1 hard-deletes their own comment: one row (positive control)');
select results_eq(
  $$ with d as (delete from public.feed_post_media where post_id = '20200000-0000-4000-8000-000000000b12' returning 1) select count(*)::int from d $$,
  ARRAY[1], '2: M1 hard-deletes the media row of their own post: one row (positive control)');
reset role;
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ with d as (delete from public.feed_posts where id = '20200000-0000-4000-8000-000000000b15' returning 1) select count(*)::int from d $$,
  ARRAY[1], '2: the admin_tenant hard-deletes a member post: one row (positive control)');
select results_eq(
  $$ with d as (delete from public.feed_comments where id = '20200000-0000-4000-8000-000000000c14' returning 1) select count(*)::int from d $$,
  ARRAY[1], '2: the admin_tenant hard-deletes a member comment: one row (positive control)');
select results_eq(
  $$ with d as (delete from public.feed_post_media where post_id = '20200000-0000-4000-8000-000000000b13' returning 1) select count(*)::int from d $$,
  ARRAY[1], '2: the admin_tenant hard-deletes the media row of a member post: one row (positive control)');
reset role;
select tests.as_tenant('20200000-0000-4000-8000-000000000011', '20200000-0000-4000-8000-000000000012');
select results_eq(
  $$ with d as (delete from public.feed_posts where id = '20200000-0000-4000-8000-000000000b11' returning 1) select count(*)::int from d $$,
  ARRAY[0], '2: another tenant''s member hard-deletes tenant A''s post: zero rows');
reset role;
select tests.as_tenant_without_claims();
select results_eq(
  $$ with d as (delete from public.feed_posts where id = '20200000-0000-4000-8000-000000000b11' returning 1) select count(*)::int from d $$,
  ARRAY[0], '2: a lane with no claims hard-deletes nothing');
reset role;
select results_eq(
  $$ select (select count(*) from public.feed_posts where id = '20200000-0000-4000-8000-000000000b11')::int
          + (select count(*) from public.feed_post_media where post_id = '20200000-0000-4000-8000-000000000b11')::int $$,
  ARRAY[2], '2: M1''s post and its media row are still there after every refused delete');

-- ── 3. media writes: not on a post you did not write ───────────────────────────────────────────
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000005');
select throws_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b11', 'gallery', '20200000-0000-4000-8000-0000000000a4', 'image', 3) $$,
  '42501', null, '3: M2 cannot attach media to M1''s post (feed_post_media_member_insert_gate)');
select results_eq(
  $$ with u as (update public.feed_post_media set position = 9 where post_id = '20200000-0000-4000-8000-000000000b11' returning 1) select count(*)::int from u $$,
  ARRAY[0], '3: M2 cannot reorder the media of M1''s post: zero rows');
reset role;
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004');
select lives_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b11', 'gallery', '20200000-0000-4000-8000-0000000000a5', 'image', 1) $$,
  '3: the author M1 attaches media to their own post (positive control)');
select results_eq(
  $$ with u as (update public.feed_post_media set position = 5 where post_id = '20200000-0000-4000-8000-000000000b11' and position = 0 returning 1) select count(*)::int from u $$,
  ARRAY[1], '3: M1 reorders the media of their own post: one row (positive control)');
reset role;
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b11', 'gallery', '20200000-0000-4000-8000-0000000000a6', 'image', 2) $$,
  '3: the admin_tenant attaches media to a member post (positive control)');
select results_eq(
  $$ with u as (update public.feed_post_media set position = 8 where post_id = '20200000-0000-4000-8000-000000000b11' and position = 5 returning 1) select count(*)::int from u $$,
  ARRAY[1], '3: the admin_tenant reorders the media of a member post: one row (positive control)');
reset role;

-- ── 4. the BEFORE UPDATE guard ─────────────────────────────────────────────────────────────────
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000005');
select throws_ok(
  $$ update public.feed_posts set caption = 'reescrito' where id = '20200000-0000-4000-8000-000000000b11' $$,
  '42501', null, '4: M2 cannot edit the caption of M1''s post');
select throws_ok(
  $$ update public.feed_posts set deleted_at = now(), deleted_by_user_id = '20200000-0000-4000-8000-000000000005' where id = '20200000-0000-4000-8000-000000000b11' $$,
  '42501', null, '4: M2 cannot soft-delete M1''s post');
select lives_ok(
  $$ update public.feed_posts set like_count = 7 where id = '20200000-0000-4000-8000-000000000b12' $$,
  '4: M2 can move like_count of M1''s post (counter columns only)');
select results_eq(
  $$ select like_count from public.feed_posts where id = '20200000-0000-4000-8000-000000000b12' $$,
  ARRAY[7], '4: …and the counter moved');
reset role;
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004');
select lives_ok(
  $$ update public.feed_posts set caption = 'editado', edited_at = now() where id = '20200000-0000-4000-8000-000000000b11' $$,
  '4: the author M1 edits the caption of their own post (positive control)');
select throws_ok(
  $$ update public.feed_posts set visibility = 'tenant' where id = '20200000-0000-4000-8000-000000000b11' $$,
  '42501', null, '4: M1 cannot change the visibility of their own post');
select throws_ok(
  $$ update public.feed_posts set author_user_id = '20200000-0000-4000-8000-000000000005' where id = '20200000-0000-4000-8000-000000000b11' $$,
  '42501', null, '4: M1 cannot reassign the author of their own post');
select throws_ok(
  $$ update public.feed_posts set community_id = '20200000-0000-4000-8000-0000000000c1' where id = '20200000-0000-4000-8000-000000000b11' $$,
  '42501', null, '4: M1 cannot move their own post into a community');
select throws_ok(
  $$ update public.feed_posts set tenant_id = '20200000-0000-4000-8000-000000000011' where id = '20200000-0000-4000-8000-000000000b11' $$,
  '42501', null, '4: M1 cannot move their own post to another tenant');
select lives_ok(
  $$ update public.feed_posts set deleted_at = now(), deleted_by_user_id = '20200000-0000-4000-8000-000000000004' where id = '20200000-0000-4000-8000-000000000b16' $$,
  '4: the author M1 soft-deletes their own post (positive control)');
reset role;
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ update public.feed_posts set deleted_at = now(), deleted_by_user_id = '20200000-0000-4000-8000-000000000002' where id = '20200000-0000-4000-8000-000000000b17' $$,
  '4: the admin_tenant soft-deletes a member post with deleted_by_user_id (the moderator takedown)');
select results_eq(
  $$ select deleted_by_user_id::text from public.feed_posts where id = '20200000-0000-4000-8000-000000000b17' and deleted_at is not null $$,
  ARRAY['20200000-0000-4000-8000-000000000002'::text], '4: …stamped with the moderator');
select lives_ok(
  $$ update public.feed_posts set caption = 'moderado' where id = '20200000-0000-4000-8000-000000000b11' $$,
  '4: the staff lane is not held by the guard (admin_tenant edits a member post)');
reset role;
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select lives_ok(
  $$ update public.feed_posts set caption = 'sistema' where id = '20200000-0000-4000-8000-000000000b11' $$,
  '4: the system lane (zero user, support_tenant claim) updates freely');
reset role;
select tests.as_tenant('20200000-0000-4000-8000-000000000011', '20200000-0000-4000-8000-000000000012');
select results_eq(
  $$ with u as (update public.feed_posts set caption = 'invasor' where id = '20200000-0000-4000-8000-000000000b11' returning 1) select count(*)::int from u $$,
  ARRAY[0], '4: another tenant''s member updates nothing of tenant A (zero rows)');
reset role;
select tests.as_tenant_without_claims();
select results_eq(
  $$ with u as (update public.feed_posts set caption = 'sem claims' where id = '20200000-0000-4000-8000-000000000b11' returning 1) select count(*)::int from u $$,
  ARRAY[0], '4: a lane with no claims updates nothing (zero rows)');
reset role;

-- ── 5. the counters still move (the reason the review's UPDATE policy was not used) ────────────
-- ORG.comment_count is 2 here: c11 and c12 are live, c13 and c14 were hard-deleted in section 2.
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000005');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id) values ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000005', '20200000-0000-4000-8000-000000000b01') $$,
  '5: M2 likes the organization post');
select results_eq($$ select like_count from public.feed_posts where id = '20200000-0000-4000-8000-000000000b01' $$, ARRAY[1],
  '5: …like_count of the organization post is 1');
select lives_ok(
  $$ delete from public.feed_likes where user_id = '20200000-0000-4000-8000-000000000005' and post_id = '20200000-0000-4000-8000-000000000b01' $$,
  '5: M2 unlikes it');
select results_eq($$ select like_count from public.feed_posts where id = '20200000-0000-4000-8000-000000000b01' $$, ARRAY[0],
  '5: …like_count is back to 0');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id) values ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000005', '20200000-0000-4000-8000-000000000b11') $$,
  '5: M2 likes the post of a followee');
select results_eq($$ select like_count from public.feed_posts where id = '20200000-0000-4000-8000-000000000b11' $$, ARRAY[1],
  '5: …like_count of the followee''s post is 1');
select lives_ok(
  $$ delete from public.feed_likes where user_id = '20200000-0000-4000-8000-000000000005' and post_id = '20200000-0000-4000-8000-000000000b11' $$,
  '5: M2 unlikes the followee''s post');
select results_eq($$ select like_count from public.feed_posts where id = '20200000-0000-4000-8000-000000000b11' $$, ARRAY[0],
  '5: …like_count is back to 0');
select lives_ok(
  $$ insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
     values ('20200000-0000-4000-8000-000000000c21', '20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b01', '20200000-0000-4000-8000-000000000005', 'de M2', 0, null, null, null) $$,
  '5: M2 comments on the organization post');
select results_eq($$ select comment_count from public.feed_posts where id = '20200000-0000-4000-8000-000000000b01' $$, ARRAY[3],
  '5: …comment_count of the organization post goes from 2 to 3');
select lives_ok(
  $$ update public.feed_comments set deleted_at = now(), deleted_by_user_id = '20200000-0000-4000-8000-000000000005' where id = '20200000-0000-4000-8000-000000000c21' $$,
  '5: M2 soft-deletes their own comment');
select results_eq($$ select comment_count from public.feed_posts where id = '20200000-0000-4000-8000-000000000b01' $$, ARRAY[2],
  '5: …comment_count is back to 2');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
     values ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000b11', '20200000-0000-4000-8000-000000000005', 'de M2 em M1', 0, null, null, null) $$,
  '5: M2 comments on the followee''s post');
select results_eq($$ select comment_count from public.feed_posts where id = '20200000-0000-4000-8000-000000000b11' $$, ARRAY[1],
  '5: …comment_count of the followee''s post is 1');
select lives_ok(
  $$ update public.feed_comments set deleted_at = now(), deleted_by_user_id = '20200000-0000-4000-8000-000000000005'
      where post_id = '20200000-0000-4000-8000-000000000b11' and author_user_id = '20200000-0000-4000-8000-000000000005' $$,
  '5: M2 soft-deletes it');
select results_eq($$ select comment_count from public.feed_posts where id = '20200000-0000-4000-8000-000000000b11' $$, ARRAY[0],
  '5: …comment_count is back to 0');
reset role;
select tests.as_tenant('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-000000000004');
select results_eq(
  $$ with u as (update public.feed_comments set deleted_at = now(), deleted_by_user_id = '20200000-0000-4000-8000-000000000004'
                 where (id = '20200000-0000-4000-8000-000000000c11' or parent_id = '20200000-0000-4000-8000-000000000c11') and post_id is not null and deleted_at is null returning 1)
     select count(*)::int from u $$,
  ARRAY[2], '5: M1 deletes their root comment together with M3''s reply (the D-334 cascade): two rows');
select results_eq($$ select comment_count from public.feed_posts where id = '20200000-0000-4000-8000-000000000b01' $$, ARRAY[0],
  '5: …comment_count of the organization post drops by 2 (from 2 to 0)');
reset role;

select * from finish();
rollback;
