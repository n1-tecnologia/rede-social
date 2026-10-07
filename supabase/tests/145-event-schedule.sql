begin;
-- 145-event-schedule.sql — the event's programme ("Cronograma", quick 261007-n1g), executed inside
-- Postgres. Numbered 145 after 144-event-photos (150 and up belong to Phase 7).
--
-- 1. THE COLUMN: `events.schedule` is jsonb, NOT NULL, with a default; an event inserted WITHOUT it
--    reads back as an empty array. That is also the proof that the rows that exist before the
--    migration need no data migration: they take the default.
--
-- 2. `events_schedule_chk` ACCEPTS: an empty array, one valid item, thirty items, day 31 at 23:59 and a
--    title of exactly 80 characters.
--
-- 3. `events_schedule_chk` REFUSES (23514), for a writer that skips the API: a JSON object, a JSON
--    string, thirty-one items, an array holding a number, an item missing a key, a day of 0, 32, 1.5
--    or a string, a time of 24:00, 8:00 or 08:60, an empty title, a blank title, a title of 81
--    characters. A NULL is refused by the NOT NULL (23502), and an UPDATE to an invalid value is
--    refused the same way as an INSERT.
--
-- 4. TENANT ISOLATION is exactly what it was: the column rides `events_tenant_isolation`. The member
--    lane of tenant A reads the schedule of A's event (positive control) in the same block where the
--    member lane of tenant B reads zero rows for that event id.
--
-- Every event is written together with its `event_secrets` row in ONE statement; this file never
-- commits, so the deferred keys are never checked. Fixture ids use the `1e500000-…` prefix. Like its
-- siblings, this file ROLLS BACK.
select plan(30);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-sch-a', 'Cronograma A', '1e500000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-sch-b', 'Cronograma B', '1e500000-0000-4000-8000-000000000011');
select tests.auth_user('member@sch-a.local', '1e500000-0000-4000-8000-000000000002');
select tests.auth_user('admin@sch-a.local', '1e500000-0000-4000-8000-000000000003');
select tests.auth_user('member@sch-b.local', '1e500000-0000-4000-8000-000000000012');
select tests.member('1e500000-0000-4000-8000-000000000001', '1e500000-0000-4000-8000-000000000002');
select tests.member('1e500000-0000-4000-8000-000000000001', '1e500000-0000-4000-8000-000000000003', 'admin_tenant');
select tests.member('1e500000-0000-4000-8000-000000000011', '1e500000-0000-4000-8000-000000000012');

-- Both halves of one event in ONE statement, with the schedule given as TEXT (cast to jsonb here, so
-- a caller can pass any JSON value, including a refused one, from inside a dollar-quoted test body).
create function pg_temp.ev(p_id uuid, p_schedule text) returns void
language sql as $$
  with e as (
    insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                               address, starts_at, ends_at, schedule)
    values (p_id, '1e500000-0000-4000-8000-000000000001', '1e500000-0000-4000-8000-000000000003',
            'Evento', 'in_person', 'Sede', 'Rua A, 1', now() + interval '1 day',
            now() + interval '1 day 2 hours', p_schedule::jsonb)
    returning id, tenant_id, format
  )
  insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
  select id, tenant_id, format, 'K7QM' from e
$$;

-- The same event WITHOUT naming the column at all: the default has to apply.
create function pg_temp.ev_default(p_id uuid) returns void
language sql as $$
  with e as (
    insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                               address, starts_at, ends_at)
    values (p_id, '1e500000-0000-4000-8000-000000000001', '1e500000-0000-4000-8000-000000000003',
            'Evento', 'in_person', 'Sede', 'Rua A, 1', now() + interval '1 day',
            now() + interval '1 day 2 hours')
    returning id, tenant_id, format
  )
  insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
  select id, tenant_id, format, 'K7QM' from e
$$;

-- ── 1. the column ─────────────────────────────────────────────────────────────────────────────
select col_type_is('public', 'events', 'schedule', 'jsonb', 'events.schedule is jsonb');
select col_not_null('public', 'events', 'schedule', 'events.schedule is NOT NULL');
select col_has_default('public', 'events', 'schedule', 'events.schedule has a default');
select lives_ok(
  $$ select pg_temp.ev_default('1e500000-0000-4000-8000-0000000000a0') $$,
  'an event inserted WITHOUT the column is accepted'
);
select results_eq(
  $$ select schedule::text from public.events where id = '1e500000-0000-4000-8000-0000000000a0' $$,
  ARRAY['[]'],
  '…and reads back as an empty array (a row that predates the column needs no data migration)'
);

