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
-- 2. THE REST OF THE LANE TABLE: the system lane (support claim + the zero user) reads the member story, a
--    lane with a null role claim and a lane with no claims read none (the organization story is the control).
-- 3. `social` OFF (D-718): the author, the follower, the admin and the system lane read zero member stories
--    while the organization story stays visible; a story held by a highlight of a readable community stays
--    readable by every lane (branch 3 carries no `social` term) and a story held only by an Inicio highlight
--    does not become readable.
-- 4. LIVENESS (D-708): blocking, soft-deleting the membership of the author hides the member story from the
--    follower and from branch 3 (the community answers hidden), the moderator keeps reading it (D-717);
--    unblocking or restoring brings it back; unfollow and re-follow toggle the follower lane; nothing is deleted.
-- 5. THE INSERT GATE negatives with controls: a member with `social` off, a null-role lane, a real support
--    lane inserting `'followers'`, an unknown audience (23514) and the column default (`'tenant'`).
-- 6. THE HIGHLIGHT BRANCH under a controlled clock (D-716): a 30 hour old member story is outside the strip
--    window yet readable by a stranger through the highlight of an active member community, and not readable
--    through the highlight of a soft-deleted community.
-- 7. LIKES AND COMMENTS (T-10-09): a stranger reads none of a member story's likes or comments and cannot
--    write them; a highlight reader can; rows without `story_id` are untouched.
-- 8. THE MEDIA GATE (assumption A5, T-10-11): `app.media_asset_hidden` hides the video of a followers-only
--    story from a stranger, not from the author, the follower, the admin or the system lane, not once a
--    readable highlight holds it, keeps a soft-deleted followers story closed to everyone but the staff
--    exemption, and answers per `social` and per the hidden creator.
-- 9. CATALOG: each new policy exists as RESTRICTIVE with its command; the column and the function hardening.
-- 10. THE PLAN: the Inicio strip statement (it names `visibility = 'tenant'`) never seq-scans `stories` or
--    `story_views` and reads `story_views_uq` as an Index Only Scan with the constant tenant predicate, both in the
--    member lane with every gate in place and as the migration role (120's pin, no policies). Bitmap scans are
--    off for the EXPLAIN, because the planner flips between a correlated probe and a hashed subplan with the
--    statistics of whatever ran before.
-- 11. THE AUTHORS READ PLAN (10-08, A10, T-10-32): the index chosen by measurement (`10-08-SPIKE.md`, `CHOSEN_FORM:
--    LATERAL`, `stories_tenant_author_expires_idx`) exists by name with its partial predicate, and on a controlled
--    volume (6000 live member stories over 50 authors, 400 organization ones) the member read (3 followees) and the
--    moderator's page 1 walk it BY NAME, never seq-scan `stories`, and the member read's seen-flag probe stays an
--    Index Only Scan on `story_views_uq`. Section 10's strip pins are untouched.
--
-- Fixture ids use the `23100000-…` prefix and the tenants `pgtap-mstory-a` / `pgtap-mstory-b`, used by no
-- other file. Like its siblings, this file ROLLS BACK.
select plan(106);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-mstory-a', 'Stories de membros A', '23100000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-mstory-b', 'Stories de membros B', '23100000-0000-4000-8000-000000000011');
select tests.auth_user('admin@mstory-a.local', '23100000-0000-4000-8000-000000000002');
select tests.auth_user('support@mstory-a.local', '23100000-0000-4000-8000-000000000003');
select tests.auth_user('m1@mstory-a.local', '23100000-0000-4000-8000-000000000004');
select tests.auth_user('m2@mstory-a.local', '23100000-0000-4000-8000-000000000005');
select tests.auth_user('m3@mstory-a.local', '23100000-0000-4000-8000-000000000006');
select tests.auth_user('m4@mstory-a.local', '23100000-0000-4000-8000-000000000007');
select tests.auth_user('k@mstory-b.local', '23100000-0000-4000-8000-000000000012');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000007');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select tests.member('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select tests.member('23100000-0000-4000-8000-000000000011', '23100000-0000-4000-8000-000000000012');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('23100000-0000-4000-8000-000000000001', 'social', true),
  ('23100000-0000-4000-8000-000000000011', 'social', true);
-- M2 follows M1 and M4. M3 follows nobody.
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005', '23100000-0000-4000-8000-000000000004'),
  ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005', '23100000-0000-4000-8000-000000000007');
-- Media: one image asset per story (the admin owns the organization one, M1 the member ones).
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('23100000-0000-4000-8000-0000000000a1', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('23100000-0000-4000-8000-0000000000a2', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('23100000-0000-4000-8000-0000000000a3', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');
-- SO: the organization's story (default visibility), live.
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption)
values ('23100000-0000-4000-8000-0000000000b0', '23100000-0000-4000-8000-000000000001',
        '23100000-0000-4000-8000-000000000002', '23100000-0000-4000-8000-0000000000a1', 'image', 'da organizacao');

-- More assets: images a5..a7 for the stories below, videos f1 (SV1), f2 (B2 in a readable highlight), f3 (a
-- soft-deleted story), f6 (B6 in a deleted community's highlight). The function under test never reads the kind.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('23100000-0000-4000-8000-0000000000a5', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000007', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('23100000-0000-4000-8000-0000000000a6', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('23100000-0000-4000-8000-0000000000a7', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('23100000-0000-4000-8000-0000000000f1', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('23100000-0000-4000-8000-0000000000f2', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('23100000-0000-4000-8000-0000000000f3', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('23100000-0000-4000-8000-0000000000f6', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');
-- Communities: CM1 (a member community of M1) and CM4 (of M4), both live; CD, an organization community that is
-- soft-deleted (the rows stay, `deleted_at` set).
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position, deleted_at) values
  ('23100000-0000-4000-8000-0000000000c1', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', 'Da M1', 'da-m1', 'member', 1000000, null),
  ('23100000-0000-4000-8000-0000000000c4', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000007', 'Da M4', 'da-m4', 'member', 1000000, null),
  ('23100000-0000-4000-8000-0000000000cd', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'Apagada', 'apagada', 'organization', 5, now());
-- Member stories (followers), as the migration role. B2: M1, fresh, held by a highlight of CM1. B3: M4, held by a
-- highlight of CM4. B5: M1, 30 hours old (expired), held by a highlight of CM1. B6: M3, 30 hours old, held ONLY by
-- a highlight of the deleted community CD. B8: M1, held ONLY by an Inicio highlight (no community). B9: M1, no
-- highlight (SV1, the media gate's plain case). BA: M1, SOFT-DELETED (the media gate's deleted case).
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at, deleted_at) values
  ('23100000-0000-4000-8000-0000000000b2', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', '23100000-0000-4000-8000-0000000000f2', 'video', 'B2', 'followers', now() - interval '1 hour', now() + interval '23 hours', null),
  ('23100000-0000-4000-8000-0000000000b3', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000007', '23100000-0000-4000-8000-0000000000a5', 'image', 'B3', 'followers', now() - interval '1 hour', now() + interval '23 hours', null),
  ('23100000-0000-4000-8000-0000000000b5', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', '23100000-0000-4000-8000-0000000000a6', 'image', 'B5', 'followers', now() - interval '30 hours', now() - interval '6 hours', null),
  ('23100000-0000-4000-8000-0000000000b6', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006', '23100000-0000-4000-8000-0000000000f6', 'video', 'B6', 'followers', now() - interval '30 hours', now() - interval '6 hours', null),
  ('23100000-0000-4000-8000-0000000000b8', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', '23100000-0000-4000-8000-0000000000a7', 'image', 'B8', 'followers', now() - interval '1 hour', now() + interval '23 hours', null),
  ('23100000-0000-4000-8000-0000000000b9', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', '23100000-0000-4000-8000-0000000000f1', 'video', 'B9', 'followers', now() - interval '1 hour', now() + interval '23 hours', null),
  ('23100000-0000-4000-8000-0000000000ba', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', '23100000-0000-4000-8000-0000000000f3', 'video', 'BA', 'followers', now() - interval '1 hour', now() + interval '23 hours', now());
insert into public.story_highlights (id, tenant_id, community_id, title, position, created_by_user_id) values
  ('23100000-0000-4000-8000-0000000000e1', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000c1', 'H CM1', 1, '23100000-0000-4000-8000-000000000002'),
  ('23100000-0000-4000-8000-0000000000e4', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000c4', 'H CM4', 1, '23100000-0000-4000-8000-000000000002'),
  ('23100000-0000-4000-8000-0000000000ed', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000cd', 'H CD', 1, '23100000-0000-4000-8000-000000000002'),
  ('23100000-0000-4000-8000-0000000000ee', '23100000-0000-4000-8000-000000000001', null, 'H Inicio', 1, '23100000-0000-4000-8000-000000000002');
insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id) values
  ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000e1', '23100000-0000-4000-8000-0000000000b2', '23100000-0000-4000-8000-000000000002'),
  ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000e1', '23100000-0000-4000-8000-0000000000b5', '23100000-0000-4000-8000-000000000002'),
  ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000e4', '23100000-0000-4000-8000-0000000000b3', '23100000-0000-4000-8000-000000000002'),
  ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000ed', '23100000-0000-4000-8000-0000000000b6', '23100000-0000-4000-8000-000000000002'),
  ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000ee', '23100000-0000-4000-8000-0000000000b8', '23100000-0000-4000-8000-000000000002');
-- An organization post with a comment: the rows WITHOUT `story_id` that the story gates must leave alone.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility)
values ('23100000-0000-4000-8000-0000000000d1', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'post da organizacao', 'tenant');
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
values ('23100000-0000-4000-8000-0000000000d2', '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-0000000000d1',
        '23100000-0000-4000-8000-000000000002', 'comentario no post', 0, null, null, null);

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

-- ── 2. the rest of the lane table ───────────────────────────────────────────────────────────────
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[1], '2: the SYSTEM lane (support claim with the zero user) reads the member story');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '23100000-0000-4000-8000-000000000006', 'role', 'authenticated', 'tenant_id', '23100000-0000-4000-8000-000000000001')::text, true), set_config('role', 'authenticated', true);
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[0], '2: a lane with a NULL role claim reads zero rows of the member story (null never satisfies the staff term)');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b0' $$, ARRAY[1], '2: …and reads the organization story (positive control)');
reset role;
select tests.as_tenant_without_claims();
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[0], '2: a lane with no claims reads zero rows of the member story');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b0' $$, ARRAY[0], '2: …and of the organization story (tenant isolation, unchanged)');
reset role;

-- ── 3. `social` OFF (D-718): the audience terms close, the highlight branch does not ──────────────
update public.tenant_modules set enabled = false where tenant_id = '23100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[0], '3: social off: the author reads zero member stories');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[0], '3: social off: the follower reads zero member stories');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[0], '3: social off: the admin reads zero member stories (off hides everything)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[0], '3: social off: the system lane reads zero member stories');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b0' $$, ARRAY[1], '3: social off: the organization story stays visible (positive control)');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b2' $$, ARRAY[1], '3: social off: a member story held by a highlight of a readable community stays readable (branch 3, no social term)');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b8' $$, ARRAY[0], '3: social off: a story held only by an Inicio highlight is not readable');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000003', 'support_tenant');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b2' $$, ARRAY[1], '3: social off: a real support lane reads the highlight story too (it reads the community)');
reset role;
update public.tenant_modules set enabled = true where tenant_id = '23100000-0000-4000-8000-000000000001' and module_key = 'social';

-- ── 4. liveness (D-708): blocking or removing the author hides, restoring brings back, nothing is deleted ─
update public.memberships set status = 'blocked', blocked_at = now() where tenant_id = '23100000-0000-4000-8000-000000000001' and user_id = '23100000-0000-4000-8000-000000000004';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[0], '4: blocking M1 removes their member story from the follower M2''s lane');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b2' $$, ARRAY[0], '4: …and a story held by a highlight of M1''s own community (the community answers hidden: branch 3 closes)');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b3' $$, ARRAY[1], '4: …while the live M4''s story stays (positive control)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b2' $$, ARRAY[0], '4: …and from a stranger who would have read it through the highlight');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[1], '4: the moderator keeps reading a blocked author''s member story (D-717)');
reset role;
update public.memberships set status = 'active', blocked_at = null, deleted_at = null where tenant_id = '23100000-0000-4000-8000-000000000001' and user_id = '23100000-0000-4000-8000-000000000004';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[1], '4: unblocking M1 restores the story in the follower''s lane (nothing was deleted)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b2' $$, ARRAY[1], '4: …and the highlight branch for a stranger');
reset role;
update public.memberships set deleted_at = now() where tenant_id = '23100000-0000-4000-8000-000000000001' and user_id = '23100000-0000-4000-8000-000000000004';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[0], '4: removing M1 (membership deleted_at) hides the story from the follower');
reset role;
update public.memberships set status = 'active', blocked_at = null, deleted_at = null where tenant_id = '23100000-0000-4000-8000-000000000001' and user_id = '23100000-0000-4000-8000-000000000004';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[1], '4: restoring the membership brings it back');
reset role;
delete from public.social_follows where tenant_id = '23100000-0000-4000-8000-000000000001' and follower_user_id = '23100000-0000-4000-8000-000000000005' and followee_user_id = '23100000-0000-4000-8000-000000000004';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[0], '4: unfollowing M1 removes the story from M2''s lane');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b3' $$, ARRAY[1], '4: …while the other followee M4''s story stays');
reset role;
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005', '23100000-0000-4000-8000-000000000004');
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[1], '4: following M1 again restores the story');
reset role;
update public.memberships set status = 'blocked', blocked_at = now() where tenant_id = '23100000-0000-4000-8000-000000000001' and user_id = '23100000-0000-4000-8000-000000000007';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b3' $$, ARRAY[0], '4: blocking M4 hides the story held by the highlight of M4''s community from a stranger');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b3' $$, ARRAY[0], '4: …and from M4''s follower');
reset role;
update public.memberships set status = 'active', blocked_at = null, deleted_at = null where tenant_id = '23100000-0000-4000-8000-000000000001' and user_id = '23100000-0000-4000-8000-000000000007';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b3' $$, ARRAY[1], '4: unblocking M4 restores it through the highlight');
reset role;

-- ── 5. the insert gate negatives, each beside a positive control (T-10-10) ─────────────────────────
update public.tenant_modules set enabled = false where tenant_id = '23100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', '23100000-0000-4000-8000-0000000000a3', 'image', 'sem social', 'followers') $$,
  '42501', null, '5: with social off a member cannot insert even a followers story: 42501');
