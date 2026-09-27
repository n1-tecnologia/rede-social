begin;
-- 142-event-checkin.sql — EVENT-04 in person, executed inside Postgres (06-05): the SECURITY DEFINER
-- `app.events_check_in(uuid, text)` and the guess counter it alone writes. Numbered 142 because 140
-- and 141 are 06-01's events and 06-03's attendances (130 belongs to 05.3's reels).
--
-- `now()` is the transaction timestamp, so it is the SAME instant here and inside the function for
-- the whole file: every window boundary below is exact.
--
-- 1. T-06-29, THE PRIVILEGE FACTS. The function is `prosecdef`, pins `search_path=""`, is NOT
--    executable by `anon` (PUBLIC's default EXECUTE was revoked), and IS executable by
--    `authenticated` (the tenant lane's role, the positive control). With no claims it answers
--    `not_found`.
--
-- 2. D-216, `going` -> `checked_in`. The right code, typed as `k7-qm`, inside the window, from a member
--    lane whose answer was `Vou`: `checked_in`, and the row keeps its `responded_at`, with
--    `checkin_via = 'code'`.
--
-- 3. D-216, WALK-IN. With no row: `walk_in` (and `responded_at` stays null). From `not_going`:
--    `walk_in` (and `responded_at` is kept).
--
-- 4. ALREADY. A second call, even with a WRONG code, answers `already` with the original stamp, writes
--    no second row and spends no guess (no attempts row appears).
--
-- 5. D-217, THE GUESS BOUND (T-06-27, Pitfall 1). Five wrong codes each RETURN `wrong_code` (never
--    raise), and `failed_count = 5` is visible through the member's own self-select policy: every
--    increment survived its refusal. The sixth call WITH THE RIGHT CODE answers `too_many_attempts`.
--    After `window_started_at` is moved back 16 minutes (the service lane), a wrong code restarts the
--    count at 1, and the right code then checks in.
--
-- 6. D-209, THE OPENING EDGE. `starts_at = now() + 61 minutes` answers `not_open`, and
--    `now() + 59 minutes` checks in.
--
-- 7. D-209, THE CLOSING EDGE. `ends_at = now()` answers `closed`.
--
-- 8. D-201. A cancelled event answers `cancelled`.
--
-- 9. An ONLINE event answers `not_found`: presence online is `Entrar` (06-06), never a code.
--
-- 10. PITFALL 2 (T-06-28). Tenant A's lane calling with tenant B's event id (right code, then a wrong
--     one) answers `not_found` both times, and B's `event_attendances` and `event_checkin_attempts`
--     counts are unchanged (read as the service lane). A's own event, in the same block, checks in.
--
-- 11. T-06-30. The member lane cannot INSERT (42501), UPDATE (0 rows) or DELETE (0 rows) its own
--     attempts row, the row is intact afterwards, and another member of the same tenant reads none of
--     it.
--
-- 12..20 (06-06) — EVENT-04 ONLINE, the SECURITY DEFINER `app.events_enter(uuid)` (D-207, D-210,
--     D-218). Its URL leaves the database ONLY with `forward`, `recorded` or `already` (T-06-35):
-- 12. T-06-43, the same privilege facts as fact 1, and no claims gives `not_found`.
-- 13. P0 after `Vou`: `forward` WITH the URL, and NOTHING is written (the row is still `going`).
-- 14. P0 without an answer: `confirm_first` with a NULL URL, and no row appears.
-- 15. Inside the window: no row gives `recorded` + `walk_in`; `going` gives `recorded` + `checked_in`
--     keeping `responded_at`; both with `checkin_via = 'online'`.
-- 16. A repeat: `already` with the URL and the recorded status, and still one row.
-- 17. `ended` when `ends_at = now()`, with a NULL URL.
-- 18. `cancelled`, with a NULL URL.
-- 19. An IN-PERSON event gives `not_found` (its check-in is the venue code).
-- 20. T-06-38: tenant A's lane with B's online event id gives `not_found`, B's rows are unchanged
--     (read as the service lane), and A's own online event, same lane, same block, records.
--
-- The event fixtures carry their `event_secrets` rows (written in one statement), but this file never
-- commits, so the deferred keys are never checked; `140-events.sql` proves them. Fixture ids use the
-- `1e200000-…` prefix, free of 140's `1e000000-…` and 141's `1e100000-…`. Like its siblings, this
-- file ROLLS BACK.
select plan(65);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-ci-a', 'Checkin A', '1e200000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-ci-b', 'Checkin B', '1e200000-0000-4000-8000-000000000011');
select tests.auth_user('admin@ci-a.local', '1e200000-0000-4000-8000-000000000003');
select tests.auth_user('going@ci-a.local', '1e200000-0000-4000-8000-0000000000a1');
select tests.auth_user('none@ci-a.local', '1e200000-0000-4000-8000-0000000000a2');
select tests.auth_user('notgoing@ci-a.local', '1e200000-0000-4000-8000-0000000000a3');
select tests.auth_user('guesser@ci-a.local', '1e200000-0000-4000-8000-0000000000a4');
select tests.auth_user('peer@ci-a.local', '1e200000-0000-4000-8000-0000000000a5');
select tests.auth_user('member@ci-b.local', '1e200000-0000-4000-8000-000000000012');
select tests.member('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-000000000003', 'admin_tenant');
select tests.member('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a1');
select tests.member('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a2');
select tests.member('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a3');
select tests.member('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a4');
select tests.member('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a5');
select tests.member('1e200000-0000-4000-8000-000000000011', '1e200000-0000-4000-8000-000000000012');

-- Both halves of one event in ONE statement. Every in-person event's code is K7QM.
create function pg_temp.ev(
  p_id uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_status text default 'active',
  p_format text default 'in_person',
  p_tenant uuid default '1e200000-0000-4000-8000-000000000001',
  p_author uuid default '1e200000-0000-4000-8000-000000000003'
) returns void
language sql as $$
  with e as (
    insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                               address, starts_at, ends_at, status, cancelled_at)
    values (p_id, p_tenant, p_author, 'Evento', p_format,
            case when p_format = 'in_person' then 'Sede' end,
            case when p_format = 'in_person' then 'Rua A, 1' end,
            p_starts, p_ends, p_status,
            case when p_status = 'cancelled' then now() end)
    returning id, tenant_id, format
  )
  insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code, meeting_url)
  select id, tenant_id, format, 'K7QM',
         case when format = 'online' then 'https://meet.example.test/ci' end
    from e
$$;

-- E_win: in 30 minutes (inside the window). E_61 / E_59: the opening edge. E_end: ends NOW.
-- E_can: cancelled, inside the window. E_onl: ONLINE, inside the window. E_b: tenant B's, inside.
select pg_temp.ev('1e200000-0000-4000-8000-0000000000e1', now() + interval '30 minutes', now() + interval '2 hours 30 minutes');
select pg_temp.ev('1e200000-0000-4000-8000-0000000000e2', now() + interval '61 minutes', now() + interval '3 hours');
select pg_temp.ev('1e200000-0000-4000-8000-0000000000e3', now() + interval '59 minutes', now() + interval '3 hours');
select pg_temp.ev('1e200000-0000-4000-8000-0000000000e4', now() - interval '2 hours', now());
select pg_temp.ev('1e200000-0000-4000-8000-0000000000e5', now() + interval '30 minutes', now() + interval '2 hours', 'cancelled');
select pg_temp.ev('1e200000-0000-4000-8000-0000000000e6', now() + interval '30 minutes', now() + interval '2 hours', p_format => 'online');
select pg_temp.ev('1e200000-0000-4000-8000-0000000000e9', now() + interval '30 minutes', now() + interval '2 hours',
                  p_tenant => '1e200000-0000-4000-8000-000000000011', p_author => '1e200000-0000-4000-8000-000000000012');

-- The RSVP answers given BEFORE the check-in (the events are still before their start).
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at) values
  ('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000e1',
   '1e200000-0000-4000-8000-0000000000a1', 'going', now() - interval '1 day'),
  ('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000e1',
   '1e200000-0000-4000-8000-0000000000a3', 'not_going', now() - interval '1 day'),
  ('1e200000-0000-4000-8000-000000000011', '1e200000-0000-4000-8000-0000000000e9',
   '1e200000-0000-4000-8000-000000000012', 'going', now() - interval '1 day');

