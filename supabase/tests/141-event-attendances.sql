begin;
-- 141-event-attendances.sql — EVENT-03's attendance row and its guard, executed inside Postgres
-- (06-03). Numbered 141 because 140 is 06-01's events file (130 belongs to 05.3's reels).
--
-- 1. A member lane writes its OWN `going` row (the positive control of facts 3, 4 and 6).
--
-- 2. EVENT-03 BOUNDARY. `now()` is the transaction timestamp, so it is fixed for this whole file: an
--    RSVP on an event whose `starts_at = now()` is refused (`>=`, `rsvp_closed`), and one whose
--    `starts_at = now() + 1 microsecond` is accepted. `timestamptz` carries microseconds, so this is
--    the exact edge.
--
-- 3. T-06-11, CHECK-IN IS OUT OF A MEMBER'S REACH. The member lane's INSERT of its own `checked_in`
--    row, on an event INSIDE its check-in window (so the guard passes and only RLS can refuse it), is
--    42501. The service lane's `checked_in` outside the window is 23514 `checkin_not_open`, and
--    inside it succeeds.
--
-- 4. A member cannot write ANOTHER member's row (42501), on an open event (fact 1 is the control).
--
-- 5. D-204, A CHECKED-IN ROW IS LOCKED. The member lane's UPDATE of its checked-in row touches 0
--    rows (the update policy only sees `going`/`not_going`), the member's RSVP UPSERT against it
--    returns 0 rows WITHOUT an error (the `do update … where` excludes it, which is the service's
--    "unchanged or locked" path), and the service lane's status change on it is 23514
--    `attendance_locked`. Positive control: an update that does not change the status is allowed.
--
-- 6. D-201: `going` on a cancelled event is 23514 `cancelled` (fact 1 is the active control).
--
-- 7. D-214: there is no delete policy — a member DELETE touches 0 rows, and the rows are still there.
--
-- 8. `event_attendances_immutable`: moving a row to another event is 23514, even from the service lane.
--
-- 9. Cross-tenant: B's lane selects zero rows of A, and its own row (positive control).
--
-- 10. D-219: the count expressions, copied VERBATIM from `eventSource` in
--     `packages/modules/events/server/service.ts`, read from a MEMBER lane (the select policy is
--     tenant-wide, which the counts need), return confirmed 3 / present 2 on 2 going, 1 checked_in,
--     1 walk_in and 1 not_going.
--
-- 11. The count aggregate rides `event_attendances_tenant_event_status_idx` BY NAME on a 4,000-row
--     fixture built and ANALYZEd here (with a handful of rows the planner always scans).
--
-- The event fixtures carry their `event_secrets` rows (written in one statement), but this file never
-- commits, so the deferred keys are never checked; `140-events.sql` proves them. Fixture ids use the
-- `1e100000-…` prefix, free of 140's `1e000000-…`. Like its siblings, this file ROLLS BACK.
select plan(22);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-ea-a', 'Presencas A', '1e100000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-ea-b', 'Presencas B', '1e100000-0000-4000-8000-000000000011');
select tests.auth_user('member@ea-a.local', '1e100000-0000-4000-8000-000000000002');
select tests.auth_user('admin@ea-a.local', '1e100000-0000-4000-8000-000000000003');
select tests.auth_user('other@ea-a.local', '1e100000-0000-4000-8000-000000000004');
select tests.auth_user('member@ea-b.local', '1e100000-0000-4000-8000-000000000012');
select tests.member('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000002');
select tests.member('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000003', 'admin_tenant');
select tests.member('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000004');
select tests.member('1e100000-0000-4000-8000-000000000011', '1e100000-0000-4000-8000-000000000012');

-- Both halves of one event in ONE statement.
create function pg_temp.ev(
  p_id uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_status text default 'active',
  p_cancelled_at timestamptz default null,
  p_tenant uuid default '1e100000-0000-4000-8000-000000000001',
  p_author uuid default '1e100000-0000-4000-8000-000000000003'
) returns void
language sql as $$
  with e as (
    insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                               address, starts_at, ends_at, status, cancelled_at)
    values (p_id, p_tenant, p_author, 'Evento', 'in_person', 'Sede', 'Rua A, 1', p_starts, p_ends,
            p_status, p_cancelled_at)
    returning id, tenant_id, format
  )
  insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
  select id, tenant_id, format, 'K7QM' from e
