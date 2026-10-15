import { type SQL, sql } from 'drizzle-orm';

/**
 * The course and live gate seam (08.3, COURSE-08, D-404, D-405; RESEARCH Pattern 3). Kernel-owned,
 * the `community-gate.ts` posture: the kernel NAMES the gate, a module gives it a body, and every
 * consumer (the courses module's restrictive lesson policy and services, the member phase's reads,
 * later the notifications worker) imports ONLY this file.
 *
 * The four SQL functions are declared by the KERNEL migration `*_course_gate_seam.sql` as stubs
 * (every course and every live open). The store module gives the four bodies with `create or
 * replace`, keeping the signatures (08.3's `*_store_course_gate.sql`, re-pointed since 08.4 by
 * `*_store_course_links_functions.sql`, D-418): they read the store-owned link tables
 * `public.store_product_courses` / `public.store_product_lives`. A project that reuses courses
 * without the store keeps the stubs and the gate is a no-op (D-405: `courses` never `requires` the
 * store):
 *
 * | Function                                  | Answer                                                                |
 * |-------------------------------------------|-----------------------------------------------------------------------|
 * | `app.course_locked_ids() uuid[]`          | courses locked for the request lane's user (over `store_product_courses`) |
 * | `app.course_locked_ids_for(uuid) uuid[]`  | the same rule for an explicit user, role read from memberships        |
 * | `app.live_locked_ids() uuid[]`            | lives locked for the request lane's user (over `store_product_lives`) |
 * | `app.live_locked_ids_for(uuid) uuid[]`    | the same rule for an explicit user                                    |
 * | `app.course_asset_hidden(uuid) boolean`   | a lesson video or material no lesson the caller can open holds (08.5) |
 *
 * The fifth row is the COURSE ASSET gate (08.5-01, COURSE-20, D-433): its kernel stub
 * (`*_course_asset_gate_seam.sql`) answers `false`, and the body is the COURSES module's
 * (`*_courses_member_functions.sql`, `create or replace`, same signature), not the store's: it asks
 * the courses access answer (`app.course_lesson_access`), which itself reads the two lock seams
 * above. The kernel media service asks it before minting a playback credential and before signing
 * a material's `/original` bytes, so a remembered asset id never replays a locked lesson.
 *
 * A course (live) is locked when it is linked to at least one store product and the user holds no
 * ACTIVE entitlement to any of them; a course with no link is open to every member. Staff
 * (`admin_tenant`, `support_tenant`) are never locked out. A null or unknown `tenant_role` claim
 * takes the member branch (fails closed, T-08.3-04). With the tenant's `store` row OR its `courses`
 * row missing or disabled, every function answers `'{}'` even when link rows exist (links stay
 * dormant with the store off, D-405; with the module off nothing the gate reads is reachable, P02).
 *
 * THE COALESCE IS MANDATORY (RESEARCH Pitfall 1): `x <> all ((select app.f()))` parses as the
 * SUBQUERY form of `ALL` and fails with `operator does not exist: uuid <> uuid[]`. Wrapping the
 * scalar subquery in `coalesce(…, '{}'::uuid[])` makes it an array expression and keeps the
 * InitPlan, so the function runs once per statement, never once per row.
 */

/** The lane form, for policies and services: `course_id <> all (${LOCKED_COURSE_IDS})`. */
export const LOCKED_COURSE_IDS: SQL = sql`coalesce((select app.course_locked_ids()), '{}'::uuid[])`;

/** The explicit-user form, for lanes whose claims are not the viewer (the notifications worker). */
export const lockedCourseIdsFor = (userId: string): SQL =>
  sql`coalesce(app.course_locked_ids_for(${userId}::uuid), '{}'::uuid[])`;

/** The lane form for lives: `live_id <> all (${LOCKED_LIVE_IDS})`. */
export const LOCKED_LIVE_IDS: SQL = sql`coalesce((select app.live_locked_ids()), '{}'::uuid[])`;

/** The explicit-user form for lives. */
export const lockedLiveIdsFor = (userId: string): SQL =>
  sql`coalesce(app.live_locked_ids_for(${userId}::uuid), '{}'::uuid[])`;

/** `true` when a lesson video or material is held by no lesson the caller can open (08.5). */
export const courseAssetHidden = (assetId: string): SQL =>
  sql`app.course_asset_hidden(${assetId}::uuid)`;
