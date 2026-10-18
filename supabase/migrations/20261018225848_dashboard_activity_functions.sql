-- dashboard_activity_functions (08.7-03, D-463, D-464, D-440 [informational], UI-D-475, UI-D-483,
-- UI-D-485, INSIGHT-01..05, INSIGHT-18; RESEARCH § Metric Inventory M1-M6, Pattern 3, Pitfalls 1,
-- 2, 6, 9) — the member's own "Sua atividade" numbers, written on each member row by the nightly
-- build. Hand-written (`--custom`), sorted AFTER `*_dashboard_members_functions.sql`, whose action
-- stream (`app.dashboard_member_actions`) it reads.
--
-- D = the snapshot day (the tenant-local yesterday); Window7 = local days D-6..D, Prev7 = D-13..D-7;
-- Window30 = D-29..D. Today never counts (every window ends at the end of D).
--
--   1. `app.dashboard_member_activity(p_day date)`: one `(membership_id, activity)` row per active
--      role member joined before the end of D (the same set as `app.dashboard_member_rows`).
--      `activity` holds ids and numbers only (PR-1; community names are joined live at read time):
--        - `likes { count, previous }`: the member's likes (post, comment or story) in Window7 and
--          Prev7; `comments { count, previous }` the same for LIVE comments (`action = 'comment'`:
--          removed and self-deleted comments never count).
--        - `storiesSeen`: the member's OWN `story_views` rows with `viewed_at` in Window7, distinct per
--          story by `story_views_uq`, a story deleted since included (the member did see it,
--          planning decision 5). A count only: no story id or list ever leaves (T-08.7-11).
--        - `byCommunity [{ communityId, interactions }]`: likes and live comments on posts (or on
--          comments of posts) in Window7 per community, the tenant-wide feed as `communityId: null`
--          (UI-D-475), most first; a community with no interaction has no row.
--        - `attendance { attended, events }`: the member's `event_attendances` rows with status
--          `going`, `checked_in` or `walk_in` on active, non-deleted events whose `starts_at` falls in
--          Window30; `attended` = those `checked_in` or `walk_in` (UI-D-485: a walk-in is present).
--        - `weekStreak`: consecutive calendar weeks (`date_trunc('week', local day)`, Monday first,
--          UI-D-483) with at least one counted action over the member's whole history, the run
--          ending at the week of D, or else at the week before (the course streak's anchor rule,
--          R-Pattern 3); 0 when neither week has an action. A run of 1 is stored as 1: the web shows
--          the tile only from `MIN_STREAK_WEEKS = 2`.
--   2. `app.dashboard_build_snapshot(p_day date)` v3: the v2 body kept whole, the payload version
--      bumped to 3 (so the hourly dispatcher rebuilds every tenant within the hour), and, right after
--      the member-row insert in the same transaction, every row's `activity` written from (1).
--
-- Posture (T-08.7-05, T-08.7-07): `security definer set search_path = ''` with fully qualified
-- names; the owner bypasses RLS, so EVERY source predicate pins `tenant_id = app.tenant_id()` and the
-- member set joins on `(tenant_id, user_id)`: a shared identity's activity in another tenant never
-- counts here (R-Pitfall 1). The new function is executable by no role but its owner; the builder
-- keeps its revoke/grant pair. No statement picks a single row with a LIMIT (pgTAP 040). Expand-only:
-- no table, column or policy changes (`dashboard_member_snapshots.activity` exists since 08.7-01).

