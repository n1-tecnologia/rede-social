import { MEDIA_LIMITS } from '@rede-social/contracts/media';
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

/**
 * 10-07 (D-715, MSTORY-07, Pitfall 10): the PURPOSES the member rules reach. A member story and a member
 * community cover are the member's own content, so they are held to the same limits as a member post.
 * Written once, as pure functions of the purpose, so the broker (`startUpload`, `completeUpload`) and the
 * minutes share (`member-share.ts`) cannot disagree about which purposes a member rule covers.
 */

/** The purposes whose PHOTOS a member uploads under the tenant's `photoMaxBytes`. */
export const MEMBER_PHOTO_CAP_PURPOSES = ['post', 'story', 'cover'] as const;

/** The purposes a member may start a VIDEO for (when member video is enabled): never `cover` or `lesson`. */
export const MEMBER_VIDEO_PURPOSES = ['post', 'story'] as const;

/** The video purposes whose seconds the member minutes sub-budget sums. */
export const MEMBER_SHARED_VIDEO_PURPOSES = MEMBER_VIDEO_PURPOSES;

export const memberPhotoCapApplies = (purpose: string): boolean =>
  (MEMBER_PHOTO_CAP_PURPOSES as readonly string[]).includes(purpose);

export const memberVideoPurposeAllowed = (purpose: string): boolean =>
  (MEMBER_VIDEO_PURPOSES as readonly string[]).includes(purpose);

/**
 * The duration cap SNAPSHOTTED at start for a member's video (A9, adopted). A `post` video keeps the
 * tenant's member seconds; a `story` video gets the LOWER of those seconds and the story's own static cap
 * (`MEDIA_LIMITS.video.story.maxDurationSeconds`, 60), because the member limit may be up to 300 s for
 * posts and a literal reading of "same limits as a post" would let a member story outlast any admin story.
 * To take the literal reading instead, return `memberSeconds` for every purpose here.
 */
export function memberVideoDurationCap(purpose: string, memberSeconds: number): number {
  if (purpose !== 'story') return memberSeconds;
  const storyCap = MEDIA_LIMITS.video.story?.maxDurationSeconds;
  return storyCap === undefined ? memberSeconds : Math.min(memberSeconds, storyCap);
}
