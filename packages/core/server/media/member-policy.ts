import type { FlagsContext } from '../modules/flags-cache';

/**
 * What a MEMBER of a tenant may upload (D-474, SOCIAL-05). The numbers live in the `social` module's
 * settings, tolerant-parsed with their defaults by the module's own contract.
 *
 * MOD-02: the media broker is kernel and may not import a module, so it cannot read that schema. It
 * asks `memberMediaPolicyFor(ctx)` instead, and the APP tier fills the seam at import time with the
 * composition it owns (`apps/api/src/modules/registry.ts`: the effective-keys rule plus the settings
 * parse), exactly the inversion `setPermissionResolver` and `setCountersResolver` use.
 *
 * `null` means NO MEMBER ALLOWANCE: the module is not effective for the tenant, or no resolver was
 * registered at all. Both cases keep today's behavior of the broker, so a project that removes the
 * module (MOD-03) loses nothing but the member half.
 */
export type MemberMediaPolicy = {
  /** The most bytes a member's `post` photo may carry; never above the admin limit. */
  photoMaxBytes: number;
  /** The most photos a member post may carry; never above the feed's own image cap. */
  photosPerPost: number;
  video: {
    /** Whether a member may start a `post` video at all. Off by default. */
    enabled: boolean;
    /** Judged by the ready job at the provider's ready event, against a cap snapshotted at start. */
    maxDurationSeconds: number;
    /** Judged at start against the DECLARED size (the provider reports no byte count at ready). */
    maxBytes: number;
  };
};

export type MemberMediaPolicyResolver = (ctx: FlagsContext) => Promise<MemberMediaPolicy | null>;

let resolver: MemberMediaPolicyResolver = async () => null;

/** Called once, at import time, by the app tier's module registry. Last registration wins (tests). */
export function setMemberMediaPolicy(fn: MemberMediaPolicyResolver): void {
  resolver = fn;
}

/**
 * The caller's member media policy, or null. Callers read it BEFORE they open a transaction (the
 * resolver may read the flags cache, which can open a tenant-lane transaction of its own on a miss).
 */
export function memberMediaPolicyFor(ctx: FlagsContext): Promise<MemberMediaPolicy | null> {
  return resolver(ctx);
}
