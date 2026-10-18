begin;
-- 198-dashboard.sql — the 08.7 dashboard snapshot family executed inside Postgres (08.7-01,
-- INSIGHT-06, INSIGHT-15, INSIGHT-18; D-462, D-464, D-440 [informational]; RESEARCH Pitfalls 1, 4,
-- 9, 12).
--
-- 1. POLICIES (D-462, T-08.7-01, T-08.7-02): one `dashboard_snapshots` row and the member rows of M
--    and N written as the migration role in tenant A, one tenant row and K's member row in B. A's
--    admin claim reads A's tenant row and both member rows; A's support claim reads no tenant row
--    and no member row; M reads no tenant row and only M's own member row; B's admin claim reads
--    nothing of A. Every insert, update and delete from a lane raises 42501 (no write policy, and
--    the tenant lane holds no write grant on either table).
-- 2. BUILDER GUARDS (EP-50, EP-53, EP-60, T-08.7-03): no tenant claim → 42501; M's real user id →
--    42501; the zero user with the tenant-local today → 22023; the zero user with yesterday → true,
--    then false, with `built_at` left as it was.
-- 3. MEMBERS KPI (08.7-01 planning decision 5, EP-50, EP-51, EP-52; R-Pitfall 9): memberships of A
--    dated at tenant-local instants of `America/Sao_Paulo` — local 23:30 of D (= 02:30Z of the next
--    UTC day) counts for D; local 00:30 of today does not; local 00:00 of D-29 is new; local 23:59 of
--    D-30 is not new and is in `previous`; a membership blocked before D-29 and a deleted one are out
--    of every number; staff never count; B's member (`Asia/Tokyo`) never counts in A, and B's own
--    build counts it (the tenant pin); an empty tenant builds a ready snapshot of zeros. The windows
--    are the local midnights of D-29 and D+1 as UTC instants.
-- 4. POSTURE (T-08.7-05, R-Pitfall 12): both functions are SECURITY DEFINER with an empty
--    search_path; the builder is executable by `authenticated` and not by `anon`; the area helper by
--    neither; each table carries exactly its one SELECT policy.
--
-- Fixture ids use the `19800000-…` prefix and the tenants `pgtap-dashboard-a` / `-b` / `-e`, used by
-- no other file. Like its siblings, this file ROLLS BACK.
select plan(46);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-dashboard-a', 'Painel A', '19800000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-dashboard-b', 'Painel B', '19800000-0000-4000-8000-000000000011');
select tests.tenant('pgtap-dashboard-e', 'Painel E', '19800000-0000-4000-8000-000000000021');
update public.tenants set timezone = 'America/Sao_Paulo'
 where id in ('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000021');
update public.tenants set timezone = 'Asia/Tokyo' where id = '19800000-0000-4000-8000-000000000011';
select tests.auth_user('admin@dashboard-a.local', '19800000-0000-4000-8000-000000000002');
select tests.auth_user('support@dashboard-a.local', '19800000-0000-4000-8000-000000000003');
select tests.auth_user('m@dashboard-a.local', '19800000-0000-4000-8000-000000000004');
select tests.auth_user('n@dashboard-a.local', '19800000-0000-4000-8000-000000000005');
select tests.auth_user('p@dashboard-a.local', '19800000-0000-4000-8000-000000000006');
select tests.auth_user('q@dashboard-a.local', '19800000-0000-4000-8000-000000000007');
select tests.auth_user('r@dashboard-a.local', '19800000-0000-4000-8000-000000000008');
select tests.auth_user('s@dashboard-a.local', '19800000-0000-4000-8000-000000000009');
select tests.auth_user('t@dashboard-a.local', '19800000-0000-4000-8000-00000000000a');
select tests.auth_user('k@dashboard-b.local', '19800000-0000-4000-8000-000000000012');
select tests.member('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000004');
select tests.member('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000005');
select tests.member('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000006');
select tests.member('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000007');
select tests.member('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000008');
select tests.member('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000009');
select tests.member('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-00000000000a');
select tests.member('19800000-0000-4000-8000-000000000011', '19800000-0000-4000-8000-000000000012');

-- Every membership dated at a São Paulo local instant (today_local - k days + hh:mm): staff and
-- M 60 days ago; N at 00:00 of D-29; P at 23:30 of D; Q at 00:30 of today; R at 23:59 of D-30; S
-- blocked 40 days ago (before D-29); T deleted. K (B) 50 days ago in Tokyo.
create temporary table d198 on commit drop as
  select (now() at time zone 'America/Sao_Paulo')::date as sp_today,
         (now() at time zone 'Asia/Tokyo')::date as tk_today;
