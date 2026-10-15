-- courses_member_functions (08.5-01, SC 1-3, COURSE-18..22, COURSE-26; D-423, D-426, D-428, D-429,
-- D-430, D-431, D-433; RESEARCH Patterns 1, 3, 5, Code Examples 1-3, Pitfalls 1, 2, 8, 11) — the
-- courses module's member function family: ONE lock evaluator, ONE access answer, the titles-only
-- projections and the body of the kernel course asset gate. Hand-written (`--custom`), sorted AFTER
-- `*_courses_member_columns.sql` (SQL-language bodies are validated at creation and read
-- `course_lessons.requires_previous`) and BEFORE `*_courses_progress_open_lesson.sql` (whose policy
-- expression calls statement 2). In this order, each a dependency of the next:
--
--   1. `app.course_lesson_states(p_course uuid)` — THE evaluator (D-428, D-429). One row per LIVE
--      lesson of the course (lesson and module `deleted_at is null`): its course order (`course_seq`,
--      `row_number` over module position, module id, lesson position, lesson id), its module rank
--      among NON-EMPTY live modules (`module_seq`, so an empty module never gates, R-A3), the
--      caller's own progress, and its lock reason, decided in this order:
--        staff claim (`admin_tenant`, `support_tenant`)                          -> NULL (never locked)
--        course in `app.course_locked_ids()` and lesson not free                 -> 'purchase'
--        lesson free (D-429: a free lesson ignores the sequence lock)            -> NULL
--        module rule, `module_seq > 1`, the previous non-empty module not done   -> 'module'
--        lesson rule, `course_seq > 1`, the previous live lesson not complete    -> 'lesson'
--        otherwise                                                               -> NULL
--      A null or unknown `tenant_role` claim takes the member branch (fails closed, T-08.3-04). The
--      `seq > 1` guards make a stale rule on the first lesson or module harmless. A completion
--      recorded before a rule was switched on stays complete (R-A4): the ledger is never rewritten.
--   2. `app.course_lesson_access(p_lesson uuid) text` — the one answer every caller asks (the learn
--      routes, the progress `with check`, the asset gate): 'missing' for a lesson that is not live in
--      the caller's tenant (soft-deleted, under a soft-deleted module, foreign, unknown); NULL when
--      the LIVE door opens (a non-cancelled live of the tenant replays it and is not in
--      `app.live_locked_ids()`, D-433 — it ignores the course's status and sequence); 'missing' when
--      the course is not `published` (D-426, every role); else the course door: the evaluator's
--      reason with 'module' and 'lesson' collapsed to 'sequence' (the 409 vocabulary).
--   3. `app.course_outline(p_course uuid)` — the curriculum as TITLES (D-423): zero rows unless the
--      course is a `published` course of the caller's tenant; per live lesson its module's title,
--      position, number and rule, its own title, position, number, free flag, rule, ready duration,
--      whether it has a video, and the evaluator's reason and the caller's progress. Never a
--      description, a video asset id, a material or a thumbnail (R-Pitfall 8: explicit columns
--      only; pgTAP 195 pins the result signature).
--   4. `app.course_lesson_content(p_lesson uuid)` — the lesson's content (description, video asset
--      id and status, duration), ONE row only when statement 2 answers NULL, else zero rows.
--   5. `app.course_lesson_material_list(p_lesson uuid)` — the lesson's ready, live materials in
--      `position, id` order, only when statement 2 answers NULL.
--   6. `app.course_live_cards(p_live uuid default null)` — the tenant's lives (or the one asked) as
--      agenda cards (D-431): title, description, cover, times, `cancelled_at`, `locked` (the live
--      seam) and `has_replay` (the replay lesson is live under a live module). Never the paid room
--      link and never the replay lesson's id: an open live's link is read through the lane, where
--      the restrictive live gate stays the structural guard.
--   7. `app.course_catalogue_stats()` — per `published` course of the tenant: its live lessons under
--      live modules, the sum of their ready videos' seconds, and the caller's completed rows among
--      them (the lane cannot count a locked course's paid lessons; D-421, D-430).
--   8. `app.course_asset_hidden(p_asset uuid)` — the COURSES body of the kernel stub declared by
--      `*_course_asset_gate_seam.sql` (same signature, same OID; COURSE-20, closes T-08.3-05 and
--      T-08.3-08): staff -> false; an asset is GOVERNED when it is a `purpose = 'lesson'` asset of
--      the tenant or the material of a live lesson of the tenant, and a governed asset is hidden
--      unless at least one live lesson holding it (as its video or as a material) answers
--      statement 2 NULL. So a lesson video no live lesson holds (detached, or its lesson or module
--      removed) is refused to members by remembered id, and an ungoverned asset answers false.
--
-- Both restrictive policies (`course_lessons_course_gate`, `course_lives_live_gate`) are UNCHANGED:
-- the member read goes through these projections, never through a looser policy (D-423, D-431).
--
-- Hardening (the T-06-29 / T-08.2-22 posture): every function is `language sql stable security
-- definer set search_path = ''` with fully qualified names. The owner bypasses RLS, so EVERY
-- statement pins `tenant_id = app.tenant_id()` itself: an id of another tenant matches no row and a
-- lane with no tenant claim gets nothing. The lock seams are always read as
-- `coalesce((select app.f()), '{}'::uuid[])` (RESEARCH Pitfall 2: the bare form is the subquery
-- form of ALL). EXECUTE is revoked from PUBLIC and granted to `authenticated` only. No statement
-- picks a single row with a LIMIT (pgTAP 040's allow-list). Expand-only: nothing here alters a
-- table or a policy.

create or replace function app.course_lesson_states(p_course uuid)
returns table (
  lesson_id uuid,
  module_id uuid,
  course_seq int,
  module_seq int,
  lock_reason text,
  completed_at timestamptz,
  last_position_seconds int
)
language sql stable security definer set search_path = '' as $$
  with live as (
    select l.id,
           l.module_id,
           l.is_free,
           l.requires_previous as lesson_rule,
           m.requires_previous as module_rule,
           row_number() over (order by m.position, m.id, l.position, l.id)::int as course_seq,
           dense_rank() over (order by m.position, m.id)::int as module_seq,
           p.completed_at,
           coalesce(p.last_position_seconds, 0)::int as last_position
      from public.course_lessons l
      join public.course_modules m
        on m.id = l.module_id and m.tenant_id = l.tenant_id and m.deleted_at is null
      left join public.course_lesson_progress p
        on p.tenant_id = l.tenant_id and p.lesson_id = l.id and p.user_id = app.user_id()
     where l.tenant_id = app.tenant_id()
       and l.course_id = p_course
       and l.deleted_at is null
  ), ordered as (
    select x.*,
           lag(x.completed_at is not null) over (order by x.course_seq) as previous_done
      from live x
  ), modules_done as (
    select x.module_seq, bool_and(x.completed_at is not null) as all_done
      from live x
     group by x.module_seq
  )
  select o.id,
         o.module_id,
         o.course_seq,
         o.module_seq,
         case
           when app.tenant_role() in ('admin_tenant', 'support_tenant') then null
           when not o.is_free
                and p_course = any (coalesce((select app.course_locked_ids()), '{}'::uuid[]))
             then 'purchase'
           when o.is_free then null
           when o.module_rule and o.module_seq > 1 and not coalesce(d.all_done, true) then 'module'
           when o.lesson_rule and o.course_seq > 1 and not coalesce(o.previous_done, true) then 'lesson'
           else null
         end,
         o.completed_at,
         o.last_position
    from ordered o
    left join modules_done d on d.module_seq = o.module_seq - 1
   order by o.course_seq
$$;
--> statement-breakpoint
revoke all on function app.course_lesson_states(uuid) from public;--> statement-breakpoint
grant execute on function app.course_lesson_states(uuid) to authenticated;--> statement-breakpoint

create or replace function app.course_lesson_access(p_lesson uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
           when l.id is null then 'missing'
           when exists (
                  select 1
                    from public.course_lives v
                   where v.tenant_id = app.tenant_id()
                     and v.replay_lesson_id = l.id
                     and v.cancelled_at is null
                     and v.id <> all (coalesce((select app.live_locked_ids()), '{}'::uuid[])))
             then null
           when c.status is distinct from 'published' then 'missing'
           else (
             select case s.lock_reason when 'module' then 'sequence'
                                       when 'lesson' then 'sequence'
                                       else s.lock_reason end
               from app.course_lesson_states(l.course_id) s
              where s.lesson_id = l.id)
         end
    from (select 1) as one
    left join public.course_lessons l
      on l.id = p_lesson
     and l.tenant_id = app.tenant_id()
     and l.deleted_at is null
     and exists (select 1
                   from public.course_modules m
                  where m.id = l.module_id and m.tenant_id = l.tenant_id and m.deleted_at is null)
    left join public.courses c
      on c.id = l.course_id and c.tenant_id = l.tenant_id
$$;
--> statement-breakpoint
revoke all on function app.course_lesson_access(uuid) from public;--> statement-breakpoint
grant execute on function app.course_lesson_access(uuid) to authenticated;--> statement-breakpoint

create or replace function app.course_outline(p_course uuid)
returns table (
  module_id uuid,
  module_title text,
  module_position int,
  module_number int,
  module_requires_previous boolean,
  lesson_id uuid,
  lesson_title text,
  lesson_position int,
  lesson_number int,
  course_seq int,
  is_free boolean,
  requires_previous boolean,
  duration_seconds int,
  has_video boolean,
  lock_reason text,
  completed_at timestamptz,
  last_position_seconds int
)
language sql stable security definer set search_path = '' as $$
  select m.id,
         m.title,
         m.position,
         s.module_seq,
         m.requires_previous,
         l.id,
         l.title,
         l.position,
         (row_number() over (partition by s.module_seq order by s.course_seq))::int,
         s.course_seq,
         l.is_free,
         l.requires_previous,
         case when a.status = 'ready' then coalesce(a.duration_seconds, 0) end,
         l.video_asset_id is not null,
         s.lock_reason,
         s.completed_at,
         s.last_position_seconds
    from public.courses c
    join app.course_lesson_states(p_course) s on true
    join public.course_lessons l
      on l.id = s.lesson_id and l.tenant_id = c.tenant_id
    join public.course_modules m
      on m.id = s.module_id and m.tenant_id = c.tenant_id
    left join public.media_assets a
      on a.id = l.video_asset_id and a.tenant_id = l.tenant_id and a.deleted_at is null
   where c.id = p_course
     and c.tenant_id = app.tenant_id()
     and c.status = 'published'
   order by s.course_seq
$$;
--> statement-breakpoint
revoke all on function app.course_outline(uuid) from public;--> statement-breakpoint
grant execute on function app.course_outline(uuid) to authenticated;--> statement-breakpoint

create or replace function app.course_lesson_content(p_lesson uuid)
returns table (
  lesson_id uuid,
  course_id uuid,
  module_id uuid,
  title text,
  description text,
  is_free boolean,
  requires_previous boolean,
  video_asset_id uuid,
  video_status text,
  duration_seconds int
)
language sql stable security definer set search_path = '' as $$
  select l.id,
         l.course_id,
         l.module_id,
         l.title,
         l.description,
         l.is_free,
         l.requires_previous,
         l.video_asset_id,
         a.status,
         case when a.status = 'ready' then coalesce(a.duration_seconds, 0) end
    from public.course_lessons l
    left join public.media_assets a
      on a.id = l.video_asset_id and a.tenant_id = l.tenant_id and a.deleted_at is null
   where l.id = p_lesson
     and l.tenant_id = app.tenant_id()
     and l.deleted_at is null
     and (select app.course_lesson_access(p_lesson)) is null
$$;
--> statement-breakpoint
revoke all on function app.course_lesson_content(uuid) from public;--> statement-breakpoint
grant execute on function app.course_lesson_content(uuid) to authenticated;--> statement-breakpoint

create or replace function app.course_lesson_material_list(p_lesson uuid)
returns table (
  material_id uuid,
  asset_id uuid,
  filename text,
  mime text,
  bytes bigint,
  "position" int
)
language sql stable security definer set search_path = '' as $$
  select mt.id,
         mt.asset_id,
         coalesce(a.filename, ''),
         a.mime,
         a.bytes,
         mt.position
    from public.course_lesson_materials mt
    join public.media_assets a
      on a.id = mt.asset_id
     and a.tenant_id = mt.tenant_id
     and a.deleted_at is null
     and a.status = 'ready'
   where mt.tenant_id = app.tenant_id()
     and mt.lesson_id = p_lesson
     and (select app.course_lesson_access(p_lesson)) is null
   order by mt.position, mt.id
$$;
--> statement-breakpoint
revoke all on function app.course_lesson_material_list(uuid) from public;--> statement-breakpoint
grant execute on function app.course_lesson_material_list(uuid) to authenticated;--> statement-breakpoint

create or replace function app.course_live_cards(p_live uuid default null)
returns table (
  live_id uuid,
  title text,
  description text,
  cover_asset_id uuid,
  starts_at timestamptz,
  duration_min int,
  cancelled_at timestamptz,
  locked boolean,
  has_replay boolean
)
language sql stable security definer set search_path = '' as $$
  select v.id,
         v.title,
         v.description,
         v.cover_asset_id,
         v.starts_at,
         v.duration_min,
         v.cancelled_at,
         v.id = any (coalesce((select app.live_locked_ids()), '{}'::uuid[])),
         exists (select 1
                   from public.course_lessons l
                   join public.course_modules m
                     on m.id = l.module_id and m.tenant_id = l.tenant_id and m.deleted_at is null
                  where l.id = v.replay_lesson_id
                    and l.tenant_id = v.tenant_id
                    and l.deleted_at is null)
    from public.course_lives v
   where v.tenant_id = app.tenant_id()
     and (p_live is null or v.id = p_live)
   order by v.starts_at, v.id
$$;
--> statement-breakpoint
revoke all on function app.course_live_cards(uuid) from public;--> statement-breakpoint
grant execute on function app.course_live_cards(uuid) to authenticated;--> statement-breakpoint

create or replace function app.course_catalogue_stats()
returns table (
  course_id uuid,
  lesson_count int,
  duration_seconds int,
  completed_count int
)
language sql stable security definer set search_path = '' as $$
  select c.id,
         count(l.id)::int,
         coalesce(sum(case when a.status = 'ready' then a.duration_seconds end), 0)::int,
         count(p.completed_at)::int
    from public.courses c
    left join public.course_lessons l
      on l.course_id = c.id
     and l.tenant_id = c.tenant_id
     and l.deleted_at is null
     and exists (select 1
                   from public.course_modules m
                  where m.id = l.module_id and m.tenant_id = l.tenant_id and m.deleted_at is null)
    left join public.media_assets a
      on a.id = l.video_asset_id and a.tenant_id = l.tenant_id and a.deleted_at is null
    left join public.course_lesson_progress p
      on p.tenant_id = l.tenant_id and p.lesson_id = l.id and p.user_id = app.user_id()
   where c.tenant_id = app.tenant_id()
     and c.status = 'published'
   group by c.id
$$;
--> statement-breakpoint
revoke all on function app.course_catalogue_stats() from public;--> statement-breakpoint
grant execute on function app.course_catalogue_stats() to authenticated;--> statement-breakpoint

create or replace function app.course_asset_hidden(p_asset uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
           when app.tenant_role() in ('admin_tenant', 'support_tenant') then false
           else (
                  exists (select 1
                            from public.media_assets a
                           where a.id = p_asset
                             and a.tenant_id = app.tenant_id()
                             and a.purpose = 'lesson')
                  or exists (select 1
                               from public.course_lesson_materials mt
                               join public.course_lessons l
                                 on l.id = mt.lesson_id and l.tenant_id = mt.tenant_id
                                and l.deleted_at is null
                               join public.course_modules m
                                 on m.id = l.module_id and m.tenant_id = l.tenant_id
                                and m.deleted_at is null
                              where mt.tenant_id = app.tenant_id()
                                and mt.asset_id = p_asset)
                )
                and not exists (
                  select 1
                    from public.course_lessons l
                    join public.course_modules m
                      on m.id = l.module_id and m.tenant_id = l.tenant_id and m.deleted_at is null
                   where l.tenant_id = app.tenant_id()
                     and l.deleted_at is null
                     and l.id in (select v.id
                                    from public.course_lessons v
                                   where v.tenant_id = app.tenant_id()
                                     and v.video_asset_id = p_asset
                                     and v.deleted_at is null
                                  union all
                                  select mt.lesson_id
                                    from public.course_lesson_materials mt
                                   where mt.tenant_id = app.tenant_id()
                                     and mt.asset_id = p_asset)
                     and app.course_lesson_access(l.id) is null)
         end
$$;
--> statement-breakpoint
revoke all on function app.course_asset_hidden(uuid) from public;--> statement-breakpoint
grant execute on function app.course_asset_hidden(uuid) to authenticated;
