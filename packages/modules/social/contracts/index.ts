/**
 * The social module's published contract surface (`@rede-social/module-social/contracts`). In 09-01
 * it is the module key and the one permission the module owns; the follow, directory and Explorar
 * schemas arrive with the routes that use them (plans 02 on).
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

// ---- 09-02 RED stubs: deliberately inert, fully replaced in the GREEN commit ----
import { z } from 'zod';

export const SOCIAL_FOLLOW_ISSUES = [] as const;
export const followResultSchema = z.object({});
export type FollowResult = { following: boolean; followerCount: number };
