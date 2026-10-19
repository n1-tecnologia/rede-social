begin;
-- 200-social.sql — the follow graph, the social gate seam and the counts definer, executed inside
-- Postgres (09-02, FOLLOW-01..04, SOCIAL-10; D-467, D-468, D-483, D-484; T-09-04, T-09-05, T-09-06,
-- T-09-09). Numbered 200 after 198 (08.7).
--
-- Sets are compared SORTED (`array(select unnest(…) order by 1)`): the seam answers a SET and no
-- caller relies on its order.
--
-- 1. THE POLICIES OF `social_follows` (D-467, D-468, T-09-04, T-09-05). A member follows a member in
--    its own lane. The row is visible to its two parties only: a third member, the tenant's admin and
--    support, another tenant's member and the shared identity in either of its lanes read nothing.
--    The insert is refused (42501) for `admin_tenant`, `support_tenant` and a null-role claim, for a
--    forged follower id, a forged tenant id, a tenant whose `social` row is absent, and a followee
--    that is staff, blocked, removed or not a member of the tenant. A self follow raises 23514 on
--    `social_follows_no_self_chk`; a duplicate pair raises 23505; UPDATE and TRUNCATE are refused
--    (42501); a delete of someone else's row (the followee's included) affects 0 rows and the
--    follower's own delete affects 1.
--
-- 2. THE SEAM TRUTH TABLE (D-483, D-484). `app.social_enabled()` is true with the tenant's row
--    enabled, false when disabled, false with no row, false for a null claim and false in B for a flag
--    set only in A. `app.social_visible_author_ids()` for a member is {self} before any follow, {self,
--    followee} after one, grows with a second follow, never lists a blocked or removed followee, lists
--    a blocked one again after the unblock (nothing was deleted), and is the empty array for
--    `admin_tenant`, `support_tenant`, a null-role claim, a null claim and while `social` is off.
--
-- 3. THE COUNTS DEFINER (D-468, D-484, T-09-09). `app.social_counts(membership)` counts the live
--    members on the other end only (a blocked and a removed follower, and a blocked and a removed
--    followee, are excluded), and answers NULL for a staff membership, a blocked or removed one,
--    another tenant's, an unknown id and a null claim. All the seam and counts functions are SECURITY
--    DEFINER with `search_path=''`, executable by `authenticated` and not by `anon`.
--
-- 4. THE TENANT PIN (T-09-09, 160's twin). The shared identity S is a member of A and B and follows
--    inside B only: S's A lane sees {S} in `social_visible_author_ids`, a count of S's A membership
--    ignores B's follower, and B's count of S's B membership sees it.
--
-- Fixture ids use the `20000000-…` prefix and the tenants `pgtap-social-a` / `pgtap-social-b`, used by
-- no other file. Like its siblings, this file ROLLS BACK.
select plan(66);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-social-a', 'Social A', '20000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-social-b', 'Social B', '20000000-0000-4000-8000-000000000011');
select tests.auth_user('admin@social-a.local', '20000000-0000-4000-8000-000000000002');
select tests.auth_user('support@social-a.local', '20000000-0000-4000-8000-000000000003');
select tests.auth_user('m1@social-a.local', '20000000-0000-4000-8000-000000000004');
select tests.auth_user('m2@social-a.local', '20000000-0000-4000-8000-000000000005');
select tests.auth_user('m3@social-a.local', '20000000-0000-4000-8000-000000000006');
select tests.auth_user('blk@social-a.local', '20000000-0000-4000-8000-000000000007');
select tests.auth_user('rmv@social-a.local', '20000000-0000-4000-8000-000000000008');
select tests.auth_user('k@social-b.local', '20000000-0000-4000-8000-000000000012');
select tests.auth_user('s@social.local', '20000000-0000-4000-8000-0000000000a0');

-- Memberships with FIXED ids, so the definer can be called by membership id from a lane. A: admin,
-- support, M1, M2, M3, a BLOCKED member (status and blocked_at, as the API's block writes them) and a
-- REMOVED one (deleted_at), and S as a member. B: K and S as a member.
insert into public.memberships (id, tenant_id, user_id, role, status, blocked_at, deleted_at) values
  ('20000000-0000-4000-8000-00000000f002', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'admin_tenant', 'active', null, null),
  ('20000000-0000-4000-8000-00000000f003', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'support_tenant', 'active', null, null),
  ('20000000-0000-4000-8000-00000000f004', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'member', 'active', null, null),
  ('20000000-0000-4000-8000-00000000f005', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005', 'member', 'active', null, null),
  ('20000000-0000-4000-8000-00000000f006', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006', 'member', 'active', null, null),
  ('20000000-0000-4000-8000-00000000f007', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000007', 'member', 'blocked', now(), null),
  ('20000000-0000-4000-8000-00000000f008', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000008', 'member', 'active', null, now()),
  ('20000000-0000-4000-8000-00000000f0a0', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a0', 'member', 'active', null, null),
  ('20000000-0000-4000-8000-00000000f012', '20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012', 'member', 'active', null, null),
  ('20000000-0000-4000-8000-00000000f0b0', '20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-0000000000a0', 'member', 'active', null, null);

-- `social` is ON for A only (B has no row: a missing row reads as disabled).
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('20000000-0000-4000-8000-000000000001', 'social', true);

-- ── 1. the policies ────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select lives_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005') $$,
  '1: M1 follows M2 in its own lane (member, social on, live member followee)');
select results_eq(
  $$ select count(*)::int from public.social_follows $$,
  ARRAY[1], '1: the follower M1 reads the row');

reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005');
select results_eq(
  $$ select count(*)::int from public.social_follows $$,
  ARRAY[1], '1: the followee M2 reads the row too (a party)');

reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006');
select is_empty($$ select 1 from public.social_follows $$,
  '1: a third member M3 reads nothing (D-468: no tenant-wide select)');

reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'admin_tenant');
select is_empty($$ select 1 from public.social_follows $$,
  '1: the tenant''s admin reads nothing (no staff branch, PR-1)');

reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'support_tenant');
select is_empty($$ select 1 from public.social_follows $$,
  '1: the tenant''s support reads nothing');

reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012');
select is_empty($$ select 1 from public.social_follows $$,
  '1: another tenant''s member K reads nothing');

reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a0');
select is_empty($$ select 1 from public.social_follows $$,
  '1: the shared identity S in its A lane reads nothing of M1 and M2');
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-0000000000a0');
select is_empty($$ select 1 from public.social_follows $$,
  '1: the shared identity S in its B lane reads nothing of A');

-- Inserts that must be refused (T-09-05). Every attempt is otherwise valid, so the single reason is
-- the one under test.
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'admin_tenant');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005') $$,
  '42501', null, '1: admin_tenant cannot insert a follow (D-467: staff are outside the graph)');
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'support_tenant');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000005') $$,
  '42501', null, '1: support_tenant cannot insert a follow');
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', null);
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000006') $$,
  '42501', null, '1: a null-role claim cannot insert a follow (fails closed)');

reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000005') $$,
  '42501', null, '1: M1 cannot forge another member as the follower');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000012') $$,
  '42501', null, '1: M1 cannot stamp B''s tenant_id on a follow');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002') $$,
  '42501', null, '1: M1 cannot follow the tenant''s admin (staff followee)');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003') $$,
  '42501', null, '1: M1 cannot follow the tenant''s support (staff followee)');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000007') $$,
  '42501', null, '1: M1 cannot follow a blocked member');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000008') $$,
  '42501', null, '1: M1 cannot follow a removed member');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000012') $$,
  '42501', null, '1: M1 cannot follow someone who is not a member of A (K belongs to B)');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004') $$,
  '23514', null, '1: a self follow raises 23514 (social_follows_no_self_chk)');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005') $$,
  '23505', null, '1: a duplicate pair raises 23505 (the idempotency arbiter)');
select throws_ok(
  $$ update public.social_follows set created_at = now() $$,
  '42501', null, '1: UPDATE is refused (no update policy, privilege revoked)');
select throws_ok(
  $$ truncate public.social_follows $$,
  '42501', null, '1: TRUNCATE is refused (RLS does not cover it; the privilege is revoked)');

-- `social` absent for B: S in its B lane is a member of B, follows K (a live B member), and is refused.
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-0000000000a0');
select throws_ok(
  $$ insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
     values ('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-0000000000a0', '20000000-0000-4000-8000-000000000012') $$,
  '42501', null, '1: with no social row for the tenant the insert is refused (D-483)');

-- Deletes. M3 and the followee M2 cannot delete M1's row; M1 can.
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006');
select results_eq(
  $$ with d as (delete from public.social_follows returning 1) select count(*)::int from d $$,
  ARRAY[0], '1: a third member''s delete touches 0 rows');
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005');
select results_eq(
  $$ with d as (delete from public.social_follows returning 1) select count(*)::int from d $$,
  ARRAY[0], '1: the followee''s delete touches 0 rows (only the follower removes a follow)');
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select results_eq(
  $$ with d as (delete from public.social_follows returning 1) select count(*)::int from d $$,
  ARRAY[1], '1: the follower''s own delete touches exactly 1 row');
reset role;

