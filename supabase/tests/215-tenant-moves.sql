begin;
-- 215-tenant-moves.sql — Phase 09.2-23 (DBT-34, DBT-48; D-534, D-535, D-536; T-09.2-103): the two CENTRAL tables
-- of the move tool, executed inside Postgres.
--
-- 1. SHAPE: `platform.tenant_moves` (the state machine of ONE move) and `platform.tenant_move_events` (its
--    append-only audit), their keys and indexes, and that the migrations that create them are recorded in the
--    central ledger and in no tenant ledger (the tenant set never carries them).
-- 2. CHECKS: a state outside the seven, `from = to`, an actor with a space, a status that is neither active nor
--    suspended and a malformed error code are refused with 23514.
-- 3. ONE OPEN MOVE PER TENANT: the partial unique index refuses a second open move (23505) and accepts a new one
--    once the first is `done` or `rolled_back`; another tenant has its own.
-- 4. THE AUDIT IS APPEND-ONLY: an event cannot be updated, not even by the service role (P0001), but the
--    cascade delete from the tenant (and so from the move) stays possible.
-- 5. EXPOSURE (the cross-tenant negative): RLS on and NOT forced, zero policies, no privilege for `anon`,
--    `authenticated` or the bare `api_user`; the tenant lane gets 42501 on every read and write;
--    `service_role` (the platform lane) holds full DML.
--
-- Fixture ids use the `21500000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(47);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-move-a', 'Move A', '21500000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-move-b', 'Move B', '21500000-0000-4000-8000-000000000002');
insert into platform.projects (id, ref, api_url) values
  ('21500000-0000-4000-8000-0000000000a1', 'pgtap-move-from', ''),
  ('21500000-0000-4000-8000-0000000000a2', 'pgtap-move-to', '');

-- ── 1. shape ───────────────────────────────────────────────────────────────────────────────────
select has_table('platform', 'tenant_moves', 'platform.tenant_moves exists');
select has_table('platform', 'tenant_move_events', 'platform.tenant_move_events exists');
select col_is_pk('platform', 'tenant_moves', 'id', 'a move is keyed by its id');
select col_is_pk('platform', 'tenant_move_events', 'id', 'an event is keyed by its id');
select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'platform' and indexname = 'tenant_moves_one_open_uq'
             and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%done%' and indexdef like '%rolled_back%'),
  'tenant_moves_one_open_uq is a unique partial index that leaves out done and rolled_back');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and indexname = 'tenant_moves_to_project_idx'), 'index tenant_moves_to_project_idx exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'platform' and indexname = 'tenant_move_events_move_idx'), 'index tenant_move_events_move_idx exists');
select is(
  (select count(*)::int from supabase_migrations.central_migrations where version in ('20261023112329', '20261023112332')),
  2, 'both move migrations are recorded in the central ledger');
select is(
  (select count(*)::int from supabase_migrations.schema_migrations where version in ('20261023112329', '20261023112332')),
  0, 'and in no tenant ledger: the tenant set never carries them (rede_tenant_b is proven by --assert-no-platform)');

-- ── 2. checks ──────────────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, state, status_before, actor)
       values ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a2', 'bogus', 'active', 'cli') $$,
  '23514', null, 'a state outside the seven is refused');
select throws_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a1', 'active', 'cli') $$,
  '23514', null, 'a move from a project to itself is refused');
select throws_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a2', 'active', 'igor vboas') $$,
  '23514', null, 'an actor with a space is refused (an operator label, never free text)');
select throws_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a2', 'moving', 'cli') $$,
  '23514', null, 'a status_before other than active or suspended is refused');
select throws_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, status_before, actor, error_code)
       values ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a2', 'active', 'cli', 'Bad Code') $$,
  '23514', null, 'an error code that is not a lower-case code is refused');
select throws_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-0000000000ff', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a2', 'active', 'cli') $$,
  '23503', null, 'a move for a tenant that does not exist is refused (foreign key)');
select throws_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000ff', 'active', 'cli') $$,
  '23503', null, 'a move to a project that does not exist is refused (foreign key)');

-- ── 3. one open move per tenant ────────────────────────────────────────────────────────────────
select lives_ok(
  $$ insert into platform.tenant_moves (id, tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-0000000001c1', '21500000-0000-4000-8000-000000000001',
               '21500000-0000-4000-8000-0000000000a1', '21500000-0000-4000-8000-0000000000a2', 'active', 'cli:test') $$,
  'a valid move is accepted, in state planned by default');
select is(
  (select state from platform.tenant_moves where id = '21500000-0000-4000-8000-0000000001c1'),
  'planned', 'a new move starts planned');
select throws_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a2', 'active', 'cli') $$,
  '23505', null, 'a second open move for the same tenant is refused (tenant_moves_one_open_uq)');
select lives_ok(
  $$ update platform.tenant_moves set state = 'cutover' where id = '21500000-0000-4000-8000-0000000001c1' $$,
  'an open move advances');
select throws_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a2', 'active', 'cli') $$,
  '23505', null, 'a move in cutover still holds the tenant');
select lives_ok(
  $$ update platform.tenant_moves set state = 'done' where id = '21500000-0000-4000-8000-0000000001c1' $$,
  'the move ends done');
select lives_ok(
  $$ insert into platform.tenant_moves (id, tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-0000000001c2', '21500000-0000-4000-8000-000000000001',
               '21500000-0000-4000-8000-0000000000a2', '21500000-0000-4000-8000-0000000000a1', 'active', 'cli') $$,
  'once the first is done a new open move is accepted');
select lives_ok(
  $$ update platform.tenant_moves set state = 'rolled_back' where id = '21500000-0000-4000-8000-0000000001c2' $$,
  'and it may end rolled_back');
select lives_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, state, status_before, actor)
       values ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a2', 'rolled_back', 'suspended', 'cli'),
              ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a2', 'done', 'active', 'cli') $$,
  'any number of closed moves may coexist for one tenant');
select lives_ok(
  $$ insert into platform.tenant_moves (id, tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-0000000001d1', '21500000-0000-4000-8000-000000000002',
               '21500000-0000-4000-8000-0000000000a1', '21500000-0000-4000-8000-0000000000a2', 'suspended', 'cli') $$,
  'another tenant has its own open move');

-- ── 4. the audit is append-only ────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into platform.tenant_move_events (move_id, kind) values ('21500000-0000-4000-8000-0000000001d1', 'Bad Kind') $$,
  '23514', null, 'an event kind that is not a lower-case code is refused');
select lives_ok(
  $$ insert into platform.tenant_move_events (id, move_id, kind, detail)
       values ('21500000-0000-4000-8000-0000000002e1', '21500000-0000-4000-8000-0000000001d1', 'started', '{"tables": 12}') $$,
  'an event is appended');
select throws_ok(
  $$ update platform.tenant_move_events set kind = 'changed_kind' where id = '21500000-0000-4000-8000-0000000002e1' $$,
  'P0001', 'platform.tenant_move_events is append-only', 'an event cannot be edited afterwards (kind)');
select throws_ok(
  $$ update platform.tenant_move_events set detail = '{}' where id = '21500000-0000-4000-8000-0000000002e1' $$,
  'P0001', 'platform.tenant_move_events is append-only', 'nor its detail');
select is(
  (select detail ->> 'tables' from platform.tenant_move_events where id = '21500000-0000-4000-8000-0000000002e1'),
  '12', 'the refused edits changed nothing');
select throws_ok(
  $$ insert into platform.tenant_move_events (move_id, kind) values ('21500000-0000-4000-8000-0000000001ff', 'started') $$,
  '23503', null, 'an event for a move that does not exist is refused (foreign key)');

delete from public.tenants where id = '21500000-0000-4000-8000-000000000002';
select is(
  (select count(*)::int from platform.tenant_moves where tenant_id = '21500000-0000-4000-8000-000000000002'),
  0, 'deleting the tenant removes its moves');
select is(
  (select count(*)::int from platform.tenant_move_events where move_id = '21500000-0000-4000-8000-0000000001d1'),
  0, 'and, through them, its events (the cascade delete is not an edit)');
select is(
  (select count(*)::int from platform.tenant_moves where tenant_id = '21500000-0000-4000-8000-000000000001'),
  4, 'the other tenant keeps its moves');

-- ── 5. exposure ────────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relname in ('tenant_moves', 'tenant_move_events')
      and c.relrowsecurity and not c.relforcerowsecurity),
  2, 'RLS is on and not forced on both move tables');
select is(
  (select count(*)::int from pg_policies where schemaname = 'platform' and tablename in ('tenant_moves', 'tenant_move_events')),
  0, 'both move tables have ZERO policies');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('api_user')) r(role_name)
    where n.nspname = 'platform' and c.relname in ('tenant_moves', 'tenant_move_events')
      and has_table_privilege(r.role_name, c.oid, 'select,insert,update,delete,truncate,references,trigger')),
  0, 'anon, authenticated and the bare api_user hold no privilege on the move tables');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relname in ('tenant_moves', 'tenant_move_events')
      and has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert')
      and has_table_privilege('service_role', c.oid, 'update') and has_table_privilege('service_role', c.oid, 'delete')),
  2, 'service_role (the platform lane) holds select, insert, update and delete on both');

set local role authenticated;
select throws_ok($$ select count(*) from platform.tenant_moves $$, '42501', null, 'authenticated cannot read the moves (42501)');
select throws_ok($$ select count(*) from platform.tenant_move_events $$, '42501', null, 'authenticated cannot read the events (42501)');
select throws_ok(
  $$ insert into platform.tenant_moves (tenant_id, from_project_id, to_project_id, status_before, actor)
       values ('21500000-0000-4000-8000-000000000001', '21500000-0000-4000-8000-0000000000a1',
               '21500000-0000-4000-8000-0000000000a2', 'active', 'cli') $$,
  '42501', null, 'authenticated cannot start a move (42501)');
select throws_ok($$ delete from platform.tenant_move_events $$, '42501', null, 'authenticated cannot delete an event (42501)');
reset role;
set local role anon;
select throws_ok($$ select count(*) from platform.tenant_moves $$, '42501', null, 'anon cannot read the moves (42501)');
reset role;
set local role service_role;
select lives_ok($$ select count(*) from platform.tenant_moves $$, 'service_role (the platform lane) can read the moves');
select lives_ok(
  $$ insert into platform.tenant_move_events (move_id, kind) values ('21500000-0000-4000-8000-0000000001c1', 'audit_probe') $$,
  'service_role can append an event');
select throws_ok(
  $$ update platform.tenant_move_events set kind = 'changed_kind' where true $$,
  'P0001', null, 'and even the service role cannot edit an event: the trail is append-only');
reset role;

select * from finish();
rollback;
