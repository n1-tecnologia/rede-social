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
select plan(106);

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

select * from finish();
rollback;
