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
-- 5. COUNTED ACTIONS AND BANDS (08.7-02, UI-D-484, UI-D-486, D-440 [informational], R-Pitfall 9):
--    tenant C (`America/Sao_Paulo`), one member per band edge, every action dated at a tenant-local
--    instant of D-k: 11 active days with 3 strong → engaged, 12 with 3 → superfan, 12 with 2 →
--    engaged; 4 days → engaged, 3 → occasional; an action only on D-30 → at_risk, only on D-60 →
--    inactive; joined on D-29 → new, on D-30 → not new; an action at 02:30Z counts for the previous
--    local day (both at D and at D-30); removed and self-deleted comments, a `not_going` RSVP, a
--    revoked order and every staff action count nowhere; a walk-in counts as a strong check-in, a
--    paid order as a strong order, an RSVP "vou" by `responded_at`. The members payload carries the
--    exact band counts (not floored), `actions30`, `activeMembers30` and the event's RSVP bands; a
--    build overwrites the tenant's member rows and drops a blocked member's (PR-2).
-- 6. MOVEMENT AND COHORTS (UI-D-487): tenant M — engaged at D-30 and occasional at D is `down` and
--    the flow engaged→occasional, occasional→engaged is `up`, a member new at D-30 is in neither;
--    the bands at D-30, the 12 + 12 interacting weeks and the weekly joins. Tenant H — the last 6
--    complete joining months (month 0 = 100, the lone member with an action in D's month gives 100,
--    an inactive one 0), one community's base, band and card numbers, the per-member insights.
-- 7. POSTURE (R-Risk 1, T-08.7-05): the two tenant-first window indexes exist; the three new
--    functions are SECURITY DEFINER, pin an empty search_path and are executable by no lane role.
-- 8. MEMBER ACTIVITY (08.7-03, D-463, D-440 [informational], UI-D-475, UI-D-483, UI-D-485,
--    T-08.7-09): tenant V (`America/Sao_Paulo`). v601's likes at local 23:59 of D and 00:00 of D-6
--    count, one at 23:59 of D-7 is `previous`, one made today counts nowhere (EP-01); a removed
--    comment counts nowhere; story views of D-6..D count (a story deleted since included, planning
--    decision 5), one at 23:59 of D-7 and one today do not; byCommunity is the tenant-wide feed as a
--    null row and the community, most first; attendance counts the events starting in D-29..D
--    (00:00 of D-29 in, 23:59 of D-30 out) the member was in (`going`, `checked_in`, `walk_in`), a
--    `not_going` and a cancelled event left out, attended = checked in or walked in (UI-D-485). The
--    week streak counts Monday-first calendar weeks: one week → 1 (stored, the web hides it), a run
--    across a gap stops at the gap, a run anchored on the week before when D's week has no action
--    yet, an action at local Sunday 23:30 (02:30Z Monday) counts for its Sunday's week, no action in
--    either anchor week → 0. A member with no action holds real zeros (EP-02); the member lane
--    reads only its own row; the function is a definer no lane role may execute.
--
-- Fixture ids use the `19800000-…` prefix and the tenants `pgtap-dashboard-a` / `-b` / `-e` / `-c` /
-- `-m` / `-h`, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(118);

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
  7, 'the row carries the builder''s payload version (7 since 08.7-11: the support area)');

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
select is(
  (select count(*)::int from public.dashboard_member_snapshots
    where user_id = '19800000-0000-4000-8000-000000000004'),
  0, 'PR-2: the rebuild dropped blocked M''s member row (latest only, no trail kept)');
select results_eq(
  $$ select user_id::text from public.dashboard_member_snapshots
      where tenant_id = '19800000-0000-4000-8000-000000000001' order by user_id $$,
  ARRAY['19800000-0000-4000-8000-000000000005', '19800000-0000-4000-8000-000000000006',
        '19800000-0000-4000-8000-000000000008'],
  'one member row per active member joined before the end of D (N, P, R): Q joined today, staff, S and T get none');

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

-- ── 5. counted actions and bands (08.7-02) ─────────────────────────────────────────────────────
-- Helpers (rolled back with the file): D is the São Paulo yesterday; `at(k, t)` the São Paulo local
-- instant `t` of D-k; `likes` gives one like per listed day, each on a different post of the tenant
-- (a like is unique per member and post); `comment` writes one comment on the tenant's first post,
-- soft-deleted by `p_deleted_by` when given (the author: self-deleted; a moderator: removed).
create function pg_temp.d() returns date
language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date - 1 $$;
create function pg_temp.at(p_k int, p_time time default '12:00') returns timestamptz
language sql as $$ select ((pg_temp.d() - p_k)::timestamp + p_time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.likes(p_tenant uuid, p_user uuid, p_days int[]) returns void
language sql as $$
  insert into public.feed_likes (tenant_id, user_id, post_id, created_at)
  select p_tenant, p_user, p.id, pg_temp.at(x.k)
    from unnest(p_days) with ordinality as x(k, n)
    join (select fp.id, row_number() over (order by fp.id) as n
            from public.feed_posts fp where fp.tenant_id = p_tenant and fp.community_id is null) p
      on p.n = x.n
$$;
create function pg_temp.comment(p_tenant uuid, p_user uuid, p_k int, p_deleted_by uuid default null)
returns void
language sql as $$
  insert into public.feed_comments (tenant_id, post_id, author_user_id, body, created_at, deleted_at,
                                    deleted_by_user_id)
  select p_tenant, fp.id, p_user, 'Comentário.', pg_temp.at(p_k),
         case when p_deleted_by is null then null else pg_temp.at(p_k) + interval '1 hour' end,
         p_deleted_by
    from public.feed_posts fp
   where fp.tenant_id = p_tenant and fp.community_id is null
   order by fp.id
   limit 1
$$;
create function pg_temp.ev(p_id uuid, p_tenant uuid, p_author uuid, p_starts timestamptz,
                           p_ends timestamptz, p_code text) returns void
language sql as $$
  with e as (
    insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                               address, starts_at, ends_at, category, capacity)
    values (p_id, p_tenant, p_author, 'Encontro', 'in_person', 'Sede', 'Rua A, 1', p_starts, p_ends,
            null, 10)
    returning id, tenant_id, format
  )
  insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
  select id, tenant_id, format, p_code from e
