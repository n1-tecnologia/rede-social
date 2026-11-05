begin;
-- 224-central-tenant-apps.sql — Phase 13-05 (NATIVE-24 storage half, NATIVE-26, NATIVE-27; D-605, D-615, D-617,
-- D-539; T-13-09, T-13-10): the control-plane half of the "App" tab, executed inside Postgres.
--
-- 1. SHAPE: `platform.tenant_apps` keyed by tenant_id, `platform.tenant_app_credentials` with the unique
--    (tenant_id, kind), the columns the App tab reads and writes.
-- 2. tenant_apps: a row with only tenant_id reads both purchase switches `false` (D-617, fail closed), one
--    switch changes only its own column, and every format CHECK refuses its bad value (23514, by constraint
--    name) beside a positive control: team id, Android SHA-256 fingerprints, https-only URLs, three-part
--    versions, the bundle and application id shapes, and a lock on the ids only once both exist.
-- 3. tenant_app_credentials: the six kinds (the entered three, the generated three) are accepted, a kind outside
--    them is refused (23514), `(tenant_id, kind)` twice is 23505, a replace by update keeps the row id (the
--    sealed AAD is `<rowId>:<kind>`), a credential for a tenant that does not exist is refused (23503).
-- 4. CASCADE: deleting a tenant removes both its app row and every credential in the same statement.
-- 5. EXPOSURE (the cross-tenant negative): RLS on and NOT forced, ZERO policies, no privilege for `anon`,
--    `authenticated` or the bare `api_user`, full privilege for `service_role`; the tenant lane, the bare
--    api_user and anon get 42501 on every select, insert, update and delete of both tables, and the platform
--    lane (service_role) can do all four.
--
-- Fixture ids use the `22400000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(112);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-app-a', 'App A', '22400000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-app-b', 'App B', '22400000-0000-4000-8000-000000000002');
select tests.tenant('pgtap-app-c', 'App C', '22400000-0000-4000-8000-000000000003');
select tests.tenant('pgtap-app-d', 'App D', '22400000-0000-4000-8000-000000000004');
select tests.auth_user('pgtap-app-user@example.test', '22400000-0000-4000-8000-0000000000a1');
select tests.member('22400000-0000-4000-8000-000000000001', '22400000-0000-4000-8000-0000000000a1', 'admin_tenant');

-- ── 1. shape ───────────────────────────────────────────────────────────────────────────────────
select has_table('platform', 'tenant_apps', 'platform.tenant_apps exists');
select has_table('platform', 'tenant_app_credentials', 'platform.tenant_app_credentials exists');
select col_is_pk('platform', 'tenant_apps', 'tenant_id', 'tenant_apps is keyed by tenant_id (a tenant with no row has no app)');
select col_is_pk('platform', 'tenant_app_credentials', 'id', 'tenant_app_credentials is keyed by its own row id (the sealed AAD)');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and tablename = 'tenant_app_credentials'
                    and indexname = 'tenant_app_credentials_tenant_kind_uq' and indexdef like 'CREATE UNIQUE INDEX%(tenant_id, kind)%'),
  'index tenant_app_credentials_tenant_kind_uq is unique over (tenant_id, kind)');
select fk_ok('platform', 'tenant_apps', 'tenant_id', 'public', 'tenants', 'id', 'tenant_apps.tenant_id references the tenants table');
select fk_ok('platform', 'tenant_app_credentials', 'tenant_id', 'public', 'tenants', 'id', 'tenant_app_credentials.tenant_id references the tenants table');
select is(
  (select confdeltype::text from pg_constraint where conrelid = 'platform.tenant_apps'::regclass and contype = 'f'),
  'c', 'tenant_apps cascades on tenant delete');
select is(
  (select confdeltype::text from pg_constraint where conrelid = 'platform.tenant_app_credentials'::regclass and contype = 'f'),
  'c', 'tenant_app_credentials cascades on tenant delete');
select columns_are('platform', 'tenant_app_credentials', array['id', 'tenant_id', 'kind', 'sealed', 'held_at'],
  'tenant_app_credentials holds exactly id, tenant_id, kind, sealed and held_at: no plain column can hold a secret, a prefix, a hash or a Key ID');
select has_column('platform', 'tenant_apps', 'bundle_id', 'tenant_apps has bundle_id');
select has_column('platform', 'tenant_apps', 'application_id', 'tenant_apps has application_id');
select has_column('platform', 'tenant_apps', 'ids_locked_at', 'tenant_apps has ids_locked_at');
select has_column('platform', 'tenant_apps', 'android_sha256', 'tenant_apps has android_sha256');
select has_column('platform', 'tenant_apps', 'last_android_build', 'tenant_apps has the last build per store');
select has_column('platform', 'tenant_apps', 'reviewer_user_id', 'tenant_apps has the reviewer account');

-- ── 2. tenant_apps: defaults, the purchase switches and the CHECKs ──────────────────────────────
select lives_ok(
  $$ insert into platform.tenant_apps (tenant_id) values ('22400000-0000-4000-8000-000000000001') $$,
  'a tenant_apps row with only its tenant_id is accepted');
select is(
  (select purchase_ios::text || '|' || purchase_android::text from platform.tenant_apps
    where tenant_id = '22400000-0000-4000-8000-000000000001'),
  'false|false', 'D-617: a row inserted with no switch value reads both purchase switches false (fail closed)');
select is(
  (select manual_apple_account::text || manual_play_account::text || manual_screenshots::text || manual_submitted::text || manual_published::text
     from platform.tenant_apps where tenant_id = '22400000-0000-4000-8000-000000000001'),
  'falsefalsefalsefalsefalse', 'the five manual checklist flags start off');
select is(
  (select android_sha256 from platform.tenant_apps where tenant_id = '22400000-0000-4000-8000-000000000001'),
  '{}'::text[], 'the fingerprint list starts empty, never null');
select is(
  (select (bundle_id is null and application_id is null and ids_locked_at is null and team_id is null and privacy_url is null)
     from platform.tenant_apps where tenant_id = '22400000-0000-4000-8000-000000000001'),
  true, 'every other fact starts null');

-- NATIVE-24 (storage half): one switch changes only its own column, a second identical update changes nothing
select lives_ok(
  $$ update platform.tenant_apps set purchase_ios = true where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  'setting the iOS switch is accepted');
select is(
  (select purchase_ios::text || '|' || purchase_android::text from platform.tenant_apps
    where tenant_id = '22400000-0000-4000-8000-000000000001'),
  'true|false', 'an update that sets one switch changes only that column');
create temp table pgtap_apps_before as
  select to_jsonb(a) - 'updated_at' as j from platform.tenant_apps a where tenant_id = '22400000-0000-4000-8000-000000000001';
update platform.tenant_apps set purchase_ios = true where tenant_id = '22400000-0000-4000-8000-000000000001';
select is(
  (select to_jsonb(a) - 'updated_at' from platform.tenant_apps a where tenant_id = '22400000-0000-4000-8000-000000000001'),
  (select j from pgtap_apps_before), 'a second identical update changes nothing but (at most) updated_at');
update platform.tenant_apps set purchase_ios = false where tenant_id = '22400000-0000-4000-8000-000000000001';

-- team id
select throws_ok(
  $$ update platform.tenant_apps set team_id = 'abc' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_team_id_chk"',
  'a team id of three characters is refused');
select throws_ok(
  $$ update platform.tenant_apps set team_id = 'abcde12345' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_team_id_chk"',
  'a lower-case team id is refused (the API saves it upper-case)');
select throws_ok(
  $$ update platform.tenant_apps set team_id = 'ABCDE123456' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_team_id_chk"',
  'a team id of eleven characters is refused');
select lives_ok(
  $$ update platform.tenant_apps set team_id = 'ABCDE12345' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  'a ten-character upper-case team id is accepted');

-- Android SHA-256 fingerprints: 32 colon-separated upper-case hex pairs, at most ten, no null, no empty element
select lives_ok(
  format($$ update platform.tenant_apps set android_sha256 = array[%L] where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         repeat('AB:', 31) || 'CD'),
  'one well-formed fingerprint is accepted');
select lives_ok(
  format($$ update platform.tenant_apps set android_sha256 = array[%L, %L] where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         repeat('AB:', 31) || 'CD', repeat('01:', 31) || 'EF'),
  'two well-formed fingerprints are accepted');
select throws_ok(
  format($$ update platform.tenant_apps set android_sha256 = array[%L] where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         repeat('AB:', 30) || 'CD'),
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_sha256_chk"',
  'a fingerprint of 31 pairs is refused');
select throws_ok(
  format($$ update platform.tenant_apps set android_sha256 = array[%L] where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         repeat('ab:', 31) || 'cd'),
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_sha256_chk"',
  'a lower-case fingerprint is refused (the API normalises it)');
select throws_ok(
  format($$ update platform.tenant_apps set android_sha256 = array[%L] where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         repeat('AB', 31) || 'CD'),
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_sha256_chk"',
  'a fingerprint without colons is refused');
select throws_ok(
  format($$ update platform.tenant_apps set android_sha256 = array[%L, ''] where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         repeat('AB:', 31) || 'CD'),
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_sha256_chk"',
  'an empty element beside a good fingerprint is refused');
select throws_ok(
  format($$ update platform.tenant_apps set android_sha256 = array[%L, null] where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         repeat('AB:', 31) || 'CD'),
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_sha256_chk"',
  'a null element beside a good fingerprint is refused');
select throws_ok(
  format($$ update platform.tenant_apps set android_sha256 = array[%L] where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         repeat('AB:', 31) || 'CD,' || repeat('AB:', 31) || 'CD'),
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_sha256_chk"',
  'one element holding two fingerprints joined by a comma is refused');
select lives_ok(
  format($$ update platform.tenant_apps set android_sha256 = array_fill(%L::text, array[10]) where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         repeat('AB:', 31) || 'CD'),
  'ten fingerprints are accepted');
select throws_ok(
  format($$ update platform.tenant_apps set android_sha256 = array_fill(%L::text, array[11]) where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         repeat('AB:', 31) || 'CD'),
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_sha256_chk"',
  'eleven fingerprints are refused');
select lives_ok(
  $$ update platform.tenant_apps set android_sha256 = '{}' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  'the empty list is accepted again (clearing the fingerprints)');

-- https-only URLs
select throws_ok(
  $$ update platform.tenant_apps set privacy_url = 'http://example.test/privacidade' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_privacy_url_chk"',
  'an http:// privacy URL is refused');
select throws_ok(
  $$ update platform.tenant_apps set privacy_url = 'https://' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_privacy_url_chk"',
  'a bare https:// privacy URL is refused');
select throws_ok(
  $$ update platform.tenant_apps set store_url_ios = 'itms-apps://apps.apple.com/app/id1' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_privacy_url_chk"',
  'a non-https iOS store URL is refused');
select throws_ok(
  $$ update platform.tenant_apps set store_url_android = 'http://play.google.com/store/apps/details?id=x' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_privacy_url_chk"',
  'an http:// Android store URL is refused');
select lives_ok(
  $$ update platform.tenant_apps set privacy_url = 'https://example.test/privacidade',
       store_url_ios = 'https://apps.apple.com/app/id1', store_url_android = 'https://play.google.com/store/apps/details?id=x'
      where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  'https privacy and store URLs are accepted');

-- versions
select throws_ok(
  $$ update platform.tenant_apps set min_version_ios = '1.2' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_versions_chk"',
  'a two-part iOS minimum version is refused');
select throws_ok(
  $$ update platform.tenant_apps set min_version_android = 'v1.2.3' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_versions_chk"',
  'a version with a v prefix is refused');
select throws_ok(
  $$ update platform.tenant_apps set min_version_android = '1.2.3.4' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_versions_chk"',
  'a four-part version is refused');
select lives_ok(
  $$ update platform.tenant_apps set min_version_ios = '1.2.3', min_version_android = '10.0.12' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  'three-part minimum versions are accepted');

-- ids and the lock on them
select throws_ok(
  $$ update platform.tenant_apps set bundle_id = 'single' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_ids_chk"',
  'a bundle id with one segment is refused');
select throws_ok(
  $$ update platform.tenant_apps set bundle_id = 'br.com.client_e.app' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_ids_chk"',
  'an iOS bundle id with an underscore is refused (Apple allows none)');
select throws_ok(
  $$ update platform.tenant_apps set application_id = 'br.com.client-e.app' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_ids_chk"',
  'an Android application id with a hyphen is refused');
select throws_ok(
  $$ update platform.tenant_apps set application_id = 'br.com.1abc' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_ids_chk"',
  'an application id whose segment starts with a digit is refused');
select throws_ok(
  format($$ update platform.tenant_apps set bundle_id = %L where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
         'br.com.' || repeat('a', 160)),
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_ids_chk"',
  'a bundle id longer than 160 characters is refused');
select throws_ok(
  $$ update platform.tenant_apps set ids_locked_at = now() where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_ids_locked_chk"',
  'ids_locked_at with no bundle id is refused');
select lives_ok(
  $$ update platform.tenant_apps set bundle_id = 'br.com.cliente-x.comunidade' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  'a bundle id with a hyphen is accepted');
select throws_ok(
  $$ update platform.tenant_apps set ids_locked_at = now() where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_ids_locked_chk"',
  'ids_locked_at with a bundle id but no application id is refused');
select lives_ok(
  $$ update platform.tenant_apps set application_id = 'br.com.cliente_x.comunidade' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  'an application id with an underscore is accepted');
select lives_ok(
  $$ update platform.tenant_apps set ids_locked_at = now() where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  'ids_locked_at with both ids present is accepted');
select throws_ok(
  $$ update platform.tenant_apps set application_id = null where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '23514', 'new row for relation "tenant_apps" violates check constraint "tenant_apps_ids_locked_chk"',
  'clearing an id while the lock is set is refused');
select throws_ok(
  $$ insert into platform.tenant_apps (tenant_id) values ('22400000-0000-4000-8000-000000000001') $$,
  '23505', null, 'a second tenant_apps row for one tenant is refused (the tenant id is the key)');
select throws_ok(
  $$ insert into platform.tenant_apps (tenant_id) values ('22400000-0000-4000-8000-0000000000ff') $$,
  '23503', null, 'an app row for a tenant that does not exist is refused (foreign key)');

-- ── 3. tenant_app_credentials ──────────────────────────────────────────────────────────────────
select lives_ok(
  $$ insert into platform.tenant_app_credentials (id, tenant_id, kind, sealed)
       values ('22400000-0000-4000-8000-0000000000c1', '22400000-0000-4000-8000-000000000001', 'asc_key', 'v1:1:aaaa:bbbb:cccc') $$,
  'a sealed asc_key credential is accepted');
select is(
  (select (held_at is not null)::text || '|' || kind from platform.tenant_app_credentials
    where id = '22400000-0000-4000-8000-0000000000c1'),
  'true|asc_key', 'a stored credential is held: held_at is set by default');
select lives_ok(
  $$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values
       ('22400000-0000-4000-8000-000000000002', 'asc_key', 'v1:1:a:b:c'),
       ('22400000-0000-4000-8000-000000000002', 'play_service_account', 'v1:1:a:b:c'),
       ('22400000-0000-4000-8000-000000000002', 'apns_key', 'v1:1:a:b:c'),
       ('22400000-0000-4000-8000-000000000002', 'ios_distribution', 'v1:1:a:b:c'),
       ('22400000-0000-4000-8000-000000000002', 'android_keystore', 'v1:1:a:b:c'),
       ('22400000-0000-4000-8000-000000000002', 'reviewer_password', 'v1:1:a:b:c') $$,
  'NATIVE-27: the three entered kinds and the three generated kinds are all accepted');
select is((select count(*)::int from platform.tenant_app_credentials where tenant_id = '22400000-0000-4000-8000-000000000002'), 6,
  'one tenant holds six credentials, one row per kind');
select throws_ok(
  $$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values ('22400000-0000-4000-8000-000000000003', 'foo', 'v1:1:a:b:c') $$,
  '23514', 'new row for relation "tenant_app_credentials" violates check constraint "tenant_app_credentials_kind_chk"',
  'NATIVE-27: a kind outside the six is refused');
select throws_ok(
  $$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values ('22400000-0000-4000-8000-000000000003', '', 'v1:1:a:b:c') $$,
  '23514', 'new row for relation "tenant_app_credentials" violates check constraint "tenant_app_credentials_kind_chk"',
  'an empty kind is refused');
select throws_ok(
  $$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values ('22400000-0000-4000-8000-000000000003', 'ASC_KEY', 'v1:1:a:b:c') $$,
  '23514', 'new row for relation "tenant_app_credentials" violates check constraint "tenant_app_credentials_kind_chk"',
  'a kind in the wrong case is refused');
select throws_ok(
  $$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values ('22400000-0000-4000-8000-000000000003', 'asc_key', null) $$,
  '23502', null, 'a credential with no sealed value is refused (not null)');
select throws_ok(
  $$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values ('22400000-0000-4000-8000-000000000001', 'asc_key', 'v1:1:d:d:d') $$,
  '23505', null, 'NATIVE-26: the same (tenant_id, kind) twice is refused (tenant_app_credentials_tenant_kind_uq)');
select lives_ok(
  $$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values ('22400000-0000-4000-8000-000000000003', 'asc_key', 'v1:1:a:b:c') $$,
  'the same kind for ANOTHER tenant is accepted');
select throws_ok(
  $$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values ('22400000-0000-4000-8000-0000000000ff', 'apns_key', 'v1:1:a:b:c') $$,
  '23503', null, 'a credential for a tenant that does not exist is refused (never an orphan)');
-- NATIVE-26: replace in place keeps the row id, so the sealed AAD `<rowId>:<kind>` stays valid
select lives_ok(
  $$ update platform.tenant_app_credentials set sealed = 'v1:1:new:new:new', held_at = now()
      where tenant_id = '22400000-0000-4000-8000-000000000001' and kind = 'asc_key' $$,
  'NATIVE-26: a replace is an update by (tenant_id, kind)');
select is(
  (select id from platform.tenant_app_credentials where tenant_id = '22400000-0000-4000-8000-000000000001' and kind = 'asc_key'),
  '22400000-0000-4000-8000-0000000000c1'::uuid, 'NATIVE-26: the replaced credential keeps its row id');
select is(
  (select sealed from platform.tenant_app_credentials where id = '22400000-0000-4000-8000-0000000000c1'),
  'v1:1:new:new:new', 'and holds the new sealed value');
select is(
  (select count(*)::int from platform.tenant_app_credentials where tenant_id = '22400000-0000-4000-8000-000000000001' and kind = 'asc_key'),
  1, 'NATIVE-26: exactly one row per (tenant, kind) after the replace');

-- ── 4. cascade on tenant delete ────────────────────────────────────────────────────────────────
insert into platform.tenant_apps (tenant_id, bundle_id) values ('22400000-0000-4000-8000-000000000004', 'br.com.cascade.app');
insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values
  ('22400000-0000-4000-8000-000000000004', 'apns_key', 'v1:1:a:b:c'),
  ('22400000-0000-4000-8000-000000000004', 'reviewer_password', 'v1:1:a:b:c');
select is(
  (select (select count(*) from platform.tenant_apps where tenant_id = '22400000-0000-4000-8000-000000000004')::int
        + (select count(*) from platform.tenant_app_credentials where tenant_id = '22400000-0000-4000-8000-000000000004')::int),
  3, 'before the delete: one app row and two credentials');
delete from public.tenants where id = '22400000-0000-4000-8000-000000000004';
select is((select count(*)::int from platform.tenant_apps where tenant_id = '22400000-0000-4000-8000-000000000004'), 0,
  'deleting the tenant removes its app row');
select is((select count(*)::int from platform.tenant_app_credentials where tenant_id = '22400000-0000-4000-8000-000000000004'), 0,
  'and every one of its credentials, in the same statement');
select is((select count(*)::int from platform.tenant_app_credentials where tenant_id = '22400000-0000-4000-8000-000000000002'), 6,
  'another tenant keeps its credentials (the cascade is per tenant)');

-- ── 5. exposure ────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relkind = 'r'), 13,
  'schema platform holds thirteen tables: the eleven of 210 and these two');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relname in ('tenant_apps', 'tenant_app_credentials')
      and c.relrowsecurity and not c.relforcerowsecurity),
  2, 'RLS is on and NOT forced on both tables');
select is(
  (select count(*)::int from pg_policies where schemaname = 'platform' and tablename in ('tenant_apps', 'tenant_app_credentials')),
  0, 'both tables have ZERO policies (service_role only; a policy for authenticated is always a bug)');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('api_user')) r(role_name)
    where n.nspname = 'platform' and c.relname in ('tenant_apps', 'tenant_app_credentials')
      and has_table_privilege(r.role_name, c.oid, 'select,insert,update,delete,truncate,references,trigger')),
  0, 'anon, authenticated and the bare api_user hold no privilege on either table');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relname in ('tenant_apps', 'tenant_app_credentials')
      and has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert')
      and has_table_privilege('service_role', c.oid, 'update') and has_table_privilege('service_role', c.oid, 'delete')),
  2, 'service_role holds select, insert, update and delete on both tables');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relname in ('tenant_apps', 'tenant_app_credentials')
      and has_table_privilege('public', c.oid, 'select,insert,update,delete')),
  0, 'PUBLIC holds no privilege on either table');

-- the cross-tenant negative: the tenant lane (authenticated with the tenant claims set) reads and writes nothing
select tests.as_tenant('22400000-0000-4000-8000-000000000001', '22400000-0000-4000-8000-0000000000a1', 'admin_tenant');
select throws_ok($$ select count(*) from platform.tenant_apps $$, '42501', null, 'T-13-09: the tenant lane cannot read platform.tenant_apps (42501)');
select throws_ok($$ select count(*) from platform.tenant_app_credentials $$, '42501', null, 'T-13-09: the tenant lane cannot read platform.tenant_app_credentials (42501)');
select throws_ok($$ select sealed from platform.tenant_app_credentials where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '42501', null, 'T-13-09: the tenant lane cannot read its OWN sealed value (42501)');
select throws_ok($$ select count(*) from platform.tenant_apps where tenant_id = '22400000-0000-4000-8000-000000000002' $$,
  '42501', null, 'T-13-09: the tenant lane cannot read another tenant''s app row (42501)');
select throws_ok($$ insert into platform.tenant_apps (tenant_id) values ('22400000-0000-4000-8000-000000000003') $$,
  '42501', null, 'the tenant lane cannot insert into platform.tenant_apps (42501)');
select throws_ok($$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values ('22400000-0000-4000-8000-000000000003', 'apns_key', 'v1:1:a:b:c') $$,
  '42501', null, 'the tenant lane cannot insert into platform.tenant_app_credentials (42501)');
select throws_ok($$ update platform.tenant_apps set purchase_ios = true where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the tenant lane cannot flip a purchase switch (42501)');
select throws_ok($$ update platform.tenant_app_credentials set sealed = 'v1:1:x:x:x' where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the tenant lane cannot overwrite a credential (42501)');
select throws_ok($$ delete from platform.tenant_apps where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the tenant lane cannot delete an app row (42501)');
select throws_ok($$ delete from platform.tenant_app_credentials where tenant_id = '22400000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the tenant lane cannot delete a credential (42501)');
reset role;

-- the bare api_user (the role the API connects as before it opens a lane) holds nothing either
select tests.allow_role_switch();
select tests.as_api_user();
select throws_ok($$ select count(*) from platform.tenant_apps $$, '42501', null, 'the bare api_user cannot read platform.tenant_apps (42501)');
select throws_ok($$ select count(*) from platform.tenant_app_credentials $$, '42501', null, 'the bare api_user cannot read platform.tenant_app_credentials (42501)');
select throws_ok($$ insert into platform.tenant_apps (tenant_id) values ('22400000-0000-4000-8000-000000000003') $$,
  '42501', null, 'the bare api_user cannot write platform.tenant_apps (42501)');
select throws_ok($$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values ('22400000-0000-4000-8000-000000000003', 'apns_key', 'v1:1:a:b:c') $$,
  '42501', null, 'the bare api_user cannot write platform.tenant_app_credentials (42501)');
reset role;

set local role anon;
select throws_ok($$ select count(*) from platform.tenant_apps $$, '42501', null, 'anon cannot read platform.tenant_apps (42501)');
select throws_ok($$ select count(*) from platform.tenant_app_credentials $$, '42501', null, 'anon cannot read platform.tenant_app_credentials (42501)');
reset role;

-- the platform lane (service_role) is the only reader and writer
select tests.as_service();
select lives_ok($$ select count(*) from platform.tenant_apps $$, 'service_role reads platform.tenant_apps');
select lives_ok($$ select count(*) from platform.tenant_app_credentials $$, 'service_role reads platform.tenant_app_credentials');
select lives_ok($$ insert into platform.tenant_apps (tenant_id) values ('22400000-0000-4000-8000-000000000003') $$,
  'service_role inserts into platform.tenant_apps');
select lives_ok($$ insert into platform.tenant_app_credentials (tenant_id, kind, sealed) values ('22400000-0000-4000-8000-000000000003', 'apns_key', 'v1:1:a:b:c') $$,
  'service_role inserts into platform.tenant_app_credentials');
select lives_ok($$ update platform.tenant_apps set purchase_android = true where tenant_id = '22400000-0000-4000-8000-000000000003' $$,
  'service_role updates platform.tenant_apps');
select lives_ok($$ update platform.tenant_app_credentials set sealed = 'v1:1:y:y:y' where tenant_id = '22400000-0000-4000-8000-000000000003' and kind = 'apns_key' $$,
  'service_role updates platform.tenant_app_credentials');
select lives_ok($$ delete from platform.tenant_app_credentials where tenant_id = '22400000-0000-4000-8000-000000000003' and kind = 'apns_key' $$,
  'service_role deletes from platform.tenant_app_credentials');
select lives_ok($$ delete from platform.tenant_apps where tenant_id = '22400000-0000-4000-8000-000000000003' $$,
  'service_role deletes from platform.tenant_apps');
reset role;

-- the closing hardening migration is in the central ledger and in no tenant ledger
select is(
  (select count(*)::int from supabase_migrations.central_migrations where name in ('platform_tenant_apps', 'platform_tenant_apps_hardening')),
  2, 'T-13-10: the tables migration and its closing hardening migration are both recorded in the central ledger');
select is(
  (select count(*)::int from supabase_migrations.schema_migrations where name in ('platform_tenant_apps', 'platform_tenant_apps_hardening')),
  0, 'T-13-10: and in no tenant ledger: the tenant set never carries them (rede_tenant_b is proven by --assert-no-platform)');

select * from finish();
rollback;
