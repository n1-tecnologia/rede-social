-- dashboard_activity_keeps_deleted_events (09.3-04, D-550, D-548 [informational], D-214
-- [informational], PEND-01, PEND-02) — the member's "Sua atividade" attendance tile keeps counting a
-- deleted event's answers and check-ins. Hand-written (`--custom`), sorted AFTER
-- `*_dashboard_activity_functions.sql`, whose `app.dashboard_member_activity(date)` it replaces.
--
-- WHY. An admin can now delete any event (`DELETE /v1/events/{id}` soft-deletes it by filling
-- `events.deleted_at`). D-550 says the member's own numbers keep counting what the member did, so a
-- deleted event must still count in `attendance { attended, events }`. The research proved the `att`
-- CTE excluded `e.deleted_at is not null`; D-550's intent wins over its "no member-side query
-- changes" wording, so this file removes that ONE predicate. A cancelled event still does not count
-- (`e.status = 'active'` stays), and the window predicates and the `m` join are untouched. The
-- engagement bands (`app.dashboard_member_actions`) have no join to `events` and already count.
--
-- EXPAND-ONLY. The same signature `app.dashboard_member_activity(date)`, `create or replace`, no
-- table, column or policy touched. The payload shape is unchanged, so there is no version bump: the
-- next nightly build simply counts a deleted event again. An old API on the new database keeps
-- working. `create or replace` keeps the owner and the security attributes it is given here, and the
-- trailing `revoke all` re-states that no role but the owner can execute it (T-09.3-22).
-- It reaches every tenant project through the ledgered `migrateAll` (D-544 [informational]).
--
-- The function below is `20261018225848_dashboard_activity_functions.sql` byte for byte, minus the
-- line `and e.deleted_at is null` in the `att` CTE.

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
revoke all on function app.dashboard_member_activity(date) from public, anon, authenticated, service_role;