reset role;
update public.tenant_modules set enabled = true where tenant_id = '23100000-0000-4000-8000-000000000001' and module_key = 'social';
select set_config('request.jwt.claims', json_build_object('sub', '23100000-0000-4000-8000-000000000004', 'role', 'authenticated', 'tenant_id', '23100000-0000-4000-8000-000000000001')::text, true), set_config('role', 'authenticated', true);
select throws_ok(
  $$ insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', '23100000-0000-4000-8000-0000000000a3', 'image', 'sem papel', 'tenant') $$,
  '42501', null, '5: a lane with a null role claim cannot insert an organization story: 42501');
select throws_ok(
  $$ insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004', '23100000-0000-4000-8000-0000000000a3', 'image', 'sem papel', 'followers') $$,
  '42501', null, '5: …nor a followers story (null makes every branch false-or-null)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000003', 'support_tenant');
select throws_ok(
  $$ insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000003', '23100000-0000-4000-8000-0000000000a3', 'image', 'suporte', 'followers') $$,
  '42501', null, '5: a real support lane cannot insert a followers story: 42501');
select lives_ok(
  $$ insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000003', '23100000-0000-4000-8000-0000000000a3', 'image', 'suporte', 'tenant') $$,
  '5: …but inserts an organization story (positive control)');
