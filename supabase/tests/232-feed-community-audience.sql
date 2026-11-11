begin;
-- 232-feed-community-audience.sql — the THIRD post audience, executed inside Postgres (10-03, MCOMM-08, MPUB-04,
-- MPUB-07; D-701, D-702, D-708, D-718). `feed_posts.visibility` gains `'community'`: a post in a MEMBER-created
-- community, readable by whoever reads that community, never the organization's voice.
--
-- 1. THE CHECK MATRIX (as the migration role): the three allowed shapes pass; a `'followers'` post with a community,
--    a `'community'` post without one and an unknown value raise 23514.
-- 2. THE INSERT GATE (as the member lane): the owner of an active member community inserts a `'community'` post;
--    another member, an admin lane and a post into an ORGANIZATION community raise 42501 (the last one is the Escopo
--    seam: the reserved branch calls `app.community_action_allowed`, which answers false), each beside a positive
--    control.
--
-- Fixture ids use the `23200000-…` prefix and the tenants `pgtap-mpost-a` / `pgtap-mpost-b`. Like its siblings,
-- this file ROLLS BACK.
select plan(10);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-mpost-a', 'Posts de comunidades de membros A', '23200000-0000-4000-8000-000000000001');
select tests.auth_user('admin@mpost-a.local', '23200000-0000-4000-8000-000000000002');
select tests.auth_user('m1@mpost-a.local', '23200000-0000-4000-8000-000000000004');
select tests.auth_user('m2@mpost-a.local', '23200000-0000-4000-8000-000000000005');
select tests.member('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004');
select tests.member('23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000005');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('23200000-0000-4000-8000-000000000001', 'social', true);
-- CO: an ORGANIZATION community (the admin's). CM: M1's MEMBER community (sentinel position).
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position) values
  ('23200000-0000-4000-8000-0000000000c1', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000002', 'Da organizacao', 'da-organizacao', 'organization', 0),
  ('23200000-0000-4000-8000-0000000000c2', '23200000-0000-4000-8000-000000000001', '23200000-0000-4000-8000-000000000004', 'Da M1', 'da-m1', 'member', 1000000);

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

select * from finish();
rollback;