$$;
create function pg_temp.build(p_tenant uuid) returns boolean
language plpgsql as $$
declare
  v_day date := pg_temp.d();
  v boolean;
begin
  perform tests.as_tenant(p_tenant, '00000000-0000-0000-0000-000000000000', 'support_tenant');
  v := app.dashboard_build_snapshot(v_day);
  reset role;
  return v;
end
$$;
create function pg_temp.row_of(p_user uuid) returns text
language sql as $$
  select s.band || '/' || s.active_days_30 || '/' || s.strong_30
    from public.dashboard_member_snapshots s where s.user_id = p_user
$$;
create function pg_temp.members_of(p_tenant uuid) returns jsonb
language sql as $$
  select s.payload -> 'members' from public.dashboard_snapshots s
   where s.tenant_id = p_tenant and s.snapshot_day = pg_temp.d()
$$;

-- Tenant C: an admin, a support person and 17 members, every one joined 100 days ago at 10:00
-- except c308 (12:00 of D-29) and c309 (12:00 of D-30).
select tests.tenant('pgtap-dashboard-c', 'Painel C', '19800000-0000-4000-8000-000000000031');
select tests.tenant('pgtap-dashboard-m', 'Painel M', '19800000-0000-4000-8000-000000000041');
select tests.tenant('pgtap-dashboard-h', 'Painel H', '19800000-0000-4000-8000-000000000051');
update public.tenants set timezone = 'America/Sao_Paulo'
 where id in ('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000041',
              '19800000-0000-4000-8000-000000000051');
select tests.auth_user('admin@dashboard-c.local', '19800000-0000-4000-8000-000000000032');
select tests.auth_user('support@dashboard-c.local', '19800000-0000-4000-8000-000000000033');
select tests.member('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000032', 'admin_tenant');
select tests.member('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000033', 'support_tenant');
select tests.auth_user('c' || x || '@dashboard-c.local', ('19800000-0000-4000-8000-000000000' || x)::uuid)
  from unnest(array['301','302','303','304','305','306','307','308','309','30a','30b','30c','30d',
                    '30e','30f','310','311']) as x;
select tests.member('19800000-0000-4000-8000-000000000031', ('19800000-0000-4000-8000-000000000' || x)::uuid)
  from unnest(array['301','302','303','304','305','306','307','308','309','30a','30b','30c','30d',
                    '30e','30f','310','311']) as x;
update public.memberships set joined_at = pg_temp.at(99, '10:00')
 where tenant_id = '19800000-0000-4000-8000-000000000031';
update public.memberships set joined_at = pg_temp.at(29) where user_id = '19800000-0000-4000-8000-000000000308';
update public.memberships set joined_at = pg_temp.at(30) where user_id = '19800000-0000-4000-8000-000000000309';
-- 14 tenant-wide posts by the admin, published long before every window.
insert into public.feed_posts (id, tenant_id, caption, author_user_id, created_at)
select ('19800000-0000-4000-8000-0000000c' || lpad(to_hex(g), 4, '0'))::uuid,
       '19800000-0000-4000-8000-000000000031', 'Aviso.', '19800000-0000-4000-8000-000000000032',
       pg_temp.at(150)
  from generate_series(1, 14) as g;
select pg_temp.likes('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000301', array[0,1,2,3,4,5,6,7,8,9,10]);
select pg_temp.comment('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000301', k) from unnest(array[0,1,2]) k;
select pg_temp.likes('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000302', array[0,1,2,3,4,5,6,7,8,9,10,11]);
select pg_temp.comment('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000302', k) from unnest(array[0,1,2]) k;
select pg_temp.likes('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000303', array[0,1,2,3,4,5,6,7,8,9,10,11]);
select pg_temp.comment('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000303', k) from unnest(array[0,1]) k;
select pg_temp.likes('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000304', array[0,1,2,3]);
select pg_temp.likes('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000305', array[0,1,2]);
select pg_temp.likes('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000306', array[30]);
select pg_temp.likes('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000307', array[60]);
-- c30a: 02:30Z of the UTC date D-29 is 23:30 of D-30 in São Paulo; c30b: 02:30Z of today's UTC date
-- is 23:30 of D.
insert into public.feed_likes (tenant_id, user_id, post_id, created_at) values
  ('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-00000000030a',
   '19800000-0000-4000-8000-0000000c0001', ((pg_temp.d() - 29)::timestamp + time '02:30') at time zone 'UTC'),
  ('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-00000000030b',
   '19800000-0000-4000-8000-0000000c0001', ((pg_temp.d() + 1)::timestamp + time '02:30') at time zone 'UTC');
