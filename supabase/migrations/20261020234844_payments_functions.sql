-- payments_functions (09.1-05, D-486, D-488, D-501, D-509, PAY-29) — the privilege hardening of the three
-- payment tables, the foreign key `access_grants.mapping_id` had to wait for, the two store seam functions
-- and the retention sweep. Custom migration (drizzle-kit cannot model grants or functions). Its generated
-- companion `20261020234833_payments_tables.sql` creates the tables.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────────
-- 1. PRIVILEGES. `payment_integrations` (the sealed webhook token) and `payment_events` (the inbox) are
--    admin-lane tables with ZERO policies, so `anon` and `authenticated` must hold no privilege on them
--    at all: with the schema-wide grant a policy is the only thing that could expose them, and no policy
--    exists, but the privilege is the second lock. `payment_products` is the one tenant-lane table of the
--    three (`admin_tenant` policies); `anon` loses everything and `authenticated` loses TRUNCATE, which
--    RLS does not see (the 08.2 `store_admin_write_truncate` precedent: without the revoke an
--    `admin_tenant` token could empty every tenant's map in one statement).
-- 2. `access_grants_mapping_fk`. Plan 02 created `access_grants.mapping_id` with no foreign key because
--    `payment_products` did not exist. `on delete set null`: removing a mapping must not delete the access
--    it once opened, only forget which product opened it.
-- 3. THE STORE SEAM (D-501, assumption A-P8). The store module asks the kernel by NAME, never by table
--    (the community-gate precedent, D-488: the store stays free of gateway knowledge):
--      * `app.payments_gateway_mode()` — true when the `payments` module is ENABLED for the claim
--        tenant AND a `payment_integrations` row exists for it. This is the "a gateway is on" switch of
--        D-508 (no link, no purchase; the simulated purchase only exists without a gateway).
--      * `app.payments_checkout_url(p_product)` — the stored link of the claim tenant's `store_product`
--        mapping for that product; null when the mode is off, no mapping exists or it carries no link.
--    Both are SECURITY DEFINER because the tenant lane has no privilege on `payment_integrations`, and
--    both PIN `app.tenant_id()` themselves: the owner bypasses RLS, so a lane can never read another
--    tenant's mode or link, whatever product id it passes. Every role of the tenant may call them (a
--    member needs the link to buy); EXECUTE is revoked from PUBLIC/anon and granted to `authenticated`.
-- 4. `app.payment_events_prune(p_batch)` — the 180-day retention (assumption A-P21) run by the kernel's
--    hourly sweeper, which executes every name a manifest declares in `sweepFunctions` as
--    `select app.<name>(<batch>)` through the admin lane (plan 09 registers it). SECURITY INVOKER and
--    `service_role` only, the `notifications_prune` shape: the prune is deliberately cross-tenant, so no
--    tenant lane may call it. Retention is the replay memory (T-09.1-19): shorter weakens it.
--
-- ── HARDENING ────────────────────────────────────────────────────────────────────────────────────────
-- The definers use `search_path = ''` and fully qualified names; only pg_catalog built-ins and `app.*`.
--
-- ── RELEASE ORDER ────────────────────────────────────────────────────────────────────────────────────
-- Expand-only: revokes on tables created one migration earlier, one nullable foreign key on a table
-- that has no `mapping_id` value yet, and three new functions. Nothing is dropped or retyped.

revoke all on table public.payment_integrations from anon, authenticated;
--> statement-breakpoint
revoke all on table public.payment_events from anon, authenticated;
--> statement-breakpoint
revoke all on table public.payment_products from anon;
--> statement-breakpoint
revoke truncate on table public.payment_products from authenticated;
--> statement-breakpoint
alter table public.access_grants
  add constraint access_grants_mapping_fk
  foreign key (mapping_id) references public.payment_products(id) on delete set null;
--> statement-breakpoint
create or replace function app.payments_gateway_mode()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1
             from public.tenant_modules tm
            where tm.tenant_id = app.tenant_id()
              and tm.module_key = 'payments'
              and tm.enabled
         )
     and exists (
           select 1
             from public.payment_integrations pi
            where pi.tenant_id = app.tenant_id()
         )
$$;
--> statement-breakpoint
create or replace function app.payments_checkout_url(p_product uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select pp.checkout_url
    from public.payment_products pp
   where pp.tenant_id = app.tenant_id()
     and pp.kind = 'store_product'
     and pp.target_id = p_product
     and app.payments_gateway_mode()
$$;
--> statement-breakpoint
create or replace function app.payment_events_prune(p_batch integer)
returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_n integer;
begin
  delete from public.payment_events
   where id in (
     select id
       from public.payment_events
      where received_at < now() - interval '180 days'
      order by received_at
      limit greatest(1, least(coalesce(p_batch, 1), 5000))
   );
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
--> statement-breakpoint
revoke all on function app.payments_gateway_mode() from public, anon, authenticated;
--> statement-breakpoint
revoke all on function app.payments_checkout_url(uuid) from public, anon, authenticated;
--> statement-breakpoint
revoke all on function app.payment_events_prune(integer) from public, anon, authenticated;
--> statement-breakpoint
grant execute on function app.payments_gateway_mode() to authenticated;
--> statement-breakpoint
grant execute on function app.payments_checkout_url(uuid) to authenticated;
--> statement-breakpoint
grant execute on function app.payment_events_prune(integer) to service_role;