$$;

-- E_up: tomorrow. E_win: in 30 minutes (inside the check-in window, RSVP still open). E_now: starts
-- NOW. E_us: starts one microsecond from now. E_can: cancelled. E_far: in 2 days (window not open).
-- E_cnt: the count fixture. E_b: tenant B's event.
select pg_temp.ev('1e100000-0000-4000-8000-0000000000e1', now() + interval '1 day', now() + interval '1 day 2 hours');
select pg_temp.ev('1e100000-0000-4000-8000-0000000000e2', now() + interval '30 minutes', now() + interval '2 hours 30 minutes');
select pg_temp.ev('1e100000-0000-4000-8000-0000000000e3', now(), now() + interval '2 hours');
select pg_temp.ev('1e100000-0000-4000-8000-0000000000e4', now() + interval '1 microsecond', now() + interval '2 hours');
select pg_temp.ev('1e100000-0000-4000-8000-0000000000e5', now() + interval '1 day', now() + interval '1 day 2 hours', 'cancelled', now());
select pg_temp.ev('1e100000-0000-4000-8000-0000000000e6', now() + interval '2 days', now() + interval '2 days 2 hours');
select pg_temp.ev('1e100000-0000-4000-8000-0000000000e7', now() + interval '30 minutes', now() + interval '2 hours 30 minutes');
select pg_temp.ev('1e100000-0000-4000-8000-0000000000e9', now() + interval '1 day', now() + interval '1 day 2 hours',
                  p_tenant => '1e100000-0000-4000-8000-000000000011', p_author => '1e100000-0000-4000-8000-000000000012');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
values ('1e100000-0000-4000-8000-000000000011', '1e100000-0000-4000-8000-0000000000e9',
        '1e100000-0000-4000-8000-000000000012', 'going', now());

-- ── 1. a member writes its own answer ─────────────────────────────────────────────────────────
select tests.as_tenant('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000002');
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e1',
             '1e100000-0000-4000-8000-000000000002', 'going', now()) $$,
  'EVENT-03: a member lane inserts its OWN going row on an open event'
);
select results_eq(
  $$ select status from public.event_attendances
      where event_id = '1e100000-0000-4000-8000-0000000000e1'
        and user_id = '1e100000-0000-4000-8000-000000000002' $$,
  ARRAY['going'],
  '…and reads it back through its lane'
);

-- ── 2. the boundary pair (EVENT-03 boundary) ──────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e3',
             '1e100000-0000-4000-8000-000000000002', 'going', now()) $$,
  '23514',
  'rsvp_closed',
  'D-204 boundary: an RSVP on an event whose starts_at = now() is refused (>=), event_attendances_rsvp_open'
);
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e4',
             '1e100000-0000-4000-8000-000000000002', 'not_going', now()) $$,
  '…and one whose starts_at = now() + 1 microsecond is accepted'
);

-- ── 3. check-in is out of a member lane's reach ───────────────────────────────────────────────
select throws_ok(
  $$ insert into public.event_attendances
       (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via)
     values ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e2',
             '1e100000-0000-4000-8000-000000000002', 'checked_in', now(), now(), 'code') $$,
  '42501',
  null,
  'T-06-11: a member lane cannot check itself in, even inside the window (self_rsvp_insert admits going/not_going only)'
);
reset role;
select tests.as_service();
select throws_ok(
  $$ insert into public.event_attendances
       (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via)
     values ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e6',
             '1e100000-0000-4000-8000-000000000002', 'checked_in', now(), now(), 'code') $$,
  '23514',
  'checkin_not_open',
  'D-209: the service lane''s check-in two days before the start is refused (event_attendances_checkin_window)'
);
select lives_ok(
  $$ insert into public.event_attendances
       (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via)
     values ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e2',
             '1e100000-0000-4000-8000-000000000002', 'checked_in', now(), now(), 'code') $$,
  'positive control: the same check-in 30 minutes before the start (inside the window) is accepted'
);
reset role;