-- c30c: one like (D-5), a comment removed by the admin (D-6) and a self-deleted one (D-7).
select pg_temp.likes('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-00000000030c', array[5]);
select pg_temp.comment('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-00000000030c', 6, '19800000-0000-4000-8000-000000000032');
select pg_temp.comment('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-00000000030c', 7, '19800000-0000-4000-8000-00000000030c');
-- Staff: the admin likes every post on 13 days and comments; support comments. None of it counts.
select pg_temp.likes('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000032', array[0,1,2,3,4,5,6,7,8,9,10,11,12]);
select pg_temp.comment('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000032', k) from unnest(array[0,1,2,3]) k;
select pg_temp.comment('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000033', 1);
-- Events: ev1 starts tomorrow (c30d answered "não vou" on D-3, c311 "vou" on D-8); ev2 is open for
-- check-in now (c30e walked in, stamped at D-2).
select pg_temp.ev('19800000-0000-4000-8000-0000000003e1', '19800000-0000-4000-8000-000000000031',
                  '19800000-0000-4000-8000-000000000032', now() + interval '1 day',
                  now() + interval '1 day 2 hours', 'K7QA');
select pg_temp.ev('19800000-0000-4000-8000-0000000003e2', '19800000-0000-4000-8000-000000000031',
                  '19800000-0000-4000-8000-000000000032', now() - interval '30 minutes',
                  now() + interval '1 hour', 'K7QB');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via) values
  ('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-0000000003e1', '19800000-0000-4000-8000-00000000030d', 'not_going', pg_temp.at(3), null, null),
  ('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-0000000003e1', '19800000-0000-4000-8000-000000000311', 'going', pg_temp.at(8), null, null),
  ('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-0000000003e2', '19800000-0000-4000-8000-00000000030e', 'walk_in', null, pg_temp.at(2), 'code');
-- Orders: c30f's was revoked (it keeps its paid_at), c310's is paid on D-4.
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents) values
  ('19800000-0000-4000-8000-0000000003f1', '19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000032', 'Produto', 1000);
insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, paid_at, revoked_at, revoked_by_user_id) values
  ('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-00000000030f', '19800000-0000-4000-8000-0000000003f1', 'revoked', 1000, 'BRL', pg_temp.at(4), pg_temp.at(4) + interval '1 hour', '19800000-0000-4000-8000-000000000032'),
  ('19800000-0000-4000-8000-000000000031', '19800000-0000-4000-8000-000000000310', '19800000-0000-4000-8000-0000000003f1', 'paid', 1000, 'BRL', pg_temp.at(4), null, null);

select is(pg_temp.build('19800000-0000-4000-8000-000000000031'), true, 'tenant C builds its yesterday');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000301'), 'engaged/11/3',
  'R-Pitfall 9: 11 active days with 3 strong actions → engaged');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000302'), 'superfan/12/3',
  'R-Pitfall 9: 12 active days with 3 strong actions → superfan');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000303'), 'engaged/12/2',
  'R-Pitfall 9: 12 active days with only 2 strong actions → engaged');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000304'), 'engaged/4/0',
  'R-Pitfall 9: 4 active days → engaged');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000305'), 'occasional/3/0',
  'R-Pitfall 9: 3 active days → occasional');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000306'), 'at_risk/0/0',
  'R-Pitfall 9: an action only on D-30 → at_risk');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000307'), 'inactive/0/0',
  'R-Pitfall 9: an action only on D-60 → inactive');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000308'), 'new/0/0',
  'R-Pitfall 9: joined on D-29 → new');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000309'), 'inactive/0/0',
  'R-Pitfall 9: joined on D-30 → not new (inactive with no action)');
select is(pg_temp.row_of('19800000-0000-4000-8000-00000000030a'), 'at_risk/0/0',
  'D-440: an action at 02:30Z counts for the previous São Paulo day (23:30 of D-30 → at_risk, not occasional)');
select is(pg_temp.row_of('19800000-0000-4000-8000-00000000030b'), 'occasional/1/0',
  'D-440: an action at 02:30Z of today''s UTC date is 23:30 of D: it counts, today never does');
select is(pg_temp.row_of('19800000-0000-4000-8000-00000000030c'), 'occasional/1/0',
  'UI-D-484: a removed comment and a self-deleted comment count nowhere (only the like''s day)');
select is(pg_temp.row_of('19800000-0000-4000-8000-00000000030d'), 'inactive/0/0',
  'R-Pitfall 6: a "não vou" RSVP is not a counted action');
select is(pg_temp.row_of('19800000-0000-4000-8000-00000000030e'), 'occasional/1/1',
  'a walk-in counts as a check-in, a strong action dated by checked_in_at');
select is(pg_temp.row_of('19800000-0000-4000-8000-00000000030f'), 'inactive/0/0',
  'R-Pitfall 5: a revoked order (it keeps paid_at) is not a counted action');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000310'), 'occasional/1/1',
  'a paid order is a strong action dated by paid_at');
select is(pg_temp.row_of('19800000-0000-4000-8000-000000000311'), 'occasional/1/0',
  'R-Pitfall 6: an RSVP "vou" counts, dated by responded_at, and is not strong');
select is(
  (select count(*)::int from public.dashboard_member_snapshots
    where user_id in ('19800000-0000-4000-8000-000000000032', '19800000-0000-4000-8000-000000000033')),
  0, 'UI-D-484: staff get no member row');
select is(
  (select count(*)::int from public.dashboard_member_snapshots where tenant_id = '19800000-0000-4000-8000-000000000031'),
  17, 'one member row per active member of C');
select is(
  (select band_d30 || '/' || band_d60 from public.dashboard_member_snapshots
    where user_id = '19800000-0000-4000-8000-000000000302'),
  'inactive/inactive', 'the same band expression at D-30 and D-60 (c302 had no action before D-11)');
select is(
  (select band_d30 from public.dashboard_member_snapshots where user_id = '19800000-0000-4000-8000-000000000308'),
  null, 'band_d30 is null for a member who had not joined yet at D-30');
select is(
  (select last_active_at from public.dashboard_member_snapshots where user_id = '19800000-0000-4000-8000-000000000302'),
  pg_temp.at(0), 'last_active_at is the member''s latest counted action');
