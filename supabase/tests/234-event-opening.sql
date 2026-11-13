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
--    ready and the opening has come.
--
-- 4. THE LOCK TRIGGER AND THE RESET (plan 04, D-783, D-793, OPEN-16, OPEN-19, EP-33, EP-34, EP-35, T-10.2-02,
--    T-10.2-04): `events_opening_guard` refuses (23514, constraint `events_opening_locked`, message
--    `opening_locked`) every change of the opening once a row of origin `ticket` exists, for the superuser
--    session, `service_role` and the tenant admin lane alike; an event with no attendance, only a courtesy or
--    only a plain rsvp can have its opening set, moved and cleared; the same value, a title edit and a soft
--    delete never meet it; a fully refunded sale lifts the lock (the revoke definer deletes the going ticket) and
--    a refunded checked-in ticket (kept and flagged) keeps it; `app.event_ticket_reset` clears the opening and
--    turns the courtesy rows back to rsvp for the admin of the tenant only.
--
-- 5. HARDENING AND ISOLATION (plan 04, OPEN-23, OPEN-24, EP-46, EP-47, EP-48, T-10.2-01, T-10.2-04, T-10.2-05): by
--    catalogue, the four functions of the plan are SECURITY DEFINER with an empty `search_path`, the three
--    callable ones execute for `authenticated` and not for `anon` or `public`, the trigger function for none,
--    and `events_opening_guard` is an enabled BEFORE UPDATE row trigger on `public.events` that names the
--    opening column and has no insert half; across tenants, in BOTH directions with the fixtures swapped and a
--    positive control each time, the link, the readiness and the reset see only the caller's own tenant; two
--    tenants' events with the same title and the same opening instant each hand out only their own link; a
--    tenant with no events and a random id are told nothing; a session with no claims is told nothing.
--
-- Fixture ids use the `1e320000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(151);

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

-- ── 4. the lock trigger and the reset (plan 04, D-783, D-793, OPEN-16, OPEN-19) ────────────────
-- `tests.try_opening` writes the opening as the CURRENT role and returns what the database answered:
-- 'ok', or 'sqlstate|constraint|message' (the exception block rolls the failed write back).
create function tests.try_opening(p_event uuid, p_value timestamptz) returns text
language plpgsql as $$
declare
  v_state text;
  v_con text;
  v_msg text;
begin
  update public.events set registration_opens_at = p_value where id = p_event;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_con = constraint_name, v_msg = message_text;
  return v_state || '|' || coalesce(v_con, '') || '|' || v_msg;
end
$$;

-- D1 no attendance | D2 only a courtesy | D3 only a plain rsvp | D4 a ticket | D5 ticket added in the same
-- transaction | D6 one going ticket (refunded below) | D7 one checked-in ticket (refunded below; it started an hour
-- ago, so the door was open) | D8, D9, DA reset cases | DB reset with a ticket | DC tenant B's event with a ticket.
-- Openings 8 days ahead (the events start in 10 days) except D7.
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, registration_opens_at) values
  (tests.op('d1'), tests.op('1'), tests.op('a1'), 'D1', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null),
  (tests.op('d2'), tests.op('1'), tests.op('a1'), 'D2', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null),
  (tests.op('d3'), tests.op('1'), tests.op('a1'), 'D3', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null),
  (tests.op('d4'), tests.op('1'), tests.op('a1'), 'D4', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '8 days'),
  (tests.op('d5'), tests.op('1'), tests.op('a1'), 'D5', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '8 days'),
  (tests.op('d6'), tests.op('1'), tests.op('a1'), 'D6', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '8 days'),
  (tests.op('d7'), tests.op('1'), tests.op('a1'), 'D7', 'in_person', 'Sede', 'Rua 1', now() - interval '1 hour', now() + interval '2 hours', now() - interval '2 hours'),
  (tests.op('d8'), tests.op('1'), tests.op('a1'), 'D8', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '8 days'),
  (tests.op('d9'), tests.op('1'), tests.op('a1'), 'D9', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '8 days'),
  (tests.op('da'), tests.op('1'), tests.op('a1'), 'DA', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '8 days'),
  (tests.op('db'), tests.op('1'), tests.op('a1'), 'DB', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '8 days'),
  (tests.op('dc'), tests.op('2'), tests.op('b1'), 'DC', 'in_person', 'Sede', 'Rua B', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '8 days');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values
  (tests.op('1'), tests.op('d2'), tests.op('c1'), 'going', now(), 'courtesy'),
  (tests.op('1'), tests.op('d3'), tests.op('c1'), 'going', now(), 'rsvp'),
  (tests.op('1'), tests.op('d8'), tests.op('c5'), 'going', now(), 'courtesy'),
  (tests.op('1'), tests.op('d9'), tests.op('c6'), 'going', now(), 'courtesy'),
  (tests.op('1'), tests.op('da'), tests.op('c1'), 'going', now(), 'courtesy'),
  (tests.op('1'), tests.op('db'), tests.op('c1'), 'going', now(), 'courtesy');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values
  (tests.op('1'), tests.op('d4'), tests.op('c2'), 'going', now(), 'ticket', 'fake', 'ORD-OPN-D4'),
  (tests.op('1'), tests.op('d6'), tests.op('c3'), 'going', now(), 'ticket', 'fake', 'ORD-OPN-D6'),
  (tests.op('1'), tests.op('db'), tests.op('c2'), 'going', now(), 'ticket', 'fake', 'ORD-OPN-DB'),
  (tests.op('2'), tests.op('dc'), tests.op('b1'), 'going', now(), 'ticket', 'fake', 'ORD-OPN-DC');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via, origin, order_provider, order_ref) values
  (tests.op('1'), tests.op('d7'), tests.op('c4'), 'checked_in', now(), now(), 'code', 'ticket', 'fake', 'ORD-OPN-D7');

-- EP-34: no attendance, only a courtesy and only a plain rsvp can be set, moved and cleared, by every writer.
-- Round 1 (set): superuser on D1, tenant admin lane on D2, service role on D3.
select is(tests.try_opening(tests.op('d1'), now() + interval '5 days'), 'ok', 'EP-34: superuser sets the opening of an event with no attendance');
select tests.as_tenant(tests.op('1'), tests.op('a1'), 'admin_tenant');
select is(tests.try_opening(tests.op('d2'), now() + interval '5 days'), 'ok', 'EP-34: the admin lane sets the opening of an event with only a courtesy');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.as_service();
select is(tests.try_opening(tests.op('d3'), now() + interval '5 days'), 'ok', 'EP-34: the service role sets the opening of an event with only a plain rsvp');
reset role;
-- Round 2 (move): superuser on D2, admin lane on D3, service role on D1.
select is(tests.try_opening(tests.op('d2'), now() + interval '6 days'), 'ok', 'EP-34: superuser moves the opening (only a courtesy)');
select tests.as_tenant(tests.op('1'), tests.op('a1'), 'admin_tenant');
select is(tests.try_opening(tests.op('d3'), now() + interval '6 days'), 'ok', 'EP-34: the admin lane moves the opening (only a plain rsvp)');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.as_service();
select is(tests.try_opening(tests.op('d1'), now() + interval '6 days'), 'ok', 'EP-34: the service role moves the opening (no attendance)');
reset role;
-- Round 3 (clear): superuser on D3, admin lane on D1, service role on D2.
select is(tests.try_opening(tests.op('d3'), null), 'ok', 'EP-34: superuser clears the opening (only a plain rsvp)');
select tests.as_tenant(tests.op('1'), tests.op('a1'), 'admin_tenant');
select is(tests.try_opening(tests.op('d1'), null), 'ok', 'EP-34: the admin lane clears the opening (no attendance)');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.as_service();
select is(tests.try_opening(tests.op('d2'), null), 'ok', 'EP-34: the service role clears the opening (only a courtesy)');
reset role;
select is(
  (select count(*)::int from public.events where id in (tests.op('d1'), tests.op('d2'), tests.op('d3')) and registration_opens_at is null),
  3, 'EP-34: all three events read a null opening again');

-- D4 holds a ticket: every writer is refused, probed by SQLSTATE, constraint name and message (T-10.2-02).
select is(tests.try_opening(tests.op('d4'), now() + interval '5 days'), '23514|events_opening_locked|opening_locked',
  'D-783/OPEN-16: superuser moving the opening of an event with a ticket is refused (23514, events_opening_locked, opening_locked)');
select set_config('request.jwt.claims', '', true);
select tests.as_service();
select is(tests.try_opening(tests.op('d4'), now() + interval '5 days'), '23514|events_opening_locked|opening_locked',
  'D-783/OPEN-16: the service role is refused the same way');
reset role;
select tests.as_tenant(tests.op('1'), tests.op('a1'), 'admin_tenant');
select is(tests.try_opening(tests.op('d4'), now() + interval '5 days'), '23514|events_opening_locked|opening_locked',
  'D-783/OPEN-16: the tenant admin lane is refused the same way');
select is(tests.try_opening(tests.op('d4'), null), '23514|events_opening_locked|opening_locked',
  'D-783: clearing the opening of an event with a ticket is refused too');
reset role;
select is((select registration_opens_at from public.events where id = tests.op('d4')), now() + interval '8 days',
  'D-783: the opening of the locked event reads back unchanged');
select is(tests.try_opening(tests.op('d4'), now() + interval '8 days'), 'ok',
  'EP-33: setting the opening to the value it already holds is accepted even with a ticket (the WHEN clause filters it)');
select lives_ok($$ update public.events set title = 'D4 renamed' where id = '1e320000-0000-4000-8000-0000000000d4' $$,
  'EP-33: a title edit of the locked event never meets the trigger');
select lives_ok($$ update public.events set deleted_at = now() where id = '1e320000-0000-4000-8000-0000000000d4' $$,
  'EP-33: a soft delete of the locked event never meets the trigger');

-- EP-33: a ticket row created in the same transaction before the edit locks it (D5 had none until now).
select is(tests.try_opening(tests.op('d5'), now() + interval '7 days'), 'ok', 'EP-33 control: D5 has no ticket yet, so its opening moves');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values
  (tests.op('1'), tests.op('d5'), tests.op('c3'), 'going', now(), 'ticket', 'fake', 'ORD-OPN-D5');
select is(tests.try_opening(tests.op('d5'), now() + interval '6 days'), '23514|events_opening_locked|opening_locked',
  'EP-33: a ticket row created in the same transaction locks the date at once');

-- EP-35: sale then edit refused; refund (the revoke definer) then edit accepted.
select is(tests.try_opening(tests.op('d6'), now() + interval '7 days'), '23514|events_opening_locked|opening_locked',
  'EP-35: a sold event refuses the edit');
select set_config('request.jwt.claims', '', true);
select tests.as_service();
select results_eq($$ select outcome from app.event_gateway_revoke(tests.op('1'), 'fake', 'ORD-OPN-D6') $$, $$ values ('removed'::text) $$,
  'EP-35 fixture: the refund deletes the only going ticket');
reset role;
select is(tests.try_opening(tests.op('d6'), now() + interval '7 days'), 'ok',
  'D-783/EP-35: after a full refund the edit is accepted (the lock is lifted)');
select is((select registration_opens_at from public.events where id = tests.op('d6')), now() + interval '7 days',
  'EP-35: ...and the new opening is what the row reads');

-- EP-35: a refunded CHECKED-IN ticket is kept and flagged, so it still locks (the safe side).
select set_config('request.jwt.claims', '', true);
select tests.as_service();
select results_eq($$ select outcome from app.event_gateway_revoke(tests.op('1'), 'fake', 'ORD-OPN-D7') $$, $$ values ('kept'::text) $$,
  'EP-35 fixture: the refund of a checked-in ticket keeps the row');
reset role;
select is((select count(*)::int from public.event_attendances where event_id = tests.op('d7') and origin = 'ticket' and refunded_at is not null),
  1, 'EP-35: the kept row is flagged refunded and is still a ticket row');
select is(tests.try_opening(tests.op('d7'), now() - interval '90 minutes'), '23514|events_opening_locked|opening_locked',
  'D-783/EP-35: a refunded checked-in ticket still locks the date');
select is((select registration_opens_at from public.events where id = tests.op('d7')), now() - interval '2 hours',
  'EP-35: ...and the opening reads back unchanged');

-- T-10.2-04: a ticket row of tenant B's event never locks tenant A's event.
select is(tests.try_opening(tests.op('d1'), now() + interval '4 days'), 'ok',
  'T-10.2-04: tenant A''s event D1 moves its opening while tenant B''s event holds a ticket');
select is(tests.try_opening(tests.op('dc'), now() + interval '4 days'), '23514|events_opening_locked|opening_locked',
  'T-10.2-04 control: tenant B''s own event with its ticket is locked');

-- ── the reset (D-793, OPEN-19) ────────────────────────────────────────────────────────────────
select tests.as_tenant(tests.op('1'), tests.op('a1'), 'admin_tenant');
select lives_ok($$ select app.event_ticket_reset('1e320000-0000-4000-8000-0000000000d8') $$, 'D-793: the admin of the tenant resets D8');
reset role;
select is((select registration_opens_at is null from public.events where id = tests.op('d8')), true, 'OPEN-19: the reset leaves the opening null');
select is((select origin from public.event_attendances where event_id = tests.op('d8') and user_id = tests.op('c5')), 'rsvp',
  'D-747 kept: ...and the courtesy row is origin rsvp again');

-- A member of the tenant: accepted, nothing changes (the admin claim is checked inside).
select tests.as_tenant(tests.op('1'), tests.op('c1'));
select lives_ok($$ select app.event_ticket_reset('1e320000-0000-4000-8000-0000000000d9') $$, 'T-10.2-04: a member calling the reset is accepted and changes nothing');
reset role;
select is((select (registration_opens_at = now() + interval '8 days')::text || ':' || (select origin from public.event_attendances where event_id = tests.op('d9') and user_id = tests.op('c6'))
             from public.events where id = tests.op('d9')),
  'true:courtesy', 'T-10.2-04: ...the opening and the courtesy row of D9 are untouched');

-- Tenant B's admin on tenant A's event: nothing changes, nothing raises (EP-48, one direction; section 5 swaps).
select tests.as_tenant(tests.op('2'), tests.op('b1'), 'admin_tenant');
select lives_ok($$ select app.event_ticket_reset('1e320000-0000-4000-8000-0000000000da') $$, 'T-10.2-04: tenant B''s admin resetting tenant A''s event is accepted and changes nothing');
reset role;
select is((select (registration_opens_at = now() + interval '8 days')::text || ':' || (select origin from public.event_attendances where event_id = tests.op('da') and user_id = tests.op('c1'))
             from public.events where id = tests.op('da')),
  'true:courtesy', 'T-10.2-04: ...tenant A''s opening and courtesy row of DA are untouched');

-- EP-47: an unknown id changes nothing and raises nothing.
select tests.as_tenant(tests.op('1'), tests.op('a1'), 'admin_tenant');
select lives_ok($$ select app.event_ticket_reset(gen_random_uuid()) $$, 'EP-47: the reset of an unknown id raises nothing');
-- The backstop: with a ticket row the reset raises the lock refusal and the whole call rolls back.
select throws_ok($$ select app.event_ticket_reset('1e320000-0000-4000-8000-0000000000db') $$, '23514', 'opening_locked',
  'D-783 backstop: the reset of an event that still holds a ticket raises opening_locked');
reset role;
select is((select (registration_opens_at = now() + interval '8 days')::text || ':' || (select origin from public.event_attendances where event_id = tests.op('db') and user_id = tests.op('c1'))
             from public.events where id = tests.op('db')),
  'true:courtesy', 'D-783 backstop: ...the opening stays and the courtesy row stays a courtesy (the call rolled back as a whole)');

-- ── 5. hardening and isolation (plan 04, OPEN-23, OPEN-24, EP-46 to EP-48) ─────────────────────
-- By catalogue: SECURITY DEFINER with an empty search_path on the four functions of the plan.
select ok(coalesce((select p.prosecdef and p.proconfig @> array['search_path=""']
                      from pg_proc p where p.oid = to_regprocedure(v.sig)), false),
          v.sig || ' is SECURITY DEFINER with an empty search_path')
  from (values
    ('app.event_checkout_url(uuid)'),
    ('app.event_sale_ready(uuid)'),
    ('app.event_opening_guard()'),
    ('app.event_ticket_reset(uuid)')
  ) as v(sig);
-- The privilege matrix: three callable by authenticated only, the trigger function by nobody.
select ok(has_function_privilege(v.role, v.sig, 'execute') = v.expected,
          v.role || (case when v.expected then ' can execute ' else ' cannot execute ' end) || v.sig)
  from (values
    ('authenticated', 'app.event_checkout_url(uuid)', true),
    ('authenticated', 'app.event_sale_ready(uuid)', true),
    ('authenticated', 'app.event_ticket_reset(uuid)', true),
    ('authenticated', 'app.event_opening_guard()', false),
    ('anon',          'app.event_checkout_url(uuid)', false),
    ('anon',          'app.event_sale_ready(uuid)', false),
    ('anon',          'app.event_ticket_reset(uuid)', false),
    ('anon',          'app.event_opening_guard()', false),
    ('public',        'app.event_checkout_url(uuid)', false),
    ('public',        'app.event_sale_ready(uuid)', false),
    ('public',        'app.event_ticket_reset(uuid)', false),
    ('public',        'app.event_opening_guard()', false)
  ) as v(role, sig, expected);
-- The trigger: on public.events, a BEFORE (2) UPDATE (16) ROW (1) trigger and no INSERT (4) half, enabled.
select is(
  (select t.tgtype & 31 = 19 and t.tgenabled = 'O' and t.tgfoid = to_regprocedure('app.event_opening_guard()')
     from pg_trigger t where t.tgrelid = 'public.events'::regclass and t.tgname = 'events_opening_guard' and not t.tgisinternal),
  true, 'OPEN-23: events_opening_guard is an enabled BEFORE UPDATE row trigger on public.events (no insert half) running the guard');
select ok(
  (select pg_get_triggerdef(t.oid) ~ 'UPDATE OF registration_opens_at' and pg_get_triggerdef(t.oid) ~ 'IS DISTINCT FROM'
     from pg_trigger t where t.tgrelid = 'public.events'::regclass and t.tgname = 'events_opening_guard'),
  'OPEN-23: its definition names the opening column and compares old with new');

-- Fixtures swapped: tenant B gets what tenant A has (module, gateway, mapped events with links).
select tests.tenant('pgtap-opn-c', 'Abertura C', tests.op('3'));
select tests.auth_user('u1@opn-b.local', tests.op('b2'));
select tests.auth_user('u7@opn-c.local', tests.op('c7'));
insert into public.tenant_modules (tenant_id, module_key, enabled) values (tests.op('2'), 'payments', true);
insert into public.payment_integrations (tenant_id, provider, secret_sealed) values (tests.op('2'), 'fake', 'sealed-pgtap-opn-b');
-- E3 B's mapped event, no opening | E4 (A) and E5 (B): the SAME title and the SAME opening instant | E6 B's event for the reset.
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, registration_opens_at) values
  (tests.op('e3'), tests.op('2'), tests.op('b1'), 'E3', 'in_person', 'Sede', 'Rua B', now() + interval '10 days', now() + interval '10 days 2 hours', null),
  (tests.op('e4'), tests.op('1'), tests.op('a1'), 'Mesmo titulo', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() - interval '1 day'),
  (tests.op('e5'), tests.op('2'), tests.op('b1'), 'Mesmo titulo', 'in_person', 'Sede', 'Rua B', now() + interval '10 days', now() + interval '10 days 2 hours', now() - interval '1 day'),
  (tests.op('e6'), tests.op('2'), tests.op('b1'), 'E6', 'in_person', 'Sede', 'Rua B', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '8 days');
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id, checkout_url) values
  (tests.op('2'), 'fake', 'event', 'opn-234-e3', tests.op('e3'), 'https://pay.example.test/b-e3'),
  (tests.op('1'), 'fake', 'event', 'opn-234-e4', tests.op('e4'), 'https://pay.example.test/a-e4'),
  (tests.op('2'), 'fake', 'event', 'opn-234-e5', tests.op('e5'), 'https://pay.example.test/b-e5');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values
  (tests.op('2'), tests.op('e6'), tests.op('b2'), 'going', now(), 'courtesy');

-- A to B, with the positive control (A's own link and readiness first).
select tests.as_tenant(tests.op('1'), tests.op('c1'));
select results_eq(
  $$ select app.event_checkout_url(tests.op('f1')), app.event_sale_ready(tests.op('f1')), app.event_checkout_url(tests.op('e3')), app.event_sale_ready(tests.op('e3')) $$,
  $$ values ('https://pay.example.test/f1'::text, true, null::text, false) $$,
  'EP-48: a member of tenant A gets its own link and readiness, and null and false for tenant B''s event');
reset role;
-- B to A, the same fixtures swapped.
select tests.as_tenant(tests.op('2'), tests.op('b2'));
select results_eq(
  $$ select app.event_checkout_url(tests.op('e3')), app.event_sale_ready(tests.op('e3')), app.event_checkout_url(tests.op('f1')), app.event_sale_ready(tests.op('f1')) $$,
  $$ values ('https://pay.example.test/b-e3'::text, true, null::text, false) $$,
  'EP-48: a member of tenant B gets its own link and readiness, and null and false for tenant A''s event');
select results_eq(
  $$ select app.event_checkout_url(tests.op('e5')), app.event_checkout_url(tests.op('e4')) $$,
  $$ values ('https://pay.example.test/b-e5'::text, null::text) $$,
  'EP-46: same title, same opening instant: tenant B reads only its own link');
reset role;
select tests.as_tenant(tests.op('1'), tests.op('c1'));
select results_eq(
  $$ select app.event_checkout_url(tests.op('e4')), app.event_checkout_url(tests.op('e5')) $$,
  $$ values ('https://pay.example.test/a-e4'::text, null::text) $$,
  'EP-46: ...and tenant A reads only its own');
reset role;
-- EP-47: a tenant with no events, and a random id.
select tests.as_tenant(tests.op('3'), tests.op('c7'));
select results_eq(
  $$ select app.event_checkout_url(gen_random_uuid()), app.event_sale_ready(gen_random_uuid()), app.event_checkout_url(tests.op('f1')), app.event_sale_ready(tests.op('e3')) $$,
  $$ values (null::text, false, null::text, false) $$,
  'EP-47: a tenant with no events and no module is told nothing, for a random id or for another tenant''s events');
reset role;
-- A session with no claims is told nothing (T-10.2-01).
select tests.as_tenant_without_claims();
select results_eq(
  $$ select app.event_checkout_url(tests.op('f1')), app.event_sale_ready(tests.op('f1')) $$,
  $$ values (null::text, false) $$, 'T-10.2-01: a session with no claims is told nothing');
reset role;

-- The reset, A to B (the section 4 case was B to A), then the positive control with B's own admin.
select tests.as_tenant(tests.op('1'), tests.op('a1'), 'admin_tenant');
select lives_ok($$ select app.event_ticket_reset('1e320000-0000-4000-8000-0000000000e6') $$,
  'T-10.2-04: tenant A''s admin resetting tenant B''s event is accepted and changes nothing');
reset role;
select is((select (registration_opens_at = now() + interval '8 days')::text || ':' || (select origin from public.event_attendances where event_id = tests.op('e6') and user_id = tests.op('b2'))
             from public.events where id = tests.op('e6')),
  'true:courtesy', 'T-10.2-04: ...tenant B''s opening and courtesy row of E6 are untouched');
select tests.as_tenant(tests.op('2'), tests.op('b1'), 'admin_tenant');
select lives_ok($$ select app.event_ticket_reset('1e320000-0000-4000-8000-0000000000e6') $$, 'EP-48 control: tenant B''s own admin resets E6');
reset role;
select is((select (registration_opens_at is null)::text || ':' || (select origin from public.event_attendances where event_id = tests.op('e6') and user_id = tests.op('b2'))
             from public.events where id = tests.op('e6')),
  'true:rsvp', 'EP-48 control: ...and it clears the opening and turns the courtesy row back to rsvp');

-- ── 6. the grant records when (plan 05, D-782, D-791, OPEN-12, OPEN-13, EP-49, EP-59, T-10.2-10) ──
-- `app.event_gateway_grant` called as the service role, in events whose opening is ahead, far ahead and past: it
-- NEVER refuses for the opening (D-782), and on every write path it stamps `ticket_confirmed_at = now()`.
-- Users 6xx, memberships 7xx, events 6xx, all of tenant A. 601 opens in an hour (early) | 602 started an hour ago,
-- opened before the start (checked-in and walk-in rows made BEFORE the link) | 603 opens in 50 days (far ahead) |
-- 604 opened three days ago.
select tests.auth_user('g' || h || '@opn-6.local', tests.op(h))
  from unnest(array['601','602','603','604','605','606','607','608','609']) as h;
insert into public.memberships (id, tenant_id, user_id, role, status, blocked_at, deleted_at)
  select tests.op('7' || substr(h, 2)), tests.op('1'), tests.op(h), 'member', 'active', null, null
    from unnest(array['601','602','603','604','605','606','607','608','609']) as h;
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, registration_opens_at) values
  (tests.op('601'), tests.op('1'), tests.op('a1'), 'G1', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '1 hour'),
  (tests.op('602'), tests.op('1'), tests.op('a1'), 'G2', 'in_person', 'Sede', 'Rua 1', now() - interval '1 hour', now() + interval '2 hours', now() - interval '90 minutes'),
  (tests.op('603'), tests.op('1'), tests.op('a1'), 'G3', 'in_person', 'Sede', 'Rua 1', now() + interval '60 days', now() + interval '60 days 2 hours', now() + interval '50 days'),
  (tests.op('604'), tests.op('1'), tests.op('a1'), 'G4', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() - interval '3 days');
-- Presences made BEFORE the link (the events are still free, so the guard lets them in).
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values
  (tests.op('1'), tests.op('601'), tests.op('602'), 'not_going', now() - interval '2 days', 'rsvp'),
  (tests.op('1'), tests.op('601'), tests.op('603'), 'going', now() - interval '2 days', 'rsvp'),
  (tests.op('1'), tests.op('601'), tests.op('604'), 'going', now() - interval '2 days', 'courtesy');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via, origin) values
  (tests.op('1'), tests.op('602'), tests.op('606'), 'checked_in', now(), now(), 'code', 'rsvp');
insert into public.event_attendances (tenant_id, event_id, user_id, status, checked_in_at, checkin_via, origin) values
  (tests.op('1'), tests.op('602'), tests.op('607'), 'walk_in', now(), 'online', 'rsvp');
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id)
  select tests.op('1'), 'fake', 'event', 'opn-234-g' || h, tests.op(h) from unnest(array['601','602','603','604']) as h;

select set_config('request.jwt.claims', '', true);
select tests.as_service();
-- Path 1, no row: an early payment is granted and the row reads both instants as the transaction's now().
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('701'), tests.op('601'), 'fake', 'OPN6-1') $$,
  $$ values ('granted'::text) $$, 'D-782: an approved payment BEFORE the opening is granted (no refusal)');
-- Path 2, not_going to going.
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('702'), tests.op('601'), 'fake', 'OPN6-2') $$,
  $$ values ('granted'::text) $$, 'D-782: a not_going member paying before the opening is granted');
-- Path 3, the upgrade of a going rsvp, a courtesy, a checked-in and a walk-in row.
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('703'), tests.op('601'), 'fake', 'OPN6-3') $$,
  $$ values ('granted'::text) $$, 'D-782: an old Vou paying before the opening is granted');
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('704'), tests.op('601'), 'fake', 'OPN6-4') $$,
  $$ values ('granted'::text) $$, 'D-782: a courtesy holder paying before the opening is granted');
-- The manual release (sixth argument true) stamps the admin's click time too.
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('705'), tests.op('601'), 'manual', 'OPN6-5', true) $$,
  $$ values ('granted'::text) $$, 'OPEN-13: the manual release before the opening is granted');
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('706'), tests.op('602'), 'fake', 'OPN6-6') $$,
  $$ values ('granted'::text) $$, 'the checked-in row made before the link is upgraded');
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('707'), tests.op('602'), 'fake', 'OPN6-7') $$,
  $$ values ('granted'::text) $$, 'the walk-in row made before the link is upgraded');
-- D-782 with an opening far ahead and one in the past.
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('708'), tests.op('603'), 'fake', 'OPN6-8') $$,
  $$ values ('granted'::text) $$, 'D-782: an approved payment 50 days before the opening is granted');
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('709'), tests.op('604'), 'fake', 'OPN6-9') $$,
  $$ values ('granted'::text) $$, 'D-782: an approved payment after the opening is granted');
reset role;

select is(
  (select origin = 'ticket' and status = 'going' and responded_at = now() and ticket_confirmed_at = now()
     from public.event_attendances where event_id = tests.op('601') and user_id = tests.op('601')),
  true, 'D-791/OPEN-13: path 1 (no row) writes responded_at and ticket_confirmed_at, both the transaction now()');
select is(
  (select origin = 'ticket' and status = 'going' and responded_at = now() and ticket_confirmed_at = now()
     from public.event_attendances where event_id = tests.op('601') and user_id = tests.op('602')),
  true, 'D-791: path 2 (not_going to going) writes the instant');
select is(
  (select origin = 'ticket' and status = 'going' and responded_at = now() - interval '2 days' and ticket_confirmed_at = now()
     from public.event_attendances where event_id = tests.op('601') and user_id = tests.op('603')),
  true, 'D-791: the upgrade of an old Vou writes the instant and leaves responded_at at its old value (why the column exists)');
select is(
  (select origin = 'ticket' and status = 'going' and responded_at = now() - interval '2 days' and ticket_confirmed_at = now()
     from public.event_attendances where event_id = tests.op('601') and user_id = tests.op('604')),
  true, 'D-791: the upgrade of a courtesy row writes the instant');
select is(
  (select origin = 'ticket' and order_provider = 'manual' and ticket_confirmed_at = now()
     from public.event_attendances where event_id = tests.op('601') and user_id = tests.op('605')),
  true, 'D-791: the manual release stamps the instant');
select is(
  (select origin = 'ticket' and status = 'checked_in' and ticket_confirmed_at = now()
     from public.event_attendances where event_id = tests.op('602') and user_id = tests.op('606')),
  true, 'D-791: the upgrade of a checked-in row writes the instant and keeps the status');
select is(
  (select origin = 'ticket' and status = 'walk_in' and ticket_confirmed_at = now()
     from public.event_attendances where event_id = tests.op('602') and user_id = tests.op('607')),
  true, 'D-791: the upgrade of a walk-in row writes the instant and keeps the status');
select is(
  (select count(*)::int from public.event_attendances
    where event_id in (tests.op('603'), tests.op('604')) and origin = 'ticket' and ticket_confirmed_at = now()),
  2, 'D-782/D-791: the far-ahead and the past opening both left a confirmed ticket row with the instant');

-- EP-49, EP-59: a replay writes nothing. The instant is moved back first so that a rewrite would be visible.
update public.event_attendances set ticket_confirmed_at = now() - interval '5 minutes'
 where event_id = tests.op('601') and user_id = tests.op('601');
select tests.as_service();
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('701'), tests.op('601'), 'fake', 'OPN6-1') $$,
  $$ values ('already_in'::text) $$, 'EP-49: the same order again answers already_in');
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('701'), tests.op('601'), 'fake', 'OPN6-1B') $$,
  $$ values ('already_in'::text) $$, 'EP-59: a second DIFFERENT order by a member who already holds a ticket answers already_in');
reset role;
select is(
  (select count(*)::int || ':' || (min(ticket_confirmed_at) = now() - interval '5 minutes')::text
     from public.event_attendances where event_id = tests.op('601') and user_id = tests.op('601')),
  '1:true', 'EP-49/EP-59: one presence, and the confirmation instant was never rewritten');

-- ── 7. the member lane (plan 05, T-10.2-03, D-791) ───────────────────────────────────────────────
-- A member (role `authenticated`) can never write `ticket_confirmed_at`: `app.event_attendance_guard()` refuses it
-- (42501, constraint `event_attendances_bookkeeping_locked`, message `bookkeeping_locked`) before the CHECK and
-- before the bookkeeping exit. Users 60a to 60d, memberships 70a to 70d, 605 free (a plain rsvp row of 60a) |
-- 606 opens in two days, no ticket (the courtesy and reset controls).
select tests.auth_user('g' || h || '@opn-6.local', tests.op(h)) from unnest(array['60a','60b','60c','60d']) as h;
insert into public.memberships (id, tenant_id, user_id, role, status, blocked_at, deleted_at)
  select tests.op('7' || substr(h, 2)), tests.op('1'), tests.op(h), 'member', 'active', null, null
    from unnest(array['60a','60b','60c','60d']) as h;
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, registration_opens_at) values
  (tests.op('605'), tests.op('1'), tests.op('a1'), 'G5', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null),
  (tests.op('606'), tests.op('1'), tests.op('a1'), 'G6', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '2 days');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values
  (tests.op('1'), tests.op('605'), tests.op('60a'), 'going', now(), 'rsvp');
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id) values
  (tests.op('1'), 'fake', 'event', 'opn-234-g606', tests.op('606'));

select tests.as_tenant(tests.op('1'), tests.op('601'));
select throws_ok($$ update public.event_attendances set ticket_confirmed_at = now() + interval '30 days' where event_id = tests.op('601') and user_id = tests.op('601') $$,
  '42501', 'bookkeeping_locked', 'T-10.2-03: a member moving the confirmation instant of their own ticket row is bookkeeping_locked');
select throws_ok($$ update public.event_attendances set ticket_confirmed_at = null where event_id = tests.op('601') and user_id = tests.op('601') $$,
  '42501', 'bookkeeping_locked', 'T-10.2-03: a member erasing the confirmation instant of their own ticket row is bookkeeping_locked');
select throws_ok($$ update public.event_attendances set ticket_confirmed_at = now() - interval '9 days', responded_at = now() where event_id = tests.op('601') and user_id = tests.op('601') $$,
  '42501', 'bookkeeping_locked', 'T-10.2-03: the instant is refused even when carried with an allowed column');
do $$
declare
  v_state text;
  v_constraint text;
  v_message text;
begin
  begin
    update public.event_attendances set ticket_confirmed_at = now() + interval '1 day' where event_id = tests.op('601') and user_id = tests.op('601');
    perform set_config('s7.probe', 'no exception', true);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
    perform set_config('s7.probe', v_state || '|' || coalesce(v_constraint, '') || '|' || v_message, true);
  end;
end
$$;
select is(current_setting('s7.probe', true), '42501|event_attendances_bookkeeping_locked|bookkeeping_locked',
  'T-10.2-03: the refusal is SQLSTATE 42501, constraint event_attendances_bookkeeping_locked, message bookkeeping_locked');
reset role;
select is(
  (select ticket_confirmed_at = now() - interval '5 minutes' from public.event_attendances where event_id = tests.op('601') and user_id = tests.op('601')),
  true, 'T-10.2-03: after the refused attempts the ticket row still reads its confirmation instant');

-- The same attempt on a plain rsvp row: the guard answers before the CHECK would.
select tests.as_tenant(tests.op('1'), tests.op('60a'));
select throws_ok($$ update public.event_attendances set ticket_confirmed_at = now() where event_id = tests.op('605') and user_id = tests.op('60a') $$,
  '42501', 'bookkeeping_locked', 'T-10.2-03: a member writing the instant on their own plain rsvp row is bookkeeping_locked (the guard answers before the CHECK)');
-- A member insert of origin rsvp that carries the column is refused (the CHECK of plan 01).
reset role;
select tests.as_tenant(tests.op('1'), tests.op('60b'));
select throws_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, ticket_confirmed_at) values (tests.op('1'), tests.op('605'), tests.op('60b'), 'going', now(), now()) $$,
  '23514', null, 'T-10.2-03: a member insert of origin rsvp carrying the instant is refused');
reset role;
select is((select ticket_confirmed_at is null from public.event_attendances where event_id = tests.op('605') and user_id = tests.op('60a')), true,
  'T-10.2-03: the plain rsvp row still reads a null instant');

-- Positive controls: every legitimate writer still passes under the redefined guard.
select tests.as_service();
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('70c'), tests.op('604'), 'fake', 'OPN7-1') $$,
  $$ values ('granted'::text) $$, 'control: the service role grant still writes the instant');
reset role;
select is((select ticket_confirmed_at = now() from public.event_attendances where event_id = tests.op('604') and user_id = tests.op('60c')), true,
  'control: ...and the row reads it');
select tests.as_tenant(tests.op('1'), tests.op('a1'), 'admin_tenant');
select results_eq($$ select outcome from app.event_courtesy_grant(tests.op('606'), tests.op('70d')) $$, $$ values ('granted'::text) $$,
  'control: the admin courtesy grant is accepted');
select lives_ok($$ select app.event_ticket_reset(tests.op('606')) $$, 'control: the admin reset is accepted');
reset role;
select is((select origin from public.event_attendances where event_id = tests.op('606') and user_id = tests.op('60d')), 'rsvp',
  'control: ...and the courtesy row is a plain rsvp again');
select tests.as_tenant(tests.op('1'), tests.op('60a'));
select lives_ok($$ update public.event_attendances set responded_at = now() where event_id = tests.op('605') and user_id = tests.op('60a') $$,
  'control: a member update of an unrelated column of their own rsvp row is accepted');
select lives_ok($$ insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values (tests.op('1'), tests.op('605'), tests.op('60a'), 'not_going', now(), 'rsvp') on conflict (tenant_id, event_id, user_id) do update set status = excluded.status, responded_at = now(), updated_at = now() where event_attendances.status in ('going','not_going') and event_attendances.status is distinct from excluded.status $$,
  'control: the free-event Não vou upsert of a member is accepted');
reset role;

-- ── 8. the derived mark (plan 05, D-791, OPEN-13, OPEN-15, EP-28, EP-29, EP-30) ─────────────────
-- The rule `before_opening`, defined ONCE here as a copy of the expression in `attendeeProjection`
-- (packages/modules/events/server/service.ts, plan 07). Edit both together.
create view tests.op_marks as
  select a.id, a.event_id, a.user_id,
         (a.origin = 'ticket' and a.ticket_confirmed_at is not null and ev.registration_opens_at is not null and a.ticket_confirmed_at < ev.registration_opens_at) as before_opening
    from public.event_attendances a
    join public.events ev on ev.id = a.event_id and ev.tenant_id = a.tenant_id;

-- 607 opens in a day: the boundary pair and the null cases | 608 no opening | 60b/60c below: two ticket rows confirmed in
-- the same instant, rows 609/60a: a Vou upgraded before and after the opening through the grant.
select tests.auth_user('g' || h || '@opn-8.local', tests.op(h)) from unnest(array['610','611','612','613','614','615','616','617','618','619','620','621','622']) as h;
insert into public.memberships (id, tenant_id, user_id, role, status, blocked_at, deleted_at)
  select tests.op('7' || substr(h, 2)), tests.op('1'), tests.op(h), 'member', 'active', null, null
    from unnest(array['617','618','619']) as h;
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at, registration_opens_at) values
  (tests.op('607'), tests.op('1'), tests.op('a1'), 'H1', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '1 day'),
  (tests.op('608'), tests.op('1'), tests.op('a1'), 'H2', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', null),
  (tests.op('609'), tests.op('1'), tests.op('a1'), 'H3', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '1 hour'),
  (tests.op('60e'), tests.op('1'), tests.op('a1'), 'H4', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() - interval '1 hour'),
  (tests.op('60f'), tests.op('1'), tests.op('a1'), 'H5', 'in_person', 'Sede', 'Rua 1', now() + interval '10 days', now() + interval '10 days 2 hours', now() + interval '1 day');
-- Ticket rows written directly (the instants are chosen, not taken from the clock). 610 an hour before the opening |
-- 611 exactly at it | 612 one microsecond before it | 613 one microsecond after it | 614 a null instant (a row from before
-- this release) | 615 a courtesy | 616 a plain rsvp | 620 and 621 confirmed in the same instant on 60f.
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref, ticket_confirmed_at)
  select tests.op('1'), tests.op('607'), tests.op(v.u), 'going', now(), 'ticket', 'fake', 'OPN8-' || v.u,
         (select ev.registration_opens_at from public.events ev where ev.id = tests.op('607')) + v.delta
    from (values ('610', interval '-1 hour'), ('611', interval '0'), ('612', interval '-1 microsecond'), ('613', interval '1 microsecond')) as v(u, delta);
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref) values
  (tests.op('1'), tests.op('607'), tests.op('614'), 'going', now(), 'ticket', 'fake', 'OPN8-614');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values
  (tests.op('1'), tests.op('607'), tests.op('615'), 'going', now(), 'courtesy'),
  (tests.op('1'), tests.op('607'), tests.op('616'), 'going', now(), 'rsvp');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref, ticket_confirmed_at) values
  (tests.op('1'), tests.op('608'), tests.op('610'), 'going', now(), 'ticket', 'fake', 'OPN8-NOOPEN', now() - interval '2 days');
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref, ticket_confirmed_at) values
  (tests.op('1'), tests.op('60f'), tests.op('620'), 'going', now() - interval '3 minutes', 'ticket', 'fake', 'OPN8-620', now() - interval '1 hour'),
  (tests.op('1'), tests.op('60f'), tests.op('621'), 'going', now() - interval '4 minutes', 'ticket', 'fake', 'OPN8-621', now() - interval '1 hour');
-- A Vou given before the link, upgraded through the grant: 617 on 609 (before its opening) and 618 on 60e (after its opening).
insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin) values
  (tests.op('1'), tests.op('609'), tests.op('617'), 'going', now() - interval '2 days', 'rsvp'),
  (tests.op('1'), tests.op('60e'), tests.op('618'), 'going', now() - interval '2 days', 'rsvp');
insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id)
  select tests.op('1'), 'fake', 'event', 'opn-234-h' || h, tests.op(h) from unnest(array['609','60e']) as h;
select set_config('request.jwt.claims', '', true);
select tests.as_service();
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('717'), tests.op('609'), 'fake', 'OPN8-617') $$,
  $$ values ('granted'::text) $$, 'fixture: the Vou of 617 is upgraded BEFORE the opening');
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('718'), tests.op('60e'), 'fake', 'OPN8-618') $$,
  $$ values ('granted'::text) $$, 'fixture: the Vou of 618 is upgraded AFTER the opening');
select results_eq($$ select outcome from app.event_gateway_grant(tests.op('1'), tests.op('719'), tests.op('609'), 'manual', 'OPN8-619', true) $$,
  $$ values ('granted'::text) $$, 'fixture: the manual release of 619 before the opening');
reset role;

select is(
  (select string_agg(m.user_id::text || ':' || m.before_opening::text, ',' order by m.user_id)
     from tests.op_marks m where m.event_id = tests.op('607')),
  (select string_agg(tests.op(u)::text || ':' || b, ',' order by tests.op(u))
     from (values ('610', 'true'), ('611', 'false'), ('612', 'true'), ('613', 'false'), ('614', 'false'), ('615', 'false'), ('616', 'false')) as v(u, b)),
  'EP-28/EP-29: an hour early and one microsecond early are marked; the exact instant, one microsecond after, a null instant, a courtesy and a plain rsvp are not');
select is((select m.before_opening from tests.op_marks m where m.event_id = tests.op('608') and m.user_id = tests.op('610')), false,
  'EP-29: a ticket row of an event with no opening is never marked');
select is((select m.before_opening from tests.op_marks m where m.event_id = tests.op('609') and m.user_id = tests.op('617')), true,
  'EP-28: a Vou upgraded BEFORE the opening is marked (its old responded_at plays no part)');
select is((select m.before_opening from tests.op_marks m where m.event_id = tests.op('60e') and m.user_id = tests.op('618')), false,
  'EP-28: the same Vou upgraded AFTER the opening is not marked');
select is((select m.before_opening from tests.op_marks m where m.event_id = tests.op('609') and m.user_id = tests.op('619')), true,
  'OPEN-13: the manual release before the opening is marked');
select is((select bool_and(a.ticket_confirmed_at is not null) from public.event_attendances a where a.event_id in (tests.op('609'), tests.op('60e')) and a.origin = 'ticket'),
  true, 'D-791: every ticket row the grant wrote carries the instant');

-- Stable: with a marked row the opening cannot move (plan 04), and a refund that deletes the row removes the mark with it.
select is(tests.try_opening(tests.op('609'), now() + interval '2 hours'), '23514|events_opening_locked|opening_locked',
  'OPEN-13: the opening of an event with a marked ticket cannot change');
select tests.as_service();
select results_eq($$ select outcome from app.event_gateway_revoke(tests.op('1'), 'fake', 'OPN8-617') $$, $$ values ('removed'::text) $$,
  'fixture: the refund deletes the going ticket of 617');
reset role;
select is((select count(*)::int from tests.op_marks m where m.event_id = tests.op('609') and m.user_id = tests.op('617')), 0,
  'OPEN-13: ...and the mark went with the row');

-- EP-30: the new column is in no index and in no ordering; equal instants keep the order by (responded_at, id).
select is((select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'event_attendances' and indexdef ~ 'ticket_confirmed_at'), 0,
  'EP-30: ticket_confirmed_at is in no index');
select is(
  (select string_agg(a.user_id::text, ',' order by a.responded_at, a.id) from public.event_attendances a where a.event_id = tests.op('60f')),
  tests.op('621')::text || ',' || tests.op('620')::text,
  'EP-30: two rows confirmed in the same instant keep their order by (responded_at, id)');

select * from finish();
rollback;
