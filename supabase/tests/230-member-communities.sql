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
-- 2. THE SELECT TRUTH TABLE of a member community and of an organization community, per lane: every live lane of the
--    tenant reads both, another tenant's member and a lane with no claims read nothing.
-- 3. THE HIDDEN-CREATOR TABLE (D-708, EP-26, EP-27): `blocked_at` set, a soft-deleted membership and a status other
--    than `'active'` each hide the community from EVERY lane (the moderator included); clearing each shows it again;
--    a second community by a live creator stays in the same statement; the definer returns `'{}'` (never null) for a
--    tenant with no member communities and for a lane with no claims, and never another tenant's ids.
-- 4. THE SENTINEL AND KIND CHECKS (EP-04, as the migration role): a member row with position 0, 999999 or 1000001
--    raises 23514; an organization row keeps any non-negative position; an unknown kind raises 23514.
-- 5. THE DELETE AND UPDATE GATES: a member lane hard-delete matches zero rows (a USING-filtered DELETE raises nothing;
--    asserted as Postgres actually behaves), the admin lane deletes; a member cannot change `kind` or the creator
--    (42501); the creator archives their own community and the moderator updates any, as positive controls.
-- 6. EP-46: a lane with a null role claim or a null user claim is refused by the insert gate (42501) and updates
--    nothing (zero rows): null makes the predicate null, which denies.
-- 7. EP-47: the four policies are RESTRICTIVE, so they AND with the tenant isolation whatever the creation order.
-- 8. `social` OFF (D-718): a member insert raises 42501, the community stays readable, and the creator's own edit
--    still succeeds (assumption A11: no `social_enabled()` term in the update gate).
-- 9. THE ESCOPO STUB `app.community_action_allowed`: false for each of the five reserved actions, for a null
--    community, for an unknown and a null action, and for every lane, with the catalog facts of the seam pattern
--    (SECURITY DEFINER, empty `search_path`, EXECUTE for `authenticated` and not for `anon`); the same catalog facts
--    for the definer `app.member_community_hidden_ids()`. WHEN THE ESCOPO PHASE INSTALLS THE REAL BODY it replaces
--    the constant-false assertions of this section (the catalog assertions stay).
--
-- Fixture ids use the `23000000-…` prefix and the tenants `pgtap-mcomm-a` / `pgtap-mcomm-b`. Like its siblings,
-- this file ROLLS BACK.
select plan(74);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-mcomm-a', 'Comunidades de membros A', '23000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-mcomm-b', 'Comunidades de membros B', '23000000-0000-4000-8000-000000000011');
select tests.auth_user('admin@mcomm-a.local', '23000000-0000-4000-8000-000000000002');
select tests.auth_user('support@mcomm-a.local', '23000000-0000-4000-8000-000000000003');
select tests.auth_user('m1@mcomm-a.local', '23000000-0000-4000-8000-000000000004');
select tests.auth_user('m2@mcomm-a.local', '23000000-0000-4000-8000-000000000005');
select tests.auth_user('m3@mcomm-a.local', '23000000-0000-4000-8000-000000000006');
select tests.auth_user('m4@mcomm-a.local', '23000000-0000-4000-8000-000000000007');
select tests.auth_user('m5@mcomm-a.local', '23000000-0000-4000-8000-000000000008');
select tests.auth_user('k@mcomm-b.local', '23000000-0000-4000-8000-000000000012');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000005');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000006');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000007');
select tests.member('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000008');
select tests.member('23000000-0000-4000-8000-000000000011', '23000000-0000-4000-8000-000000000012');
-- CO: an ORGANIZATION community of A (the admin's). COB: an organization community of B, the only one B has, so
-- B's tenant has NO member community (the EP-27 empty case). C3, C4, C5: member communities of M3, M4 and M5,
-- the subjects of the hidden-creator table.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position) values
  ('23000000-0000-4000-8000-0000000000c0', '23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'Base', 'base', 'organization', 0),
  ('23000000-0000-4000-8000-0000000000d1', '23000000-0000-4000-8000-000000000011', '23000000-0000-4000-8000-000000000012', 'Base de B', 'base-b', 'organization', 0),
  ('23000000-0000-4000-8000-0000000000c3', '23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000006', 'Da M3', 'da-m3', 'member', 1000000),
  ('23000000-0000-4000-8000-0000000000c4', '23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000007', 'Da M4', 'da-m4', 'member', 1000000),
  ('23000000-0000-4000-8000-0000000000c5', '23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000008', 'Da M5', 'da-m5', 'member', 1000000);
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

-- ── 2. the SELECT truth table, per lane ────────────────────────────────────────────────────────
-- C1 is M1's member community, C0 the organization's: every live lane of A reads both, K of B and a lane with no
-- claims read neither (A's own tenant isolation, unchanged by the hidden-creator gate).
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004');
select results_eq($$ select count(*)::int from public.communities where id in ('23000000-0000-4000-8000-0000000000c1', '23000000-0000-4000-8000-0000000000c0') $$,
  ARRAY[2], '2: the creator M1 reads the member community and the organization one');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.communities where id in ('23000000-0000-4000-8000-0000000000c1', '23000000-0000-4000-8000-0000000000c0') $$,
  ARRAY[2], '2: another member M2 reads both');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.communities where id in ('23000000-0000-4000-8000-0000000000c1', '23000000-0000-4000-8000-0000000000c0') $$,
  ARRAY[2], '2: A''s admin_tenant reads both');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000003', 'support_tenant');