update public.memberships m
   set joined_at = (((select sp_today from d198) - v.days)::timestamp + v.at::time)
                     at time zone 'America/Sao_Paulo'
  from (values ('19800000-0000-4000-8000-000000000002'::uuid, 60, '10:00'),
               ('19800000-0000-4000-8000-000000000003'::uuid, 60, '10:00'),
               ('19800000-0000-4000-8000-000000000004'::uuid, 60, '10:00'),
               ('19800000-0000-4000-8000-000000000005'::uuid, 30, '00:00'),
               ('19800000-0000-4000-8000-000000000006'::uuid, 1, '23:30'),
               ('19800000-0000-4000-8000-000000000007'::uuid, 0, '00:30'),
               ('19800000-0000-4000-8000-000000000008'::uuid, 31, '23:59'),
               ('19800000-0000-4000-8000-000000000009'::uuid, 50, '10:00'),
               ('19800000-0000-4000-8000-00000000000a'::uuid, 50, '10:00')) as v(user_id, days, at)
 where m.user_id = v.user_id and m.tenant_id = '19800000-0000-4000-8000-000000000001';
update public.memberships
   set status = 'blocked',
       blocked_at = (((select sp_today from d198) - 40)::timestamp + time '10:00') at time zone 'America/Sao_Paulo'
 where user_id = '19800000-0000-4000-8000-000000000009';
update public.memberships set deleted_at = now() - interval '45 days'
 where user_id = '19800000-0000-4000-8000-00000000000a';
update public.memberships
   set joined_at = (((select tk_today from d198) - 50)::timestamp + time '10:00') at time zone 'Asia/Tokyo'
 where user_id = '19800000-0000-4000-8000-000000000012';

-- Policy rows: A's tenant row ten days back, the member rows of M and N; B's tenant row and K's.
insert into public.dashboard_snapshots (tenant_id, snapshot_day, payload_version, windows, payload) values
  ('19800000-0000-4000-8000-000000000001', (select sp_today from d198) - 10, 1, '{}', '{}'),
  ('19800000-0000-4000-8000-000000000011', (select tk_today from d198) - 10, 1, '{}', '{}');
insert into public.dashboard_member_snapshots (tenant_id, membership_id, user_id, snapshot_day, band)
select m.tenant_id, m.id, m.user_id, (select sp_today from d198) - 10, 'engaged'
  from public.memberships m
 where m.user_id in ('19800000-0000-4000-8000-000000000004', '19800000-0000-4000-8000-000000000005',
                     '19800000-0000-4000-8000-000000000012');

-- ── 1. policies ────────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ select tenant_id::text from public.dashboard_snapshots $$,
  ARRAY['19800000-0000-4000-8000-000000000001'],
  'D-462: A''s admin claim reads A''s tenant snapshot row (and nothing of B)');
select results_eq(
  $$ select user_id::text from public.dashboard_member_snapshots order by user_id $$,
  ARRAY['19800000-0000-4000-8000-000000000004', '19800000-0000-4000-8000-000000000005'],
  'D-462: A''s admin claim reads every member row of A (M and N), none of B');
select throws_ok(
  $$ insert into public.dashboard_snapshots (tenant_id, snapshot_day, payload_version, windows, payload)
     values ('19800000-0000-4000-8000-000000000001', current_date - 20, 1, '{}', '{}') $$,
  '42501', null, 'the admin lane cannot insert a tenant snapshot (only the definer writes)');
select throws_ok(
  $$ update public.dashboard_snapshots set payload = '{"x":1}' $$,
  '42501', null, 'the admin lane cannot update a tenant snapshot');
select throws_ok(
  $$ delete from public.dashboard_snapshots $$,
  '42501', null, 'the admin lane cannot delete a tenant snapshot');
reset role;

select tests.as_tenant('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000003', 'support_tenant');
select is((select count(*)::int from public.dashboard_snapshots), 0,
  'T-08.7-02: A''s support claim reads no tenant snapshot row');
select is((select count(*)::int from public.dashboard_member_snapshots), 0,
  'T-08.7-02: A''s support claim reads no member row (it owns none)');
reset role;

select tests.as_tenant('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.dashboard_snapshots), 0,
  'T-08.7-02: M reads no tenant snapshot row');
select results_eq(
  $$ select user_id::text from public.dashboard_member_snapshots $$,
  ARRAY['19800000-0000-4000-8000-000000000004'],
  'D-463: M reads exactly its own member row, never N''s');
select throws_ok(
  $$ insert into public.dashboard_member_snapshots (tenant_id, membership_id, user_id, snapshot_day, band)
     select m.tenant_id, m.id, m.user_id, current_date, 'superfan' from public.memberships m
      where m.user_id = '19800000-0000-4000-8000-000000000004' $$,
  '42501', null, 'M cannot insert a member row');