-- ── 1. the privilege facts ────────────────────────────────────────────────────────────────────
select ok(
  (select prosecdef from pg_proc where oid = 'app.events_check_in(uuid,text)'::regprocedure),
  'T-06-29: app.events_check_in is SECURITY DEFINER'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'app.events_check_in(uuid,text)'::regprocedure),
  'T-06-29: …and pins search_path to the empty string'
);
select ok(
  not has_function_privilege('anon', 'app.events_check_in(uuid,text)', 'execute'),
  'T-06-29: anon cannot execute it (PUBLIC''s default EXECUTE is revoked)'
);
select ok(
  has_function_privilege('authenticated', 'app.events_check_in(uuid,text)', 'execute'),
  'positive control: the tenant lane''s role (authenticated) can'
);
select tests.as_tenant_without_claims();
select results_eq(
  $$ select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'K7QM') $$,
  ARRAY['not_found'],
  'a lane with NO claims gets not_found, even with the right code'
);
reset role;

-- ── 2. going -> checked_in (D-216) ────────────────────────────────────────────────────────────
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a1');
select results_eq(
  $$ select outcome, checked_in_at = now(), starts_at = now() + interval '30 minutes'
       from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'k7-qm') $$,
  $$ values ('checked_in'::text, true, true) $$,
  'D-216: after Vou, the right code (typed k7-qm, normalised) checks in, with the stamp and starts_at'
);
select results_eq(
  $$ select status, responded_at = now() - interval '1 day', checkin_via
       from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000e1'
        and user_id = '1e200000-0000-4000-8000-0000000000a1' $$,
  $$ values ('checked_in'::text, true, 'code'::text) $$,
  '…the row is checked_in, keeps its responded_at ("Confirmou em" survives) and says via code'
);
reset role;