select results_eq($$ select count(*)::int from public.communities where id in ('23000000-0000-4000-8000-0000000000c1', '23000000-0000-4000-8000-0000000000c0') $$,
  ARRAY[2], '2: A''s real support_tenant session reads both');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq($$ select count(*)::int from public.communities where id in ('23000000-0000-4000-8000-0000000000c1', '23000000-0000-4000-8000-0000000000c0') $$,
  ARRAY[2], '2: the system lane (zero user, support_tenant claim) reads both');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000011', '23000000-0000-4000-8000-000000000012');
select results_eq($$ select count(*)::int from public.communities where id in ('23000000-0000-4000-8000-0000000000c1', '23000000-0000-4000-8000-0000000000c0') $$,
  ARRAY[0], '2: K of tenant B reads neither of A''s communities');
reset role;
select tests.as_tenant_without_claims();
select results_eq($$ select count(*)::int from public.communities where id in ('23000000-0000-4000-8000-0000000000c1', '23000000-0000-4000-8000-0000000000c0') $$,
  ARRAY[0], '2: a lane with no claims (null role) reads neither');
reset role;

-- ── 3. the hidden-creator truth table (D-708, EP-26, EP-27) ────────────────────────────────────
-- State changes run as the migration role; every read runs in a lane. M3 owns C3, M4 owns C4, M5 owns C5, M1 owns
-- C1 (the "second community of a live creator" that must stay visible in the same statement).
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c3' $$,
  ARRAY[1], '3: M3 live: the moderator reads C3 (baseline)');
reset role;
update public.memberships set blocked_at = now()
 where tenant_id = '23000000-0000-4000-8000-000000000001' and user_id = '23000000-0000-4000-8000-000000000006';
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c3' $$,
  ARRAY[0], '3: M3 blocked (blocked_at set): the community leaves the moderator''s read too');
select results_eq($$ select id::text from public.communities where id in ('23000000-0000-4000-8000-0000000000c1', '23000000-0000-4000-8000-0000000000c3') $$,
  ARRAY['23000000-0000-4000-8000-0000000000c1'::text], '3: …and in the SAME statement the live creator''s C1 stays visible');
select is(app.member_community_hidden_ids(), ARRAY['23000000-0000-4000-8000-0000000000c3']::uuid[],
  '3: the definer returns exactly {C3} for A (ids only)');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c3' $$,
  ARRAY[0], '3: …and from another member''s read');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000011', '23000000-0000-4000-8000-000000000012');
select is(app.member_community_hidden_ids(), '{}'::uuid[],
  '3: B''s lane never receives A''s hidden id: the definer returns {} for it (EP-27 empty, never null)');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000d1' $$,
  ARRAY[1], '3: …and the gate passes B''s organization community');
reset role;
select tests.as_tenant_without_claims();
select is(app.member_community_hidden_ids(), '{}'::uuid[],
  '3: a lane with no claims gets {} from the definer (never null)');
