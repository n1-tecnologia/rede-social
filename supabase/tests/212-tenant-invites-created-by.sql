begin;
-- 212-tenant-invites-created-by.sql — Phase 09.2-13 (DBT-36; D-533, D-542): the first-admin invite of a tenant
-- project carries a creator that may not exist in that project.
--
-- The creator of a first-admin invite is a CENTRAL super_admin; a tenant project's own `users` has no row for
-- that person, so `tenant_invites.created_by` is nullable and carries no foreign key (the expand-only tenant
-- migration `*_tenant_invites_created_by_nullable.sql`). This file proves, executed inside Postgres:
--
-- 1. SHAPE: the column allows NULL, no foreign key covers it, the two foreign keys the table keeps are intact.
-- 2. THE CASES: an invite with a NULL creator and an invite whose creator exists in no `users` row are both
--    accepted (the central-actor case); the unique `(tenant_id, email)` and the status / role CHECKs still hold.
-- 3. EXPOSURE UNCHANGED: RLS on with ZERO policies; a tenant lane reads nothing and writes nothing (42501).
-- 4. THE CENTRAL HALF: `platform.tenant_projects.pending_invite` is a nullable jsonb column that holds the first
--    admin's input between the create call and the bootstrap's `invite` step.
--
-- Fixture ids use the `21200000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(21);

select tests.tenant('pgtap-inv-a', 'Inv A', '21200000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-inv-b', 'Inv B', '21200000-0000-4000-8000-000000000002');
select tests.auth_user('pgtap-inv-a@a.local', '21200000-0000-4000-8000-0000000000a1');
select tests.member('21200000-0000-4000-8000-000000000001', '21200000-0000-4000-8000-0000000000a1');

-- ── 1. shape ───────────────────────────────────────────────────────────────────────────────────
select col_is_null('public', 'tenant_invites', 'created_by', 'tenant_invites.created_by allows NULL');
select is(
  (select count(*)::int from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.tenant_invites'::regclass and c.contype = 'f' and a.attname = 'created_by'),
  0,
  'no foreign key covers tenant_invites.created_by');
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.tenant_invites'::regclass and c.contype = 'f'),
  array['tenant_id', 'user_id'],
  'the two foreign keys the table keeps (tenant_id, user_id) are intact');
select col_type_is('public', 'tenant_invites', 'created_by', 'uuid', 'created_by is still a uuid');

-- ── 2. the cases ───────────────────────────────────────────────────────────────────────────────
select lives_ok(
  $$ insert into public.tenant_invites (tenant_id, email, created_by)
     values ('21200000-0000-4000-8000-000000000001', 'sem-criador@a.local', null) $$,
  'an invite with a NULL creator is accepted (the bootstrap invite step)');
select is(
  (select created_by from public.tenant_invites where email = 'sem-criador@a.local'),
  null,
  'the NULL creator reads back as NULL');
select lives_ok(
  $$ insert into public.tenant_invites (tenant_id, email, created_by)
     values ('21200000-0000-4000-8000-000000000001', 'central@a.local', '21200000-0000-4000-8000-0000000000ff') $$,
  'a creator id that exists in no users row is accepted (a central super_admin in a tenant project)');
select is(
  (select count(*)::int from public.users where id = '21200000-0000-4000-8000-0000000000ff'),
  0,
  'and that id really is not a user of this database');
select lives_ok(
  $$ insert into public.tenant_invites (tenant_id, email) values ('21200000-0000-4000-8000-000000000001', 'omitido@a.local') $$,
  'omitting created_by altogether is accepted');
select lives_ok(
  $$ insert into public.tenant_invites (tenant_id, email, created_by)
     values ('21200000-0000-4000-8000-000000000001', 'comum@a.local', '21200000-0000-4000-8000-0000000000a1') $$,
  'an invite created by a real user keeps working');

select throws_ok(
  $$ insert into public.tenant_invites (tenant_id, email, created_by)
     values ('21200000-0000-4000-8000-000000000001', 'SEM-CRIADOR@a.local', null) $$,
  '23505',
  null,
  'the unique (tenant_id, email) still holds, case-insensitively (citext)');
select lives_ok(
  $$ insert into public.tenant_invites (tenant_id, email, created_by)
     values ('21200000-0000-4000-8000-000000000002', 'sem-criador@a.local', null) $$,
  'the same address in another tenant is a different invite');
select throws_ok(
  $$ insert into public.tenant_invites (tenant_id, email, status)
     values ('21200000-0000-4000-8000-000000000001', 'status@a.local', 'revoked') $$,
  '23514',
  null,
  'the status CHECK still holds');
select throws_ok(
  $$ insert into public.tenant_invites (tenant_id, email, role)
     values ('21200000-0000-4000-8000-000000000001', 'papel@a.local', 'super_admin') $$,
  '23514',
  null,
  'the role CHECK still holds');

-- ── 3. exposure unchanged ──────────────────────────────────────────────────────────────────────
select is(
  (select relrowsecurity from pg_class where oid = 'public.tenant_invites'::regclass),
  true,
  'RLS is still enabled on tenant_invites');
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.tenant_invites'::regclass),
  0,
  'tenant_invites still has ZERO policies');

select tests.as_tenant('21200000-0000-4000-8000-000000000001', '21200000-0000-4000-8000-0000000000a1');
select is(
  (select count(*)::int from public.tenant_invites),
  0,
  'a tenant lane reads no invite, not even its own tenant''s');
select throws_ok(
  $$ insert into public.tenant_invites (tenant_id, email, created_by)
     values ('21200000-0000-4000-8000-000000000001', 'lane@a.local', null) $$,
  '42501',
  null,
  'a tenant lane cannot create an invite even with a NULL creator (42501)');
reset role;

-- ── 4. the central half ────────────────────────────────────────────────────────────────────────
select col_type_is('platform', 'tenant_projects', 'pending_invite', 'jsonb', 'platform.tenant_projects.pending_invite is jsonb');
select col_is_null('platform', 'tenant_projects', 'pending_invite', 'and it allows NULL (every existing binding has none)');
insert into platform.projects (id, ref, label, api_url, state)
values ('21200000-0000-4000-8000-0000000000b1', 'pgtap-inv-project', 'Projeto', 'https://pgtap-inv.example.test', 'preparing');
select lives_ok(
  $$ insert into platform.tenant_projects (tenant_id, project_id, pending_invite)
     values ('21200000-0000-4000-8000-000000000001', '21200000-0000-4000-8000-0000000000b1',
             '{"email":"primeiro@a.local","createdBy":"21200000-0000-4000-8000-0000000000ff"}') $$,
  'a binding can carry the first admin''s pending invite input');

select * from finish();
rollback;