-- ── 3. walk-ins (D-216) ───────────────────────────────────────────────────────────────────────
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a2');
select results_eq(
  $$ select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', ' K7QM ') $$,
  ARRAY['walk_in'],
  'D-216: with NO prior answer, the right code is a walk-in'
);
select results_eq(
  $$ select status, responded_at is null from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000e1'
        and user_id = '1e200000-0000-4000-8000-0000000000a2' $$,
  $$ values ('walk_in'::text, true) $$,
  '…recorded as walk_in with no responded_at'
);
reset role;
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a3');
select results_eq(
  $$ select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'K7QM') $$,
  ARRAY['walk_in'],
  'D-216: after Não vou, the right code is ALSO a walk-in'
);
select results_eq(
  $$ select status, responded_at is not null from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000e1'
        and user_id = '1e200000-0000-4000-8000-0000000000a3' $$,
  $$ values ('walk_in'::text, true) $$,
  '…and the row keeps the responded_at of its Não vou'
);
reset role;

-- ── 4. already ────────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a1');
select results_eq(
  $$ select outcome, checked_in_at = now()
       from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'ZZZZ') $$,
  $$ values ('already'::text, true) $$,
  'an already-present member re-submitting (even a WRONG code) gets already with the original stamp'
);
select results_eq(
  $$ select count(*)::int from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000e1'
        and user_id = '1e200000-0000-4000-8000-0000000000a1' $$,
  ARRAY[1],
  '…no second attendance row exists'
);
select is_empty(
  $$ select 1 from public.event_checkin_attempts
      where event_id = '1e200000-0000-4000-8000-0000000000e1'
        and user_id = '1e200000-0000-4000-8000-0000000000a1' $$,
  '…and no guess was spent (no attempts row)'
);
reset role;