-- ── 4. a member cannot write another member's row ─────────────────────────────────────────────
select tests.as_tenant('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e1',
             '1e100000-0000-4000-8000-000000000004', 'going', now()) $$,
  '42501',
  null,
  'a member lane cannot answer for ANOTHER member of its tenant (user_id = app.user_id())'
);

-- ── 5. a checked-in row is locked ─────────────────────────────────────────────────────────────
select results_eq(
  $$ with u as (
       update public.event_attendances set status = 'not_going'
        where event_id = '1e100000-0000-4000-8000-0000000000e2'
          and user_id = '1e100000-0000-4000-8000-000000000002' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'D-204: the member lane''s UPDATE of its checked-in row touches nothing'
);
select results_eq(
  $$ with u as (
       insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
       values ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e2',
               '1e100000-0000-4000-8000-000000000002', 'not_going', now())
       on conflict (tenant_id, event_id, user_id) do update
          set status = excluded.status, responded_at = now(), updated_at = now()
        where event_attendances.status in ('going','not_going')
          and event_attendances.status is distinct from excluded.status
       returning status
     ) select count(*)::int from u $$,
  ARRAY[0],
  '…and the service''s RSVP upsert against it returns 0 rows WITHOUT an error ("unchanged or locked")'
);
reset role;
select tests.as_service();
select throws_ok(
  $$ update public.event_attendances set status = 'not_going', checked_in_at = null, checkin_via = null
      where event_id = '1e100000-0000-4000-8000-0000000000e2'
        and user_id = '1e100000-0000-4000-8000-000000000002' $$,
  '23514',
  'attendance_locked',
  'D-204: even the service lane cannot change a checked-in row''s status (event_attendances_locked)'
);
select lives_ok(
  $$ update public.event_attendances set updated_at = now()
      where event_id = '1e100000-0000-4000-8000-0000000000e2'
        and user_id = '1e100000-0000-4000-8000-000000000002' $$,
  'positive control: an update that keeps the status is allowed (the row is not re-judged)'
);
reset role;

-- ── 6. nothing on a cancelled event ───────────────────────────────────────────────────────────
select tests.as_tenant('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e5',
             '1e100000-0000-4000-8000-000000000002', 'going', now()) $$,
  '23514',
  'cancelled',
  'D-201: going on a cancelled event is refused (event_attendances_event_active)'
);
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000ff',
             '1e100000-0000-4000-8000-000000000002', 'going', now()) $$,
  '23503',
  'event_not_found',
  'an unknown event is 23503 event_attendances_event_visible (a bare 404 at the API)'
);

-- ── 7. no delete policy ───────────────────────────────────────────────────────────────────────
select results_eq(
  $$ with d as (
       delete from public.event_attendances
        where user_id = '1e100000-0000-4000-8000-000000000002' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'D-214: a member DELETE of its own answers touches nothing (there is no delete policy)'
);
select results_eq(
  $$ select count(*)::int from public.event_attendances
      where user_id = '1e100000-0000-4000-8000-000000000002' $$,
  ARRAY[3],
  '…and its three rows (going, not_going, checked_in) are all still there'
);
reset role;

-- ── 8. a row never moves ──────────────────────────────────────────────────────────────────────
select tests.as_service();
select throws_ok(
  $$ update public.event_attendances set event_id = '1e100000-0000-4000-8000-0000000000e6'
      where event_id = '1e100000-0000-4000-8000-0000000000e1'
        and user_id = '1e100000-0000-4000-8000-000000000002' $$,
  '23514',
  'attendance_immutable',
  'event_attendances_immutable: even the service lane cannot move an answer to another event'
);
reset role;

-- ── 9. cross-tenant ───────────────────────────────────────────────────────────────────────────
select tests.as_tenant('1e100000-0000-4000-8000-000000000011', '1e100000-0000-4000-8000-000000000012');
select is_empty(
  $$ select id from public.event_attendances
      where tenant_id = '1e100000-0000-4000-8000-000000000001'
         or event_id = '1e100000-0000-4000-8000-0000000000e1' $$,
  'T-06-14: B''s lane selects zero attendance rows of A'
);
select results_eq(
  $$ select count(*)::int from public.event_attendances $$,
  ARRAY[1],
  'positive control: B''s lane sees its own one row'
);
reset role;

-- ── 10. the D-219 counts ──────────────────────────────────────────────────────────────────────
select tests.auth_user('c1@ea-a.local', '1e100000-0000-4000-8000-0000000000c1');
select tests.auth_user('c2@ea-a.local', '1e100000-0000-4000-8000-0000000000c2');
select tests.auth_user('c3@ea-a.local', '1e100000-0000-4000-8000-0000000000c3');
select tests.auth_user('c4@ea-a.local', '1e100000-0000-4000-8000-0000000000c4');
select tests.auth_user('c5@ea-a.local', '1e100000-0000-4000-8000-0000000000c5');
insert into public.event_attendances
  (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via) values
  ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e7',
   '1e100000-0000-4000-8000-0000000000c1', 'going', now(), null, null),
  ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e7',
   '1e100000-0000-4000-8000-0000000000c2', 'going', now(), null, null),
  ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e7',
   '1e100000-0000-4000-8000-0000000000c3', 'checked_in', now(), now(), 'code'),
  ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e7',
   '1e100000-0000-4000-8000-0000000000c4', 'walk_in', null, now(), 'code'),
  ('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-0000000000e7',
   '1e100000-0000-4000-8000-0000000000c5', 'not_going', now(), null, null);