select throws_ok(
  $$ update public.dashboard_member_snapshots set band = 'superfan' $$,
  '42501', null, 'M cannot rewrite its own band');
select throws_ok(
  $$ delete from public.dashboard_member_snapshots $$,
  '42501', null, 'M cannot delete its own member row');
reset role;

select tests.as_tenant('19800000-0000-4000-8000-000000000011', '19800000-0000-4000-8000-000000000012', 'admin_tenant');
select is((select count(*)::int from public.dashboard_snapshots where tenant_id = '19800000-0000-4000-8000-000000000001'), 0,
  'T-08.7-01: B''s admin claim reads no tenant snapshot row of A');
select is((select count(*)::int from public.dashboard_member_snapshots where tenant_id = '19800000-0000-4000-8000-000000000001'), 0,
  'T-08.7-01: B''s admin claim reads no member row of A');
reset role;

-- ── 2. builder guards ──────────────────────────────────────────────────────────────────────────
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select app.dashboard_build_snapshot(current_date - 1) $$,
  '42501', null, 'EP-60: with no tenant claim the builder raises 42501');
select is((select count(*)::int from public.dashboard_snapshots), 0,
  'EP-60: with no tenant claim the tenant snapshot table answers zero rows');
select is((select count(*)::int from public.dashboard_member_snapshots), 0,
  'EP-60: with no tenant claim the member snapshot table answers zero rows');
reset role;

select tests.as_tenant('19800000-0000-4000-8000-000000000001', '19800000-0000-4000-8000-000000000004', 'admin_tenant');
select throws_ok(
  $$ select app.dashboard_build_snapshot((now() at time zone 'America/Sao_Paulo')::date - 1) $$,
  '42501', null, 'EP-60 / T-08.7-03: a real user id in the claim (even an admin claim) raises 42501');
reset role;

select tests.as_tenant('19800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select throws_ok(
  $$ select app.dashboard_build_snapshot((now() at time zone 'America/Sao_Paulo')::date) $$,
  '22023', null, 'EP-50: the tenant-local today is not a complete day (22023)');
select throws_ok(
  $$ select app.dashboard_build_snapshot((now() at time zone 'America/Sao_Paulo')::date + 1) $$,
  '22023', null, 'a future day is refused too (22023)');
select is(app.dashboard_build_snapshot((now() at time zone 'America/Sao_Paulo')::date - 1), true,
  'the zero user builds the tenant-local yesterday: true');
reset role;
update public.dashboard_snapshots set built_at = '2001-01-01T00:00:00Z'
 where tenant_id = '19800000-0000-4000-8000-000000000001'
   and snapshot_day = (select sp_today from d198) - 1;
select tests.as_tenant('19800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.dashboard_build_snapshot((now() at time zone 'America/Sao_Paulo')::date - 1), false,
  'EP-53: a second build of the same (tenant, day) at the same payload version answers false');
reset role;
select is(
  (select built_at from public.dashboard_snapshots
    where tenant_id = '19800000-0000-4000-8000-000000000001' and snapshot_day = (select sp_today from d198) - 1),
  '2001-01-01T00:00:00Z'::timestamptz,
  'EP-53: the skipped build left built_at untouched');
select is(
  (select payload_version from public.dashboard_snapshots
    where tenant_id = '19800000-0000-4000-8000-000000000001' and snapshot_day = (select sp_today from d198) - 1),
  1, 'the row carries the builder''s payload version');

-- ── 3. members KPI ─────────────────────────────────────────────────────────────────────────────
select is(
  (select to_char(joined_at at time zone 'UTC', 'HH24:MI') from public.memberships
    where user_id = '19800000-0000-4000-8000-000000000006'),
  '02:30', 'fixture: P joined at 23:30 of D in São Paulo, which is 02:30Z');
create temporary table k198 on commit drop as
  select (s.payload -> 'overview' -> 'members') as m, s.windows as w
    from public.dashboard_snapshots s
   where s.tenant_id = '19800000-0000-4000-8000-000000000001'
     and s.snapshot_day = (select sp_today from d198) - 1;
select is((select (m ->> 'count')::int from k198), 4,
  'count = M, N, P, R: active members joined before the end of D (Q joined today, S blocked, T deleted, staff and B''s K never)');
select is((select (m ->> 'newMembers')::int from k198), 2,
  'EP-51 / EP-50: newMembers = N (00:00 of D-29) and P (23:30 of D); R (23:59 of D-30) is not new');
select is((select (m ->> 'previous')::int from k198), 2,
  'EP-51: previous = M and R (joined before D-29; S blocked before D-29 and T deleted are out)');
