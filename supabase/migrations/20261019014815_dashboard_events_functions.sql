-- dashboard_events_functions (08.7-08, D-455, D-460, D-461, UI-D-489 c, INSIGHT-06, INSIGHT-11,
-- INSIGHT-18; RESEARCH § O4 Eventos, Pitfalls 1, 5, 6, 12) — the owner's Eventos numbers, built
-- once a day. Hand-written (`--custom`), sorted AFTER `*_dashboard_content_functions.sql`
-- (builder v4), whose builder it replaces, and after `*_dashboard_members_functions.sql`, whose
-- action stream (`app.dashboard_member_actions`) and band rules it reuses.
--
-- D = the snapshot day (the tenant-local yesterday); Window30 = local days D-29..D; Prev30 =
-- D-59..D-30; `until_at` = local midnight of D+1 (today 00:00 local).
--
--   1. `app.dashboard_area_events(p_day date) jsonb`, ids and numbers only (PR-1). Only ACTIVE,
--      non-deleted events count (`events.status = 'active' and deleted_at is null`, R-Pitfall 5):
--      - `upcoming`: events starting at or after `until_at` (an event at local 00:00 today is
--        upcoming, EP-32), soonest first (`starts_at, id`), at most 6;
--      - `past`: events starting in Window30 (local 00:00 of D-29 is in, 23:59 of D-30 is not,
--        EP-32), most recent first (`starts_at desc, id desc`);
--      - each event: `startsAt`, `endsAt`, `format`, `capacity` (null = no limit), `durationMinutes`
--        = round((ends_at - starts_at) / 60 s) (EP-36) and `confirmed` = its `going` + `checked_in`
--        rows at build time; a past event adds `checkIns` (`checked_in`) and `walkIns` (`walk_in`).
--        Every attendee row counts here, as in the capacity guard and the attendee list (D-219): a
--        walk-in is a presence, never a confirmed RSVP (EP-33);
--      - `attendanceTotals { current, previous }`: confirmed, presences (`checked_in` + `walk_in`)
--        and walk-ins of the events starting in Window30 and in Prev30 — Visão geral reads these
--        (planning decision 3);
--      - `attendanceByBand`: the window's presences by ACTIVE ROLE MEMBERS, each counted under the
--        member's band on the event's local day - 1 (UI-D-489 c, planning decision 1), evaluated
--        from the member action stream with the members area's rules (new: joined after X-30;
--        superfan: 12+ active days in X-29..X and 3+ strong actions; engaged: 4+; occasional: 1-3;
--        at_risk: none in X-29..X, one in X-59..X-30; inactive: none in X-59..X). Exact counts,
--        never floored (planning decision 2). One action-stream scan bounded by the window's events
--        (D-89..D-1), then one lateral aggregate per presence.
--      Titles and covers are NOT stored: the API joins them live.
--   2. `app.dashboard_build_snapshot(p_day date)` v5: the v4 body kept whole, the payload version
--      bumped to 5 (so the hourly dispatcher rebuilds every tenant within the hour), and
--      `'events', app.dashboard_area_events(p_day)` added to the payload.
--
-- Posture (T-08.7-01, T-08.7-05): `security definer set search_path = ''` with fully qualified
-- names; the owner bypasses RLS, so EVERY source predicate pins `tenant_id = app.tenant_id()` and
-- the member set joins on `(tenant_id, user_id)`: a shared identity's presence in another tenant
-- never counts here (R-Pitfall 1). The new function is executable by no role but its owner; the
-- builder keeps its revoke/grant pair. No statement picks a single row with a LIMIT (pgTAP 040).
-- Expand-only: no table, column or policy changes.

