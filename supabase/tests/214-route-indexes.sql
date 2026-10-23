begin;
-- 214-route-indexes.sql — Phase 09.2-10 (DBT-12, DBT-13, DBT-16; D-486, D-488; T-09.2-46, T-09.2-47): the three
-- central ROUTE INDEXES that let a request without a tenant host find its tenant, executed inside Postgres.
--
-- 1. SHAPE: `platform.payment_integration_routes` (integration handle -> tenant), `platform.payment_product_routes`
--    (gateway product id -> tenant, primary key `(provider, external_product_id)`) and
--    `platform.video_asset_routes` (video asset -> tenant), their keys and indexes, and that the migration that
--    backfills them is recorded in the central ledger.
-- 2. KEYS: a gateway product id belongs to ONE tenant across the whole platform (a second tenant is refused with
--    23505, one tenant may hold many ids, the same id under another provider is another key); the provider
--    format is a CHECK; `provider_asset_id` is unique when present and many rows may hold none; a route needs
--    a real tenant (23503).
-- 3. CASCADE: deleting a tenant removes every route it owned.
-- 4. EXPOSURE (the cross-tenant negative): RLS on and NOT forced, zero policies, no privilege for `anon`,
--    `authenticated` or the bare `api_user`; the tenant lane gets 42501 on every read and write; `service_role`
--    (the platform lane) holds full DML.
-- 5. BACKFILL: the statements of the backfill migration, run over fixture rows of project 0, route every
--    integration, every gateway mapping and every video asset (mux and fake), skip images and other
--    providers, and running them a second time changes nothing.
--
-- Fixture ids use the `21400000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(52);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-route-a', 'Route A', '21400000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-route-b', 'Route B', '21400000-0000-4000-8000-000000000002');
select tests.auth_user('owner@route-a.local', '21400000-0000-4000-8000-0000000000a1');

-- ── 1. shape ───────────────────────────────────────────────────────────────────────────────────
select has_table('platform', 'payment_integration_routes', 'platform.payment_integration_routes exists');
select has_table('platform', 'payment_product_routes', 'platform.payment_product_routes exists');
select has_table('platform', 'video_asset_routes', 'platform.video_asset_routes exists');
select col_is_pk('platform', 'payment_integration_routes', 'integration_id', 'an integration route is keyed by the integration handle');
select col_is_pk('platform', 'payment_product_routes', array['provider', 'external_product_id'], 'a product route is keyed by (provider, external_product_id)');
select col_is_pk('platform', 'video_asset_routes', 'asset_id', 'a video route is keyed by the asset id');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and indexname = 'payment_integration_routes_tenant_idx'), 'index payment_integration_routes_tenant_idx exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and indexname = 'payment_product_routes_tenant_idx'), 'index payment_product_routes_tenant_idx exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and indexname = 'video_asset_routes_tenant_idx'), 'index video_asset_routes_tenant_idx exists');
select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'platform' and indexname = 'video_asset_routes_provider_asset_uq'
             and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%provider_asset_id IS NOT NULL%'),
  'video_asset_routes_provider_asset_uq is a unique partial index on provider_asset_id');
select ok(
  exists (select 1 from supabase_migrations.central_migrations where version = '20261023015706'),
  'the backfill migration is recorded in the central ledger');

-- ── 2. keys ────────────────────────────────────────────────────────────────────────────────────
insert into platform.payment_integration_routes (integration_id, tenant_id, provider) values
  ('21400000-0000-4000-8000-0000000000d1', '21400000-0000-4000-8000-000000000001', 'fake');
select throws_ok(
  $$ insert into platform.payment_integration_routes (integration_id, tenant_id, provider)
       values ('21400000-0000-4000-8000-0000000000d1', '21400000-0000-4000-8000-000000000002', 'fake') $$,
  '23505', null, 'an integration handle belongs to one route: a second row with the same handle is refused');
select throws_ok(
  $$ insert into platform.payment_integration_routes (integration_id, tenant_id, provider)
       values ('21400000-0000-4000-8000-0000000000d2', '21400000-0000-4000-8000-000000000001', 'Fake') $$,
  '23514', null, 'an integration route provider with a capital letter is refused by the format CHECK');
select throws_ok(
  $$ insert into platform.payment_integration_routes (integration_id, tenant_id, provider)
       values ('21400000-0000-4000-8000-0000000000d3', '21400000-0000-4000-8000-0000000000ff', 'fake') $$,
  '23503', null, 'an integration route for a tenant that does not exist is refused (foreign key)');

insert into platform.payment_product_routes (provider, external_product_id, tenant_id) values
  ('fake', 'PROD-1', '21400000-0000-4000-8000-000000000001');
select throws_ok(
  $$ insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
       values ('fake', 'PROD-1', '21400000-0000-4000-8000-000000000002') $$,
  '23505', null, 'a gateway product id held by tenant A is refused to tenant B (the id belongs to one tenant platform-wide)');
select throws_ok(
  $$ insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
       values ('fake', 'PROD-1', '21400000-0000-4000-8000-000000000001') $$,
  '23505', null, 'the holder cannot insert the same pair twice either');
select lives_ok(
  $$ insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
       values ('fake', 'PROD-2', '21400000-0000-4000-8000-000000000001'),
              ('fake', 'PROD-3', '21400000-0000-4000-8000-000000000001') $$,
  'one tenant may hold many gateway product ids');
select lives_ok(
  $$ insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
       values ('fake2', 'PROD-1', '21400000-0000-4000-8000-000000000002') $$,
  'the same product id under another provider is another key');
select lives_ok(
  $$ insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
       values ('fake', 'prod-1', '21400000-0000-4000-8000-000000000002') $$,
  'the key is case-exact: prod-1 is not PROD-1');
select throws_ok(
  $$ insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
       values ('Fake', 'PROD-9', '21400000-0000-4000-8000-000000000001') $$,
  '23514', null, 'a product route provider with a capital letter is refused by the format CHECK');
select throws_ok(
  $$ insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
       values ('fake', 'PROD-9', '21400000-0000-4000-8000-0000000000ff') $$,
  '23503', null, 'a product route for a tenant that does not exist is refused (foreign key)');
select is(
  (select tenant_id::text from platform.payment_product_routes where provider = 'fake' and external_product_id = 'PROD-1'),
  '21400000-0000-4000-8000-000000000001',
  'the conflict left the original holder untouched');

insert into platform.video_asset_routes (asset_id, tenant_id, provider_asset_id) values
  ('21400000-0000-4000-8000-0000000000e1', '21400000-0000-4000-8000-000000000001', 'up-1');
select throws_ok(
  $$ insert into platform.video_asset_routes (asset_id, tenant_id, provider_asset_id)
       values ('21400000-0000-4000-8000-0000000000e2', '21400000-0000-4000-8000-000000000002', 'up-1') $$,
  '23505', null, 'a provider asset id maps to one video asset: a second holder is refused');
select lives_ok(
  $$ insert into platform.video_asset_routes (asset_id, tenant_id, provider_asset_id)
       values ('21400000-0000-4000-8000-0000000000e3', '21400000-0000-4000-8000-000000000001', null),
              ('21400000-0000-4000-8000-0000000000e4', '21400000-0000-4000-8000-000000000002', null) $$,
  'many video routes may hold no provider asset id yet');
select throws_ok(
  $$ insert into platform.video_asset_routes (asset_id, tenant_id)
       values ('21400000-0000-4000-8000-0000000000e1', '21400000-0000-4000-8000-000000000002') $$,
  '23505', null, 'an asset id belongs to one video route');
select throws_ok(
  $$ insert into platform.video_asset_routes (asset_id, tenant_id)
       values ('21400000-0000-4000-8000-0000000000e5', '21400000-0000-4000-8000-0000000000ff') $$,
  '23503', null, 'a video route for a tenant that does not exist is refused (foreign key)');
select lives_ok(
  $$ update platform.video_asset_routes set provider_asset_id = 'asset-1'
      where asset_id = '21400000-0000-4000-8000-0000000000e1' $$,
  'the route learns the provider asset id after the upload started');

-- ── 3. cascade ─────────────────────────────────────────────────────────────────────────────────
insert into platform.payment_integration_routes (integration_id, tenant_id, provider) values
  ('21400000-0000-4000-8000-0000000000d9', '21400000-0000-4000-8000-000000000002', 'fake');
select is(
  (select count(*)::int from platform.payment_integration_routes where tenant_id = '21400000-0000-4000-8000-000000000002'),
  1, 'tenant B owns one integration route before it is deleted');
delete from public.tenants where id = '21400000-0000-4000-8000-000000000002';
select is(
  (select count(*)::int from platform.payment_integration_routes where tenant_id = '21400000-0000-4000-8000-000000000002'),
  0, 'deleting the tenant removes its integration routes');
select is(
  (select count(*)::int from platform.payment_product_routes where tenant_id = '21400000-0000-4000-8000-000000000002'),
  0, 'deleting the tenant removes its product routes');
select is(
  (select count(*)::int from platform.video_asset_routes where tenant_id = '21400000-0000-4000-8000-000000000002'),
  0, 'deleting the tenant removes its video routes');
select is(
  (select count(*)::int from platform.payment_product_routes where tenant_id = '21400000-0000-4000-8000-000000000001'),
  3, 'the other tenant keeps its routes');

-- ── 4. exposure ────────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relname in ('payment_integration_routes', 'payment_product_routes', 'video_asset_routes')
      and c.relrowsecurity and not c.relforcerowsecurity),
  3, 'RLS is on and not forced on the three route tables');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'platform' and tablename in ('payment_integration_routes', 'payment_product_routes', 'video_asset_routes')),
  0, 'the three route tables have ZERO policies');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('api_user')) r(role_name)
    where n.nspname = 'platform' and c.relname in ('payment_integration_routes', 'payment_product_routes', 'video_asset_routes')
      and has_table_privilege(r.role_name, c.oid, 'select,insert,update,delete,truncate,references,trigger')),
  0, 'anon, authenticated and the bare api_user hold no privilege on the route tables');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relname in ('payment_integration_routes', 'payment_product_routes', 'video_asset_routes')
      and has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert')
      and has_table_privilege('service_role', c.oid, 'update') and has_table_privilege('service_role', c.oid, 'delete')),
  3, 'service_role (the platform lane) holds select, insert, update and delete on all three');

set local role authenticated;
select throws_ok($$ select count(*) from platform.payment_integration_routes $$, '42501', null, 'authenticated cannot read the integration routes (42501)');
select throws_ok($$ select count(*) from platform.payment_product_routes $$, '42501', null, 'authenticated cannot read the product routes (42501)');
select throws_ok($$ select count(*) from platform.video_asset_routes $$, '42501', null, 'authenticated cannot read the video routes (42501)');
select throws_ok(
  $$ insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
       values ('fake', 'HACK', '21400000-0000-4000-8000-000000000001') $$,
  '42501', null, 'authenticated cannot reserve a product id (42501)');
select throws_ok($$ delete from platform.payment_integration_routes $$, '42501', null, 'authenticated cannot delete an integration route (42501)');
reset role;
set local role anon;
select throws_ok($$ select count(*) from platform.payment_integration_routes $$, '42501', null, 'anon cannot read the integration routes (42501)');
select throws_ok($$ select count(*) from platform.video_asset_routes $$, '42501', null, 'anon cannot read the video routes (42501)');
reset role;
set local role service_role;
select lives_ok($$ select count(*) from platform.payment_product_routes $$, 'service_role (the platform lane) can read the product routes');
reset role;

-- ── 5. the backfill ────────────────────────────────────────────────────────────────────────────
-- Fixture rows of project 0 in the three tenant tables. Tenant A: an integration, an access mapping and a
-- store-less mapping, a mux video, a fake video, an image and a supabase file. Tenant B was deleted above;
-- a third tenant gives the second integration a different owner.
select tests.tenant('pgtap-route-c', 'Route C', '21400000-0000-4000-8000-000000000003');
delete from platform.payment_integration_routes where tenant_id in ('21400000-0000-4000-8000-000000000001', '21400000-0000-4000-8000-000000000003');
delete from platform.payment_product_routes where tenant_id in ('21400000-0000-4000-8000-000000000001', '21400000-0000-4000-8000-000000000003');
delete from platform.video_asset_routes where tenant_id in ('21400000-0000-4000-8000-000000000001', '21400000-0000-4000-8000-000000000003');

insert into public.payment_integrations (id, tenant_id, provider, secret_sealed) values
  ('21400000-0000-4000-8000-0000000001d1', '21400000-0000-4000-8000-000000000001', 'fake', 'v1:1:aaaa:bbbb:cccc'),
  ('21400000-0000-4000-8000-0000000001d2', '21400000-0000-4000-8000-000000000003', 'fake', 'v1:1:dddd:eeee:ffff');
insert into public.payment_products (tenant_id, provider, kind, name, external_product_id) values
  ('21400000-0000-4000-8000-000000000001', 'fake', 'access', 'Acesso', 'BF-1'),
  ('21400000-0000-4000-8000-000000000003', 'fake', 'access', 'Acesso C', 'BF-2');
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, mime, bytes) values
  ('21400000-0000-4000-8000-0000000001a1', '21400000-0000-4000-8000-000000000001', '21400000-0000-4000-8000-0000000000a1', 'video', 'post', 'ready', 'mux', 'mux-asset-1', 'video/mp4', 10),
  ('21400000-0000-4000-8000-0000000001a2', '21400000-0000-4000-8000-000000000001', '21400000-0000-4000-8000-0000000000a1', 'video', 'post', 'pending', 'fake', 'fake-1', 'video/mp4', 10),
  ('21400000-0000-4000-8000-0000000001a3', '21400000-0000-4000-8000-000000000001', '21400000-0000-4000-8000-0000000000a1', 'image', 'avatar', 'ready', 'supabase', null, 'image/jpeg', 10),
  ('21400000-0000-4000-8000-0000000001a4', '21400000-0000-4000-8000-000000000001', '21400000-0000-4000-8000-0000000000a1', 'file', 'attachment', 'ready', 'supabase', null, 'application/pdf', 10);

-- The statements of 20261023015706_platform_route_indexes_backfill.sql, verbatim, as a function so the
-- second pass is the same text.
create function pg_temp.backfill() returns void language plpgsql as $f$
begin
  insert into platform.payment_integration_routes (integration_id, tenant_id, provider)
  select i.id, i.tenant_id, i.provider
    from public.payment_integrations i
   where exists (select 1 from public.tenants t where t.id = i.tenant_id)
  on conflict do nothing;

  insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
  select p.provider, p.external_product_id, p.tenant_id
    from public.payment_products p
   where exists (select 1 from public.tenants t where t.id = p.tenant_id)
  on conflict do nothing;

  insert into platform.video_asset_routes (asset_id, tenant_id, provider_asset_id)
  select a.id, a.tenant_id, a.provider_asset_id
    from public.media_assets a
   where a.kind = 'video'
     and a.provider in ('mux', 'fake')
     and exists (select 1 from public.tenants t where t.id = a.tenant_id)
  on conflict do nothing;
end
$f$;

select lives_ok($$ select pg_temp.backfill() $$, 'the backfill runs');
select is(
  (select count(*)::int from platform.payment_integration_routes where integration_id in
     ('21400000-0000-4000-8000-0000000001d1', '21400000-0000-4000-8000-0000000001d2')),
  2, 'every integration of project 0 has its route');
select is(
  (select tenant_id::text from platform.payment_integration_routes where integration_id = '21400000-0000-4000-8000-0000000001d2'),
  '21400000-0000-4000-8000-000000000003',
  'and the route names the integration''s own tenant');
select is(
  (select count(*)::int from platform.payment_product_routes where external_product_id in ('BF-1', 'BF-2')),
  2, 'every gateway mapping of project 0 has its route');
select is(
  (select array_agg(asset_id::text order by asset_id) from platform.video_asset_routes where tenant_id = '21400000-0000-4000-8000-000000000001'),
  array['21400000-0000-4000-8000-0000000001a1', '21400000-0000-4000-8000-0000000001a2'],
  'both video assets (mux and fake) are routed, the image and the file are not');
select is(
  (select provider_asset_id from platform.video_asset_routes where asset_id = '21400000-0000-4000-8000-0000000001a1'),
  'mux-asset-1', 'the route carries the provider asset id the row held');
select lives_ok($$ select pg_temp.backfill() $$, 'the backfill runs a second time');
select is(
  (select count(*)::int from platform.video_asset_routes where tenant_id = '21400000-0000-4000-8000-000000000001'),
  2, 'and changes nothing (idempotent)');

select * from finish();
rollback;