select is((select m from k198), '{"count": 4, "newMembers": 2, "previous": 2}'::jsonb,
  'EP-19: the area holds exactly the three raw integers, no delta and no name (PR-1)');
select is((select w ->> 'day' from k198), ((select sp_today from d198) - 1)::text,
  'windows.day is D, the tenant-local yesterday');
select is((select w ->> 'from30' from k198), ((select sp_today from d198) - 30)::text,
  'windows.from30 is D-29');
select is((select (w ->> 'from30At')::timestamptz from k198),
  (((select sp_today from d198) - 30)::timestamp at time zone 'America/Sao_Paulo'),
  'D-440: windows.from30At is local midnight of D-29 as an instant');
select is((select (w ->> 'untilAt')::timestamptz from k198),
  ((select sp_today from d198)::timestamp at time zone 'America/Sao_Paulo'),
  'D-464: windows.untilAt is local midnight of today: today never counts');

-- The tenant pin: B's own build counts K, in B's own day.
select tests.as_tenant('19800000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.dashboard_build_snapshot((now() at time zone 'Asia/Tokyo')::date - 1), true,
  'B builds its own Tokyo yesterday');
reset role;
select is(
  (select payload -> 'overview' -> 'members' from public.dashboard_snapshots
    where tenant_id = '19800000-0000-4000-8000-000000000011' and snapshot_day = (select tk_today from d198) - 1),
  '{"count": 1, "newMembers": 0, "previous": 1}'::jsonb,
  'R-Pitfall 1: B counts only K, and A''s members never count in B');

-- EP-52: an empty tenant builds a ready snapshot of real zeros.
select tests.as_tenant('19800000-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.dashboard_build_snapshot((now() at time zone 'America/Sao_Paulo')::date - 1), true,
  'EP-52: a tenant with no member builds');
reset role;
select is(
  (select payload -> 'overview' -> 'members' from public.dashboard_snapshots
    where tenant_id = '19800000-0000-4000-8000-000000000021'),
  '{"count": 0, "newMembers": 0, "previous": 0}'::jsonb,
  'EP-52: its members area is three real zeros');

-- A blocked member inside the window leaves count but stays in previous; a rebuild after deleting
-- the row reflects it.
update public.memberships
   set status = 'blocked',
       blocked_at = (((select sp_today from d198) - 5)::timestamp + time '10:00') at time zone 'America/Sao_Paulo'
 where user_id = '19800000-0000-4000-8000-000000000004';
delete from public.dashboard_snapshots
 where tenant_id = '19800000-0000-4000-8000-000000000001' and snapshot_day = (select sp_today from d198) - 1;
select tests.as_tenant('19800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.dashboard_build_snapshot((now() at time zone 'America/Sao_Paulo')::date - 1), true,
  'A rebuilds after its row was removed');
reset role;
select is(
  (select payload -> 'overview' -> 'members' from public.dashboard_snapshots
    where tenant_id = '19800000-0000-4000-8000-000000000001' and snapshot_day = (select sp_today from d198) - 1),
  '{"count": 3, "newMembers": 2, "previous": 2}'::jsonb,
  'M blocked 5 days ago: out of count, still in previous (the base 30 days before)');

-- ── 4. posture ─────────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef
      and p.proname in ('dashboard_build_snapshot', 'dashboard_area_overview')),
  2, 'both dashboard functions are SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and 'search_path=""' = any(p.proconfig)
      and p.proname in ('dashboard_build_snapshot', 'dashboard_area_overview')),
  2, 'T-08.7-05: both dashboard functions pin search_path to empty');
select ok(has_function_privilege('authenticated', 'app.dashboard_build_snapshot(date)', 'execute'),
  'authenticated may execute the builder (the zero user is its guard)');
select ok(not has_function_privilege('anon', 'app.dashboard_build_snapshot(date)', 'execute'),
  'anon may not execute the builder');
select ok(
  not (has_function_privilege('authenticated', 'app.dashboard_area_overview(date)', 'execute')
       or has_function_privilege('anon', 'app.dashboard_area_overview(date)', 'execute')),
  'the area helper is executable by neither authenticated nor anon (only the owner-run builder calls it)');
select results_eq(
  $$ select policyname::text collate "default" from pg_policies
      where schemaname = 'public' and tablename in ('dashboard_snapshots', 'dashboard_member_snapshots')
      order by 1 $$,
  ARRAY['dashboard_member_snapshots_select_own_or_admin', 'dashboard_snapshots_select_admin'],
  'D-462: each snapshot table carries exactly its one SELECT policy');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('dashboard_snapshots', 'dashboard_member_snapshots')
      and cmd <> 'SELECT'),
  0, 'neither snapshot table has an insert, update or delete policy');

select * from finish();
rollback;
