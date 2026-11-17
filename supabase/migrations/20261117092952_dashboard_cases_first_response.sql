-- dashboard_cases_first_response (12.4-10, D-815, CASE-22) — the first response per CASE.
-- Hand-written (`--custom`), expand-only, sorted AFTER `*_dashboard_cases.sql`, whose area function it
-- redefines WHOLE with `create or replace` (an applied migration is never edited): THIS file holds the
-- final definition of `app.dashboard_area_support(p_day date)`.
--
-- The only change from `*_dashboard_cases.sql`: the `turns` CTE keeps the case's FIRST member message
-- (`prev_side is null and author_side = 'member'`) instead of every member turn, so
-- `weeklyMedianMinutes` holds one first-response sample per case, bucketed by the week of the case's
-- first message; `weeklyConversations` (cases opened per week), the queue, `bySubject`,
-- `answeredByStaff` and `moderation` are untouched. Every source predicate still pins
-- `tenant_id = app.tenant_id()` (CASE-23); the revoke line is kept verbatim (no role but the owner).
-- The payload version stays 9: the shape is unchanged, and nobody has a v9 snapshot built under the
-- per-turn rule outside the local stack.

create or replace function app.dashboard_area_support(p_day date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (
    select t.timezone as tz,
           ((p_day - 55)::timestamp at time zone t.timezone) as from56_at,
           ((p_day - 29)::timestamp at time zone t.timezone) as from30_at,
           ((p_day + 1)::timestamp at time zone t.timezone) as until_at
      from public.tenants t
     where t.id = app.tenant_id()
  ),
  conv as (
    select c.id, c.created_at, c.last_message_side, c.last_seq, c.staff_last_read_seq,
           c.last_message_at, c.state, c.category
      from public.chat_conversations c
     where c.tenant_id = app.tenant_id()
       and c.kind = 'support'
  ),
  -- The queue at build time: the inbox rule, and since when each waits.
  waiting as (
    select cv.id,
           coalesce((select min(m.created_at)
                       from public.chat_messages m
                      where m.tenant_id = app.tenant_id()
                        and m.conversation_id = cv.id
                        and m.author_side = 'member'
                        and m.deleted_at is null
                        and m.seq > cv.staff_last_read_seq),
                    cv.last_message_at, now()) as since
      from conv cv
     where cv.state in ('open', 'in_progress')
       and cv.last_message_side = 'member'
       and cv.last_seq > cv.staff_last_read_seq
  ),
  awaiting as (
    select jsonb_build_object(
             'count', count(*)::int,
             'oldestHours', case when count(*) = 0 then null
                                 else greatest(floor(extract(epoch from now() - min(w.since)) / 3600), 0)::int
                            end) as v
      from waiting w
  ),
  -- Live messages of the support conversations before the end of D, with the previous side.
  msgs as (
    select m.conversation_id, m.seq, m.created_at, m.author_side, m.author_user_id,
           lag(m.author_side) over (partition by m.conversation_id order by m.seq) as prev_side
      from public.chat_messages m
      join conv cv on cv.id = m.conversation_id
      cross join b
     where m.tenant_id = app.tenant_id()
       and m.deleted_at is null
       and m.created_at < b.until_at
  ),
  -- D-815 / CASE-22: ONE sample per CASE. A case's first response starts at its first live message
  -- when that is the member's (`prev_side is null`: the case's `seq = 1` message unless it was
  -- deleted) and ends at the first staff message after it (null = unanswered). The sample is bucketed
  -- by the week of that first message, in the eight weeks. Later member turns of the same case are
  -- no samples (the per-turn rule of 08.7-11 is gone); an unanswered case enters no median (it is
  -- the queue).
  turns as (
    select 7 - ((p_day - (t.created_at at time zone b.tz)::date) / 7) as i,
           t.created_at as started_at,
           (select min(s.created_at) from msgs s
             where s.conversation_id = t.conversation_id
               and s.seq > t.seq
               and s.author_side = 'staff') as answered_at
      from msgs t
      cross join b
     where t.author_side = 'member'
       and t.prev_side is null
       and t.created_at >= b.from56_at
  ),
  med as (
    select t.i,
           round((percentile_cont(0.5) within group (
             order by extract(epoch from t.answered_at - t.started_at) / 60))::numeric)::int as v
      from turns t
     where t.answered_at is not null
     group by t.i
  ),
  wc as (
    select 7 - ((p_day - (cv.created_at at time zone b.tz)::date) / 7) as i, count(*)::int as n
      from conv cv
      cross join b
     where cv.created_at >= b.from56_at
       and cv.created_at < b.until_at
     group by 1
  ),
  weeks as (
    select jsonb_agg(to_jsonb(med.v) order by g.i) as medians,
           jsonb_agg(coalesce(wc.n, 0) order by g.i) as conversations
      from generate_series(0, 7) as g(i)
      left join med on med.i = g.i
      left join wc on wc.i = g.i
  ),
  -- D-813 / D-815: the cases OPENED in Window30 (the team block's own window, `from30_at` to the end
  -- of D in the tenant's timezone) by category. All five keys are always present (zero allowed); a
  -- value outside the five cannot exist (the table CHECK) and would be counted nowhere. Counts only
  -- (EP-43): no subject, no message text, no member.
  by_subject as (
    select jsonb_build_object(
             'check_in', count(*) filter (where cv.category = 'check_in')::int,
             'events', count(*) filter (where cv.category = 'events')::int,
             'payment', count(*) filter (where cv.category = 'payment')::int,
             'account', count(*) filter (where cv.category = 'account')::int,
             'other', count(*) filter (where cv.category = 'other')::int) as v
      from conv cv
      cross join b
     where cv.created_at >= b.from30_at
       and cv.created_at < b.until_at
  ),
  -- Current staff of this tenant (planning decision 3).
  staff as (
    select distinct ms.user_id
      from public.memberships ms
     where ms.tenant_id = app.tenant_id()
       and ms.role in ('admin_tenant', 'support_tenant')
       and ms.status = 'active'
       and ms.blocked_at is null
       and ms.deleted_at is null
  ),
  answered as (
    select m.author_user_id as user_id, count(distinct m.conversation_id)::int as n
      from msgs m
      join staff s on s.user_id = m.author_user_id
      cross join b
     where m.author_side = 'staff'
       and m.created_at >= b.from30_at
     group by m.author_user_id
  ),
  team as (
    select coalesce(jsonb_agg(jsonb_build_object('userId', a.user_id, 'conversations', a.n)
                              order by a.n desc, a.user_id), '[]'::jsonb) as v
      from answered a
  ),
  modlog as (
    select count(*) filter (where ml.action = 'comment_removed')::int as removed,
           count(*) filter (where ml.action = 'member_blocked')::int as blocks,
           count(*) filter (where ml.action = 'member_unblocked')::int as unblocks
      from public.moderation_log ml
      cross join b
     where ml.tenant_id = app.tenant_id()
       and ml.created_at >= b.from30_at
       and ml.created_at < b.until_at
  ),
  com as (
    select count(*)::int as n
      from public.feed_comments fc
      cross join b
     where fc.tenant_id = app.tenant_id()
       and fc.deleted_at is null
       and fc.created_at >= b.from30_at
       and fc.created_at < b.until_at
  )
  select jsonb_build_object(
           'awaiting', (select awaiting.v from awaiting),
           'weeklyMedianMinutes', (select weeks.medians from weeks),
           'weeklyConversations', (select weeks.conversations from weeks),
           'answeredByStaff', (select team.v from team),
           'bySubject', (select by_subject.v from by_subject),
           'moderation', jsonb_build_object(
             'removedComments', (select modlog.removed from modlog),
             'blocks', (select modlog.blocks from modlog),
             'unblocks', (select modlog.unblocks from modlog),
             'comments30', (select com.n from com)))
$$;--> statement-breakpoint
revoke all on function app.dashboard_area_support(date) from public, anon, authenticated, service_role;
