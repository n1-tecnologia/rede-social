-- store_gateway_functions (09.1-06, PAY-23..PAY-27; D-359, D-361, D-505..D-509) — the store half of the
-- payment gateway: the two explicit-argument definers a signed webhook writes the ledgers through, the
-- gateway guard inside the simulated purchase, the foreign key the payment mapping had to wait for and
-- the two published seam functions. Hand-written (`--custom`), applied AFTER the generated companion
-- `*_store_gateway_orders.sql` (the `provider` format check and `store_orders_provider_ref_uq`), and
-- after `*_payments_functions.sql` (`app.payments_gateway_mode()`).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────────
-- The simulated purchase (`app.store_purchase`) unlocks a product for FREE by design: it exists for a
-- tenant with no payment step. The day a tenant connects a gateway that free path must close IN THE
-- DATABASE (D-508): a stale page, a hand-made request or a future route must not reach the simulated
-- insert. And the webhook, which has no member JWT, must still be able to record "this member paid this
-- much for this product through this gateway reference" and to take it away on a refund (D-505) without
-- any tenant-lane write policy ever existing on the ledgers (STORE-20 holds; T-09.1-28). Both are the
-- reason this file exists.
--
-- ── OUTCOMES (RETURNED, never raised, so the caller's transaction commits whatever they are) ───────────
--   app.store_gateway_purchase(p_tenant, p_membership, p_product, p_provider, p_provider_ref, p_amount,
--                              p_paid_at) returns (outcome, order_id, product_name, user_id)
--     purchased       an order (`paid`, the gateway's `provider` and `provider_ref`, `amount_cents` =
--                     what the gateway reports as charged, D-507) and an entitlement (`source =
--                     'purchase'`) were written; `order_id`, the product's name and the buyer's
--                     `user_id` come back for the confirmation notice;
--     already_active  the member already holds an ACTIVE entitlement to the product (a grant or an
--                     earlier purchase), or the reference already has a live order, or a concurrent
--                     call won an arbiter: NOTHING is written (assumption A-P27);
--     not_found       a NULL argument; a provider outside `^[a-z][a-z0-9_]{1,30}$`; a reference that is
--                     empty after trimming, longer than 200 characters or carrying a control character;
--                     an amount outside 0..10000000 (the store's own price range: a corrupt gateway
--                     figure never becomes revenue, P59); a membership that is not a LIVE membership
--                     of THIS tenant (`active`, not blocked, not deleted); a product that is not a
--                     product of THIS tenant. An ARCHIVED product is still granted: the money was paid.
--   app.store_gateway_revoke(p_tenant, p_provider, p_provider_ref) returns (outcome, user_id, product_id)
--     revoked         the ACTIVE entitlement linked to the live order of that gateway reference is
--                     `revoked` (`revoked_at = now()`, `revoked_by_user_id` null: no person did it) and
--                     the order is `revoked`; both partial unique arbiters are free again, so the member
--                     may buy again, which writes a NEW order and a NEW entitlement (D-359);
--     not_found       the same argument validation; or no LIVE order carries the reference (a second
--                     call, another tenant's reference, an unknown one).
--   app.store_purchase(p_product, p_expected_amount) — the 08.2 function, re-created from its LATEST body
--                     (`*_store_purchase_owned_first.sql`) with ONE added step and an added outcome path:
--     unavailable     now ALSO when `app.payments_gateway_mode()` is true for the caller's tenant. The
--                     step sits right after the "already held → owned" check and before the archive and
--                     price checks, so a holder replaying still gets `owned` and a non-holder of a
--                     gateway tenant can never reach the simulated insert.
--
-- ── D-509: THE WEBHOOK PATH TAKES ITS TENANT AND MEMBERSHIP AS ARGUMENTS ─────────────────────────────
-- `app.store_purchase`, `store_grant` and `store_revoke` read the JWT claims (`app.tenant_id()`,
-- `app.user_id()`), which a webhook has not. The two new definers take the tenant and the membership as
-- ARGUMENTS and EVERY statement pins `tenant_id = p_tenant`; the membership and the product must belong
-- to that tenant, so a tenant-A event can never touch a membership or product of tenant B (T-09.1-29).
-- `provider_ref` is the SALE's stable key: the subscription id for a recurring sale (every renewal carries
-- a new charge id, the cancellation carries the subscription id), the order id otherwise (assumption
-- A-P14). A reference is stored trimmed (spaces, tab, CR, LF) and compared EXACTLY, case-sensitively
-- (P63). Money is integer cents end to end: `p_amount` is `integer`, the column is `integer`, no float,
-- no rounding, no division (P60).
--
-- ── CONCURRENCY (P56, P57) ───────────────────────────────────────────────────────────────────────────
-- `on conflict do nothing` against the three partial unique arbiters (`store_orders_live_uq`,
-- `store_orders_provider_ref_uq`, `store_entitlements_active_uq`) is the ONLY conflict handling. A loss to
-- a concurrent grant drops the call's own order in the same transaction (exactly like `app.store_purchase`)
-- so no orphan order survives. The revoke locks the live order `for update`.
--
-- ── THE SEAM (MOD-02, D-502) ─────────────────────────────────────────────────────────────────────────
--   * `payment_products_target_fk`: `payment_products.target_id -> store_products(id) on delete cascade`,
--     created HERE so the payments package never imports the store schema (a deleted product takes its
--     mapping with it);
--   * `app.store_product_exists(p_product)`: a tenant-lane definer that lets the payments service confirm
--     that a product id handed to the product form's mapping save belongs to the caller's OWN tenant
--     without reading a store table; another tenant's product, an unknown id and NULL all answer false;
--   * `app.store_product_name_for(p_tenant, p_product)`: an admin-lane definer that names a store product
--     for the Eventos list without reading a store table; pinned to `p_tenant`, null otherwise.
--
-- ── HARDENING ────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with `search_path = ''` and fully qualified names (T-09.1-29). The two ledger definers
-- and `store_product_name_for` are EXECUTE-able by `service_role` ONLY (revoked from public, anon and
-- authenticated: a member or `support_tenant` lane must never grant itself a product, T-09.1-27);
-- `store_product_exists` and `store_purchase` are EXECUTE-able by `authenticated` (anon revoked). Nothing
-- in this file creates a policy or grants a privilege on `store_orders` or `store_entitlements`
-- (T-09.1-28).
--
-- ── RELEASE ORDER ────────────────────────────────────────────────────────────────────────────────────
-- Expand-only: one foreign key on a column that holds no `store_product` mapping yet, four new functions
-- and a `create or replace` of `app.store_purchase` with the same signature, privileges and outcomes.
-- The guard changes nothing for a tenant without a gateway (the module off, or no integration row).

alter table public.payment_products
  add constraint payment_products_target_fk
  foreign key (target_id) references public.store_products(id) on delete cascade;
--> statement-breakpoint

create or replace function app.store_purchase(p_product uuid, p_expected_amount integer)
returns table (outcome text, order_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_status text;
  v_price integer;
  v_currency text;
  v_order uuid;
  v_entitlement uuid;
begin
  -- 1. No claims, no lane: nothing to buy.
  if v_t is null or v_u is null or p_product is null then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  -- 2. The product, in THIS tenant only, held against a concurrent archive or price edit.
  select p.status, p.price_cents, p.currency
    into v_status, v_price, v_currency
    from public.store_products p
   where p.id = p_product and p.tenant_id = v_t
     for share;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  -- 3. Already held (a purchase or a grant): the idempotent answer, no write, BEFORE the gateway,
  --    archive and price checks (WR-01): a holder's replay is `owned` whatever the product's state or
  --    the tenant's mode is now.
  if exists (select 1 from public.store_entitlements e
              where e.tenant_id = v_t and e.user_id = v_u and e.product_id = p_product
                and e.status = 'active') then
    return query select 'owned'::text, null::uuid;
    return;
  end if;

  -- 3b. A tenant with a gateway sells through it (D-508): the simulated purchase unlocks for free, so it
  --     does not exist for such a tenant. Read in THIS statement (P61): a purchase racing the moment an
  --     integration is created commits either wholly before (a simulated order) or is refused here.
  if app.payments_gateway_mode() then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;

  -- 4. Only a NEW purchase is refused for an archived product or a stale price.
  if v_status = 'archived' then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;
  if p_expected_amount is distinct from v_price then
    return query select 'price_changed'::text, null::uuid;
    return;
  end if;

  -- 5. The order, its amount COPIED from the product row (D-361). The live-order arbiter decides a race.
  insert into public.store_orders
         (tenant_id, user_id, product_id, status, amount_cents, currency, provider, paid_at)
  values (v_t, v_u, p_product, 'paid', v_price, v_currency, 'none', now())
  on conflict (tenant_id, user_id, product_id) where status in ('pending', 'paid') do nothing
  returning id into v_order;
  if v_order is null then
    return query select 'owned'::text, null::uuid;
    return;
  end if;

  -- 6. The entitlement. When a concurrent grant already holds the arbiter, drop OUR order (same call,
  --    same transaction) so no orphan order survives, and answer `owned`.
  insert into public.store_entitlements (tenant_id, user_id, product_id, source, order_id)
  values (v_t, v_u, p_product, 'purchase', v_order)
  on conflict (tenant_id, user_id, product_id) where status = 'active' do nothing
  returning id into v_entitlement;
  if v_entitlement is null then
    delete from public.store_orders o where o.id = v_order and o.tenant_id = v_t and o.user_id = v_u;
    return query select 'owned'::text, null::uuid;
    return;
  end if;

  return query select 'purchased'::text, v_order;
end
$$;
--> statement-breakpoint
revoke all on function app.store_purchase(uuid, integer) from public;--> statement-breakpoint
grant execute on function app.store_purchase(uuid, integer) to authenticated;--> statement-breakpoint

create or replace function app.store_gateway_purchase(
  p_tenant uuid,
  p_membership uuid,
  p_product uuid,
  p_provider text,
  p_provider_ref text,
  p_amount integer,
  p_paid_at timestamptz
)
returns table (outcome text, order_id uuid, product_name text, user_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_ref text := btrim(p_provider_ref, E' \t\r\n');
  v_user uuid;
  v_name text;
  v_order uuid;
  v_entitlement uuid;
begin
  -- 1. Arguments: a NULL, a malformed provider or reference, or an amount outside the store's own range
  --    is `not_found` and writes nothing (P59, P62, P63).
  if p_tenant is null or p_membership is null or p_product is null or p_provider is null
     or p_provider_ref is null or p_amount is null
     or p_provider !~ '^[a-z][a-z0-9_]{1,30}$'
     or v_ref = '' or char_length(v_ref) > 200 or v_ref ~ '[[:cntrl:]]'
     or p_amount < 0 or p_amount > 10000000 then
    return query select 'not_found'::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  -- 2. The membership: a LIVE membership of THIS tenant (another tenant's id matches nothing).
  select m.user_id into v_user
    from public.memberships m
   where m.id = p_membership
     and m.tenant_id = p_tenant
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null;
  if v_user is null then
    return query select 'not_found'::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  -- 3. The product, in THIS tenant only. An archived product is still granted: the money was paid.
  select p.name into v_name
    from public.store_products p
   where p.id = p_product and p.tenant_id = p_tenant
     for share;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  -- 4. Already held (a grant or an earlier purchase): nothing to create (A-P27).
  if exists (select 1 from public.store_entitlements e
              where e.tenant_id = p_tenant and e.user_id = v_user and e.product_id = p_product
                and e.status = 'active') then
    return query select 'already_active'::text, null::uuid, v_name, v_user;
    return;
  end if;

  -- 5. The order, at the amount the gateway reports (D-507). Bare `on conflict do nothing` covers both
  --    arbiters: one live order per member and product, one live order per gateway reference.
  insert into public.store_orders
         (tenant_id, user_id, product_id, status, amount_cents, currency, provider, provider_ref, paid_at)
  values (p_tenant, v_user, p_product, 'paid', p_amount, 'BRL', p_provider, v_ref,
          coalesce(p_paid_at, now()))
  on conflict do nothing
  returning id into v_order;
  if v_order is null then
    return query select 'already_active'::text, null::uuid, v_name, v_user;
    return;
  end if;

  -- 6. The entitlement. When a concurrent grant already holds the arbiter, drop OUR order (same call,
  --    same transaction) so no orphan order survives.
  insert into public.store_entitlements (tenant_id, user_id, product_id, source, order_id)
  values (p_tenant, v_user, p_product, 'purchase', v_order)
  on conflict (tenant_id, user_id, product_id) where status = 'active' do nothing
  returning id into v_entitlement;
  if v_entitlement is null then
    delete from public.store_orders o
     where o.id = v_order and o.tenant_id = p_tenant and o.user_id = v_user;
    return query select 'already_active'::text, null::uuid, v_name, v_user;
    return;
  end if;

  return query select 'purchased'::text, v_order, v_name, v_user;
end
$$;
--> statement-breakpoint
revoke all on function app.store_gateway_purchase(uuid, uuid, uuid, text, text, integer, timestamptz)
  from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.store_gateway_purchase(uuid, uuid, uuid, text, text, integer, timestamptz)
  to service_role;--> statement-breakpoint

create or replace function app.store_gateway_revoke(
  p_tenant uuid,
  p_provider text,
  p_provider_ref text
)
returns table (outcome text, user_id uuid, product_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_ref text := btrim(p_provider_ref, E' \t\r\n');
  v_order uuid;
  v_user uuid;
  v_product uuid;
begin
  -- 1. Arguments: the same validation as the purchase.
  if p_tenant is null or p_provider is null or p_provider_ref is null
     or p_provider !~ '^[a-z][a-z0-9_]{1,30}$'
     or v_ref = '' or char_length(v_ref) > 200 or v_ref ~ '[[:cntrl:]]' then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  -- 2. The LIVE order of this gateway reference in THIS tenant, locked against a concurrent purchase.
  select o.id, o.user_id, o.product_id into v_order, v_user, v_product
    from public.store_orders o
   where o.tenant_id = p_tenant
     and o.provider = p_provider
     and o.provider_ref = v_ref
     and o.status in ('pending', 'paid')
     for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  -- 3. The access ends: the entitlement of that order, then the order itself (D-359, D-505). History is
  --    kept; both partial unique arbiters are free for a later purchase.
  update public.store_entitlements e
     set status = 'revoked',
         revoked_at = now(),
         revoked_by_user_id = null
   where e.tenant_id = p_tenant
     and e.order_id = v_order
     and e.status = 'active';
  update public.store_orders o
     set status = 'revoked',
         revoked_at = now(),
         revoked_by_user_id = null
   where o.id = v_order
     and o.tenant_id = p_tenant;

  return query select 'revoked'::text, v_user, v_product;
end
$$;
--> statement-breakpoint
revoke all on function app.store_gateway_revoke(uuid, text, text) from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.store_gateway_revoke(uuid, text, text) to service_role;--> statement-breakpoint

create or replace function app.store_product_exists(p_product uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.store_products p
     where p.id = p_product
       and p.tenant_id = app.tenant_id()
  )
$$;
--> statement-breakpoint
revoke all on function app.store_product_exists(uuid) from public, anon;--> statement-breakpoint
grant execute on function app.store_product_exists(uuid) to authenticated;--> statement-breakpoint

create or replace function app.store_product_name_for(p_tenant uuid, p_product uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select p.name
    from public.store_products p
   where p.id = p_product
     and p.tenant_id = p_tenant
$$;
--> statement-breakpoint
revoke all on function app.store_product_name_for(uuid, uuid) from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.store_product_name_for(uuid, uuid) to service_role;
