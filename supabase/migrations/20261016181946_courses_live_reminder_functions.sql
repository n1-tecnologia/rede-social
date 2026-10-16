-- courses_live_reminder_functions (08.6-05, COURSE-41, COURSE-48, COURSE-51, COURSE-52; D-444, D-446;
-- RESEARCH Pattern 4, Pitfalls 2 and 10) — who receives a live's reminder. Hand-written (`--custom`),
-- sorted AFTER `*_courses_member_area.sql` (the generated `course_live_reminders` table it reads,
-- EP-73).
--
--   `app.course_live_reminder_user_ids(p_live uuid, p_check_access boolean)` — the user ids of the
--   caller's tenant that opted into `p_live` (D-444) and still hold a LIVE membership: `status =
--   'active'`, not blocked, not soft-deleted, and a role other than `admin_tenant` (the preview
--   writes no opt-in, D-422; a row written past that rule still never receives). With
--   `p_check_access` true, every membership for which `app.live_locked_ids_for(user)` holds the live
--   is dropped (D-446: access is checked again at fire time, so a revoked buyer receives nothing,
--   T-08.6-04); that function already answers `'{}'` for staff memberships and while the `store` or
--   `courses` module is off, so those opt-ins are kept. The live reminder source asks it with `true`
--   (08.6-05); the cancel notice asks it with `false` (08.6-06: a member who lost access still hears
--   the live was cancelled). Ordered by `user_id`, no `limit`.
--
-- Why a definer (R-Pitfall 2): the notification fan-out runs in the worker's zero-user lane
-- (`support_tenant` claim, `00000000-…`), and `course_live_reminders` has OWN-ROW policies only, so a
-- lane select of the table there answers nobody. The definer reads past those policies and returns
-- ids only; no route exposes it (T-08.6-08). The per-membership `live_locked_ids_for` call is
-- acceptable at pilot scale and lives inside this one function, so a set-based rewrite later changes
-- one place (R-Pitfall 10).
--
-- Hardening (the T-06-29 / T-08.2-22 posture, T-08.6-11): `language sql stable security definer set
-- search_path = ''` with fully qualified names. The owner bypasses RLS, so the statement pins
-- `tenant_id = app.tenant_id()` itself: a lane with no tenant claim gets zero rows, and tenant B's
-- lane never reads A's opt-ins. EXECUTE is revoked from PUBLIC and granted to `authenticated` only.
-- No statement picks a single row with a LIMIT (pgTAP 040's allow-list). Expand-only: nothing here
-- alters a table, a column or a policy (EP-77).

create or replace function app.course_live_reminder_user_ids(p_live uuid, p_check_access boolean)
returns table (user_id uuid)
language sql stable security definer set search_path = '' as $$
  select r.user_id
    from public.course_live_reminders r
    join public.memberships m
      on m.tenant_id = r.tenant_id
     and m.user_id = r.user_id
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null
     and m.role <> 'admin_tenant'
   where r.tenant_id = app.tenant_id()
     and r.live_id = p_live
     and (not coalesce(p_check_access, true)
          or p_live <> all (coalesce((select app.live_locked_ids_for(r.user_id)), '{}'::uuid[])))
   order by r.user_id
$$;
--> statement-breakpoint
revoke all on function app.course_live_reminder_user_ids(uuid, boolean) from public;--> statement-breakpoint
grant execute on function app.course_live_reminder_user_ids(uuid, boolean) to authenticated;
