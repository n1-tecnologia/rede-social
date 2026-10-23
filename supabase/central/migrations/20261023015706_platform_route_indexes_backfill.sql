-- platform_route_indexes_backfill (09.2-10, D-486, D-488, DBT-13, DBT-16) — the hand-written half of the
-- route-index migration (drizzle-kit cannot model grants or a data backfill). Applied by the in-house runner
-- right after `platform_route_indexes`, in ONE transaction. EXPAND-ONLY: it adds rows and grants, drops and
-- rewrites nothing.
--
-- CENTRAL SET ONLY. The three index tables (`payment_integration_routes`, `payment_product_routes`,
-- `video_asset_routes`) name which tenant owns a gateway integration, a gateway product id and a video asset,
-- so a delivery that carries no host can be routed to the tenant's project. RLS is on with ZERO policies;
-- only `service_role` (the platform lane) reads or writes them. `anon`, `authenticated` and the bare
-- `api_user` hold no privilege.
--
-- ── 1. EXPOSURE ──────────────────────────────────────────────────────────────────────────────────
-- The hardening migration already sets default privileges for tables created later in this schema; the
-- statements are repeated on the three tables by name so the closed state does not depend on which role ran
-- which migration.
revoke all on table platform.payment_integration_routes from public, anon, authenticated;
revoke all on table platform.payment_product_routes from public, anon, authenticated;
revoke all on table platform.video_asset_routes from public, anon, authenticated;
grant select, insert, update, delete on table platform.payment_integration_routes to service_role;
grant select, insert, update, delete on table platform.payment_product_routes to service_role;
grant select, insert, update, delete on table platform.video_asset_routes to service_role;

-- ── 2. BACKFILL of project 0 ─────────────────────────────────────────────────────────────────────
-- Every integration, gateway product mapping and video asset that already exists lives in project 0 (the
-- shared project); this makes them reachable through the index from the first request after the deploy. The
-- tenant tables are read only when they exist (a central set applied to a project that never ran the tenant
-- set has nothing to copy), and every insert is `on conflict do nothing`, so re-running the migration or
-- applying it after a partial run changes nothing.
do $backfill$
begin
  if to_regclass('public.payment_integrations') is not null then
    insert into platform.payment_integration_routes (integration_id, tenant_id, provider)
    select i.id, i.tenant_id, i.provider
      from public.payment_integrations i
     where exists (select 1 from public.tenants t where t.id = i.tenant_id)
    on conflict do nothing;
  end if;

  if to_regclass('public.payment_products') is not null then
    insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
    select p.provider, p.external_product_id, p.tenant_id
      from public.payment_products p
     where exists (select 1 from public.tenants t where t.id = p.tenant_id)
    on conflict do nothing;
  end if;

  if to_regclass('public.media_assets') is not null then
    insert into platform.video_asset_routes (asset_id, tenant_id, provider_asset_id)
    select a.id, a.tenant_id, a.provider_asset_id
      from public.media_assets a
     where a.kind = 'video'
       and a.provider in ('mux', 'fake')
       and exists (select 1 from public.tenants t where t.id = a.tenant_id)
    on conflict do nothing;
  end if;
end
$backfill$;
