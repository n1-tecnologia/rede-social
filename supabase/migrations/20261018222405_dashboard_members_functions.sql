-- dashboard_members_functions (08.7-02, D-465, D-440 [informational], UI-D-484, UI-D-486, UI-D-487,
-- INSIGHT-07, INSIGHT-08, INSIGHT-18, INSIGHT-19; RESEARCH § Metric Inventory O1/O2, Band rules,
-- Patterns 1 and 2, Pitfalls 1, 4, 5, 6, 9, 12, Risk 1) — the engagement model every owner area
-- stands on. Hand-written (`--custom`), sorted AFTER the generated `*_feed_dashboard_indexes.sql`,
-- whose two tenant-first `created_at` indexes the window scans below ride (R-Risk 1).
--
-- Counted actions (UI-D-484), the fixture rules of `packages/modules/dashboard/fixtures/shared.ts`:
--   like, comment, post, RSVP "vou", check-in or walk-in, paid order. Support messages and moderated
--   (removed) comments do not count. An active day is a tenant-local calendar day with at least one
--   counted action; the window is D-29..D (D = the snapshot day, the tenant-local yesterday).
--   Concretely: a `feed_likes` row of the member (post, comment or story like; a like on content
--   deleted later still counts, the like row exists), a live `feed_comments` row they wrote
--   (`deleted_at is null`: removed and self-deleted comments never count), a live `feed_posts` row
--   they wrote (V2-ready, none in V1), an RSVP "vou" (`event_attendances.status in ('going',
--   'checked_in')` dated `responded_at`), a check-in or walk-in (`status in ('checked_in',
--   'walk_in')` dated `checked_in_at`), a paid order (`store_orders.status = 'paid'` dated
--   `paid_at`; a revoked order keeps `paid_at` and never counts). Strong = comment, post, check-in
--   or walk-in, paid order. Only memberships with role `member`, `status = 'active'`, never blocked
--   or deleted act; staff actions count nowhere (R-Pitfall 4).
--
-- The bands (exclusive, the first that matches wins), at anchor X (D, D-30, D-60):
--   1. `new`: joined local date > X-30.
--   2. `superfan`: 12+ active days in X-29..X AND 3+ strong actions in X-29..X.
--   3. `engaged`: 4+ active days in X-29..X.
--   4. `occasional`: 1-3 active days in X-29..X.
--   5. `at_risk`: no active day in X-29..X, at least one in X-59..X-30.
--   6. `inactive`: no active day in X-59..X.
--   At X = D-30 and X = D-60 a member who had not joined yet (joined local date > X) has no band.
--
--   1. `app.dashboard_member_actions(p_from date, p_to date)`: one row per counted action of the
--      caller's tenant in the tenant-local days p_from..p_to (`p_from` null = no lower bound, for the
--      since-joining aggregates): `(membership_id, user_id, at, day, action, strong, post_id,
--      community_id, on_post)`, `action` in like, comment, post, rsvp, checkin, order; `on_post` is
--      true for an action on a post or on a comment of a post, so the tenant-wide feed is `on_post
--      and community_id is null`. The bounds are local midnights turned into instants ONCE and
--      compared with the raw timestamps (R-Pattern 1), so the scans stay index-friendly.
--   2. `app.dashboard_member_rows(p_day date)`: one `dashboard_member_snapshots` row (every column
--      but `activity`) per active role member joined before the end of D: the bands at D, D-30 and
--      D-60 (`count(distinct day)`, R-Pattern 2), `last_active_at`, `active_days_30`, `strong_30`,
--      `has_push` (a `push_subscriptions` row exists: a boolean only, never an endpoint or a key,
--      T-08.7-08), `community_bands` (`{ "<communityId>": "<band>" }` for every active community
--      whose base holds the member: `app.community_viewer_ids`, null = every active member; the band
--      over that community's posts only), `insights` (`last30`, `weeklyActiveDays` 12 blocks oldest
--      first, `communities` actions since joining per community with the tenant-wide feed as null,
--      most first, `postTypes` likes and comments since joining per post kind) and
--      `top_community_id` (the first non-null community of that list).
--   3. `app.dashboard_area_members(p_day date) jsonb`: the Membros area and the overview's engaged
--      share and trend, aggregated from the member rows the builder has just written (so a band list
--      always holds exactly the band's count): `growth { joined, weeklyJoined[12] }` (no `left` and
--      no balance: `memberships.deleted_at` is never written, D-465), `engagement { counts,
--      newActivated }` (exact, never floored, UI-D-486), `previousEngagement` (today's members by
--      `band_d30`, nulls left out), `movement { up, down, flows }` (the ladder superfan > engaged >
--      occasional > at_risk > inactive, members new at either end left out, UI-D-487), `cohorts`
--      (the last 6 complete joining months, month 0 = 100), `atRiskWithPush`, `actions30`,
--      `activeMembers30`, `weeklyInteracting { current[12], previous[12] }`, `communityEngagement`
--      (every active community: base, bands, card numbers) and `eventEngagement` (the panel's events:
--      today's band of each RSVP "vou"). Ids and numbers only (PR-1); module flags are the API's
--      concern (the builder computes every scope).
--   4. `app.dashboard_build_snapshot(p_day date)` v2: the body of 08.7-01 kept whole, the payload
--      version bumped to 2 (so the hourly dispatcher rebuilds every tenant within the hour), and,
--      after the guards and the early return, in ONE transaction: delete the tenant's member rows,
--      insert `app.dashboard_member_rows(p_day)`, then upsert the tenant row with
--      `payload = { overview, members }`. Each build overwrites the tenant's member rows and
--      leaves none for a membership that is no longer an active member, so no day-by-day trail of
--      what one person did is ever kept (PR-2).
--
-- Posture (T-08.7-05, T-08.7-07): every function is `security definer set search_path = ''` with
-- fully qualified names; the owner bypasses RLS, so EVERY source predicate pins
-- `tenant_id = app.tenant_id()` itself and memberships join on `(tenant_id, user_id)` (a shared
-- identity's actions in another tenant never count, R-Pitfall 1). The three new functions are
-- executable by no role but their owner; the builder keeps its revoke/grant pair. No statement
-- picks a single row with a LIMIT (pgTAP 040). Expand-only: no table, column or policy changes.

create or replace function app.dashboard_member_actions(p_from date, p_to date)
returns table (
  membership_id uuid,
  user_id uuid,
  at timestamptz,
  day date,
  action text,
  strong boolean,
  post_id uuid,
  community_id uuid,
  on_post boolean
)
language sql stable security definer set search_path = '' as $$
  with b as (
    select t.timezone as tz,
           coalesce(p_from::timestamp at time zone t.timezone, '-infinity'::timestamptz) as from_at,
           ((p_to + 1)::timestamp at time zone t.timezone) as until_at
      from public.tenants t
     where t.id = app.tenant_id()
  ),
  m as (
    select ms.id, ms.user_id
      from public.memberships ms
     where ms.tenant_id = app.tenant_id()
       and ms.role = 'member'
       and ms.status = 'active'
       and ms.blocked_at is null
       and ms.deleted_at is null
  ),
  src as (
    select l.user_id, l.created_at as at, 'like'::text as action, false as strong,
           coalesce(l.post_id, c.post_id) as post_id,
           (l.post_id is not null or l.comment_id is not null) as on_post
      from b
      join public.feed_likes l
        on l.tenant_id = app.tenant_id()
       and l.created_at >= b.from_at and l.created_at < b.until_at
      left join public.feed_comments c
        on c.id = l.comment_id and c.tenant_id = app.tenant_id()
    union all
    select c.author_user_id, c.created_at, 'comment', true, c.post_id, c.post_id is not null
      from b
      join public.feed_comments c
        on c.tenant_id = app.tenant_id()
       and c.deleted_at is null
       and c.created_at >= b.from_at and c.created_at < b.until_at
    union all
    select p.author_user_id, p.created_at, 'post', true, p.id, true
      from b
      join public.feed_posts p
        on p.tenant_id = app.tenant_id()
       and p.deleted_at is null
       and p.created_at >= b.from_at and p.created_at < b.until_at
    union all
    select ea.user_id, ea.responded_at, 'rsvp', false, null::uuid, false
      from b
      join public.event_attendances ea
        on ea.tenant_id = app.tenant_id()
       and ea.status in ('going', 'checked_in')
       and ea.responded_at >= b.from_at and ea.responded_at < b.until_at
    union all
    select ea.user_id, ea.checked_in_at, 'checkin', true, null::uuid, false
      from b
      join public.event_attendances ea
        on ea.tenant_id = app.tenant_id()
       and ea.status in ('checked_in', 'walk_in')
       and ea.checked_in_at >= b.from_at and ea.checked_in_at < b.until_at
    union all
    select o.user_id, o.paid_at, 'order', true, null::uuid, false
      from b
      join public.store_orders o
        on o.tenant_id = app.tenant_id()
       and o.status = 'paid'
       and o.paid_at >= b.from_at and o.paid_at < b.until_at
  )
  select m.id, m.user_id, s.at, (s.at at time zone b.tz)::date, s.action, s.strong, s.post_id,
         p.community_id, s.on_post
    from src s
    join m on m.user_id = s.user_id
    cross join b
    left join public.feed_posts p
      on p.id = s.post_id and p.tenant_id = app.tenant_id()
$$;--> statement-breakpoint
revoke all on function app.dashboard_member_actions(date, date) from public, anon, authenticated, service_role;--> statement-breakpoint

create or replace function app.dashboard_member_rows(p_day date)
returns table (
  tenant_id uuid,
  membership_id uuid,
  user_id uuid,
  snapshot_day date,
  built_at timestamptz,
  band text,
  band_d30 text,
  band_d60 text,
  last_active_at timestamptz,
  active_days_30 integer,
  strong_30 integer,
  top_community_id uuid,
  has_push boolean,
  community_bands jsonb,
  insights jsonb
)
language sql stable security definer set search_path = '' as $$
  with b as (
    select t.timezone as tz, ((p_day + 1)::timestamp at time zone t.timezone) as until_at
      from public.tenants t
     where t.id = app.tenant_id()
  ),
  m as (
    select ms.id, ms.user_id, (ms.joined_at at time zone b.tz)::date as joined_day
      from public.memberships ms
      cross join b
     where ms.tenant_id = app.tenant_id()
       and ms.role = 'member'
       and ms.status = 'active'
       and ms.blocked_at is null
       and ms.deleted_at is null
       and ms.joined_at < b.until_at
  ),
  a as (
    select x.membership_id, x.at, x.day, x.action, x.strong, x.post_id, x.community_id, x.on_post
      from app.dashboard_member_actions(null, p_day) x
  ),
  -- One row per member per active day, with that day's strong actions.
  d as (
    select a.membership_id, a.day, count(*) filter (where a.strong) as strong
      from a
     group by a.membership_id, a.day
  ),
  -- Active days and strong actions per 30-day window: D-29..D, D-59..D-30, D-89..D-60, D-119..D-90.
  g as (
    select d.membership_id,
           count(distinct d.day) filter (where d.day between p_day - 29 and p_day) as days_0,
           coalesce(sum(d.strong) filter (where d.day between p_day - 29 and p_day), 0) as strong_0,
           count(distinct d.day) filter (where d.day between p_day - 59 and p_day - 30) as days_30,
           coalesce(sum(d.strong) filter (where d.day between p_day - 59 and p_day - 30), 0) as strong_30,
           count(distinct d.day) filter (where d.day between p_day - 89 and p_day - 60) as days_60,
           coalesce(sum(d.strong) filter (where d.day between p_day - 89 and p_day - 60), 0) as strong_60,
           count(distinct d.day) filter (where d.day between p_day - 119 and p_day - 90) as days_90
      from d
     group by d.membership_id
  ),
  last_at as (
    select a.membership_id, max(a.at) as at
      from a
     group by a.membership_id
  ),
  last30 as (
    select a.membership_id,
           count(*) filter (where a.action = 'like') as likes,
           count(*) filter (where a.action = 'comment') as comments,
           count(*) filter (where a.action = 'checkin') as check_ins,
           count(*) filter (where a.action = 'order') as orders
      from a
     where a.day between p_day - 29 and p_day
     group by a.membership_id
  ),
  -- Active days per 7-day block ending D: block 11 = D-6..D, block 0 = D-83..D-77.
  wk as (
    select d.membership_id, 11 - (p_day - d.day) / 7 as i, count(*) as days
      from d
     where d.day between p_day - 83 and p_day
     group by d.membership_id, 11 - (p_day - d.day) / 7
  ),
  weekly as (
    select m.id as membership_id, jsonb_agg(coalesce(wk.days, 0) order by k.i) as weeks
      from m
      cross join generate_series(0, 11) as k(i)
      left join wk on wk.membership_id = m.id and wk.i = k.i
     group by m.id
  ),
  -- Actions since joining per community (the tenant-wide feed as null), most first.
  comm as (
    select a.membership_id, a.community_id, count(*) as actions
      from a
     where a.on_post
     group by a.membership_id, a.community_id
  ),
  comm_list as (
    select c.membership_id,
           jsonb_agg(jsonb_build_object('id', c.community_id, 'actions', c.actions)
                     order by c.actions desc, c.community_id nulls first) as list,
           (array_agg(c.community_id order by c.actions desc, c.community_id)
              filter (where c.community_id is not null))[1] as top_id
      from comm c
     group by c.membership_id
  ),
  -- Likes and comments since joining per post kind (a gallery is one kind here; the photo/carousel
  -- split is the content area's).
  pt as (
    select a.membership_id,
           case when p.media_kind = 'video' then 'video'
                when p.media_kind = 'gallery' then 'gallery'
                when p.link_preview_id is not null then 'link'
                else 'text' end as type,
           count(*) as interactions
      from a
      join public.feed_posts p on p.id = a.post_id and p.tenant_id = app.tenant_id()
     where a.on_post and a.action in ('like', 'comment')
     group by 1, 2
  ),
  pt_list as (
    select pt.membership_id,
           jsonb_agg(jsonb_build_object('type', pt.type, 'interactions', pt.interactions)
                     order by pt.interactions desc, pt.type) as list
      from pt
     group by pt.membership_id
  ),
  -- Community scopes: every active community and its base (null = every active member).
  cv as (
    select c.id, app.community_viewer_ids(c.id) as viewers
      from public.communities c
     where c.tenant_id = app.tenant_id()
       and c.status = 'active'
       and c.deleted_at is null
  ),
  cd as (
    select a.membership_id, a.community_id, a.day, count(*) filter (where a.strong) as strong
      from a
     where a.on_post and a.community_id is not null
     group by a.membership_id, a.community_id, a.day
  ),
  cg as (
    select cd.membership_id, cd.community_id,
           count(distinct cd.day) filter (where cd.day between p_day - 29 and p_day) as days_0,
           coalesce(sum(cd.strong) filter (where cd.day between p_day - 29 and p_day), 0) as strong_0,
           count(distinct cd.day) filter (where cd.day between p_day - 59 and p_day - 30) as days_30
      from cd
     group by cd.membership_id, cd.community_id
  ),
  cb as (
    select m.id as membership_id,
           jsonb_object_agg(
             cv.id::text,
             case when m.joined_day > p_day - 30 then 'new'
                  when coalesce(cg.days_0, 0) >= 12 and coalesce(cg.strong_0, 0) >= 3 then 'superfan'
                  when coalesce(cg.days_0, 0) >= 4 then 'engaged'
                  when coalesce(cg.days_0, 0) >= 1 then 'occasional'
                  when coalesce(cg.days_30, 0) >= 1 then 'at_risk'
                  else 'inactive' end) as bands
      from m
      join cv on cv.viewers is null or m.user_id = any (cv.viewers)
      left join cg on cg.membership_id = m.id and cg.community_id = cv.id
     group by m.id
  )
  select app.tenant_id(),
         m.id,
         m.user_id,
         p_day,
         now(),
         case when m.joined_day > p_day - 30 then 'new'
              when coalesce(g.days_0, 0) >= 12 and coalesce(g.strong_0, 0) >= 3 then 'superfan'
              when coalesce(g.days_0, 0) >= 4 then 'engaged'
              when coalesce(g.days_0, 0) >= 1 then 'occasional'
              when coalesce(g.days_30, 0) >= 1 then 'at_risk'
              else 'inactive' end,
         case when m.joined_day > p_day - 30 then null
              when m.joined_day > p_day - 60 then 'new'
              when coalesce(g.days_30, 0) >= 12 and coalesce(g.strong_30, 0) >= 3 then 'superfan'
              when coalesce(g.days_30, 0) >= 4 then 'engaged'
              when coalesce(g.days_30, 0) >= 1 then 'occasional'
              when coalesce(g.days_60, 0) >= 1 then 'at_risk'
              else 'inactive' end,
         case when m.joined_day > p_day - 60 then null
              when m.joined_day > p_day - 90 then 'new'
              when coalesce(g.days_60, 0) >= 12 and coalesce(g.strong_60, 0) >= 3 then 'superfan'
              when coalesce(g.days_60, 0) >= 4 then 'engaged'
              when coalesce(g.days_60, 0) >= 1 then 'occasional'
              when coalesce(g.days_90, 0) >= 1 then 'at_risk'
              else 'inactive' end,
         la.at,
         coalesce(g.days_0, 0)::int,
         coalesce(g.strong_0, 0)::int,
         cl.top_id,
         exists (
           select 1
             from public.push_subscriptions ps
            where ps.tenant_id = app.tenant_id()
              and ps.user_id = m.user_id
         ),
         coalesce(cb.bands, '{}'::jsonb),
         jsonb_build_object(
           'last30', jsonb_build_object(
             'activeDays', coalesce(g.days_0, 0)::int,
             'likes', coalesce(l.likes, 0)::int,
             'comments', coalesce(l.comments, 0)::int,
             'checkIns', coalesce(l.check_ins, 0)::int,
             'orders', coalesce(l.orders, 0)::int,
             'strongActions', coalesce(g.strong_0, 0)::int),
           'weeklyActiveDays', w.weeks,
           'communities', coalesce(cl.list, '[]'::jsonb),
           'postTypes', coalesce(ptl.list, '[]'::jsonb))
    from m
    left join g on g.membership_id = m.id
    left join last_at la on la.membership_id = m.id
    left join last30 l on l.membership_id = m.id
    left join weekly w on w.membership_id = m.id
    left join comm_list cl on cl.membership_id = m.id
    left join pt_list ptl on ptl.membership_id = m.id
    left join cb on cb.membership_id = m.id
$$;--> statement-breakpoint
revoke all on function app.dashboard_member_rows(date) from public, anon, authenticated, service_role;--> statement-breakpoint

create or replace function app.dashboard_area_members(p_day date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (
    select t.timezone as tz,
           ((p_day - 29)::timestamp at time zone t.timezone) as from30,
           ((p_day + 1)::timestamp at time zone t.timezone) as until_at,
           date_trunc('month', p_day::timestamp)::date as month_d
      from public.tenants t
     where t.id = app.tenant_id()
  ),
  -- The member rows the builder has just written, with each one's joining instant.
  r as (
    select s.membership_id, s.user_id, s.band, s.band_d30, s.has_push, s.last_active_at,
           s.active_days_30, s.community_bands, (ms.joined_at at time zone b.tz)::date as joined_day
      from public.dashboard_member_snapshots s
      join public.memberships ms on ms.id = s.membership_id and ms.tenant_id = app.tenant_id()
      cross join b
     where s.tenant_id = app.tenant_id()
  ),
  -- Every counted action the area needs: 24 weeks back, and the six cohort months.
  a as (
    select x.membership_id, x.day, x.action, x.community_id, x.on_post
      from b
      cross join lateral app.dashboard_member_actions(
        least(p_day - 167, (b.month_d - interval '6 months')::date), p_day) x
      join r on r.membership_id = x.membership_id
  ),
  joins as (
    select ms.joined_at, (ms.joined_at at time zone b.tz)::date as joined_day
      from public.memberships ms
      cross join b
     where ms.tenant_id = app.tenant_id()
       and ms.role = 'member'
       and ms.status = 'active'
       and ms.blocked_at is null
       and ms.deleted_at is null
       and ms.joined_at < b.until_at
  ),
  growth as (
    select jsonb_build_object(
             'joined', (select count(*) from joins j, b where j.joined_at >= b.from30),
             'weeklyJoined', (
               select jsonb_agg(coalesce(x.n, 0) order by k.i)
                 from generate_series(0, 11) as k(i)
                 left join (
                   select 11 - (p_day - j.joined_day) / 7 as i, count(*) as n
                     from joins j
                    where j.joined_day between p_day - 83 and p_day
                    group by 1
                 ) x on x.i = k.i)) as v
  ),
  engagement as (
    select jsonb_build_object(
             'counts', jsonb_build_object(
               'new', count(*) filter (where r.band = 'new'),
               'superfan', count(*) filter (where r.band = 'superfan'),
               'engaged', count(*) filter (where r.band = 'engaged'),
               'occasional', count(*) filter (where r.band = 'occasional'),
               'at_risk', count(*) filter (where r.band = 'at_risk'),
               'inactive', count(*) filter (where r.band = 'inactive')),
             'newActivated', count(*) filter (where r.band = 'new' and r.last_active_at is not null)) as v,
           count(*) filter (where r.band = 'at_risk' and r.has_push) as at_risk_with_push,
           count(*) filter (where r.active_days_30 > 0) as active_members_30
      from r
  ),
  previous as (
    select jsonb_build_object(
             'counts', jsonb_build_object(
               'new', count(*) filter (where r.band_d30 = 'new'),
               'superfan', count(*) filter (where r.band_d30 = 'superfan'),
               'engaged', count(*) filter (where r.band_d30 = 'engaged'),
               'occasional', count(*) filter (where r.band_d30 = 'occasional'),
               'at_risk', count(*) filter (where r.band_d30 = 'at_risk'),
               'inactive', count(*) filter (where r.band_d30 = 'inactive')),
             'newActivated', count(*) filter (
               where r.band_d30 = 'new'
                 and exists (select 1 from a where a.membership_id = r.membership_id
                                             and a.day <= p_day - 30))) as v
      from r
  ),
  -- The ladder, members new at either end left out (UI-D-487).
  ladder as (
    select r.band, r.band_d30,
           array_position(array['inactive', 'at_risk', 'occasional', 'engaged', 'superfan'], r.band) as now_rank,
           array_position(array['inactive', 'at_risk', 'occasional', 'engaged', 'superfan'], r.band_d30) as then_rank
      from r
     where r.band <> 'new' and r.band_d30 is not null and r.band_d30 <> 'new'
  ),
  movement as (
    select jsonb_build_object(
             'up', (select count(*) from ladder l where l.now_rank > l.then_rank),
             'down', (select count(*) from ladder l where l.now_rank < l.then_rank),
             'flows', coalesce((
               select jsonb_agg(jsonb_build_object('from', f.band_d30, 'to', f.band, 'members', f.n)
                                order by f.n desc, f.band_d30, f.band)
                 from (select l.band_d30, l.band, count(*) as n
                         from ladder l
                        where l.band <> l.band_d30
                        group by l.band_d30, l.band) f), '[]'::jsonb)) as v
  ),
  -- Cohorts: the last 6 complete joining months before D's month, each month after joining up to
  -- D's month; month 0 = 100, month k = the rounded percent with a counted action in that month.
  cohort as (
    select date_trunc('month', r.joined_day::timestamp)::date as month, r.membership_id
      from r
      cross join b
     where r.joined_day >= (b.month_d - interval '6 months')::date
       and r.joined_day < b.month_d
  ),
  active_month as (
    select distinct a.membership_id, date_trunc('month', a.day::timestamp)::date as month
      from a
  ),
  cohort_cell as (
    select c.month, k.k,
           case when k.k = 0 then 100
                else round(100.0 * count(distinct am.membership_id)
                                 / count(distinct c.membership_id))::int end as value
      from cohort c
      cross join b
      cross join lateral generate_series(
        0,
        ((extract(year from b.month_d) * 12 + extract(month from b.month_d))
          - (extract(year from c.month) * 12 + extract(month from c.month)))::int) as k(k)
      left join active_month am
        on am.membership_id = c.membership_id
       and am.month = (c.month + make_interval(months => k.k))::date
     group by c.month, k.k
  ),
  cohorts as (
    select coalesce(jsonb_agg(jsonb_build_object('month', to_char(x.month, 'YYYY-MM'), 'values', x.vals)
                              order by x.month), '[]'::jsonb) as v
      from (select cc.month, jsonb_agg(cc.value order by cc.k) as vals
              from cohort_cell cc
             group by cc.month) x
  ),
  -- Distinct members with a counted action per 7-day block: 23 = D-6..D, 0 = D-167..D-161.
  interacting as (
    select jsonb_build_object(
             'current', jsonb_agg(coalesce(x.n, 0) order by k.j) filter (where k.j >= 12),
             'previous', jsonb_agg(coalesce(x.n, 0) order by k.j) filter (where k.j < 12)) as v
      from generate_series(0, 23) as k(j)
      left join (
        select 23 - (p_day - a.day) / 7 as j, count(distinct a.membership_id) as n
          from a
         where a.day between p_day - 167 and p_day
         group by 1
      ) x on x.j = k.j
  ),
  -- Community scopes: every active community, its base (the members whose row holds its key).
  comms as (
    select c.id, c.position, c.last_activity_at
      from public.communities c
     where c.tenant_id = app.tenant_id()
       and c.status = 'active'
       and c.deleted_at is null
  ),
  community_engagement as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id,
             'bands', jsonb_build_object(
               'counts', jsonb_build_object(
                 'new', x.n_new, 'superfan', x.n_superfan, 'engaged', x.n_engaged,
                 'occasional', x.n_occasional, 'at_risk', x.n_at_risk, 'inactive', x.n_inactive),
               'newActivated', x.n_activated),
             'atRiskWithPush', x.n_push,
             'members', x.n_members,
             'activeWeek', y.active_week,
             'posts', z.posts,
             'interactions', y.interactions)
           order by c.position, c.last_activity_at desc, c.id), '[]'::jsonb) as v
      from comms c
      cross join lateral (
        select count(*) as n_members,
               count(*) filter (where s.band = 'new') as n_new,
               count(*) filter (where s.band = 'superfan') as n_superfan,
               count(*) filter (where s.band = 'engaged') as n_engaged,
               count(*) filter (where s.band = 'occasional') as n_occasional,
               count(*) filter (where s.band = 'at_risk') as n_at_risk,
               count(*) filter (where s.band = 'inactive') as n_inactive,
               count(*) filter (
                 where s.band = 'new'
                   and exists (select 1 from a
                                where a.membership_id = s.membership_id
                                  and a.on_post and a.community_id = c.id)) as n_activated,
               count(*) filter (where s.band = 'at_risk' and s.has_push) as n_push
          from (select r.membership_id, r.has_push, r.community_bands ->> c.id::text as band
                  from r) s
         where s.band is not null
      ) x
      cross join lateral (
        select count(distinct a.membership_id) filter (where a.day between p_day - 6 and p_day) as active_week,
               count(*) filter (where a.action in ('like', 'comment')
                                  and a.day between p_day - 29 and p_day) as interactions
          from a
         where a.on_post and a.community_id = c.id
      ) y
      cross join lateral (
        select count(*) as posts
          from public.feed_posts p
          cross join b
         where p.tenant_id = app.tenant_id()
           and p.community_id = c.id
           and p.deleted_at is null
           and p.created_at >= b.from30 and p.created_at < b.until_at
      ) z
  ),
  -- The panel's events: the active ones starting from the end of D, soonest first, at most six,
  -- then those of D-29..D, most recent first.
  panel_events as (
    select e.id, 0 as grp, row_number() over (order by e.starts_at, e.id) as rn
      from public.events e
      cross join b
     where e.tenant_id = app.tenant_id()
       and e.status = 'active'
       and e.deleted_at is null
       and e.starts_at >= b.until_at
    union all
    select e.id, 1, row_number() over (order by e.starts_at desc, e.id desc)
      from public.events e
      cross join b
     where e.tenant_id = app.tenant_id()
       and e.status = 'active'
       and e.deleted_at is null
       and e.starts_at >= b.from30 and e.starts_at < b.until_at
  ),
  rsvp as (
    select ea.event_id, r.band, r.has_push, r.last_active_at
      from public.event_attendances ea
      join r on r.user_id = ea.user_id
      cross join b
     where ea.tenant_id = app.tenant_id()
       and ea.status in ('going', 'checked_in')
       and ea.responded_at < b.until_at
  ),
  event_engagement as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', pe.id,
             'bands', jsonb_build_object(
               'counts', jsonb_build_object(
                 'new', x.n_new, 'superfan', x.n_superfan, 'engaged', x.n_engaged,
                 'occasional', x.n_occasional, 'at_risk', x.n_at_risk, 'inactive', x.n_inactive),
               'newActivated', x.n_activated),
             'atRiskWithPush', x.n_push)
           order by pe.grp, pe.rn), '[]'::jsonb) as v
      from panel_events pe
      cross join lateral (
        select count(*) filter (where v.band = 'new') as n_new,
               count(*) filter (where v.band = 'superfan') as n_superfan,
               count(*) filter (where v.band = 'engaged') as n_engaged,
               count(*) filter (where v.band = 'occasional') as n_occasional,
               count(*) filter (where v.band = 'at_risk') as n_at_risk,
               count(*) filter (where v.band = 'inactive') as n_inactive,
               count(*) filter (where v.band = 'new' and v.last_active_at is not null) as n_activated,
               count(*) filter (where v.band = 'at_risk' and v.has_push) as n_push
          from rsvp v
         where v.event_id = pe.id
      ) x
     where pe.grp = 1 or pe.rn <= 6
  )
  select jsonb_build_object(
           'growth', (select v from growth),
           'engagement', (select v from engagement),
           'previousEngagement', (select v from previous),
           'movement', (select v from movement),
           'cohorts', (select v from cohorts),
           'atRiskWithPush', (select at_risk_with_push from engagement),
           'actions30', (select count(*) from a where a.day between p_day - 29 and p_day),
           'activeMembers30', (select active_members_30 from engagement),
           'weeklyInteracting', (select v from interacting),
           'communityEngagement', (select v from community_engagement),
           'eventEngagement', (select v from event_engagement))
$$;--> statement-breakpoint
revoke all on function app.dashboard_area_members(date) from public, anon, authenticated, service_role;--> statement-breakpoint

create or replace function app.dashboard_build_snapshot(p_day date)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  -- The payload shape version. Every area plan that adds a key bumps it (R-Risk 6).
  v_version constant int := 2;
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