select is(
  (select insights -> 'last30' from public.dashboard_member_snapshots where user_id = '19800000-0000-4000-8000-000000000302'),
  '{"activeDays": 12, "likes": 12, "comments": 3, "checkIns": 0, "orders": 0, "strongActions": 3}'::jsonb,
  'insights.last30 holds the member''s 30-day numbers');
select is(
  (select insights -> 'weeklyActiveDays' from public.dashboard_member_snapshots where user_id = '19800000-0000-4000-8000-000000000302'),
  '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 7]'::jsonb,
  'insights.weeklyActiveDays: active days per 7-day block ending D, oldest first');
select is(
  (select (insights -> 'last30' ->> 'checkIns')::int + (insights -> 'last30' ->> 'orders')::int
     from public.dashboard_member_snapshots where user_id = '19800000-0000-4000-8000-00000000030e'),
  1, 'the walk-in is the member''s one check-in of the window');
select is(
  (select (insights -> 'last30' ->> 'orders')::int from public.dashboard_member_snapshots
    where user_id = '19800000-0000-4000-8000-000000000310'),
  1, 'the paid order is the member''s one order of the window');
select is(
  pg_temp.members_of('19800000-0000-4000-8000-000000000031') -> 'engagement',
  '{"counts": {"new": 1, "superfan": 1, "engaged": 3, "occasional": 6, "at_risk": 2, "inactive": 4}, "newActivated": 0}'::jsonb,
  'UI-D-486: the six band counts are exact, small ones included (never floored)');
select is((pg_temp.members_of('19800000-0000-4000-8000-000000000031') ->> 'actions30')::int, 55,
  'actions30 counts the members'' 55 actions of D-29..D, no staff, removed or self-deleted comment');
select is((pg_temp.members_of('19800000-0000-4000-8000-000000000031') ->> 'activeMembers30')::int, 10,
  'activeMembers30: the ten members with an active day in D-29..D');
select is(
  (select e -> 'bands' -> 'counts'
     from jsonb_array_elements(pg_temp.members_of('19800000-0000-4000-8000-000000000031') -> 'eventEngagement') e
    where e ->> 'id' = '19800000-0000-4000-8000-0000000003e1'),
  '{"new": 0, "superfan": 0, "engaged": 0, "occasional": 1, "at_risk": 0, "inactive": 0}'::jsonb,
  'eventEngagement: today''s band of each RSVP "vou" of the event ("não vou" left out)');
select is(
  (select payload_version from public.dashboard_snapshots
    where tenant_id = '19800000-0000-4000-8000-000000000031' and snapshot_day = pg_temp.d()),
  7, 'the builder writes payload version 7 (08.7-11; v6 added the finance area)');

-- ── 6. movement and cohorts ────────────────────────────────────────────────────────────────────
-- Tenant M (every member joined 400 days ago unless said): m401 engaged at D-30 (D-31..D-34) and
-- occasional at D (D-1); m402 occasional at D-30 (D-45) and engaged at D (D-1..D-4); m403 joined on
-- D-40 (new at D-30) with actions on D-35 and D-1; m404 never acted.
select tests.auth_user('admin@dashboard-m.local', '19800000-0000-4000-8000-000000000042');
select tests.member('19800000-0000-4000-8000-000000000041', '19800000-0000-4000-8000-000000000042', 'admin_tenant');
select tests.auth_user('m' || x || '@dashboard-m.local', ('19800000-0000-4000-8000-000000000' || x)::uuid)
  from unnest(array['401','402','403','404']) as x;
select tests.member('19800000-0000-4000-8000-000000000041', ('19800000-0000-4000-8000-000000000' || x)::uuid)
  from unnest(array['401','402','403','404']) as x;
update public.memberships set joined_at = pg_temp.at(399, '10:00')
 where tenant_id = '19800000-0000-4000-8000-000000000041';
update public.memberships set joined_at = pg_temp.at(40) where user_id = '19800000-0000-4000-8000-000000000403';
insert into public.feed_posts (id, tenant_id, caption, author_user_id, created_at)
select ('19800000-0000-4000-8000-0000000d' || lpad(to_hex(g), 4, '0'))::uuid,
       '19800000-0000-4000-8000-000000000041', 'Aviso.', '19800000-0000-4000-8000-000000000042',
       pg_temp.at(450)
  from generate_series(1, 6) as g;
select pg_temp.likes('19800000-0000-4000-8000-000000000041', '19800000-0000-4000-8000-000000000401', array[31,32,33,34,1]);
select pg_temp.likes('19800000-0000-4000-8000-000000000041', '19800000-0000-4000-8000-000000000402', array[45,1,2,3,4]);
select pg_temp.likes('19800000-0000-4000-8000-000000000041', '19800000-0000-4000-8000-000000000403', array[35,1]);
select is(pg_temp.build('19800000-0000-4000-8000-000000000041'), true, 'tenant M builds its yesterday');
select is(
  (select string_agg(band_d30 || '>' || band, ',' order by user_id) from public.dashboard_member_snapshots
    where tenant_id = '19800000-0000-4000-8000-000000000041'),
  'engaged>occasional,occasional>engaged,new>occasional,inactive>inactive',
  'the band 30 days before and today, member by member');
select is(
  pg_temp.members_of('19800000-0000-4000-8000-000000000041') -> 'movement',
  '{"up": 1, "down": 1, "flows": [{"from": "engaged", "to": "occasional", "members": 1}, {"from": "occasional", "to": "engaged", "members": 1}]}'::jsonb,
  'UI-D-487: engaged→occasional is down, occasional→engaged is up, the member new at D-30 is in neither');