-- ── 2. what the CHECK accepts ─────────────────────────────────────────────────────────────────
select lives_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000a1', '[]') $$,
  'events_schedule_chk: an empty array is accepted'
);
select lives_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000a2',
       '[{"day":1,"time":"08:00","title":"Credenciamento"}]') $$,
  '…one valid item is accepted'
);
select lives_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000a3',
       (select jsonb_agg(jsonb_build_object('day', 1, 'time', '09:00', 'title', 'Momento ' || n))::text
          from generate_series(1, 30) n)) $$,
  '…thirty items are accepted'
);
select lives_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000a4',
       '[{"day":31,"time":"23:59","title":"Encerramento"}]') $$,
  '…day 31 at 23:59 is accepted (the last valid moment)'
);
select lives_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000a5',
       jsonb_build_array(jsonb_build_object('day', 1, 'time', '10:00', 'title', repeat('x', 80)))::text) $$,
  '…and a title of exactly 80 characters is accepted'
);

-- ── 3. what the CHECK refuses (23514) ─────────────────────────────────────────────────────────
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000b1', '{"day":1}') $$,
  '23514', null, 'events_schedule_chk: a JSON object is refused (it must be an array)'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000b2', '"08:00 Credenciamento"') $$,
  '23514', null, '…a JSON string is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000b3',
       (select jsonb_agg(jsonb_build_object('day', 1, 'time', '09:00', 'title', 'Momento ' || n))::text
          from generate_series(1, 31) n)) $$,
  '23514', null, '…thirty-one items are refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000b4', '[1]') $$,
  '23514', null, '…an array holding a number is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000b5', '[{"day":1,"time":"08:00"}]') $$,
  '23514', null, '…an item missing its title is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000b6', '[{"day":0,"time":"08:00","title":"A"}]') $$,
  '23514', null, '…day 0 is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000b7', '[{"day":32,"time":"08:00","title":"A"}]') $$,
  '23514', null, '…day 32 is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000b8', '[{"day":1.5,"time":"08:00","title":"A"}]') $$,
  '23514', null, '…day 1.5 is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000b9', '[{"day":"1","time":"08:00","title":"A"}]') $$,
  '23514', null, '…a day written as a string is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000ba', '[{"day":1,"time":"24:00","title":"A"}]') $$,
  '23514', null, '…time 24:00 is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000bb', '[{"day":1,"time":"8:00","title":"A"}]') $$,
  '23514', null, '…time 8:00 (no leading zero) is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000bc', '[{"day":1,"time":"08:60","title":"A"}]') $$,
  '23514', null, '…time 08:60 is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000bd', '[{"day":1,"time":"08:00","title":""}]') $$,
  '23514', null, '…an empty title is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000be', '[{"day":1,"time":"08:00","title":"     "}]') $$,
  '23514', null, '…a blank title (spaces only) is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000bf',
       jsonb_build_array(jsonb_build_object('day', 1, 'time', '10:00', 'title', repeat('x', 81)))::text) $$,
  '23514', null, '…and a title of 81 characters is refused'
);
select throws_ok(
  $$ select pg_temp.ev('1e500000-0000-4000-8000-0000000000c0', null) $$,
  '23502', null, 'a NULL schedule is refused by the NOT NULL (the column holds an array or nothing)'
);

-- An UPDATE is judged like an INSERT.
select lives_ok(
  $$ update public.events set schedule = '[{"day":2,"time":"09:00","title":"Abertura"}]'::jsonb
      where id = '1e500000-0000-4000-8000-0000000000a1' $$,
  'an UPDATE to a valid schedule is accepted'
);
select throws_ok(
  $$ update public.events set schedule = '{"not":"an array"}'::jsonb
      where id = '1e500000-0000-4000-8000-0000000000a1' $$,
  '23514', null, '…and an UPDATE to an invalid value is refused the same way'
);

-- ── 4. tenant isolation: A reads its schedule, B reads zero rows, in the same block ────────────
select tests.as_tenant('1e500000-0000-4000-8000-000000000001', '1e500000-0000-4000-8000-000000000002');
select results_eq(
  $$ select schedule -> 0 ->> 'title' from public.events
      where id = '1e500000-0000-4000-8000-0000000000a1' $$,
  ARRAY['Abertura'],
  'positive control: a member lane of the OWNING tenant reads the schedule'
);
reset role;
select tests.as_tenant('1e500000-0000-4000-8000-000000000011', '1e500000-0000-4000-8000-000000000012');
select is_empty(
  $$ select schedule from public.events where id = '1e500000-0000-4000-8000-0000000000a1' $$,
  '…and a member lane of ANOTHER tenant reads zero rows for the same event id (no schedule leaks)'
);
reset role;

select * from finish();
rollback;
