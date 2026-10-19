-- dashboard_overview_functions (08.7-12, D-459, D-460, D-464, UI-D-489 a/d, INSIGHT-07, INSIGHT-16,
-- INSIGHT-19, EP-63; RESEARCH § O1 Visão geral, § Retention, Pitfalls 1, 12) — the phase's last SQL:
-- the overview area v2, builder v8 and the retention sweep of the tenant snapshots. Hand-written
-- (`--custom`), sorted AFTER `*_dashboard_support_functions.sql` (builder v7), whose builder it
-- replaces.
--
-- D = the snapshot day (the tenant-local yesterday).
--
--   1. `app.dashboard_area_overview(p_day date) jsonb` v2: `members` unchanged (08.7-01 planning
--      decision 5), plus `enteredAtRisk { members, withPush }` — the member rows of the SAME build
--      (`public.dashboard_member_snapshots`, written by the builder before the payload) whose band
--      is `at_risk` and whose last counted action's tenant-local day is in D-36..D-30: no active
--      day in D-29..D, so they crossed into "em risco" during the last 7 days (the bell's
--      `entered_at_risk`, RESEARCH § O1). `withPush` = those of them with a push subscription
--      (`has_push`, read by the member rows' definer: `push_subscriptions` is owner-only). Every
--      other overview number is COMPOSED by the API from the area key that owns it (events,
--      finance, support, content: 08.7-12 planning decision 1), never recomputed here.
--   2. `app.dashboard_build_snapshot(p_day date)` v8: the v7 body kept whole, the payload version
--      bumped to 8, so the hourly dispatcher rebuilds every tenant within the hour (R-Risk 6) and an
--      area whose key is stale reads `preparing` until then (INSIGHT-16, UI-D-469).
--   3. `app.dashboard_snapshots_prune(p_batch int) returns int` (D-464 retention, INSIGHT-19): the
--      `notifications_prune` shape (`20260930142352_notifications_prune.sql`). It deletes AT MOST
--      `least(p_batch, 500)` tenant snapshot rows whose `snapshot_day` is more than 8 days before
--      THEIR tenant's local today (`snapshot_day < (now() at time zone tenants.timezone)::date - 8`:
--      a week of diagnostics is kept), oldest first, and returns how many it deleted. The kernel's
--      hourly sweeper runs it in the admin lane through `registerSweepFunctions` (the app registry),
--      repeating while a full batch comes back. Member rows need no sweep: they are latest-only.
--
-- Posture (T-08.7-01, T-08.7-25): the area function and the builder stay `security definer set
-- search_path = ''` with fully qualified names, every predicate pinning `tenant_id = app.tenant_id()`
-- (R-Pitfall 1); the area function is executable by no role but its owner, the builder keeps its
-- revoke/grant pair. The prune is `security invoker` (the admin lane already runs as `service_role`,
-- which bypasses RLS, so a definer would add nothing), deliberately CROSS-TENANT, and executable by
-- `service_role` ONLY (no tenant lane may call it). No statement picks a single row with a LIMIT of
-- one (pgTAP 040). Expand-only: no table, column or policy changes.

create or replace function app.dashboard_area_overview(p_day date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (
    select t.timezone as tz,
           ((p_day - 29)::timestamp at time zone t.timezone) as from30,
           ((p_day + 1)::timestamp at time zone t.timezone) as until
      from public.tenants t
     where t.id = app.tenant_id()
  ),
  mk as (
    select jsonb_build_object(
             'count', count(m.id) filter (
               where m.status = 'active' and m.blocked_at is null and m.deleted_at is null
                 and m.joined_at < b.until),
             'newMembers', count(m.id) filter (
               where m.status = 'active' and m.blocked_at is null and m.deleted_at is null
                 and m.joined_at >= b.from30 and m.joined_at < b.until),
             'previous', count(m.id) filter (
               where m.status <> 'invited' and m.deleted_at is null
                 and m.joined_at < b.from30
                 and (m.blocked_at is null or m.blocked_at >= b.from30))) as members
      from b
      left join public.memberships m
        on m.tenant_id = app.tenant_id()
       and m.role = 'member'
     group by b.from30, b.until
  ),
  risk as (
    select count(s.membership_id) as members,
           count(s.membership_id) filter (where s.has_push) as with_push
      from b
      left join public.dashboard_member_snapshots s
        on s.tenant_id = app.tenant_id()
       and s.snapshot_day = p_day
       and s.band = 'at_risk'
       and s.last_active_at is not null
       and (s.last_active_at at time zone b.tz)::date between p_day - 36 and p_day - 30
  )
  select jsonb_build_object(
           'members', mk.members,
           'enteredAtRisk', jsonb_build_object(
             'members', risk.members,
             'withPush', risk.with_push))
    from mk, risk
$$;--> statement-breakpoint
revoke all on function app.dashboard_area_overview(date) from public, anon, authenticated, service_role;--> statement-breakpoint

create or replace function app.dashboard_build_snapshot(p_day date)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  -- The payload shape version. Every area plan that adds a key bumps it (R-Risk 6). 8 since 08.7-12:
  -- the overview carries `enteredAtRisk` (7 since 08.7-11: the payload carries `support`).
  v_version constant int := 8;
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

  -- The member rows first (latest only, PR-2): the overview, members and content areas below read
  -- exactly these (08.7-12: the overview's `enteredAtRisk` too).
  delete from public.dashboard_member_snapshots where tenant_id = v_tenant;
  insert into public.dashboard_member_snapshots
         (tenant_id, membership_id, user_id, snapshot_day, built_at, band, band_d30, band_d60,
          last_active_at, active_days_30, strong_30, top_community_id, has_push, community_bands,
          insights)
  select * from app.dashboard_member_rows(p_day);

  -- 08.7-03: each member's own "Sua atividade" numbers, in the same transaction (D-463).
  update public.dashboard_member_snapshots s
     set activity = a.activity
    from app.dashboard_member_activity(p_day) a
   where s.tenant_id = v_tenant
     and s.membership_id = a.membership_id;

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
    jsonb_build_object(
      'overview', app.dashboard_area_overview(p_day),
      'members', app.dashboard_area_members(p_day),
      'content', app.dashboard_area_content(p_day),
      'events', app.dashboard_area_events(p_day),
      'finance', app.dashboard_area_finance(p_day),
      'support', app.dashboard_area_support(p_day))
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

create or replace function app.dashboard_snapshots_prune(p_batch int)
returns int
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_n int;
begin
  delete from public.dashboard_snapshots s
   using (
     select o.tenant_id, o.snapshot_day
       from public.dashboard_snapshots o
       join public.tenants t on t.id = o.tenant_id
      where o.snapshot_day < (now() at time zone t.timezone)::date - 8
      order by o.snapshot_day, o.tenant_id
      limit greatest(0, least(coalesce(p_batch, 0), 500))
   ) old
   where s.tenant_id = old.tenant_id
     and s.snapshot_day = old.snapshot_day;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;--> statement-breakpoint
revoke all on function app.dashboard_snapshots_prune(int) from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.dashboard_snapshots_prune(int) to service_role;