select is(
  pg_temp.members_of('19800000-0000-4000-8000-000000000041') -> 'previousEngagement',
  '{"counts": {"new": 1, "superfan": 0, "engaged": 1, "occasional": 1, "at_risk": 0, "inactive": 1}, "newActivated": 1}'::jsonb,
  'previousEngagement: today''s members by their band at D-30');
select is(
  pg_temp.members_of('19800000-0000-4000-8000-000000000041') -> 'engagement',
  '{"counts": {"new": 0, "superfan": 0, "engaged": 1, "occasional": 2, "at_risk": 0, "inactive": 1}, "newActivated": 0}'::jsonb,
  'engagement: today''s bands of M');
select is(
  pg_temp.members_of('19800000-0000-4000-8000-000000000041') -> 'weeklyInteracting',
  '{"current": [0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 3], "previous": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]}'::jsonb,
  'weeklyInteracting: distinct members with an action per 7-day block ending D, 12 + 12 blocks');
select is(
  pg_temp.members_of('19800000-0000-4000-8000-000000000041') -> 'growth',
  '{"joined": 0, "weeklyJoined": [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]}'::jsonb,
  'growth: nobody joined in D-29..D, m403 joined in the block D-41..D-35');

-- Tenant H: h501 joined on the last day of the month before D's month and liked a community post
-- on D; h502 joined on the 1st of the month before that and never acted. One active community, its
-- one post published on D.
select tests.auth_user('admin@dashboard-h.local', '19800000-0000-4000-8000-000000000052');
select tests.member('19800000-0000-4000-8000-000000000051', '19800000-0000-4000-8000-000000000052', 'admin_tenant');
select tests.auth_user('h' || x || '@dashboard-h.local', ('19800000-0000-4000-8000-000000000' || x)::uuid)
  from unnest(array['501','502']) as x;
select tests.member('19800000-0000-4000-8000-000000000051', ('19800000-0000-4000-8000-000000000' || x)::uuid)
  from unnest(array['501','502']) as x;
update public.memberships
   set joined_at = ((date_trunc('month', pg_temp.d())::date - 1)::timestamp + time '12:00') at time zone 'America/Sao_Paulo'
 where user_id = '19800000-0000-4000-8000-000000000501';
update public.memberships
   set joined_at = ((date_trunc('month', pg_temp.d()) - interval '2 months')::date::timestamp + time '12:00') at time zone 'America/Sao_Paulo'
 where user_id = '19800000-0000-4000-8000-000000000502';
update public.memberships set joined_at = pg_temp.at(399, '10:00')
 where user_id = '19800000-0000-4000-8000-000000000052';
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, position) values
  ('19800000-0000-4000-8000-0000000005c1', '19800000-0000-4000-8000-000000000051',
   '19800000-0000-4000-8000-000000000052', 'Grupo', 'grupo', 1);
insert into public.feed_posts (id, tenant_id, community_id, caption, author_user_id, created_at) values
  ('19800000-0000-4000-8000-0000000005d1', '19800000-0000-4000-8000-000000000051',
   '19800000-0000-4000-8000-0000000005c1', 'Aviso.', '19800000-0000-4000-8000-000000000052', pg_temp.at(0, '09:00'));
insert into public.feed_likes (tenant_id, user_id, post_id, created_at) values
  ('19800000-0000-4000-8000-000000000051', '19800000-0000-4000-8000-000000000501',
   '19800000-0000-4000-8000-0000000005d1', pg_temp.at(0));
select is(pg_temp.build('19800000-0000-4000-8000-000000000051'), true, 'tenant H builds its yesterday');
select is(
  pg_temp.members_of('19800000-0000-4000-8000-000000000051') -> 'cohorts',
  jsonb_build_array(
    jsonb_build_object('month', to_char(date_trunc('month', pg_temp.d()) - interval '2 months', 'YYYY-MM'),
                       'values', '[100, 0, 0]'::jsonb),
    jsonb_build_object('month', to_char(date_trunc('month', pg_temp.d()) - interval '1 month', 'YYYY-MM'),
                       'values', '[100, 100]'::jsonb)),
  'UI-D-487: joining-month cohorts, oldest first, month 0 = 100; alone with an action in D''s month → 100');
select is(
  (select (community_bands ->> '19800000-0000-4000-8000-0000000005c1') = band
     from public.dashboard_member_snapshots where user_id = '19800000-0000-4000-8000-000000000501'),
  true, 'community_bands: the community band over that community''s posts (here the same as the base band)');
select is(
  (select jsonb_build_array(e -> 'members', e -> 'activeWeek', e -> 'posts', e -> 'interactions')
     from jsonb_array_elements(pg_temp.members_of('19800000-0000-4000-8000-000000000051') -> 'communityEngagement') e
    where e ->> 'id' = '19800000-0000-4000-8000-0000000005c1'),
  '[2, 1, 1, 1]'::jsonb,
  'communityEngagement: the base (every member, an open community), active this week, posts and interactions of 30 days');
select is(
  (select insights -> 'communities' from public.dashboard_member_snapshots where user_id = '19800000-0000-4000-8000-000000000501'),
  '[{"id": "19800000-0000-4000-8000-0000000005c1", "actions": 1}]'::jsonb,
  'insights.communities: actions since joining per community, most first');
select is(
  (select top_community_id::text from public.dashboard_member_snapshots where user_id = '19800000-0000-4000-8000-000000000501'),
  '19800000-0000-4000-8000-0000000005c1', 'top_community_id is the first community of that list');
select is(
  (select insights -> 'postTypes' from public.dashboard_member_snapshots where user_id = '19800000-0000-4000-8000-000000000501'),
  '[{"type": "text", "interactions": 1}]'::jsonb,
  'insights.postTypes: likes and comments since joining per post kind');

