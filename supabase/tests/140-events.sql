begin;
-- 140-events.sql — Phase 6's schema facts, executed inside Postgres (06-01). Numbered 140 because
-- 120 and 130 belong to 05.2 (highlights) and 05.3 (reels). Later Phase 6 plans extend it.
--
-- 1. `events_window_chk` refuses an event that ends when it starts (D-213); one minute later inserts.
--
-- 2. `events_location_chk` carries D-213's venue-XOR-URL rule on `events`: an in-person row needs a
--    NON-BLANK venue and address, and an online row carries neither.
--
-- 3. `events_cancelled_at_chk` ties the status to its timestamp in both directions.
--
-- 4. `event_secrets_code_chk` admits only 4 symbols of the unambiguous alphabet (no 0/O/1/I/L).
--
-- 5. `event_secrets_https_chk` refuses an `http:` meeting URL, and `event_secrets_url_chk` refuses an
--    online secrets row with no URL at all.
--
-- 6. PITFALL 4, THE DEFERRED FOREIGN KEYS. This file never commits, so a DEFERRABLE INITIALLY
--    DEFERRED constraint would never be checked and every "an event without its secrets" test would
--    pass vacuously. `set constraints all immediate` is what makes them fire here: it checks every
--    outstanding row RETROACTIVELY (the positive control: the fixture pairs, written half by half,
--    satisfy both keys at that point) and then checks each later statement at its end. Under it:
--      - an `events` row with no secrets row is refused on `events_secrets_fk` (23503);
--      - an online event whose secrets row says `in_person` is refused on `event_secrets_event_fk`
--        (23503) — the XOR carried across the two tables by the redundant discriminator;
--      - the matching pair, written in ONE statement, is accepted.
--
-- 7. RESEARCH A1: a referential ACTION is never deferred. Deleting an event removes its secrets row
--    at once (`on delete cascade`), while the check side of the same key waits for commit.
--
-- 8. THE ROLE-GATED POLICY (D-207, D-208, D-217, T-06-01). `event_secrets_staff_all` reads the
--    `tenant_role` claim: a `member` lane of tenant A selects ZERO secrets rows and cannot insert one
--    (42501), while an `admin_tenant` lane of the SAME tenant selects its row — both in one block, so
--    neither half can pass on a broken fixture. B's secrets row is never visible from A's admin lane.
--
-- 9. Both list statements ride their index BY NAME on a 400-row fixture built and ANALYZEd here:
--    `events_tenant_starts_idx` serves Próximos (`ends_at > now()`, `starts_at asc, id asc`) and
--    `events_tenant_ends_idx` serves Passados (`ends_at <= now()`, `ends_at desc, id desc`). The
--    statements are `listEvents`' own, page 1, and neither plan may be a sequential scan.
--
-- `now()` is the transaction timestamp, so every instant below is placed relative to the SAME clock.
-- Fixture ids use the `1e000000-…` prefix, which no other pgTAP file uses. Like its siblings, this
-- file ROLLS BACK, so it re-runs identically against a seeded or an empty database.
select plan(29);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-ev-a', 'Eventos A', '1e000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-ev-b', 'Eventos B', '1e000000-0000-4000-8000-000000000011');
select tests.auth_user('member@ev-a.local', '1e000000-0000-4000-8000-000000000002');
select tests.auth_user('admin@ev-a.local', '1e000000-0000-4000-8000-000000000003');
select tests.auth_user('member@ev-b.local', '1e000000-0000-4000-8000-000000000012');
select tests.member('1e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000002');
select tests.member('1e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000003', 'admin_tenant');
select tests.member('1e000000-0000-4000-8000-000000000011', '1e000000-0000-4000-8000-000000000012');

-- One in-person event per tenant, IDENTICAL-looking (same title, same code), each written HALF BY
-- HALF: the `events` row first, its secrets row second. With an immediate existence key the first
-- statement would already be refused; deferred, the pair only has to be whole at the check point.
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at)
values ('1e000000-0000-4000-8000-0000000000e1', '1e000000-0000-4000-8000-000000000001',
        '1e000000-0000-4000-8000-000000000003', 'Encontro', 'in_person', 'Sede', 'Rua A, 1',
        now() + interval '1 day', now() + interval '1 day 2 hours');
insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
values ('1e000000-0000-4000-8000-0000000000e1', '1e000000-0000-4000-8000-000000000001', 'in_person', 'K7QM');
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at)
values ('1e000000-0000-4000-8000-0000000000e2', '1e000000-0000-4000-8000-000000000011',
        '1e000000-0000-4000-8000-000000000012', 'Encontro', 'in_person', 'Sede', 'Rua A, 1',
        now() + interval '1 day', now() + interval '1 day 2 hours');
insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
values ('1e000000-0000-4000-8000-0000000000e2', '1e000000-0000-4000-8000-000000000011', 'in_person', 'K7QM');

-- Both halves of an event in ONE statement, the only legal shape once the keys are immediate. Every
-- positive control below goes through it, so the control proves the rule under test and not a
-- missing secrets row.
create function pg_temp.event_pair(
  p_id uuid,
  p_format text,
  p_venue text,
  p_address text,
  p_starts timestamptz,
  p_ends timestamptz,
  p_status text default 'active',
  p_cancelled_at timestamptz default null,
  p_code text default 'K7QM',
  p_url text default null
) returns void
language sql as $$
  with e as (
    insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                               address, starts_at, ends_at, status, cancelled_at)
    values (p_id, '1e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000003',
            'Evento', p_format, p_venue, p_address, p_starts, p_ends, p_status, p_cancelled_at)
    returning id, tenant_id, format
  )
  insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code, meeting_url)
  select id, tenant_id, format, p_code, p_url from e
$$;

-- ── 6 (first half). the deferred pairs are whole at the check point ────────────────────────────
select lives_ok(
  $$ set constraints all immediate $$,
  'Pitfall 4 positive control: the fixture pairs, written half by half in one deferred transaction, satisfy both keys when checked'
);
-- Stated again as a plain statement: every assertion below runs with the keys IMMEDIATE.
set constraints all immediate;

-- ── 1. events_window_chk ──────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at)
     values ('1e000000-0000-4000-8000-000000000101', '1e000000-0000-4000-8000-000000000001',
             '1e000000-0000-4000-8000-000000000003', 'Evento', 'in_person', 'Sede', 'Rua A, 1',
             now(), now()) $$,
  '23514',
  null,
  'events_window_chk refuses an event whose end equals its start (D-213)'
);
select lives_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000102', 'in_person', 'Sede', 'Rua A, 1',
                               now(), now() + interval '1 minute') $$,
  'positive control: one minute after the start is accepted'
);

-- ── 2. events_location_chk ────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at)
     values ('1e000000-0000-4000-8000-000000000201', '1e000000-0000-4000-8000-000000000001',
             '1e000000-0000-4000-8000-000000000003', 'Evento', 'in_person', '   ', 'Rua A, 1',
             now(), now() + interval '1 hour') $$,
  '23514',
  null,
  'events_location_chk refuses an in-person event with a blank venue'
);
select throws_ok(
  $$ insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at)
     values ('1e000000-0000-4000-8000-000000000202', '1e000000-0000-4000-8000-000000000001',
             '1e000000-0000-4000-8000-000000000003', 'Evento', 'online', null, 'Rua A, 1',
             now(), now() + interval '1 hour') $$,
  '23514',
  null,
  'events_location_chk refuses an online event that carries an address'
);
select lives_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000203', 'in_person', 'Sede', 'Rua A, 1',
                               now(), now() + interval '1 hour') $$,
  'positive control: an in-person event with a venue and an address is accepted'
);
select lives_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000204', 'online', null, null,
                               now(), now() + interval '1 hour', p_url => 'https://meet.x.test/a') $$,
  'positive control: an online event with neither, and its URL in event_secrets, is accepted'
);

-- ── 3. events_cancelled_at_chk ────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, status, cancelled_at)
     values ('1e000000-0000-4000-8000-000000000301', '1e000000-0000-4000-8000-000000000001',
             '1e000000-0000-4000-8000-000000000003', 'Evento', 'in_person', 'Sede', 'Rua A, 1',
             now(), now() + interval '1 hour', 'cancelled', null) $$,
  '23514',
  null,
  'events_cancelled_at_chk refuses a cancelled event with no cancelled_at'
);
select throws_ok(
  $$ insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, status, cancelled_at)
     values ('1e000000-0000-4000-8000-000000000302', '1e000000-0000-4000-8000-000000000001',
             '1e000000-0000-4000-8000-000000000003', 'Evento', 'in_person', 'Sede', 'Rua A, 1',
             now(), now() + interval '1 hour', 'active', now()) $$,
  '23514',
  null,
  '…and an active event that carries a cancelled_at'
);
select lives_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000303', 'in_person', 'Sede', 'Rua A, 1',
                               now(), now() + interval '1 hour', 'cancelled', now()) $$,
  'positive control: a cancelled event with its cancelled_at is accepted'
);

