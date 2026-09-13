-- 000-helpers.sql — the ONLY file in supabase/tests that commits.
--
-- `supabase test db` runs every file in this directory through pg_prove, in name order, on one
-- connection per file. This file prepares the test database itself (pgTAP + the `tests` schema);
-- 010..040 each run inside their own transaction and undo it, so they leave nothing behind and
-- never change a result (TENANT-05 ordering truth).
--
-- The helpers switch roles with `set_config(..., is_local => true)`: a plain (non-SECURITY DEFINER,
-- no `SET` clause) plpgsql function does not open a GUC nesting level, so the setting survives the
-- call and dies with the transaction — the same LOCAL discipline `withTenantTx` uses in
-- packages/core/db/tenant-tx.ts (threat T-03-01).
begin;

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;
grant usage on schema tests to public;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────────
-- A minimal GoTrue identity. The `on_auth_user_created` trigger (20260912031030_auth_user_mirror)
-- mirrors it into public.users, so memberships can reference it.
create or replace function tests.auth_user(p_email text, p_id uuid default gen_random_uuid())
returns uuid
language plpgsql as $$
declare
  v_id uuid := p_id;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email, '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"t"}'::jsonb, now(), now()
  );
  return v_id;
end
$$;

create or replace function tests.tenant(p_slug text, p_name text, p_id uuid default gen_random_uuid())
returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.tenants (id, slug, display_name, rules_text, rules_version)
  values (p_id, p_slug, p_name, 'Regras de teste.', 1)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function tests.member(p_tenant uuid, p_user uuid, p_role text default 'member')
returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.memberships (tenant_id, user_id, role, status)
  values (p_tenant, p_user, p_role, 'active')
  returning id into v_id;
  return v_id;
end
$$;

-- ── lanes ───────────────────────────────────────────────────────────────────────────────────────
-- The tenant lane exactly as withTenantTx builds it: bound claims + the `authenticated` role, both
-- LOCAL to the surrounding transaction.
create or replace function tests.as_tenant(p_tenant uuid, p_user uuid, p_role text default 'member')
returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user::text,
      'role', 'authenticated',
      'tenant_id', p_tenant::text,
      'tenant_role', p_role
    )::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end
$$;

-- The lane with NO claims: `app.tenant_id()` is NULL, so every policy matches nothing.
create or replace function tests.as_tenant_without_claims() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'authenticated', true);
end
$$;

-- The role the API actually connects as. NOINHERIT: it owns no privileges until it opens a lane.
create or replace function tests.as_api_user() returns void
language plpgsql as $$
begin
  perform set_config('role', 'api_user', true);
end
$$;

-- The admin lane (withAdminTx): service_role bypasses RLS for this transaction only.
create or replace function tests.as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
end
$$;

-- pg_prove connects as `postgres`, which created `api_user` and therefore holds ADMIN OPTION on it
-- but not SET (PostgreSQL 16+ grants CREATE ROLE membership with SET FALSE). 030 needs to *become*
-- api_user to prove what that role may and may not do; granting SET to a role that already has ADMIN
-- changes nothing about api_user's own privileges.
-- It also lends api_user USAGE on `extensions`, where pgTAP lives: without it `is()` and friends
-- are unresolvable while the test is impersonating api_user. Neither grant touches the `public`
-- schema, so what 030 proves about api_user's data privileges is unaffected — and both roll back
-- with the test transaction.
create or replace function tests.allow_role_switch() returns void
language plpgsql as $$
begin
  execute format('grant api_user to %I with set true, inherit false', session_user);
  execute 'grant usage on schema extensions to api_user';
end
$$;

grant execute on all functions in schema tests to public;

-- pg_prove needs TAP output from every file it runs, including this one.
select plan(1);
select pass('pgTAP and the tests schema are installed');
select * from finish();

commit;
