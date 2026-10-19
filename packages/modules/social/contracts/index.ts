import { z } from 'zod';

/**
 * The social module's published contract surface (`@rede-social/module-social/contracts`): the
 * module key, the one permission the module owns (09-01) and the follow graph's request and answer
 * shapes (09-02). The Explorar and settings schemas arrive with the plans that use them.
 */

/** The `tenant_modules.module_key` of this module (SOCIAL-01, D-482). */
export const SOCIAL_MODULE_KEY = 'social' as const;

/**
 * `social.participate` is composed for the role `member` ONLY, and that is by construction.
 *
 * The follow routes and the member branch of `GET /v1/members` check it, and the RLS policies and
 * SECURITY DEFINER functions those routes reach key on the MEMBER role of the caller's membership.
 * Granting it to `admin_tenant` or `support_tenant` (through settings or any other composition) would
 * let staff into routes whose SQL does not expect them: a follow row for a staff membership, or a
 * directory answer shaped for a member. Widen the SQL in the same change or never compose it
 * elsewhere; `apps/api/tests/unit/registry.test.ts` (case 16) fails first. The store's
 * `store.product.manage` carries the mirrored warning (admin-only by construction).
 */
export const SOCIAL_PERMISSIONS = { participate: 'social.participate' } as const;

/**
 * The closed refusal vocabulary of a follow (D-467). Today it has ONE word: the caller named their
 * own membership. Every other miss (unknown, another tenant's, staff, blocked, invited, removed) is
 * the bare 404 with NO code, because a code there would be an existence oracle (T-09-03). The route's
 * `defaultHook` lifts a Zod issue carrying one of these words into `details.follow`, and the service
 * throws the same word, so one vocabulary serves both layers.
 */
export const SOCIAL_FOLLOW_ISSUES = ['self_follow'] as const;
export type SocialFollowIssue = (typeof SOCIAL_FOLLOW_ISSUES)[number];
export const SOCIAL_FOLLOW_ISSUE_SET: ReadonlySet<string> = new Set(SOCIAL_FOLLOW_ISSUES);

/**
 * `PUT` / `DELETE /v1/social/follows/{membershipId}`: the state after the call and the target's
 * follower count. `.strict()` so the shape the API sends and the web parses cannot drift. A count of
 * exactly one is the integer 1 and zero is 0 (the web turns the singular label, EP-36).
 */
export const followResultSchema = z
  .object({
    following: z.boolean(),
    followerCount: z.number().int().min(0),
  })
  .strict();
export type FollowResult = z.infer<typeof followResultSchema>;

// ---- 09-02 task 2 RED stubs: deliberately inert, fully replaced in the GREEN commit ----
export const SOCIAL_LIST_PAGE_SIZE = 0;
export const SOCIAL_LIST_MAX_PAGE_SIZE = 0;
export const socialListQuerySchema = z.object({});
export const socialListItemSchema = z.object({});
export const socialListPageSchema = z.object({});
export const followStateBodySchema = z.object({});
export const followStateSchema = z.object({});
export const memberSocialProfileSchema = z.object({});
