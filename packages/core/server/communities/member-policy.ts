import type { FlagsContext } from '../modules/flags-cache';

/**
 * What a MEMBER of a tenant may own as communities (D-710, MCOMM-05): the most ACTIVE communities one
 * member may have created. The number lives in the `social` module's settings
 * (`communities.maxPerMember`, default 3, 0 to 20), tolerant-parsed with its default by the module's own
 * contract.
 *
 * MOD-02: the communities module may not import the social package (a module to module edge, which
 * `pnpm boundaries` denies), so it cannot read that schema. It asks `memberCommunityPolicyFor(ctx)`
 * instead, and the APP tier fills the seam at import time with the composition it owns
 * (`apps/api/src/modules/registry.ts`: the effective-keys rule plus the settings parse), exactly the
 * inversion `setMemberMediaPolicy`, `setPermissionResolver` and `setCountersResolver` use.
 *
 * `null` means NO MEMBER ALLOWANCE: the `social` module is not effective for the tenant, or no resolver
 * was registered at all. The caller then refuses a member's write (403): a project that removes the
 * module (MOD-03) loses nothing but the member half.
 */
export type MemberCommunityPolicy = {
  /** The most `kind = 'member'`, `status = 'active'`, live communities one member may own. 0 is legal. */
  maxActive: number;
};

export type MemberCommunityPolicyResolver = (
  ctx: FlagsContext,
) => Promise<MemberCommunityPolicy | null>;

let resolver: MemberCommunityPolicyResolver = async () => null;

/** Called once, at import time, by the app tier's module registry. Last registration wins (tests). */
export function setMemberCommunityPolicy(fn: MemberCommunityPolicyResolver): void {
  resolver = fn;
}

/**
 * The caller's member community policy, or null. Callers read it BEFORE they open a transaction (the
 * resolver may read the flags cache, which can open a tenant-lane transaction of its own on a miss).
 * A rejection of the resolver is the caller's to handle: it is never swallowed here.
 */
export function memberCommunityPolicyFor(ctx: FlagsContext): Promise<MemberCommunityPolicy | null> {
  return resolver(ctx);
}