-- ── 7. posture (08.7-02) ───────────────────────────────────────────────────────────────────────
select has_index('public', 'feed_likes', 'feed_likes_tenant_created_idx',
  'R-Risk 1: feed_likes has its tenant-first window index');
select has_index('public', 'feed_comments', 'feed_comments_tenant_created_idx',
  'R-Risk 1: feed_comments has its tenant-first window index');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef
      and p.proname in ('dashboard_member_actions', 'dashboard_member_rows', 'dashboard_area_members')),
  3, 'the three 08.7-02 functions are SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and 'search_path=""' = any(p.proconfig)
      and p.proname in ('dashboard_member_actions', 'dashboard_member_rows', 'dashboard_area_members')),
  3, 'T-08.7-05: the three 08.7-02 functions pin search_path to empty');
select ok(
  (select bool_and(not has_function_privilege(r, f, 'execute'))
     from unnest(array['anon', 'authenticated', 'service_role']) as r,
          unnest(array['app.dashboard_member_actions(date, date)', 'app.dashboard_member_rows(date)',
                       'app.dashboard_area_members(date)']) as f
    where exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'app' and p.proname = 'dashboard_member_rows')),
  'the three 08.7-02 functions are executable by no lane role (only the owner-run builder calls them)');

-- ── 8. member activity (08.7-03) ───────────────────────────────────────────────────────────────
-- Tenant V: an admin and seven members joined 300 days ago; eight tenant-wide posts and one
-- community post published at D-200; four stories (one deleted since); six events created open or
-- in the future (the attendance guard judges now()), their attendances written, then the events
-- moved to their past start instants (no trigger guards an event's schedule) and E5 cancelled.
-- `W0` is the Monday of D's week (`date_trunc('week', D)`).
create function pg_temp.w0() returns date
language sql as $$ select date_trunc('week', pg_temp.d()::timestamp)::date $$;
create function pg_temp.local_at(p_day date, p_time time) returns timestamptz
language sql as $$ select (p_day::timestamp + p_time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.like_at(p_user uuid, p_post int, p_at timestamptz) returns void
language sql as $$
  insert into public.feed_likes (tenant_id, user_id, post_id, created_at)
  values ('19800000-0000-4000-8000-000000000061', p_user,
          ('19800000-0000-4000-8000-0000000e' || lpad(to_hex(p_post), 4, '0'))::uuid, p_at)
$$;
create function pg_temp.activity_of(p_user uuid) returns jsonb
language sql as $$
  select s.activity from public.dashboard_member_snapshots s
   where s.tenant_id = '19800000-0000-4000-8000-000000000061' and s.user_id = p_user
$$;

select tests.tenant('pgtap-dashboard-v', 'Painel V', '19800000-0000-4000-8000-000000000061');
update public.tenants set timezone = 'America/Sao_Paulo' where id = '19800000-0000-4000-8000-000000000061';
select tests.auth_user('admin@dashboard-v.local', '19800000-0000-4000-8000-000000000062');
select tests.member('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-000000000062', 'admin_tenant');
select tests.auth_user('v' || x || '@dashboard-v.local', ('19800000-0000-4000-8000-000000000' || x)::uuid)
  from unnest(array['601','602','603','604','605','606','607']) as x;
select tests.member('19800000-0000-4000-8000-000000000061', ('19800000-0000-4000-8000-000000000' || x)::uuid)
  from unnest(array['601','602','603','604','605','606','607']) as x;
update public.memberships set joined_at = pg_temp.at(299, '10:00')
 where tenant_id = '19800000-0000-4000-8000-000000000061';
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, position) values
  ('19800000-0000-4000-8000-0000000006c1', '19800000-0000-4000-8000-000000000061',
   '19800000-0000-4000-8000-000000000062', 'Grupo V', 'grupo-v', 1);
insert into public.feed_posts (id, tenant_id, caption, author_user_id, created_at)
select ('19800000-0000-4000-8000-0000000e' || lpad(to_hex(g), 4, '0'))::uuid,
       '19800000-0000-4000-8000-000000000061', 'Aviso.', '19800000-0000-4000-8000-000000000062',
       pg_temp.at(200)
  from generate_series(1, 8) as g;
insert into public.feed_posts (id, tenant_id, community_id, caption, author_user_id, created_at) values
  ('19800000-0000-4000-8000-0000000006d1', '19800000-0000-4000-8000-000000000061',
   '19800000-0000-4000-8000-0000000006c1', 'Aviso.', '19800000-0000-4000-8000-000000000062', pg_temp.at(200));
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('19800000-0000-4000-8000-0000000006a1', '19800000-0000-4000-8000-000000000061',
   '19800000-0000-4000-8000-000000000062', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, published_at, expires_at)
select ('19800000-0000-4000-8000-0000000006b' || g)::uuid, '19800000-0000-4000-8000-000000000061',
       '19800000-0000-4000-8000-000000000062', '19800000-0000-4000-8000-0000000006a1', 'image',
       now() - interval '1 hour', now() + interval '23 hours'
  from generate_series(1, 4) as g;

-- v601, EP-01: likes at 23:59 of D, 00:00 of D-6 and noon of D-3 (the community post) count; 23:59
-- of D-7 is `previous`; one made today (00:30 local) counts nowhere.
select pg_temp.like_at('19800000-0000-4000-8000-000000000601', 1, pg_temp.at(0, '23:59'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000601', 2, pg_temp.at(6, '00:00'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000601', 3, pg_temp.at(7, '23:59'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000601', 4, pg_temp.at(-1, '00:30'));
insert into public.feed_likes (tenant_id, user_id, post_id, created_at) values
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-000000000601',
   '19800000-0000-4000-8000-0000000006d1', pg_temp.at(3));
-- Comments: a live one on D-2, one removed by the admin on D-1, a live one on D-10.
insert into public.feed_comments (tenant_id, post_id, author_user_id, body, created_at, deleted_at, deleted_by_user_id) values
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-0000000e0001',
   '19800000-0000-4000-8000-000000000601', 'Comentário.', pg_temp.at(2), null, null),
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-0000000e0001',
   '19800000-0000-4000-8000-000000000601', 'Comentário.', pg_temp.at(1), pg_temp.at(1) + interval '1 hour',
   '19800000-0000-4000-8000-000000000062'),
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-0000000e0001',
   '19800000-0000-4000-8000-000000000601', 'Comentário.', pg_temp.at(10), null, null);