-- ── 4. event_secrets_code_chk ─────────────────────────────────────────────────────────────────
select throws_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000401', 'in_person', 'Sede', 'Rua A, 1',
                               now(), now() + interval '1 hour', p_code => 'O0I1') $$,
  '23514',
  null,
  'event_secrets_code_chk refuses the look-alikes O, 0, I and 1'
);
select throws_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000402', 'in_person', 'Sede', 'Rua A, 1',
                               now(), now() + interval '1 hour', p_code => 'K7QMX') $$,
  '23514',
  null,
  '…and a 5-character code'
);
select lives_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000403', 'in_person', 'Sede', 'Rua A, 1',
                               now(), now() + interval '1 hour', p_code => 'K7QM') $$,
  'positive control: K7QM is accepted'
);

-- ── 5. event_secrets_https_chk and event_secrets_url_chk ──────────────────────────────────────
select throws_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000501', 'online', null, null,
                               now(), now() + interval '1 hour', p_url => 'http://x.test') $$,
  '23514',
  null,
  'event_secrets_https_chk refuses an http: meeting URL'
);
select throws_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000502', 'online', null, null,
                               now(), now() + interval '1 hour') $$,
  '23514',
  null,
  'event_secrets_url_chk refuses an online event with no URL at all'
);
select lives_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000503', 'online', null, null,
                               now(), now() + interval '1 hour', p_url => 'https://x.test') $$,
  'positive control: https://x.test is accepted'
);

-- ── 6 (second half). under immediate keys, half an event is refused ───────────────────────────
select throws_like(
  $$ insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at)
     values ('1e000000-0000-4000-8000-000000000601', '1e000000-0000-4000-8000-000000000001',
             '1e000000-0000-4000-8000-000000000003', 'Evento', 'in_person', 'Sede', 'Rua A, 1',
             now(), now() + interval '1 hour') $$,
  '%events_secrets_fk%',
  'events_secrets_fk: an events row with no secrets row is refused (23503) once the key is checked'
);
select throws_like(
  $$ with e as (
       insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at)
       values ('1e000000-0000-4000-8000-000000000602', '1e000000-0000-4000-8000-000000000001',
               '1e000000-0000-4000-8000-000000000003', 'Evento', 'online', null, null,
               now(), now() + interval '1 hour')
       returning id, tenant_id
     )
     insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code, meeting_url)
     select id, tenant_id, 'in_person', 'K7QM', null from e $$,
  '%event_secrets_event_fk%',
  'event_secrets_event_fk: an online event whose secrets row says in_person is refused (23503) — the XOR across tables'
);
select lives_ok(
  $$ select pg_temp.event_pair('1e000000-0000-4000-8000-000000000603', 'online', null, null,
                               now(), now() + interval '1 hour', p_url => 'https://x.test/b') $$,
  'positive control: the matching pair, written in one statement, is accepted under immediate keys'
);

-- ── 7. the cascade is immediate ───────────────────────────────────────────────────────────────
select pg_temp.event_pair('1e000000-0000-4000-8000-000000000701', 'in_person', 'Sede', 'Rua A, 1',
                          now(), now() + interval '1 hour');
delete from public.events where id = '1e000000-0000-4000-8000-000000000701';
select results_eq(
  $$ select count(*)::int from public.event_secrets
      where event_id = '1e000000-0000-4000-8000-000000000701' $$,
  ARRAY[0],
  'A1: deleting an event removes its secrets row at once (a referential action is never deferred)'
);
select results_eq(
  $$ select count(*)::int from public.event_secrets
      where event_id = '1e000000-0000-4000-8000-0000000000e1' $$,
  ARRAY[1],
  'positive control: another event''s secrets row is untouched'
);