-- ── 2. the seam truth table ────────────────────────────────────────────────────────────────────
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select is((select app.social_enabled()), true, '2: social_enabled is true with the tenant''s row enabled');
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '20000000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select is((select app.social_enabled()), false, '2: social_enabled is false with the row disabled');
reset role;
delete from public.tenant_modules
 where tenant_id = '20000000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select is((select app.social_enabled()), false, '2: social_enabled is false with no row at all');
reset role;
insert into public.tenant_modules (tenant_id, module_key, enabled)
values ('20000000-0000-4000-8000-000000000001', 'social', true);
select tests.as_tenant_without_claims();
select is((select app.social_enabled()), false, '2: social_enabled is false for a null claim');
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012');
select is((select app.social_enabled()), false, '2: social_enabled is false in B for a flag set only in A');
reset role;

-- visible authors: before any follow, then one, then two. Direct inserts as the migration role (the
-- policies are proved above); the question here is only what the seam answers.
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select results_eq(
  $$ select array(select unnest(app.social_visible_author_ids()) order by 1) $$,
  $$ values (array['20000000-0000-4000-8000-000000000004']::uuid[]) $$,
  '2: with no follow the visible set is just the caller');
reset role;
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005');
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select results_eq(
  $$ select array(select unnest(app.social_visible_author_ids()) order by 1) $$,
  $$ values (array['20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005']::uuid[]) $$,
  '2: after following M2 the set is {M1, M2}');
reset role;
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000006');
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select results_eq(
  $$ select array(select unnest(app.social_visible_author_ids()) order by 1) $$,
  $$ values (array['20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000006']::uuid[]) $$,
  '2: a second follow adds M3');
reset role;
-- A blocked and a removed followee: stored (the owner bypasses the insert policy), never listed.
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000007');
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select results_eq(
  $$ select array(select unnest(app.social_visible_author_ids()) order by 1) $$,
  $$ values (array['20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000006']::uuid[]) $$,
  '2: a blocked followee is not listed (D-484)');
reset role;
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000008');
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select results_eq(
  $$ select array(select unnest(app.social_visible_author_ids()) order by 1) $$,
  $$ values (array['20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000006']::uuid[]) $$,
  '2: a removed followee is not listed (D-484)');
reset role;
-- Unblock: the stored row returns, nothing was deleted.
update public.memberships set status = 'active', blocked_at = null
 where id = '20000000-0000-4000-8000-00000000f007';
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select results_eq(
  $$ select array(select unnest(app.social_visible_author_ids()) order by 1) $$,
  $$ values (array['20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000007']::uuid[]) $$,
  '2: after the unblock the blocked followee is listed again (D-484)');
reset role;
update public.memberships set status = 'blocked', blocked_at = now()
 where id = '20000000-0000-4000-8000-00000000f007';

-- The empty branch: staff, null role, null claim, social off.
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'admin_tenant');
select is((select app.social_visible_author_ids()), '{}'::uuid[], '2: admin_tenant gets the empty set');
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'support_tenant');
select is((select app.social_visible_author_ids()), '{}'::uuid[], '2: support_tenant gets the empty set');
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', null);
select is((select app.social_visible_author_ids()), '{}'::uuid[], '2: a null-role claim gets the empty set (fails closed)');
reset role;
select tests.as_tenant_without_claims();
select is((select app.social_visible_author_ids()), '{}'::uuid[], '2: a null claim gets the empty set');
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '20000000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select is((select app.social_visible_author_ids()), '{}'::uuid[], '2: with social off a member gets the empty set (D-483)');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '20000000-0000-4000-8000-000000000001' and module_key = 'social';

-- ── 3. the counts definer ──────────────────────────────────────────────────────────────────────
-- Followers of M2: M1 (live), M3 (live), the blocked and the removed member (stored, excluded).
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000005'),
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000005'),
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000005');
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select is(
  app.social_counts('20000000-0000-4000-8000-00000000f005'),
  '{"followers": 2, "following": 0}'::jsonb,
  '3: M2 has 2 followers (a blocked and a removed follower are excluded) and follows nobody');
select is(
  app.social_counts('20000000-0000-4000-8000-00000000f004'),
  '{"followers": 0, "following": 2}'::jsonb,
  '3: M1 follows 2 people (the blocked and the removed followee are excluded) and has no follower');
select is(
  app.social_counts('20000000-0000-4000-8000-00000000f006'),
  '{"followers": 1, "following": 1}'::jsonb,
  '3: a mutual-free pair counts once each way: M3 has 1 follower (M1) and 1 following (M2)');
select is(app.social_counts('20000000-0000-4000-8000-00000000f002'), null::jsonb,
  '3: a staff membership (admin) is null');
select is(app.social_counts('20000000-0000-4000-8000-00000000f003'), null::jsonb,
  '3: a staff membership (support) is null');
