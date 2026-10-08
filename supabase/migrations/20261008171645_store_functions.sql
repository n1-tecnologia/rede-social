-- store_functions (08.2-01, STORE-08, STORE-11, STORE-20, COMM-02; D-361; RESEARCH Patterns 1 and 4,
-- §Orders/Entitlements/Idempotency) — the store's half of the community gate seam and its purchase.
--
-- Three groups of statements, all hand-written (`--custom`), applied AFTER the generated
-- `*_store.sql` that created the tables they read:
--
--   1. `store_product_communities_community_fk`: the link's foreign key to `communities(id)`,
--      `on delete cascade` (a removed community drops its links; the `story_highlights` precedent).
--      Hand SQL so the store package never imports the communities schema (MOD-02; the
--      `feed_communities` precedent).
--
--   2. The BODIES of three kernel functions declared as stubs by `*_community_gate_seam.sql`,
--      replaced with `create or replace` and the SAME signatures, so `feed_posts_community_gate` and
--      every later consumer keep calling them by name:
--      - `app.community_locked_ids_for(p_user)`: the communities of THIS tenant linked to at least one
--        product, minus those where `p_user` holds an ACTIVE entitlement to ANY linked product; '{}'
--        when the tenant's `store` row is missing or disabled (STORE-01, T-08.2-14), and '{}' when
--        `p_user` is staff of the tenant by their `memberships` row (the worker's explicit form);
--      - `app.community_locked_ids()`: the lane form. Staff by CLAIM: only an `admin_tenant` or
--        `support_tenant` claim answers '{}'. A null or unknown `tenant_role` claim takes the MEMBER
--        branch and does NOT consult `memberships` for staff (fails closed, T-08.2-13);
--      - `app.community_viewer_ids(p_community)`: null when the store is off or the community has no
--        link (not gated: everyone reads it); otherwise the user ids of the live `member`-role
--        memberships (`status = 'active'`, not blocked, not deleted) holding an active entitlement to
--        any product linked to it ('{}' when nobody does). Staff are not listed: they always read.
--      The answer is a SET (`array_agg(distinct …)`); no caller relies on its order (P40). An archived
--      product still locks and its holders keep access (RESEARCH Assumption A4): no product status is
--      read here.
--
--   3. `app.store_purchase(p_product, p_expected_amount)`: the ONLY writer of an order and a purchase
--      entitlement from a tenant lane (both tables have no write policy, STORE-20). Outcomes, in order:
--        not_found     no tenant or user claim; or no product with this id in THIS tenant;
--        unavailable   the product is archived (holders keep access; only NEW purchases are refused);
--        price_changed `p_expected_amount` differs from the stored price (a staleness check: the body
--                      never carries the amount to charge, T-08.2-04);
--        owned         an active entitlement already exists (idempotent replay, P32), or a concurrent
--                      call won the order or the entitlement arbiter;
--        purchased     an order (`paid`, `provider 'none'`) and an entitlement were written.
--      The order's `amount_cents` and `currency` are COPIED from the product row read `for share` in
--      the same call (D-361): a later price edit leaves this order untouched. A 0-cent product takes the
--      same path and writes `amount_cents = 0`.
--      Concurrency (P33, T-08.2-05): two calls by the same member block on `store_orders_live_uq`; the
--      second sees the first's committed row and inserts nothing (`owned`). If the entitlement insert
--      loses to a concurrent grant (`store_entitlements_active_uq`), the call deletes the order it just
--      inserted, in the same transaction, and answers `owned`: no orphan order survives. The outcome is
--      RETURNED, never raised, so the caller's transaction commits whatever it is (the events_check_in
--      Pitfall 1 shape).
--
-- Hardening (T-08.2-15, the T-06-29 posture): every function is SECURITY DEFINER with
-- `search_path = ''` and fully qualified names. The owner bypasses RLS, so EVERY statement pins
-- `tenant_id = app.tenant_id()` itself (and `user_id = app.user_id()` for the caller's own rows): a
-- product, link or entitlement of another tenant matches nothing. EXECUTE is revoked from PUBLIC and
-- granted to `authenticated` only.

alter table public.store_product_communities
  add constraint store_product_communities_community_fk
  foreign key (community_id) references public.communities(id) on delete cascade;
--> statement-breakpoint

create or replace function app.community_locked_ids_for(p_user uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct l.community_id), '{}'::uuid[])
    from public.store_product_communities l
   where l.tenant_id = app.tenant_id()
     and exists (select 1 from public.tenant_modules tm
                  where tm.tenant_id = l.tenant_id and tm.module_key = 'store' and tm.enabled)
     and not exists (select 1 from public.memberships m
                      where m.tenant_id = l.tenant_id and m.user_id = p_user
                        and m.role in ('admin_tenant', 'support_tenant') and m.deleted_at is null)
     and not exists (
       select 1
         from public.store_product_communities l2
         join public.store_entitlements e
           on e.tenant_id = l2.tenant_id and e.product_id = l2.product_id
        where l2.tenant_id = l.tenant_id and l2.community_id = l.community_id
          and e.user_id = p_user and e.status = 'active')