reset role;
select throws_ok(
  $$ insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', '23100000-0000-4000-8000-0000000000a3', 'image', 'desconhecida', 'public') $$,
  '23514', null, '5: an unknown audience raises 23514 on stories_visibility_chk (migration role)');
select results_eq($$ select visibility from public.stories where id = '23100000-0000-4000-8000-0000000000b0' $$, ARRAY['tenant'::text],
  '5: a story inserted with no audience carries the column default tenant (the backfill of every existing story)');

-- ── 6. the highlight branch under a controlled clock (D-716) ───────────────────────────────────────
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b5' and expires_at > now() $$, ARRAY[0], '6: B5 (30 hours old) is outside the strip window');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b5' $$, ARRAY[1], '6: …yet a stranger reads it by id through the highlight of an active member community');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b8' $$, ARRAY[0], '6: a story held only by an Inicio highlight is not opened by it (a stranger reads zero)');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b6' $$, ARRAY[1], '6: the author M3 reads their own 30 hour old story (positive control)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004');
select results_eq($$ select count(*)::int from public.stories where id = '23100000-0000-4000-8000-0000000000b6' $$, ARRAY[0], '6: a story held only by the highlight of a SOFT-DELETED community is not readable by another member');
reset role;

-- ── 7. likes and comments follow the story gate; rows without story_id are untouched ───────────────
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, story_id) values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006', '23100000-0000-4000-8000-0000000000b2') $$,
  '7: a stranger likes a member story that a readable highlight holds (branch 3 opens the like)');
