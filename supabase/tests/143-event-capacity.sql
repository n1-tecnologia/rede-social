begin;
-- 143-event-capacity.sql — the event's category and its limit (2026-10-03, "Últimas N vagas"),
-- executed inside Postgres. Numbered 143 after 06-05's 142 (150 and up belong to Phase 7).
--
-- 1. `events_category_chk`: NULL is "no category"; a blank one and one over 40 characters are
--    refused (23514); exactly 40 is accepted.
--
-- 2. `events_capacity_chk`: NULL is "no limit"; 0 and 100001 are refused (23514); 1 and 100000 are
--    accepted.
--
-- 3. THE GUARD'S STEP 7 (`*_event_capacity_guard.sql`), from a MEMBER lane, the writer the API
--    actually is: on an event with `capacity = 2` and two OTHER members going, the member's `going`
--    is 23514 `event_full` (constraint `event_attendances_capacity`), while a `not_going` is never
--    judged, and moving that `not_going` to `going` is refused the same way.
--
-- 4. The writer's OWN row never counts against itself: on an event with `capacity = 2`, the member
--    already going plus one other, the RSVP upsert of a repeat `going` (the service's own statement,
--    which fires the BEFORE INSERT trigger on the proposed tuple) is accepted. After the limit is
--    LOWERED to 1 (allowed: nothing is re-judged and both answers stay), the same repeat is refused
--    with `event_full`: the trigger judges the proposed INSERT before the arbiter, and the service
--    (`fullEventAnswer`) turns that back into the unchanged answer it is.
--
-- 5. What counts is D-219's confirmed count (`going + checked_in`), and only a move INTO `going` is
--    judged: a `walk_in` does not count against a Vou; a `checked_in` does; a check-in and a walk-in
--    on a full event are accepted (the door is never closed by a limit meant for the answers).
--
-- 6. An event with no limit skips the step entirely: three `going` answers on it are accepted.
--
-- The event fixtures carry their `event_secrets` rows (written in one statement); this file never
-- commits, so the deferred keys are never checked (`140-events.sql` proves them). Two concurrent Vou
-- on the last seat cannot be shown on pgTAP's ONE connection: the API integration suite
-- (`apps/api/tests/integration/events-capacity.test.ts`) proves the advisory lock under real
-- concurrency. Fixture ids use the `1e300000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(23);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-cap-a', 'Vagas A', '1e300000-0000-4000-8000-000000000001');
select tests.auth_user('member@cap-a.local', '1e300000-0000-4000-8000-000000000002');
select tests.auth_user('admin@cap-a.local', '1e300000-0000-4000-8000-000000000003');
select tests.auth_user('o1@cap-a.local', '1e300000-0000-4000-8000-0000000000c1');
select tests.auth_user('o2@cap-a.local', '1e300000-0000-4000-8000-0000000000c2');
select tests.auth_user('o3@cap-a.local', '1e300000-0000-4000-8000-0000000000c3');
select tests.member('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-000000000002');
select tests.member('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-000000000003', 'admin_tenant');
select tests.member('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-0000000000c1');
select tests.member('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-0000000000c2');
select tests.member('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-0000000000c3');

-- Both halves of one event in ONE statement, with its category and its limit.
create function pg_temp.ev(
  p_id uuid,
  p_starts timestamptz,
  p_capacity integer default null,
  p_category text default null
) returns void
language sql as $$
  with e as (
    insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                               address, starts_at, ends_at, category, capacity)
    values (p_id, '1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-000000000003',
            'Evento', 'in_person', 'Sede', 'Rua A, 1', p_starts, p_starts + interval '2 hours',
            p_category, p_capacity)
    returning id, tenant_id, format
  )
  insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
  select id, tenant_id, format, 'K7QM' from e
$$;

-- One answer, written in the service lane (the guard still judges it).
create function pg_temp.answer(p_event uuid, p_user uuid, p_status text) returns void
language sql as $$
  insert into public.event_attendances
    (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via)
  values ('1e300000-0000-4000-8000-000000000001', p_event, p_user, p_status,
          case when p_status = 'walk_in' then null else now() end,
          case when p_status in ('checked_in', 'walk_in') then now() end,
          case when p_status in ('checked_in', 'walk_in') then 'code' end)
$$;

-- ── 1. the category ───────────────────────────────────────────────────────────────────────────
select lives_ok(
  $$ select pg_temp.ev('1e300000-0000-4000-8000-0000000000a1', now() + interval '1 day', null, null) $$,
  'events_category_chk: no category (NULL) is accepted'
);
select lives_ok(
  $$ select pg_temp.ev('1e300000-0000-4000-8000-0000000000a2', now() + interval '1 day', null, repeat('x', 40)) $$,
  '…and exactly 40 characters is accepted'
);
select throws_ok(
  $$ select pg_temp.ev('1e300000-0000-4000-8000-0000000000a3', now() + interval '1 day', null, '   ') $$,
  '23514',
  null,
  'events_category_chk: a blank category is refused (no category is NULL, never blank)'
);
select throws_ok(
  $$ select pg_temp.ev('1e300000-0000-4000-8000-0000000000a4', now() + interval '1 day', null, repeat('x', 41)) $$,
  '23514',
  null,
  '…and so is one of 41 characters'
);

-- ── 2. the limit ──────────────────────────────────────────────────────────────────────────────
select lives_ok(
  $$ select pg_temp.ev('1e300000-0000-4000-8000-0000000000a5', now() + interval '1 day', 1) $$,
  'events_capacity_chk: a limit of 1 is accepted'
);
select lives_ok(
  $$ select pg_temp.ev('1e300000-0000-4000-8000-0000000000a6', now() + interval '1 day', 100000) $$,
  '…and so is 100000'
);
select throws_ok(
  $$ select pg_temp.ev('1e300000-0000-4000-8000-0000000000a7', now() + interval '1 day', 0) $$,
  '23514',
  null,
  'events_capacity_chk: a limit of 0 is refused (no limit is NULL)'
);
select throws_ok(
  $$ select pg_temp.ev('1e300000-0000-4000-8000-0000000000a8', now() + interval '1 day', 100001) $$,
  '23514',
  null,
  '…and so is 100001'
);

-- E_full: capacity 2, two OTHER members going. E_repeat: capacity 2, the member and one other
-- going. E_window: capacity 1, starts in 30 minutes (inside the check-in window, RSVP still open).
-- E_door: capacity 1 inside the window, for the check-in facts. E_open: no limit.
select pg_temp.ev('1e300000-0000-4000-8000-0000000000e1', now() + interval '1 day', 2);
select pg_temp.ev('1e300000-0000-4000-8000-0000000000e2', now() + interval '1 day', 2);
select pg_temp.ev('1e300000-0000-4000-8000-0000000000e3', now() + interval '30 minutes', 1);
select pg_temp.ev('1e300000-0000-4000-8000-0000000000e4', now() + interval '30 minutes', 1);
select pg_temp.ev('1e300000-0000-4000-8000-0000000000e5', now() + interval '1 day', null);

select tests.as_service();
select pg_temp.answer('1e300000-0000-4000-8000-0000000000e1', '1e300000-0000-4000-8000-0000000000c1', 'going');
select pg_temp.answer('1e300000-0000-4000-8000-0000000000e1', '1e300000-0000-4000-8000-0000000000c2', 'going');
select pg_temp.answer('1e300000-0000-4000-8000-0000000000e2', '1e300000-0000-4000-8000-000000000002', 'going');
select pg_temp.answer('1e300000-0000-4000-8000-0000000000e2', '1e300000-0000-4000-8000-0000000000c1', 'going');
reset role;

-- ── 3. a full event takes no new Vou, from the member's own lane ──────────────────────────────
select tests.as_tenant('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-0000000000e1',
             '1e300000-0000-4000-8000-000000000002', 'going', now()) $$,
  '23514',
  'event_full',
  'step 7: a member''s going on an event whose OTHER members'' confirmed count reached its limit is refused (event_attendances_capacity)'
);
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-0000000000e1',
             '1e300000-0000-4000-8000-000000000002', 'not_going', now()) $$,
  '…while a not_going on the same full event is never judged'
);
select throws_ok(
  $$ update public.event_attendances set status = 'going', responded_at = now()
      where event_id = '1e300000-0000-4000-8000-0000000000e1'
        and user_id = '1e300000-0000-4000-8000-000000000002' $$,
  '23514',
  'event_full',
  '…and moving that not_going INTO going is a new confirmation, refused the same way'
);

-- ── 4. the writer's own row never counts against itself ───────────────────────────────────────
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-0000000000e2',
             '1e300000-0000-4000-8000-000000000002', 'going', now())
     on conflict (tenant_id, event_id, user_id) do update
        set status = excluded.status, responded_at = now(), updated_at = now()
      where event_attendances.status in ('going','not_going')
        and event_attendances.status is distinct from excluded.status $$,
  'a member ALREADY going repeats Vou on an event at its limit: accepted (only the other member counts)'
);
reset role;
select tests.as_service();
select lives_ok(
  $$ update public.events set capacity = 1 where id = '1e300000-0000-4000-8000-0000000000e2' $$,
  'the limit may be lowered under the confirmations already given (nothing is re-judged)'
);
select results_eq(
  $$ select count(*)::int from public.event_attendances
      where event_id = '1e300000-0000-4000-8000-0000000000e2' and status = 'going' $$,
  ARRAY[2],
  '…and both answers stay going'
);
reset role;
select tests.as_tenant('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-0000000000e2',
             '1e300000-0000-4000-8000-000000000002', 'going', now())
     on conflict (tenant_id, event_id, user_id) do update
        set status = excluded.status, responded_at = now(), updated_at = now()
      where event_attendances.status in ('going','not_going')
        and event_attendances.status is distinct from excluded.status $$,
  '23514',
  'event_full',
  'over the lowered limit, the same repeat is judged on its proposed INSERT and refused (the service answers it as unchanged)'
);
reset role;

-- ── 5. what counts: going + checked_in; a walk-in does not; the door stays open ───────────────
select tests.as_service();
select pg_temp.answer('1e300000-0000-4000-8000-0000000000e3', '1e300000-0000-4000-8000-0000000000c1', 'walk_in');
reset role;
select tests.as_tenant('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-000000000002');
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-0000000000e3',
             '1e300000-0000-4000-8000-000000000002', 'going', now()) $$,
  'D-219: a walk-in is not a confirmation, so it never takes the seat of a Vou (limit 1, one walk-in, one going)'
);
reset role;
select tests.as_service();
select pg_temp.answer('1e300000-0000-4000-8000-0000000000e4', '1e300000-0000-4000-8000-0000000000c1', 'checked_in');
reset role;
select tests.as_tenant('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-0000000000e4',
             '1e300000-0000-4000-8000-000000000002', 'going', now()) $$,
  '23514',
  'event_full',
  '…while a checked_in IS one: it holds the only seat'
);
reset role;
select tests.as_service();
select lives_ok(
  $$ select pg_temp.answer('1e300000-0000-4000-8000-0000000000e4', '1e300000-0000-4000-8000-0000000000c2', 'walk_in') $$,
  'the door stays open: a walk-in on a full event is accepted'
);
select lives_ok(
  $$ update public.event_attendances
        set status = 'checked_in', checked_in_at = now(), checkin_via = 'code'
      where event_id = '1e300000-0000-4000-8000-0000000000e3'
        and user_id = '1e300000-0000-4000-8000-000000000002' $$,
  '…and so is the check-in of a member who said Vou (a check-in is never judged by the limit)'
);
select results_eq(
  $$ select count(*) filter (where x.status in ('going','checked_in'))::int
       from public.event_attendances x
      where x.event_id = '1e300000-0000-4000-8000-0000000000e4' $$,
  ARRAY[1],
  'the confirmed count of the full event is still its limit (1): nothing slipped past it'
);
reset role;

-- ── 6. no limit, no judgement ─────────────────────────────────────────────────────────────────
select tests.as_service();
select lives_ok(
  $$ select pg_temp.answer('1e300000-0000-4000-8000-0000000000e5', '1e300000-0000-4000-8000-0000000000c1', 'going');
     select pg_temp.answer('1e300000-0000-4000-8000-0000000000e5', '1e300000-0000-4000-8000-0000000000c2', 'going');
     select pg_temp.answer('1e300000-0000-4000-8000-0000000000e5', '1e300000-0000-4000-8000-0000000000c3', 'going') $$,
  'an event with no limit (capacity NULL) takes every Vou'
);
reset role;
select tests.as_tenant('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-000000000002');
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
     values ('1e300000-0000-4000-8000-000000000001', '1e300000-0000-4000-8000-0000000000e5',
             '1e300000-0000-4000-8000-000000000002', 'going', now()) $$,
  '…including the member''s own, from its lane'
);
select results_eq(
  $$ select capacity from public.events where id = '1e300000-0000-4000-8000-0000000000e1' $$,
  ARRAY[2],
  'a member lane reads the limit (events is tenant-wide): the poster computes its spots from it'
);
reset role;

select * from finish();
rollback;
