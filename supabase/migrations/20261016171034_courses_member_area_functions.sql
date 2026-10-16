-- courses_member_area_functions (08.6-01, SC 1, SC 4, COURSE-29, COURSE-37, COURSE-51, COURSE-52;
-- D-437, D-440, D-441, D-443; RESEARCH Patterns 1 and 3, Pitfalls 8 and 9) — the member area's two
-- read functions. Hand-written (`--custom`), sorted BEFORE `*_courses_member_area.sql` (the
-- generated reminder table): neither function reads that table, and every later migration of the
-- phase that reads `course_live_reminders` sorts after the generated one (EP-73).
--
--   1. `app.course_member_lessons()` — THE member projection (R-Pattern 1): one row per LIVE
--      lesson of every PUBLISHED course of the caller's tenant (D-426), through
--      `cross join lateral app.course_lesson_states(c.id)`, so the overview, the tracks and the
--      progress reads derive every number from the ONE evaluator the routes, the progress RLS and
--      the asset gate already ask (COURSE-22): its lock reason (the staff branch, the purchase,
--      the module and lesson rules), the caller's own `completed_at`, the caller's own
--      `course_lesson_progress.updated_at` as `touched_at` ("last touched", the hero's input), the
--      ready video's seconds (null without a ready video) and the lesson's `created_at`. Titles
--      only (D-423): no description, video asset id, material, thumbnail or external URL is a
--      column (pgTAP 196 pins the result signature). A null or unknown `tenant_role` claim takes
--      the evaluator's member branch (fails closed).
--   2. `app.course_member_streak() int` — the study streak (D-440, D-441, D-443): the caller's OWN
--      completions (`completed_at` is one-way, D-427, so the history is complete — completions in
--      courses that are now archived count too), bucketed by the TENANT's local date
--      (`completed_at at time zone tenants.timezone`, never UTC and never the client's clock), and
--      the length of the consecutive-date run ending at the anchor: the tenant-local today when it
--      has a completion, else yesterday (the streak survives until the end of the next day); 0 with
--      no anchor. The `admin_tenant` claim answers 0 explicitly (D-422: the preview writes no rows,
--      08.6-01 planning decision 5). It takes NO argument: no route can pass a streak or a date.
--      `now()` is the transaction's instant, so two calls in one transaction agree.
--
-- Hardening (the T-06-29 / T-08.2-22 posture, T-08.6-01, T-08.6-11): both functions are
-- `language sql stable security definer set search_path = ''` with fully qualified names. The owner
-- bypasses RLS, so EVERY statement pins `tenant_id = app.tenant_id()` itself: a lane with no tenant
-- claim gets zero rows and a 0 streak. EXECUTE is revoked from PUBLIC and granted to `authenticated`
-- only. No statement picks a single row with a LIMIT (pgTAP 040's allow-list). Expand-only: nothing
-- here alters a table, a column or a policy (EP-77), so the 08.5 API keeps serving during the
-- 08.6 rollout.

create or replace function app.course_member_lessons()
returns table (
  course_id uuid,
  module_id uuid,
  lesson_id uuid,
  course_seq int,
  module_seq int,
  lesson_title text,
  module_title text,
  is_free boolean,
  duration_seconds int,
  lock_reason text,
  completed_at timestamptz,
  touched_at timestamptz,
  lesson_created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select c.id,
         s.module_id,
         s.lesson_id,
         s.course_seq,
         s.module_seq,
         l.title,
         m.title,
         l.is_free,
         case when a.status = 'ready' then coalesce(a.duration_seconds, 0) end,
         s.lock_reason,
         s.completed_at,
         p.updated_at,
         l.created_at
    from public.courses c
    cross join lateral app.course_lesson_states(c.id) s
    join public.course_lessons l
      on l.id = s.lesson_id and l.tenant_id = c.tenant_id
    join public.course_modules m
      on m.id = s.module_id and m.tenant_id = c.tenant_id
    left join public.media_assets a
      on a.id = l.video_asset_id and a.tenant_id = l.tenant_id and a.deleted_at is null
    left join public.course_lesson_progress p
      on p.tenant_id = l.tenant_id and p.lesson_id = l.id and p.user_id = app.user_id()
   where c.tenant_id = app.tenant_id()
     and c.status = 'published'
   order by c.id, s.course_seq
$$;
--> statement-breakpoint
revoke all on function app.course_member_lessons() from public;--> statement-breakpoint
grant execute on function app.course_member_lessons() to authenticated;--> statement-breakpoint

create or replace function app.course_member_streak() returns int
language sql stable security definer set search_path = '' as $$
  with tz as (
    select t.timezone
      from public.tenants t
     where t.id = app.tenant_id()
  ), days as (
    select distinct (p.completed_at at time zone tz.timezone)::date as day
      from public.course_lesson_progress p
     cross join tz
     where p.tenant_id = app.tenant_id()
       and p.user_id = app.user_id()
       and p.completed_at is not null
  ), today as (
    select (now() at time zone tz.timezone)::date as d
      from tz
  ), anchor as (
    select case
             when exists (select 1 from days where days.day = today.d) then today.d
             when exists (select 1 from days where days.day = today.d - 1) then today.d - 1
           end as s
      from today
  ), islands as (
    select days.day, days.day - (row_number() over (order by days.day))::int as grp
      from days
  )
  select case
           when app.tenant_role() = 'admin_tenant' then 0
           else coalesce((
             select count(*)::int
               from islands i
              where i.grp = (select i2.grp
                               from islands i2
                               join anchor on i2.day = anchor.s)), 0)
         end
$$;
--> statement-breakpoint
revoke all on function app.course_member_streak() from public;--> statement-breakpoint
grant execute on function app.course_member_streak() to authenticated;
