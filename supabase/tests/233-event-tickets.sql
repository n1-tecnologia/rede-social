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
-- 3. DOORS (plan 03, D-742, T-10.1-05, T-10.1-06, T-10.1-22): `app.events_enter` and `app.events_check_in`
--    answer `ticket_required` to a member with no presence (no row, or `not_going`) in a mapped event: a NULL
--    URL, no walk-in row, and no guess counted (the attempts count is compared before and after a refused
--    wrong-code call); a holder (a ticket, a courtesy, a Vou or a walk-in or a check-in made BEFORE the link,
--    A6) passes with the old outcomes and keeps its origin and order; a FREE event is byte-identical; the
--    cancelled, ended, closed and not_open outcomes still win; a direct walk_in insert is still refused.
--
-- Fixture ids use the `1e310000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(220);

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


-- ── 3. the two doors (plan 03, D-742, T-10.1-05, T-10.1-06, T-10.1-22) ──────────────────────────
-- `20261113004658_event_ticket_doors.sql`: app.events_enter and app.events_check_in answer `ticket_required` to a
-- member with no presence in a MAPPED event, with a NULL URL and before any guess is counted.
-- f1 mapped in person, window open | f2 mapped online, window open | f3 mapped online, before the window |
-- f4 free in person / f5 free online, window open | f9 free online, before the window |
-- f6 mapped online cancelled | f7 mapped online ended | f8 mapped in person cancelled |
-- fa mapped in person ended | fb mapped in person, before the window.
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, status, cancelled_at) values
  ('1e310000-0000-4000-8000-0000000000f1', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Porta presencial paga', 'in_person', 'Sede', 'Rua A, 11', now() + interval '30 minutes', now() + interval '150 minutes', 'active', null),
  ('1e310000-0000-4000-8000-0000000000f2', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Porta online paga', 'online', null, null, now() + interval '30 minutes', now() + interval '150 minutes', 'active', null),
  ('1e310000-0000-4000-8000-0000000000f3', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Online pago cedo', 'online', null, null, now() + interval '5 days', now() + interval '5 days 2 hours', 'active', null),
  ('1e310000-0000-4000-8000-0000000000f4', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Porta presencial livre', 'in_person', 'Sede', 'Rua A, 12', now() + interval '30 minutes', now() + interval '150 minutes', 'active', null),
  ('1e310000-0000-4000-8000-0000000000f5', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Porta online livre', 'online', null, null, now() + interval '30 minutes', now() + interval '150 minutes', 'active', null),
  ('1e310000-0000-4000-8000-0000000000f6', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Online pago cancelado', 'online', null, null, now() + interval '30 minutes', now() + interval '150 minutes', 'cancelled', now()),
  ('1e310000-0000-4000-8000-0000000000f7', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Online pago encerrado', 'online', null, null, now() + interval '-3 hours', now() + interval '-1 minute', 'active', null),
  ('1e310000-0000-4000-8000-0000000000f8', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Presencial pago cancelado', 'in_person', 'Sede', 'Rua A, 13', now() + interval '30 minutes', now() + interval '150 minutes', 'cancelled', now()),
  ('1e310000-0000-4000-8000-0000000000f9', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Online livre cedo', 'online', null, null, now() + interval '5 days', now() + interval '5 days 2 hours', 'active', null),
  ('1e310000-0000-4000-8000-0000000000fa', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Presencial pago encerrado', 'in_person', 'Sede', 'Rua A, 14', now() + interval '-3 hours', now() + interval '-1 minute', 'active', null),
  ('1e310000-0000-4000-8000-0000000000fb', '1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000a1', 'Presencial pago cedo', 'in_person', 'Sede', 'Rua A, 15', now() + interval '5 days', now() + interval '5 days 2 hours', 'active', null);
insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code, meeting_url) values
  ('1e310000-0000-4000-8000-0000000000f1', '1e310000-0000-4000-8000-000000000001', 'in_person', 'K7QM', null),
  ('1e310000-0000-4000-8000-0000000000f2', '1e310000-0000-4000-8000-000000000001', 'online', 'K7QM', 'https://meet.example.test/tkt'),
  ('1e310000-0000-4000-8000-0000000000f3', '1e310000-0000-4000-8000-000000000001', 'online', 'K7QM', 'https://meet.example.test/tkt'),
  ('1e310000-0000-4000-8000-0000000000f4', '1e310000-0000-4000-8000-000000000001', 'in_person', 'K7QM', null),
  ('1e310000-0000-4000-8000-0000000000f5', '1e310000-0000-4000-8000-000000000001', 'online', 'K7QM', 'https://meet.example.test/tkt'),
  ('1e310000-0000-4000-8000-0000000000f6', '1e310000-0000-4000-8000-000000000001', 'online', 'K7QM', 'https://meet.example.test/tkt'),
  ('1e310000-0000-4000-8000-0000000000f7', '1e310000-0000-4000-8000-000000000001', 'online', 'K7QM', 'https://meet.example.test/tkt'),
  ('1e310000-0000-4000-8000-0000000000f8', '1e310000-0000-4000-8000-000000000001', 'in_person', 'K7QM', null),
  ('1e310000-0000-4000-8000-0000000000f9', '1e310000-0000-4000-8000-000000000001', 'online', 'K7QM', 'https://meet.example.test/tkt'),
  ('1e310000-0000-4000-8000-0000000000fa', '1e310000-0000-4000-8000-000000000001', 'in_person', 'K7QM', null),
  ('1e310000-0000-4000-8000-0000000000fb', '1e310000-0000-4000-8000-000000000001', 'in_person', 'K7QM', null);

-- Presences made BEFORE the link (assumption A6): c2 not_going, c5 a plain Vou, c6 a walk-in, c7 checked in.
select set_config('request.jwt.claims', '', true);
select tests.as_service();
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via) values
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f1', '1e310000-0000-4000-8000-0000000000c2', 'not_going', now(), null, null),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f1', '1e310000-0000-4000-8000-0000000000c5', 'going', now(), null, null),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f1', '1e310000-0000-4000-8000-0000000000c6', 'walk_in', null, now(), 'code'),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f1', '1e310000-0000-4000-8000-0000000000c7', 'checked_in', now(), now(), 'code'),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f2', '1e310000-0000-4000-8000-0000000000c2', 'not_going', now(), null, null),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f2', '1e310000-0000-4000-8000-0000000000c5', 'going', now(), null, null),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f2', '1e310000-0000-4000-8000-0000000000c6', 'walk_in', null, now(), 'online'),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f3', '1e310000-0000-4000-8000-0000000000c5', 'going', now(), null, null),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f9', '1e310000-0000-4000-8000-0000000000c2', 'not_going', now(), null, null);
reset role;
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id) values
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-f1', '1e310000-0000-4000-8000-0000000000f1'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-f2', '1e310000-0000-4000-8000-0000000000f2'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-f3', '1e310000-0000-4000-8000-0000000000f3'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-f6', '1e310000-0000-4000-8000-0000000000f6'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-f7', '1e310000-0000-4000-8000-0000000000f7'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-f8', '1e310000-0000-4000-8000-0000000000f8'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-fa', '1e310000-0000-4000-8000-0000000000fa'),
  ('1e310000-0000-4000-8000-000000000001', 'fake', 'event', 'tkt-233-fb', '1e310000-0000-4000-8000-0000000000fb');
-- The paid path (as the apply job of plan 04 writes it): c3 a ticket, c4 a courtesy.
select tests.as_service();
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f1', '1e310000-0000-4000-8000-0000000000c3', 'going', now(), 'ticket', 'fake', 'ORD-F1-T'),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f2', '1e310000-0000-4000-8000-0000000000c3', 'going', now(), 'ticket', 'fake', 'ORD-F2-T'),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f3', '1e310000-0000-4000-8000-0000000000c3', 'going', now(), 'ticket', 'fake', 'ORD-F3-T');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f1', '1e310000-0000-4000-8000-0000000000c4', 'going', now(), 'courtesy'),
  ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f2', '1e310000-0000-4000-8000-0000000000c4', 'going', now(), 'courtesy');
reset role;

-- The privilege facts are unchanged by the re-creation.
select ok((select prosecdef from pg_proc where oid = 'app.events_enter(uuid)'::regprocedure), 'T-06-43: app.events_enter is still SECURITY DEFINER');
select ok(not has_function_privilege('anon', 'app.events_enter(uuid)', 'execute') and has_function_privilege('authenticated', 'app.events_enter(uuid)', 'execute'), 'T-06-43: ...executable by authenticated and not by anon');
select ok((select prosecdef from pg_proc where oid = 'app.events_check_in(uuid,text)'::regprocedure), 'T-06-29: app.events_check_in is still SECURITY DEFINER');
select ok(not has_function_privilege('anon', 'app.events_check_in(uuid,text)', 'execute') and has_function_privilege('authenticated', 'app.events_check_in(uuid,text)', 'execute'), 'T-06-29: ...executable by authenticated and not by anon');

-- ── the venue-code door (f1) ───────────────────────────────────────────────────────────────────
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c1');
select results_eq($$ select outcome, checked_in_at is null from app.events_check_in('1e310000-0000-4000-8000-0000000000f1', 'ZZZZ') $$,
  $$ values ('ticket_required'::text, true) $$,
  'D-742/T-10.1-06: a non-holder with a WRONG code is ticket_required');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000f1', 'K7QM') $$,
  ARRAY['ticket_required'],
  'D-742: ...and with the CORRECT code too (nothing about the code is learned)');
reset role;
select is((select count(*)::int from public.event_checkin_attempts where event_id = '1e310000-0000-4000-8000-0000000000f1'), 0,
  'T-10.1-06: no guess was counted for the non-holder (the attempts table is unchanged)');
select is((select count(*)::int from public.event_attendances where event_id = '1e310000-0000-4000-8000-0000000000f1' and user_id = '1e310000-0000-4000-8000-0000000000c1'), 0,
  'T-10.1-05: ...and no walk-in row was written');
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c2');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000f1', 'K7QM') $$, ARRAY['ticket_required'],
  'D-742: a not_going row is not a presence: ticket_required');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c5');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000f1', 'ZZZZ') $$, ARRAY['wrong_code'],
  'control: a holder (a Vou made before the link, A6) with a wrong code gets wrong_code');
reset role;
select is((select count(*)::int from public.event_checkin_attempts where event_id = '1e310000-0000-4000-8000-0000000000f1'), 1,
  'control: ...and THAT guess is counted (the counter works; the non-holder''s were not)');
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c3');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000f1', 'K7QM') $$, ARRAY['checked_in'],
  'D-742: a ticket holder with the correct code checks in');
reset role;
select is((select status || '/' || origin || '/' || order_provider || '/' || order_ref from public.event_attendances where event_id = '1e310000-0000-4000-8000-0000000000f1' and user_id = '1e310000-0000-4000-8000-0000000000c3'),
  'checked_in/ticket/fake/ORD-F1-T', 'the check-in never names the origin or the order: the ticket row keeps them');
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c4');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000f1', 'k7-qm') $$, ARRAY['checked_in'],
  'D-742: a courtesy holder checks in');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c5');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000f1', 'K7QM') $$, ARRAY['checked_in'],
  'A6: a Vou made before the link still checks in');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c6');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000f1', 'ZZZZ') $$, ARRAY['already'],
  'A6: a walk-in made before the link is not unmarked: already');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c7');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000f1', 'ZZZZ') $$, ARRAY['already'],
  'A6: a check-in made before the link is not unmarked: already');
reset role;

-- ── the online door (f2, f3) ───────────────────────────────────────────────────────────────────
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c1');
select results_eq($$ select outcome, meeting_url is null from app.events_enter('1e310000-0000-4000-8000-0000000000f2') $$,
  $$ values ('ticket_required'::text, true) $$,
  'D-742/T-10.1-22: a member with no presence gets ticket_required and a NULL URL inside the window (not a walk-in)');
reset role;
select is((select count(*)::int from public.event_attendances where event_id = '1e310000-0000-4000-8000-0000000000f2' and user_id = '1e310000-0000-4000-8000-0000000000c1'), 0,
  'T-10.1-05: ...and no walk-in row was written');
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c2');
select results_eq($$ select outcome, meeting_url is null from app.events_enter('1e310000-0000-4000-8000-0000000000f2') $$,
  $$ values ('ticket_required'::text, true) $$,
  'D-742: a not_going row is not a presence: ticket_required, NULL URL');
reset role;
select is((select status from public.event_attendances where event_id = '1e310000-0000-4000-8000-0000000000f2' and user_id = '1e310000-0000-4000-8000-0000000000c2'), 'not_going',
  '...and the not_going row is untouched');
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c3');
select results_eq($$ select outcome, meeting_url, attendance_status from app.events_enter('1e310000-0000-4000-8000-0000000000f2') $$,
  $$ values ('recorded'::text, 'https://meet.example.test/tkt'::text, 'checked_in'::text) $$,
  'D-742: a ticket holder inside the window is recorded and gets the URL');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c4');
select results_eq($$ select outcome, meeting_url from app.events_enter('1e310000-0000-4000-8000-0000000000f2') $$,
  $$ values ('recorded'::text, 'https://meet.example.test/tkt'::text) $$,
  'D-742: a courtesy holder inside the window is recorded and gets the URL');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c5');
select results_eq($$ select outcome, meeting_url from app.events_enter('1e310000-0000-4000-8000-0000000000f2') $$,
  $$ values ('recorded'::text, 'https://meet.example.test/tkt'::text) $$,
  'A6: a Vou made before the link is recorded and gets the URL');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c6');
select results_eq($$ select outcome, meeting_url from app.events_enter('1e310000-0000-4000-8000-0000000000f2') $$,
  $$ values ('already'::text, 'https://meet.example.test/tkt'::text) $$,
  'A6: a walk-in made before the link still rejoins: already, with the URL');
reset role;
select is((select status || '/' || origin || '/' || order_ref from public.event_attendances where event_id = '1e310000-0000-4000-8000-0000000000f2' and user_id = '1e310000-0000-4000-8000-0000000000c3'),
  'checked_in/ticket/ORD-F2-T', 'the online check-in keeps the ticket row''s origin and order');
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c1');
select results_eq($$ select outcome, meeting_url is null from app.events_enter('1e310000-0000-4000-8000-0000000000f3') $$,
  $$ values ('ticket_required'::text, true) $$,
  'D-742: before the window a non-holder is ticket_required, not confirm_first');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c3');
select results_eq($$ select outcome, meeting_url from app.events_enter('1e310000-0000-4000-8000-0000000000f3') $$,
  $$ values ('forward'::text, 'https://meet.example.test/tkt'::text) $$,
  'D-742: before the window a ticket holder is forwarded with the URL and nothing is recorded');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c5');
select results_eq($$ select outcome, meeting_url from app.events_enter('1e310000-0000-4000-8000-0000000000f3') $$,
  $$ values ('forward'::text, 'https://meet.example.test/tkt'::text) $$,
  'A6: before the window a Vou made before the link is forwarded with the URL');
reset role;

-- ── free events: byte-identical to today ───────────────────────────────────────────────────────
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c1');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000f4', 'K7QM') $$, ARRAY['walk_in'],
  'D-742: a FREE in-person event still records a walk-in on the right code');
select results_eq($$ select outcome, meeting_url from app.events_enter('1e310000-0000-4000-8000-0000000000f5') $$,
  $$ values ('recorded'::text, 'https://meet.example.test/tkt'::text) $$,
  'D-742: a FREE online event still records a walk-in and gives the URL');
reset role;
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c2');
select results_eq($$ select outcome, meeting_url is null from app.events_enter('1e310000-0000-4000-8000-0000000000f9') $$,
  $$ values ('confirm_first'::text, true) $$,
  'D-742: a FREE online event before the window is still confirm_first');
reset role;

-- ── the old outcomes still win, in a mapped event ──────────────────────────────────────────────
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c1');
select results_eq($$ select outcome from app.events_enter('1e310000-0000-4000-8000-0000000000f6') $$, ARRAY['cancelled'], 'a cancelled mapped online event is still cancelled (before ticket_required)');
select results_eq($$ select outcome from app.events_enter('1e310000-0000-4000-8000-0000000000f7') $$, ARRAY['ended'], 'an ended mapped online event is still ended');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000f8', 'K7QM') $$, ARRAY['cancelled'], 'a cancelled mapped in-person event is still cancelled');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000fa', 'K7QM') $$, ARRAY['closed'], 'an ended mapped in-person event is still closed');
select results_eq($$ select outcome from app.events_check_in('1e310000-0000-4000-8000-0000000000fb', 'K7QM') $$, ARRAY['not_open'], 'a mapped in-person event before the window is still not_open');
reset role;

-- ── T-10.1-05: the backstop beside the definer outcomes ────────────────────────────────────────
select tests.as_tenant('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000c8');
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, checked_in_at, checkin_via) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f1', '1e310000-0000-4000-8000-0000000000c8', 'walk_in', now(), 'code') $$,
  '23514', 'payment_required', 'T-10.1-05: a direct walk_in insert by a member in a mapped event is payment_required');
reset role;
select tests.as_service();
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, checked_in_at, checkin_via) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f1', '1e310000-0000-4000-8000-0000000000c8', 'walk_in', now(), 'code') $$,
  '23514', 'payment_required', 'T-10.1-05: ...and by the service lane (step 6b, the last line)');
select lives_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, checked_in_at, checkin_via) values ('1e310000-0000-4000-8000-000000000001', '1e310000-0000-4000-8000-0000000000f4', '1e310000-0000-4000-8000-0000000000c8', 'walk_in', now(), 'code') $$,
  'control: the same walk_in in a free event is accepted');
reset role;

-- ── 4. gateway (plan 04, task 1: `*_event_gateway_grant_revoke.sql`) ───────────────────────────
-- `app.event_gateway_grant` and `app.event_gateway_revoke`, called as the service role (no claims) with the
-- tenant, the membership, the event and the order passed as arguments (D-509). Every business outcome is a
-- RETURNED value. Ids are built by `tests.tk('<hex>')`: users 1xx, memberships 2xx, events 3xx, all in the
-- `1e310000-…` family. tk('1') is tenant A and tk('2') is tenant B.
create function tests.tk(n text) returns uuid language sql immutable as
  $$ select ('1e310000-0000-4000-8000-' || lpad(n, 12, '0'))::uuid $$;

select tests.auth_user('g' || h || '@tkt-4.local', tests.tk('1' || h))
  from unnest(array['01','02','03','04','05','06','07','08','09','0a','0b','0c','0d','0e']) as h;
update auth.users set email_confirmed_at = null where id = tests.tk('10b');
insert into public.memberships (id, tenant_id, user_id, role, status, blocked_at, deleted_at) values
  (tests.tk('201'), tests.tk('1'), tests.tk('101'), 'member', 'active', null, null),
  (tests.tk('202'), tests.tk('1'), tests.tk('102'), 'member', 'active', null, null),
  (tests.tk('203'), tests.tk('1'), tests.tk('103'), 'member', 'active', null, null),
  (tests.tk('204'), tests.tk('1'), tests.tk('104'), 'member', 'active', null, null),
  (tests.tk('205'), tests.tk('1'), tests.tk('105'), 'member', 'active', null, null),
  (tests.tk('206'), tests.tk('1'), tests.tk('106'), 'member', 'active', null, null),
  (tests.tk('207'), tests.tk('1'), tests.tk('107'), 'member', 'active', null, null),
  (tests.tk('208'), tests.tk('1'), tests.tk('108'), 'member', 'active', null, null),
  (tests.tk('209'), tests.tk('1'), tests.tk('109'), 'member', 'blocked', now(), null),
  (tests.tk('20a'), tests.tk('1'), tests.tk('10a'), 'member', 'active', null, now()),
  (tests.tk('20b'), tests.tk('1'), tests.tk('10b'), 'member', 'active', null, null),
  (tests.tk('20c'), tests.tk('1'), tests.tk('10c'), 'admin_tenant', 'active', null, null),
  (tests.tk('20d'), tests.tk('2'), tests.tk('10d'), 'member', 'active', null, null),
  (tests.tk('20e'), tests.tk('2'), tests.tk('10e'), 'admin_tenant', 'active', null, null);

-- Events of tenant A (301 live and unlimited | 302 limit 1 | 303 started, inside the check-in window | 304 ended |
-- 305 cancelled | 306 soft-deleted | 307 free | 309 live, rows made BEFORE the link | 30b started, a walk-in
-- made before the link | 30c and 30d live, cancelled / deleted after the sale | 30e live, a Vou and a courtesy
-- made before the link) and of tenant B (308).
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, capacity, status, cancelled_at, deleted_at) values
  (tests.tk('301'), tests.tk('1'), tests.tk('10c'), 'Evento 301', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, 'active', null, null),
  (tests.tk('302'), tests.tk('1'), tests.tk('10c'), 'Evento 302', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', 1, 'active', null, null),
  (tests.tk('303'), tests.tk('1'), tests.tk('10c'), 'Evento 303', 'in_person', 'Sede', 'Rua 1', now() + interval '-1 hour', now() + interval '2 hours', null, 'active', null, null),
  (tests.tk('304'), tests.tk('1'), tests.tk('10c'), 'Evento 304', 'in_person', 'Sede', 'Rua 1', now() + interval '-3 hours', now() + interval '-1 hour', null, 'active', null, null),
  (tests.tk('305'), tests.tk('1'), tests.tk('10c'), 'Evento 305', 'in_person', 'Sede', 'Rua 1', now() + interval '5 days', now() + interval '5 days 2 hours', null, 'cancelled', now(), null),
  (tests.tk('306'), tests.tk('1'), tests.tk('10c'), 'Evento 306', 'in_person', 'Sede', 'Rua 1', now() + interval '5 days', now() + interval '5 days 2 hours', null, 'active', null, now()),
  (tests.tk('307'), tests.tk('1'), tests.tk('10c'), 'Evento 307', 'in_person', 'Sede', 'Rua 1', now() + interval '5 days', now() + interval '5 days 2 hours', null, 'active', null, null),
  (tests.tk('308'), tests.tk('2'), tests.tk('10e'), 'Evento 308', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, 'active', null, null),
  (tests.tk('309'), tests.tk('1'), tests.tk('10c'), 'Evento 309', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, 'active', null, null),
  (tests.tk('30b'), tests.tk('1'), tests.tk('10c'), 'Evento 30b', 'in_person', 'Sede', 'Rua 1', now() + interval '-1 hour', now() + interval '2 hours', null, 'active', null, null),
  (tests.tk('30c'), tests.tk('1'), tests.tk('10c'), 'Evento 30c', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, 'active', null, null),
  (tests.tk('30d'), tests.tk('1'), tests.tk('10c'), 'Evento 30d', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, 'active', null, null),
  (tests.tk('30e'), tests.tk('1'), tests.tk('10c'), 'Evento 30e', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, 'active', null, null);

-- Presences made BEFORE the link (the event is still free, so the guard lets them in).
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values
  (tests.tk('1'), tests.tk('309'), tests.tk('103'), 'going', now(), 'rsvp'),
  (tests.tk('1'), tests.tk('309'), tests.tk('104'), 'going', now(), 'courtesy'),
  (tests.tk('1'), tests.tk('309'), tests.tk('105'), 'not_going', now(), 'rsvp'),
  (tests.tk('1'), tests.tk('30e'), tests.tk('101'), 'going', now(), 'rsvp'),
  (tests.tk('1'), tests.tk('30e'), tests.tk('102'), 'going', now(), 'courtesy');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via, origin) values
  (tests.tk('1'), tests.tk('303'), tests.tk('106'), 'checked_in', now(), now(), 'code', 'rsvp');
insert into public.event_attendances (tenant_id, event_id, user_id, status, checked_in_at, checkin_via, origin) values
  (tests.tk('1'), tests.tk('303'), tests.tk('107'), 'walk_in', now(), 'online', 'rsvp');

-- The links (the sale reaches the apply job only through them). 307 stays free.
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id)
  select tests.tk('1'), 'fake', 'event', 'tkt-233-s4-' || h, tests.tk(h)
    from unnest(array['301','302','303','304','305','306','309','30b','30c','30d','30e']) as h;
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id) values
  (tests.tk('2'), 'fake', 'event', 'tkt-233-s4-308', tests.tk('308'));

select set_config('request.jwt.claims', '', true);
select tests.as_service();

-- ── the tracer: an approved purchase confirms one presence, a replay changes nothing, a refund frees the seat
select results_eq(
  $$ select outcome, user_id, event_title, over_limit from app.event_gateway_grant(tests.tk('1'), tests.tk('201'), tests.tk('301'), 'fake', 'S4-ORD-1') $$,
  $$ values ('granted'::text, tests.tk('101'), 'Evento 301'::text, false) $$,
  'D-752: an approved purchase is granted, with the member''s user id, the event title and over_limit false');
reset role;
select is(
  (select status || '/' || origin || '/' || order_provider || '/' || order_ref || '/' || (responded_at is not null)::text
     from public.event_attendances where event_id = tests.tk('301') and user_id = tests.tk('101')),
  'going/ticket/fake/S4-ORD-1/true',
  'D-752: ...and the row is going, origin ticket, with the provider, the reference and responded_at');
select tests.as_service();
select results_eq(
  $$ select outcome, user_id from app.event_gateway_grant(tests.tk('1'), tests.tk('201'), tests.tk('301'), 'fake', 'S4-ORD-1') $$,
  $$ values ('already_in'::text, tests.tk('101')) $$,
  'EP-20: the same order again is already_in');
reset role;
select is((select count(*)::int from public.event_attendances where event_id = tests.tk('301')), 1,
  'EP-20: ...and there is still exactly one row');
select tests.as_service();
select results_eq(
  $$ select outcome, user_id, event_id from app.event_gateway_revoke(tests.tk('1'), 'fake', 'S4-ORD-1') $$,
  $$ values ('removed'::text, tests.tk('101'), tests.tk('301')) $$,
  'D-760: a refund by the reference alone removes the presence and names the member and the event');
reset role;
select is((select count(*)::int from public.event_attendances where event_id = tests.tk('301')), 0,
  'D-760: ...and the seat is free');
select tests.as_service();
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('201'), tests.tk('301'), 'fake', 'S4-ORD-1') $$,
  $$ values ('granted'::text) $$,
  'after a refund the same reference can be sold again (the seat was freed)');

-- ── arguments: nothing written, never raised (EP-37, EP-38)
select is(
  (select string_agg(o, ',' order by n) from (values
     (1, (select outcome from app.event_gateway_grant(null, tests.tk('202'), tests.tk('301'), 'fake', 'S4-X'))),
     (2, (select outcome from app.event_gateway_grant(tests.tk('1'), null, tests.tk('301'), 'fake', 'S4-X'))),
     (3, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), null, 'fake', 'S4-X'))),
     (4, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), null, 'S4-X'))),
     (5, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'fake', null)))
   ) v(n, o)),
  'not_found,not_found,not_found,not_found,not_found',
  'EP-37: a null tenant, membership, event, provider or reference is not_found');
select is(
  (select string_agg(o, ',' order by n) from (values
     (1, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'fake', ''))),
     (2, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'fake', '   '))),
     (3, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'fake', E' \t\r\n')))
   ) v(n, o)),
  'not_found,not_found,not_found',
  'EP-37: an empty or whitespace-only reference is not_found');
select is(
  (select string_agg(o, ',' order by n) from (values
     (1, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'fake', E'S4-\x01X'))),
     (2, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'fake', repeat('x', 201)))),
     (3, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'Fake', 'S4-X'))),
     (4, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'my fake', 'S4-X'))),
     (5, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'f', 'S4-X'))),
     (6, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'fake', E'S4-\nX')))
   ) v(n, o)),
  'not_found,not_found,not_found,not_found,not_found,not_found',
  'EP-38: a control character, 201 characters, an uppercase or spaced or one-letter provider are each not_found');
reset role;
select is((select count(*)::int from public.event_attendances where event_id = tests.tk('301')), 1,
  'EP-37/EP-38: ...and not one of them wrote a row (the only row of event 301 is the re-sold one)');
select tests.as_service();
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('301'), 'fake', '  Pedido-ção 7 ') $$,
  $$ values ('granted'::text) $$,
  'EP-38: a reference with accents and surrounding spaces is granted');
reset role;
select is((select order_ref from public.event_attendances where event_id = tests.tk('301') and user_id = tests.tk('102')),
  'Pedido-ção 7', 'EP-38: ...and stored trimmed');
select tests.as_service();

-- ── the membership must be live in THIS tenant
select is(
  (select string_agg(o, ',' order by n) from (values
     (1, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('20d'), tests.tk('301'), 'fake', 'S4-M1'))),
     (2, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('209'), tests.tk('301'), 'fake', 'S4-M2'))),
     (3, (select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('20a'), tests.tk('301'), 'fake', 'S4-M3'))),
     (4, (select outcome from app.event_gateway_grant(tests.tk('1'), gen_random_uuid(), tests.tk('301'), 'fake', 'S4-M4')))
   ) v(n, o)),
  'not_found,not_found,not_found,not_found',
  'D-509: a membership of another tenant, a blocked one, a deleted one and an unknown one are not_found');

-- ── D-759: an unconfirmed e-mail is never confirmed by the webhook
select results_eq(
  $$ select outcome, user_id from app.event_gateway_grant(tests.tk('1'), tests.tk('20b'), tests.tk('301'), 'fake', 'S4-UNC') $$,
  $$ values ('unconfirmed'::text, null::uuid) $$,
  'D-759/T-10.1-10: a member with an unconfirmed e-mail is unconfirmed (the delivery stays without an account)');
reset role;
select is((select count(*)::int from public.event_attendances where user_id = tests.tk('10b')), 0,
  'D-759: ...and nothing was written');
select tests.as_service();
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('20b'), tests.tk('301'), 'fake', 'S4-UNC', true) $$,
  $$ values ('granted'::text) $$,
  'D-759: the admin''s deliberate manual release (sixth argument true) confirms the same member');

-- ── the event's state
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('203'), tests.tk('305'), 'fake', 'S4-CAN') $$,
  $$ values ('event_cancelled'::text) $$, 'D-760: a cancelled event answers event_cancelled');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('203'), tests.tk('306'), 'fake', 'S4-DEL') $$,
  $$ values ('event_cancelled'::text) $$, 'D-760: a soft-deleted event answers event_cancelled');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('203'), tests.tk('304'), 'fake', 'S4-END') $$,
  $$ values ('event_ended'::text) $$, 'D-750: an event that has ended answers event_ended');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('203'), tests.tk('307'), 'fake', 'S4-FREE') $$,
  $$ values ('not_mapped'::text) $$, 'D-752: an event with no mapping answers not_mapped');
reset role;
select is((select count(*)::int from public.event_attendances where event_id in (tests.tk('304'), tests.tk('305'), tests.tk('306'), tests.tk('307'))), 0,
  'D-760/D-750: ...and none of those four wrote a row');
select tests.as_service();

-- ── D-750 and D-751: after the start, and over the limit, a sale still confirms
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('204'), tests.tk('303'), 'fake', 'S4-STARTED') $$,
  $$ values ('granted'::text) $$, 'D-750: a payment approved after the start still confirms');
select results_eq(
  $$ select outcome, over_limit from app.event_gateway_grant(tests.tk('1'), tests.tk('201'), tests.tk('302'), 'fake', 'S4-FULL-1') $$,
  $$ values ('granted'::text, false) $$, 'D-751: the first sale of a one-seat event is not over the limit');
select results_eq(
  $$ select outcome, over_limit from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('302'), 'fake', 'S4-FULL-2') $$,
  $$ values ('granted'::text, true) $$, 'D-751: a sale at a full event confirms and over_limit is true');
reset role;
select is((select count(*)::int from public.event_attendances where event_id = tests.tk('302') and status = 'going' and origin = 'ticket'), 2,
  'D-751: ...both tickets of the one-seat event are confirmed');
select tests.as_service();

-- ── upgrades: a presence made before the link takes the ticket and keeps its status (A10b)
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('203'), tests.tk('309'), 'fake', 'S4-UP-RSVP') $$,
  $$ values ('granted'::text) $$, 'A10b: a Vou made before the link is granted a ticket');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('204'), tests.tk('309'), 'fake', 'S4-UP-COURT') $$,
  $$ values ('granted'::text) $$, 'D-753: a courtesy made before the sale is granted a ticket');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('205'), tests.tk('309'), 'fake', 'S4-UP-NOT') $$,
  $$ values ('granted'::text) $$, 'D-752: a member who had said Não vou becomes going with a ticket');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('206'), tests.tk('303'), 'fake', 'S4-UP-CHK') $$,
  $$ values ('granted'::text) $$, 'D-752: a checked-in member of the event is granted a ticket');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('207'), tests.tk('303'), 'fake', 'S4-UP-WALK') $$,
  $$ values ('granted'::text) $$, 'D-752: a walk-in of the event is granted a ticket');
reset role;
select results_eq(
  $$ select user_id, status, origin, order_ref, (refunded_at is null) from public.event_attendances
      where event_id in (tests.tk('309'), tests.tk('303')) and origin = 'ticket' and order_ref like 'S4-UP-%' order by order_ref $$,
  $$ values (tests.tk('106'), 'checked_in'::text, 'ticket'::text, 'S4-UP-CHK'::text, true),
            (tests.tk('104'), 'going'::text, 'ticket'::text, 'S4-UP-COURT'::text, true),
            (tests.tk('105'), 'going'::text, 'ticket'::text, 'S4-UP-NOT'::text, true),
            (tests.tk('103'), 'going'::text, 'ticket'::text, 'S4-UP-RSVP'::text, true),
            (tests.tk('107'), 'walk_in'::text, 'ticket'::text, 'S4-UP-WALK'::text, true) $$,
  'A10b: the five upgraded rows carry origin ticket and the order; a checked-in or walk-in row keeps its status');
select is((select count(*)::int from public.event_attendances where event_id = tests.tk('309')), 3,
  'A10b: ...and no event got a second row for a member');
select tests.as_service();

-- ── A10: one presence per member; one order is one presence (EP-20, EP-36)
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('201'), tests.tk('301'), 'fake', 'S4-ORD-2') $$,
  $$ values ('already_in'::text) $$, 'A10: a second order by a member who already holds a ticket is already_in');
reset role;
select is((select order_ref from public.event_attendances where event_id = tests.tk('301') and user_id = tests.tk('101')), 'S4-ORD-1',
  'A10: ...and the row keeps its first order');
select tests.as_service();
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('20d'), tests.tk('301'), 'fake', 'S4-SAME') $$,
  $$ values ('not_found'::text) $$, 'control: tenant B''s member is not a member of tenant A');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('2'), tests.tk('20d'), tests.tk('308'), 'fake', 'S4-SAME') $$,
  $$ values ('granted'::text) $$, 'EP-36: the reference S4-SAME is granted in tenant B...');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('203'), tests.tk('301'), 'fake', 'S4-SAME') $$,
  $$ values ('granted'::text) $$, 'EP-36: ...and the same reference in tenant A is a different presence');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('204'), tests.tk('301'), 'fake', ' S4-SAME ') $$,
  $$ values ('already_in'::text) $$, 'EP-36: the same reference twice in one tenant is already_in (the trimmed reference collides)');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('204'), tests.tk('301'), 'fake', 'S4-same') $$,
  $$ values ('granted'::text) $$, 'EP-36: a reference differing only by case is a different reference (compared exactly)');
reset role;
select is((select count(*)::int from public.event_attendances where order_ref = 'S4-SAME'), 2,
  'EP-36: ...so S4-SAME names exactly two rows, one per tenant');
select tests.as_service();
select throws_ok(
  $$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values (tests.tk('1'), tests.tk('301'), tests.tk('105'), 'going', now(), 'ticket', 'fake', 'S4-SAME') $$,
  '23505', null, 'EP-36: the table itself refuses the same reference twice in one tenant (the definer answers before it can collide)');

-- ── revoke: D-760 and T-10.1-09
select results_eq(
  $$ select outcome, user_id, event_id from app.event_gateway_revoke(tests.tk('1'), 'fake', 'S4-UP-CHK') $$,
  $$ values ('kept'::text, tests.tk('106'), tests.tk('303')) $$,
  'D-760: a refund of a checked-in presence is kept');
reset role;
select is(
  (select status || '/' || (refunded_at is not null)::text || '/' || (checked_in_at is not null)::text
     from public.event_attendances where event_id = tests.tk('303') and user_id = tests.tk('106')),
  'checked_in/true/true', 'D-760: ...the row is still there, still checked in, and refunded_at is stamped');
select tests.as_service();
select results_eq(
  $$ select outcome from app.event_gateway_revoke(tests.tk('1'), 'fake', 'S4-UP-CHK') $$,
  $$ values ('kept'::text) $$, 'D-760: a repeated refund of a checked-in presence is still kept');
select results_eq(
  $$ select outcome from app.event_gateway_revoke(tests.tk('1'), 'fake', ' S4-UP-WALK ') $$,
  $$ values ('kept'::text) $$, 'D-760: the revoke trims the reference too (a walk-in ticket is kept)');
select results_eq(
  $$ select outcome from app.event_gateway_revoke(tests.tk('1'), 'fake', 'S4-UP-RSVP') $$,
  $$ values ('removed'::text) $$, 'A10b: a refund removes the presence an upgrade turned into a ticket');

select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('208'), tests.tk('30c'), 'fake', 'S4-CXL') $$,
  $$ values ('granted'::text) $$, 'fixture: a ticket is sold for the event that is cancelled next');
select results_eq(
  $$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('201'), tests.tk('30d'), 'fake', 'S4-DEL2') $$,
  $$ values ('granted'::text) $$, 'fixture: a ticket is sold for the event that is soft-deleted next');
reset role;
update public.events set status = 'cancelled', cancelled_at = now() where id = tests.tk('30c');
update public.events set deleted_at = now() where id = tests.tk('30d');
select tests.as_service();
select results_eq(
  $$ select outcome, event_id from app.event_gateway_revoke(tests.tk('1'), 'fake', 'S4-CXL') $$,
  $$ values ('removed'::text, tests.tk('30c')) $$, 'D-760: a refund on a CANCELLED event removes the presence (no status filter)');
select results_eq(
  $$ select outcome, event_id from app.event_gateway_revoke(tests.tk('1'), 'fake', 'S4-DEL2') $$,
  $$ values ('removed'::text, tests.tk('30d')) $$, 'D-760: a refund on a SOFT-DELETED event removes the presence (no deleted_at filter)');

-- T-10.1-09: a refund can only touch the row that carries its order.
select results_eq(
  $$ select outcome, user_id, event_id from app.event_gateway_revoke(tests.tk('1'), 'fake', 'S4-NEVER-SOLD') $$,
  $$ values ('not_found'::text, null::uuid, null::uuid) $$, 'EP-37: a refund of an unknown reference is not_found');
select is(
  (select string_agg(o, ',' order by n) from (values
     (1, (select outcome from app.event_gateway_revoke(null, 'fake', 'S4-ORD-1'))),
     (2, (select outcome from app.event_gateway_revoke(tests.tk('1'), null, 'S4-ORD-1'))),
     (3, (select outcome from app.event_gateway_revoke(tests.tk('1'), 'fake', null))),
     (4, (select outcome from app.event_gateway_revoke(tests.tk('1'), 'fake', '   '))),
     (5, (select outcome from app.event_gateway_revoke(tests.tk('1'), 'Fake', 'S4-ORD-1'))),
     (6, (select outcome from app.event_gateway_revoke(tests.tk('1'), 'fake', repeat('x', 201)))),
     (7, (select outcome from app.event_gateway_revoke(tests.tk('1'), 'fake', E'S4-\x02')))
   ) v(n, o)),
  'not_found,not_found,not_found,not_found,not_found,not_found,not_found',
  'EP-37/EP-38: a null, blank, over-long, control-character reference or a malformed provider is not_found');
select results_eq(
  $$ select outcome from app.event_gateway_revoke(tests.tk('1'), 'fake', 'S4-ORD-1') $$,
  $$ values ('removed'::text) $$, 'control: a real reference is removed (so the not_found cases above were refusals, not misses)');
reset role;
select is((select string_agg(user_id::text || ':' || origin || ':' || status, ',' order by user_id::text) from public.event_attendances where event_id = tests.tk('30e')),
  tests.tk('101')::text || ':rsvp:going,' || tests.tk('102')::text || ':courtesy:going',
  'T-10.1-09: the Vou and the courtesy made before the link were never touched by any refund above');

-- ── 5. courtesy, lock, reset and holders (plan 04, task 2: `*_event_courtesy_definers.sql`) ───────────
-- The admin's side of a paid event. Every function checks the `admin_tenant` claim INSIDE itself (T-10.1-12),
-- is pinned to the claim tenant (T-10.1-01) and RETURNS its outcomes. Events 401 live and unlimited | 402 limit
-- one | 403 started | 404 ended | 405 cancelled | 406 free | 407 live (lock, reset, holders) of tenant A, and 408
-- (tenant B, section 4). Users and memberships are those of section 4. The `payments` module of tenant A is OFF
-- since section 2 and stays off: none of this depends on it (D-743).
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, capacity, status, cancelled_at) values
  (tests.tk('401'), tests.tk('1'), tests.tk('10c'), 'Evento 401', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, 'active', null),
  (tests.tk('402'), tests.tk('1'), tests.tk('10c'), 'Evento 402', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', 1, 'active', null),
  (tests.tk('403'), tests.tk('1'), tests.tk('10c'), 'Evento 403', 'in_person', 'Sede', 'Rua 1', now() + interval '-1 hour', now() + interval '2 hours', null, 'active', null),
  (tests.tk('404'), tests.tk('1'), tests.tk('10c'), 'Evento 404', 'in_person', 'Sede', 'Rua 1', now() + interval '-3 hours', now() + interval '-1 hour', null, 'active', null),
  (tests.tk('405'), tests.tk('1'), tests.tk('10c'), 'Evento 405', 'in_person', 'Sede', 'Rua 1', now() + interval '5 days', now() + interval '5 days 2 hours', null, 'cancelled', now()),
  (tests.tk('406'), tests.tk('1'), tests.tk('10c'), 'Evento 406', 'in_person', 'Sede', 'Rua 1', now() + interval '5 days', now() + interval '5 days 2 hours', null, 'active', null),
  (tests.tk('407'), tests.tk('1'), tests.tk('10c'), 'Evento 407', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, 'active', null);
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id)
  select tests.tk('1'), 'fake', 'event', 'tkt-233-s5-' || h, tests.tk(h)
    from unnest(array['401','402','403','404','405','407']) as h;
-- A Vou-less member of 401 (not_going) and a checked-in member of 403, both made before the courtesy.
select tests.as_service();
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at) values
  (tests.tk('1'), tests.tk('401'), tests.tk('104'), 'not_going', now());
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via) values
  (tests.tk('1'), tests.tk('403'), tests.tk('103'), 'checked_in', now(), now(), 'code');
reset role;
select is((select enabled from public.tenant_modules where tenant_id = tests.tk('1') and module_key = 'payments'), false,
  'D-743: the payments module of tenant A is off for the whole of section 5');

-- ── courtesy grant
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('401'), tests.tk('201')) $$, $$ values ('granted'::text) $$,
  'D-743: the admin releases a courtesy (with the payments module off)');
reset role;
select is((select status || '/' || origin || '/' || (order_provider is null)::text || '/' || (order_ref is null)::text || '/' || (responded_at is not null)::text
             from public.event_attendances where event_id = tests.tk('401') and user_id = tests.tk('101')),
  'going/courtesy/true/true/true', 'D-743: ...the row is going, origin courtesy, with no order columns and responded_at');
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('401'), tests.tk('201')) $$, $$ values ('already_in'::text) $$,
  'EP-20: the same courtesy again is already_in');
reset role;
select is((select count(*)::int || '/' || min(status) from public.event_attendances where event_id = tests.tk('401') and user_id = tests.tk('101')), '1/going',
  'EP-20: ...one row, the status unchanged');
select tests.as_tenant(tests.tk('1'), tests.tk('101'));
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('401'), tests.tk('202')) $$, $$ values ('forbidden'::text) $$,
  'T-10.1-12: a member cannot release a courtesy');
reset role;
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'support_tenant');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('401'), tests.tk('202')) $$, $$ values ('forbidden'::text) $$,
  'T-10.1-12: ...nor can support_tenant');
reset role;
select tests.as_tenant_without_claims();
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('401'), tests.tk('202')) $$, $$ values ('not_found'::text) $$,
  'T-10.1-12: ...and a session with no claims has no lane');
reset role;
select is((select count(*)::int from public.event_attendances where event_id = tests.tk('401') and user_id = tests.tk('102')), 0,
  'T-10.1-12: ...none of the three wrote a row');

-- Who can receive one, and where.
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select is(
  (select string_agg(o, ',' order by n) from (values
     (1, (select outcome from app.event_courtesy_grant(tests.tk('401'), tests.tk('20d')))),
     (2, (select outcome from app.event_courtesy_grant(tests.tk('401'), tests.tk('209')))),
     (3, (select outcome from app.event_courtesy_grant(tests.tk('401'), tests.tk('20a')))),
     (4, (select outcome from app.event_courtesy_grant(tests.tk('401'), gen_random_uuid()))),
     (5, (select outcome from app.event_courtesy_grant(tests.tk('401'), null))),
     (6, (select outcome from app.event_courtesy_grant(null, tests.tk('202')))),
     (7, (select outcome from app.event_courtesy_grant(tests.tk('408'), tests.tk('202')))),
     (8, (select outcome from app.event_courtesy_grant(gen_random_uuid(), tests.tk('202'))))
   ) v(n, o)),
  'not_found,not_found,not_found,not_found,not_found,not_found,not_found,not_found',
  'D-743/EP-39: another tenant''s, a blocked, a deleted and an unknown membership, null arguments, tenant B''s event and an unknown event are all not_found');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('406'), tests.tk('202')) $$, $$ values ('not_paid'::text) $$,
  'D-743: an event with no mapping answers not_paid');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('405'), tests.tk('202')) $$, $$ values ('event_cancelled'::text) $$,
  'D-743: a cancelled event answers event_cancelled');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('404'), tests.tk('202')) $$, $$ values ('event_ended'::text) $$,
  'D-750: an ended event answers event_ended');
reset role;
select is((select count(*)::int from public.event_attendances where event_id in (tests.tk('406'), tests.tk('405'), tests.tk('404')) or (event_id = tests.tk('401') and user_id in (tests.tk('102'), tests.tk('10d'), tests.tk('109'), tests.tk('10a')))), 0,
  'D-743: ...and none of those wrote a row');

-- Capacity and the start do not stop a courtesy (A-UI-5, D-750, D-751).
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('402'), tests.tk('201')) $$, $$ values ('granted'::text) $$, 'D-751: the first courtesy of a one-seat event');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('402'), tests.tk('202')) $$, $$ values ('granted'::text) $$, 'A-UI-5: a second courtesy of the one-seat event is granted over the limit');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('403'), tests.tk('201')) $$, $$ values ('granted'::text) $$, 'D-750: a courtesy after the start is granted');
reset role;
select is((select count(*)::int from public.event_attendances where event_id = tests.tk('402') and status = 'going' and origin = 'courtesy'), 2,
  'A-UI-5: ...both courtesies of the one-seat event are confirmed');

-- An existing presence is never rewritten; a not_going answer is given a seat.
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('403'), tests.tk('203')) $$, $$ values ('already_in'::text) $$, 'D-743: a checked-in member is already_in');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('401'), tests.tk('204')) $$, $$ values ('granted'::text) $$, 'D-743: a member who had said Não vou is granted a courtesy');
reset role;
select is((select status || '/' || origin from public.event_attendances where event_id = tests.tk('403') and user_id = tests.tk('103')), 'checked_in/rsvp',
  'D-743: ...the checked-in row is untouched');
select is((select status || '/' || origin || '/' || (order_ref is null)::text from public.event_attendances where event_id = tests.tk('401') and user_id = tests.tk('104')), 'going/courtesy/true',
  'D-743: ...and the Não vou row is now a going courtesy');
select tests.as_service();
select results_eq($$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('401'), 'fake', 'S5-T1') $$, $$ values ('granted'::text) $$, 'fixture: member 102 buys a ticket for event 401');
reset role;
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('401'), tests.tk('202')) $$, $$ values ('already_in'::text) $$, 'EP-20: a courtesy for a ticket holder is already_in');
reset role;
select is((select origin || '/' || order_ref from public.event_attendances where event_id = tests.tk('401') and user_id = tests.tk('102')), 'ticket/S5-T1',
  'EP-20: ...and the ticket keeps its origin and its order');

-- ── courtesy remove
select set_config('tk.court', (select id::text from public.event_attendances where event_id = tests.tk('401') and user_id = tests.tk('101')), true);
select set_config('tk.ticket', (select id::text from public.event_attendances where event_id = tests.tk('401') and user_id = tests.tk('102')), true);
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('403'), tests.tk('207')) $$, $$ values ('granted'::text) $$, 'fixture: a courtesy for member 107 in the started event 403');
reset role;
select tests.as_service();
update public.event_attendances set status = 'checked_in', checked_in_at = now(), checkin_via = 'code' where event_id = tests.tk('403') and user_id = tests.tk('107');
reset role;
select set_config('tk.court_in', (select id::text from public.event_attendances where event_id = tests.tk('403') and user_id = tests.tk('107')), true);
select tests.as_tenant(tests.tk('1'), tests.tk('101'));
select results_eq($$ select outcome from app.event_courtesy_remove(tests.tk('401'), current_setting('tk.court')::uuid) $$, $$ values ('forbidden'::text) $$,
  'T-10.1-12: a member cannot remove a courtesy');
reset role;
select tests.as_tenant(tests.tk('2'), tests.tk('10e'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_remove(tests.tk('401'), current_setting('tk.court')::uuid) $$, $$ values ('not_found'::text) $$,
  'EP-39: tenant B''s admin cannot remove tenant A''s courtesy (not_found)');
reset role;
select is((select count(*)::int from public.event_attendances where id = current_setting('tk.court')::uuid), 1, 'EP-39: ...the courtesy is still there');
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_remove(tests.tk('401'), current_setting('tk.ticket')::uuid) $$, $$ values ('not_courtesy'::text) $$,
  'D-743: a paid presence is never removable by hand (not_courtesy)');
select results_eq($$ select outcome from app.event_courtesy_remove(tests.tk('403'), current_setting('tk.court_in')::uuid) $$, $$ values ('locked'::text) $$,
  'D-743: a courtesy that already checked in is locked');
select is(
  (select string_agg(o, ',' order by n) from (values
     (1, (select outcome from app.event_courtesy_remove(tests.tk('401'), gen_random_uuid()))),
     (2, (select outcome from app.event_courtesy_remove(tests.tk('401'), null))),
     (3, (select outcome from app.event_courtesy_remove(null, current_setting('tk.court')::uuid)))
   ) v(n, o)),
  'not_found,not_found,not_found', 'D-743: an unknown row, a null row and a null event are not_found');
reset role;
select is((select count(*)::int from public.event_attendances where id in (current_setting('tk.ticket')::uuid, current_setting('tk.court_in')::uuid)), 2,
  'D-743: ...and the paid and the checked-in rows are still there');
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_remove(tests.tk('401'), current_setting('tk.court')::uuid) $$, $$ values ('removed'::text) $$,
  'D-743: the admin removes a courtesy that has not checked in');
reset role;
select is((select count(*)::int from public.event_attendances where id = current_setting('tk.court')::uuid), 0, 'D-743: ...and the row is gone');

-- ── lock (D-747)
select tests.as_service();
select results_eq($$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('201'), tests.tk('407'), 'fake', 'S5-L1') $$, $$ values ('granted'::text) $$, 'fixture: ticket 1 of event 407');
select results_eq($$ select outcome from app.event_gateway_grant(tests.tk('1'), tests.tk('202'), tests.tk('407'), 'fake', 'S5-L2') $$, $$ values ('granted'::text) $$, 'fixture: ticket 2 of event 407');
reset role;
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.tk('407'), tests.tk('203')) $$, $$ values ('granted'::text) $$, 'fixture: a courtesy for member 103 in event 407');
select results_eq($$ select found, sold from app.event_ticket_lock(tests.tk('407')) $$, $$ values (true, 2) $$,
  'D-747: the lock confirms the event and counts the TICKETS only (two tickets, the courtesy is not counted)');
reset role;
select ok(exists (select 1 from pg_locks
                   where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 1
                     and ((classid::bigint << 32) | objid::bigint) = hashtextextended('event_ticket:' || tests.tk('407')::text, 0)),
  'D-747: ...and the per-event advisory lock (the key the grant takes) is held by the transaction');
select tests.as_tenant(tests.tk('1'), tests.tk('101'));
select results_eq($$ select found, sold from app.event_ticket_lock(tests.tk('407')) $$, $$ values (false, 0) $$, 'T-10.1-12: a member gets found false from the lock');
reset role;
select tests.as_tenant(tests.tk('2'), tests.tk('10e'), 'admin_tenant');
select results_eq($$ select found, sold from app.event_ticket_lock(tests.tk('407')) $$, $$ values (false, 0) $$, 'EP-39: tenant B''s admin gets found false for tenant A''s event');
reset role;
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select is(
  (select string_agg(f::text, ',' order by n) from (values
     (1, (select found from app.event_ticket_lock(tests.tk('306')))),
     (2, (select found from app.event_ticket_lock(gen_random_uuid()))),
     (3, (select found from app.event_ticket_lock(null))),
     (4, (select found from app.event_ticket_lock(tests.tk('408'))))
   ) v(n, f)),
  'false,false,false,false', 'D-747: a soft-deleted, an unknown, a null and a foreign event all give found false');
reset role;

-- ── reset (D-747)
select tests.as_tenant(tests.tk('1'), tests.tk('103'));
select throws_ok($$ update public.event_attendances set status = 'not_going' where event_id = tests.tk('407') and user_id = tests.tk('103') $$,
  '23514', 'ticket_locked', 'D-747: before the reset the courtesy member''s own Não vou is ticket_locked');
reset role;
select tests.as_tenant(tests.tk('1'), tests.tk('101'));
select lives_ok($$ select app.event_ticket_reset(tests.tk('407')) $$, 'T-10.1-12: a member calling reset is accepted and changes nothing...');
reset role;
select tests.as_tenant(tests.tk('2'), tests.tk('10e'), 'admin_tenant');
select lives_ok($$ select app.event_ticket_reset(tests.tk('407')) $$, 'EP-39: ...and so is tenant B''s admin on tenant A''s event...');
reset role;
select is((select origin from public.event_attendances where event_id = tests.tk('407') and user_id = tests.tk('103')), 'courtesy',
  '...the courtesy row is still a courtesy');
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select lives_ok($$ select app.event_ticket_reset(tests.tk('407')) $$, 'D-747: the admin resets the event');
reset role;
select is((select string_agg(user_id::text || ':' || origin, ',' order by user_id::text) from public.event_attendances where event_id = tests.tk('407')),
  tests.tk('101')::text || ':ticket,' || tests.tk('102')::text || ':ticket,' || tests.tk('103')::text || ':rsvp',
  'D-747: the courtesy row is origin rsvp again and the two tickets are untouched');
select tests.as_tenant(tests.tk('1'), tests.tk('103'));
select lives_ok($$ update public.event_attendances set status = 'not_going' where event_id = tests.tk('407') and user_id = tests.tk('103') $$,
  'D-747: after the reset the same member''s own Não vou succeeds');
reset role;
select is((select status from public.event_attendances where event_id = tests.tk('407') and user_id = tests.tk('103')), 'not_going', 'D-747: ...and took effect');

-- ── holders (D-753)
select tests.as_tenant(tests.tk('1'), tests.tk('10c'), 'admin_tenant');
select results_eq($$ select * from app.event_ticket_holders(tests.tk('407'), array[tests.tk('201'), tests.tk('203'), tests.tk('205')]) order by 1 $$,
  $$ values (tests.tk('201')) $$,
  'D-753: of three members only the ticket holder is returned (not_going and no row are not holders)');
select results_eq($$ select * from app.event_ticket_holders(tests.tk('403'), array[tests.tk('201'), tests.tk('203'), tests.tk('205'), tests.tk('207')]) order by 1 $$,
  $$ values (tests.tk('201')), (tests.tk('203')), (tests.tk('207')) $$,
  'D-753: a going courtesy and two checked-in members all hold a presence');
select results_eq($$ select count(*)::int from app.event_ticket_holders(tests.tk('407'), array(select gen_random_uuid() from generate_series(1, 49)) || tests.tk('201')) $$,
  $$ values (1) $$, 'D-753: exactly 50 ids are answered');
select is_empty($$ select * from app.event_ticket_holders(tests.tk('407'), array(select gen_random_uuid() from generate_series(1, 50)) || tests.tk('201')) $$,
  'D-753: 51 ids return nothing');
select is_empty($$ select * from app.event_ticket_holders(tests.tk('407'), null) $$, 'EP-37: a null list returns nothing');
reset role;
select tests.as_tenant(tests.tk('1'), tests.tk('101'));
select is_empty($$ select * from app.event_ticket_holders(tests.tk('407'), array[tests.tk('201')]) $$, 'T-10.1-12: a member gets no holders');
reset role;
select tests.as_tenant(tests.tk('2'), tests.tk('10e'), 'admin_tenant');
select is_empty($$ select * from app.event_ticket_holders(tests.tk('407'), array[tests.tk('201'), tests.tk('20d')]) $$, 'EP-39: tenant B''s admin gets nothing for tenant A''s event');
select results_eq($$ select * from app.event_ticket_holders(tests.tk('308'), array[tests.tk('20d')]) $$, $$ values (tests.tk('20d')) $$,
  'EP-39: ...beside the control: the same admin reads its own event');
reset role;

select * from finish();
rollback;