-- Story views: 00:00 of D-6 and noon of D-1 count (b2 deleted since: it still counts); 23:59 of D-7
-- and 00:30 of today do not.
insert into public.story_views (tenant_id, user_id, story_id, viewed_at) values
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-000000000601', '19800000-0000-4000-8000-0000000006b1', pg_temp.at(6, '00:00')),
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-000000000601', '19800000-0000-4000-8000-0000000006b2', pg_temp.at(1)),
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-000000000601', '19800000-0000-4000-8000-0000000006b3', pg_temp.at(7, '23:59')),
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-000000000601', '19800000-0000-4000-8000-0000000006b4', pg_temp.at(-1, '00:30'));
update public.stories set deleted_at = now() where id = '19800000-0000-4000-8000-0000000006b2';
-- Events: E1 and E3 open now (check-in / walk-in), E2, E4, E5, E6 in the future (RSVP).
select pg_temp.ev('19800000-0000-4000-8000-0000000006e1', '19800000-0000-4000-8000-000000000061',
  '19800000-0000-4000-8000-000000000062', now() - interval '30 minutes', now() + interval '1 hour', 'VA2C');
select pg_temp.ev('19800000-0000-4000-8000-0000000006e2', '19800000-0000-4000-8000-000000000061',
  '19800000-0000-4000-8000-000000000062', now() + interval '1 day', now() + interval '1 day 2 hours', 'VB3D');
select pg_temp.ev('19800000-0000-4000-8000-0000000006e3', '19800000-0000-4000-8000-000000000061',
  '19800000-0000-4000-8000-000000000062', now() - interval '30 minutes', now() + interval '1 hour', 'VC4E');
select pg_temp.ev('19800000-0000-4000-8000-0000000006e4', '19800000-0000-4000-8000-000000000061',
  '19800000-0000-4000-8000-000000000062', now() + interval '1 day', now() + interval '1 day 2 hours', 'VD5F');
select pg_temp.ev('19800000-0000-4000-8000-0000000006e5', '19800000-0000-4000-8000-000000000061',
  '19800000-0000-4000-8000-000000000062', now() + interval '1 day', now() + interval '1 day 2 hours', 'VE6G');
select pg_temp.ev('19800000-0000-4000-8000-0000000006e6', '19800000-0000-4000-8000-000000000061',
  '19800000-0000-4000-8000-000000000062', now() + interval '1 day', now() + interval '1 day 2 hours', 'VF7H');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via) values
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-0000000006e1', '19800000-0000-4000-8000-000000000601', 'checked_in', pg_temp.at(30), pg_temp.at(29, '00:30'), 'code'),
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-0000000006e2', '19800000-0000-4000-8000-000000000601', 'going', pg_temp.at(31), null, null),
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-0000000006e3', '19800000-0000-4000-8000-000000000601', 'walk_in', null, pg_temp.at(5), 'code'),
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-0000000006e4', '19800000-0000-4000-8000-000000000601', 'not_going', pg_temp.at(4), null, null),
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-0000000006e5', '19800000-0000-4000-8000-000000000601', 'going', pg_temp.at(5), null, null),
  ('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-0000000006e6', '19800000-0000-4000-8000-000000000601', 'going', pg_temp.at(2), null, null);
update public.events e
   set starts_at = v.starts_at, ends_at = v.starts_at + interval '2 hours'
  from (values ('19800000-0000-4000-8000-0000000006e1'::uuid, pg_temp.at(29, '00:00')),
               ('19800000-0000-4000-8000-0000000006e2'::uuid, pg_temp.at(30, '23:59')),
               ('19800000-0000-4000-8000-0000000006e3'::uuid, pg_temp.at(5)),
               ('19800000-0000-4000-8000-0000000006e4'::uuid, pg_temp.at(3)),
               ('19800000-0000-4000-8000-0000000006e5'::uuid, pg_temp.at(4)),
               ('19800000-0000-4000-8000-0000000006e6'::uuid, pg_temp.at(1))) as v(id, starts_at)
 where e.id = v.id;
update public.events set status = 'cancelled', cancelled_at = now()
 where id = '19800000-0000-4000-8000-0000000006e5';