select results_eq($$ select count(*)::int from public.feed_likes where story_id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[0], '7: the stranger reads zero likes of the followers-only story B1');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id) values ('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006', '23100000-0000-4000-8000-0000000000d1') $$,
  '7: a like on a POST (no story_id) is untouched by the story gate');
select results_eq($$ select count(*)::int from public.feed_comments where id = '23100000-0000-4000-8000-0000000000d2' $$, ARRAY[1], '7: a post comment (no story_id) stays readable');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.feed_likes where story_id = '23100000-0000-4000-8000-0000000000b1' $$, ARRAY[1], '7: the follower reads the like on the story B1 (positive control)');
reset role;

-- ── 8. the media gate (assumption A5, T-10-11) ──────────────────────────────────────────────────────
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f1'), true, '8: the video of a followers-only story is hidden from a stranger');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f2'), false, '8: …not once a readable highlight holds the story');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f3'), true, '8: a SOFT-DELETED followers story stays closed to a stranger (the takedown does not reopen it)');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000a1'), false, '8: the asset of an organization story is never hidden (positive control)');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000a2'), true, '8: the asset of a stranger-hidden story with no highlight (B1) is hidden');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f6'), false, '8: the author reads their own story''s video even when only a deleted community holds it');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000004');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f1'), false, '8: not hidden from the author');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f3'), true, '8: a soft-deleted story is closed even to its author (the staff exemption only, as for posts)');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f6'), true, '8: a story held only by a deleted community''s highlight stays hidden from another member');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f1'), false, '8: not hidden from a live follower');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f1'), false, '8: not hidden from the admin (moderator view)');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f3'), false, '8: …and the deleted story stays open to the admin (evidence)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f1'), false, '8: not hidden from the system lane (workers keep reading)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000003', 'support_tenant');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f1'), true, '8: a REAL support lane is not exempt: hidden');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000011', '23100000-0000-4000-8000-000000000012');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f1'), false, '8: false in another tenant''s lane (tenant pin)');
reset role;
update public.tenant_modules set enabled = false where tenant_id = '23100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f1'), true, '8: with social off even the follower is refused (D-483)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f1'), true, '8: …and the admin');
reset role;
update public.tenant_modules set enabled = true where tenant_id = '23100000-0000-4000-8000-000000000001' and module_key = 'social';
update public.memberships set status = 'blocked', blocked_at = now() where tenant_id = '23100000-0000-4000-8000-000000000001' and user_id = '23100000-0000-4000-8000-000000000004';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000005');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f1'), true, '8: blocking the author closes the video to the follower (D-708)');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f2'), true, '8: …and the video held by a highlight of the now-hidden community');
reset role;
update public.memberships set status = 'active', blocked_at = null, deleted_at = null where tenant_id = '23100000-0000-4000-8000-000000000001' and user_id = '23100000-0000-4000-8000-000000000004';
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000f2'), false, '8: restoring the author reopens it');
reset role;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000006');
select is(app.media_asset_hidden('23100000-0000-4000-8000-0000000000ff'), false, '8: an asset on no story and no post answers false');
reset role;