create or replace function app.dashboard_area_events(p_day date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (
    select t.timezone as tz,
           ((p_day - 29)::timestamp at time zone t.timezone) as from30_at,
           ((p_day - 59)::timestamp at time zone t.timezone) as prev30_at,
           ((p_day + 1)::timestamp at time zone t.timezone) as until_at
      from public.tenants t
     where t.id = app.tenant_id()
  ),
  -- The counted set for the bands: active role members of this tenant (UI-D-484).
  m as (
    select ms.id, ms.user_id, (ms.joined_at at time zone b.tz)::date as joined_day
      from public.memberships ms
      cross join b
     where ms.tenant_id = app.tenant_id()
       and ms.role = 'member'
       and ms.status = 'active'
       and ms.blocked_at is null
       and ms.deleted_at is null
  ),
  -- Active events from Prev30 on, each placed in exactly one group.
  ev as (
    select e.id, e.starts_at, e.ends_at, e.format, e.capacity,
           (e.starts_at at time zone b.tz)::date as local_day,
           round(extract(epoch from (e.ends_at - e.starts_at)) / 60)::int as minutes,
           case when e.starts_at >= b.until_at then 'upcoming'
                when e.starts_at >= b.from30_at then 'past'
                else 'previous' end as grp
      from public.events e
      cross join b
     where e.tenant_id = app.tenant_id()
       and e.status = 'active'
       and e.deleted_at is null
       and e.starts_at >= b.prev30_at
  ),
  -- Every attendee row of those events, at build time.
  ac as (
    select ea.event_id,
           count(*) filter (where ea.status in ('going', 'checked_in')) as confirmed,
           count(*) filter (where ea.status = 'checked_in') as check_ins,
           count(*) filter (where ea.status = 'walk_in') as walk_ins
      from public.event_attendances ea
      join ev on ev.id = ea.event_id
     where ea.tenant_id = app.tenant_id()
     group by ea.event_id
  ),
  en as (
    select ev.id, ev.starts_at, ev.ends_at, ev.format, ev.capacity, ev.local_day, ev.minutes,
           ev.grp,
           coalesce(ac.confirmed, 0) as confirmed,
           coalesce(ac.check_ins, 0) as check_ins,
           coalesce(ac.walk_ins, 0) as walk_ins,
           row_number() over (partition by ev.grp order by ev.starts_at, ev.id) as rn
      from ev
      left join ac on ac.event_id = ev.id
  ),
  upcoming as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', en.id,
             'startsAt', to_char(en.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             'endsAt', to_char(en.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             'format', en.format,
             'capacity', en.capacity,
             'confirmed', en.confirmed,
             'durationMinutes', en.minutes)
           order by en.starts_at, en.id), '[]'::jsonb) as v
      from en
     where en.grp = 'upcoming'
       and en.rn <= 6
  ),
  past as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', en.id,
             'startsAt', to_char(en.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             'endsAt', to_char(en.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             'format', en.format,
             'capacity', en.capacity,
             'confirmed', en.confirmed,
             'checkIns', en.check_ins,
             'walkIns', en.walk_ins,
             'durationMinutes', en.minutes)
           order by en.starts_at desc, en.id desc), '[]'::jsonb) as v
      from en
     where en.grp = 'past'
  ),
  totals as (
    select jsonb_build_object(
             'current', jsonb_build_object(
               'confirmed', coalesce(sum(en.confirmed) filter (where en.grp = 'past'), 0),
               'present', coalesce(sum(en.check_ins + en.walk_ins) filter (where en.grp = 'past'), 0),
               'walkIns', coalesce(sum(en.walk_ins) filter (where en.grp = 'past'), 0)),
             'previous', jsonb_build_object(
               'confirmed', coalesce(sum(en.confirmed) filter (where en.grp = 'previous'), 0),
               'present', coalesce(sum(en.check_ins + en.walk_ins) filter (where en.grp = 'previous'), 0),
               'walkIns', coalesce(sum(en.walk_ins) filter (where en.grp = 'previous'), 0))) as v
      from en
  ),
  -- The window's presences by active members, with the day their band is read at (UI-D-489 c).
  pr as (
    select m.id as membership_id, m.joined_day, ev.local_day - 1 as x
      from public.event_attendances ea
      join ev on ev.id = ea.event_id and ev.grp = 'past'
      join m on m.user_id = ea.user_id
     where ea.tenant_id = app.tenant_id()
       and ea.status in ('checked_in', 'walk_in')
  ),
  -- The counted actions of those members, D-89..D-1 bounds every X-59..X of the window's events.
  acts as (
    select x.membership_id, x.day, x.strong
      from app.dashboard_member_actions(p_day - 89, p_day - 1) x
     where x.membership_id in (select pr.membership_id from pr)
  ),
  pb as (
    select case when pr.joined_day > pr.x - 30 then 'new'
                when g.days_0 >= 12 and g.strong_0 >= 3 then 'superfan'
                when g.days_0 >= 4 then 'engaged'
                when g.days_0 >= 1 then 'occasional'
                when g.days_30 >= 1 then 'at_risk'
                else 'inactive' end as band
      from pr
      cross join lateral (
        select count(distinct a.day) filter (where a.day between pr.x - 29 and pr.x) as days_0,
               count(*) filter (where a.strong and a.day between pr.x - 29 and pr.x) as strong_0,
               count(distinct a.day) filter (where a.day between pr.x - 59 and pr.x - 30) as days_30
          from acts a
         where a.membership_id = pr.membership_id
      ) g
  ),
  by_band as (
    select jsonb_build_object(
             'new', count(*) filter (where pb.band = 'new'),
             'superfan', count(*) filter (where pb.band = 'superfan'),
             'engaged', count(*) filter (where pb.band = 'engaged'),
             'occasional', count(*) filter (where pb.band = 'occasional'),
             'at_risk', count(*) filter (where pb.band = 'at_risk'),
             'inactive', count(*) filter (where pb.band = 'inactive')) as v
      from pb
  )
  select jsonb_build_object(
           'upcoming', (select v from upcoming),
           'past', (select v from past),
           'attendanceTotals', (select v from totals),
           'attendanceByBand', (select v from by_band))
$$;--> statement-breakpoint
revoke all on function app.dashboard_area_events(date) from public, anon, authenticated, service_role;--> statement-breakpoint

create or replace function app.dashboard_build_snapshot(p_day date)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  -- The payload shape version. Every area plan that adds a key bumps it (R-Risk 6). 5 since 08.7-08:
  -- the payload carries `events`.
  v_version constant int := 5;
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

  -- The member rows first (latest only, PR-2): the members and content areas below read exactly these.
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
      'events', app.dashboard_area_events(p_day))
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
