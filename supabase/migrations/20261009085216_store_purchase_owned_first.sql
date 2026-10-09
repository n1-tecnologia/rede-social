-- store_purchase_owned_first (08.2 code review WR-01) — hand-written (`--custom`). Replaces the body of
-- `app.store_purchase(p_product, p_expected_amount)` from `*_store_functions.sql` with the SAME
-- signature, privileges and outcomes; only the ORDER of the checks changes.
--
-- The original checked `archived` and `price_changed` BEFORE "already held", so the idempotent replay
-- the header promises (`owned`, P32) broke in two cases: a member's first request committed, then the
-- admin archived the product or edited its price before the replay (a double tap, a second tab)
-- arrived, and the replay answered 409 `unavailable` / `price_changed` for a purchase that had
-- succeeded; and a holder calling with a stale price got `price_changed`. Now an existing holder always
-- gets `owned`, whatever the product's current state. Outcomes, in order:
--
--   not_found     no tenant or user claim; or no product with this id in THIS tenant;
--   owned         an active entitlement already exists (a purchase or a grant), checked right after
--                 the product lookup, before the archive and price checks; or a concurrent call won
--                 the order or the entitlement arbiter;
--   unavailable   the product is archived (holders keep access; only NEW purchases are refused);
--   price_changed `p_expected_amount` differs from the stored price (a staleness check: the body never
--                 carries the amount to charge, T-08.2-04);
--   purchased     an order (`paid`, `provider 'none'`) and an entitlement were written.
--
-- Everything else is unchanged: the product row is read `for share`, the amount is COPIED from it
-- (D-361), the two partial unique arbiters decide races (P33, T-08.2-05), a loss to a concurrent grant
-- drops the call's own order, outcomes are RETURNED, never raised. SECURITY DEFINER with
-- `search_path = ''`, every statement pinned to `tenant_id = app.tenant_id()` and the caller's
-- `app.user_id()` (T-08.2-15). EXECUTE stays revoked from PUBLIC and granted to `authenticated`.

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

  -- 3. Already held (a purchase or a grant): the idempotent answer, no write, BEFORE the archive and
  --    price checks (WR-01): a holder's replay is `owned` whatever the product's state is now.
  if exists (select 1 from public.store_entitlements e
              where e.tenant_id = v_t and e.user_id = v_u and e.product_id = p_product
                and e.status = 'active') then
    return query select 'owned'::text, null::uuid;
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
grant execute on function app.store_purchase(uuid, integer) to authenticated;
