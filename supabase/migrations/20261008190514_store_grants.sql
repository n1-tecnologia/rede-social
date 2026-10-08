-- store_grants (08.2-06, STORE-09, STORE-10, STORE-20, STORE-21; D-359, D-360; RESEARCH §Orders
-- "Revoke" and "Grant", §Admin Surfaces) — the admin's two escape hatches on the entitlement ledger.
--
-- Hand-written (`--custom`), applied AFTER `*_store_functions.sql`, whose `app.store_purchase` is the
-- shape copied here. Both ledgers (`store_orders`, `store_entitlements`) have NO write policy and their
-- write privileges are revoked from `authenticated` (STORE-20, T-08.2-03): these two definers and
-- `app.store_purchase` are the only writers from a tenant lane.
--
--   1. `app.store_grant(p_product, p_membership) returns table (outcome, entitlement_id)` (D-360):
--        not_found      no tenant or user claim; or no product with this id in THIS tenant (an
--                       archived product may be granted: archiving refuses NEW purchases only); or no
--                       membership with this id in THIS tenant that is `active`, not blocked and not
--                       deleted. A membership id of ANOTHER tenant is invisible here, so it is the
--                       same `not_found`, answered as the bare 404 (T-08.2-06, D-309: the same
--                       person's membership in a second community is another tenant's row);
--        forbidden      the caller's `tenant_role` claim is not `admin_tenant` (a `support_tenant` or
--                       member lane calling the function directly writes nothing, T-08.2-12);
--        granted        an entitlement `source = 'grant'`, `granted_by_user_id = app.user_id()`, no
--                       order, was written; `entitlement_id` is the new row;
--        already_active the member already holds an ACTIVE entitlement to the product (a purchase or
--                       an earlier grant; P34): nothing is written; `entitlement_id` is the active row.
--      The active-entitlement arbiter `store_entitlements_active_uq` decides a race with a purchase or
--      a second grant (`on conflict … do nothing`); `app.store_purchase` already drops its own order
--      when a grant wins, so a grant racing a purchase leaves exactly ONE active entitlement and no
--      orphan `paid` order.
--
--   2. `app.store_revoke(p_product, p_entitlement) returns table (outcome)` (D-359):
--        not_found      no claims; or no ACTIVE entitlement with this id, of THIS product (the path's
--                       product id must match the row: no IDOR across products, T-08.2-07), in THIS
--                       tenant. Revoking twice is therefore `not_found` the second time;
--        forbidden      the caller is not `admin_tenant` (T-08.2-12);
--        revoked        the entitlement is `revoked` (`revoked_at`, `revoked_by_user_id`) and, for a
--                       purchase, its order is `revoked` too. Rows are history, never deleted
--                       (STORE-09): both partial unique arbiters are free again, so the member may buy
--                       anew, which writes a NEW order and a NEW entitlement. A grant touches no order.
--      The gate reads entitlements live, so the revoke takes effect on the member's NEXT statement
--      (P42): nothing is derived or cached.
--
-- STORE-09 reading (P34, flagged): "lifetime" means `expires_at` exists and is never set or read in
-- 08.2; a revoke is a status change, never a deletion.
--
-- Hardening (T-08.2-15, the `app.store_purchase` posture): SECURITY DEFINER, `search_path = ''`, fully
-- qualified names; the owner bypasses RLS, so EVERY statement pins `tenant_id = app.tenant_id()`
-- itself. The role re-check is the function's own (the routes also carry
-- `requirePermission('store.product.manage')`): a lane that reaches the function some other way still
-- writes nothing. Outcomes are RETURNED, never raised, so the caller's transaction commits whatever it
-- is. EXECUTE is revoked from PUBLIC and granted to `authenticated` only.

create or replace function app.store_grant(p_product uuid, p_membership uuid)
returns table (outcome text, entitlement_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_member uuid;
  v_entitlement uuid;
begin
  -- 1. No claims, no lane: nothing to grant.
  if v_t is null or v_u is null or p_product is null or p_membership is null then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  -- 2. Only the tenant's admin grants (T-08.2-12), whatever route reached this function.
  if app.tenant_role() is distinct from 'admin_tenant' then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;

  -- 3. The product, in THIS tenant only (archived ones may be granted).
  perform 1 from public.store_products p where p.id = p_product and p.tenant_id = v_t;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  -- 4. The membership, in THIS tenant only, live: another tenant's id matches nothing (T-08.2-06).
  select m.user_id into v_member
    from public.memberships m
   where m.id = p_membership
     and m.tenant_id = v_t
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null;
  if v_member is null then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  -- 5. The grant. The active arbiter decides a race; a loser reads the winner's row. A concurrent
  --    revoke between the two statements frees the arbiter, so the loop tries again (bounded).
  for attempt in 1..3 loop
    insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id)
    values (v_t, v_member, p_product, 'grant', v_u)
    on conflict (tenant_id, user_id, product_id) where status = 'active' do nothing
    returning id into v_entitlement;
    if v_entitlement is not null then
      return query select 'granted'::text, v_entitlement;
      return;
    end if;

    select e.id into v_entitlement
      from public.store_entitlements e
     where e.tenant_id = v_t and e.user_id = v_member and e.product_id = p_product
       and e.status = 'active';
    if v_entitlement is not null then
      return query select 'already_active'::text, v_entitlement;
      return;
    end if;
  end loop;

  return query select 'not_found'::text, null::uuid;
end
$$;
--> statement-breakpoint
revoke all on function app.store_grant(uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.store_grant(uuid, uuid) to authenticated;--> statement-breakpoint

create or replace function app.store_revoke(p_product uuid, p_entitlement uuid)
returns table (outcome text)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_order uuid;
begin
  -- 1. No claims, no lane: nothing to revoke.
  if v_t is null or v_u is null or p_product is null or p_entitlement is null then
    return query select 'not_found'::text;
    return;
  end if;

  -- 2. Only the tenant's admin revokes (T-08.2-12).
  if app.tenant_role() is distinct from 'admin_tenant' then
    return query select 'forbidden'::text;
    return;
  end if;

  -- 3. The ACTIVE entitlement of THIS product in THIS tenant becomes history (T-08.2-07).
  update public.store_entitlements e
     set status = 'revoked',
         revoked_at = now(),
         revoked_by_user_id = v_u
   where e.id = p_entitlement
     and e.product_id = p_product
     and e.tenant_id = v_t
     and e.status = 'active'
  returning e.order_id into v_order;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  -- 4. A purchase's order is revoked with it (D-359), freeing the live-order arbiter for a re-buy.
  if v_order is not null then
    update public.store_orders o
       set status = 'revoked',
           revoked_at = now(),
           revoked_by_user_id = v_u
     where o.id = v_order
       and o.tenant_id = v_t;
  end if;

  return query select 'revoked'::text;
end
$$;
--> statement-breakpoint
revoke all on function app.store_revoke(uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.store_revoke(uuid, uuid) to authenticated;
