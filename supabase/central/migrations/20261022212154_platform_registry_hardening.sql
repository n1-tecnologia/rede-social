-- platform_registry_hardening (09.2-02, D-538, D-540, D-547, DBT-01, DBT-46) — the hand-written half of the
-- CENTRAL set (drizzle-kit cannot model grants, functions or triggers on another schema's tables). Applied by
-- the in-house runner right after `platform_registry`, in ONE transaction. EXPAND-ONLY: it adds objects and
-- one data row, drops and rewrites nothing.
--
-- CENTRAL SET ONLY. Schema `platform` is owned here and is never applied to a tenant's project (the tenant
-- set has no reference to it; `tenant-set-no-platform.test.ts` and `scripts/db-two-databases.sh
-- --assert-no-platform` prove it).
--
-- ── 1. EXPOSURE (T-09.2-06) ────────────────────────────────────────────────────────────────────────
-- The registry names every project and holds their sealed credentials. Every table has RLS ON and ZERO
-- policies; on top of that `anon` and `authenticated` hold no privilege on the schema or its tables, and the
-- bare `api_user` (a `noinherit` member of both lanes) holds none either. Only `service_role` reads and
-- writes, reached by `set local role service_role` in the platform lane (plan 04) behind the explicit
-- super_admin guard. The default privileges are set too, so a table a later central migration adds starts
-- from the same closed state.
--
-- ── 2. THE FAIL-CLOSED DEFAULT BINDING (D-538, DBT-46, T-09.2-08) ───────────────────────────────────
-- A tenant is served from the project it is BOUND to, never from "wherever the process connects". The
-- binding is explicit (`platform.tenant_projects`), so a tenant created by raw SQL (the 23 integration
-- files, the e2e fixtures, `tests.tenant()`) would otherwise have none. `tenants_bind_default` is a
-- DEFERRED constraint trigger: at commit, a tenant without a binding is bound to the ONE project flagged
-- `is_default`, and when no project carries the flag the commit RAISES. So the local stack keeps working
-- (project 0 is the default), an explicit binding written in the same transaction is never overridden, and
-- production, whose operator clears the flag after the last move (plan 25 runbook), can never create an
-- unbound tenant: that insert fails at commit instead of silently landing in the central project.
--
-- The function is SECURITY DEFINER (owner `postgres`) because the tenant insert may come from a lane that
-- holds no privilege on `platform`; `search_path` is empty and every name is qualified. It reads only
-- `new.id` (a uuid the caller just inserted), so it takes no attacker-chosen text. If the tenant row is gone
-- by commit (inserted and deleted in one transaction) there is nothing to bind and the FK would refuse the
-- binding, so it returns quietly.
--
-- ── 3. PROJECT 0 (D-540) ───────────────────────────────────────────────────────────────────────────
-- The shared project every tenant lives in today is registered by this migration: `is_central`,
-- `is_default`, `credential_source = 'env'` (its credentials stay in the environment, nothing in Secret
-- Manager changes), `state = 'ready'`. Its public coordinates (`api_url`, `publishable_key`) are
-- placeholders that `ensureProjectZero` (plan 04) fills from the environment. Every existing tenant is
-- bound to it, so behaviour is unchanged.

-- ── 1. exposure ────────────────────────────────────────────────────────────────────────────────────
revoke all on schema platform from public, anon, authenticated;
grant usage on schema platform to service_role;

revoke all on all tables in schema platform from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema platform to service_role;

alter default privileges in schema platform revoke all on tables from public, anon, authenticated;
alter default privileges in schema platform grant select, insert, update, delete on tables to service_role;

-- ── 2. the deferred default binding ────────────────────────────────────────────────────────────────
create or replace function platform.bind_default_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_default uuid;
begin
  -- Gone by commit, or explicitly bound in this transaction: nothing to do.
  if not exists (select 1 from public.tenants t where t.id = new.id) then
    return null;
  end if;
  if exists (select 1 from platform.tenant_projects tp where tp.tenant_id = new.id) then
    return null;
  end if;

  select p.id into v_default from platform.projects p where p.is_default;
  if v_default is null then
    raise exception 'tenant % has no project binding and no default project exists', new.id
      using errcode = 'P0001';
  end if;

  insert into platform.tenant_projects (tenant_id, project_id) values (new.id, v_default);
  return null;
end;
$$;

revoke all on function platform.bind_default_project() from public, anon, authenticated;

create constraint trigger tenants_bind_default
  after insert on public.tenants
  deferrable initially deferred
  for each row
  execute function platform.bind_default_project();

-- ── 3. project 0 and the bindings of the tenants that already exist ───────────────────────────────
insert into platform.projects (ref, label, provider, is_central, is_default, credential_source, api_url, state)
values ('project-0', 'Projeto central', 'supabase', true, true, 'env', '', 'ready')
on conflict (ref) do nothing;

insert into platform.tenant_projects (tenant_id, project_id)
select t.id, p.id
  from public.tenants t
 cross join platform.projects p
 where p.ref = 'project-0'
on conflict (tenant_id) do nothing;