-- The week streak (UI-D-483), each like on its own post: v602 one week (W0); v603 W0, W0-7, then a
-- gap, W0-21 and W0-28; v604 W0-7 and W0-14 (D's week empty: anchored on the week before); v605
-- Sunday W0-8 at 23:30 local (02:30Z Monday W0-7) and Monday W0-7; v606 W0-14 and W0-21 only; v607
-- never acts.
select pg_temp.like_at('19800000-0000-4000-8000-000000000602', 1, pg_temp.local_at(pg_temp.w0(), '12:00'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000603', 1, pg_temp.local_at(pg_temp.w0(), '00:10'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000603', 2, pg_temp.local_at(pg_temp.w0() - 7, '12:00'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000603', 3, pg_temp.local_at(pg_temp.w0() - 21, '12:00'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000603', 4, pg_temp.local_at(pg_temp.w0() - 28, '12:00'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000604', 1, pg_temp.local_at(pg_temp.w0() - 7, '12:00'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000604', 2, pg_temp.local_at(pg_temp.w0() - 14, '12:00'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000605', 1, pg_temp.local_at(pg_temp.w0() - 8, '23:30'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000605', 2, pg_temp.local_at(pg_temp.w0() - 7, '12:00'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000606', 1, pg_temp.local_at(pg_temp.w0() - 14, '12:00'));
select pg_temp.like_at('19800000-0000-4000-8000-000000000606', 2, pg_temp.local_at(pg_temp.w0() - 21, '12:00'));

select is(pg_temp.build('19800000-0000-4000-8000-000000000061'), true, 'tenant V builds its yesterday');
select is(pg_temp.activity_of('19800000-0000-4000-8000-000000000601') -> 'likes',
  '{"count": 3, "previous": 1}'::jsonb,
  'EP-01 (INSIGHT-01): likes at 23:59 of D, 00:00 of D-6 and noon of D-3 count; 23:59 of D-7 is previous; today counts nowhere');
select is(pg_temp.activity_of('19800000-0000-4000-8000-000000000601') -> 'comments',
  '{"count": 1, "previous": 1}'::jsonb,
  'comments: the live D-2 one counts, the removed D-1 one never, the D-10 one is previous');
select is(pg_temp.activity_of('19800000-0000-4000-8000-000000000601') -> 'storiesSeen',
  '2'::jsonb,
  'D-458 (INSIGHT-02): own story views of D-6..D count, a story deleted since included; 23:59 of D-7 and today do not');
select is(pg_temp.activity_of('19800000-0000-4000-8000-000000000601') -> 'byCommunity',
  '[{"communityId": null, "interactions": 3}, {"communityId": "19800000-0000-4000-8000-0000000006c1", "interactions": 1}]'::jsonb,
  'UI-D-475 (INSIGHT-03): likes and live comments of D-6..D per community, the tenant-wide feed as null, most first');
select ok(pg_temp.activity_of('19800000-0000-4000-8000-000000000601')::text not like '%Grupo V%',
  'PR-1: the stored activity names no community (ids and numbers only; names are joined live)');
select is(pg_temp.activity_of('19800000-0000-4000-8000-000000000601') -> 'attendance',
  '{"attended": 2, "events": 3}'::jsonb,
  'UI-D-485 / EP-09 (INSIGHT-04): events from 00:00 of D-29 (23:59 of D-30 out) the member was in, not_going and cancelled left out; attended = checked in or walked in');
select is((pg_temp.activity_of('19800000-0000-4000-8000-000000000602') ->> 'weekStreak')::int, 1,
  'UI-D-483: a single week is a streak of 1 (stored; the web shows the tile only from 2)');
select is((pg_temp.activity_of('19800000-0000-4000-8000-000000000603') ->> 'weekStreak')::int, 2,
  'UI-D-483: the run ending at D''s week stops at the first week with no action');
select is((pg_temp.activity_of('19800000-0000-4000-8000-000000000604') ->> 'weekStreak')::int, 2,
  'UI-D-483: with no action in D''s week yet, the run ends at the week before');
select is(
  (select to_char(pg_temp.local_at(pg_temp.w0() - 8, '23:30') at time zone 'UTC', 'ID HH24:MI')),
  '1 02:30', 'the Sunday 23:30 local instant of v605 is 02:30Z on a Monday');
select is((pg_temp.activity_of('19800000-0000-4000-8000-000000000605') ->> 'weekStreak')::int, 2,
  'EP-10 (INSIGHT-04): an action at Sunday 23:30 local (02:30Z Monday) counts for its Sunday''s week, not the next');
select is((pg_temp.activity_of('19800000-0000-4000-8000-000000000606') ->> 'weekStreak')::int, 0,
  'UI-D-483: no action in D''s week nor the week before → 0');
select is(pg_temp.activity_of('19800000-0000-4000-8000-000000000607'),
  '{"likes": {"count": 0, "previous": 0}, "comments": {"count": 0, "previous": 0}, "storiesSeen": 0, "byCommunity": [], "attendance": {"attended": 0, "events": 0}, "weekStreak": 0}'::jsonb,
  'EP-02 (INSIGHT-01): a member with no action holds real zeros, never a missing key');
select is(
  (select count(*)::int from public.dashboard_member_snapshots
    where tenant_id = '19800000-0000-4000-8000-000000000061' and activity is null),
  0, 'builder v3: every member row of the build carries its activity');
select tests.as_tenant('19800000-0000-4000-8000-000000000061', '19800000-0000-4000-8000-000000000601');
select results_eq(
  $$ select user_id::text from public.dashboard_member_snapshots $$,
  ARRAY['19800000-0000-4000-8000-000000000601'],
  'T-08.7-09: v601''s member lane reads only its own member row');
select is(
  (select count(*)::int from public.dashboard_member_snapshots
    where user_id = '19800000-0000-4000-8000-000000000602'),
  0, 'T-08.7-09: v601''s member lane reading v602''s row gets 0 rows');
reset role;
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'dashboard_member_activity' and p.prosecdef
      and 'search_path=""' = any(p.proconfig)),
  1, 'T-08.7-05: app.dashboard_member_activity is SECURITY DEFINER with an empty search_path');
select ok(
  coalesce((select bool_and(not has_function_privilege(r, 'app.dashboard_member_activity(date)', 'execute'))
     from unnest(array['anon', 'authenticated', 'service_role']) as r
    where exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'app' and p.proname = 'dashboard_member_activity')), false),
  'app.dashboard_member_activity is executable by no lane role (only the owner-run builder calls it)');

select * from finish();
rollback;
