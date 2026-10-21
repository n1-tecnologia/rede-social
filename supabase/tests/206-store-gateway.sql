begin;
-- 206-store-gateway.sql — Phase 09.1-06 (PAY-23..PAY-27; D-359, D-505..D-509; P56, P57, P59, P60, P62, P63; T-09.1-26..31):
-- the store half of the gateway, executed inside Postgres.
--
-- 1. THE ORDER COLUMNS: `store_orders_provider_chk` accepts `none` and a lower-case gateway name and refuses a
--    capital, a space, a leading digit, one character and 32 characters (23514); `store_orders_provider_ref_uq`
--    refuses a second LIVE order with the same (tenant, provider, reference) (23505) while a revoked row, another
--    tenant and two simulated orders with no reference do not conflict.
-- 2. `app.store_gateway_purchase` (outcome matrix): `purchased` with the order, the product name and the buyer, the
--    order and entitlement read back (provider, trimmed reference, amount, paid_at), `already_active` on a replay
--    and when a grant exists, an ARCHIVED product granted, amounts 0 and 10 000 000 accepted, and `not_found` for a
--    membership of another tenant, a blocked, a deleted and an invited membership, a product of another tenant,
--    every NULL argument, a provider with a capital or a space, an empty, blank, 201-character and control-character
--    reference, and amounts -1 and 10 000 001, with nothing written.
-- 3. `app.store_gateway_revoke`: `revoked` ends the entitlement and the order (`revoked_by_user_id` null), a second
--    call, another tenant's reference, another provider, another case and every NULL are `not_found`, and after the
--    revoke the same reference buys again as a NEW order (D-359).
-- 4. PRIVILEGES: both definers executable by `service_role` only; a member lane calling them is refused (42501);
--    no policy was added to the ledgers and the tenant lane still holds no write privilege on them (STORE-20).
-- 5. THE GUARD: `app.store_purchase` under claims refuses a non-holder of a gateway tenant (`unavailable`, nothing
--    written) and answers a holder `owned`; with the module disabled, or with the integration removed, the simulated
--    purchase works as before (provider `none`, the price copied); a tenant with no gateway is unaffected by another
--    tenant's mode.
-- 6. THE MAPPING FOREIGN KEY: `payment_products_target_fk` deletes a product's mapping with the product, a mapping
--    for a product that does not exist is refused (23503), and `app.payments_checkout_url` is pinned to the claim
--    tenant.
-- 7. THE SEAM FUNCTIONS: `app.store_product_name_for` (service_role only, pinned to the tenant) and
--    `app.store_product_exists` (tenant lane).
-- 8. HARDENING by catalogue: SECURITY DEFINER with an empty search_path on all five functions.
--
-- Fixture ids use the `20600000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(124);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-sgw-a', 'Gateway A', '20600000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-sgw-b', 'Gateway B', '20600000-0000-4000-8000-000000000002');
select tests.auth_user('admin@sgw-a.local', '20600000-0000-4000-8000-0000000000a1');
select tests.auth_user('m1@sgw-a.local', '20600000-0000-4000-8000-0000000000a2');
select tests.auth_user('blocked@sgw-a.local', '20600000-0000-4000-8000-0000000000a3');
select tests.auth_user('deleted@sgw-a.local', '20600000-0000-4000-8000-0000000000a4');
select tests.auth_user('invited@sgw-a.local', '20600000-0000-4000-8000-0000000000a5');
select tests.auth_user('m5@sgw-a.local', '20600000-0000-4000-8000-0000000000a6');
select tests.auth_user('m6@sgw-a.local', '20600000-0000-4000-8000-0000000000a7');
select tests.auth_user('admin@sgw-b.local', '20600000-0000-4000-8000-0000000000b1');
select tests.auth_user('mb@sgw-b.local', '20600000-0000-4000-8000-0000000000b2');

insert into public.memberships (id, tenant_id, user_id, role, status, blocked_at, deleted_at) values
  ('20600000-0000-4000-8000-0000000001a1', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a1', 'admin_tenant', 'active', null, null),
  ('20600000-0000-4000-8000-0000000001a2', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2', 'member', 'active', null, null),
  ('20600000-0000-4000-8000-0000000001a3', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a3', 'member', 'blocked', now(), null),
  ('20600000-0000-4000-8000-0000000001a4', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a4', 'member', 'active', null, now()),
  ('20600000-0000-4000-8000-0000000001a5', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a5', 'member', 'invited', null, null),
  ('20600000-0000-4000-8000-0000000001a6', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a6', 'member', 'active', null, null),
  ('20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a7', 'member', 'active', null, null),
  ('20600000-0000-4000-8000-0000000001b1', '20600000-0000-4000-8000-000000000002', '20600000-0000-4000-8000-0000000000b1', 'admin_tenant', 'active', null, null),
  ('20600000-0000-4000-8000-0000000001b2', '20600000-0000-4000-8000-000000000002', '20600000-0000-4000-8000-0000000000b2', 'member', 'active', null, null);

insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('20600000-0000-4000-8000-0000000000f1', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a1', 'Produto A1', 1990, 'active'),
  ('20600000-0000-4000-8000-0000000000f2', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a1', 'Produto A2', 500, 'active'),
  ('20600000-0000-4000-8000-0000000000f3', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a1', 'Arquivado A', 300, 'archived'),
  ('20600000-0000-4000-8000-0000000000f4', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a1', 'Produto A3', 1200, 'active'),
  ('20600000-0000-4000-8000-0000000000f5', '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a1', 'Produto Fk', 100, 'active'),
  ('20600000-0000-4000-8000-0000000000f6', '20600000-0000-4000-8000-000000000002', '20600000-0000-4000-8000-0000000000b1', 'Produto B1', 1990, 'active');

-- Shorthand for the purchase definer: (tenant, membership, product, provider, reference, amount), paid_at NULL.
create function pg_temp.gp(p_t uuid, p_m uuid, p_p uuid, p_prov text, p_ref text, p_amt integer)
returns text language sql as $$
  select outcome from app.store_gateway_purchase(p_t, p_m, p_p, p_prov, p_ref, p_amt, null)
$$;

-- ── 1. the order columns ───────────────────────────────────────────────────────────────────────
select has_index('public', 'store_orders', 'store_orders_provider_ref_uq', 'the live provider-reference arbiter exists');
select lives_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2', '20600000-0000-4000-8000-0000000000f5', 'revoked', 100, 'BRL', 'none') $$,
  'provider none is accepted (the simulated sale)');
select lives_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2', '20600000-0000-4000-8000-0000000000f5', 'revoked', 100, 'BRL', 'acme_pay2') $$,
  'a lower-case gateway name is accepted (a format, not an enum)');
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2', '20600000-0000-4000-8000-0000000000f5', 'revoked', 100, 'BRL', 'Acme') $$,
  '23514', null, 'a provider with a capital letter is refused');
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2', '20600000-0000-4000-8000-0000000000f5', 'revoked', 100, 'BRL', 'ac me') $$,
  '23514', null, 'a provider with a space is refused');
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2', '20600000-0000-4000-8000-0000000000f5', 'revoked', 100, 'BRL', '1acme') $$,
  '23514', null, 'a provider with a leading digit is refused');
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2', '20600000-0000-4000-8000-0000000000f5', 'revoked', 100, 'BRL', 'a') $$,
  '23514', null, 'a one-character provider is refused');
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2', '20600000-0000-4000-8000-0000000000f5', 'revoked', 100, 'BRL', 'a' || repeat('b', 31)) $$,
  '23514', null, 'a 32-character provider is refused');
select lives_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider, provider_ref, paid_at)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2', '20600000-0000-4000-8000-0000000000f4', 'paid', 100, 'BRL', 'acme', 'R-UQ', now()) $$,
  'a live order with a gateway reference is accepted');
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider, provider_ref, paid_at)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a6', '20600000-0000-4000-8000-0000000000f2', 'paid', 100, 'BRL', 'acme', 'R-UQ', now()) $$,
  '23505', null, 'a second LIVE order with the same (tenant, provider, reference) is refused');
select lives_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider, provider_ref, paid_at, revoked_at)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a6', '20600000-0000-4000-8000-0000000000f2', 'revoked', 100, 'BRL', 'acme', 'R-UQ', now(), now()) $$,
  'a REVOKED order with the same reference does not conflict (history, then a renewal)');
select lives_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider, provider_ref, paid_at)
     values ('20600000-0000-4000-8000-000000000002', '20600000-0000-4000-8000-0000000000b2', '20600000-0000-4000-8000-0000000000f6', 'paid', 100, 'BRL', 'acme', 'R-UQ', now()) $$,
  'the same reference in ANOTHER tenant does not conflict');
select lives_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider, paid_at)
     values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a6', '20600000-0000-4000-8000-0000000000f4', 'paid', 100, 'BRL', 'none', now()),
            ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a7', '20600000-0000-4000-8000-0000000000f4', 'paid', 100, 'BRL', 'none', now()) $$,
  'two simulated live orders with NO reference do not conflict (NULL is not a key)');
delete from public.store_orders where tenant_id in ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-000000000002');
select is_empty($$ select 1 from public.store_orders where tenant_id in ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-000000000002') $$,
  '…and the section 1 fixture orders are gone');

-- ── 2. app.store_gateway_purchase ──────────────────────────────────────────────────────────────
-- Expected rows: M1 x A2 (the main sale), M5 x A2 (a grant first), M1 x Arch, M5 x A1 (amount 0), M5 x A3 (the
-- ceiling), M1 x A1 (paid_at NULL).
select results_eq(
  $$ select outcome, order_id is not null, product_name, user_id from app.store_gateway_purchase(
       '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a2', '20600000-0000-4000-8000-0000000000f2',
       'acme', '  R-MAIN  ', 12345, '2026-10-01T12:00:00Z') $$,
  $$ values ('purchased'::text, true, 'Produto A2'::text, '20600000-0000-4000-8000-0000000000a2'::uuid) $$,
  'a live member of the tenant buys: purchased, with the order, the product name and the buyer');
select results_eq(
  $$ select provider, provider_ref, amount_cents, currency, status, paid_at, revoked_at is null from public.store_orders
      where user_id = '20600000-0000-4000-8000-0000000000a2' and product_id = '20600000-0000-4000-8000-0000000000f2' $$,
  $$ values ('acme'::text, 'R-MAIN'::text, 12345, 'BRL'::text, 'paid'::text, '2026-10-01T12:00:00Z'::timestamptz, true) $$,
  '…the order carries the gateway, the TRIMMED reference, the amount charged (12345 on a product listed at 500), BRL, paid_at');
select results_eq(
  $$ select e.source, e.status, e.granted_by_user_id is null, e.order_id = o.id
       from public.store_entitlements e join public.store_orders o on o.id = e.order_id
      where e.user_id = '20600000-0000-4000-8000-0000000000a2' and e.product_id = '20600000-0000-4000-8000-0000000000f2' $$,
  $$ values ('purchase'::text, 'active'::text, true, true) $$,
  '…and an ACTIVE purchase entitlement linked to that order');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a2', '20600000-0000-4000-8000-0000000000f2', 'acme', 'R-MAIN', 12345) $$,
  ARRAY['already_active'], 'the same delivery again (P56): already_active');
select results_eq(
  $$ select (select count(*)::int from public.store_orders where product_id = '20600000-0000-4000-8000-0000000000f2'),
            (select count(*)::int from public.store_entitlements where product_id = '20600000-0000-4000-8000-0000000000f2') $$,
  $$ values (1, 1) $$, '…and left ONE order and ONE entitlement');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a2', '20600000-0000-4000-8000-0000000000f2', 'acme', 'R-OTHER', 12345) $$,
  ARRAY['already_active'], 'another reference for a member who already holds the product: already_active (no second order)');

insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id)
  values ('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a6', '20600000-0000-4000-8000-0000000000f2', 'grant', '20600000-0000-4000-8000-0000000000a1');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a6', '20600000-0000-4000-8000-0000000000f2', 'acme', 'R-GRANTED', 500) $$,
  ARRAY['already_active'], 'a member who holds the product through an admin GRANT: already_active (A-P27)');
select is_empty(
  $$ select 1 from public.store_orders where provider_ref = 'R-GRANTED' $$, '…and NO order was written for it');

select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a2', '20600000-0000-4000-8000-0000000000f3', 'acme', 'R-ARCH', 300) $$,
  ARRAY['purchased'], 'an ARCHIVED product is still granted: the money was paid');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a6', '20600000-0000-4000-8000-0000000000f1', 'acme', 'R-FREE', 0) $$,
  ARRAY['purchased'], 'P59: amount 0 (a free sale) is accepted');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a6', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-MAX', 10000000) $$,
  ARRAY['purchased'], 'P59: amount 10 000 000 (the store ceiling) is accepted');
select results_eq(
  $$ select amount_cents from public.store_orders where provider_ref in ('R-FREE', 'R-MAX') order by amount_cents $$,
  ARRAY[0, 10000000], '…and both are stored exactly');
select results_eq(
  $$ select outcome, order_id is not null from app.store_gateway_purchase(
       '20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a2', '20600000-0000-4000-8000-0000000000f1',
       'acme', 'R-NOW', 1990, null) $$,
  $$ values ('purchased'::text, true) $$, 'a NULL paid_at is allowed (the arrival time is used)');
select ok(
  (select paid_at between now() - interval '1 minute' and now() + interval '1 minute' from public.store_orders where provider_ref = 'R-NOW'),
  '…and paid_at is then now()');

-- not_found: each case on a pair that would otherwise succeed, so a wrong outcome would write an order.
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001b2', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-NF1', 100) $$,
  ARRAY['not_found'], 'a membership of ANOTHER tenant called with this tenant: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a3', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-NF2', 100) $$,
  ARRAY['not_found'], 'a BLOCKED membership: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a4', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-NF3', 100) $$,
  ARRAY['not_found'], 'a soft-DELETED membership: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a5', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-NF4', 100) $$,
  ARRAY['not_found'], 'an INVITED membership: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f6', 'acme', 'R-NF5', 100) $$,
  ARRAY['not_found'], 'a product of ANOTHER tenant called with this tenant: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000002', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-NF6', 100) $$,
  ARRAY['not_found'], 'a membership and a product of tenant A called with tenant B: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', gen_random_uuid(), 'acme', 'R-NF7', 100) $$,
  ARRAY['not_found'], 'an unknown product: not_found');
select results_eq(
  $$ select pg_temp.gp(null, '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-NF8', 100) $$,
  ARRAY['not_found'], 'P62: a NULL tenant: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', null, '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-NF9', 100) $$,
  ARRAY['not_found'], 'P62: a NULL membership: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', null, 'acme', 'R-NF10', 100) $$,
  ARRAY['not_found'], 'P62: a NULL product: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', null, 'R-NF11', 100) $$,
  ARRAY['not_found'], 'P62: a NULL provider: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', null, 100) $$,
  ARRAY['not_found'], 'P62: a NULL reference: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-NF12', null) $$,
  ARRAY['not_found'], 'P62: a NULL amount: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'Acme', 'R-NF13', 100) $$,
  ARRAY['not_found'], 'P63: a provider with a capital letter: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'ac me', 'R-NF14', 100) $$,
  ARRAY['not_found'], 'P63: a provider with a space: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'a', 'R-NF15', 100) $$,
  ARRAY['not_found'], 'P63: a one-character provider: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', '', 100) $$,
  ARRAY['not_found'], 'P62: an empty reference: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', E'  \t\r\n ', 100) $$,
  ARRAY['not_found'], 'P62: a blank reference: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', repeat('x', 201), 100) $$,
  ARRAY['not_found'], 'P63: a 201-character reference: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', 'a' || chr(1) || 'b', 100) $$,
  ARRAY['not_found'], 'P63: a reference with a control character: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-NF16', -1) $$,
  ARRAY['not_found'], 'P59: amount -1: not_found');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-NF17', 10000001) $$,
  ARRAY['not_found'], 'P59: amount 10 000 001: not_found');
select is_empty(
  $$ select 1 from public.store_orders where provider_ref like 'R-NF%' or provider_ref like 'x%' or provider_ref like 'a%b' $$,
  '…and not one of the refused calls wrote an order');
select is_empty(
  $$ select 1 from public.store_entitlements where user_id = '20600000-0000-4000-8000-0000000000a7' $$,
  '…or an entitlement');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', 'Ref-ünï', 700) $$,
  ARRAY['purchased'], 'P63: any non-control UTF-8 is a valid reference');
select results_eq(
  $$ select provider_ref from public.store_orders where user_id = '20600000-0000-4000-8000-0000000000a7' $$,
  ARRAY['Ref-ünï'], '…and it is stored byte for byte');
delete from public.store_entitlements where user_id = '20600000-0000-4000-8000-0000000000a7';
delete from public.store_orders where user_id = '20600000-0000-4000-8000-0000000000a7';

-- ── 3. app.store_gateway_revoke ────────────────────────────────────────────────────────────────
select results_eq(
  $$ select outcome, user_id, product_id from app.store_gateway_revoke('20600000-0000-4000-8000-000000000002', 'acme', 'R-MAIN') $$,
  $$ values ('not_found'::text, null::uuid, null::uuid) $$,
  'another tenant''s call for this reference: not_found (the reference is tenant-pinned)');
select results_eq(
  $$ select outcome from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', 'other', 'R-MAIN') $$,
  ARRAY['not_found'], 'another provider: not_found');
select results_eq(
  $$ select outcome from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', 'acme', 'r-main') $$,
  ARRAY['not_found'], 'P63: the reference is compared exactly, case included: not_found');
select results_eq(
  $$ select outcome from app.store_gateway_revoke(null, 'acme', 'R-MAIN') $$,
  ARRAY['not_found'], 'P62: a NULL tenant: not_found');
select results_eq(
  $$ select outcome from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', null, 'R-MAIN') $$,
  ARRAY['not_found'], 'P62: a NULL provider: not_found');
select results_eq(
  $$ select outcome from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', 'acme', null) $$,
  ARRAY['not_found'], 'P62: a NULL reference: not_found');
select results_eq(
  $$ select outcome from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', 'acme', '   ') $$,
  ARRAY['not_found'], 'P62: a blank reference: not_found');
select results_eq(
  $$ select outcome from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', 'Acme', 'R-MAIN') $$,
  ARRAY['not_found'], 'P63: a provider with a capital: not_found');
select results_eq(
  $$ select (select status from public.store_orders where provider_ref = 'R-MAIN'),
            (select status from public.store_entitlements where user_id = '20600000-0000-4000-8000-0000000000a2' and product_id = '20600000-0000-4000-8000-0000000000f2') $$,
  $$ values ('paid'::text, 'active'::text) $$, '…none of the refused revokes changed the sale');
select results_eq(
  $$ select outcome, user_id, product_id from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', 'acme', E'  R-MAIN\t') $$,
  $$ values ('revoked'::text, '20600000-0000-4000-8000-0000000000a2'::uuid, '20600000-0000-4000-8000-0000000000f2'::uuid) $$,
  'the refund (reference trimmed): revoked, with the member and the product');
select results_eq(
  $$ select o.status, o.revoked_at is not null, o.revoked_by_user_id is null, e.status, e.revoked_at is not null, e.revoked_by_user_id is null
       from public.store_orders o join public.store_entitlements e on e.order_id = o.id where o.provider_ref = 'R-MAIN' $$,
  $$ values ('revoked'::text, true, true, 'revoked'::text, true, true) $$,
  '…the order and the entitlement are revoked, by no person (revoked_by_user_id null)');
select results_eq(
  $$ select outcome from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', 'acme', 'R-MAIN') $$,
  ARRAY['not_found'], 'P56: the same refund again: not_found');
select results_eq(
  $$ select count(*)::int from public.store_orders where provider_ref = 'R-MAIN' $$,
  ARRAY[1], '…and changed nothing (rows are history, never deleted)');
select results_eq(
  $$ select pg_temp.gp('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a2', '20600000-0000-4000-8000-0000000000f2', 'acme', 'R-MAIN', 12345) $$,
  ARRAY['purchased'], 'D-359: after the revoke the SAME reference buys again: purchased');
select results_eq(
  $$ select (select count(*)::int from public.store_orders where provider_ref = 'R-MAIN'),
            (select count(*)::int from public.store_orders where provider_ref = 'R-MAIN' and status = 'paid'),
            (select count(*)::int from public.store_entitlements where user_id = '20600000-0000-4000-8000-0000000000a2' and product_id = '20600000-0000-4000-8000-0000000000f2'),
            (select count(*)::int from public.store_entitlements where user_id = '20600000-0000-4000-8000-0000000000a2' and product_id = '20600000-0000-4000-8000-0000000000f2' and status = 'active') $$,
  $$ values (2, 1, 2, 1) $$, '…a NEW order and a NEW entitlement beside the revoked history');
select results_eq(
  $$ select outcome from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', 'acme', 'R-GRANTED') $$,
  ARRAY['not_found'], 'a reference that never had an order (the sale was a no-op): not_found');
select results_eq(
  $$ select status from public.store_entitlements where user_id = '20600000-0000-4000-8000-0000000000a6' and product_id = '20600000-0000-4000-8000-0000000000f2' $$,
  ARRAY['active'], '…and the member''s admin grant is untouched');

-- ── 4. privileges and the ledgers ──────────────────────────────────────────────────────────────
select ok(has_function_privilege('service_role', 'app.store_gateway_purchase(uuid, uuid, uuid, text, text, integer, timestamptz)', 'execute'),
  'service_role may execute app.store_gateway_purchase');
select ok(not has_function_privilege('authenticated', 'app.store_gateway_purchase(uuid, uuid, uuid, text, text, integer, timestamptz)', 'execute'),
  '…authenticated may not');
select ok(not has_function_privilege('anon', 'app.store_gateway_purchase(uuid, uuid, uuid, text, text, integer, timestamptz)', 'execute'),
  '…anon may not');
select ok(has_function_privilege('service_role', 'app.store_gateway_revoke(uuid, text, text)', 'execute'),
  'service_role may execute app.store_gateway_revoke');
select ok(not has_function_privilege('authenticated', 'app.store_gateway_revoke(uuid, text, text)', 'execute'),
  '…authenticated may not');
select ok(not has_function_privilege('anon', 'app.store_gateway_revoke(uuid, text, text)', 'execute'),
  '…anon may not');
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.store_orders'::regclass), 1,
  'store_orders still has exactly ONE policy (the select policy): no write policy was added (STORE-20)');
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.store_entitlements'::regclass), 1,
  'store_entitlements still has exactly ONE policy (the select policy)');
select ok(
  not has_table_privilege('authenticated', 'public.store_orders', 'insert')
  and not has_table_privilege('authenticated', 'public.store_orders', 'update')
  and not has_table_privilege('authenticated', 'public.store_orders', 'delete')
  and not has_table_privilege('authenticated', 'public.store_orders', 'truncate'),
  'authenticated holds no write privilege on store_orders');
select ok(
  not has_table_privilege('authenticated', 'public.store_entitlements', 'insert')
  and not has_table_privilege('authenticated', 'public.store_entitlements', 'update')
  and not has_table_privilege('authenticated', 'public.store_entitlements', 'delete')
  and not has_table_privilege('authenticated', 'public.store_entitlements', 'truncate'),
  'authenticated holds no write privilege on store_entitlements');
select tests.as_tenant('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a7');
select throws_ok(
  $$ select * from app.store_gateway_purchase('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-LANE', 100, null) $$,
  '42501', null, 'a member lane calling app.store_gateway_purchase is refused (T-09.1-27)');
select throws_ok(
  $$ select * from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', 'acme', 'R-MAIN') $$,
  '42501', null, 'a member lane calling app.store_gateway_revoke is refused');
reset role;
select tests.as_tenant('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a1', 'admin_tenant');
select throws_ok(
  $$ select * from app.store_gateway_purchase('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-LANE2', 100, null) $$,
  '42501', null, 'even an admin_tenant lane is refused: only the admin lane (service_role) writes a gateway sale');
reset role;
select tests.as_service();
select results_eq(
  $$ select outcome from app.store_gateway_purchase('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000001a7', '20600000-0000-4000-8000-0000000000f4', 'acme', 'R-SVC', 100, null) $$,
  ARRAY['purchased'], 'the admin lane (service_role) calls app.store_gateway_purchase');
select results_eq(
  $$ select outcome from app.store_gateway_revoke('20600000-0000-4000-8000-000000000001', 'acme', 'R-SVC') $$,
  ARRAY['revoked'], '…and app.store_gateway_revoke');
reset role;

-- M6 is a clean non-holder again for the guard section (the section 4 sale was history only).
delete from public.store_entitlements where user_id = '20600000-0000-4000-8000-0000000000a7';
delete from public.store_orders where user_id = '20600000-0000-4000-8000-0000000000a7';

-- ── 5. the guard in app.store_purchase ─────────────────────────────────────────────────────────
-- Tenant A gets the payments module ENABLED and an integration; B has neither. M6 holds nothing; M1 holds A1 and
-- Arch (sections 2); M5 holds A1 (amount 0) and A3.
insert into public.tenant_modules (tenant_id, module_key, enabled, settings)
  values ('20600000-0000-4000-8000-000000000001', 'payments', true, '{}');
insert into public.payment_integrations (id, tenant_id, provider, secret_sealed)
  values ('20600000-0000-4000-8000-0000000000d1', '20600000-0000-4000-8000-000000000001', 'fake', 'v1:1:aaaa:bbbb:cccc');
select tests.as_tenant('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a7');
select results_eq(
  $$ select outcome, order_id from app.store_purchase('20600000-0000-4000-8000-0000000000f1', 1990) $$,
  $$ values ('unavailable'::text, null::uuid) $$,
  'T-09.1-26: a non-holder of a gateway tenant gets unavailable (even at the right price)');
select results_eq(
  $$ select outcome from app.store_purchase('20600000-0000-4000-8000-0000000000f1', 1) $$,
  ARRAY['unavailable'], '…and at a stale price too: the guard runs before the price check');
select results_eq(
  $$ select outcome from app.store_purchase('20600000-0000-4000-8000-0000000000f3', 300) $$,
  ARRAY['unavailable'], '…and for an archived product');
select is_empty(
  $$ select 1 from public.store_orders where user_id = '20600000-0000-4000-8000-0000000000a7' $$,
  '…and nothing was written');
select results_eq(
  $$ select outcome from app.store_purchase(gen_random_uuid(), 1990) $$,
  ARRAY['not_found'], 'an unknown product is still not_found, not unavailable');
reset role;
select tests.as_tenant('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2');
select results_eq(
  $$ select outcome from app.store_purchase('20600000-0000-4000-8000-0000000000f1', 1990) $$,
  ARRAY['owned'], 'a HOLDER replaying still gets owned (the held check runs before the guard)');
select results_eq(
  $$ select outcome from app.store_purchase('20600000-0000-4000-8000-0000000000f3', 1) $$,
  ARRAY['owned'], '…also for an archived product with a stale price');
reset role;

-- The module disabled: the gateway is off, the simulated purchase works exactly as before.
update public.tenant_modules set enabled = false
 where tenant_id = '20600000-0000-4000-8000-000000000001' and module_key = 'payments';
select tests.as_tenant('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a7');
select results_eq(
  $$ select outcome, order_id is not null from app.store_purchase('20600000-0000-4000-8000-0000000000f1', 1990) $$,
  $$ values ('purchased'::text, true) $$, 'with the payments module DISABLED the simulated purchase works');
select results_eq(
  $$ select provider, provider_ref is null, amount_cents, status from public.store_orders
      where user_id = '20600000-0000-4000-8000-0000000000a7' and product_id = '20600000-0000-4000-8000-0000000000f1' $$,
  $$ values ('none'::text, true, 1990, 'paid'::text) $$, '…provider none, no reference, the price copied');
select results_eq(
  $$ select outcome from app.store_purchase('20600000-0000-4000-8000-0000000000f2', 499) $$,
  ARRAY['price_changed'], '…and the stale-price check still applies');
reset role;

-- The integration removed (module enabled again): no gateway either.
update public.tenant_modules set enabled = true
 where tenant_id = '20600000-0000-4000-8000-000000000001' and module_key = 'payments';
delete from public.payment_integrations where tenant_id = '20600000-0000-4000-8000-000000000001';
select tests.as_tenant('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a7');
select results_eq(
  $$ select outcome from app.store_purchase('20600000-0000-4000-8000-0000000000f2', 500) $$,
  ARRAY['purchased'], 'with an enabled module but NO integration the simulated purchase works');
reset role;
insert into public.payment_integrations (id, tenant_id, provider, secret_sealed)
  values ('20600000-0000-4000-8000-0000000000d1', '20600000-0000-4000-8000-000000000001', 'fake', 'v1:1:aaaa:bbbb:cccc');

-- Tenant B (no gateway) is unaffected by A's mode.
select tests.as_tenant('20600000-0000-4000-8000-000000000002', '20600000-0000-4000-8000-0000000000b2');
select results_eq(
  $$ select outcome from app.store_purchase('20600000-0000-4000-8000-0000000000f6', 1990) $$,
  ARRAY['purchased'], 'a tenant with no gateway keeps the simulated purchase whatever another tenant does');
reset role;

-- ── 6. the mapping foreign key and the link seam ───────────────────────────────────────────────
select is(
  (select confdeltype::text from pg_constraint where conname = 'payment_products_target_fk'),
  'c', 'payment_products_target_fk exists and is ON DELETE CASCADE');
select is(
  (select confrelid::regclass::text from pg_constraint where conname = 'payment_products_target_fk'),
  'store_products', '…and references store_products');
insert into public.payment_products (id, tenant_id, provider, kind, external_product_id, checkout_url, target_id) values
  ('20600000-0000-4000-8000-0000000000e1', '20600000-0000-4000-8000-000000000001', 'fake', 'store_product', 'SGW-FK', 'https://pay.example/fk', '20600000-0000-4000-8000-0000000000f5'),
  ('20600000-0000-4000-8000-0000000000e2', '20600000-0000-4000-8000-000000000001', 'fake', 'store_product', 'SGW-A1', 'https://pay.example/a1', '20600000-0000-4000-8000-0000000000f1');
delete from public.store_products where id = '20600000-0000-4000-8000-0000000000f5';
select is_empty(
  $$ select 1 from public.payment_products where id = '20600000-0000-4000-8000-0000000000e1' $$,
  'deleting a store product deletes its mapping (on delete cascade)');
select throws_ok(
  $$ insert into public.payment_products (tenant_id, provider, kind, external_product_id, target_id)
     values ('20600000-0000-4000-8000-000000000001', 'fake', 'store_product', 'SGW-GHOST', gen_random_uuid()) $$,
  '23503', null, 'a mapping for a product that does not exist is refused');
-- B gets a gateway too, so the mode alone cannot explain a null link.
insert into public.tenant_modules (tenant_id, module_key, enabled, settings)
  values ('20600000-0000-4000-8000-000000000002', 'payments', true, '{}');
insert into public.payment_integrations (id, tenant_id, provider, secret_sealed)
  values ('20600000-0000-4000-8000-0000000000d2', '20600000-0000-4000-8000-000000000002', 'fake', 'v1:1:dddd:eeee:ffff');
select tests.as_tenant('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2');
select is(app.payments_checkout_url('20600000-0000-4000-8000-0000000000f1'), 'https://pay.example/a1',
  'tenant A''s lane reads the stored link of its own product');
reset role;
select tests.as_tenant('20600000-0000-4000-8000-000000000002', '20600000-0000-4000-8000-0000000000b2');
select is(app.payments_checkout_url('20600000-0000-4000-8000-0000000000f1'), null,
  'tenant B''s lane (a gateway on) reads NO link for tenant A''s product (T-09.1-29)');
reset role;

-- ── 7. the seam functions ──────────────────────────────────────────────────────────────────────
select is(app.store_product_name_for('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000f1'), 'Produto A1',
  'store_product_name_for names a product of the given tenant');
select is(app.store_product_name_for('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000f6'), null,
  '…and answers null for another tenant''s product');
select is(app.store_product_name_for('20600000-0000-4000-8000-000000000002', '20600000-0000-4000-8000-0000000000f6'), 'Produto B1',
  '…pinned to the tenant it is given');
select is(app.store_product_name_for('20600000-0000-4000-8000-000000000001', gen_random_uuid()), null,
  '…null for an unknown id');
select is(app.store_product_name_for(null, '20600000-0000-4000-8000-0000000000f1'), null, '…null for a NULL tenant');
select is(app.store_product_name_for('20600000-0000-4000-8000-000000000001', null), null, '…null for a NULL product');
select ok(has_function_privilege('service_role', 'app.store_product_name_for(uuid, uuid)', 'execute'),
  'service_role may execute store_product_name_for');
select ok(not has_function_privilege('authenticated', 'app.store_product_name_for(uuid, uuid)', 'execute'),
  '…authenticated may not');
select ok(not has_function_privilege('anon', 'app.store_product_name_for(uuid, uuid)', 'execute'),
  '…anon may not');
select tests.as_tenant('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000a2');
select is(app.store_product_exists('20600000-0000-4000-8000-0000000000f1'), true,
  'store_product_exists: true for a product of the claim tenant');
select is(app.store_product_exists('20600000-0000-4000-8000-0000000000f6'), false, '…false for another tenant''s product');
select is(app.store_product_exists(gen_random_uuid()), false, '…false for an unknown id');
select is(app.store_product_exists(null), false, '…false for NULL');
select throws_ok($$ select app.store_product_name_for('20600000-0000-4000-8000-000000000001', '20600000-0000-4000-8000-0000000000f1') $$,
  '42501', null, 'a tenant lane may not call store_product_name_for');
reset role;
select tests.as_tenant_without_claims();
select is(app.store_product_exists('20600000-0000-4000-8000-0000000000f1'), false, '…false in a lane with no claims');
reset role;
select ok(has_function_privilege('authenticated', 'app.store_product_exists(uuid)', 'execute'),
  'authenticated may execute store_product_exists');
select ok(not has_function_privilege('anon', 'app.store_product_exists(uuid)', 'execute'), '…anon may not');

-- ── 8. hardening by catalogue ──────────────────────────────────────────────────────────────────
select is(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p
    where p.oid in ('app.store_purchase(uuid, integer)'::regprocedure,
                    'app.store_gateway_purchase(uuid, uuid, uuid, text, text, integer, timestamptz)'::regprocedure,
                    'app.store_gateway_revoke(uuid, text, text)'::regprocedure,
                    'app.store_product_exists(uuid)'::regprocedure,
                    'app.store_product_name_for(uuid, uuid)'::regprocedure)),
  true, 'all five functions are SECURITY DEFINER with an empty search_path');
select ok(has_function_privilege('authenticated', 'app.store_purchase(uuid, integer)', 'execute'),
  'app.store_purchase keeps EXECUTE for authenticated');
select ok(not has_function_privilege('anon', 'app.store_purchase(uuid, integer)', 'execute'),
  '…and not for anon');

select * from finish();
rollback;
