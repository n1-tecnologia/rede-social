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
-- 3. THE LINK MATRIX (plan 04, D-789, OPEN-05, EP-13, EP-33, EP-47, T-10.2-01): `app.event_checkout_url` hands the
--    stored link to a member only while the opening is null or not after the DATABASE clock (the boundary trio:
--    one microsecond before `now()`, equal to `now()`, one microsecond after), and `app.event_sale_ready` says
--    whether the sale is open IGNORING the clock; across the whole matrix (module on or off, gateway connected or
--    not, link missing, not https, event soft-deleted, no mapping) the link is non-null exactly when the sale is
--    ready and the opening has come. 4. and 5. are appended by the next tasks of the plan.
--
-- Fixture ids use the `1e320000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(34);

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

-- ── 3. the link matrix (plan 04, D-789, OPEN-05) ───────────────────────────────────────────────
-- Ids: `tests.op('<hex>')` is `1e320000-0000-4000-8000-<hex, zero-padded>`; op('1') is tenant A, op('2') tenant B.
create function tests.op(n text) returns uuid language sql immutable as
  $$ select ('1e320000-0000-4000-8000-' || lpad(n, 12, '0'))::uuid $$;

-- Tenant A: payments module on and a gateway connected (the gateway mode is true).
insert into public.tenant_modules (tenant_id, module_key, enabled) values (tests.op('1'), 'payments', true);
insert into public.payment_integrations (tenant_id, provider, secret_sealed) values (tests.op('1'), 'fake', 'sealed-pgtap-opn');

-- F1 no opening | F2 an hour ahead | F3 exactly now() | F4 one microsecond ahead | F5 one microsecond behind |
-- F6 three days behind | F7 soft-deleted | F8 mapped with no link | F9 mapped, link https | FA no mapping (free).
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, registration_opens_at, deleted_at) values
  (tests.op('f1'), tests.op('1'), tests.op('a1'), 'F1', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, null),
  (tests.op('f2'), tests.op('1'), tests.op('a1'), 'F2', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '1 hour', null),
  (tests.op('f3'), tests.op('1'), tests.op('a1'), 'F3', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now(), null),
  (tests.op('f4'), tests.op('1'), tests.op('a1'), 'F4', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '1 microsecond', null),
  (tests.op('f5'), tests.op('1'), tests.op('a1'), 'F5', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() - interval '1 microsecond', null),
  (tests.op('f6'), tests.op('1'), tests.op('a1'), 'F6', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() - interval '3 days', null),
  (tests.op('f7'), tests.op('1'), tests.op('a1'), 'F7', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, now()),
  (tests.op('f8'), tests.op('1'), tests.op('a1'), 'F8', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, null),
  (tests.op('f9'), tests.op('1'), tests.op('a1'), 'F9', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, null),
  (tests.op('fa'), tests.op('1'), tests.op('a1'), 'FA', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null, null);
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id, checkout_url)
  select tests.op('1'), 'fake', 'event', 'opn-234-' || h, tests.op(h), 'https://pay.example.test/' || h
    from unnest(array['f1','f2','f3','f4','f5','f6','f7','f9']) as h;
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id, checkout_url) values
  (tests.op('1'), 'fake', 'event', 'opn-234-f8', tests.op('f8'), null);

-- State 1: module on, gateway connected. The row-by-row expectation `title:link handed out:sale ready`.
select tests.as_tenant(tests.op('1'), tests.op('c1'));
select results_eq(
  $$ select string_agg(e.title || ':' || (app.event_checkout_url(e.id) is not null)::text || ':' || app.event_sale_ready(e.id)::text, ',' order by e.title)
       from public.events e where e.id in (select tests.op(h) from unnest(array['f1','f2','f3','f4','f5','f6','f7','f8','f9','fa']) h) $$,
  $$ values ('F1:true:true,F2:false:true,F3:true:true,F4:false:true,F5:true:true,F6:true:true,F7:false:false,F8:false:false,F9:true:true,FA:false:false'::text) $$,
  'D-789/OPEN-05: no opening, past, one microsecond behind and exactly now() hand the link; an hour ahead and one microsecond ahead do not; readiness ignores the clock (F7 deleted, F8 no link, FA no mapping are not ready)');
select results_eq(
  $$ select app.event_checkout_url(tests.op('f1')), app.event_checkout_url(tests.op('f2')), app.event_checkout_url(tests.op('f3')),
            app.event_checkout_url(tests.op('f4')), app.event_checkout_url(tests.op('f5')), app.event_checkout_url(tests.op('f6')) $$,
  $$ values ('https://pay.example.test/f1'::text, null::text, 'https://pay.example.test/f3'::text, null::text, 'https://pay.example.test/f5'::text, 'https://pay.example.test/f6'::text) $$,
  'D-789: the link itself is the stored one, and null while the opening is still ahead (the boundary trio is F5, F3, F4)');
select results_eq(
  $$ select count(*) filter (where (app.event_checkout_url(e.id) is not null)
                               is distinct from (app.event_sale_ready(e.id) and (e.registration_opens_at is null or e.registration_opens_at <= now()))),
            count(*) from public.events e where e.id in (select tests.op(h) from unnest(array['f1','f2','f3','f4','f5','f6','f7','f8','f9','fa']) h) $$,
  $$ values (0::bigint, 10::bigint) $$,
  'OPEN-05: over all ten rows the link is non-null if and only if the sale is ready and the opening is null or not after now()');
select results_eq($$ select app.event_checkout_url(gen_random_uuid()), app.event_sale_ready(gen_random_uuid()) $$,
  $$ values (null::text, false) $$, 'EP-47: a random event id has no link and is not ready');
reset role;

-- State 2: the payments module off (the opening of F6 is long past and still no link: D-746 holds).
update public.tenant_modules set enabled = false where tenant_id = tests.op('1') and module_key = 'payments';
select tests.as_tenant(tests.op('1'), tests.op('c1'));
select results_eq(
  $$ select string_agg(e.title || ':' || (app.event_checkout_url(e.id) is not null)::text || ':' || app.event_sale_ready(e.id)::text, ',' order by e.title)
       from public.events e where e.id in (select tests.op(h) from unnest(array['f1','f2','f3','f4','f5','f6','f7','f8','f9','fa']) h) $$,
  $$ values ('F1:false:false,F2:false:false,F3:false:false,F4:false:false,F5:false:false,F6:false:false,F7:false:false,F8:false:false,F9:false:false,FA:false:false'::text) $$,
  'OPEN-05: with the payments module off no link is handed out, even with the opening past, and no sale is ready');
select results_eq(
  $$ select count(*) filter (where (app.event_checkout_url(e.id) is not null)
                               is distinct from (app.event_sale_ready(e.id) and (e.registration_opens_at is null or e.registration_opens_at <= now()))),
            count(*) from public.events e where e.id in (select tests.op(h) from unnest(array['f1','f2','f3','f4','f5','f6','f7','f8','f9','fa']) h) $$,
  $$ values (0::bigint, 10::bigint) $$, 'OPEN-05: the equivalence holds with the module off');
reset role;

-- State 3: the module back on but the gateway disconnected.
update public.tenant_modules set enabled = true where tenant_id = tests.op('1') and module_key = 'payments';
delete from public.payment_integrations where tenant_id = tests.op('1');
select tests.as_tenant(tests.op('1'), tests.op('c1'));
select results_eq(
  $$ select string_agg(e.title || ':' || (app.event_checkout_url(e.id) is not null)::text || ':' || app.event_sale_ready(e.id)::text, ',' order by e.title)
       from public.events e where e.id in (select tests.op(h) from unnest(array['f1','f2','f3','f4','f5','f6','f7','f8','f9','fa']) h) $$,
  $$ values ('F1:false:false,F2:false:false,F3:false:false,F4:false:false,F5:false:false,F6:false:false,F7:false:false,F8:false:false,F9:false:false,FA:false:false'::text) $$,
  'OPEN-05: with no gateway connected no link is handed out and no sale is ready');
select results_eq(
  $$ select count(*) filter (where (app.event_checkout_url(e.id) is not null)
                               is distinct from (app.event_sale_ready(e.id) and (e.registration_opens_at is null or e.registration_opens_at <= now()))),
            count(*) from public.events e where e.id in (select tests.op(h) from unnest(array['f1','f2','f3','f4','f5','f6','f7','f8','f9','fa']) h) $$,
  $$ values (0::bigint, 10::bigint) $$, 'OPEN-05: the equivalence holds with the gateway down');
reset role;

-- State 4: connected again, and F9 now holds a link that is not https (the table CHECK is lifted for this case only).
insert into public.payment_integrations (tenant_id, provider, secret_sealed) values (tests.op('1'), 'fake', 'sealed-pgtap-opn');
alter table public.payment_products drop constraint payment_products_url_chk;
update public.payment_products set checkout_url = 'http://pay.example.test/insecure' where event_id = tests.op('f9');
select tests.as_tenant(tests.op('1'), tests.op('c1'));
select results_eq(
  $$ select string_agg(e.title || ':' || (app.event_checkout_url(e.id) is not null)::text || ':' || app.event_sale_ready(e.id)::text, ',' order by e.title)
       from public.events e where e.id in (select tests.op(h) from unnest(array['f1','f2','f3','f4','f5','f6','f7','f8','f9','fa']) h) $$,
  $$ values ('F1:true:true,F2:false:true,F3:true:true,F4:false:true,F5:true:true,F6:true:true,F7:false:false,F8:false:false,F9:false:false,FA:false:false'::text) $$,
  'TICK-16: a stored http link is neither handed out nor ready; the rest of the matrix is as in state 1');
select results_eq(
  $$ select count(*) filter (where (app.event_checkout_url(e.id) is not null)
                               is distinct from (app.event_sale_ready(e.id) and (e.registration_opens_at is null or e.registration_opens_at <= now()))),
            count(*) from public.events e where e.id in (select tests.op(h) from unnest(array['f1','f2','f3','f4','f5','f6','f7','f8','f9','fa']) h) $$,
  $$ values (0::bigint, 10::bigint) $$, 'OPEN-05: the equivalence holds with a non-https link');
reset role;
update public.payment_products set checkout_url = 'https://pay.example.test/f9' where event_id = tests.op('f9');
alter table public.payment_products add constraint payment_products_url_chk
  check (checkout_url is null or (checkout_url ~ '^https://[^[:space:]]+$' and length(checkout_url) <= 2048));

select * from finish();
rollback;