-- ── 9. catalog ──────────────────────────────────────────────────────────────────────────────────────
select results_eq($$ select permissive || '/' || cmd from pg_policies where schemaname = 'public' and tablename = 'stories' and policyname = 'stories_audience_gate' $$, ARRAY['RESTRICTIVE/SELECT'::text], '9: stories_audience_gate exists as RESTRICTIVE for SELECT');
select results_eq($$ select permissive || '/' || cmd from pg_policies where schemaname = 'public' and tablename = 'stories' and policyname = 'stories_social_insert_gate' $$, ARRAY['RESTRICTIVE/INSERT'::text], '9: stories_social_insert_gate exists as RESTRICTIVE for INSERT');
select results_eq($$ select permissive || '/' || cmd from pg_policies where schemaname = 'public' and tablename = 'feed_comments' and policyname = 'feed_comments_story_gate' $$, ARRAY['RESTRICTIVE/SELECT'::text], '9: feed_comments_story_gate exists as RESTRICTIVE for SELECT');
select results_eq($$ select permissive || '/' || cmd from pg_policies where schemaname = 'public' and tablename = 'feed_comments' and policyname = 'feed_comments_story_insert_gate' $$, ARRAY['RESTRICTIVE/INSERT'::text], '9: feed_comments_story_insert_gate exists as RESTRICTIVE for INSERT');
select results_eq($$ select permissive || '/' || cmd from pg_policies where schemaname = 'public' and tablename = 'feed_likes' and policyname = 'feed_likes_story_gate' $$, ARRAY['RESTRICTIVE/SELECT'::text], '9: feed_likes_story_gate exists as RESTRICTIVE for SELECT');
select results_eq($$ select permissive || '/' || cmd from pg_policies where schemaname = 'public' and tablename = 'feed_likes' and policyname = 'feed_likes_story_insert_gate' $$, ARRAY['RESTRICTIVE/INSERT'::text], '9: feed_likes_story_insert_gate exists as RESTRICTIVE for INSERT');
select col_not_null('public', 'stories', 'visibility', '9: stories.visibility is not null');
select col_default_is('public', 'stories', 'visibility', 'tenant', '9: stories.visibility defaults to tenant');
select is((select prosecdef::text || '/' || coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid = 'app.media_asset_hidden(uuid)'::regprocedure), 'true/search_path=""', '9: app.media_asset_hidden is a SECURITY DEFINER with an empty search_path');
select ok(has_function_privilege('authenticated', 'app.media_asset_hidden(uuid)', 'execute') and not has_function_privilege('anon', 'app.media_asset_hidden(uuid)', 'execute'), '9: EXECUTE for authenticated and not for anon');