-- ── 5. the guess bound (D-217, T-06-27, Pitfall 1) ────────────────────────────────────────────
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a4');
select is((select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'AAAA')),
          'wrong_code', 'wrong code 1 RETURNS wrong_code (never raises)');
select is((select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'BBBB')),
          'wrong_code', 'wrong code 2');
select is((select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'CCCC')),
          'wrong_code', 'wrong code 3');
select is((select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'DDDD')),
          'wrong_code', 'wrong code 4');
select is((select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'EEEE')),
          'wrong_code', 'wrong code 5');
select results_eq(
  $$ select failed_count, window_started_at = now() from public.event_checkin_attempts
      where event_id = '1e200000-0000-4000-8000-0000000000e1' $$,
  $$ values (5, true) $$,
  'D-217: failed_count = 5 through the member''s OWN self-select policy (every increment survived)'
);
select is((select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'K7QM')),
          'too_many_attempts', 'T-06-27: the sixth attempt WITH THE RIGHT CODE answers too_many_attempts');
select is_empty(
  $$ select 1 from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000e1'
        and user_id = '1e200000-0000-4000-8000-0000000000a4' $$,
  '…and no attendance was recorded'
);
reset role;
select tests.as_service();
update public.event_checkin_attempts set window_started_at = now() - interval '16 minutes'
 where tenant_id = '1e200000-0000-4000-8000-000000000001'
   and event_id = '1e200000-0000-4000-8000-0000000000e1'
   and user_id = '1e200000-0000-4000-8000-0000000000a4';
reset role;
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a4');
select is((select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'FFFF')),
          'wrong_code', '16 minutes later the bound has reset: a wrong code is counted again');
select results_eq(
  $$ select failed_count, window_started_at = now() from public.event_checkin_attempts
      where event_id = '1e200000-0000-4000-8000-0000000000e1' $$,
  $$ values (1, true) $$,
  '…as the first of a NEW window (failed_count 1, window restarted now)'
);
select is((select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'K7QM')),
          'walk_in', '…and the right code checks in');
reset role;

-- ── 6. the opening edge (D-209) ───────────────────────────────────────────────────────────────
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a2');
select results_eq(
  $$ select outcome, checked_in_at is null
       from app.events_check_in('1e200000-0000-4000-8000-0000000000e2', 'K7QM') $$,
  $$ values ('not_open'::text, true) $$,
  'D-209: an event starting in 61 minutes is not open yet (the window opens 1 hour before)'
);
select results_eq(
  $$ select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e3', 'K7QM') $$,
  ARRAY['walk_in'],
  'positive control: one starting in 59 minutes is open'
);

-- ── 7. the closing edge (D-209) ───────────────────────────────────────────────────────────────
select results_eq(
  $$ select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e4', 'K7QM') $$,
  ARRAY['closed'],
  'D-209: an event whose ends_at = now() is closed (>=)'
);

-- ── 8. cancelled (D-201) ──────────────────────────────────────────────────────────────────────
select results_eq(
  $$ select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e5', 'K7QM') $$,
  ARRAY['cancelled'],
  'D-201: a cancelled event answers cancelled, inside its window, with the right code'
);

-- ── 9. online is not_found ────────────────────────────────────────────────────────────────────
select results_eq(
  $$ select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e6', 'K7QM') $$,
  ARRAY['not_found'],
  'an ONLINE event is not checked in by a code: not_found (06-06''s Entrar is its check-in)'
);
select is_empty(
  $$ select 1 from public.event_attendances
      where user_id = '1e200000-0000-4000-8000-0000000000a2'
        and event_id in ('1e200000-0000-4000-8000-0000000000e2', '1e200000-0000-4000-8000-0000000000e4',
                         '1e200000-0000-4000-8000-0000000000e5', '1e200000-0000-4000-8000-0000000000e6') $$,
  '…and none of the refusals above recorded an attendance'
);
reset role;

