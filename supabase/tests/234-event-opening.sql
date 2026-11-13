begin;
-- 234-event-opening.sql — Phase 10.2 (OPEN-01, OPEN-04, OPEN-24; D-780, D-781, D-791; EP-01, EP-02, EP-52;
-- T-10.2-03, T-10.2-04), executed inside Postgres. Later plans of the phase append numbered sections.
--
-- 1. THE OPENING COLUMN (plan 01, D-781, D-780, OPEN-04, EP-01, EP-02, T-10.2-04): `events.registration_opens_at`
--    is a nullable `timestamptz` with no default; an insert written the way the SHIPPED API writes it (no new
--    column) reads null; a null opening is accepted; an opening ONE MICROSECOND before `starts_at` and one far
--    before are accepted; an opening equal to `starts_at` and one after it are refused (23514, constraint
--    `events_registration_opens_chk`); a date already in the past is accepted (it only means open); a member of
--    ANOTHER tenant cannot read the event (so not its opening), with a positive control for the own tenant.
--
-- 2. THE CONFIRMATION INSTANT (plan 01, D-791, T-10.2-03, EP-52): `event_attendances.ticket_confirmed_at` is a
--    nullable `timestamptz` with no default; a row written the way the shipped member lane writes it reads null;
--    a ticket row accepts the instant and accepts null; a row of origin `rsvp` or `courtesy` carrying the instant
--    is refused (23514, constraint `event_attendances_ticket_confirmed_chk`); rows that existed before the change
--    read null in both new columns; the member insert policy still refuses a forged origin `ticket` (42501) with a
--    positive control of the plain `rsvp` insert.
--
-- Fixture ids use the `1e320000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(24);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-opn-a', 'Abertura A', '1e320000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-opn-b', 'Abertura B', '1e320000-0000-4000-8000-000000000002');
select tests.auth_user('admin@opn-a.local', '1e320000-0000-4000-8000-0000000000a1');
select tests.auth_user('admin@opn-b.local', '1e320000-0000-4000-8000-0000000000b1');
select tests.auth_user('u1@opn-a.local', '1e320000-0000-4000-8000-0000000000c1');
select tests.auth_user('u2@opn-a.local', '1e320000-0000-4000-8000-0000000000c2');
select tests.auth_user('u3@opn-a.local', '1e320000-0000-4000-8000-0000000000c3');
select tests.auth_user('u4@opn-a.local', '1e320000-0000-4000-8000-0000000000c4');
select tests.auth_user('u5@opn-a.local', '1e320000-0000-4000-8000-0000000000c5');
select tests.auth_user('u6@opn-a.local', '1e320000-0000-4000-8000-0000000000c6');

-- The events the attendance sections use; every row is inserted the way the SHIPPED API inserts it (no new column).
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at) values
  ('1e320000-0000-4000-8000-0000000000e1', '1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000a1', 'Evento A', 'in_person', 'Sede', 'Rua A, 1', now() + interval '10 days', now() + interval '10 days 2 hours'),
  ('1e320000-0000-4000-8000-0000000000e2', '1e320000-0000-4000-8000-000000000002', '1e320000-0000-4000-8000-0000000000b1', 'Evento B', 'in_person', 'Sede', 'Rua B, 1', now() + interval '10 days', now() + interval '10 days 2 hours');

-- ── 1. the opening column ──────────────────────────────────────────────────────────────────────
select col_type_is('public', 'events', 'registration_opens_at', 'timestamp with time zone', 'D-781: events.registration_opens_at is timestamptz');
select col_is_null('public', 'events', 'registration_opens_at', 'D-781: events.registration_opens_at is nullable (no date means open at once)');
select col_hasnt_default('public', 'events', 'registration_opens_at', 'D-781: events.registration_opens_at has no default (nothing is backfilled)');

-- EP-02: an event written the way the shipped API writes it stores a null opening.
select is(
  (select registration_opens_at is null from public.events where id = '1e320000-0000-4000-8000-0000000000e1'),
  true, 'EP-02: an insert that names no new column reads a null opening');

-- EP-01: the boundary pair. One microsecond before the start is accepted, the start itself is refused.
select lives_ok(
  $$ update public.events set registration_opens_at = starts_at - interval '1 microsecond' where id = '1e320000-0000-4000-8000-0000000000e1' $$,
  'OPEN-04: an opening one microsecond before the start is accepted');
select lives_ok(
  $$ update public.events set registration_opens_at = starts_at - interval '9 days' where id = '1e320000-0000-4000-8000-0000000000e1' $$,
  'OPEN-04: an opening well before the start is accepted');
select throws_ok(
  $$ update public.events set registration_opens_at = starts_at where id = '1e320000-0000-4000-8000-0000000000e1' $$,
  '23514', 'new row for relation "events" violates check constraint "events_registration_opens_chk"',
  'D-780/OPEN-04: an opening equal to the start is refused (events_registration_opens_chk)');
select throws_ok(
  $$ update public.events set registration_opens_at = starts_at + interval '1 hour' where id = '1e320000-0000-4000-8000-0000000000e1' $$,
  '23514', 'new row for relation "events" violates check constraint "events_registration_opens_chk"',
  'D-780/OPEN-04: an opening after the start is refused (events_registration_opens_chk)');
select lives_ok(
  $$ update public.events set registration_opens_at = null where id = '1e320000-0000-4000-8000-0000000000e1' $$,
  'D-781: a null opening is accepted again');
select lives_ok(
  $$ update public.events set registration_opens_at = now() - interval '3 days' where id = '1e320000-0000-4000-8000-0000000000e1' $$,
  'D-780: a date already in the past is accepted (it only means open)');

-- T-10.2-04: the existing tenant isolation policy governs the new column. Positive control first.
select tests.as_tenant('1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000c1');
select is(
  (select count(*)::int from public.events where id = '1e320000-0000-4000-8000-0000000000e1' and registration_opens_at is not null),
  1, 'T-10.2-04 positive control: a member of the OWN tenant reads the opening');
reset role;
select tests.as_tenant('1e320000-0000-4000-8000-000000000002', '1e320000-0000-4000-8000-0000000000b1');
select is(
  (select count(*)::int from public.events where id = '1e320000-0000-4000-8000-0000000000e1'),
  0, 'T-10.2-04: a member of ANOTHER tenant cannot read the event, so not its opening');
reset role;

-- ── 2. the confirmation instant ───────────────────────────────────────────────────────────────
select col_type_is('public', 'event_attendances', 'ticket_confirmed_at', 'timestamp with time zone', 'D-791: event_attendances.ticket_confirmed_at is timestamptz');
select col_is_null('public', 'event_attendances', 'ticket_confirmed_at', 'D-791: event_attendances.ticket_confirmed_at is nullable (every earlier row reads null)');
select col_hasnt_default('public', 'event_attendances', 'ticket_confirmed_at', 'D-791: event_attendances.ticket_confirmed_at has no default');

-- EP-52 (populated half): rows written BEFORE the change stand in as two rows that name neither new column.
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at) values
  ('1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000e1', '1e320000-0000-4000-8000-0000000000c1', 'going', now());
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values
  ('1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000e1', '1e320000-0000-4000-8000-0000000000c2', 'going', now(), 'courtesy');
select is(
  (select count(*)::int from public.event_attendances
    where event_id = '1e320000-0000-4000-8000-0000000000e1' and ticket_confirmed_at is null)
  + (select count(*)::int from public.events where id = '1e320000-0000-4000-8000-0000000000e2' and registration_opens_at is null),
  3, 'EP-52: rows that existed before the change read null in both new columns (the marker treats null as not early)');

-- A row written the way the shipped member lane writes it (origin rsvp, no order columns) reads null.
select is(
  (select ticket_confirmed_at is null and origin = 'rsvp' from public.event_attendances
    where user_id = '1e320000-0000-4000-8000-0000000000c1'),
  true, 'D-791: an rsvp row written the shipped way reads a null confirmation instant');

-- A ticket row accepts the instant and accepts null.
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref, ticket_confirmed_at) values ('1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000e1', '1e320000-0000-4000-8000-0000000000c3', 'going', now(), 'ticket', 'fake', 'ORD-OPN-1', now()) $$,
  'D-791: a ticket row accepts a confirmation instant');
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000e1', '1e320000-0000-4000-8000-0000000000c4', 'going', now(), 'ticket', 'fake', 'ORD-OPN-2') $$,
  'D-791: a ticket row accepts a null confirmation instant (a ticket confirmed before this change)');

-- T-10.2-03: only a ticket row may carry the instant; the constraint name is probed.
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, ticket_confirmed_at) values ('1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000e1', '1e320000-0000-4000-8000-0000000000c5', 'going', now(), 'rsvp', now()) $$,
  '23514', 'new row for relation "event_attendances" violates check constraint "event_attendances_ticket_confirmed_chk"',
  'T-10.2-03: an rsvp row carrying a confirmation instant is refused (event_attendances_ticket_confirmed_chk)');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, ticket_confirmed_at) values ('1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000e1', '1e320000-0000-4000-8000-0000000000c5', 'going', now(), 'courtesy', now()) $$,
  '23514', 'new row for relation "event_attendances" violates check constraint "event_attendances_ticket_confirmed_chk"',
  'T-10.2-03: a courtesy row carrying a confirmation instant is refused (event_attendances_ticket_confirmed_chk)');
select is(
  (select count(*)::int from pg_constraint where conname in ('events_registration_opens_chk', 'event_attendances_ticket_confirmed_chk')),
  2, 'both CHECKs of the phase exist by name');

-- No policy changed: the member lane still cannot forge a ticket, and the plain rsvp insert still works.
select tests.as_tenant('1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000c6');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref, ticket_confirmed_at) values ('1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000e1', '1e320000-0000-4000-8000-0000000000c6', 'going', now(), 'ticket', 'fake', 'ORD-FORGED', now()) $$,
  '42501', null, 'T-10.2-03: a member forging origin ticket is still refused by the policy');
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at) values ('1e320000-0000-4000-8000-000000000001', '1e320000-0000-4000-8000-0000000000e1', '1e320000-0000-4000-8000-0000000000c6', 'going', now()) $$,
  'T-10.2-03 positive control: the plain rsvp insert of a member still works');
reset role;

select * from finish();
rollback;
