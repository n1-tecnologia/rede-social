-- dashboard_content_functions (08.7-06, D-455, D-458, D-462, UI-D-470, UI-D-473, UI-D-484,
-- UI-D-488, UI-D-489 b, INSIGHT-10, INSIGHT-14, INSIGHT-18, INSIGHT-19; RESEARCH § O3 Conteúdo,
-- Privacy floor, Pitfalls 2, 4, 5, 8) — the owner's Conteúdo numbers, built once a day.
-- Hand-written (`--custom`), sorted AFTER `*_dashboard_activity_functions.sql` (builder v3), whose
-- builder it replaces, and after `*_dashboard_members_functions.sql`, whose action stream
-- (`app.dashboard_member_actions`) and member rows it reads.
--
-- D = the snapshot day (the tenant-local yesterday); Window30 = local days D-29..D; Prev30 =
-- D-59..D-30. Every count ends at `until_at` (local midnight of D+1): today never counts.
--
--   1. `app.dashboard_area_content(p_day date) jsonb`, ids and numbers only (PR-1):
--      - `items`: every LIVE post (`feed_posts.deleted_at is null`) and live story
--        (`stories.deleted_at is null`, by `published_at`) published in Window30, newest first
--        (`createdAt desc, id desc`). The kind: `media_kind = 'video'` → video; `gallery` with one
--        image → photo, two or more → carousel; `none` with `link_preview_id` → link, else text; a
--        story row → story. `likes` / `comments` are rows by active role-`member` authors up to
--        `until_at` (likes on the item itself; LIVE comments, root or reply), never `like_count` /
--        `comment_count`, which include staff and today (UI-D-484).
--        `commentMeta` (posts only, UI-D-489 b): a ROOT member comment is answered when a live reply
--        by a CURRENT `admin_tenant` or `support_tenant` (active membership) exists before `until_at`;
--        `answered`, `unanswered`, `oldestUnansweredHours` (floor of the hours the oldest unanswered
--        one has waited at BUILD time, null when none) and `firstReplyMedianMinutes`
--        (`percentile_cont(0.5)` of the minutes to the first staff reply, rounded; null when none).
--        `views` / `reachByBand` (stories only, null on posts): unique member viewers from
--        `story_views` up to `until_at` and their today's band (the member rows of this build).
--        TOTALS ONLY: no viewer id is ever stored or returned (PR-5, R-Pitfall 2).
--        `velocity48h`: cumulative member likes + live comments at 6, 12 … 48 hours after
--        publication, each bounded by `until_at`.
--        Associations (planning decision 3), raw here and floored by the API (D-462): each member
--        counted once, from their FIRST like or comment on the item (t0), "within 7 days after"
--        meaning [t0, t0 + 7 days) bounded by `until_at` — associations, never causes:
--        `reactivated` = interactors with no counted action in (t0 - 30 days, t0); `rsvps` = per
--        event, interactors with an RSVP "vou" (`going` / `checked_in`) answered in the 7 days;
--        `orders` = their paid orders in the 7 days (count and cents); `vitrine` (posts of an
--        EXCLUSIVE community only, i.e. linked through `store_product_communities`, else null) =
--        member paid orders of a product linked to that community while the post was the
--        community's newest live post (from its `created_at` to the next live post's).
--      - `kpis` (posts only): `posts` live posts of Window30 / Prev30; `interactions` their member
--        likes + live comments, `members` the distinct members behind them, the current window
--        counted up to `until_at`, Prev30 up to its own end (`from30_at`).
--      - `interactorsByBand`: today's band of the members behind `kpis.members.current`.
--      - `weeklyPerPost`: raw sums per 7-day block of the post's local publication day, oldest
--        first, `interactions` / `posts` the 12 blocks ending D, `previous…` the 12 before; each
--        post's interactions counted up to `until_at`.
--      - `heatmap` (UI-D-488): 7 local weekdays (Monday first) × 4 slots `[0,6) [6,12) [12,18)
--        [18,24)` local hours: every live post of Window30 lands in exactly one cell, so the cells
--        add up to the post totals; `byCommunity`: posts and interactions per community, the
--        tenant-wide feed as `communityId: null`, most interactions first.
--   2. `app.dashboard_build_snapshot(p_day date)` v4: the v3 body kept whole, the payload version
--      bumped to 4 (so the hourly dispatcher rebuilds every tenant within the hour), and
--      `'content', app.dashboard_area_content(p_day)` added to the payload, AFTER the member rows
--      are written in the same transaction (it reads their `band`).
--
-- Posture (T-08.7-05, T-08.7-07): `security definer set search_path = ''` with fully qualified
-- names; the owner bypasses RLS, so EVERY source predicate pins `tenant_id = app.tenant_id()` and
-- the member set joins on `(tenant_id, user_id)`: a shared identity's actions in another tenant
-- never count here (R-Pitfall 1). The new function is executable by no role but its owner; the
-- builder keeps its revoke/grant pair. No statement picks a single row with a LIMIT (pgTAP 040).
-- Expand-only: no table, column or policy changes.

