import { type SQL, sql } from 'drizzle-orm';

/**
 * The social gate seam (09-02, SOCIAL-06, D-483; RESEARCH Pattern 2). Kernel-owned, the
 * `community-gate.ts` posture: the kernel NAMES the gate, the social module gives it a body, and
 * every consumer (feed policies and services, the notifications worker, the dashboard) imports ONLY
 * this file, never a social table.
 *
 * The two SQL functions are declared by the KERNEL migration `*_social_gate_seam.sql` as stubs
 * (social off for everyone, no visible author). The social module's `*_social_functions.sql`
 * replaces both bodies with `create or replace`, keeping the signatures, so a project that reuses the
 * feed without `social` keeps the stubs and the gate is a no-op for authors:
 *
 * | Function                          | Answer                                                                |
 * |-----------------------------------|-----------------------------------------------------------------------|
 * | `app.social_enabled() boolean`    | `social` is enabled for the caller's tenant (a SQL read, never cache) |
 * | `app.social_visible_author_ids()` | the caller's own user id plus the live followees; `{}` otherwise      |
 * | `app.social_can_read_for(u, a)`   | `u` may read `a`'s followers posts (09-14); explicit-user form        |
 *
 * The third function has NO kernel stub: it is asked only about followers posts, which exist only where
 * `social` ships, and the social module's migration is its only declaration. It is the explicit-user
 * form for lanes whose claims are not the viewer (the notifications worker, whose claims are
 * `support_tenant` and answer `{}` to `social_visible_author_ids()`), the `lockedCommunityIdsFor`
 * precedent. It answers about OTHER users only to the system lane (the zero user), and fails closed.
 *
 * THE COALESCE IS MANDATORY (the `community-gate.ts` rule): `x = any ((select app.f()))` parses as the
 * SUBQUERY form of `ANY` and fails with `operator does not exist: uuid = uuid[]`. Wrapping the scalar
 * subquery in `coalesce(..., '{}'::uuid[])` makes it an array expression and keeps the InitPlan, so
 * the function runs once per statement, never once per row.
 */

/** The lane form, for policies and services: `author_user_id = any (${SOCIAL_VISIBLE_AUTHOR_IDS})`. */
export const SOCIAL_VISIBLE_AUTHOR_IDS: SQL = sql`coalesce((select app.social_visible_author_ids()), '{}'::uuid[])`;

/** `true` while `social` is enabled for the caller's tenant; the scalar InitPlan form. */
export const SOCIAL_ENABLED: SQL = sql`(select app.social_enabled())`;

/**
 * The zero user (`NOTIFICATIONS_SYSTEM_USER_ID`): the identity every SYSTEM lane runs under (the
 * notifications worker, the owner dashboard build, the courses jobs). It is never a real user, so a
 * row it reads belongs to no one. Repeated here as a literal because the kernel cannot import a
 * module (MOD-02) and the policy text is a constant of the schema.
 */
export const SOCIAL_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Who reads a member post WITHOUT being its author or a follower (09-03, SOCIAL-06; planning
 * decision 2): a tenant `admin_tenant` (the moderator) and the system lanes.
 *
 * - The system lanes run with the `support_tenant` claim AND the zero user, so exempting the zero
 *   user (and not the claim) keeps every worker reading what it needs.
 * - A REAL `support_tenant` session is deliberately NOT exempt: it is neither author, follower nor
 *   moderator, so it reads no member post (D-475). Exempting the role by claim, as the store seam
 *   does, would have let a real support user read members' followers-only posts through RLS.
 * - The exemption is only ever combined with `app.social_enabled()` by its callers, so "off hides
 *   everything" (D-483) holds for the admin too.
 *
 * Wrapped as a scalar subquery so it is an InitPlan: evaluated once per statement, not once per row.
 */
export const SOCIAL_STAFF_EXEMPT: SQL = sql.raw(
  `(select (app.tenant_role() = 'admin_tenant' or app.user_id() = '${SOCIAL_SYSTEM_USER_ID}'::uuid))`,
);

/**
 * The explicit-user form (09-15, WR-02): `true` only when `userId` may still read the followers posts
 * of `authorUserId` (a live follower or the author themself or the live moderator, `social` on, the
 * author live), `false` otherwise, and never null for a well-formed pair. Built for the notifications
 * worker, whose own claims are staff and cannot answer for a recipient; the definer answers about
 * another user only to the system lane, so no other lane can use it as a follow-graph oracle (D-468).
 * Both ids are cast to uuid here; a caller still treats anything other than exactly `true` as no.
 */
export const socialCanReadFor = (userId: string, authorUserId: string): SQL =>
  sql`app.social_can_read_for(${userId}::uuid, ${authorUserId}::uuid)`;