-- ── 10. the strip plan: story_views_uq stays an Index Only Scan with the constant tenant predicate ───
select tests.auth_user('views-' || g || '@231.local', ('23100000-0000-4000-8200-' || lpad(to_hex(g), 12, '0'))::uuid)
  from generate_series(1, 50) g;
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at)
select ('23100000-0000-4000-8300-' || lpad(to_hex(g), 12, '0'))::uuid, '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002', '23100000-0000-4000-8000-0000000000a1', 'image',
       'volume ' || g, now() - (g || ' minutes')::interval, now() + interval '24 hours' - (g || ' minutes')::interval
  from generate_series(1, 400) g;
insert into public.story_views (tenant_id, user_id, story_id)
select '23100000-0000-4000-8000-000000000001', ('23100000-0000-4000-8200-' || lpad(to_hex(u), 12, '0'))::uuid, ('23100000-0000-4000-8300-' || lpad(to_hex(g), 12, '0'))::uuid
  from generate_series(1, 50) u cross join generate_series(1, 400) g;
analyze public.stories;
analyze public.story_views;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8200-000000000001');
-- The planner's choice between a correlated probe and a hashed subplan of the viewer's own rows flips with the
-- table statistics of whatever ran before this file; bitmap scans are switched off (the 180 precedent) so the
-- pin is on the INDEX the subplan reads, which is the fact worth pinning.
set local enable_bitmapscan = off;
do $$
declare
  r record;
  v_plan text := '';
begin
  for r in execute
    'explain select s.id,
            exists (select 1 from public.story_views v
                     where v.tenant_id = ''23100000-0000-4000-8000-000000000001''
                       and v.user_id = ''23100000-0000-4000-8200-000000000001''
                       and v.story_id = s.id) as viewer_seen
       from public.stories s
      where s.tenant_id = ''23100000-0000-4000-8000-000000000001''
        and s.deleted_at is null and s.visibility = ''tenant'' and s.expires_at > now()
      order by s.expires_at desc, s.id desc limit 26'
  loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  perform set_config('tests.strip_plan', v_plan, true);
