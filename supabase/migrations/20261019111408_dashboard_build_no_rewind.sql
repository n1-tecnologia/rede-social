-- dashboard_build_no_rewind (08.7 code review WR-01) — hand-written (`--custom`), sorted AFTER
-- `*_dashboard_overview_functions.sql` (builder v8), whose builder it replaces.
--
-- `app.dashboard_build_snapshot(p_day date)` v8: the 20261019035403 body kept whole (same payload
-- version 8, so no tenant rebuilds), plus one guard after the "already built at this version"
-- check: when the tenant already has a snapshot of a day AFTER `p_day`, the build returns false and
-- writes nothing. Before it, a job of day D completing after D+1 was built (a retry, a manual
-- re-enqueue, a stale `created` job after an outage) deleted every `dashboard_member_snapshots` row
-- of the tenant and rewrote them for D, while D+1's `dashboard_snapshots` row stayed the one
-- `readLatestSnapshot` returns: the band lists of the newest snapshot (filtered on its day) read
-- empty beside their counts, and the member detail and "Sua atividade" showed the older day until
-- the next night's build.
--
-- Posture unchanged (T-08.7-01, T-08.7-25): `security definer set search_path = ''`, fully
-- qualified names, the zero-uuid system-lane gate, the revoke/grant pair re-stated. Expand-only.

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

  -- WR-01 (08.7 review): never rewind. The member rows are latest-only and the band lists read
  -- them by the newest snapshot's day, so a late build of an OLDER day (a retry, a re-enqueued or
  -- stale job completing after the next day was built) would replace them with that older day's
  -- behind the newer snapshot the panels read. A tenant that already has a newer day builds nothing.
  if exists (
    select 1
      from public.dashboard_snapshots s
     where s.tenant_id = v_tenant
       and s.snapshot_day > p_day
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
grant execute on function app.dashboard_build_snapshot(date) to authenticated;