reset role;
update public.memberships set blocked_at = null
 where tenant_id = '23000000-0000-4000-8000-000000000001' and user_id = '23000000-0000-4000-8000-000000000006';
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c3' $$,
  ARRAY[1], '3: M3 unblocked (blocked_at cleared): the community is back, no row was touched');
reset role;
-- a soft-deleted membership hides, clearing it shows
update public.memberships set deleted_at = now()
 where tenant_id = '23000000-0000-4000-8000-000000000001' and user_id = '23000000-0000-4000-8000-000000000007';
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c4' $$,
  ARRAY[0], '3: M4''s membership soft-deleted (departed): C4 leaves every read');
reset role;
update public.memberships set deleted_at = null
 where tenant_id = '23000000-0000-4000-8000-000000000001' and user_id = '23000000-0000-4000-8000-000000000007';
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c4' $$,
  ARRAY[1], '3: …and M4''s membership restored: C4 is back');
reset role;
-- a status other than 'active' hides, restoring it shows
update public.memberships set status = 'invited'
 where tenant_id = '23000000-0000-4000-8000-000000000001' and user_id = '23000000-0000-4000-8000-000000000008';
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c5' $$,
  ARRAY[0], '3: M5''s membership status is not active: C5 leaves every read');
reset role;
update public.memberships set status = 'active'
 where tenant_id = '23000000-0000-4000-8000-000000000001' and user_id = '23000000-0000-4000-8000-000000000008';
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c5' $$,
  ARRAY[1], '3: …and M5 active again: C5 is back');
reset role;

-- ── 4. the sentinel and kind checks (EP-04), as the migration role ─────────────────────────────
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004', 'P0', 'p0', 'member', 0) $$,
  '23514', null, '4: a member row with position 0 raises 23514 (communities_member_position_chk)');
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004', 'P1', 'p1', 'member', 999999) $$,
  '23514', null, '4: a member row with position 999999 raises 23514');
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004', 'P2', 'p2', 'member', 1000001) $$,
  '23514', null, '4: a member row with position 1000001 raises 23514');
select lives_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'O0', 'o0', 'organization', 0),
            ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'O1', 'o1', 'organization', 250) $$,
  '4: an organization row keeps any non-negative position (0 and 250): positive control');
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'K', 'k-desconhecido', 'curator', 0) $$,
  '23514', null, '4: an unknown kind raises 23514 (communities_kind_chk)');

-- ── 5. the delete and update gates ─────────────────────────────────────────────────────────────
-- CX: a throwaway organization community for the admin's delete (a positive control).
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position) values
  ('23000000-0000-4000-8000-0000000000c9', '23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'Descartavel', 'descartavel', 'organization', 0);
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004');
-- Postgres behaviour recorded: a restrictive DELETE policy whose USING fails FILTERS the row, so the member's hard
-- delete matches ZERO rows and raises nothing (it is the service that soft-deletes, never a hard delete).
select results_eq(
  $$ with d as (delete from public.communities where id = '23000000-0000-4000-8000-0000000000c1' returning 1) select count(*)::int from d $$,
  ARRAY[0], '5: a member lane hard-delete of their own community matches zero rows (communities_member_delete_gate)');
select throws_ok(
  $$ update public.communities set kind = 'organization' where id = '23000000-0000-4000-8000-0000000000c1' $$,
  '42501', null, '5: M1 cannot flip their own community to organization (the update gate WITH CHECK)');
select throws_ok(
  $$ update public.communities set created_by_user_id = '23000000-0000-4000-8000-000000000005' where id = '23000000-0000-4000-8000-0000000000c1' $$,
  '42501', null, '5: M1 cannot hand their community to another creator (the update gate WITH CHECK)');
select lives_ok(
  $$ update public.communities set status = 'archived' where id = '23000000-0000-4000-8000-0000000000c1' $$,
  '5: the creator archives their own community (positive control)');
reset role;
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[1], '5: …and the refused delete left the row there');
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ with u as (update public.communities set description = 'moderado' where id = '23000000-0000-4000-8000-0000000000c1' returning 1) select count(*)::int from u $$,
  ARRAY[1], '5: the moderator updates any community: one row (positive control)');
