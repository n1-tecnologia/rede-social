begin;
-- 205-payments-tables.sql — Phase 09.1-05 (PAY-01, PAY-02, PAY-29; D-486, D-488, D-501, D-509; P1, P2, P3, P67-P70;
-- T-09.1-22, T-09.1-25): `payment_integrations`, `payment_products` and `payment_events`, the two store seam
-- functions and the retention sweep, executed inside Postgres.
--
-- 1. SHAPE: the columns, the primary keys, the seven named indexes, the foreign keys (events -> integration,
--    `access_grants_mapping_fk` ON DELETE SET NULL proven by deleting a mapping and reading the grant), every named
--    CHECK, and that NO payload column exists on the inbox (PR-9).
-- 2. CHECKs (23514) and uniqueness (23505): the provider is a lower snake FORMAT; an access mapping carries a name
--    and no target, a store mapping a target and no name; the product id is stored trimmed, 1 to 128 characters,
--    case-sensitive; the link is `https:` with no space and at most 2048 characters; the event vocabulary and the
--    e-mail rule; the GLOBAL (provider, product id) index (a second tenant, or a second row in one tenant, loses:
--    P1, P2); one mapping per store target; one integration per provider and tenant (two providers coexist: P3);
--    the (integration, dedupe key) index.
-- 3. EXPOSURE: RLS on and NOT forced; ZERO policies on `payment_integrations` and `payment_events`, exactly four
--    permissive `authenticated` policies on `payment_products`; no privilege for `anon`, none for `authenticated` on
--    the two zero-policy tables, and no TRUNCATE for `authenticated` on the mappings.
-- 4. CROSS-TENANT NEGATIVES in the tenant lane: an `admin_tenant` reads and writes only its own mappings (identical
--    looking rows in two tenants are told apart, a tenant with none reads the empty set, the assertions compare SETS
--    so insertion order is irrelevant: P67-P70); `support_tenant`, `member`, a null role and a lane without claims
--    read and write nothing; the two zero-policy tables are unreachable from the lane.
-- 5. The store seam: `app.payments_gateway_mode()` and `app.payments_checkout_url(uuid)` for every state of the
--    module row and the integration, pinned to the claim tenant, hardened by catalogue.
-- 6. `app.payment_events_prune(batch)`: deletes only events older than 180 days, in batches, executable by
--    `service_role` only.
--
-- Fixture ids use the `20500000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(129);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-pay-a', 'Pay A', '20500000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-pay-b', 'Pay B', '20500000-0000-4000-8000-000000000002');
select tests.tenant('pgtap-pay-c', 'Pay C', '20500000-0000-4000-8000-000000000003');
select tests.auth_user('admin@pay-a.local', '20500000-0000-4000-8000-0000000000a1');
select tests.auth_user('admin@pay-b.local', '20500000-0000-4000-8000-0000000000b1');

insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('20500000-0000-4000-8000-0000000000f1', '20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a1', 'Produto A', 1990, 'active'),
  ('20500000-0000-4000-8000-0000000000f2', '20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a1', 'Produto A2', 990, 'active'),
  ('20500000-0000-4000-8000-0000000000f3', '20500000-0000-4000-8000-000000000002', '20500000-0000-4000-8000-0000000000b1', 'Produto B', 1990, 'active');

-- One `fake` integration for A and for B; C has none. The sealed value is opaque text here.
insert into public.payment_integrations (id, tenant_id, provider, secret_sealed) values
  ('20500000-0000-4000-8000-0000000000d1', '20500000-0000-4000-8000-000000000001', 'fake', 'v1:1:aaaa:bbbb:cccc'),
  ('20500000-0000-4000-8000-0000000000d2', '20500000-0000-4000-8000-000000000002', 'fake', 'v1:1:dddd:eeee:ffff');

-- Mappings. A: an access product, a store product with a link, a store product with NO link, and 'Abc'.
-- B: an access product and 'abc' (case-different from A's 'Abc', and with the SAME name 'Case').
insert into public.payment_products (id, tenant_id, provider, kind, name, external_product_id, checkout_url, target_id) values
  ('20500000-0000-4000-8000-0000000000e1', '20500000-0000-4000-8000-000000000001', 'fake', 'access', 'Plano Mensal', 'PROD-A', 'https://pay.example/a', null),
  ('20500000-0000-4000-8000-0000000000e2', '20500000-0000-4000-8000-000000000001', 'fake', 'store_product', null, 'PROD-S', 'https://pay.example/s', '20500000-0000-4000-8000-0000000000f1'),
  ('20500000-0000-4000-8000-0000000000e6', '20500000-0000-4000-8000-000000000001', 'fake', 'store_product', null, 'PROD-S2', null, '20500000-0000-4000-8000-0000000000f2'),
  ('20500000-0000-4000-8000-0000000000e4', '20500000-0000-4000-8000-000000000001', 'fake', 'access', 'Case', 'Abc', null, null),
  ('20500000-0000-4000-8000-0000000000e3', '20500000-0000-4000-8000-000000000002', 'fake', 'access', 'Plano B', 'PROD-B', 'https://pay.example/b', null),
  ('20500000-0000-4000-8000-0000000000e5', '20500000-0000-4000-8000-000000000002', 'fake', 'access', 'Case', 'abc', null, null);

-- ── 1. shape ───────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'payment_integrations', 'payment_integrations exists');
select has_table('public', 'payment_products', 'payment_products exists');
select has_table('public', 'payment_events', 'payment_events exists');
select columns_are('public', 'payment_integrations', array[
  'id', 'tenant_id', 'provider', 'secret_sealed', 'secret_key_id', 'secret_set_at', 'last_event_at',
  'created_at', 'updated_at'
], 'payment_integrations has exactly the planned columns');
select columns_are('public', 'payment_products', array[
  'id', 'tenant_id', 'provider', 'kind', 'name', 'external_product_id', 'checkout_url', 'target_id',
  'created_by_user_id', 'created_at', 'updated_at'
], 'payment_products has exactly the planned columns');
select columns_are('public', 'payment_events', array[
  'id', 'tenant_id', 'integration_id', 'provider', 'dedupe_key', 'type', 'effect', 'external_ref', 'order_ref',
  'external_product_id', 'email', 'amount_cents', 'currency', 'recurring', 'valid_until', 'occurred_at', 'received_at',
  'state', 'outcome', 'applied_at', 'mapping_id'
], 'payment_events has exactly the planned columns (09.1-07 added recurring)');
select col_is_pk('public', 'payment_integrations', 'id', 'payment_integrations.id is the primary key');
select col_is_pk('public', 'payment_products', 'id', 'payment_products.id is the primary key');
select col_is_pk('public', 'payment_events', 'id', 'payment_events.id is the primary key');
select has_index('public', 'payment_integrations', 'payment_integrations_tenant_provider_uq', 'one integration per tenant and provider (index)');
select has_index('public', 'payment_products', 'payment_products_provider_ext_uq', 'the GLOBAL (provider, product id) index exists');
select has_index('public', 'payment_products', 'payment_products_target_uq', 'one mapping per store target (index)');
select has_index('public', 'payment_products', 'payment_products_tenant_kind_idx', 'the Pagamentos list index exists');
select has_index('public', 'payment_events', 'payment_events_dedupe_uq', 'the (integration, dedupe key) index exists');
select has_index('public', 'payment_events', 'payment_events_tenant_received_idx', 'the Eventos total-order index exists (P6)');
select has_index('public', 'payment_events', 'payment_events_tenant_ref_idx', 'the terminal-check index exists');
select col_is_fk('public', 'payment_events', 'integration_id', 'payment_events.integration_id is a foreign key');
select is(
  (select confdeltype::text from pg_constraint where conname = 'payment_events_integration_id_payment_integrations_id_fk'),
  'c', 'deleting an integration deletes its events (on delete cascade)');
select is(
  (select confdeltype::text from pg_constraint where conname = 'access_grants_mapping_fk'),
  'n', 'access_grants_mapping_fk is ON DELETE SET NULL');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.payment_products'::regclass and contype = 'c'
      and conname in ('payment_products_provider_chk', 'payment_products_kind_chk', 'payment_products_ext_id_chk',
                      'payment_products_name_chk', 'payment_products_target_chk', 'payment_products_url_chk')),
  6, 'payment_products carries its six named CHECKs');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.payment_events'::regclass and contype = 'c'
      and conname in ('payment_events_type_chk', 'payment_events_effect_chk', 'payment_events_state_chk',
                      'payment_events_outcome_chk', 'payment_events_email_chk', 'payment_events_amount_chk')),
  6, 'payment_events carries its six named CHECKs');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.payment_integrations'::regclass and contype = 'c'
      and conname = 'payment_integrations_provider_chk'),
  1, 'payment_integrations carries its provider CHECK');
select is_empty(
  $$ select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'payment_events'
        and (column_name ~ '(payload|body|raw|cpf|phone|address|customer|buyer|name)' or column_name = 'ip') $$,
  'payment_events has NO payload column and no buyer name, CPF, phone, address or IP (PR-9)');

-- The foreign key access_grants.mapping_id, behaviourally: deleting a mapping forgets which product opened the
-- access without deleting the access.
insert into public.payment_products (id, tenant_id, provider, kind, name, external_product_id)
  values ('20500000-0000-4000-8000-0000000000e9', '20500000-0000-4000-8000-000000000001', 'fake', 'access', 'Tmp', 'PROD-TMP');
insert into public.access_grants (id, tenant_id, email, source, status, provider, external_ref, mapping_id)
  values ('20500000-0000-4000-8000-0000000000c9', '20500000-0000-4000-8000-000000000001', 'fk@pay-a.local',
          'gateway', 'active', 'fake', 'ref-fk', '20500000-0000-4000-8000-0000000000e9');
delete from public.payment_products where id = '20500000-0000-4000-8000-0000000000e9';
select results_eq(
  $$ select mapping_id is null, status from public.access_grants where id = '20500000-0000-4000-8000-0000000000c9' $$,
  $$ values (true, 'active') $$,
  'deleting a mapping nulls access_grants.mapping_id and keeps the access active');

-- ── 2. CHECKs and uniqueness ───────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.payment_integrations (tenant_id, provider, secret_sealed) values ('20500000-0000-4000-8000-000000000003', 'Fake', 'v1') $$,
  '23514', null, 'an integration provider with a capital letter is refused by the format CHECK');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'Fake', 'access', 'x', 'X1') $$,
  '23514', null, 'a mapping provider with a capital letter is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'bundle', 'x', 'X2') $$,
  '23514', null, 'an unknown kind is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'X3') $$,
  '23514', null, 'an access mapping without a name is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'store_product', 'x', 'X4') $$,
  '23514', null, 'a store-product mapping carrying a name (and no target) is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'store_product', 'X5') $$,
  '23514', null, 'a store-product mapping without a target is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id, target_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'x', 'X6', '20500000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'an access mapping carrying a target is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'x', ' X7') $$,
  '23514', null, 'a product id with a leading space is refused (stored trimmed)');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'x', '') $$,
  '23514', null, 'an empty product id is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'x', repeat('p', 129)) $$,
  '23514', null, 'a 129-character product id is refused');
select lives_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'x', repeat('q', 128)) $$,
  'a 128-character product id is accepted');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', repeat('n', 81), 'X8') $$,
  '23514', null, 'an 81-character name is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', ' padded', 'X9') $$,
  '23514', null, 'a padded name is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id, checkout_url) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'x', 'U1', 'http://pay.example/a') $$,
  '23514', null, 'a http: link is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id, checkout_url) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'x', 'U2', 'https://pay.example/a b') $$,
  '23514', null, 'a link with a space is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id, checkout_url) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'x', 'U3', 'https://' || repeat('a', 2041)) $$,
  '23514', null, 'a 2049-character link is refused');
select throws_ok(
  $$ insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect) values ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'k-type', 'order_paid', 'grant') $$,
  '23514', null, 'an event with an unknown type is refused');
select throws_ok(
  $$ insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect) values ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'k-effect', 'other', 'burn') $$,
  '23514', null, 'an event with an unknown effect is refused');
select throws_ok(
  $$ insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect, state) values ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'k-state', 'other', 'none', 'done') $$,
  '23514', null, 'an event with an unknown state is refused');
select throws_ok(
  $$ insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect, outcome) values ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'k-outcome', 'other', 'none', 'wat') $$,
  '23514', null, 'an event with an unknown outcome is refused');
select throws_ok(
  $$ insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect, email) values ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'k-mail', 'other', 'none', 'Buyer@X.local') $$,
  '23514', null, 'an event e-mail with a capital is refused (lower(btrim()) rule)');
select throws_ok(
  $$ insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect, amount_cents) values ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'k-amount', 'other', 'none', -1) $$,
  '23514', null, 'a negative amount is refused');

-- Uniqueness. P2: whichever commits second loses, and the loser learns nothing here but the SQLSTATE.
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000002', 'fake', 'access', 'Roubo', 'PROD-A') $$,
  '23505', null, 'P2: a second tenant registering an id already mapped by another tenant is refused (global unique index)');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'Outra', 'PROD-A') $$,
  '23505', null, 'P1: registering the same (provider, product id) twice in one tenant is refused');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, external_product_id, target_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'store_product', 'PROD-S-DUP', '20500000-0000-4000-8000-0000000000f1') $$,
  '23505', null, 'P1: a second mapping for a store product that already has one is refused (payment_products_target_uq)');
select throws_ok(
  $$ insert into public.payment_integrations (tenant_id, provider, secret_sealed) values ('20500000-0000-4000-8000-000000000001', 'fake', 'v1:1:x:y:z') $$,
  '23505', null, 'P3: a second integration of one provider in one tenant is refused');
select lives_ok(
  $$ insert into public.payment_integrations (tenant_id, provider, secret_sealed) values ('20500000-0000-4000-8000-000000000001', 'fake2', 'v1:1:x:y:z') $$,
  'P3: a second provider in the same tenant coexists (and fake2 is not fake)');
select lives_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake2', 'access', 'Outro gateway', 'PROD-A') $$,
  'the same product id under ANOTHER provider is a different mapping');
select lives_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'Maiusc', 'ABC-X'), ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'Minusc', 'abc-x') $$,
  'P69: ids that differ only in case coexist (compared exactly, case-sensitive)');
insert into public.payment_events (id, tenant_id, integration_id, provider, dedupe_key, type, effect)
  values ('20500000-0000-4000-8000-0000000000aa', '20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'k-dup', 'other', 'none');
select throws_ok(
  $$ insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect) values ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'k-dup', 'other', 'none') $$,
  '23505', null, 'a second event with the same (integration, dedupe key) is refused');
select lives_ok(
  $$ insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect) values ('20500000-0000-4000-8000-000000000002', '20500000-0000-4000-8000-0000000000d2', 'fake', 'k-dup', 'other', 'none') $$,
  'the same dedupe key under ANOTHER integration is a different event');
select throws_ok(
  $$ insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect) values ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000ee', 'fake', 'k-fk', 'other', 'none') $$,
  '23503', null, 'an event for an unknown integration is refused (foreign key)');

-- ── 3. exposure ────────────────────────────────────────────────────────────────────────────────
select is((select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.payment_integrations'::regclass), true,
  'payment_integrations: RLS on and NOT forced');
select is((select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.payment_products'::regclass), true,
  'payment_products: RLS on and NOT forced');
select is((select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.payment_events'::regclass), true,
  'payment_events: RLS on and NOT forced');
select is((select count(*)::int from pg_policy where polrelid = 'public.payment_integrations'::regclass), 0,
  'payment_integrations has ZERO policies (the sealed token is admin-lane only)');
select is((select count(*)::int from pg_policy where polrelid = 'public.payment_events'::regclass), 0,
  'payment_events has ZERO policies (the inbox is admin-lane only)');
select is((select count(*)::int from pg_policy where polrelid = 'public.payment_products'::regclass), 4,
  'payment_products has exactly four policies');
select is(
  (select string_agg(polcmd::text, ',' order by polcmd::text) from pg_policy where polrelid = 'public.payment_products'::regclass),
  'a,d,r,w', 'the four policies are insert, delete, select and update');
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.payment_products'::regclass and polpermissive
      and polroles = array['authenticated'::regrole::oid]),
  4, 'all four are permissive and granted to authenticated only');
select ok(
  not (has_table_privilege('anon', 'public.payment_integrations', 'select') or has_table_privilege('anon', 'public.payment_integrations', 'insert')
    or has_table_privilege('anon', 'public.payment_integrations', 'update') or has_table_privilege('anon', 'public.payment_integrations', 'delete')),
  'anon holds no privilege on payment_integrations');
select ok(
  not (has_table_privilege('anon', 'public.payment_events', 'select') or has_table_privilege('anon', 'public.payment_events', 'insert')
    or has_table_privilege('anon', 'public.payment_events', 'update') or has_table_privilege('anon', 'public.payment_events', 'delete')),
  'anon holds no privilege on payment_events');
select ok(
  not (has_table_privilege('anon', 'public.payment_products', 'select') or has_table_privilege('anon', 'public.payment_products', 'insert')
    or has_table_privilege('anon', 'public.payment_products', 'update') or has_table_privilege('anon', 'public.payment_products', 'delete')),
  'anon holds no privilege on payment_products');
select ok(
  not (has_table_privilege('authenticated', 'public.payment_integrations', 'select') or has_table_privilege('authenticated', 'public.payment_integrations', 'insert')
    or has_table_privilege('authenticated', 'public.payment_integrations', 'update') or has_table_privilege('authenticated', 'public.payment_integrations', 'delete')),
  'authenticated holds no privilege on payment_integrations');
select ok(
  not (has_table_privilege('authenticated', 'public.payment_events', 'select') or has_table_privilege('authenticated', 'public.payment_events', 'insert')
    or has_table_privilege('authenticated', 'public.payment_events', 'update') or has_table_privilege('authenticated', 'public.payment_events', 'delete')),
  'authenticated holds no privilege on payment_events');
select ok(not has_table_privilege('authenticated', 'public.payment_products', 'truncate'),
  'authenticated holds no TRUNCATE on payment_products (RLS does not see it)');
select ok(
  has_table_privilege('authenticated', 'public.payment_products', 'select') and has_table_privilege('authenticated', 'public.payment_products', 'insert')
    and has_table_privilege('authenticated', 'public.payment_products', 'update') and has_table_privilege('authenticated', 'public.payment_products', 'delete'),
  'authenticated keeps select, insert, update and delete on payment_products (the policies decide)');
select ok(
  has_table_privilege('service_role', 'public.payment_integrations', 'select') and has_table_privilege('service_role', 'public.payment_integrations', 'insert')
    and has_table_privilege('service_role', 'public.payment_integrations', 'update') and has_table_privilege('service_role', 'public.payment_integrations', 'delete')
    and has_table_privilege('service_role', 'public.payment_events', 'select') and has_table_privilege('service_role', 'public.payment_events', 'insert')
    and has_table_privilege('service_role', 'public.payment_events', 'update') and has_table_privilege('service_role', 'public.payment_events', 'delete'),
  'the admin lane (service_role) keeps its privileges on the two zero-policy tables');

-- ── 4. cross-tenant negatives in the tenant lane ───────────────────────────────────────────────
select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a1', 'admin_tenant');
select set_eq(
  $$ select external_product_id from public.payment_products $$,
  $$ values ('PROD-A'), ('PROD-S'), ('PROD-S2'), ('Abc'), (repeat('q', 128)), ('ABC-X'), ('abc-x') $$,
  'P67/P70: the admin of A reads exactly A''s mappings (as a SET: insertion order is irrelevant)');
select is_empty(
  $$ select 1 from public.payment_products where tenant_id = '20500000-0000-4000-8000-000000000002' $$,
  'the admin of A reads ZERO of B''s mappings');
select is_empty(
  $$ select 1 from public.payment_products where external_product_id in ('PROD-B', 'abc') $$,
  'the admin of A cannot reach B''s product ids by value either');
select results_eq(
  $$ select external_product_id from public.payment_products where lower(external_product_id) = 'abc' $$,
  array['Abc'],
  'P67: identical-looking rows are told apart: A sees its own Abc, never B''s abc');
select is((select count(*)::int from public.payment_products where name = 'Case'), 1,
  'P67: the name ''Case'' exists in both tenants but A reads exactly one');
select is((select count(*)::int from public.payment_products where external_product_id = 'abc'), 0,
  'P69: the id comparison is exact and case-sensitive inside A (no row for abc)');
select lives_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'Novo', 'PROD-NEW') $$,
  'the admin of A inserts a mapping for A');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000002', 'fake', 'access', 'Intruso', 'PROD-INTRUDER') $$,
  '42501', null, 'the admin of A cannot insert a mapping for B');
select results_eq(
  $$ with u as (update public.payment_products set name = 'Hacked' where tenant_id = '20500000-0000-4000-8000-000000000002' returning 1) select count(*)::int from u $$,
  array[0], 'the admin of A updates zero of B''s mappings');
select results_eq(
  $$ with d as (delete from public.payment_products where tenant_id = '20500000-0000-4000-8000-000000000002' returning 1) select count(*)::int from d $$,
  array[0], 'the admin of A deletes zero of B''s mappings');
select throws_ok(
  $$ update public.payment_products set tenant_id = '20500000-0000-4000-8000-000000000002' where external_product_id = 'PROD-NEW' $$,
  '42501', null, 'the admin of A cannot hand its own mapping to B');
select throws_ok(
  $$ select * from public.payment_integrations $$,
  '42501', null, 'the tenant lane cannot read payment_integrations (no privilege)');
select throws_ok(
  $$ select * from public.payment_events $$,
  '42501', null, 'the tenant lane cannot read payment_events (no privilege)');
select throws_ok(
  $$ insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect) values ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'k-lane', 'other', 'none') $$,
  '42501', null, 'the tenant lane cannot write payment_events');
select results_eq(
  $$ with d as (delete from public.payment_products where external_product_id = 'PROD-NEW' returning 1) select count(*)::int from d $$,
  array[1], 'the admin of A deletes its own mapping');
reset role;

select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a2', 'support_tenant');
select is_empty($$ select 1 from public.payment_products $$, 'a support_tenant of A reads no mapping at all');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'x', 'S-1') $$,
  '42501', null, 'a support_tenant cannot insert a mapping');
reset role;

select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a3', 'member');
select is_empty($$ select 1 from public.payment_products $$, 'a member of A reads no mapping at all');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values ('20500000-0000-4000-8000-000000000001', 'fake', 'access', 'x', 'M-1') $$,
  '42501', null, 'a member cannot insert a mapping');
select results_eq(
  $$ with u as (update public.payment_products set name = 'Hacked' returning 1) select count(*)::int from u $$,
  array[0], 'a member updates zero mappings');
select results_eq(
  $$ with d as (delete from public.payment_products returning 1) select count(*)::int from d $$,
  array[0], 'a member deletes zero mappings');
reset role;

select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a1', null);
select is_empty($$ select 1 from public.payment_products $$, 'a lane with a NULL role claim reads no mapping (fails closed)');
reset role;
select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a1', 'owner');
select is_empty($$ select 1 from public.payment_products $$, 'a lane with an unknown role claim reads no mapping');
reset role;
select tests.as_tenant_without_claims();
select is_empty($$ select 1 from public.payment_products $$, 'a lane with NO claims reads no mapping');
reset role;

-- P68: a tenant that registered nothing reads the empty set, not an error.
select tests.as_tenant('20500000-0000-4000-8000-000000000003', '20500000-0000-4000-8000-0000000000c1', 'admin_tenant');
select is_empty($$ select 1 from public.payment_products $$, 'P68: a tenant with no mappings reads the empty set');
select is((select count(*)::int from public.payment_products), 0, 'P68: and counts zero');
reset role;

select tests.as_tenant('20500000-0000-4000-8000-000000000002', '20500000-0000-4000-8000-0000000000b1', 'admin_tenant');
select set_eq(
  $$ select external_product_id from public.payment_products $$,
  $$ values ('PROD-B'), ('abc') $$,
  'P67: the admin of B reads exactly B''s two mappings');
reset role;

-- ── 5. the store seam ──────────────────────────────────────────────────────────────────────────
-- A has an integration but no `payments` row; B has an integration but no row; C has neither.
select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a1', 'admin_tenant');
select is(app.payments_gateway_mode(), false, 'mode: an integration without a payments module row is off');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000f1'), null, 'checkout url: null while the mode is off');
reset role;

insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('20500000-0000-4000-8000-000000000001', 'payments', false),
  ('20500000-0000-4000-8000-000000000003', 'payments', true);
select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a1', 'admin_tenant');
select is(app.payments_gateway_mode(), false, 'mode: an integration with the module DISABLED is off');
reset role;
select tests.as_tenant('20500000-0000-4000-8000-000000000003', '20500000-0000-4000-8000-0000000000c1', 'admin_tenant');
select is(app.payments_gateway_mode(), false, 'mode: the module enabled with NO integration is off');
reset role;

update public.tenant_modules set enabled = true
 where tenant_id = '20500000-0000-4000-8000-000000000001' and module_key = 'payments';
select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a1', 'admin_tenant');
select is(app.payments_gateway_mode(), true, 'mode: the module enabled AND an integration is on');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000f1'), 'https://pay.example/s',
  'checkout url: the admin of A reads the stored link of the mapped store product');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000f2'), null,
  'checkout url: a mapped store product with NO link answers null');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000e1'), null,
  'checkout url: the id of an ACCESS mapping (not a store product) answers null');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000ff'), null,
  'checkout url: an unknown product answers null');
reset role;
select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a2', 'support_tenant');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000f1'), 'https://pay.example/s',
  'checkout url: a support_tenant of A reads it too');
reset role;
select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a3', 'member');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000f1'), 'https://pay.example/s',
  'checkout url: a member of A reads it (a member needs the link to buy)');
select is(app.payments_gateway_mode(), true, 'mode: a member of A sees the mode');
reset role;

select tests.as_tenant('20500000-0000-4000-8000-000000000002', '20500000-0000-4000-8000-0000000000b1', 'admin_tenant');
select is(app.payments_gateway_mode(), false, 'mode: tenant B (an integration, no module row) is off even though A is on');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000f1'), null,
  'checkout url: B''s claim asking for A''s product answers null (pinned to the claim tenant)');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '20500000-0000-4000-8000-000000000003' and module_key = 'payments';
insert into public.tenant_modules (tenant_id, module_key, enabled)
  values ('20500000-0000-4000-8000-000000000002', 'payments', true);
select tests.as_tenant('20500000-0000-4000-8000-000000000002', '20500000-0000-4000-8000-0000000000b1', 'admin_tenant');
select is(app.payments_gateway_mode(), true, 'mode: B is on once its own module row is enabled');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000f1'), null,
  'checkout url: still null for A''s product, B being on does not widen what it can read');
reset role;

select tests.as_tenant_without_claims();
select is(app.payments_gateway_mode(), false, 'mode: a lane without claims is off');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000f1'), null, 'checkout url: a lane without claims gets null');
reset role;

update public.tenant_modules set enabled = false
 where tenant_id = '20500000-0000-4000-8000-000000000001' and module_key = 'payments';
select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a1', 'admin_tenant');
select is(app.payments_checkout_url('20500000-0000-4000-8000-0000000000f1'), null,
  'checkout url: turning the module off hides the link again');
reset role;

select ok(
  (select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('payments_gateway_mode', 'payments_checkout_url')),
  'both seam functions are SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('payments_gateway_mode', 'payments_checkout_url')
      and p.proconfig @> array['search_path=""']),
  2, 'both seam functions pin an empty search_path');
select ok(
  has_function_privilege('authenticated', 'app.payments_gateway_mode()', 'execute')
    and has_function_privilege('authenticated', 'app.payments_checkout_url(uuid)', 'execute'),
  'authenticated may execute both seam functions');
select ok(
  not (has_function_privilege('anon', 'app.payments_gateway_mode()', 'execute')
    or has_function_privilege('anon', 'app.payments_checkout_url(uuid)', 'execute')),
  'anon may execute neither seam function');

-- ── 6. the retention sweep ─────────────────────────────────────────────────────────────────────
insert into public.payment_events (tenant_id, integration_id, provider, dedupe_key, type, effect, received_at) values
  ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'old-1', 'other', 'none', now() - interval '181 days'),
  ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'old-2', 'other', 'none', now() - interval '400 days'),
  ('20500000-0000-4000-8000-000000000002', '20500000-0000-4000-8000-0000000000d2', 'fake', 'old-3', 'other', 'none', now() - interval '180 days' - interval '1 minute'),
  ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'young-1', 'other', 'none', now() - interval '179 days 23 hours'),
  ('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000d1', 'fake', 'young-2', 'other', 'none', now());
select tests.as_service();
select is(app.payment_events_prune(2), 2, 'prune: a batch of 2 deletes at most 2 old events');
select is(app.payment_events_prune(10), 1, 'prune: the next call deletes the one that remains');
select is(app.payment_events_prune(10), 0, 'prune: nothing older than 180 days is left');
select is(
  (select count(*)::int from public.payment_events where dedupe_key in ('young-1', 'young-2', 'k-dup')),
  4, 'prune: a 179-day-23-hour event, a fresh one and the two k-dup fixtures stay');
select is(
  (select count(*)::int from public.payment_events where dedupe_key in ('old-1', 'old-2', 'old-3')),
  0, 'prune: the three old events (both tenants) are gone');
reset role;
select tests.as_tenant('20500000-0000-4000-8000-000000000001', '20500000-0000-4000-8000-0000000000a1', 'admin_tenant');
select throws_ok($$ select app.payment_events_prune(10) $$, '42501', null,
  'prune: a tenant lane cannot call it (the sweep is cross-tenant)');
reset role;
select ok(
  has_function_privilege('service_role', 'app.payment_events_prune(integer)', 'execute')
    and not has_function_privilege('authenticated', 'app.payment_events_prune(integer)', 'execute')
    and not has_function_privilege('anon', 'app.payment_events_prune(integer)', 'execute'),
  'prune: EXECUTE for service_role only');

select * from finish();
rollback;
