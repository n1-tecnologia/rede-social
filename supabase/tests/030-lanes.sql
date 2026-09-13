begin;
-- 030-lanes.sql — T-08-03: the two lanes and the role they run under.
--
-- The API connects as `api_user`, a NOINHERIT role that owns no privileges of its own and must
-- open a lane (`set local role authenticated` / `service_role`) to touch anything. This file proves
-- that from inside the database, so a stray GRANT would fail CI rather than quietly widen the lane.
--
-- `enqueueInTx` (01-07) deliberately does `set local role api_user` inside a tenant lane because the
-- pgboss schema revokes `authenticated`, and restores the caller's role in a `finally` — both LOCAL.
-- That is the lane working as designed, not a leak, which is why the assertions below are about the
-- ROLE CATALOGUE and about what each role can read, never about "a role switch happened".
select plan(15);

-- pg_prove connects as `postgres`; see tests.allow_role_switch in 000-helpers.sql. Rolled back with
-- the rest of this file.
select tests.allow_role_switch();

-- ── the connection role owns nothing ────────────────────────────────────────────────────────────
select tests.as_api_user();
select is(current_user::text, 'api_user', 'the connection role is api_user');
select throws_ok(
  'select count(*) from public.tenants',
  '42501',
  null,
  'NOINHERIT: api_user cannot read a public table without opening a lane'
);
select throws_ok(
  'select count(*) from public.example_items',
  '42501',
  null,
  'NOINHERIT: the same holds for a module table'
);

-- ── the tenant lane ─────────────────────────────────────────────────────────────────────────────
reset role;
select tests.tenant('pgtap-lane', 'Comunidade Lane', '0c000000-0000-4000-8000-000000000001');
select tests.auth_user('member@lane.local', '0c000000-0000-4000-8000-000000000002');
select tests.member('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000002');
insert into public.example_items (tenant_id, title, created_by_user_id)
values ('0c000000-0000-4000-8000-000000000001', 'lane', '0c000000-0000-4000-8000-000000000002');

select tests.as_api_user();
select tests.as_tenant('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000002');
select is(current_user::text, 'authenticated', 'the tenant lane switches api_user to authenticated');
select is(
  app.tenant_id()::text,
  '0c000000-0000-4000-8000-000000000001',
  'app.tenant_id() reads the claims withTenantTx bound to this transaction'
);
select results_eq(
  $$ select count(*)::int from public.example_items $$,
  ARRAY[1],
  'the lane sees exactly the rows of the tenant in its claims'
);

-- ── the lane WITHOUT claims returns nothing (never everything) ───────────────────────────────────
reset role;
select tests.as_api_user();
select tests.as_tenant_without_claims();
select is(current_user::text, 'authenticated', 'a claimless lane is still the authenticated role');
select results_eq(
  $$ select count(*)::int from public.example_items $$,
  ARRAY[0],
  'empty claims: app.tenant_id() is NULL, so every policy matches nothing — fail closed'
);

-- ── the admin lane bypasses RLS, on purpose and only here ───────────────────────────────────────
reset role;
select tests.as_service();
select is(current_user::text, 'service_role', 'the admin lane switches to service_role');
select results_eq(
  $$ select count(*)::int from public.example_items
      where tenant_id = '0c000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'service_role reads without claims: withAdminTx is the only lane allowed to'
);

-- ── the role catalogue ──────────────────────────────────────────────────────────────────────────
reset role;
select is_empty(
  $$ select rolname from pg_roles
      where rolname in ('api_user', 'authenticated') and (rolbypassrls or rolsuper) $$,
  'no runtime role has rolbypassrls or rolsuper (only the admin lane''s service_role may bypass)'
);
select results_eq(
  $$ select rolinherit from pg_roles where rolname = 'api_user' $$,
  ARRAY[false],
  'api_user is NOINHERIT: membership alone grants it nothing until it SETs the role'
);
-- The exact membership set. `set local role postgres` cannot be asserted directly from pg_prove
-- (SET ROLE is checked against the SESSION user, which is postgres here), so the catalogue is the
-- honest statement of the same property: api_user may only become the two lane roles.
select is(
  (select string_agg(r.rolname::text, ',' order by r.rolname)
     from pg_auth_members a
     join pg_roles r on r.oid = a.roleid
     join pg_roles m on m.oid = a.member
    where m.rolname = 'api_user'),
  'authenticated,service_role',
  'api_user is a member of exactly the two lane roles — it cannot become postgres or supabase_admin'
);

-- The statements the kernel issues, verbatim. The helpers above use set_config(..., is_local) so a
-- plpgsql call can leave the role in place; these two lines are the literal SQL
-- packages/core/db/tenant-tx.ts sends, asserted to mean exactly the same thing.
reset role;
set local role authenticated;
select is(current_user::text, 'authenticated',
  '`set local role authenticated` — the verbatim statement withTenantTx issues');
reset role;
set local role service_role;
select is(current_user::text, 'service_role',
  '`set local role service_role` — the verbatim statement withAdminTx issues');
reset role;

select * from finish();
rollback;
