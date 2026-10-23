begin;
-- 213-pgboss-platform.sql — Phase 09.2-09 (DBT-29, DBT-32; D-546; T-09.2-44): the control plane's job schema
-- `pgboss_platform`, the CENTRAL set's copy of the pg-boss schema, executed inside Postgres.
--
-- 1. SHAPE: it has the same tables, functions, job indexes and schema version as the tenant set's `pgboss`, so
--    a pg-boss upgrade that changes one schema without the other fails here. The dated `queue_stats_<yyyymmdd>`
--    partitions pg-boss adds as time passes are left out of the table comparison (they depend on the day).
-- 2. EXPOSURE: no privilege for `anon` or `authenticated`, full DML for `api_user`; the tenant lane gets 42501
--    on every read and write of a platform job payload (the cross-tenant negative).
-- 3. IT WORKS: a queue is created and a job inserted and read back; only `api_user` may call the functions.
--
-- Fixture ids use the `21300000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(25);

-- ── 1. shape ───────────────────────────────────────────────────────────────────────────────────
select has_schema('pgboss_platform', 'schema pgboss_platform exists in the central project');
select has_table('pgboss_platform', 'job', 'pgboss_platform.job exists');
select has_table('pgboss_platform', 'queue', 'pgboss_platform.queue exists');
select has_table('pgboss_platform', 'schedule', 'pgboss_platform.schedule exists');
select has_table('pgboss_platform', 'version', 'pgboss_platform.version exists');

select is(
  (select array_agg(tablename::text order by tablename) from pg_tables
    where schemaname = 'pgboss_platform' and tablename !~ '^queue_stats_[0-9]+$'),
  (select array_agg(tablename::text order by tablename) from pg_tables
    where schemaname = 'pgboss' and tablename !~ '^queue_stats_[0-9]+$'),
  'pgboss_platform has the same tables as pgboss');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pgboss_platform'),
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pgboss'),
  'pgboss_platform has the same functions as pgboss');
select is(
  (select array_agg(indexname::text order by indexname) from pg_indexes
    where schemaname = 'pgboss_platform' and tablename in ('job', 'job_common')),
  (select array_agg(indexname::text order by indexname) from pg_indexes
    where schemaname = 'pgboss' and tablename in ('job', 'job_common')),
  'pgboss_platform has the same job indexes as pgboss');
select is(
  (select version from pgboss_platform.version),
  (select version from pgboss.version),
  'pgboss_platform is at the same pg-boss schema version as pgboss');
select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'pgboss_platform' and tablename = 'job_common' and indexname = 'job_common_i1'
             and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%short%'),
  'the short-policy unique index (job_common_i1) exists on the platform schema, as on the tenant one');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pgboss_platform' and c.relkind in ('r', 'p') and c.relname !~ '^queue_stats_[0-9]+$'),
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pgboss' and c.relkind in ('r', 'p') and c.relname !~ '^queue_stats_[0-9]+$'),
  'the two schemas hold the same number of relations');

-- ── 2. exposure ────────────────────────────────────────────────────────────────────────────────
select ok(not has_schema_privilege('anon', 'pgboss_platform', 'usage'), 'anon has no USAGE on pgboss_platform');
select ok(not has_schema_privilege('authenticated', 'pgboss_platform', 'usage'), 'authenticated has no USAGE on pgboss_platform');
select ok(has_schema_privilege('api_user', 'pgboss_platform', 'usage'), 'api_user has USAGE on pgboss_platform');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(role_name)
    where n.nspname = 'pgboss_platform' and c.relkind in ('r', 'p')
      and has_table_privilege(r.role_name, c.oid, 'select,insert,update,delete,truncate,references,trigger')),
  0,
  'anon and authenticated hold no privilege on any pgboss_platform table');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pgboss_platform' and c.relkind in ('r', 'p')
      and not (has_table_privilege('api_user', c.oid, 'select') and has_table_privilege('api_user', c.oid, 'insert')
               and has_table_privilege('api_user', c.oid, 'update') and has_table_privilege('api_user', c.oid, 'delete'))),
  0,
  'api_user holds select, insert, update and delete on every pgboss_platform table');

-- the cross-tenant negative: no tenant lane can read or write a platform job payload
set local role authenticated;
select throws_ok($$ select count(*) from pgboss_platform.job $$, '42501', null,
  'authenticated cannot read pgboss_platform.job (42501)');
select throws_ok($$ insert into pgboss_platform.job (name, data) values ('x', '{}'::jsonb) $$, '42501', null,
  'authenticated cannot write pgboss_platform.job (42501)');
select throws_ok($$ select count(*) from pgboss_platform.queue $$, '42501', null,
  'authenticated cannot read pgboss_platform.queue (42501)');
reset role;
set local role anon;
select throws_ok($$ select count(*) from pgboss_platform.job $$, '42501', null,
  'anon cannot read pgboss_platform.job (42501)');
reset role;

-- ── 3. it works, and only the connection role may call it ──────────────────────────────────────
-- The migration role (not a member of `api_user`) cannot `set role api_user`, so the privileges of the real
-- runtime role are asserted through the catalog, and the functions are exercised as the owner.
select ok(has_function_privilege('api_user', 'pgboss_platform.create_queue(text, jsonb)', 'execute'),
  'api_user can execute pgboss_platform.create_queue');
select ok(not has_function_privilege('authenticated', 'pgboss_platform.create_queue(text, jsonb)', 'execute')
          and not has_function_privilege('anon', 'pgboss_platform.create_queue(text, jsonb)', 'execute'),
  'anon and authenticated cannot execute pgboss_platform.create_queue');
select lives_ok(
  $$ select pgboss_platform.create_queue('pgtap-213-queue', '{"policy":"short"}'::jsonb) $$,
  'a queue can be created in the platform schema');
select lives_ok(
  $$ insert into pgboss_platform.job (id, name, data, singleton_key, policy)
       values ('21300000-0000-4000-8000-000000000001', 'pgtap-213-queue', '{"probe":1}'::jsonb, 'k', 'short') $$,
  'a job can be inserted');
select is(
  (select data->>'probe' from pgboss_platform.job where id = '21300000-0000-4000-8000-000000000001'),
  '1',
  'and read back');

select * from finish();
rollback;
