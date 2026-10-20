-- access_gate_functions (09.1-02, D-485, D-487, D-489, D-491, D-492, D-494, D-496, D-497) — the privilege
-- hardening of `public.access_grants` and the SQL functions that decide what an e-mail may do in a
-- tenant. Custom migration (drizzle-kit cannot model functions or grants). Its generated companion
-- `20261020225247_access_grants.sql` creates the table.
--
-- ── WHY ONE FUNCTION PER QUESTION, IN SQL ───────────────────────────────────────────────────────────
-- The cut must be LIVE (a refund takes effect on the member's next request, no cache, no claim) and
-- cheap, and its rule must exist in exactly ONE place so the API, the auth hooks of plan 03, the admin
-- lists and the dashboards can never disagree. So:
--   * `app.access_gate_on(tenant)`   is the tenant's switch: the `payments` module row is enabled AND
--                                    `settings->'gate'` is the jsonb boolean `true` (D-491). The string
--                                    "true", the number 1, null, false and an absent key all read as off.
--   * `app.access_effective(t, e)`   is D-489 LITERALLY, for one e-mail in one tenant, in this order:
--                                    a manual block -> `blocked`; else the gateway's state (`active` when
--                                    ANY gateway row is active, D-494; `inactive` when every gateway row
--                                    is inactive); else a manual release -> `active`; else `none`.
--                                    ASSUMPTION A-P9 (confirm with the user): a gateway `inactive` therefore
--                                    OUTRANKS a manual release. Flipping it is moving the `manual active`
--                                    branch above the `gateway inactive` branch in THIS function only.
--   * `app.access_state(t, user)`    is what `requireAuth` asks per request (D-496): gate off -> `open`; a
--                                    live admin_tenant / support_tenant membership -> `open` (D-492, the
--                                    gate can never strand a tenant's own staff); else the member's e-mail
--                                    maps `active` -> `granted`, `blocked` -> `blocked`, `inactive` or
--                                    `none` -> `cut` (A-P24). A user row that is missing fails CLOSED to `cut`.
--                                    The order (gate, then staff, then e-mail) means an ungated tenant pays
--                                    one primary-key probe of `tenant_modules` per request.
--   * `app.membership_access_cut`, `app.access_cut_user_ids` are the boolean and the set forms the admin
--                                    lists and the dashboard counters read (plans 10, 11, 18).
--   * `app.membership_in_tenant_gated` / `app.memberships_of_user_gated` return the six columns of the
--                                    08.1 lookups PLUS `access_state`, so `requireAuth` takes the membership
--                                    and the cut decision in ONE definer round trip, one statement, one
--                                    snapshot: a cut and a return racing two requests of one member leave
--                                    each request with one consistent committed state (P26).
-- Every function is STABLE, so the calling statement's snapshot covers the module row, the staff
-- membership and the access rows alike.
--
-- ── HARDENING ───────────────────────────────────────────────────────────────────────────────────────
-- * SECURITY DEFINER, owner postgres (also the owner of the tables read), RLS not forced, so the
--   definer reads the zero-policy `access_grants` while `anon` / `authenticated` cannot touch it.
-- * `search_path = ''` and fully qualified names; only pg_catalog built-ins and `app.*` are used.
-- * EXECUTE is revoked from PUBLIC (the default ACL of `public` hands it to anon/authenticated) and
--   granted ONLY to `api_user` (the request path) and `service_role` (the admin lane). `authenticated`
--   gets none of them: a tenant lane must not probe whether an e-mail has access in some tenant.
--   Consumers that run in the tenant lane call them from inside their own definer function.
-- * These functions never read the retiring global allowlist table: plan 03 retires it, and a gated
--   tenant must never be bypassed by the old list.
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- Expand-only: seven new functions and a privilege revoke on a table created one migration earlier.
-- `app.membership_in_tenant` and `app.memberships_of_user` are NOT touched, so the API revision still
-- serving during `supabase db push` keeps working; the new revision calls the `_gated` twins.

revoke all on table public.access_grants from anon, authenticated;
--> statement-breakpoint
create or replace function app.access_gate_on(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tenant_modules tm
    where tm.tenant_id = p_tenant
      and tm.module_key = 'payments'
      and tm.enabled
      and tm.settings->'gate' = 'true'::jsonb
  )
$$;
--> statement-breakpoint
create or replace function app.access_effective(p_tenant uuid, p_email text)
returns text
language sql stable security definer set search_path = '' as $$
  with g as (
    select ag.source, ag.status
    from public.access_grants ag
    where ag.tenant_id = p_tenant
      and ag.email = lower(btrim(p_email))
  )
  select case
    when exists (select 1 from g where g.source = 'manual' and g.status = 'blocked') then 'blocked'
    when exists (select 1 from g where g.source = 'gateway' and g.status = 'active') then 'active'
    when exists (select 1 from g where g.source = 'gateway' and g.status = 'inactive') then 'inactive'
    when exists (select 1 from g where g.source = 'manual' and g.status = 'active') then 'active'
    else 'none'
  end
$$;
--> statement-breakpoint
create or replace function app.access_state(p_tenant uuid, p_user uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not app.access_gate_on(p_tenant) then 'open'
    when exists (
      select 1
      from public.memberships m
      where m.tenant_id = p_tenant
        and m.user_id = p_user
        and m.deleted_at is null
        and m.role in ('admin_tenant', 'support_tenant')
    ) then 'open'
    else coalesce(
      (
        select case app.access_effective(p_tenant, u.email)
                 when 'active' then 'granted'
                 when 'blocked' then 'blocked'
                 else 'cut'
               end
        from public.users u
        where u.id = p_user
      ),
      'cut'
    )
  end
$$;
--> statement-breakpoint
create or replace function app.membership_access_cut(p_tenant uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.access_state(p_tenant, p_user) = 'cut'
$$;
--> statement-breakpoint
create or replace function app.access_cut_user_ids(p_tenant uuid)
returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when not app.access_gate_on(p_tenant) then '{}'::uuid[]
    else coalesce(
      (
        select array_agg(m.user_id order by m.user_id)
        from public.memberships m
        where m.tenant_id = p_tenant
          and m.deleted_at is null
          and m.role = 'member'
          and app.access_state(p_tenant, m.user_id) = 'cut'
      ),
      '{}'::uuid[]
    )
  end
$$;
--> statement-breakpoint
create or replace function app.membership_in_tenant_gated(p_user_id uuid, p_tenant_id uuid)
returns table (
  tenant_id uuid,
  tenant_slug text,
  tenant_display_name text,
  role text,
  status text,
  tenant_status text,
  access_state text
)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id,
         t.slug,
         t.display_name,
         m.role,
         case when m.blocked_at is not null then 'blocked' else m.status end,
         t.status,
         app.access_state(m.tenant_id, m.user_id)
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
    and m.tenant_id = p_tenant_id
    and m.deleted_at is null
$$;
--> statement-breakpoint
create or replace function app.memberships_of_user_gated(p_user_id uuid)
returns table (
  tenant_id uuid,
  tenant_slug text,
  tenant_display_name text,
  role text,
  status text,
  tenant_status text,
  access_state text
)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id,
         t.slug,
         t.display_name,
         m.role,
         case when m.blocked_at is not null then 'blocked' else m.status end,
         t.status,
         app.access_state(m.tenant_id, m.user_id)
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
    and m.deleted_at is null
  order by t.slug
$$;
--> statement-breakpoint
revoke all on function app.access_gate_on(uuid) from public;
--> statement-breakpoint
revoke all on function app.access_effective(uuid, text) from public;
--> statement-breakpoint
revoke all on function app.access_state(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function app.membership_access_cut(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function app.access_cut_user_ids(uuid) from public;
--> statement-breakpoint
revoke all on function app.membership_in_tenant_gated(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function app.memberships_of_user_gated(uuid) from public;
--> statement-breakpoint
grant execute on function app.membership_in_tenant_gated(uuid, uuid) to api_user;
--> statement-breakpoint
grant execute on function app.memberships_of_user_gated(uuid) to api_user;
--> statement-breakpoint
grant execute on function app.access_state(uuid, uuid) to api_user;
--> statement-breakpoint
grant execute on function app.access_gate_on(uuid) to service_role;
--> statement-breakpoint
grant execute on function app.access_effective(uuid, text) to service_role;
--> statement-breakpoint
grant execute on function app.access_state(uuid, uuid) to service_role;
--> statement-breakpoint
grant execute on function app.membership_access_cut(uuid, uuid) to service_role;
--> statement-breakpoint
grant execute on function app.access_cut_user_ids(uuid) to service_role;
