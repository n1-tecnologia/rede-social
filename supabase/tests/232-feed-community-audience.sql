begin;
-- 232-feed-community-audience.sql — the THIRD post audience, executed inside Postgres (10-03, MCOMM-08, MPUB-04,
-- MPUB-07; D-701, D-702, D-708, D-718; EP-45, EP-46). `feed_posts.visibility` gains `'community'`: a post in a
-- MEMBER-created community, readable by whoever reads that community, never the organization's voice.
--
-- 1. THE CHECK MATRIX (as the migration role): the three allowed shapes pass; a `'followers'` post with a community,
--    a `'community'` post without one and an unknown value raise 23514.
-- 2. THE INSERT GATE (as the member lane): the owner of an active member community inserts a `'community'` post;
--    another member, an admin lane, a null community and a post into an ORGANIZATION community raise 42501 (the
--    last is the Escopo seam: the reserved branch calls `app.community_action_allowed`, which answers false), each
--    beside a positive control.
-- 3. THE SELECT TRUTH TABLE: every live lane of the tenant reads a `'community'` post (no follower test, no
--    staff exemption needed), another tenant and a lane with no claims read nothing, `social` off still reads it
--    (D-718), and the followers post of the same author stays hidden from a stranger (the new branch widened nothing).
-- 4. THE HIDDEN CREATOR (D-708): a blocked creator's community posts leave every read (the moderator included), the
--    same statement still returns a live creator's post, comments are hidden and likes refused (42501) through the
--    inner `exists`, unblocking restores everything; a soft-deleted community hides its posts as before.
-- 5. THE INSERT GATE, the rest of the table: `social` off, an archived community, a deleted community, another
--    tenant's community, a null role, a null user, a forged `'tenant'` and a followers post with a community each
--    raise 42501 (RLS runs before the CHECKs); the admin's organization post passes.
-- 6. THE ALLOW-LIST GUARD (EP-45): each forbidden column one at a time raises 42501; the allow-listed columns, the
--    counters, the author's soft delete and a non-author counter bump succeed.
-- 7. THE INDEXES: the three partial feed indexes still exist by name, and on a volume fixture Início's two reads
--    are still served by them BY NAME with the new gates in place.
--
-- Fixture ids use the `23200000-…` prefix and the tenants `pgtap-mpost-a` / `pgtap-mpost-b`. Like its siblings,
-- this file ROLLS BACK.
select plan(56);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-mpost-a', 'Posts de comunidades de membros A', '23200000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-mpost-b', 'Posts de comunidades de membros B', '23200000-0000-4000-8000-000000000011');
select tests.auth_user('admin@mpost-a.local', '23200000-0000-4000-8000-000000000002');
select tests.auth_user('support@mpost-a.local', '23200000-0000-4000-8000-000000000003');
select tests.auth_user('m1@mpost-a.local', '23200000-0000-4000-8000-000000000004');
select tests.auth_user('m2@mpost-a.local', '23200000-0000-4000-8000-000000000005');
select tests.auth_user('m3@mpost-a.local', '23200000-0000-4000-8000-000000000006');
select tests.auth_user('k@mpost-b.local', '23200000-0000-4000-8000-000000000012');
select tests.member('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004');
select tests.member('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005');
select tests.member('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000006');
select tests.member('23200000-0000-4000-8000-000000000011', '23200000-0000-4000-8000-000000000012');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('23200000-0000-4000-8000-000000000001', 'social', true),
  ('23200000-0000-4000-8000-000000000011', 'social', true);
