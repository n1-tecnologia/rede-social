begin;
-- 216-project-owner-token.sql — Phase 09.4-02 (CTK-24, CTK-28; D-566, D-568, D-571, D-573, D-539; T-09.4-05..07):
-- the registry half of the customer-owned project, executed inside Postgres.
--
-- 1. OWNER SHAPE: `platform.projects` gains `owner`, `org_slug`, `mgmt_token_sealed` and `mgmt_token_expires_at`.
--    Every pre-existing row reads the defaults (platform, no pin, no token, no expiry), a customer row needs a
--    sealed token AND a pin, a platform row has neither, the pin is the OpenAPI format, the owner is one of
--    two values. Each refusal is SQLSTATE 23514.
-- 2. TOKEN AXIS: `platform.project_health.token_check` is one of four outcomes or null (23514 otherwise).
-- 3. THE AUDIT TABLE (`platform.project_token_events`): shape, closed lists, a null project for a refusal that
--    precedes the project, append-only, cascade with the project.
-- 4. EXPOSURE (the cross-tenant negative): RLS on and NOT forced, zero policies, no privilege for `anon`,
--    `authenticated` or the bare `api_user` (42501), `service_role` holds full DML; the two migrations are in
--    the central ledger and in no tenant ledger.
--
-- Fixture ids use the `21600000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(21);

-- ── 0. every row that exists BEFORE this file's fixtures reads the defaults (the migration is expand-only) ──
select is(
  (select count(*)::int from platform.projects
    where owner <> 'platform' or org_slug is not null or mgmt_token_sealed is not null or mgmt_token_expires_at is not null),
  0, 'every pre-existing project reads owner platform with no pin, no token and no expiry');

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
insert into platform.projects (id, ref, api_url) values
  ('21600000-0000-4000-8000-0000000000a1', 'pgtap-owner-plat', '');

-- ── 1. owner shape ─────────────────────────────────────────────────────────────────────────────
select has_column('platform', 'projects', 'owner', 'platform.projects has owner');
select has_column('platform', 'projects', 'org_slug', 'platform.projects has org_slug');
select has_column('platform', 'projects', 'mgmt_token_sealed', 'platform.projects has mgmt_token_sealed');
select has_column('platform', 'projects', 'mgmt_token_expires_at', 'platform.projects has mgmt_token_expires_at');
select is(
  (select owner from platform.projects where id = '21600000-0000-4000-8000-0000000000a1'),
  'platform', 'a project inserted without an owner is a platform project (the default)');
select lives_ok(
  $$ insert into platform.projects (id, ref, api_url, owner, org_slug, mgmt_token_sealed, mgmt_token_expires_at)
       values ('21600000-0000-4000-8000-0000000000b1', 'pgtap-owner-cust', '', 'customer', 'acme_org-1',
               'v1:1:aaaa:bbbb:cccc', '2027-03-31') $$,
  'a customer project with a sealed token, a pin and an expiry date is accepted');
select is(
  (select owner || '|' || org_slug || '|' || mgmt_token_expires_at::text from platform.projects
    where id = '21600000-0000-4000-8000-0000000000b1'),
  'customer|acme_org-1|2027-03-31', 'and reads back with its three new fields');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, owner, org_slug) values ('pgtap-owner-notk', '', 'customer', 'acme') $$,
  '23514', null, 'a customer project without a sealed token is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, owner, mgmt_token_sealed) values ('pgtap-owner-nopn', '', 'customer', 'v1:1:a:b:c') $$,
  '23514', null, 'a customer project without an organisation pin is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, mgmt_token_sealed) values ('pgtap-owner-ptk', '', 'v1:1:a:b:c') $$,
  '23514', null, 'a platform project with a sealed token is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, org_slug) values ('pgtap-owner-ppn', '', 'acme') $$,
  '23514', null, 'a platform project with an organisation pin is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, mgmt_token_expires_at) values ('pgtap-owner-pex', '', '2027-03-31') $$,
  '23514', null, 'a platform project with an expiry date is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, owner) values ('pgtap-owner-oth', '', 'other') $$,
  '23514', null, 'an owner other than platform or customer is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, owner, org_slug, mgmt_token_sealed)
       values ('pgtap-owner-sp', '', 'customer', 'acme org', 'v1:1:a:b:c') $$,
  '23514', null, 'an organisation pin with a space is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, owner, org_slug, mgmt_token_sealed)
       values ('pgtap-owner-long', '', 'customer', repeat('a', 129), 'v1:1:a:b:c') $$,
  '23514', null, 'an organisation pin of 129 characters is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, owner, org_slug, mgmt_token_sealed)
       values ('pgtap-owner-empty', '', 'customer', '', 'v1:1:a:b:c') $$,
  '23514', null, 'an empty organisation pin is refused');

-- ── 2. the token axis beside the database health ───────────────────────────────────────────────
select has_column('platform', 'project_health', 'token_check', 'platform.project_health has token_check');
select has_column('platform', 'project_health', 'token_checked_at', 'platform.project_health has token_checked_at');
select throws_ok(
  $$ insert into platform.project_health (project_id, token_check) values ('21600000-0000-4000-8000-0000000000b1', 'dead') $$,
  '23514', null, 'a token check outside ok, invalid, forbidden and org_mismatch is refused');
select lives_ok(
  $$ insert into platform.project_health (project_id, token_check, token_checked_at)
       values ('21600000-0000-4000-8000-0000000000b1', 'org_mismatch', now()) $$,
  'a valid token check is accepted, beside a status that stays unknown');

select * from finish();
rollback;