-- ── 8. the role-gated policy: member 0, admin 1, in the same block ────────────────────────────
select tests.as_tenant('1e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000002', 'member');
select results_eq(
  $$ select count(*)::int from public.event_secrets $$,
  ARRAY[0],
  'T-06-01: a MEMBER lane selects zero event_secrets rows — no URL, no code'
);
select throws_ok(
  $$ insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
     values ('1e000000-0000-4000-8000-000000000801', '1e000000-0000-4000-8000-000000000001',
             'in_person', 'K7QM') $$,
  '42501',
  null,
  '…and cannot write one (WITH CHECK)'
);
select results_eq(
  $$ select count(*)::int from public.events where id = '1e000000-0000-4000-8000-0000000000e1' $$,
  ARRAY[1],
  'positive control: the same member lane DOES see the event itself'
);
reset role;
select tests.as_tenant('1e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000003', 'admin_tenant');
select results_eq(
  $$ select checkin_code from public.event_secrets
      where event_id = '1e000000-0000-4000-8000-0000000000e1' $$,
  ARRAY['K7QM'],
  'the ADMIN lane of the same tenant selects the fixture''s one secrets row'
);
select is_empty(
  $$ select event_id from public.event_secrets
      where event_id = '1e000000-0000-4000-8000-0000000000e2'
         or tenant_id = '1e000000-0000-4000-8000-000000000011' $$,
  '…and never B''s, although B''s row carries the identical code'
);
reset role;

-- ── 9. both list statements ride their index, by name ─────────────────────────────────────────
-- 400 events in tenant A, half ended and half not, then `analyze`: with a handful of rows the
-- planner always chooses a sequential scan and the assertions would prove nothing.
with e as (
  insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at)
  select ('1e00e0' || lpad(to_hex(g), 26, '0'))::uuid,
         '1e000000-0000-4000-8000-000000000001',
         '1e000000-0000-4000-8000-000000000003',
         'Volume ' || g, 'in_person', 'Sede', 'Rua A, 1',
         now() + ((g - 200) || ' hours')::interval,
         now() + ((g - 198) || ' hours')::interval
    from generate_series(1, 400) g
  returning id, tenant_id, format
)
insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
select id, tenant_id, format, 'K7QM' from e;

analyze public.events;

-- Captured with `execute … into`, because EXPLAIN cannot be a subquery. The predicates mirror what
-- RLS injects (`tenant_id = app.tenant_id()`), since pg_prove connects as the table owner.
create temporary table event_plans (name text primary key, plan text);

do $$
declare
  v_plan text;
begin
  execute
    'explain (format json) select e.id, e.starts_at, e.ends_at from public.events e
       left join public.media_assets a on a.id = e.cover_asset_id
      where e.tenant_id = ''1e000000-0000-4000-8000-000000000001''::uuid
        and e.deleted_at is null
        and e.ends_at > now()
        and (null::timestamptz is null
             or (e.starts_at, e.id) > (null::timestamptz, null::uuid))
      order by e.starts_at asc, e.id asc
      limit 11' into v_plan;
  insert into event_plans values ('upcoming', v_plan);

  execute
    'explain (format json) select e.id, e.starts_at, e.ends_at from public.events e
       left join public.media_assets a on a.id = e.cover_asset_id
      where e.tenant_id = ''1e000000-0000-4000-8000-000000000001''::uuid
        and e.deleted_at is null
        and e.ends_at <= now()
        and (null::timestamptz is null
             or (e.ends_at, e.id) < (null::timestamptz, null::uuid))
      order by e.ends_at desc, e.id desc
      limit 11' into v_plan;
  insert into event_plans values ('past', v_plan);
end
$$;

select matches(
  (select plan from event_plans where name = 'upcoming'),
  'events_tenant_starts_idx',
  'D-200: Próximos (ends_at > now(), starts_at asc, id asc) is served by events_tenant_starts_idx, BY NAME'
);
select matches(
  (select plan from event_plans where name = 'past'),
  'events_tenant_ends_idx',
  'D-200: Passados (ends_at <= now(), ends_at desc, id desc) is served by events_tenant_ends_idx, BY NAME'
);
select ok(
  (select plan from event_plans where name = 'upcoming') not like '%Seq Scan on events%'
  and (select plan from event_plans where name = 'past') not like '%Seq Scan on events%',
  '…and neither list statement is a sequential scan of events'
);

select * from finish();
rollback;