-- C1: an ORGANIZATION community (the admin's). C2: M1's MEMBER community. C3: M3's. C6: M1's, ARCHIVED. C7: M1's,
-- SOFT-DELETED. C8: a member community of B (K's), the "another tenant's community" case.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position, status, deleted_at) values
  ('23200000-0000-4000-8000-0000000000c1', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'Da organizacao', 'da-organizacao', 'organization', 0, 'active', null),
  ('23200000-0000-4000-8000-0000000000c2', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'Da M1', 'da-m1', 'member', 1000000, 'active', null),
  ('23200000-0000-4000-8000-0000000000c3', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000006', 'Da M3', 'da-m3', 'member', 1000000, 'active', null),
  ('23200000-0000-4000-8000-0000000000c6', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'Arquivada da M1', 'arquivada-m1', 'member', 1000000, 'archived', null),
  ('23200000-0000-4000-8000-0000000000c7', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'Apagada da M1', 'apagada-m1', 'member', 1000000, 'active', now()),
  ('23200000-0000-4000-8000-0000000000c8', '23200000-0000-4000-8000-000000000011', '23200000-0000-4000-8000-000000000012', 'De B', 'de-b', 'member', 1000000, 'active', null);

-- ── 1. the check matrix ────────────────────────────────────────────────────────────────────────
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'de comunidade', 'community', '23200000-0000-4000-8000-0000000000c2') $$,
  '1: a community post with a community id passes the checks');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'x', 'followers', '23200000-0000-4000-8000-0000000000c2') $$,
  '23514', null, '1: a followers post with a community raises 23514 (shape check)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'x', 'community', null) $$,
  '23514', null, '1: a community post without a community raises 23514 (shape check)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'x', 'secret', null) $$,
  '23514', null, '1: an unknown visibility raises 23514 (vocabulary check)');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'da organizacao em comunidade', 'tenant', '23200000-0000-4000-8000-0000000000c1'),
            ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'de seguidores', 'followers', null) $$,
  '1: an organization post in a community and a followers post without one still pass (positive control)');

-- ── 2. the insert gate ─────────────────────────────────────────────────────────────────────────
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'do dono', 'community', '23200000-0000-4000-8000-0000000000c2') $$,
  '2: the owner M1 publishes a community post in their own member community');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'na da organizacao', 'community', '23200000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '2: M1 cannot publish a community post in an ORGANIZATION community (the Escopo branch is false)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'sem comunidade', 'community', null) $$,
  '42501', null, '2: M1 cannot publish a community post with no community id');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005', 'de outro membro', 'community', '23200000-0000-4000-8000-0000000000c2') $$,
  '42501', null, '2: a second member M2 cannot publish in M1''s community');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'admin_tenant');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'do admin', 'community', '23200000-0000-4000-8000-0000000000c2') $$,
  '42501', null, '2: an admin_tenant lane cannot publish a community post (staff writes only tenant)');
reset role;

-- fixtures for sections 3 to 6 (as the migration role). B01: a community post of M1 in C2. B02: a community post of
-- M3 in C3. B03: an organization post without a community. B04: a followers post of M1. B05: a community post of M1
-- in C2, already soft-deleted by M1. B06 and B07: live community posts of M1 in C2 (the forbidden-column subject and
-- the soft-delete subject). B08: a post in the DELETED community C7 (written by the migration role).
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, community_id, deleted_at, deleted_by_user_id) values
  ('23200000-0000-4000-8000-000000000b01', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'b01', 'community', '23200000-0000-4000-8000-0000000000c2', null, null),
  ('23200000-0000-4000-8000-000000000b02', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000006', 'b02', 'community', '23200000-0000-4000-8000-0000000000c3', null, null),
  ('23200000-0000-4000-8000-000000000b03', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'b03', 'tenant', null, null, null),
  ('23200000-0000-4000-8000-000000000b04', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'b04', 'followers', null, null, null),
  ('23200000-0000-4000-8000-000000000b05', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'b05', 'community', '23200000-0000-4000-8000-0000000000c2', now(), '23200000-0000-4000-8000-000000000004'),
  ('23200000-0000-4000-8000-000000000b06', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'b06', 'community', '23200000-0000-4000-8000-0000000000c2', null, null),
  ('23200000-0000-4000-8000-000000000b07', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'b07', 'community', '23200000-0000-4000-8000-0000000000c2', null, null),
  ('23200000-0000-4000-8000-000000000b08', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'b08', 'community', '23200000-0000-4000-8000-0000000000c7', null, null);
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind) values
  ('23200000-0000-4000-8000-000000000d02', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000b02', '23200000-0000-4000-8000-000000000005', 'comentario na b02', 0, null, null, null);

-- ── 3. the SELECT truth table, per lane ────────────────────────────────────────────────────────
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b01' $$,
  ARRAY[1], '3: the author M1 reads their community post');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b01' $$,
  ARRAY[1], '3: a stranger M2 (not a follower) reads it: no follower test (D-701)');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b04' $$,
  ARRAY[0], '3: …while M1''s FOLLOWERS post stays hidden from M2 (the new branch widened nothing)');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b01' $$,
  ARRAY[1], '3: A''s admin_tenant reads it');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000003', 'support_tenant');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b01' $$,
  ARRAY[1], '3: A''s real support_tenant session reads it (it reads the community, not a member timeline)');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b01' $$,
  ARRAY[1], '3: the system lane reads it');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000011', '23200000-0000-4000-8000-000000000012');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b01' $$,
  ARRAY[0], '3: K of tenant B reads nothing of A');
