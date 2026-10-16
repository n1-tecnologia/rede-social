-- courses_asset_gate_admin_only (quick 261016-eg6; 08.5 code review IN-01, 08.5-SECURITY T-08.5-10,
-- D-426: a lesson of a course that is not published is "missing" for every role) — hand-written
-- (`--custom`), sorted AFTER `*_courses_asset_gate_fail_closed.sql`. One `create or replace`, same
-- signature:
--
--   `app.course_asset_hidden(p_asset uuid)`: the staff short-circuit answered `false` for the
--   `admin_tenant` AND the `support_tenant` claim, so a support agent holding a draft course's lesson
--   asset id could mint playback or sign `GET /v1/media/{assetId}/original`, while the learn routes
--   answer that lesson 404 for them. The short-circuit now names the `admin_tenant` claim only (the
--   admin course page mints draft thumbnails). The support role takes `app.course_lesson_access`,
--   which the evaluator answers open on a published course (staff are never locked, COURSE-25) and
--   `missing` on a draft, so support keeps every published lesson asset and loses the draft ones.
--   The rest of the body is unchanged.
--
-- Hardening as in 20261016110251_courses_asset_gate_fail_closed.sql: the function is `security
-- definer set search_path = ''` with fully qualified names; the owner bypasses RLS, so EVERY
-- statement pins `tenant_id = app.tenant_id()` itself. EXECUTE is revoked from PUBLIC and granted to
-- `authenticated` only. No statement picks a single row with a LIMIT. Expand-only: nothing here
-- alters a table or a policy, and 20261016110251_courses_asset_gate_fail_closed.sql stays untouched
-- (its body is replaced in place here, the repo's post-review precedent).

create or replace function app.course_asset_hidden(p_asset uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
           when app.tenant_role() = 'admin_tenant' then false
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
