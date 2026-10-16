-- courses_live_notice_functions (08.6-06, COURSE-46, COURSE-47, COURSE-51, COURSE-52; D-449, D-453,
-- D-433; RESEARCH Pattern 6, Code Example "Audience definers", Pitfall 5, Assumption A7) — who hears
-- about a live's lifecycle. Hand-written (`--custom`), sorted AFTER
-- `*_courses_live_reminder_functions.sql`.
--
--   1. `app.course_notice_user_ids()` — every LIVE `member` and `support_tenant` membership of the
--      caller's tenant (`status = 'active'`, not blocked, not soft-deleted), WITH or WITHOUT access to
--      any course or live. D-449: a live notice is a shop window (the titles of locked lives are
--      already visible, D-431), and D-453: support staff receive the course notices like a member.
--      Never `admin_tenant`. The `live_scheduled` source (new and reactivated lives) asks it and
--      excludes the actor. The Phase 7 `members` audience is `member`-only (D-229), so the sources
--      hand the fan-out a `users` list built here (R-Pitfall 5).
--   2. `app.live_replay_audience_user_ids(p_live uuid)` — the members who can WATCH `p_live`'s
--      replay through one of D-433's two doors, among the same live `member` / `support_tenant`
--      memberships. The live must be a non-cancelled live of the caller's tenant whose
--      `replay_lesson_id` is a LIVE lesson (not soft-deleted) under a LIVE module; otherwise nobody.
--      A membership is in when the LIVE door opens (`p_live` is not in
--      `app.live_locked_ids_for(user)`) OR the COURSE door opens (the replay lesson's course is
--      `published` AND the lesson is free or its course is not in `app.course_locked_ids_for(user)`).
--      The sequence lock is IGNORED (R-A7): a member blocked by the course's order may still open the
--      replay through the live door, and the notice names the live, never the lesson. Both lock
--      seams answer `'{}'` for staff and while the `store` or `courses` module is off, so with the
--      store off every live membership is in.
--
-- Hardening (the T-06-29 / T-08.2-22 posture, T-08.6-08 / T-08.6-11): `language sql stable security
-- definer set search_path = ''` with fully qualified names. The owner bypasses RLS, so each
-- statement pins `tenant_id = app.tenant_id()` itself: a lane with no tenant claim gets zero rows,
-- and tenant B's lane never reads A's memberships. The lock seams are read as
-- `coalesce((select app.f(user)), '{}'::uuid[])` (the scalar form of the array, never the subquery
-- form of ALL). EXECUTE is revoked from PUBLIC and granted to `authenticated` only; no route exposes
-- either function, and both answer user ids only. Ordered by `user_id`, no row picked with a LIMIT
-- (pgTAP 040's allow-list). The per-membership seam calls are acceptable at pilot scale and live
-- inside this one function (R-Pitfall 10). Expand-only: nothing here alters a table, a column or a
-- policy.

create or replace function app.course_notice_user_ids()
returns table (user_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.user_id
    from public.memberships m
   where m.tenant_id = app.tenant_id()
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null
     and m.role in ('member', 'support_tenant')
   order by m.user_id
$$;
--> statement-breakpoint
revoke all on function app.course_notice_user_ids() from public;--> statement-breakpoint
grant execute on function app.course_notice_user_ids() to authenticated;--> statement-breakpoint

create or replace function app.live_replay_audience_user_ids(p_live uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.user_id
    from public.course_lives v
    join public.course_lessons l
      on l.id = v.replay_lesson_id
     and l.tenant_id = v.tenant_id
     and l.deleted_at is null
    join public.course_modules cm
      on cm.id = l.module_id
     and cm.tenant_id = l.tenant_id
     and cm.deleted_at is null
    join public.courses c
      on c.id = l.course_id
     and c.tenant_id = l.tenant_id
    join public.memberships m
      on m.tenant_id = v.tenant_id
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null
     and m.role in ('member', 'support_tenant')
   where v.tenant_id = app.tenant_id()
     and v.id = p_live
     and v.cancelled_at is null
     and (p_live <> all (coalesce((select app.live_locked_ids_for(m.user_id)), '{}'::uuid[]))
          or (c.status = 'published'
              and (l.is_free
                   or c.id <> all (coalesce((select app.course_locked_ids_for(m.user_id)),
                                            '{}'::uuid[])))))
   order by m.user_id
$$;
--> statement-breakpoint
revoke all on function app.live_replay_audience_user_ids(uuid) from public;--> statement-breakpoint
grant execute on function app.live_replay_audience_user_ids(uuid) to authenticated;
