-- courses_asset_gate_fail_closed (quick 261016-aqc; 08.5 code review WR-01 and WR-03; the
-- 08.5-VERIFICATION gap on truth 4, COURSE-20, T-08.3-08) — hand-written (`--custom`), sorted AFTER
-- `*_courses_material_soft_delete.sql` (SQL-language bodies are validated at creation and statements
-- b and c read `course_lesson_materials.deleted_at`). Three `create or replace`s, same signatures:
--
--   a. `app.course_lesson_access(p_lesson uuid)` (WR-03): the course-door branch was a scalar
--      subquery over `app.course_lesson_states`, so a lesson the outer join accepts but the evaluator
--      does not return answered NULL ("open"). It is now a left join from a one-row probe, and a
--      missing evaluator row answers 'missing': content, materials, the progress with check and the
--      asset gate fail closed if the two liveness predicates ever drift.
--   b. `app.course_lesson_material_list(p_lesson uuid)`: lists live material rows only
--      (`mt.deleted_at is null`), so a detached material leaves the member lesson, the replay and the
--      member URL route.
--   c. `app.course_asset_hidden(p_asset uuid)` (WR-01): GOVERNED was "a lesson video, or a material
--      of a LIVE lesson under a LIVE module", so removing the lesson or module, or detaching the
--      material, left the asset ungoverned and `GET /v1/media/{assetId}/original` signed it for any
--      member holding the id. GOVERNED is now "a lesson video, or ANY material row of the tenant,
--      under any lesson, live or soft-deleted": an asset that ever was a course material stays
--      governed for good. The "held by an openable live lesson" half is unchanged except that a
--      material only holds its asset through a LIVE row (`mt.deleted_at is null`). Staff branch
--      unchanged.
--
-- Hardening as in 20261015194825_courses_member_functions.sql: every function is `security definer
-- set search_path = ''` with fully qualified names; the owner bypasses RLS, so EVERY statement pins
-- `tenant_id = app.tenant_id()` itself. EXECUTE is revoked from PUBLIC and granted to `authenticated`
-- only. No statement picks a single row with a LIMIT. Expand-only: nothing here alters a table or a
-- policy, and 20261015194825_courses_member_functions.sql stays untouched (its bodies are replaced in
-- place here, the repo's post-review precedent).

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
             select case
                      when s.lesson_id is null then 'missing'
                      when s.lock_reason in ('module', 'lesson') then 'sequence'
                      else s.lock_reason
                    end
               from (select 1) as probe
               left join app.course_lesson_states(l.course_id) s
                 on s.lesson_id = l.id)
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
     and mt.deleted_at is null
     and (select app.course_lesson_access(p_lesson)) is null
   order by mt.position, mt.id
$$;
--> statement-breakpoint
revoke all on function app.course_lesson_material_list(uuid) from public;--> statement-breakpoint
grant execute on function app.course_lesson_material_list(uuid) to authenticated;--> statement-breakpoint

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
                                     and mt.asset_id = p_asset
                                     and mt.deleted_at is null)
                     and app.course_lesson_access(l.id) is null)
         end
$$;
--> statement-breakpoint
revoke all on function app.course_asset_hidden(uuid) from public;--> statement-breakpoint
grant execute on function app.course_asset_hidden(uuid) to authenticated;