select is(app.social_counts('20000000-0000-4000-8000-00000000f007'), null::jsonb,
  '3: a blocked membership is null');
select is(app.social_counts('20000000-0000-4000-8000-00000000f008'), null::jsonb,
  '3: a removed membership is null');
select is(app.social_counts('20000000-0000-4000-8000-00000000f012'), null::jsonb,
  '3: another tenant''s membership is null');
select is(app.social_counts('20000000-0000-4000-8000-00000000ffff'), null::jsonb,
  '3: an unknown id is null');
-- The caller need not be a party: M3 reads M2''s counts, and the staff lane reads them too.
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006');
select is(
  app.social_counts('20000000-0000-4000-8000-00000000f005'),
  '{"followers": 2, "following": 0}'::jsonb,
  '3: a non-party (M3) reads the same public counts');
reset role;
select tests.as_tenant_without_claims();
select is(app.social_counts('20000000-0000-4000-8000-00000000f005'), null::jsonb,
  '3: a null claim is null');
reset role;
-- Unblocking restores the blocked follower in the count.
update public.memberships set status = 'active', blocked_at = null
 where id = '20000000-0000-4000-8000-00000000f007';
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004');
select is(
  app.social_counts('20000000-0000-4000-8000-00000000f005'),
  '{"followers": 3, "following": 0}'::jsonb,
  '3: after the unblock the stored follower is counted again (D-484)');
reset role;
update public.memberships set status = 'blocked', blocked_at = now()
 where id = '20000000-0000-4000-8000-00000000f007';

-- Posture: SECURITY DEFINER, empty search_path, authenticated yes, anon no.
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p
    where p.oid in ('app.social_enabled()'::regprocedure,
                    'app.social_visible_author_ids()'::regprocedure,
                    'app.social_counts(uuid)'::regprocedure)),
  '3: the seam and the counts definer are SECURITY DEFINER with an empty search_path');
select ok(
  has_function_privilege('authenticated', 'app.social_enabled()', 'execute')
  and has_function_privilege('authenticated', 'app.social_visible_author_ids()', 'execute')
  and has_function_privilege('authenticated', 'app.social_counts(uuid)', 'execute'),
  '3: authenticated may execute all three');
select ok(
  not has_function_privilege('anon', 'app.social_enabled()', 'execute')
  and not has_function_privilege('anon', 'app.social_visible_author_ids()', 'execute')
  and not has_function_privilege('anon', 'app.social_counts(uuid)', 'execute'),
  '3: anon may execute none of them');
select ok(
  not has_table_privilege('authenticated', 'public.social_follows', 'update')
  and not has_table_privilege('authenticated', 'public.social_follows', 'truncate')
  and has_table_privilege('authenticated', 'public.social_follows', 'select')
  and has_table_privilege('authenticated', 'public.social_follows', 'insert')
  and has_table_privilege('authenticated', 'public.social_follows', 'delete'),
  '3: authenticated holds select, insert and delete on social_follows and neither update nor truncate');
select is(
  (select count(*)::int from pg_policy p where p.polrelid = 'public.social_follows'::regclass),
  3, '3: social_follows has exactly three policies (select, insert, delete) and no tenant-wide one');

-- ── 4. the tenant pin ──────────────────────────────────────────────────────────────────────────
-- K follows S in B (stored), and S follows K in B. Neither edge exists in A.
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-0000000000a0'),
  ('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-0000000000a0', '20000000-0000-4000-8000-000000000012');
select tests.as_tenant('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a0');
select is(
  app.social_counts('20000000-0000-4000-8000-00000000f0a0'),
  '{"followers": 0, "following": 0}'::jsonb,
  '4: S''s A membership counts nothing of B''s edges');
select results_eq(
  $$ select array(select unnest(app.social_visible_author_ids()) order by 1) $$,
  $$ values (array['20000000-0000-4000-8000-0000000000a0']::uuid[]) $$,
  '4: S in A sees only itself: its B followee is not a visible author in A');
select is_empty($$ select 1 from public.social_follows $$,
  '4: S''s A lane reads none of B''s follow rows');
reset role;
select tests.as_tenant('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012');
select is(
  app.social_counts('20000000-0000-4000-8000-00000000f0b0'),
  '{"followers": 1, "following": 1}'::jsonb,
  '4: in B the same person has the follower and the following (positive control)');
select is(app.social_counts('20000000-0000-4000-8000-00000000f0a0'), null::jsonb,
  '4: B''s lane cannot count S''s A membership');
select results_eq(
  $$ select count(*)::int from public.social_follows $$,
  ARRAY[2], '4: K in B reads exactly its own two rows (the two edges it is a party to)');
reset role;

select * from finish();
rollback;
