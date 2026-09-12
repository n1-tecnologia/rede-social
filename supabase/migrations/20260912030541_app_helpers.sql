-- app_helpers: api_user role, citext extension, the `app` schema and the claim-reading helpers that every
-- RLS policy calls. Must run BEFORE the core tables migration (policies reference app.tenant_id()).

-- Runtime DB role for the API (same block as supabase/roles.sql, idempotent). No password here.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'api_user') then
    create role api_user nologin nobypassrls noinherit;
  end if;
end $$;
grant authenticated to api_user;   -- SET LOCAL ROLE authenticated (tenant lane)
grant service_role to api_user;    -- SET LOCAL ROLE service_role (admin lane)

-- Case-insensitive text for tenant_domains.host (Supabase keeps extensions in the `extensions` schema).
create extension if not exists citext with schema extensions;

create schema if not exists app;

-- Claims are injected per transaction by withTenantTx via set_config('request.jwt.claims', $1, true).
-- An empty/absent setting yields NULL, so policies comparing tenant_id = app.tenant_id() match nothing.
create or replace function app.tenant_id() returns uuid
language sql stable security invoker as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id', '')::uuid
$$;

create or replace function app.user_id() returns uuid
language sql stable security invoker as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create or replace function app.tenant_role() returns text
language sql stable security invoker as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_role'
$$;

grant usage on schema app to authenticated, service_role, api_user;
grant execute on all functions in schema app to authenticated, service_role, api_user;
