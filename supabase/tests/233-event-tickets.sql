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
-- 2. GATE (plan 02, D-741, T-10.1-03, T-10.1-04, T-10.1-21): `app.event_ticket_mapped` is true for a mapped
--    event and false for a free one, and answers false to a member of ANOTHER tenant; a member's own
--    `going` in a mapped event is 23514 `payment_required` (the named code beats the policy), the same
--    insert in a free event succeeds; a member forging `origin` (`ticket`, `courtesy`) or writing an order
--    reference or `refunded_at` is 42501 (the policy pins the new row); turning the payments module flag
--    off changes none of it (D-746). (Plan 02 task 2 extends this section with the paid-path exceptions.)
--
-- Fixture ids use the `1e310000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(66);

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

-- ── 2. gate ────────────────────────────────────────────────────────────────────────────────────
-- E_paid (mapped) and E_free (not mapped), both in tenant A and both a week away.
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at) values
  ('1e310000-0000-4000-8000-0000000000e3', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Evento pago', 'in_person', 'Sede', 'Rua A, 3', now() + interval '7 days', now() + interval '7 days 2 hours'),
  ('1e310000-0000-4000-8000-0000000000e4', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Evento livre', 'in_person', 'Sede', 'Rua A, 4', now() + interval '7 days', now() + interval '7 days 2 hours');
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id) values
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-e3', '1e310000-0000-4000-8000-0000000000e3');

-- The paid fact, with no claims (the service lane) and from each member lane.
select set_config('request.jwt.claims', '', true);
select is(app.event_ticket_mapped('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e3'),
  true, 'D-741: app.event_ticket_mapped is true for an event that has a mapping');
select is(app.event_ticket_mapped('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e4'),
  false, 'D-741: ...and false for an event that has none');
select tests.as_tenant('1e310000-0000-4000-8000-000000000002', '1e310000-0000-4000-8000-0000000000d1');
select is(app.event_ticket_mapped('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e3'),
  false, 'T-10.1-21: a member of ANOTHER tenant is told false, never another tenant''s mapping');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c5');
select is(app.event_ticket_mapped('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e3'),
  true, 'D-741: a member of the same tenant is told true');

-- The closed door, from the member lane (RLS is on: the role is `authenticated`).
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e3', '1e310000-0000-4000-8000-0000000000c5', 'going', now()) $$,
  '23514', 'payment_required', 'D-741/T-10.1-03: a member''s own going in a mapped event is payment_required (the named code, not a bare 42501)');
select lives_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e4', '1e310000-0000-4000-8000-0000000000c5', 'going', now()) $$,
  'D-741: the same insert in an event with no mapping is accepted (a free event is unchanged)');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e3', '1e310000-0000-4000-8000-0000000000c6', 'going', now(), 'ticket', 'fake', 'ORD-FORGED') $$,
  '42501', null, 'T-10.1-04: a member forging origin ticket with an order reference in a mapped event is refused by the policy');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e4', '1e310000-0000-4000-8000-0000000000c6', 'going', now(), 'courtesy') $$,
  '42501', null, 'T-10.1-04: a member forging origin courtesy is refused by the policy');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e4', '1e310000-0000-4000-8000-0000000000c6', 'going', now(), 'fake', 'ORD-FORGED-2') $$,
  '42501', null, 'T-10.1-04: a member writing an order reference of its own is refused by the policy');
select throws_ok(
  $$ update public.event_attendances set refunded_at = now() where event_id = '1e310000-0000-4000-8000-0000000000e4' and user_id = '1e310000-0000-4000-8000-0000000000c5' $$,
  '42501', null, 'T-10.1-04: a member writing refunded_at on its own row is refused by the policy');
reset role;

-- D-746: the payments module flag off changes nothing; the paid fact does not read it.
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('1e310000-0000-4000-8000-000000000001', 'payments', false);
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c5');
select is(app.event_ticket_mapped('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e3'),
  true, 'D-746: with the payments module off the event is still mapped');
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e3', '1e310000-0000-4000-8000-0000000000c5', 'going', now()) $$,
  '23514', 'payment_required', 'D-746: ...and the free Vou stays closed');
reset role;


-- ── 2b. the paid path, the ticket lock, the bookkeeping exit, the walk-in backstop ──────────────
-- (plan 02, task 2: `*_event_ticket_guard_exceptions.sql`, the final guard body.)
-- e5 mapped, started 1 hour ago, limit 1 | e6 mapped, ended | e7 mapped, cancelled | e8 mapped (the lock) |
-- e9 mapped, check-in window, cancelled later | ea mapped / eb free, check-in window |
-- ec free, full | ed free, started.
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, capacity) values
  ('1e310000-0000-4000-8000-0000000000e5', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Pago iniciado', 'in_person', 'Sede', 'Rua A, 9', now() + interval '-1 hour', now() + interval '2 hours', 1),
  ('1e310000-0000-4000-8000-0000000000e6', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Pago encerrado', 'in_person', 'Sede', 'Rua A, 9', now() + interval '-3 hours', now() + interval '-1 hour', null),
  ('1e310000-0000-4000-8000-0000000000e7', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Pago cancelado', 'in_person', 'Sede', 'Rua A, 9', now() + interval '5 days', now() + interval '5 days 2 hours', null),
  ('1e310000-0000-4000-8000-0000000000e8', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Pago trava', 'in_person', 'Sede', 'Rua A, 9', now() + interval '5 days', now() + interval '5 days 2 hours', null),
  ('1e310000-0000-4000-8000-0000000000e9', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Pago contabilidade', 'in_person', 'Sede', 'Rua A, 9', now() + interval '30 minutes', now() + interval '150 minutes', null),
  ('1e310000-0000-4000-8000-0000000000ea', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Pago porta', 'in_person', 'Sede', 'Rua A, 9', now() + interval '30 minutes', now() + interval '150 minutes', null),
  ('1e310000-0000-4000-8000-0000000000eb', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Livre porta', 'in_person', 'Sede', 'Rua A, 9', now() + interval '30 minutes', now() + interval '150 minutes', null),
  ('1e310000-0000-4000-8000-0000000000ec', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Livre lotado', 'in_person', 'Sede', 'Rua A, 9', now() + interval '5 days', now() + interval '5 days 2 hours', 1),
  ('1e310000-0000-4000-8000-0000000000ed', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Livre iniciado', 'in_person', 'Sede', 'Rua A, 9', now() + interval '-1 hour', now() + interval '2 hours', null);
select set_config('request.jwt.claims', '', true);
select tests.as_service();
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e8', '1e310000-0000-4000-8000-0000000000c3', 'going', now(), 'rsvp');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e9', '1e310000-0000-4000-8000-0000000000c2', 'going', now(), 'rsvp');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e9', '1e310000-0000-4000-8000-0000000000c1', 'checked_in', now(), now(), 'code', 'ticket', 'fake', 'ORD-E9');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000ec', '1e310000-0000-4000-8000-0000000000c1', 'going', now(), 'rsvp');
reset role;
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id) values
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-e5', '1e310000-0000-4000-8000-0000000000e5'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-e6', '1e310000-0000-4000-8000-0000000000e6'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-e7', '1e310000-0000-4000-8000-0000000000e7'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-e8', '1e310000-0000-4000-8000-0000000000e8'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-e9', '1e310000-0000-4000-8000-0000000000e9'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-ea', '1e310000-0000-4000-8000-0000000000ea');
update public.events set status = 'cancelled', cancelled_at = now() where id in ('1e310000-0000-4000-8000-0000000000e7', '1e310000-0000-4000-8000-0000000000e9');

-- D-750 / D-751 / TICK-09 / TICK-10: the paid path passes the start and the capacity.
select tests.as_service();
select lives_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e5', '1e310000-0000-4000-8000-0000000000c1', 'going', now(), 'ticket', 'fake', 'ORD-E5-1') $$,
  'D-750: a ticket row lands after starts_at (rsvp_closed does not apply to the paid path)');
select lives_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e5', '1e310000-0000-4000-8000-0000000000c2', 'going', now(), 'ticket', 'fake', 'ORD-E5-2') $$,
  'D-751: a second ticket row lands over a limit of 1 (capacity does not apply to the paid path)');
select lives_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e5', '1e310000-0000-4000-8000-0000000000c3', 'going', now(), 'courtesy') $$,
  'D-751: a courtesy row lands after starts_at and over capacity');
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e6', '1e310000-0000-4000-8000-0000000000c1', 'going', now(), 'ticket', 'fake', 'ORD-E6-1') $$,
  '23514', 'event_ended', 'D-750: a ticket row is refused at ends_at (event_ended)');
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e6', '1e310000-0000-4000-8000-0000000000c2', 'going', now(), 'courtesy') $$,
  '23514', 'event_ended', 'D-750: a courtesy row is refused at ends_at (event_ended)');
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e7', '1e310000-0000-4000-8000-0000000000c1', 'going', now(), 'ticket', 'fake', 'ORD-E7-1') $$,
  '23514', 'cancelled', 'D-201: a ticket row is refused on a cancelled event (the cancelled step is unconditional)');
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e7', '1e310000-0000-4000-8000-0000000000c2', 'going', now(), 'courtesy') $$,
  '23514', 'cancelled', 'D-201: a courtesy row is refused on a cancelled event');
reset role;

-- The member lane in the same mapped event, then the free-event controls.
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c5');
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e5', '1e310000-0000-4000-8000-0000000000c5', 'going', now(), 'rsvp') $$,
  '23514', 'payment_required', 'D-741: in a mapped event a member''s own Vou, started and over capacity, is payment_required (paying is the way in)');
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000ec', '1e310000-0000-4000-8000-0000000000c5', 'going', now(), 'rsvp') $$,
  '23514', 'event_full', 'control: in a FREE full event a member''s own Vou is still event_full');
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000ed', '1e310000-0000-4000-8000-0000000000c5', 'going', now(), 'rsvp') $$,
  '23514', 'rsvp_closed', 'control: in a FREE started event a member''s own Vou is still rsvp_closed');
reset role;

-- D-754 / A-UI-4: the ticket lock.
select tests.as_service();
select lives_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e8', '1e310000-0000-4000-8000-0000000000c1', 'going', now(), 'ticket', 'fake', 'ORD-E8-1') $$,
  'fixture: a ticket holder in e8');
select lives_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e8', '1e310000-0000-4000-8000-0000000000c2', 'going', now(), 'courtesy') $$,
  'fixture: a courtesy holder in e8');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c1');
select throws_ok($$ update public.event_attendances set status = 'not_going', responded_at = now() where event_id = '1e310000-0000-4000-8000-0000000000e8' and user_id = '1e310000-0000-4000-8000-0000000000c1' $$,
  '23514', 'ticket_locked', 'D-754: a ticket holder''s Não vou is ticket_locked (the named code beats the policy)');
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000e8', '1e310000-0000-4000-8000-0000000000c1', 'going', now(), 'rsvp') on conflict (tenant_id, event_id, user_id) do update set status = excluded.status, responded_at = now(), updated_at = now() where event_attendances.status in ('going','not_going') and event_attendances.status is distinct from excluded.status $$,
  '23514', 'payment_required', 'D-741: a holder repeating Vou is judged on the proposed INSERT and refused payment_required (the service answers it as the unchanged 200)');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c2');
select throws_ok($$ update public.event_attendances set status = 'not_going', responded_at = now() where event_id = '1e310000-0000-4000-8000-0000000000e8' and user_id = '1e310000-0000-4000-8000-0000000000c2' $$,
  '23514', 'ticket_locked', 'D-754: a courtesy holder''s Não vou is ticket_locked');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c3');
select lives_ok($$ update public.event_attendances set status = 'not_going', responded_at = now() where event_id = '1e310000-0000-4000-8000-0000000000e8' and user_id = '1e310000-0000-4000-8000-0000000000c3' $$,
  'A-UI-4: a presence made BEFORE the link (origin rsvp) may go to not_going');
select throws_ok($$ update public.event_attendances set status = 'going', responded_at = now() where event_id = '1e310000-0000-4000-8000-0000000000e8' and user_id = '1e310000-0000-4000-8000-0000000000c3' $$,
  '23514', 'payment_required', 'A-UI-4/D-741: ...and cannot return to going without paying');
reset role;
select is((select status from public.event_attendances where event_id = '1e310000-0000-4000-8000-0000000000e8' and user_id = '1e310000-0000-4000-8000-0000000000c1'), 'going', 'D-754: the ticket holder is still going after the refused Não vou and the refused repeat');

-- Pitfalls 1 and 3: the bookkeeping exit (a definer''s refund flag and origin upgrade on a cancelled event).
select tests.as_service();
select lives_ok($$ update public.event_attendances set refunded_at = now() where event_id = '1e310000-0000-4000-8000-0000000000e9' and user_id = '1e310000-0000-4000-8000-0000000000c1' $$,
  'bookkeeping exit: refunded_at on a CHECKED-IN ticket row of a CANCELLED event passes (no cancelled, no checked-in lock)');
select lives_ok($$ update public.event_attendances set origin = 'ticket', order_provider = 'fake', order_ref = 'ORD-E9-UP', updated_at = now() where event_id = '1e310000-0000-4000-8000-0000000000e9' and user_id = '1e310000-0000-4000-8000-0000000000c2' $$,
  'bookkeeping exit: an origin upgrade of a going presence on a cancelled event passes');
select throws_ok($$ update public.event_attendances set status = 'checked_in', checked_in_at = now(), checkin_via = 'code' where event_id = '1e310000-0000-4000-8000-0000000000e9' and user_id = '1e310000-0000-4000-8000-0000000000c2' $$,
  '23514', 'cancelled', 'control: an ordinary update (a check-in) on the same cancelled event is still refused (the exit is narrow)');
select is((select origin from public.event_attendances where event_id = '1e310000-0000-4000-8000-0000000000e9' and user_id = '1e310000-0000-4000-8000-0000000000c2'), 'ticket', 'bookkeeping exit: the upgraded row reads origin ticket');
reset role;

-- Step 6b: the walk-in backstop.
select tests.as_service();
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, checked_in_at, checkin_via) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000ea', '1e310000-0000-4000-8000-0000000000c7', 'walk_in', now(), 'code') $$,
  '23514', 'payment_required', 'T-10.1-05: a new walk_in row in a mapped event is payment_required (backstop)');
select lives_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, checked_in_at, checkin_via) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000eb', '1e310000-0000-4000-8000-0000000000c7', 'walk_in', now(), 'code') $$,
  'control: the same walk_in in a free event is accepted (as pgTAP 141 proves)');
reset role;

select * from finish();
rollback;