-- ── 10. Pitfall 2: the definer never crosses tenants ──────────────────────────────────────────
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a5');
select results_eq(
  $$ select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e9', 'K7QM') $$,
  ARRAY['not_found'],
  'T-06-28: A''s lane with B''s event id and B''s right code gets not_found'
);
select results_eq(
  $$ select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e9', 'ZZZZ') $$,
  ARRAY['not_found'],
  '…and with a wrong code, not_found too (no guess is counted against B''s event)'
);
select results_eq(
  $$ select outcome from app.events_check_in('1e200000-0000-4000-8000-0000000000e1', 'K7QM') $$,
  ARRAY['walk_in'],
  'positive control, same block, same lane: A''s own event checks in'
);
reset role;
select tests.as_service();
select results_eq(
  $$ select count(*)::int from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000e9' $$,
  ARRAY[1],
  'T-06-28: B''s event still has exactly its own one attendance row (read as the service lane)'
);
select is_empty(
  $$ select 1 from public.event_attendances
      where user_id = '1e200000-0000-4000-8000-0000000000a5'
        and event_id = '1e200000-0000-4000-8000-0000000000e9' $$,
  '…none of them A''s member'
);
select is_empty(
  $$ select 1 from public.event_checkin_attempts
      where event_id = '1e200000-0000-4000-8000-0000000000e9'
         or tenant_id = '1e200000-0000-4000-8000-000000000011' $$,
  '…and B has no attempts row at all'
);
reset role;

-- ── 11. the member lane cannot touch the counter (T-06-30) ────────────────────────────────────
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a4');
select throws_ok(
  $$ insert into public.event_checkin_attempts (tenant_id, event_id, user_id, failed_count)
     values ('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000e3',
             '1e200000-0000-4000-8000-0000000000a4', 0) $$,
  '42501',
  null,
  'T-06-30: the member lane cannot INSERT an attempts row (there is no insert policy)'
);
select results_eq(
  $$ with u as (
       update public.event_checkin_attempts set failed_count = 0, window_started_at = now() - interval '1 day'
        where user_id = '1e200000-0000-4000-8000-0000000000a4' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'T-06-30: …cannot UPDATE (reset) its own counter: 0 rows'
);
select results_eq(
  $$ with d as (
       delete from public.event_checkin_attempts
        where user_id = '1e200000-0000-4000-8000-0000000000a4' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'T-06-30: …cannot DELETE it: 0 rows'
);
select results_eq(
  $$ select count(*)::int, max(failed_count) from public.event_checkin_attempts $$,
  $$ values (1, 1) $$,
  '…and its one row is intact (read through the self-select policy)'
);
reset role;
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a5');
select is_empty(
  $$ select 1 from public.event_checkin_attempts
      where user_id = '1e200000-0000-4000-8000-0000000000a4' $$,
  'self-select: another member of the SAME tenant reads none of the guesser''s attempts'
);
reset role;
select tests.as_service();
select results_eq(
  $$ select count(*)::int from public.event_checkin_attempts
      where tenant_id = '1e200000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'positive control: the row exists (the service lane sees it)'
);
reset role;

-- ── 12..20 (06-06): app.events_enter, the online gate ─────────────────────────────────────────
-- F1: online, in 3 hours (BEFORE the window). F2: online, in 30 minutes (inside). F3: online, ends
-- NOW. F4: online, cancelled, inside. F9: tenant B's online event, inside. Every online URL is
-- https://meet.example.test/ci (pg_temp.ev).
select pg_temp.ev('1e200000-0000-4000-8000-0000000000f1', now() + interval '3 hours', now() + interval '5 hours', p_format => 'online');
select pg_temp.ev('1e200000-0000-4000-8000-0000000000f2', now() + interval '30 minutes', now() + interval '2 hours 30 minutes', p_format => 'online');
select pg_temp.ev('1e200000-0000-4000-8000-0000000000f3', now() - interval '2 hours', now(), p_format => 'online');
select pg_temp.ev('1e200000-0000-4000-8000-0000000000f4', now() + interval '30 minutes', now() + interval '2 hours', 'cancelled', 'online');
select pg_temp.ev('1e200000-0000-4000-8000-0000000000f9', now() + interval '30 minutes', now() + interval '2 hours', p_format => 'online',
                  p_tenant => '1e200000-0000-4000-8000-000000000011', p_author => '1e200000-0000-4000-8000-000000000012');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at) values
  ('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000f1',
   '1e200000-0000-4000-8000-0000000000a1', 'going', now() - interval '1 day'),
  ('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000f2',
   '1e200000-0000-4000-8000-0000000000a1', 'going', now() - interval '1 day'),
  ('1e200000-0000-4000-8000-000000000011', '1e200000-0000-4000-8000-0000000000f9',
   '1e200000-0000-4000-8000-000000000012', 'going', now() - interval '1 day');

-- ── 12. the privilege facts (T-06-43) ─────────────────────────────────────────────────────────
select ok(
  (select prosecdef from pg_proc where oid = 'app.events_enter(uuid)'::regprocedure),
  'T-06-43: app.events_enter is SECURITY DEFINER'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'app.events_enter(uuid)'::regprocedure),
  'T-06-43: …and pins search_path to the empty string'
);
select ok(
  not has_function_privilege('anon', 'app.events_enter(uuid)', 'execute'),
  'T-06-43: anon cannot execute it (PUBLIC''s default EXECUTE is revoked)'
);
select ok(
  has_function_privilege('authenticated', 'app.events_enter(uuid)', 'execute'),
  'positive control: the tenant lane''s role (authenticated) can'
);
select tests.as_tenant_without_claims();
select results_eq(
  $$ select outcome, meeting_url is null from app.events_enter('1e200000-0000-4000-8000-0000000000f2') $$,
  $$ values ('not_found'::text, true) $$,
  'a lane with NO claims gets not_found and no URL'
);
reset role;

