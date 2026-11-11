begin;
-- 230-member-communities.sql — the creator rule for COMMUNITIES, executed inside Postgres (10-03, MCOMM-01,
-- MCOMM-07, MPUB-04; D-706, D-707, D-708, D-718). The API stamps `kind`, `created_by_user_id` and `position`
-- from the session (plan 05); this file proves the DATABASE refuses what a forged claim could try, and that the
-- legitimate writer keeps working, as the `member` lane of a tenant with `social` on.
--
-- 1. THE TRACER: a member creates a community stamped `kind = 'member'` (creator = the session user, the sentinel
--    position 1000000); a second member cannot update it; a forged creator, a forged `'organization'` kind and an
--    admin lane inserting `'member'` are refused with 42501. Every negative sits beside a positive control. The
--    Escopo stub `app.community_action_allowed` answers `false` for both member lanes, so the seam changes no answer.
--
-- Fixture ids use the `23000000-…` prefix and the tenants `pgtap-mcomm-a` / `pgtap-mcomm-b`. Like its siblings,
-- this file ROLLS BACK.
select plan(12);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-mcomm-a', 'Comunidades de membros A', '23000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-mcomm-b', 'Comunidades de membros B', '23000000-0000-4000-8000-000000000011');
select tests.auth_user('admin@mcomm-a.local', '23000000-0000-4000-8000-000000000002');
select tests.auth_user('support@mcomm-a.local', '23000000-0000-4000-8000-000000000003');
select tests.auth_user('m1@mcomm-a.local', '23000000-0000-4000-8000-000000000004');
select tests.auth_user('m2@mcomm-a.local', '23000000-0000-4000-8000-000000000005');
select tests.auth_user('k@mcomm-b.local', '23000000-0000-4000-8000-000000000012');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000005');
select tests.member('23000000-0000-4000-8000-000000000011', '23000000-0000-4000-8000-000000000012');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('23000000-0000-4000-8000-000000000001', 'social', true),
  ('23000000-0000-4000-8000-000000000011', 'social', true);

-- ── 1. the tracer: a member creates a community and nothing else ───────────────────────────────
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004');
select lives_ok(
  $$ insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-0000000000c1', '23000000-0000-4000-8000-000000000001',
             '23000000-0000-4000-8000-000000000004', 'Da M1', 'da-m1', 'member', 1000000) $$,
  '1: the member M1 creates a community stamped kind member (own user, sentinel position)');
select results_eq(
  $$ select kind || '/' || position::text || '/' || created_by_user_id::text from public.communities
      where id = '23000000-0000-4000-8000-0000000000c1' $$,
  ARRAY['member/1000000/23000000-0000-4000-8000-000000000004'::text],
  '1: …and the row carries kind member, position 1000000 and M1 as creator');
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000005', 'Forjada', 'forjada', 'member', 1000000) $$,
  '42501', null, '1: M1 cannot create a community in another member''s name (forged creator)');
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004', 'Da organizacao', 'da-organizacao', 'organization', 0) $$,
  '42501', null, '1: M1 cannot create an organization community (forged kind)');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000005');
select lives_ok(
  $$ insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-0000000000c2', '23000000-0000-4000-8000-000000000001',
             '23000000-0000-4000-8000-000000000005', 'Da M2', 'da-m2', 'member', 1000000) $$,
  '1: the second member M2 creates their own community (positive control)');
select results_eq(
  $$ with u as (update public.communities set name = 'Roubada' where id = '23000000-0000-4000-8000-0000000000c1' returning 1) select count(*)::int from u $$,
  ARRAY[0], '1: M2 cannot update M1''s community: zero rows (the update gate narrows)');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004');
select results_eq(
  $$ with u as (update public.communities set name = 'Da M1, editada' where id = '23000000-0000-4000-8000-0000000000c1' returning 1) select count(*)::int from u $$,
  ARRAY[1], '1: M1 updates their own community: one row (positive control)');
select is(app.community_action_allowed('23000000-0000-4000-8000-0000000000c1'::uuid, 'post'), false,
  '1: the Escopo stub answers false for the creator lane');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000005');
select is(app.community_action_allowed('23000000-0000-4000-8000-0000000000c1'::uuid, 'post'), false,
  '1: the Escopo stub answers false for another member lane');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'Do admin como membro', 'do-admin-membro', 'member', 1000000) $$,
  '42501', null, '1: an admin_tenant lane cannot insert kind member');
select lives_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'Da organizacao', 'da-org', 'organization', 0) $$,
  '1: the admin_tenant lane inserts kind organization (positive control)');
reset role;

select * from finish();
rollback;