reset role;
select tests.as_tenant_without_claims();
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b01' $$,
  ARRAY[0], '3: a lane with no claims reads nothing');
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '23200000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b01' $$,
  ARRAY[1], '3: social OFF: the community post stays readable (no social term, D-718)');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '23200000-0000-4000-8000-000000000001' and module_key = 'social';

-- ── 4. the hidden creator (D-708) ──────────────────────────────────────────────────────────────
-- M3 owns C3 and B02 (with a comment by M2); M1 owns C2 and B01.
update public.memberships set blocked_at = now()
 where tenant_id = '23200000-0000-4000-8000-000000000001' and user_id = '23200000-0000-4000-8000-000000000006';
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b02' $$,
  ARRAY[0], '4: M3 blocked: the post leaves the moderator''s read');
select results_eq($$ select id::text from public.feed_posts where id in ('23200000-0000-4000-8000-000000000b01', '23200000-0000-4000-8000-000000000b02') $$,
  ARRAY['23200000-0000-4000-8000-000000000b01'::text], '4: …and in the SAME statement the live creator''s post stays visible');
select results_eq($$ select count(*)::int from public.feed_comments where post_id = '23200000-0000-4000-8000-000000000b02' $$,
  ARRAY[0], '4: …its comment is invisible (the inner exists runs under the post gate)');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b02' $$,
  ARRAY[0], '4: …and from another member''s read');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005', '23200000-0000-4000-8000-000000000b02') $$,
  '42501', null, '4: …and a like on it is refused (42501)');
reset role;
update public.memberships set blocked_at = null
 where tenant_id = '23200000-0000-4000-8000-000000000001' and user_id = '23200000-0000-4000-8000-000000000006';
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b02' $$,
  ARRAY[1], '4: M3 unblocked: the post is back, no row was touched');
select results_eq($$ select count(*)::int from public.feed_comments where post_id = '23200000-0000-4000-8000-000000000b02' $$,
  ARRAY[1], '4: …and so is its comment');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005', '23200000-0000-4000-8000-000000000b02') $$,
  '4: …and a like on it works again (positive control)');
-- a SOFT-DELETED community hides its posts as before (the deleted-community gate, untouched)
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b08' $$,
  ARRAY[0], '4: a post in a SOFT-DELETED member community stays hidden (the 09.3 gate is unchanged)');
reset role;
update public.communities set deleted_at = null where id = '23200000-0000-4000-8000-0000000000c7';
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.feed_posts where id = '23200000-0000-4000-8000-000000000b08' $$,
  ARRAY[1], '4: …and restoring the community brings it back');
reset role;
update public.communities set deleted_at = now() where id = '23200000-0000-4000-8000-0000000000c7';

