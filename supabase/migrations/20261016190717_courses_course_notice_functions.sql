-- courses_course_notice_functions (08.6-07, COURSE-44, COURSE-45, COURSE-51, COURSE-52; D-449, D-450,
-- D-453; RESEARCH Patterns 7 and 8, Code Example "Audience definers", Pitfall 6) — who hears about a
-- course, and which lessons a batch announces. Hand-written (`--custom`), sorted AFTER
-- `*_courses_notice_columns.sql` (the generated `announced_at` column it backfills and reads, EP-73).
--
--   1. The backfill: every existing lesson counts as announced at its creation, so the first batch
--      after this migration never announces the back catalogue. One idempotent `update … where
--      announced_at is null` (EP-76: a re-run changes nothing).
--   2. `app.course_audience_user_ids(p_course uuid)` — the LIVE `member` and `support_tenant`
--      memberships of the caller's tenant (`status = 'active'`, not blocked, not soft-deleted) for
--      which `p_course` is a PUBLISHED course of that tenant and is not in
--      `app.course_locked_ids_for(user)`: the new-lessons audience (D-449: a lessons notice only
--      reaches those with access; D-453: support staff like a member). That seam already answers
--      `'{}'` for staff memberships and while the `store` or `courses` module is off, so with the
--      store off every live membership is in. Never `admin_tenant`; nobody for a draft or archived
--      course.
--   3. `app.course_lessons_claim_batch(p_course uuid)` — the D-450 watermark claim (R-Pitfall 6): ONE
--      data-modifying statement that flips `announced_at = now()` on the lessons of `p_course` in the
--      caller's tenant that are unannounced, not soft-deleted, under a LIVE module, of a PUBLISHED
--      course, and carry no video or a `ready`, non-deleted video asset of the same tenant (R-A5: a
--      "5 aulas novas" notice never counts a video still processing). It answers `claimed` (the rows
--      it flipped, which is exactly the notice's count), `pending` (the remaining unannounced live
--      lessons of the published course whose video is NOT ready) and `oldest_pending_at` (their
--      earliest `created_at`, for the job's 24-hour re-arm limit). Concurrent claims serialise on the
--      row locks of the update, so a lesson is announced at most once; a second claim right after the
--      first answers `claimed = 0` (EP-76). No `limit`: a batch claims every claimable lesson.
--
-- Hardening (the T-06-29 / T-08.2-22 posture, T-08.6-08 / T-08.6-11): `security definer set
-- search_path = ''` with fully qualified names. The owner bypasses RLS, so each statement pins
-- `tenant_id = app.tenant_id()` itself: a lane with no tenant claim reads and writes nothing, and
-- tenant B's lane never reads A's memberships or flips A's lessons. The claim only moves the
-- announcement watermark of the caller's own tenant and changes no content (T-08.6-08); no route
-- exposes either function. EXECUTE is revoked from PUBLIC and granted to `authenticated` only. The
-- lock seam is read as `coalesce((select app.course_locked_ids_for(user)), '{}'::uuid[])` (the
-- scalar form of the array, never the subquery form of ALL); the per-membership seam call is
-- acceptable at pilot scale (R-Pitfall 10). Expand-only: nothing here alters a table, a column or a
-- policy.

update public.course_lessons set announced_at = created_at where announced_at is null;
--> statement-breakpoint

create or replace function app.course_audience_user_ids(p_course uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.user_id
    from public.memberships m
    join public.courses c
      on c.id = p_course
     and c.tenant_id = m.tenant_id
     and c.status = 'published'
   where m.tenant_id = app.tenant_id()
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null
     and m.role in ('member', 'support_tenant')
     and p_course <> all (coalesce((select app.course_locked_ids_for(m.user_id)), '{}'::uuid[]))
   order by m.user_id
$$;
--> statement-breakpoint
revoke all on function app.course_audience_user_ids(uuid) from public;--> statement-breakpoint
grant execute on function app.course_audience_user_ids(uuid) to authenticated;--> statement-breakpoint

create or replace function app.course_lessons_claim_batch(p_course uuid)
returns table (claimed int, pending int, oldest_pending_at timestamptz)
language sql volatile security definer set search_path = '' as $$
  with flipped as (
    update public.course_lessons l
       set announced_at = now()
      from public.courses c, public.course_modules cm
     where l.tenant_id = app.tenant_id()
       and l.course_id = p_course
       and l.announced_at is null
       and l.deleted_at is null
       and c.id = l.course_id
       and c.tenant_id = l.tenant_id
       and c.status = 'published'
       and cm.id = l.module_id
       and cm.tenant_id = l.tenant_id
       and cm.deleted_at is null
       and (l.video_asset_id is null
            or exists (select 1 from public.media_assets a
                        where a.id = l.video_asset_id
                          and a.tenant_id = l.tenant_id
                          and a.status = 'ready'
                          and a.deleted_at is null))
    returning l.id
  ),
  waiting as (
    select p.created_at
      from public.course_lessons p
      join public.courses c
        on c.id = p.course_id
       and c.tenant_id = p.tenant_id
       and c.status = 'published'
      join public.course_modules cm
        on cm.id = p.module_id
       and cm.tenant_id = p.tenant_id
       and cm.deleted_at is null
     where p.tenant_id = app.tenant_id()
       and p.course_id = p_course
       and p.announced_at is null
       and p.deleted_at is null
       and p.video_asset_id is not null
       and not exists (select 1 from public.media_assets a
                        where a.id = p.video_asset_id
                          and a.tenant_id = p.tenant_id
                          and a.status = 'ready'
                          and a.deleted_at is null)
  )
  select (select count(*) from flipped)::int,
         (select count(*) from waiting)::int,
         (select min(w.created_at) from waiting w)
$$;
--> statement-breakpoint
revoke all on function app.course_lessons_claim_batch(uuid) from public;--> statement-breakpoint
grant execute on function app.course_lessons_claim_batch(uuid) to authenticated;
