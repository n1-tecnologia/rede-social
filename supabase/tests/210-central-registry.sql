begin;
-- 210-central-registry.sql — Phase 09.2-02 (DBT-01 table half, DBT-32, DBT-46; D-538, D-540, D-547; P2;
-- T-09.2-06, T-09.2-08): the CENTRAL set's `platform` registry executed inside Postgres.
--
-- 1. SHAPE: the schema, the five registry tables, their primary keys and the five named indexes. (09.2-10 added
--    three route-index tables to the schema and 09.2-23 the two move tables; the exposure counts below cover all ten, their keys are 214's and 215's.)
-- 2. CHECKs (23514) and uniqueness (23505): ref/provider/state formats, `env` credentials only on the central
--    row, the smallint key id and the integer credential version (P2: 0 and -1 are refused by the CHECK, 32768
--    does not fit the smallint at all), the api_url scheme, one central, one default, one hook_ref, the step and
--    status vocabularies; and TWO TENANTS BOUND TO ONE PROJECT ARE ACCEPTED (D-540).
-- 3. EXPOSURE: RLS on and not forced, ZERO policies, no privilege for `anon`, `authenticated` or the bare
--    `api_user`, full privilege for `service_role`; the tenant lane gets 42501 on every read and write.
-- 4. THE DEFAULT BINDING (D-538, DBT-46): a tenant with no binding is bound at commit to the flagged default,
--    an explicit binding is never overridden, a tenant inserted and deleted in one transaction is ignored, and
--    with no default flagged the commit RAISES P0001 (fail closed).
-- 5. PROJECT 0 is central, default and `env`.
--
-- Fixture ids use the `21000000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
-- The deferred constraint trigger fires only when the transaction would commit or on `set constraints`, so
-- section 4 forces it with `set constraints tenants_bind_default immediate`.
select plan(71);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
insert into platform.projects (id, ref, label, api_url, state) values
  ('21000000-0000-4000-8000-0000000000b1', 'pgtap-project-x', 'Projeto X', 'https://pgtap-x.example.test', 'ready');

select tests.tenant('pgtap-reg-a', 'Reg A', '21000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-reg-b', 'Reg B', '21000000-0000-4000-8000-000000000002');
select tests.tenant('pgtap-reg-c', 'Reg C', '21000000-0000-4000-8000-000000000003');

-- ── 1. shape ───────────────────────────────────────────────────────────────────────────────────
select has_schema('platform', 'schema platform exists in the central project');
select has_table('platform', 'projects', 'platform.projects exists');
select has_table('platform', 'tenant_projects', 'platform.tenant_projects exists');
select has_table('platform', 'project_bootstrap_steps', 'platform.project_bootstrap_steps exists');
select has_table('platform', 'project_schema_state', 'platform.project_schema_state exists');
select has_table('platform', 'project_health', 'platform.project_health exists');
select has_pk('platform', 'projects', 'projects has a primary key');
select col_is_pk('platform', 'tenant_projects', 'tenant_id', 'tenant_projects is keyed by tenant_id (one binding per tenant)');
select col_is_pk('platform', 'project_bootstrap_steps', array['project_id', 'step'], 'bootstrap steps are keyed by (project_id, step)');
select col_is_pk('platform', 'project_schema_state', 'project_id', 'project_schema_state is keyed by project_id');
select col_is_pk('platform', 'project_health', 'project_id', 'project_health is keyed by project_id');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and tablename = 'projects' and indexname = 'projects_ref_uq'), 'index projects_ref_uq exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and tablename = 'projects' and indexname = 'projects_one_central_uq'), 'index projects_one_central_uq exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and tablename = 'projects' and indexname = 'projects_one_default_uq'), 'index projects_one_default_uq exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and tablename = 'projects' and indexname = 'projects_hook_ref_uq'), 'index projects_hook_ref_uq exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and tablename = 'tenant_projects' and indexname = 'tenant_projects_project_idx'), 'index tenant_projects_project_idx exists');

-- ── 2. CHECKs and uniqueness ───────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into platform.projects (ref, api_url) values ('Upper-Case', '') $$,
  '23514', null, 'a ref with a capital letter is refused by the format CHECK');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, provider) values ('pgtap-bad-provider', '', 'Supabase') $$,
  '23514', null, 'a provider with a capital letter is refused (format, never an enum)');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, state) values ('pgtap-bad-state', '', 'Ready') $$,
  '23514', null, 'a state outside the lower-snake format is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, credential_source) values ('pgtap-bad-source', '', 'vault') $$,
  '23514', null, 'a credential source other than env or sealed is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, credential_source) values ('pgtap-env-leaf', '', 'env') $$,
  '23514', null, 'env credentials are refused on a project that is not the central one');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, secret_key_id) values ('pgtap-key-0', '', 0) $$,
  '23514', null, 'P2: secret_key_id 0 is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, secret_key_id) values ('pgtap-key-neg', '', -1) $$,
  '23514', null, 'P2: secret_key_id -1 is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, secret_key_id) values ('pgtap-key-wrap', '', 32768) $$,
  '22003', null, 'P2: secret_key_id 32768 does not fit the smallint (it can never wrap)');
select lives_ok(
  $$ insert into platform.projects (ref, api_url, secret_key_id) values ('pgtap-key-min', '', 1), ('pgtap-key-max', '', 32767) $$,
  'P2: the bounds 1 and 32767 are accepted');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, credential_version) values ('pgtap-ver-0', '', 0) $$,
  '23514', null, 'P2: credential_version 0 is refused (a version never goes back)');
select throws_ok(
  $$ insert into platform.projects (ref, api_url) values ('pgtap-url-bare', 'example.test') $$,
  '23514', null, 'an api_url without a scheme is refused');
select throws_ok(
  $$ insert into platform.projects (ref, api_url) values ('pgtap-url-ftp', 'ftp://example.test') $$,
  '23514', null, 'an api_url with a scheme other than http(s) is refused');
select lives_ok(
  $$ insert into platform.projects (ref, api_url) values ('pgtap-url-empty', ''), ('pgtap-url-https', 'https://example.test') $$,
  'an empty api_url (project 0 placeholder) and an https one are accepted');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, is_central) values ('pgtap-second-central', '', true) $$,
  '23505', null, 'a second central project is refused (projects_one_central_uq)');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, is_default) values ('pgtap-second-default', '', true) $$,
  '23505', null, 'a second default project is refused (projects_one_default_uq)');
select throws_ok(
  $$ insert into platform.projects (ref, api_url) values ((select ref from platform.projects where is_central), '') $$,
  '23505', null, 'a duplicate ref is refused (projects_ref_uq)');
select lives_ok(
  $$ insert into platform.projects (ref, api_url, hook_ref) values ('pgtap-hook-a', '', 'hook-ref-a') $$,
  'a hook_ref is accepted once');
select throws_ok(
  $$ insert into platform.projects (ref, api_url, hook_ref) values ('pgtap-hook-b', '', 'hook-ref-a') $$,
  '23505', null, 'a duplicate hook_ref is refused (projects_hook_ref_uq)');
select throws_ok(
  $$ insert into platform.project_bootstrap_steps (project_id, step) values ('21000000-0000-4000-8000-0000000000b1', 'bogus') $$,
  '23514', null, 'a bootstrap step outside the eight keys is refused');
select throws_ok(
  $$ insert into platform.project_bootstrap_steps (project_id, step, status) values ('21000000-0000-4000-8000-0000000000b1', 'verify', 'bogus') $$,
  '23514', null, 'a bootstrap status outside the four values is refused');
select lives_ok(
  $$ insert into platform.project_bootstrap_steps (project_id, step) values ('21000000-0000-4000-8000-0000000000b1', 'verify') $$,
  'a valid bootstrap step is accepted');
select throws_ok(
  $$ insert into platform.project_bootstrap_steps (project_id, step) values ('21000000-0000-4000-8000-0000000000b1', 'verify') $$,
  '23505', null, 'the same step twice for one project is refused');
select throws_ok(
  $$ insert into platform.project_schema_state (project_id, status) values ('21000000-0000-4000-8000-0000000000b1', 'bogus') $$,
  '23514', null, 'a schema-state status outside the four values is refused');
select throws_ok(
  $$ insert into platform.project_health (project_id, status) values ('21000000-0000-4000-8000-0000000000b1', 'bogus') $$,
  '23514', null, 'a health status outside the four values is refused');
select throws_ok(
  $$ insert into platform.tenant_projects (tenant_id, project_id) values ('21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-00000000dead') $$,
  '23503', null, 'a binding to an unknown project is refused (foreign key)');

-- D-540: several tenants may bind ONE project. The rule that production refuses a second one is an
-- application rule (plan 14), never a database rule.
select lives_ok(
  $$ insert into platform.tenant_projects (tenant_id, project_id) values
       ('21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-0000000000b1'),
       ('21000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-0000000000b1') $$,
  'D-540: two tenants bound to one project are accepted');
select is((select count(*)::int from platform.tenant_projects where project_id = '21000000-0000-4000-8000-0000000000b1'), 2,
  'D-540: the project holds both bindings');
select throws_ok(
  $$ insert into platform.tenant_projects (tenant_id, project_id) values ('21000000-0000-4000-8000-000000000001', (select id from platform.projects where is_central)) $$,
  '23505', null, 'a tenant has ONE binding (tenant_id is the primary key)');

-- ── 3. exposure ────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relkind = 'r'), 10,
  'schema platform holds exactly the five registry tables, the three route indexes (09.2-10, proved in 214) and the two move tables (09.2-23, proved in 215)');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'platform' and c.relkind = 'r' and c.relrowsecurity and not c.relforcerowsecurity), 10,
  'all ten tables: RLS on and NOT forced');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform'), 0,
  'platform has ZERO policies (the registry is service_role only)');
select ok(not has_schema_privilege('anon', 'platform', 'usage'), 'anon has no USAGE on schema platform');
select ok(not has_schema_privilege('authenticated', 'platform', 'usage'), 'authenticated has no USAGE on schema platform');
select ok(not has_schema_privilege('api_user', 'platform', 'usage'), 'the bare api_user has no USAGE on schema platform');
select ok(has_schema_privilege('service_role', 'platform', 'usage'), 'service_role has USAGE on schema platform');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            cross join (values ('anon'), ('authenticated'), ('api_user')) r(role_name)
            where n.nspname = 'platform' and c.relkind = 'r'
              and has_table_privilege(r.role_name, c.oid, 'select,insert,update,delete,truncate,references,trigger')), 0,
  'anon, authenticated and the bare api_user hold no privilege on any platform table');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'platform' and c.relkind = 'r'
              and has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert')
              and has_table_privilege('service_role', c.oid, 'update') and has_table_privilege('service_role', c.oid, 'delete')), 10,
  'service_role holds select, insert, update and delete on all ten tables');
select ok(
  not has_function_privilege('anon', 'platform.bind_default_project()', 'execute')
    and not has_function_privilege('authenticated', 'platform.bind_default_project()', 'execute'),
  'bind_default_project is not executable by anon or authenticated');
select is((select prosecdef from pg_proc where oid = 'platform.bind_default_project()'::regprocedure), true,
  'bind_default_project is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'platform.bind_default_project()'::regprocedure), array['search_path=""'],
  'bind_default_project pins an empty search_path');

-- the cross-tenant negative: no tenant lane can read or write the registry
set local role authenticated;
select throws_ok($$ select count(*) from platform.projects $$, '42501', null, 'authenticated cannot read platform.projects (42501)');
select throws_ok($$ select count(*) from platform.tenant_projects $$, '42501', null, 'authenticated cannot read platform.tenant_projects (42501)');
select throws_ok($$ insert into platform.projects (ref, api_url) values ('pgtap-lane', '') $$, '42501', null, 'authenticated cannot write platform.projects (42501)');
reset role;
set local role anon;
select throws_ok($$ select count(*) from platform.projects $$, '42501', null, 'anon cannot read platform.projects (42501)');
reset role;
set local role service_role;
select ok((select count(*) from platform.projects) >= 1, 'service_role reads the registry');
select lives_ok($$ update platform.projects set label = 'Projeto X' where id = '21000000-0000-4000-8000-0000000000b1' $$,
  'service_role writes the registry');
reset role;

-- ── 4. the default binding (fail closed) ───────────────────────────────────────────────────────
-- D and E and G are inserted now; the deferred trigger has not fired for any tenant yet.
select tests.tenant('pgtap-reg-d', 'Reg D', '21000000-0000-4000-8000-000000000004');
select tests.tenant('pgtap-reg-e', 'Reg E', '21000000-0000-4000-8000-000000000005');
select tests.tenant('pgtap-reg-g', 'Reg G', '21000000-0000-4000-8000-000000000007');
insert into platform.tenant_projects (tenant_id, project_id) values
  ('21000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-0000000000b1');
delete from public.tenants where id = '21000000-0000-4000-8000-000000000007';

select is((select count(*)::int from platform.tenant_projects where tenant_id = '21000000-0000-4000-8000-000000000004'), 0,
  'before commit, an unbound tenant has no binding yet (the trigger is deferred)');
set constraints tenants_bind_default immediate;
set constraints tenants_bind_default deferred;

select is(
  (select p.is_default and p.is_central from platform.tenant_projects tp join platform.projects p on p.id = tp.project_id
    where tp.tenant_id = '21000000-0000-4000-8000-000000000004'),
  true, 'an unbound tenant is bound at commit to the project flagged is_default');
select is(
  (select tp.project_id from platform.tenant_projects tp where tp.tenant_id = '21000000-0000-4000-8000-000000000005'),
  '21000000-0000-4000-8000-0000000000b1'::uuid, 'an explicit binding written in the same transaction is NOT overridden');
select is((select count(*)::int from platform.tenant_projects where tenant_id = '21000000-0000-4000-8000-000000000007'), 0,
  'a tenant inserted and deleted in one transaction is not bound and does not raise');
select is(
  (select tp.project_id from platform.tenant_projects tp where tp.tenant_id = '21000000-0000-4000-8000-000000000003'),
  (select id from platform.projects where is_central),
  'tenant C (unbound before the trigger first fired) was bound to project 0');

-- With no project flagged as the default the commit RAISES instead of leaving the tenant unbound.
update platform.projects set is_default = false;
select tests.tenant('pgtap-reg-f', 'Reg F', '21000000-0000-4000-8000-000000000006');
select throws_ok(
  $$ set constraints tenants_bind_default immediate $$,
  'P0001', 'tenant 21000000-0000-4000-8000-000000000006 has no project binding and no default project exists',
  'with no default project flagged, an unbound tenant fails closed at commit (DBT-46)');

-- ── 5. project 0 ───────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from platform.projects where is_central and credential_source = 'env' and state = 'ready'), 1,
  'project 0 is registered: central, env credentials, ready');
-- ensureProjectZero (the seed, the worker boot) renames it and fills the url from the environment, so the row is
-- either the migration's placeholder or a described environment: both satisfy the table's check.
select ok(
  (select api_url = '' or api_url ~ '^https?://' from platform.projects where is_central),
  'project 0 public coordinates are the placeholder until ensureProjectZero fills them, then the environment url');
select is((select count(*)::int from platform.projects where is_central), 1, 'exactly one central project');

select * from finish();
rollback;