-- ── 13. P0 after Vou: forward, record nothing (D-218) ─────────────────────────────────────────
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a1');
select results_eq(
  $$ select outcome, meeting_url, attendance_status, starts_at = now() + interval '3 hours'
       from app.events_enter('1e200000-0000-4000-8000-0000000000f1') $$,
  $$ values ('forward'::text, 'https://meet.example.test/ci'::text, 'going'::text, true) $$,
  'D-218: before the window, after Vou, the member is forwarded WITH the URL'
);
select results_eq(
  $$ select status, checked_in_at is null, checkin_via is null from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000f1'
        and user_id = '1e200000-0000-4000-8000-0000000000a1' $$,
  $$ values ('going'::text, true, true) $$,
  '…and NOTHING was recorded: the row is still going, with no check-in'
);
reset role;

-- ── 14. P0 without Vou: confirm_first, no URL (D-207) ─────────────────────────────────────────
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a2');
select results_eq(
  $$ select outcome, meeting_url is null from app.events_enter('1e200000-0000-4000-8000-0000000000f1') $$,
  $$ values ('confirm_first'::text, true) $$,
  'D-207: before the window, with no answer, confirm_first and NO URL'
);
select is_empty(
  $$ select 1 from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000f1'
        and user_id = '1e200000-0000-4000-8000-0000000000a2' $$,
  '…and no row was written'
);