end
$$;
reset enable_bitmapscan;
select matches(current_setting('tests.strip_plan'), 'Index Only Scan using story_views_uq', '10: the viewer_seen subplan is an Index Only Scan on story_views_uq BY NAME with every gate in place (member lane)');
select ok(current_setting('tests.strip_plan') not like '%Seq Scan on story_views%', '10: …and never a Seq Scan on story_views');
select ok(current_setting('tests.strip_plan') not like '%Seq Scan on stories%', '10: …and never a Seq Scan on stories (the strip names visibility, so the walk does not run the audience disjunction)');
reset role;

reset role;
-- The planner's choice between a correlated probe and a hashed subplan of the viewer's own rows flips with the
-- table statistics of whatever ran before this file; bitmap scans are switched off (the 180 precedent) so the
-- pin is on the INDEX the subplan reads, which is the fact worth pinning.
set local enable_bitmapscan = off;
do $$
declare
  r record;
  v_plan text := '';
begin
  for r in execute
    'explain select s.id,
            exists (select 1 from public.story_views v
                     where v.tenant_id = ''23100000-0000-4000-8000-000000000001''
                       and v.user_id = ''23100000-0000-4000-8200-000000000001''
                       and v.story_id = s.id) as viewer_seen
       from public.stories s
      where s.tenant_id = ''23100000-0000-4000-8000-000000000001''
        and s.deleted_at is null and s.visibility = ''tenant'' and s.expires_at > now()
      order by s.expires_at desc, s.id desc limit 26'
  loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  perform set_config('tests.strip_plan_owner', v_plan, true);
end
$$;
reset enable_bitmapscan;
select matches(current_setting('tests.strip_plan_owner'), 'Index Only Scan using story_views_uq', '10: as the migration role (120''s pin, no policies) the same statement is an Index Only Scan on story_views_uq with the constant tenant predicate');

-- ── 11. the authors read plan: stories_tenant_author_expires_idx by name (10-08, A10) ──────────────────
-- (`pg_indexes` prints `DESC NULLS FIRST` as plain `DESC`: for a descending key that is Postgres' default.)
reset role;
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'stories' and indexname = 'stories_tenant_author_expires_idx'), '11: the authors-read index stories_tenant_author_expires_idx exists by name');
select ok((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'stories_tenant_author_expires_idx') like '%(tenant_id, author_user_id, expires_at DESC, id DESC)%'
          and (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'stories_tenant_author_expires_idx') like '%visibility = ''followers''%'
          and (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'stories_tenant_author_expires_idx') like '%deleted_at IS NULL%', '11: …with the columns and the partial predicate the SPIKE file records');
-- A controlled volume: the 50 `views-` users become members, write 6000 live member stories between them, and
-- user 1 follows users 2..4 (a member with 3 followees in a tenant full of member stories).
select tests.member('23100000-0000-4000-8000-000000000001', ('23100000-0000-4000-8200-' || lpad(to_hex(g), 12, '0'))::uuid)
  from generate_series(1, 50) g;
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at)
select ('23100000-0000-4000-8400-' || lpad(to_hex(g), 12, '0'))::uuid, '23100000-0000-4000-8000-000000000001',
       ('23100000-0000-4000-8200-' || lpad(to_hex(1 + (g % 50)), 12, '0'))::uuid,
       '23100000-0000-4000-8000-0000000000a1', 'image', 'membro ' || g, 'followers',
       now() - (g * 14 || ' seconds')::interval, now() - (g * 14 || ' seconds')::interval + interval '24 hours'
  from generate_series(1, 6000) g;
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
select '23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8200-000000000001', ('23100000-0000-4000-8200-' || lpad(to_hex(g), 12, '0'))::uuid
  from generate_series(2, 4) g;
analyze public.stories;
analyze public.story_views;
analyze public.memberships;
analyze public.member_profiles;
analyze public.social_follows;
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8200-000000000001');
set local enable_bitmapscan = off;
do $$
declare
  r record;
  v_plan text := '';