select tests.as_tenant('1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000002');
select results_eq(
  $$ select count(*) filter (where x.status in ('going','checked_in'))::int as confirmed_count,
            count(*) filter (where x.status in ('checked_in','walk_in'))::int as present_count
       from public.event_attendances x
      where x.tenant_id = '1e100000-0000-4000-8000-000000000001'
        and x.event_id = '1e100000-0000-4000-8000-0000000000e7' $$,
  $$ values (3, 2) $$,
  'D-219 from a MEMBER lane: confirmed = going + checked_in (3), present = checked_in + walk_in (2)'
);
reset role;

-- ── 11. the count aggregate rides its index, by name ──────────────────────────────────────────
-- 200 events x 20 members = 4,000 rows, then `analyze`.
do $$
begin
  for g in 1..20 loop
    perform tests.auth_user('vol' || g || '@ea-a.local', ('1e1000a0-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid);
  end loop;
end
$$;
with e as (
  insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at)
  select ('1e1000e0-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
         '1e100000-0000-4000-8000-000000000001', '1e100000-0000-4000-8000-000000000003',
         'Volume ' || g, 'in_person', 'Sede', 'Rua A, 1',
         now() + interval '1 day', now() + interval '1 day 2 hours'
    from generate_series(1, 200) g
  returning id, tenant_id, format
)
insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
select id, tenant_id, format, 'K7QM' from e;
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
select '1e100000-0000-4000-8000-000000000001',
       ('1e1000e0-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       ('1e1000a0-0000-4000-8000-' || lpad(u::text, 12, '0'))::uuid,
       case when u % 3 = 0 then 'not_going' else 'going' end,
       now()
  from generate_series(1, 200) g, generate_series(1, 20) u;
analyze public.event_attendances;

create temporary table attendance_plans (name text primary key, plan text);
do $$
declare
  v_plan text;
begin
  execute
    'explain (format json)
     select count(*) filter (where x.status in (''going'',''checked_in''))::int as confirmed_count,
            count(*) filter (where x.status in (''checked_in'',''walk_in''))::int as present_count
       from public.event_attendances x
      where x.tenant_id = ''1e100000-0000-4000-8000-000000000001''::uuid
        and x.event_id = ''1e1000e0-0000-4000-8000-000000000042''::uuid' into v_plan;
  insert into attendance_plans values ('counts', v_plan);
end
$$;
select matches(
  (select plan from attendance_plans where name = 'counts'),
  'event_attendances_tenant_event_status_idx',
  'D-219: the count aggregate is served by event_attendances_tenant_event_status_idx, BY NAME'
);
select ok(
  (select plan from attendance_plans where name = 'counts') not like '%Seq Scan%',
  '…and it is not a sequential scan'
);

select * from finish();
rollback;