create or replace function app.dashboard_area_content(p_day date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (
    select t.timezone as tz,
           ((p_day - 29)::timestamp at time zone t.timezone) as from30_at,
           ((p_day - 59)::timestamp at time zone t.timezone) as prev30_at,
           ((p_day - 167)::timestamp at time zone t.timezone) as from168_at,
           ((p_day + 1)::timestamp at time zone t.timezone) as until_at
      from public.tenants t
     where t.id = app.tenant_id()
  ),
  -- The counted set: active role members of this tenant (UI-D-484).
  m as (
    select ms.id, ms.user_id
      from public.memberships ms
     where ms.tenant_id = app.tenant_id()
       and ms.role = 'member'
       and ms.status = 'active'
       and ms.blocked_at is null
       and ms.deleted_at is null
  ),
  -- The member rows the builder has just written: today's band of each member.
  r as (
    select s.membership_id, s.band
      from public.dashboard_member_snapshots s
     where s.tenant_id = app.tenant_id()
  ),
  -- Live posts from D-167 (the 24 weekly blocks) to the end of D.
  p as (
    select fp.id, fp.community_id, fp.created_at, fp.media_kind, fp.link_preview_id,
           (fp.created_at at time zone b.tz) as local_at,
           (fp.created_at at time zone b.tz)::date as local_day,
           fp.created_at >= b.from30_at as in_window,
           (fp.created_at >= b.prev30_at and fp.created_at < b.from30_at) as in_prev
      from public.feed_posts fp
      cross join b
     where fp.tenant_id = app.tenant_id()
       and fp.deleted_at is null
       and fp.created_at >= b.from168_at
       and fp.created_at < b.until_at
  ),
  -- Member likes on those posts and member LIVE comments on them (root or reply), up to the end of D.
  pi as (
    select l.post_id as item_id, m.id as membership_id, l.created_at as at, true as is_like
      from public.feed_likes l
      join p on p.id = l.post_id
      join m on m.user_id = l.user_id
      cross join b
     where l.tenant_id = app.tenant_id()
       and l.created_at < b.until_at
    union all
    select c.post_id, m.id, c.created_at, false
      from public.feed_comments c
      join p on p.id = c.post_id
      join m on m.user_id = c.author_user_id
      cross join b
     where c.tenant_id = app.tenant_id()
       and c.deleted_at is null
       and c.created_at < b.until_at
  ),
  -- Live stories published in Window30.
  s as (
    select st.id, st.published_at as created_at
      from public.stories st
      cross join b
     where st.tenant_id = app.tenant_id()
       and st.deleted_at is null
       and st.published_at >= b.from30_at
       and st.published_at < b.until_at
  ),
  si as (
    select l.story_id as item_id, m.id as membership_id, l.created_at as at, true as is_like
      from public.feed_likes l
      join s on s.id = l.story_id
      join m on m.user_id = l.user_id
      cross join b
     where l.tenant_id = app.tenant_id()
       and l.created_at < b.until_at
    union all
    select c.story_id, m.id, c.created_at, false
      from public.feed_comments c
      join s on s.id = c.story_id
      join m on m.user_id = c.author_user_id
      cross join b
     where c.tenant_id = app.tenant_id()
       and c.deleted_at is null
       and c.created_at < b.until_at
  ),
  -- A story's unique member viewers (`story_views_uq`) up to the end of D, with today's band only.
  sv as (
    select v.story_id, count(*) as views,
           jsonb_build_object(
             'new', count(*) filter (where r.band = 'new'),
             'superfan', count(*) filter (where r.band = 'superfan'),
             'engaged', count(*) filter (where r.band = 'engaged'),
             'occasional', count(*) filter (where r.band = 'occasional'),
             'at_risk', count(*) filter (where r.band = 'at_risk'),
             'inactive', count(*) filter (where r.band = 'inactive')) as bands
      from public.story_views v
      join s on s.id = v.story_id
      join m on m.user_id = v.user_id
      left join r on r.membership_id = m.id
      cross join b
     where v.tenant_id = app.tenant_id()
       and v.viewed_at < b.until_at
     group by v.story_id
  ),
  -- The window's publications with their kind.
  w as (
    select p.id,
           case when p.media_kind = 'video' then 'video'
                when p.media_kind = 'gallery' then
                  case when (select count(*) from public.feed_post_media pm
                              where pm.tenant_id = app.tenant_id()
                                and pm.post_id = p.id
                                and pm.kind = 'image') >= 2
                       then 'carousel' else 'photo' end
                when p.link_preview_id is not null then 'link'
                else 'text' end as kind,
           p.community_id, p.created_at
      from p
     where p.in_window
    union all
    select s.id, 'story', null::uuid, s.created_at
      from s
  ),
  -- Every member interaction with a publication of the window.
  ii as (
    select pi.item_id, pi.membership_id, pi.at, pi.is_like
      from pi
      join p on p.id = pi.item_id
     where p.in_window
    union all
    select si.item_id, si.membership_id, si.at, si.is_like
      from si
  ),
  ic as (
    select ii.item_id,
           count(*) filter (where ii.is_like) as likes,
           count(*) filter (where not ii.is_like) as comments
      from ii
     group by ii.item_id
  ),
  -- Root member comments of the window's posts, with the first reply by current staff.
  roots as (
    select c.post_id, c.created_at,
           (select min(x.created_at)
              from public.feed_comments x
              join public.memberships st
                on st.tenant_id = app.tenant_id()
               and st.user_id = x.author_user_id
               and st.role in ('admin_tenant', 'support_tenant')
               and st.status = 'active'
               and st.blocked_at is null
               and st.deleted_at is null
             where x.tenant_id = app.tenant_id()
               and x.parent_id = c.id
               and x.deleted_at is null
               and x.created_at < b.until_at) as replied_at
      from public.feed_comments c
      join p on p.id = c.post_id and p.in_window
      join m on m.user_id = c.author_user_id
      cross join b
     where c.tenant_id = app.tenant_id()
       and c.deleted_at is null
       and c.parent_id is null
       and c.created_at < b.until_at
  ),
  meta as (
    select x.post_id,
           count(*) filter (where x.replied_at is not null) as answered,
           count(*) filter (where x.replied_at is null) as unanswered,
           floor(extract(epoch from (now() - min(x.created_at) filter (where x.replied_at is null)))
                 / 3600)::int as oldest_hours,
           round(percentile_cont(0.5) within group (
                   order by extract(epoch from (x.replied_at - x.created_at)) / 60)
                 filter (where x.replied_at is not null))::int as median_minutes
      from roots x
     group by x.post_id
  ),
  -- The 48-hour curve: cumulative interactions at 6 … 48 hours, bounded by the end of D.
  vel_points as (
    select w.id, h.h, count(ii.at) as n
      from w
      cross join b
      cross join generate_series(6, 48, 6) as h(h)
      left join ii
        on ii.item_id = w.id
       and ii.at < least(w.created_at + make_interval(hours => h.h), b.until_at)
     group by w.id, h.h
  ),
  vel as (
    select v.id, jsonb_agg(v.n order by v.h) as v
      from vel_points v
     group by v.id
  ),
  -- Associations (planning decision 3): each member once, from their first interaction t0.
  ft as (
    select ii.item_id, ii.membership_id, min(ii.at) as t0
      from ii
     group by ii.item_id, ii.membership_id
  ),
  acts as (
    select x.membership_id, x.at
      from app.dashboard_member_actions(p_day - 61, p_day) x
  ),
  recent as (
    select distinct ft.item_id, ft.membership_id
      from ft
      join acts a
        on a.membership_id = ft.membership_id
       and a.at < ft.t0
       and a.at > ft.t0 - interval '30 days'
  ),
  react as (
    select ft.item_id, count(*) as n
      from ft
      left join recent re on re.item_id = ft.item_id and re.membership_id = ft.membership_id
     where re.membership_id is null
     group by ft.item_id
  ),
  rsvp as (
    select ft.item_id, ea.event_id, count(distinct ft.membership_id) as members
      from ft
      join m on m.id = ft.membership_id
      cross join b
      join public.event_attendances ea
        on ea.tenant_id = app.tenant_id()
       and ea.user_id = m.user_id
       and ea.status in ('going', 'checked_in')
       and ea.responded_at >= ft.t0
       and ea.responded_at < least(ft.t0 + interval '7 days', b.until_at)
      join public.events e
        on e.id = ea.event_id
       and e.tenant_id = app.tenant_id()
       and e.deleted_at is null
     group by ft.item_id, ea.event_id
  ),
  rsvp_list as (
    select x.item_id,
           jsonb_agg(jsonb_build_object('eventId', x.event_id, 'members', x.members)
                     order by x.members desc, x.event_id) as v
      from rsvp x
     group by x.item_id
  ),
  ord as (
    select ft.item_id, count(*) as n, coalesce(sum(o.amount_cents), 0) as cents
      from ft
      join m on m.id = ft.membership_id
      cross join b
      join public.store_orders o
        on o.tenant_id = app.tenant_id()
       and o.user_id = m.user_id
       and o.status = 'paid'
       and o.paid_at >= ft.t0
       and o.paid_at < least(ft.t0 + interval '7 days', b.until_at)
     group by ft.item_id
  ),
  linked as (
    select distinct l.community_id, l.product_id
      from public.store_product_communities l
     where l.tenant_id = app.tenant_id()
  ),
  -- The vitrine: member paid orders of a linked product while the post was its community's newest.
  vit as (
    select w.id,
           (select count(*)
              from public.store_orders o
              join m on m.user_id = o.user_id
             where o.tenant_id = app.tenant_id()
               and o.status = 'paid'
               and o.paid_at >= w.created_at
               and o.paid_at < least(b.until_at, coalesce(
                     (select min(n.created_at)
                        from public.feed_posts n
                       where n.tenant_id = app.tenant_id()
                         and n.community_id = w.community_id
                         and n.deleted_at is null
                         and (n.created_at, n.id) > (w.created_at, w.id)),
                     'infinity'::timestamptz))
               and exists (select 1 from linked k
                            where k.community_id = w.community_id and k.product_id = o.product_id)) as n
      from w
      cross join b
     where w.kind <> 'story'
       and w.community_id is not null
       and exists (select 1 from linked k where k.community_id = w.community_id)
  ),
  items as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', w.id,
             'kind', w.kind,
             'communityId', w.community_id,
             'createdAt', to_char(w.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             'likes', coalesce(ic.likes, 0),
             'comments', coalesce(ic.comments, 0),
             'commentMeta', case when w.kind = 'story' then null else jsonb_build_object(
               'answered', coalesce(mt.answered, 0),
               'unanswered', coalesce(mt.unanswered, 0),
               'oldestUnansweredHours', mt.oldest_hours,
               'firstReplyMedianMinutes', mt.median_minutes) end,
             'views', case when w.kind = 'story' then coalesce(sv.views, 0) end,
             'reachByBand', case when w.kind = 'story' then coalesce(sv.bands,
               '{"new": 0, "superfan": 0, "engaged": 0, "occasional": 0, "at_risk": 0, "inactive": 0}'::jsonb) end,
             'velocity48h', vel.v,
             'reactivated', coalesce(rc.n, 0),
             'rsvps', coalesce(rl.v, '[]'::jsonb),
             'orders', jsonb_build_object('count', coalesce(od.n, 0), 'cents', coalesce(od.cents, 0)),
             'vitrine', vt.n)
           order by w.created_at desc, w.id desc), '[]'::jsonb) as v
      from w
      left join ic on ic.item_id = w.id
      left join meta mt on mt.post_id = w.id
      left join sv on sv.story_id = w.id
      left join vel on vel.id = w.id
      left join react rc on rc.item_id = w.id
      left join rsvp_list rl on rl.item_id = w.id
      left join ord od on od.item_id = w.id
      left join vit vt on vt.id = w.id
  ),
  -- Each post with its interactions (up to the end of D), for the trend, the heatmap, the communities.
  pp as (
    select p.id, p.community_id, p.local_at, p.local_day, p.in_window, coalesce(x.n, 0) as n
      from p
      left join (select pi.item_id, count(*) as n from pi group by pi.item_id) x on x.item_id = p.id
  ),
  kpis as (
    select jsonb_build_object(
             'posts', jsonb_build_object(
               'current', (select count(*) from p where p.in_window),
               'previous', (select count(*) from p where p.in_prev)),
             'interactions', jsonb_build_object(
               'current', (select count(*) from pi join p on p.id = pi.item_id where p.in_window),
               'previous', (select count(*) from pi join p on p.id = pi.item_id cross join b
                             where p.in_prev and pi.at < b.from30_at)),
             'members', jsonb_build_object(
               'current', (select count(distinct pi.membership_id)
                             from pi join p on p.id = pi.item_id where p.in_window),
               'previous', (select count(distinct pi.membership_id)
                              from pi join p on p.id = pi.item_id cross join b
                             where p.in_prev and pi.at < b.from30_at))) as v
  ),
  interactors as (
    select jsonb_build_object(
             'new', count(*) filter (where r.band = 'new'),
             'superfan', count(*) filter (where r.band = 'superfan'),
             'engaged', count(*) filter (where r.band = 'engaged'),
             'occasional', count(*) filter (where r.band = 'occasional'),
             'at_risk', count(*) filter (where r.band = 'at_risk'),
             'inactive', count(*) filter (where r.band = 'inactive')) as v
      from (select distinct pi.membership_id
              from pi join p on p.id = pi.item_id
             where p.in_window) x
      left join r on r.membership_id = x.membership_id
  ),
  -- 24 blocks of 7 local days by publication day: 23 = D-6..D, 0 = D-167..D-161.
  weekly as (
    select jsonb_build_object(
             'interactions', jsonb_agg(coalesce(y.n, 0) order by k.j) filter (where k.j >= 12),
             'posts', jsonb_agg(coalesce(y.posts, 0) order by k.j) filter (where k.j >= 12),
             'previousInteractions', jsonb_agg(coalesce(y.n, 0) order by k.j) filter (where k.j < 12),
             'previousPosts', jsonb_agg(coalesce(y.posts, 0) order by k.j) filter (where k.j < 12)) as v
      from generate_series(0, 23) as k(j)
      left join (
        select 23 - (p_day - pp.local_day) / 7 as j, count(*) as posts, sum(pp.n) as n
          from pp
         group by 1
      ) y on y.j = k.j
  ),
  heat as (
    select jsonb_agg(jsonb_build_object(
             'weekday', (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[d.d],
             'fromHour', sl.sl * 6,
             'toHour', sl.sl * 6 + 6,
             'posts', coalesce(x.posts, 0),
             'interactions', coalesce(x.n, 0))
           order by d.d, sl.sl) as v
      from generate_series(1, 7) as d(d)
      cross join generate_series(0, 3) as sl(sl)
      left join (
        select extract(isodow from pp.local_at)::int as d,
               extract(hour from pp.local_at)::int / 6 as sl,
               count(*) as posts, sum(pp.n) as n
          from pp
         where pp.in_window
         group by 1, 2
      ) x on x.d = d.d and x.sl = sl.sl
  ),
  by_community as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'communityId', x.community_id, 'posts', x.posts, 'interactions', x.n)
           order by x.n desc, x.posts desc, x.community_id nulls first), '[]'::jsonb) as v
      from (select pp.community_id, count(*) as posts, sum(pp.n) as n
              from pp
             where pp.in_window
             group by pp.community_id) x
  )
  select jsonb_build_object(
           'items', (select v from items),
           'kpis', (select v from kpis),
           'interactorsByBand', (select v from interactors),
           'weeklyPerPost', (select v from weekly),
           'heatmap', (select v from heat),
           'byCommunity', (select v from by_community))
$$;--> statement-breakpoint
revoke all on function app.dashboard_area_content(date) from public, anon, authenticated, service_role;--> statement-breakpoint

create or replace function app.dashboard_build_snapshot(p_day date)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  -- The payload shape version. Every area plan that adds a key bumps it (R-Risk 6). 4 since 08.7-06:
  -- the payload carries `content`.
  v_version constant int := 4;
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
      'content', app.dashboard_area_content(p_day))
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