-- ── 5. the insert gate, the rest of the table ──────────────────────────────────────────────────
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'arquivada', 'community', '23200000-0000-4000-8000-0000000000c6') $$,
  '42501', null, '5: the owner cannot publish in an ARCHIVED member community');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'apagada', 'community', '23200000-0000-4000-8000-0000000000c7') $$,
  '42501', null, '5: the owner cannot publish in a DELETED member community');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'forjada', 'tenant', '23200000-0000-4000-8000-0000000000c2') $$,
  '42501', null, '5: a member cannot forge visibility tenant, even in their own community (never the organization''s voice)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'seguidores', 'followers', '23200000-0000-4000-8000-0000000000c2') $$,
  '42501', null, '5: a member cannot publish a followers post with a community (RLS refuses before the shape check)');
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '23200000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'social off', 'community', '23200000-0000-4000-8000-0000000000c2') $$,
  '42501', null, '5: social off: the owner cannot publish (read from SQL, not the flags cache)');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '23200000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('23200000-0000-4000-8000-000000000011', '23200000-0000-4000-8000-000000000012');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000011', '23200000-0000-4000-8000-000000000012', 'de outro tenant', 'community', '23200000-0000-4000-8000-0000000000c2') $$,
  '42501', null, '5: K of tenant B cannot publish into tenant A''s community');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', null);
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'sem papel', 'community', '23200000-0000-4000-8000-0000000000c2') $$,
  '42501', null, '5: EP-46: a lane with a null role claim cannot publish');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', null, 'member');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'sem usuario', 'community', '23200000-0000-4000-8000-0000000000c2') $$,
  '42501', null, '5: EP-46: a member lane with a null user claim cannot publish');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'do admin na organizacao', 'tenant', '23200000-0000-4000-8000-0000000000c1') $$,
  '5: the admin_tenant still publishes an organization post in an organization community (positive control)');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'do dono de novo', 'community', '23200000-0000-4000-8000-0000000000c2') $$,
  '5: …and the owner still publishes in their active community once social is back on (positive control)');
reset role;

-- ── 6. the allow-list guard (EP-45) ────────────────────────────────────────────────────────────
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004');
select throws_ok($$ update public.feed_posts set visibility = 'tenant' where id = '23200000-0000-4000-8000-000000000b06' $$,
  '42501', null, '6: the author cannot change visibility');
select throws_ok($$ update public.feed_posts set community_id = '23200000-0000-4000-8000-0000000000c6' where id = '23200000-0000-4000-8000-000000000b06' $$,
  '42501', null, '6: the author cannot move the post to another community');
select throws_ok($$ update public.feed_posts set author_user_id = '23200000-0000-4000-8000-000000000005' where id = '23200000-0000-4000-8000-000000000b06' $$,
  '42501', null, '6: the author cannot reassign the author');
select throws_ok($$ update public.feed_posts set tenant_id = '23200000-0000-4000-8000-000000000011' where id = '23200000-0000-4000-8000-000000000b06' $$,
  '42501', null, '6: the author cannot change the tenant');
select throws_ok($$ update public.feed_posts set deleted_at = null, deleted_by_user_id = null where id = '23200000-0000-4000-8000-000000000b05' $$,
  '42501', null, '6: the author cannot clear deleted_at (the Phase 9 advisory)');
select throws_ok($$ update public.feed_posts set deleted_by_user_id = '23200000-0000-4000-8000-000000000005' where id = '23200000-0000-4000-8000-000000000b06' $$,
  '42501', null, '6: the author cannot set deleted_by_user_id on its own');
select throws_ok($$ update public.feed_posts set deleted_at = now(), deleted_by_user_id = '23200000-0000-4000-8000-000000000005' where id = '23200000-0000-4000-8000-000000000b06' $$,
  '42501', null, '6: the author cannot stamp another user as the remover');
select throws_ok($$ update public.feed_posts set deleted_at = now() where id = '23200000-0000-4000-8000-000000000b06' $$,
  '42501', null, '6: the author cannot set deleted_at without stamping themself');
select throws_ok($$ update public.feed_posts set created_at = now() - interval '1 year' where id = '23200000-0000-4000-8000-000000000b06' $$,
  '42501', null, '6: the author cannot rewrite created_at (any column outside the allow-list)');
