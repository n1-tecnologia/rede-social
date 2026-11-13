begin;
-- 233-event-tickets.sql — Phase 10.1 (TICK-02, TICK-05, TICK-11, TICK-22; D-748, D-752, D-755;
-- T-10.1-04, T-10.1-19), executed inside Postgres. Later plans of the phase append numbered sections.
--
-- 1. SCHEMA: the four `event_attendances` columns (`origin`, `order_provider`, `order_ref`, `refunded_at`)
--    with their types, nulls and the `rsvp` default; an insert written the way the SHIPPED API writes it
--    (no new column) reads origin `rsvp` and null order columns, so the migration is expand-only (EP-41,
--    T-10.1-19); `origin = 'ticket'` without an order reference, an order reference without a provider,
--    `refunded_at` on a row that is not a ticket, an unknown origin and a malformed provider are each
--    refused (23514); a second row with the same (tenant, provider, order reference) is refused (23505)
--    while the same pair in another tenant is accepted; the two new indexes exist; the reference price
--    `events.ticket_price_cents` accepts 1 and 10000000, refuses 0 and 10000001 and accepts null; NO status
--    was added (the status CHECK still lists exactly going, not_going, checked_in, walk_in).
--
-- Fixture ids use the `1e310000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(30);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-tkt-a', 'Ingresso A', '1e310000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-tkt-b', 'Ingresso B', '1e310000-0000-4000-8000-000000000002');
select tests.auth_user('admin@tkt-a.local', '1e310000-0000-4000-8000-0000000000a1');
select tests.auth_user('u1@tkt-a.local', '1e310000-0000-4000-8000-0000000000c1');
select tests.auth_user('u2@tkt-a.local', '1e310000-0000-4000-8000-0000000000c2');
select tests.auth_user('u3@tkt-a.local', '1e310000-0000-4000-8000-0000000000c3');
select tests.auth_user('u4@tkt-a.local', '1e310000-0000-4000-8000-0000000000c4');
select tests.auth_user('u5@tkt-a.local', '1e310000-0000-4000-8000-0000000000c5');
select tests.auth_user('u6@tkt-a.local', '1e310000-0000-4000-8000-0000000000c6');
select tests.auth_user('u7@tkt-a.local', '1e310000-0000-4000-8000-0000000000c7');
select tests.auth_user('u8@tkt-a.local', '1e310000-0000-4000-8000-0000000000c8');
select tests.auth_user('u1@tkt-b.local', '1e310000-0000-4000-8000-0000000000d1');

-- Two future events, one per tenant (the attendance guard refuses an answer from the start on). The deferred
-- event/secrets keys are never checked: this file never commits.
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at) values
  ('1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Evento A', 'in_person', 'Sede', 'Rua A, 1', now() + interval '10 days', now() + interval '10 days 2 hours'),
  ('1e310000-0000-4000-8000-0000000000e2', '1e310000-0000-4000-8000-000000000002', '1e310000-0000-4000-8000-0000000000d1', 'Evento B', 'in_person', 'Sede', 'Rua B, 1', now() + interval '10 days', now() + interval '10 days 2 hours');

-- ── 1. schema ──────────────────────────────────────────────────────────────────────────────────
select col_type_is('public', 'event_attendances', 'origin', 'text', 'event_attendances.origin is text');
select col_not_null('public', 'event_attendances', 'origin', 'event_attendances.origin is not null');
select col_default_is('public', 'event_attendances', 'origin', 'rsvp', 'event_attendances.origin defaults to rsvp');
select col_type_is('public', 'event_attendances', 'order_provider', 'text', 'event_attendances.order_provider is text');
select col_is_null('public', 'event_attendances', 'order_provider', 'event_attendances.order_provider is nullable');
select col_type_is('public', 'event_attendances', 'order_ref', 'text', 'event_attendances.order_ref is text');
select col_is_null('public', 'event_attendances', 'order_ref', 'event_attendances.order_ref is nullable');
select col_type_is('public', 'event_attendances', 'refunded_at', 'timestamp with time zone', 'event_attendances.refunded_at is timestamptz');
select col_is_null('public', 'event_attendances', 'refunded_at', 'event_attendances.refunded_at is nullable');

-- EP-41 / T-10.1-19: a row written the way the shipped API writes it, naming none of the new columns.
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
  values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-0000000000c1', 'going', now());
select is(
  (select origin = 'rsvp' and order_provider is null and order_ref is null and refunded_at is null
     from public.event_attendances where user_id = '1e310000-0000-4000-8000-0000000000c1'),
  true, 'EP-41: an insert that names no new column reads origin rsvp and null order columns');

-- The CHECKs (23514). Each case breaks ONE rule.
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-0000000000c2', 'going', now(), 'ticket') $$,
  '23514', null, 'D-748: origin ticket without an order reference is refused');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-0000000000c2', 'going', now(), 'ticket', 'ORD-X') $$,
  '23514', null, 'D-748: an order reference without a provider is refused');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, refunded_at) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-0000000000c2', 'going', now(), now()) $$,
  '23514', null, 'D-748: refunded_at on a row that is not a ticket is refused');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-0000000000c2', 'going', now(), 'gift') $$,
  '23514', null, 'D-752: an unknown origin is refused');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-0000000000c2', 'going', now(), 'ticket', 'Bad Provider', 'ORD-X') $$,
  '23514', null, 'D-752: a malformed provider is refused (lower snake format)');

-- Valid shapes.
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-0000000000c3', 'going', now(), 'ticket', 'fake', 'ORD-1') $$,
  'D-752: a ticket row with a provider and an order reference is accepted');
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-0000000000c4', 'going', now(), 'courtesy') $$,
  'D-752: a courtesy row without an order reference is accepted');

-- One order is one presence, per tenant.
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-0000000000c5', 'going', now(), 'ticket', 'fake', 'ORD-1') $$,
  '23505', null, 'D-748: a second presence for the same (tenant, provider, order reference) is refused (event_attendances_order_uq)');
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000002', '1e310000-0000-4000-8000-0000000000e2', '1e310000-0000-4000-8000-0000000000d1', 'going', now(), 'ticket', 'fake', 'ORD-1') $$,
  'D-748: the same (provider, order reference) in ANOTHER tenant is a different presence');

select has_index('public', 'event_attendances', 'event_attendances_order_uq', 'the unique order index exists');
select has_index('public', 'event_attendances', 'event_attendances_ticket_idx', 'the paid-presences index exists');

-- D-755: the reference price.
select col_type_is('public', 'events', 'ticket_price_cents', 'integer', 'events.ticket_price_cents is integer');
select col_is_null('public', 'events', 'ticket_price_cents', 'events.ticket_price_cents is nullable (no price shown)');
select lives_ok(
  $$ update public.events set ticket_price_cents = 1 where id = '1e310000-0000-4000-8000-0000000000e1' $$,
  'D-755: a reference price of 1 cent is accepted');
select lives_ok(
  $$ update public.events set ticket_price_cents = 10000000 where id = '1e310000-0000-4000-8000-0000000000e1' $$,
  'D-755: a reference price of 10000000 cents is accepted');
select throws_ok(
  $$ update public.events set ticket_price_cents = 0 where id = '1e310000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'D-755: a reference price of 0 is refused (events_ticket_price_chk)');
select throws_ok(
  $$ update public.events set ticket_price_cents = 10000001 where id = '1e310000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'D-755: a reference price above 10000000 is refused');
select lives_ok(
  $$ update public.events set ticket_price_cents = null where id = '1e310000-0000-4000-8000-0000000000e1' $$,
  'D-755: a null reference price is accepted again');

-- D-752: NO status was added.
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'event_attendances_status_chk'),
  'CHECK ((status = ANY (ARRAY[''going''::text, ''not_going''::text, ''checked_in''::text, ''walk_in''::text])))',
  'D-752: the status CHECK still lists exactly going, not_going, checked_in, walk_in');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e1', '1e310000-0000-4000-8000-0000000000c6', 'paid', now()) $$,
  '23514', null, 'D-752: a paid status does not exist');

select * from finish();
rollback;