begin
  for r in execute
    'explain select am.id as membership_id, ap.display_name, ap.avatar_asset_id, agg.story_count, agg.latest, agg.has_unseen,
            (am.user_id = ''23100000-0000-4000-8200-000000000001''::uuid) as is_self
       from unnest(coalesce((select app.social_visible_author_ids()), ''{}''::uuid[])) as f(uid)
       join public.memberships am on am.tenant_id = ''23100000-0000-4000-8000-000000000001''::uuid and am.user_id = f.uid
            and am.status = ''active'' and am.blocked_at is null and am.deleted_at is null
       left join public.member_profiles ap on ap.membership_id = am.id
      cross join lateral (
        select count(*)::int as story_count, max(s.published_at) as latest,
               bool_or(not exists (select 1 from public.story_views v
                                    where v.tenant_id = ''23100000-0000-4000-8000-000000000001''::uuid
                                      and v.user_id = ''23100000-0000-4000-8200-000000000001''::uuid
                                      and v.story_id = s.id)) as has_unseen
          from public.stories s
          join public.media_assets a on a.id = s.media_asset_id and a.status = ''ready''
         where s.tenant_id = ''23100000-0000-4000-8000-000000000001''::uuid and s.author_user_id = f.uid
           and s.visibility = ''followers'' and s.deleted_at is null and s.expires_at > now()
      ) agg
      where (select app.social_enabled()) and agg.story_count > 0 and not app.is_blocked_by_viewer(f.uid)
      order by is_self desc, agg.has_unseen desc, agg.latest desc, am.id
      limit 200'
  loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  perform set_config('tests.authors_member_plan', v_plan, true);
end
$$;
reset enable_bitmapscan;
select matches(current_setting('tests.authors_member_plan'), 'stories_tenant_author_expires_idx', '11: the member authors read walks stories_tenant_author_expires_idx BY NAME (3 followees, 6000 member stories)');
select ok(current_setting('tests.authors_member_plan') not like '%Seq Scan on stories%', '11: …and never a Seq Scan on stories');
select matches(current_setting('tests.authors_member_plan'), 'Index Only Scan using story_views_uq', '11: …and the seen-flag probe is an Index Only Scan on story_views_uq (the strip pin, 120, unchanged)');
reset role;
-- The moderator's page 1 (the admin lane): every live member with a live member story, newest first, keyset.
select tests.as_tenant('23100000-0000-4000-8000-000000000001', '23100000-0000-4000-8000-000000000002');
set local enable_bitmapscan = off;
do $$
declare
  r record;
  v_plan text := '';
begin
  for r in execute
    'explain select am.id as membership_id, ap.display_name, ap.avatar_asset_id, agg.story_count, agg.latest, agg.has_unseen
       from public.memberships am
       left join public.member_profiles ap on ap.membership_id = am.id
      cross join lateral (
        select count(*)::int as story_count, max(s.published_at) as latest,
               bool_or(not exists (select 1 from public.story_views v
                                    where v.tenant_id = ''23100000-0000-4000-8000-000000000001''::uuid
                                      and v.user_id = ''23100000-0000-4000-8000-000000000002''::uuid
                                      and v.story_id = s.id)) as has_unseen
          from public.stories s
          join public.media_assets a on a.id = s.media_asset_id and a.status = ''ready''
         where s.tenant_id = ''23100000-0000-4000-8000-000000000001''::uuid and s.author_user_id = am.user_id
           and s.visibility = ''followers'' and s.deleted_at is null and s.expires_at > now()
      ) agg
      where am.tenant_id = ''23100000-0000-4000-8000-000000000001''::uuid and am.status = ''active'' and am.blocked_at is null and am.deleted_at is null
        and (select app.social_enabled()) and agg.story_count > 0
      order by agg.latest desc, am.id
      limit 21'
  loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  perform set_config('tests.authors_mod_plan', v_plan, true);
end
$$;
reset enable_bitmapscan;
select matches(current_setting('tests.authors_mod_plan'), 'stories_tenant_author_expires_idx', '11: the moderator''s authors read (page 1) walks stories_tenant_author_expires_idx BY NAME');
select ok(current_setting('tests.authors_mod_plan') not like '%Seq Scan on stories%', '11: …and never a Seq Scan on stories');
reset role;

select * from finish();
rollback;
