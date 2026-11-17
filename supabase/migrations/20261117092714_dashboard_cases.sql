-- dashboard_cases (12.4-10, D-813, D-815, CASE-22, CASE-23, EP-072, EP-073) — the owner's
-- "Atendimento" numbers per CASE. Hand-written (`--custom`), expand-only: two `create or replace`
-- statements (no table, column or policy change), sorted AFTER `*_dashboard_build_no_rewind.sql`
-- (builder v8), whose builder it replaces.
--
--   1. `app.dashboard_area_support(p_day date) jsonb`: the 20261019032741 body kept whole, with
--      - `conv` also reading `state` and `category` of the support conversation (a case);
--      - the queue (`awaiting`) counting ACTIVE cases only (`state in ('open','in_progress')`) whose
--        latest message is the member's and past the team's read mark, same `oldestHours` rule: a
--        resolved or closed case is never in the queue, as in the staff badge;
--      - NEW `bySubject`: the cases opened in Window30 by category, the five keys always present
--        (`check_in`, `events`, `payment`, `account`, `other`), counts only (EP-43);
--      - `weeklyConversations` keeps its key and counts cases opened per week (a case is a support
--        conversation: `created_at` block); `answeredByStaff` and `moderation` are unchanged.
--      The first response per case follows in `*_dashboard_cases_first_response.sql` (the second
--      file redefines this function whole, so it holds the final definition).
--      Every source predicate keeps `tenant_id = app.tenant_id()` (CASE-23); the revoke line is kept
--      verbatim: the function is executable by no role but its owner.
--   2. `app.dashboard_build_snapshot(p_day date)` v9: the 20261019111408 body copied whole with ONLY
--      `v_version` moved from 8 to 9, so the hourly dispatcher rebuilds yesterday for every tenant
--      within the hour. Its revoke/grant pair is re-stated as it was.

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
  -- Member turns started in the eight weeks, with the next staff message (null = unanswered).
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
       and (t.prev_side is null or t.prev_side = 'staff')
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
revoke all on function app.dashboard_area_support(date) from public, anon, authenticated, service_role;--> statement-breakpoint

create or replace function app.dashboard_build_snapshot(p_day date)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  -- The payload shape version. Every area plan that adds a key bumps it (R-Risk 6). 9 since 12.4-10:
  -- the support area counts cases and carries `bySubject` (8 since 08.7-12: the overview carries
  -- `enteredAtRisk`; 7 since 08.7-11: the payload carries `support`).
  v_version constant int := 9;
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