$$;
--> statement-breakpoint
revoke all on function app.community_locked_ids_for(uuid) from public;--> statement-breakpoint
grant execute on function app.community_locked_ids_for(uuid) to authenticated;--> statement-breakpoint

create or replace function app.community_locked_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when app.tenant_role() in ('admin_tenant', 'support_tenant') then '{}'::uuid[]
    else (
      select coalesce(array_agg(distinct l.community_id), '{}'::uuid[])
        from public.store_product_communities l
       where l.tenant_id = app.tenant_id()
         and exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = l.tenant_id and tm.module_key = 'store' and tm.enabled)
         and not exists (
           select 1
             from public.store_product_communities l2
             join public.store_entitlements e
               on e.tenant_id = l2.tenant_id and e.product_id = l2.product_id
            where l2.tenant_id = l.tenant_id and l2.community_id = l.community_id
              and e.user_id = app.user_id() and e.status = 'active'))
  end
$$;
--> statement-breakpoint
revoke all on function app.community_locked_ids() from public;--> statement-breakpoint
grant execute on function app.community_locked_ids() to authenticated;--> statement-breakpoint

create or replace function app.community_viewer_ids(p_community uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = app.tenant_id() and tm.module_key = 'store' and tm.enabled)
      or not exists (select 1 from public.store_product_communities l
                      where l.tenant_id = app.tenant_id() and l.community_id = p_community)
    then null::uuid[]
    else (
      select coalesce(array_agg(distinct m.user_id), '{}'::uuid[])
        from public.memberships m
       where m.tenant_id = app.tenant_id()
         and m.role = 'member'
         and m.status = 'active'
         and m.blocked_at is null
         and m.deleted_at is null
         and exists (
           select 1
             from public.store_product_communities l
             join public.store_entitlements e
               on e.tenant_id = l.tenant_id and e.product_id = l.product_id
            where l.tenant_id = m.tenant_id and l.community_id = p_community
              and e.user_id = m.user_id and e.status = 'active'))
  end
$$;
--> statement-breakpoint
revoke all on function app.community_viewer_ids(uuid) from public;--> statement-breakpoint
grant execute on function app.community_viewer_ids(uuid) to authenticated;--> statement-breakpoint

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
  if v_status = 'archived' then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;
  if p_expected_amount is distinct from v_price then
    return query select 'price_changed'::text, null::uuid;
    return;
  end if;

  -- 3. Already held (a purchase or a grant): the idempotent answer, no write.
  if exists (select 1 from public.store_entitlements e
              where e.tenant_id = v_t and e.user_id = v_u and e.product_id = p_product
                and e.status = 'active') then
    return query select 'owned'::text, null::uuid;
    return;
  end if;

  -- 4. The order, its amount COPIED from the product row (D-361). The live-order arbiter decides a race.
  insert into public.store_orders
         (tenant_id, user_id, product_id, status, amount_cents, currency, provider, paid_at)
  values (v_t, v_u, p_product, 'paid', v_price, v_currency, 'none', now())
  on conflict (tenant_id, user_id, product_id) where status in ('pending', 'paid') do nothing
  returning id into v_order;
  if v_order is null then
    return query select 'owned'::text, null::uuid;
    return;
  end if;

  -- 5. The entitlement. When a concurrent grant already holds the arbiter, drop OUR order (same call,
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
