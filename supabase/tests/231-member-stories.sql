begin;
-- 231-member-stories.sql — the audience of a STORY, executed inside Postgres (10-04, MSTORY-04, MSTORY-08,
-- MPUB-04, MCOMM-10, MSTORY-09, MPUB-07; D-705, D-708, D-716, D-717, D-718; T-10-09, T-10-10, T-10-11).
-- The API stamps `visibility` from the session (plan 07); this file proves the DATABASE decides who reads
-- a member story and refuses what a forged claim could try, as the lanes of a tenant with `social` on.
--
-- 1. THE TRACER (MSTORY-04, D-705): a member story (`visibility = 'followers'`) is read by its author, by
--    the author's LIVE follower and by the admin_tenant lane, and NOT by a stranger member, a real
--    support_tenant session or another tenant's lane; an organization story (`'tenant'`) is read by every
--    lane of its tenant. A member lane inserts only `'followers'`, an admin lane only `'tenant'`. The like
--    and the comment of a story carry the story gate (a stranger's insert raises 42501, a follower's works).
--    Every negative sits beside a positive control.
--
-- Fixture ids use the `23100000-…` prefix and the tenants `pgtap-mstory-a` / `pgtap-mstory-b`, used by no
-- other file. Like its siblings, this file ROLLS BACK.
select plan(19);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-mstory-a', 'Stories de membros A', '23100000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-mstory-b', 'Stories de membros B', '23100000-0000-4000-8000-000000000011');
select tests.auth_user('admin@mstory-a.local', '23100000-0000-4000-8000-000000000002');
select tests.auth_user('support@mstory-a.local', '23100000-0000-4000-8000-000000000003');
select tests.auth_user('m1@mstory-a.local', '23100000-0000-4000-8000-000000000004');
select tests.auth_user('m2@mstory-a.local', '23100000-0000-4000-8000-000000000005');
select tests.auth_user('m3@mstory-a.local', '23100000-0000-4000-8000-000000000006');
select tests.auth_user('k@mstory-b.local', '23100000-0000-4000-8000-000000000012');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select tests.member('23100000-0000-4000-8000-000000000011', '23100000-0000-4000-8000-000000000012');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('23100000-0000-4000-8000-000000000001', 'social', true),
  ('23100000-0000-4000-8000-000000000011', 'social', true);
-- M2 follows M1. M3 follows nobody.
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005', '23100000-0000-4000-8000-000000000004');
-- Media: one image asset per story (the admin owns the organization one, M1 the member ones).
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('23100000-0000-4000-8000-0000000000a1', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('23100000-0000-4000-8000-0000000000a2', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('23100000-0000-4000-8000-0000000000a3', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');
-- SO: the organization's story (default visibility), live.
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption)
values ('23100000-0000-4000-8000-0000000000b0', '23100000-0000-4000-8000-000000000001',
        '23100000-0000-4000-8000-000000000002', '23100000-0000-4000-8000-0000000000a1', 'image', 'da organizacao');

-- ── 1. the tracer ──────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004');
select lives_ok(
  $$ insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('23100000-0000-4000-8000-0000000000b1', '23100000-0000-4000-8000-000000000001',
             '23100000-0000-4000-8000-000000000004', '23100000-0000-4000-8000-0000000000a2', 'image', 'de M1', 'followers') $$,
  '1: the member M1 inserts a story stamped followers (social on)');
select throws_ok(
  $$ insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004',
             '23100000-0000-4000-8000-0000000000a3', 'image', 'forjada', 'tenant') $$,
  '42501', null, '1: M1 cannot forge an organization story (visibility tenant): 42501');
select results_eq(
  $$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$,
  ARRAY[1], '1: the author M1 reads their own member story');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select results_eq(
  $$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$,
  ARRAY[1], '1: M2, a live follower of M1, reads the member story');
select results_eq(
  $$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b0' $$,
  ARRAY[1], '1: …and the organization story (positive control)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$,
  ARRAY[1], '1: the admin_tenant lane (the moderator) reads the member story');
select throws_ok(
  $$ insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002',
             '23100000-0000-4000-8000-0000000000a3', 'image', 'forjada', 'followers') $$,
  '42501', null, '1: the admin lane cannot insert a followers story: 42501');
select lives_ok(
  $$ insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002',
             '23100000-0000-4000-8000-0000000000a3', 'image', 'da organizacao 2', 'tenant') $$,
  '1: the admin lane inserts an organization story (positive control)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select results_eq(
  $$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$,
  ARRAY[0], '1: M3, a stranger, reads zero rows of the member story');
select results_eq(
  $$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b0' $$,
  ARRAY[1], '1: …but reads the organization story (positive control)');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, story_id)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006', '23100000-0000-4000-8000-0000000000b1') $$,
  '42501', null, '1: a stranger cannot like the member story: 42501');
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, story_id, author_user_id, body)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000b1', '23100000-0000-4000-8000-000000000006', 'intruso') $$,
  '42501', null, '1: a stranger cannot comment on the member story: 42501');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, story_id, author_user_id, body)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000b0', '23100000-0000-4000-8000-000000000006', 'na da organizacao') $$,
  '1: …but comments on the organization story (positive control)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, story_id)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005', '23100000-0000-4000-8000-0000000000b1') $$,
  '1: the follower M2 likes the member story (positive control)');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, story_id, author_user_id, body)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000b1', '23100000-0000-4000-8000-000000000005', 'do seguidor') $$,
  '1: the follower M2 comments on the member story (positive control)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select results_eq(
  $$ select count(*)::int from public.feed_comments where story_id = '23100000-0000-4000-8000-0000000000b1' $$,
  ARRAY[0], '1: the stranger M3 reads zero comments of the member story');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000003', 'support_tenant');
select results_eq(
  $$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$,
  ARRAY[0], '1: a REAL support_tenant session reads zero rows of the member story (D-475)');
select results_eq(
  $$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b0' $$,
  ARRAY[1], '1: …and reads the organization story (positive control)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000011', '23100000-0000-4000-8000-000000000012');
select results_eq(
  $$ select count(*)::int from public.stories where id in ('23100000-0000-4000-8000-0000000000b1', '23100000-0000-4000-8000-0000000000b0') $$,
  ARRAY[0], '1: K of tenant B reads neither story of tenant A');
reset role;

select * from finish();
rollback;