create or replace function app.dashboard_member_activity(p_day date)
returns table (membership_id uuid, activity jsonb)
language sql stable security definer set search_path = '' as $$
  with b as (
    select ((p_day - 6)::timestamp at time zone t.timezone) as from7_at,
           ((p_day - 29)::timestamp at time zone t.timezone) as from30_at,
           ((p_day + 1)::timestamp at time zone t.timezone) as until_at,
           date_trunc('week', p_day::timestamp)::date as week_d
      from public.tenants t
     where t.id = app.tenant_id()
  ),
  m as (
    select ms.id, ms.user_id
      from public.memberships ms
      cross join b
     where ms.tenant_id = app.tenant_id()
       and ms.role = 'member'
       and ms.status = 'active'
       and ms.blocked_at is null
       and ms.deleted_at is null
       and ms.joined_at < b.until_at
  ),
  -- Every counted action of the tenant's members up to the end of D (the streak needs the whole
  -- history; the windows below filter by local day).
  a as (
    select x.membership_id, x.day, x.action, x.community_id, x.on_post
      from app.dashboard_member_actions(null, p_day) x
  ),
  counts as (
    select a.membership_id,
           count(*) filter (where a.action = 'like' and a.day between p_day - 6 and p_day) as likes,
           count(*) filter (where a.action = 'like' and a.day between p_day - 13 and p_day - 7) as likes_prev,
           count(*) filter (where a.action = 'comment' and a.day between p_day - 6 and p_day) as comments,
           count(*) filter (where a.action = 'comment' and a.day between p_day - 13 and p_day - 7) as comments_prev
      from a
     where a.day between p_day - 13 and p_day
     group by a.membership_id
  ),
  comm as (
    select a.membership_id, a.community_id, count(*) as interactions
      from a
     where a.on_post
       and a.action in ('like', 'comment')
       and a.day between p_day - 6 and p_day
     group by a.membership_id, a.community_id
  ),
  comm_list as (
    select c.membership_id,
           jsonb_agg(jsonb_build_object('communityId', c.community_id, 'interactions', c.interactions)
                     order by c.interactions desc, c.community_id nulls first) as list
      from comm c
     group by c.membership_id
  ),
  seen as (
    select m.id as membership_id, count(*) as stories
      from public.story_views sv
      cross join b
      join m on m.user_id = sv.user_id
     where sv.tenant_id = app.tenant_id()
       and sv.viewed_at >= b.from7_at
       and sv.viewed_at < b.until_at
     group by m.id
  ),
  att as (
    select m.id as membership_id,
           count(*) as events,
           count(*) filter (where ea.status in ('checked_in', 'walk_in')) as attended
      from public.event_attendances ea
      cross join b
      join m on m.user_id = ea.user_id
      join public.events e on e.id = ea.event_id and e.tenant_id = app.tenant_id()
     where ea.tenant_id = app.tenant_id()
       and ea.status in ('going', 'checked_in', 'walk_in')
       and e.status = 'active'
       and e.deleted_at is null
       and e.starts_at >= b.from30_at
       and e.starts_at < b.until_at
     group by m.id
  ),
  -- The week streak (R-Pattern 3): the distinct Monday-first weeks with an action, islands of
  -- consecutive weeks, and the island holding the anchor week (D's week, else the week before).
  w as (
    select distinct a.membership_id, date_trunc('week', a.day::timestamp)::date as wk
      from a
  ),
  isl as (
    select w.membership_id, w.wk,
           w.wk - 7 * (row_number() over (partition by w.membership_id order by w.wk))::int as grp
      from w
  ),
  anchor as (
    select i.membership_id, i.grp
      from isl i
      cross join b
     where i.wk = b.week_d
        or (i.wk = b.week_d - 7
            and not exists (select 1 from w w2
                             where w2.membership_id = i.membership_id and w2.wk = b.week_d))
  ),
  streak as (
    select an.membership_id, count(*) as weeks
      from anchor an
      join isl i on i.membership_id = an.membership_id and i.grp = an.grp
     group by an.membership_id
  )
  select m.id,
         jsonb_build_object(
           'likes', jsonb_build_object('count', coalesce(c.likes, 0)::int,
                                       'previous', coalesce(c.likes_prev, 0)::int),
           'comments', jsonb_build_object('count', coalesce(c.comments, 0)::int,
                                          'previous', coalesce(c.comments_prev, 0)::int),
           'storiesSeen', coalesce(s.stories, 0)::int,
           'byCommunity', coalesce(cl.list, '[]'::jsonb),
           'attendance', jsonb_build_object('attended', coalesce(t.attended, 0)::int,
                                            'events', coalesce(t.events, 0)::int),
           'weekStreak', coalesce(st.weeks, 0)::int)
    from m
    left join counts c on c.membership_id = m.id
    left join comm_list cl on cl.membership_id = m.id
    left join seen s on s.membership_id = m.id
    left join att t on t.membership_id = m.id
    left join streak st on st.membership_id = m.id
$$;--> statement-breakpoint
revoke all on function app.dashboard_member_activity(date) from public, anon, authenticated, service_role;--> statement-breakpoint

create or replace function app.dashboard_build_snapshot(p_day date)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  -- The payload shape version. Every area plan that adds a key bumps it (R-Risk 6). 3 since 08.7-03:
  -- the member rows carry `activity`.
  v_version constant int := 3;
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

  -- The member rows first (latest only, PR-2): the members area below aggregates exactly these.
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
      'members', app.dashboard_area_members(p_day))
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
