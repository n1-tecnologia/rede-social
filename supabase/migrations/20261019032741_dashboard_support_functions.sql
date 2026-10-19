-- dashboard_support_functions (08.7-11, D-455, D-460, D-461, D-465, UI-D-480, UI-D-481, INSIGHT-06,
-- INSIGHT-13, INSIGHT-18, EP-42, EP-43; RESEARCH § O6 Atendimento, Pitfalls 1, 5, 12) — the owner's
-- Atendimento numbers, built once a day. Hand-written (`--custom`), sorted AFTER
-- `*_dashboard_finance_functions.sql` (builder v6), whose builder it replaces.
--
-- D = the snapshot day (the tenant-local yesterday); Window30 = local days D-29..D; the eight weekly
-- blocks are local days D-55..D-49, …, D-6..D (oldest first); `until_at` = local midnight of D+1
-- (today 00:00 local).
--
--   1. `app.dashboard_area_support(p_day date) jsonb`: counts, minutes and staff user ids only
--      (PR-1, EP-43: no message text, no member name, no member id). Only `kind = 'support'`
--      conversations; deleted messages are ignored everywhere.
--      - `awaiting { count, oldestHours }` at BUILD time (the queue "na última atualização",
--        UI-D-480): conversations whose latest message is the member's and is past the team's
--        shared read mark (`last_message_side = 'member' and last_seq > staff_last_read_seq`, the
--        inbox rule of `packages/modules/chat/server/service.ts`). `oldestHours` = whole hours from
--        the first unread live member message of the longest wait to `now()`; null when nobody
--        waits;
--      - `weeklyMedianMinutes[8]` (planning decision 1): a member TURN starts at the first member
--        message after the last staff message (or the conversation's first message); its response
--        time is the minutes to the next staff message before `until_at`. Each block's median
--        (`percentile_cont(0.5)`, rounded to minutes) of the turns STARTED in it; null for a block
--        with no answered turn (never 0, UI-D-481). Unanswered turns never enter a median (they
--        are the queue). The member detail's support counts (08.7-04) use the same turn;
--      - `weeklyConversations[8]`: support conversations by `created_at` block;
--      - `answeredByStaff` (planning decision 3): per user holding a CURRENT `admin_tenant` or
--        `support_tenant` membership (active, not blocked, not deleted), the distinct support
--        conversations with a live staff message by them in Window30, most first (ties by user
--        id). Names are NOT stored: the API joins them live;
--      - `moderation { removedComments, blocks, unblocks, comments30 }`: `moderation_log` rows of
--        Window30 by action (`role_changed` ignored), and the tenant's live comments (post and story,
--        `deleted_at is null`) created in Window30 — the removal rate's denominator.
--      Every `jsonb_agg` carries an explicit `order by` (EP-40).
--   2. `app.dashboard_build_snapshot(p_day date)` v7: the v6 body kept whole, the payload version
--      bumped to 7 (so the hourly dispatcher rebuilds every tenant within the hour), and
--      `'support', app.dashboard_area_support(p_day)` added to the payload. The area is built for
--      every tenant; the route answers 404 `MODULE_DISABLED` while `chat` is off (D-460).
--
-- Posture (T-08.7-01, T-08.7-23): `security definer set search_path = ''` with fully qualified
-- names; the owner bypasses RLS, so EVERY source predicate pins `tenant_id = app.tenant_id()`: a
-- shared identity's conversations and staff memberships in another tenant never count here
-- (R-Pitfall 1). The new function is executable by no role but its owner; the builder keeps its
-- revoke/grant pair. No statement picks a single row with a LIMIT (pgTAP 040). Expand-only: no
-- table, column or policy changes.

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
           c.last_message_at
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
     where cv.last_message_side = 'member'
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
  -- The payload shape version. Every area plan that adds a key bumps it (R-Risk 6). 7 since 08.7-11:
  -- the payload carries `support`.
  v_version constant int := 7;
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
