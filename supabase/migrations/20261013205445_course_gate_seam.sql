-- course_gate_seam (08.3-01, COURSE-08, D-404, D-405; RESEARCH Pattern 3, Pitfall 2) — the KERNEL
-- declares the course and live gate; a module gives it a body.
--
-- WHY. From 08.3 a course (or a live) linked to a store product is locked for a member who holds
-- no active entitlement to any of its products; a course with no link is open to every member
-- (D-404). That rule is asked by the courses module's restrictive lesson policy today and by the
-- member phase's reads and the notifications worker later, so it is ONE seam with a kernel-owned
-- name (`packages/core/db/course-gate.ts`), never a call into a module — the exact shape of the
-- community gate (`*_community_gate_seam.sql`), kept as a SECOND seam on purpose (the assumption-
-- delta decision of 08.3-01: one body per entity, no generalised `(entity, id)` form yet).
--
-- WHY STUBS FIRST. The generated `*_courses.sql` migration creates `course_lessons_course_gate`,
-- whose `CREATE POLICY` must resolve `app.course_locked_ids()` when it runs, while the store body
-- cannot be created before the course link tables exist (SQL-language bodies are validated at
-- creation). So this file sorts first (stamped one second before the generated file) and declares
-- the four functions with their neutral answers; the store's `*_store_course_gate.sql` swaps the
-- four bodies with `create or replace` (same signature, same OID, so the dependent policy keeps
-- working). Until then, or in a project that reuses courses without the store (D-405: `courses`
-- never `requires` the store), every course and every live is open:
--   app.course_locked_ids()               -> '{}'   (the request lane's locked courses)
--   app.course_locked_ids_for(p_user)     -> '{}'   (the same for an explicit user)
--   app.live_locked_ids()                 -> '{}'   (the request lane's locked lives)
--   app.live_locked_ids_for(p_user)       -> '{}'   (the same for an explicit user)
--
-- Hardening (the T-06-29 posture, kept by every body that replaces these): SECURITY DEFINER,
-- `search_path = ''`, fully qualified names; EXECUTE revoked from PUBLIC and granted to
-- `authenticated` only. The stubs read no table. Expand-only: for every existing tenant this file
-- changes nothing a member can observe.

create or replace function app.course_locked_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$ select '{}'::uuid[] $$;
--> statement-breakpoint
revoke all on function app.course_locked_ids() from public;--> statement-breakpoint
grant execute on function app.course_locked_ids() to authenticated;--> statement-breakpoint

create or replace function app.course_locked_ids_for(p_user uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$ select '{}'::uuid[] $$;
--> statement-breakpoint
revoke all on function app.course_locked_ids_for(uuid) from public;--> statement-breakpoint
grant execute on function app.course_locked_ids_for(uuid) to authenticated;--> statement-breakpoint

create or replace function app.live_locked_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$ select '{}'::uuid[] $$;
--> statement-breakpoint
revoke all on function app.live_locked_ids() from public;--> statement-breakpoint
grant execute on function app.live_locked_ids() to authenticated;--> statement-breakpoint

create or replace function app.live_locked_ids_for(p_user uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$ select '{}'::uuid[] $$;
--> statement-breakpoint
revoke all on function app.live_locked_ids_for(uuid) from public;--> statement-breakpoint
grant execute on function app.live_locked_ids_for(uuid) to authenticated;
