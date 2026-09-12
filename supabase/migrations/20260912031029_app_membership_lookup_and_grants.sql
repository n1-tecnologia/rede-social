-- app_membership_lookup_and_grants: the per-request membership lookup requireAuth runs BEFORE a lane
-- exists, plus the table privileges the lanes need and the anon lock-down (PostgREST exposure).

-- Security definer (owned by the migration role, which owns the tables): api_user may execute it
-- without opening a lane. `order by joined_at limit 1` keeps it deterministic when the V1 unique
-- index memberships_one_tenant_per_user_v1 is dropped in V2.
create or replace function app.membership_for_user(p_user_id uuid)
returns table (
  tenant_id uuid,
  tenant_slug text,
  tenant_display_name text,
  role text,
  status text,
  tenant_status text
)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id, t.slug, t.display_name, m.role, m.status, t.status
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
  order by m.joined_at
  limit 1
$$;
revoke all on function app.membership_for_user(uuid) from public;
grant execute on function app.membership_for_user(uuid) to api_user;

-- Table privileges for the two lanes (RLS still applies to `authenticated`; service_role bypasses it).
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- The API is the only data client: nothing is reachable through PostgREST with the publishable key.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