select lives_ok($$ update public.feed_posts set caption = 'editada', media_kind = 'none', link_preview_id = null, edited_at = now() where id = '23200000-0000-4000-8000-000000000b06' $$,
  '6: the author changes the columns updatePost writes (positive control)');
select lives_ok($$ update public.feed_posts set like_count = 3, comment_count = 2 where id = '23200000-0000-4000-8000-000000000b06' $$,
  '6: …and the counter columns');
select lives_ok($$ update public.feed_posts set deleted_at = now(), deleted_by_user_id = '23200000-0000-4000-8000-000000000004' where id = '23200000-0000-4000-8000-000000000b07' $$,
  '6: …and soft-deletes their own post (the service''s transition)');
reset role;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005');
select lives_ok($$ update public.feed_posts set like_count = 9 where id = '23200000-0000-4000-8000-000000000b01' $$,
  '6: a non-author still bumps a counter (the counter triggers run as the invoker)');
select throws_ok($$ update public.feed_posts set caption = 'invasor' where id = '23200000-0000-4000-8000-000000000b01' $$,
  '42501', null, '6: …but a non-author cannot edit the caption');
reset role;

-- ── 7. the indexes: by name, and on a volume fixture ───────────────────────────────────────────
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'feed_posts'
      and indexname in ('feed_posts_tenant_followers_created_idx', 'feed_posts_tenant_org_created_idx', 'feed_posts_tenant_org_nocommunity_created_idx')),
  3, '7: the three partial feed indexes still exist by name');
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, community_id, created_at)
select ('23200000-0000-4000-8000-0000f1' || lpad(to_hex(g), 6, '0'))::uuid, '23200000-0000-4000-8000-000000000001',
       '23200000-0000-4000-8000-000000000002', 'volume organizacao ' || g, 'tenant', null,
       now() - (g * 2 || ' seconds')::interval - interval '1 hour'
  from generate_series(1, 1500) g;
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, community_id, created_at)
select ('23200000-0000-4000-8000-0000f2' || lpad(to_hex(g), 6, '0'))::uuid, '23200000-0000-4000-8000-000000000001',
       '23200000-0000-4000-8000-000000000004', 'volume comunidade ' || g, 'community', '23200000-0000-4000-8000-0000000000c2',
       now() - (g * 2 || ' seconds')::interval - interval '1 hour 1 second'
  from generate_series(1, 4500) g;
analyze public.feed_posts;
create temporary table inicio_plans (name text primary key, plan text);
grant all on inicio_plans to authenticated;
select tests.as_tenant('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005');
do $$
declare
  r record;
  v_plan text;
begin
  v_plan := '';
  for r in execute
    'explain select p.id, p.created_at from public.feed_posts p
      where p.deleted_at is null and p.visibility = ''tenant'' and p.community_id is null
      order by p.created_at desc, p.id desc limit 12'
  loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  insert into inicio_plans values ('nocommunity', v_plan);
  v_plan := '';
  for r in execute
    'explain select p.id, p.created_at from public.feed_posts p
      where p.deleted_at is null and p.visibility = ''tenant''
      order by p.created_at desc, p.id desc limit 12'
  loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  insert into inicio_plans values ('merged', v_plan);
end
$$;
reset role;
select ok((select plan from inicio_plans where name = 'nocommunity') like '%feed_posts_tenant_org_nocommunity_created_idx%'
          and (select plan from inicio_plans where name = 'nocommunity') not like '%Seq Scan on feed_posts%',
  '7: Início with communities off is still served by feed_posts_tenant_org_nocommunity_created_idx BY NAME, never a Seq Scan');
select ok((select plan from inicio_plans where name = 'merged') like '%feed_posts_tenant_org_created_idx%'
          and (select plan from inicio_plans where name = 'merged') not like '%Seq Scan on feed_posts%',
  '7: the merged Início is still served by feed_posts_tenant_org_created_idx BY NAME, never a Seq Scan');

select * from finish();
rollback;