-- ── 15. inside the window: recorded (D-210, D-216) ────────────────────────────────────────────
select results_eq(
  $$ select outcome, meeting_url, attendance_status
       from app.events_enter('1e200000-0000-4000-8000-0000000000f2') $$,
  $$ values ('recorded'::text, 'https://meet.example.test/ci'::text, 'walk_in'::text) $$,
  'D-210: inside the window, with no answer, Entrar records a walk-in and forwards'
);
select results_eq(
  $$ select status, checked_in_at = now(), checkin_via, responded_at is null
       from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000f2'
        and user_id = '1e200000-0000-4000-8000-0000000000a2' $$,
  $$ values ('walk_in'::text, true, 'online'::text, true) $$,
  '…the row is walk_in, stamped now, via online'
);
reset role;
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a1');
select results_eq(
  $$ select outcome, meeting_url, attendance_status
       from app.events_enter('1e200000-0000-4000-8000-0000000000f2') $$,
  $$ values ('recorded'::text, 'https://meet.example.test/ci'::text, 'checked_in'::text) $$,
  'D-216: after Vou, Entrar records checked_in'
);
select results_eq(
  $$ select status, responded_at = now() - interval '1 day', checkin_via
       from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000f2'
        and user_id = '1e200000-0000-4000-8000-0000000000a1' $$,
  $$ values ('checked_in'::text, true, 'online'::text) $$,
  '…keeping responded_at, via online'
);

-- ── 16. a repeat: already, rejoin (T-06-42) ───────────────────────────────────────────────────
select results_eq(
  $$ select outcome, meeting_url, attendance_status
       from app.events_enter('1e200000-0000-4000-8000-0000000000f2') $$,
  $$ values ('already'::text, 'https://meet.example.test/ci'::text, 'checked_in'::text) $$,
  'a second Entrar answers already WITH the URL (rejoin)'
);
select results_eq(
  $$ select count(*)::int from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000f2'
        and user_id = '1e200000-0000-4000-8000-0000000000a1' $$,
  ARRAY[1],
  '…with no second record'
);

-- ── 17-19. the refusals carry no URL ──────────────────────────────────────────────────────────
select results_eq(
  $$ select outcome, meeting_url is null from app.events_enter('1e200000-0000-4000-8000-0000000000f3') $$,
  $$ values ('ended'::text, true) $$,
  'D-209: an online event whose ends_at = now() answers ended, with NO URL'
);
select results_eq(
  $$ select outcome, meeting_url is null from app.events_enter('1e200000-0000-4000-8000-0000000000f4') $$,
  $$ values ('cancelled'::text, true) $$,
  'D-201: a cancelled online event answers cancelled, with NO URL'
);
select results_eq(
  $$ select outcome, meeting_url is null from app.events_enter('1e200000-0000-4000-8000-0000000000e1') $$,
  $$ values ('not_found'::text, true) $$,
  'an IN-PERSON event is not entered: not_found (its check-in is the venue code)'
);
reset role;

-- ── 20. the definer never crosses tenants (T-06-38) ───────────────────────────────────────────
select tests.as_tenant('1e200000-0000-4000-8000-000000000001', '1e200000-0000-4000-8000-0000000000a5');
select results_eq(
  $$ select outcome, meeting_url is null from app.events_enter('1e200000-0000-4000-8000-0000000000f9') $$,
  $$ values ('not_found'::text, true) $$,
  'T-06-38: A''s lane with B''s online event id gets not_found and NO URL'
);
select results_eq(
  $$ select outcome, attendance_status from app.events_enter('1e200000-0000-4000-8000-0000000000f2') $$,
  $$ values ('recorded'::text, 'walk_in'::text) $$,
  'positive control, same block, same lane: A''s own online event records'
);
reset role;
select tests.as_service();
select results_eq(
  $$ select count(*)::int, min(status), bool_and(checked_in_at is null) from public.event_attendances
      where event_id = '1e200000-0000-4000-8000-0000000000f9' $$,
  $$ values (1, 'going'::text, true) $$,
  'T-06-38: B''s online event still has exactly its own one row, still going, unchecked'
);
select is_empty(
  $$ select 1 from public.event_attendances
      where user_id = '1e200000-0000-4000-8000-0000000000a5'
        and event_id = '1e200000-0000-4000-8000-0000000000f9' $$,
  '…none of them A''s member'
);
reset role;

select * from finish();
rollback;