select results_eq(
  $$ with d as (delete from public.communities where id = '23000000-0000-4000-8000-0000000000c9' returning 1) select count(*)::int from d $$,
  ARRAY[1], '5: the admin lane hard-deletes a community: one row (positive control)');
reset role;

-- ── 6. EP-46: null claims fail closed ──────────────────────────────────────────────────────────
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004', null);
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004', 'Sem papel', 'sem-papel', 'member', 1000000) $$,
  '42501', null, '6: a lane with a null role claim cannot insert a community');
select results_eq(
  $$ with u as (update public.communities set name = 'sem papel' where id = '23000000-0000-4000-8000-0000000000c1' returning 1) select count(*)::int from u $$,
  ARRAY[0], '6: a lane with a null role claim updates nothing (zero rows)');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', null, 'member');
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004', 'Sem usuario', 'sem-usuario', 'member', 1000000) $$,
  '42501', null, '6: a member lane with a null user claim cannot insert a community');
select results_eq(
  $$ with u as (update public.communities set name = 'sem usuario' where id = '23000000-0000-4000-8000-0000000000c1' returning 1) select count(*)::int from u $$,
  ARRAY[0], '6: a member lane with a null user claim updates nothing (zero rows)');
reset role;

-- ── 7. EP-47: all four are RESTRICTIVE ─────────────────────────────────────────────────────────
select is(
  (select string_agg(policyname || '/' || permissive || '/' || cmd, ',' order by policyname) from pg_policies
    where schemaname = 'public' and tablename = 'communities'
      and policyname in ('communities_kind_insert_gate', 'communities_member_update_gate', 'communities_member_delete_gate', 'communities_member_hidden_gate')),
  'communities_kind_insert_gate/RESTRICTIVE/INSERT,communities_member_delete_gate/RESTRICTIVE/DELETE,communities_member_hidden_gate/RESTRICTIVE/SELECT,communities_member_update_gate/RESTRICTIVE/UPDATE',
  '7: the four policies exist, each RESTRICTIVE and for its own command');

-- ── 8. `social` OFF (D-718, assumption A11) ────────────────────────────────────────────────────
update public.tenant_modules set enabled = false
 where tenant_id = '23000000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
     values ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004', 'Com social off', 'com-social-off', 'member', 1000000) $$,
  '42501', null, '8: social off: a member insert raises 42501 (app.social_enabled() read from SQL)');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[1], '8: …the member community stays readable for its creator');
select lives_ok(
  $$ update public.communities set name = 'Da M1, social off' where id = '23000000-0000-4000-8000-0000000000c1' $$,
  '8: …and the creator''s own edit still succeeds (no social term in the update gate, A11)');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000005');
