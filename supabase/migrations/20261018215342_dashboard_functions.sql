-- dashboard_functions (08.7-01, D-464, D-462, D-440 [informational], INSIGHT-07, INSIGHT-15,
-- INSIGHT-18; RESEARCH § Snapshot Design "Build", Pattern 1, Code Examples "Definer skeleton",
-- Pitfalls 1, 4, 12) — the snapshot builder and its first area. Hand-written (`--custom`), sorted
-- AFTER the generated `*_dashboard_snapshots.sql`, whose two tables it reads and writes (EP-62).
--
--   1. `app.dashboard_area_overview(p_day date) jsonb` — the Visão geral area of the snapshot of
--      tenant-local day D = `p_day`: `{ members: { count, newMembers, previous } }` (08.7-01
--      planning decision 5). The window bounds are converted ONCE to instants with the tenant's own
--      zone (`(D - 29)::timestamp at time zone tenants.timezone` = local midnight of D-29,
--      `(D + 1)::timestamp at time zone …` = local midnight of D+1) and the raw `joined_at` /
--      `blocked_at` instants are compared to them, so every local day comes from SQL, never from
--      JavaScript date math (D-440), the comparison stays index-friendly (R-Pattern 1) and the end
--      of D is exclusive: today never counts (R-Pitfall 4). Only role `member` counts; staff never
--      does. `count` = active, never blocked or deleted, joined before the end of D; `newMembers`
--      = the same, joined at or after local midnight of D-29 (Window30 = D-29..D); `previous` =
--      the base at local midnight of D-29 (not invited, not deleted, joined before it, not blocked
--      before it). EXECUTE is revoked from every role: only the owner-run builder calls it.
--   2. `app.dashboard_build_snapshot(p_day date) boolean` — THE writer of `dashboard_snapshots`
--      (D-464). It refuses (42501) unless the lane carries a tenant claim AND the zero user
--      `00000000-0000-0000-0000-000000000000` (the dashboard system lane of the build job, never a
--      request lane: T-08.7-03), refuses (22023) a `p_day` that is not before the tenant-local
--      today (a day that is not complete yet), answers false WITHOUT writing when the tenant's row
--      for `p_day` already exists at the current payload version (`v_version`; a later area plan
--      bumps it, so the hourly dispatcher rebuilds every tenant within the hour, R-Risk 6), and
--      otherwise upserts that ONE row — the `windows` it was built over and the payload keyed by
--      area — in the caller's transaction, then answers true.
--
-- Why a definer (R-§Build): the builder reads every row of ONE tenant whatever the lane's own RLS
-- would allow — `push_subscriptions` is owner-only, `store_orders` own-or-admin, restrictive
-- community gates hide locked rows — and it writes tables that have NO write policy at all.
--
-- Hardening (the T-06-29 / T-08.2-22 / T-08.6-01 posture, T-08.7-01, T-08.7-05): both functions are
-- `security definer set search_path = ''` with fully qualified names. The owner bypasses RLS, so
-- EVERY statement pins `tenant_id = app.tenant_id()` itself (a shared identity's rows in another
-- tenant never count, R-Pitfall 1). EXECUTE on the builder is revoked from PUBLIC and granted to
-- `authenticated` only; the area helper is executable by no role but its owner. No statement picks
-- a single row with a LIMIT (pgTAP 040's allow-list). Snapshots hold ids and numbers only (PR-1).
-- The tenant lane also loses its table-level write grants on both tables (the store_orders
-- precedent): with no write policy RLS already refuses, and the grant revoke makes the refusal not
-- depend on a policy never being added. Expand-only: no table, column or policy is removed or retyped.

create or replace function app.dashboard_area_overview(p_day date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (
    select ((p_day - 29)::timestamp at time zone t.timezone) as from30,
           ((p_day + 1)::timestamp at time zone t.timezone) as until
      from public.tenants t
     where t.id = app.tenant_id()
  )
  select jsonb_build_object(
           'members', jsonb_build_object(
             'count', count(m.id) filter (
               where m.status = 'active' and m.blocked_at is null and m.deleted_at is null
                 and m.joined_at < b.until),
             'newMembers', count(m.id) filter (
               where m.status = 'active' and m.blocked_at is null and m.deleted_at is null
                 and m.joined_at >= b.from30 and m.joined_at < b.until),
             'previous', count(m.id) filter (
               where m.status <> 'invited' and m.deleted_at is null
                 and m.joined_at < b.from30
                 and (m.blocked_at is null or m.blocked_at >= b.from30))))
    from b
    left join public.memberships m
      on m.tenant_id = app.tenant_id()
     and m.role = 'member'
   group by b.from30, b.until
$$;--> statement-breakpoint
revoke all on function app.dashboard_area_overview(date) from public, anon, authenticated, service_role;--> statement-breakpoint

create or replace function app.dashboard_build_snapshot(p_day date)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  -- The payload shape version. Every area plan that adds a key bumps it (R-Risk 6).
  v_version constant int := 1;
  v_tenant uuid := app.tenant_id();
  v_tz text;
begin
  if v_tenant is null
     or app.user_id() is distinct from '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'dashboard build: system lane only' using errcode = '42501';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = v_tenant;
  if v_tz is null then
    raise exception 'dashboard build: unknown tenant' using errcode = '42501';
  end if;

  if p_day is null or p_day >= (now() at time zone v_tz)::date then
    raise exception 'dashboard build: % is not a complete day', p_day using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.dashboard_snapshots s
     where s.tenant_id = v_tenant
       and s.snapshot_day = p_day
       and s.payload_version = v_version
  ) then
    return false;
  end if;

  insert into public.dashboard_snapshots
         (tenant_id, snapshot_day, payload_version, built_at, windows, payload)
  values (
    v_tenant,
    p_day,
    v_version,
    now(),
    jsonb_build_object(
      'day', to_char(p_day, 'YYYY-MM-DD'),
      'from30', to_char(p_day - 29, 'YYYY-MM-DD'),
      'prev30From', to_char(p_day - 59, 'YYYY-MM-DD'),
      'from7', to_char(p_day - 6, 'YYYY-MM-DD'),
      'prev7From', to_char(p_day - 13, 'YYYY-MM-DD'),
      'from30At', to_char(((p_day - 29)::timestamp at time zone v_tz) at time zone 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'prev30At', to_char(((p_day - 59)::timestamp at time zone v_tz) at time zone 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'untilAt', to_char(((p_day + 1)::timestamp at time zone v_tz) at time zone 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    jsonb_build_object('overview', app.dashboard_area_overview(p_day))
  )
  on conflict (tenant_id, snapshot_day) do update
     set payload_version = excluded.payload_version,
         built_at = excluded.built_at,
         windows = excluded.windows,
         payload = excluded.payload;

  return true;
end
$$;--> statement-breakpoint
revoke all on function app.dashboard_build_snapshot(date) from public, anon;--> statement-breakpoint
grant execute on function app.dashboard_build_snapshot(date) to authenticated;--> statement-breakpoint

revoke insert, update, delete, truncate on public.dashboard_snapshots from authenticated;--> statement-breakpoint
revoke insert, update, delete, truncate on public.dashboard_member_snapshots from authenticated;