select results_eq($$ select count(*)::int from public.communities where id = '23000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[1], '8: …and another member still reads it');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '23000000-0000-4000-8000-000000000001' and module_key = 'social';

-- ── 9. the Escopo stub and the catalog facts ───────────────────────────────────────────────────
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004');
select is(app.community_action_allowed('23000000-0000-4000-8000-0000000000c1'::uuid, 'like'), false, '9: the stub answers false for like on a member community');
select is(app.community_action_allowed('23000000-0000-4000-8000-0000000000c1'::uuid, 'comment'), false, '9: …for comment');
select is(app.community_action_allowed('23000000-0000-4000-8000-0000000000c1'::uuid, 'share'), false, '9: …for share');
select is(app.community_action_allowed('23000000-0000-4000-8000-0000000000c1'::uuid, 'post'), false, '9: …for post');
select is(app.community_action_allowed('23000000-0000-4000-8000-0000000000c1'::uuid, 'story'), false, '9: …for story');
select is(app.community_action_allowed('23000000-0000-4000-8000-0000000000c0'::uuid, 'post'), false, '9: …for post on an ORGANIZATION community');
select is(app.community_action_allowed(null, 'post'), false, '9: …for a null community (false, never null)');
select is(app.community_action_allowed('23000000-0000-4000-8000-0000000000c1'::uuid, 'desconhecida'), false, '9: …for an unknown action');
select is(app.community_action_allowed('23000000-0000-4000-8000-0000000000c1'::uuid, null), false, '9: …for a null action');
reset role;
-- every lane of section 2: the whole cross product (member, organization, null community) x (the five actions, an
-- unknown one, null) is false.
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000004');
select is((select bool_or(app.community_action_allowed(c.id, a.x)) from (values ('23000000-0000-4000-8000-0000000000c1'::uuid), ('23000000-0000-4000-8000-0000000000c0'::uuid), (null::uuid)) c(id),
  (values ('like'), ('comment'), ('share'), ('post'), ('story'), ('desconhecida'), (null::text)) a(x)), false, '9: the creator lane: all false');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000005');
select is((select bool_or(app.community_action_allowed(c.id, a.x)) from (values ('23000000-0000-4000-8000-0000000000c1'::uuid), ('23000000-0000-4000-8000-0000000000c0'::uuid), (null::uuid)) c(id),
  (values ('like'), ('comment'), ('share'), ('post'), ('story'), ('desconhecida'), (null::text)) a(x)), false, '9: another member lane: all false');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', 'admin_tenant');
select is((select bool_or(app.community_action_allowed(c.id, a.x)) from (values ('23000000-0000-4000-8000-0000000000c1'::uuid), ('23000000-0000-4000-8000-0000000000c0'::uuid), (null::uuid)) c(id),
  (values ('like'), ('comment'), ('share'), ('post'), ('story'), ('desconhecida'), (null::text)) a(x)), false, '9: A''s admin lane: all false');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000003', 'support_tenant');
select is((select bool_or(app.community_action_allowed(c.id, a.x)) from (values ('23000000-0000-4000-8000-0000000000c1'::uuid), ('23000000-0000-4000-8000-0000000000c0'::uuid), (null::uuid)) c(id),
  (values ('like'), ('comment'), ('share'), ('post'), ('story'), ('desconhecida'), (null::text)) a(x)), false, '9: A''s real support lane: all false');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is((select bool_or(app.community_action_allowed(c.id, a.x)) from (values ('23000000-0000-4000-8000-0000000000c1'::uuid), ('23000000-0000-4000-8000-0000000000c0'::uuid), (null::uuid)) c(id),
  (values ('like'), ('comment'), ('share'), ('post'), ('story'), ('desconhecida'), (null::text)) a(x)), false, '9: the system lane: all false');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-000000000011', '23000000-0000-4000-8000-000000000012');
select is((select bool_or(app.community_action_allowed(c.id, a.x)) from (values ('23000000-0000-4000-8000-0000000000c1'::uuid), ('23000000-0000-4000-8000-0000000000c0'::uuid), (null::uuid)) c(id),
  (values ('like'), ('comment'), ('share'), ('post'), ('story'), ('desconhecida'), (null::text)) a(x)), false, '9: K of tenant B: all false');
reset role;
select tests.as_tenant_without_claims();
select is((select bool_or(app.community_action_allowed(c.id, a.x)) from (values ('23000000-0000-4000-8000-0000000000c1'::uuid), ('23000000-0000-4000-8000-0000000000c0'::uuid), (null::uuid)) c(id),
  (values ('like'), ('comment'), ('share'), ('post'), ('story'), ('desconhecida'), (null::text)) a(x)), false, '9: the null-role lane: all false');
reset role;
-- the catalog facts (the seam pattern of 20261008171502_community_gate_seam.sql)
select is((select prosecdef from pg_proc where oid = to_regprocedure('app.community_action_allowed(uuid, text)')), true,
  '9: the stub is SECURITY DEFINER');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = to_regprocedure('app.community_action_allowed(uuid, text)')),
  '9: …with an empty search_path');
select ok(has_function_privilege('authenticated', 'app.community_action_allowed(uuid, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'app.community_action_allowed(uuid, text)', 'EXECUTE'),
  '9: …executable by authenticated and not by anon (revoked from PUBLIC)');
select is((select prosecdef from pg_proc where oid = to_regprocedure('app.member_community_hidden_ids()')), true,
  '9: the hidden-creator definer is SECURITY DEFINER');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = to_regprocedure('app.member_community_hidden_ids()')),
  '9: …with an empty search_path');
select ok(has_function_privilege('authenticated', 'app.member_community_hidden_ids()', 'EXECUTE')
          and not has_function_privilege('anon', 'app.member_community_hidden_ids()', 'EXECUTE'),
  '9: …executable by authenticated and not by anon');

select * from finish();
rollback;
