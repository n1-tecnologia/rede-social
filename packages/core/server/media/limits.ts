import {
  MEDIA_BUCKET,
  MEDIA_LIMITS,
  type MediaKind,
  type MediaLimit,
  type MediaPurpose,
  PURPOSE_WIDTHS,
  VARIANT_WIDTHS,
} from '@rede-social/contracts/media';

/**
 * Server-side ceilings and decoder guards. Pure: no database, no env, no Storage client.
 *
 * The per-(kind, purpose) mime allow-list and byte cap live in `@rede-social/contracts/media`, NOT here:
 * the browser needs the same table for its pick-time gate (the Phase 2 `classifyFile` /
 * `BRANDING_MAX_BYTES` precedent in `apps/web/lib/upload.ts`). This file keeps only what must never
 * reach a bundle — the per-tenant ceilings and the sharp decoder limits — and re-exports the
 * contract table so server call sites have one import.
 */

export { MEDIA_BUCKET, MEDIA_LIMITS, PURPOSE_WIDTHS, VARIANT_WIDTHS };

/**
 * Larger than branding's 4096 (T-03-04 keeps its own limit): a 12 MP phone photo is 4032x3024 and
 * fits, a 48 MP one is 8000x6000 and would be refused at 4096. Every `sharp()` in this area carries
 * `limitInputPixels: MEDIA_MAX_INPUT_PIXELS`, so a decompression bomb dies at the decoder, and the
 * header check refuses any side above `MEDIA_MAX_INPUT_SIDE` before a single pixel is touched.
 */
export const MEDIA_MAX_INPUT_SIDE = 8192;
export const MEDIA_MAX_INPUT_PIXELS = MEDIA_MAX_INPUT_SIDE * MEDIA_MAX_INPUT_SIDE;

/**
 * Per-tenant storage ceiling, checked at `start` BEFORE a row exists (R-16, T-03-06). A constant
 * for the pilot — under Supabase Free's 1 GB total — tightened into a per-tenant column in Phase 8.
 */
export const MEDIA_TENANT_BYTES_CEILING = 800 * 1024 * 1024;
/** Per-tenant video-minutes ceiling; 03-06 checks it with the same shape at `start`. */
export const MEDIA_TENANT_VIDEO_SECONDS_CEILING = 3 * 60 * 60;

/** Thrown when a (kind, purpose) pair is not in `MEDIA_LIMITS`; the service maps it to a 400. */
export class MediaLimitError extends Error {
  constructor(kind: string, purpose: string) {
    super(`no media limit for ${kind}/${purpose}`);
    this.name = 'MediaLimitError';
  }
}

/** The limit for an accepted pair, or `MediaLimitError` — an unknown pair is never a silent default. */
export function limitFor(kind: MediaKind, purpose: MediaPurpose): MediaLimit {
  const limit = MEDIA_LIMITS[kind]?.[purpose];
  if (!limit) throw new MediaLimitError(kind, purpose);
  return limit;
}

/**
 * The purpose's WHOLE ladder. `attachment` derives nothing and stays empty.
 *
 * The source width is deliberately NOT a parameter (T-03-51). This used to clamp the ladder to
 * widths at or below the original, which made the set of URLs an asset answers a function of the
 * SOURCE SIZE — a fact no payload carries and no `<img srcset>` can know. Every profile surface
 * renders `PURPOSE_WIDTHS.avatar` with `baseWidth={320}` (`ProfileHeader`, `AvatarUploadField`,
 * `MemberRow`, `ProfileNudgeCard`, and `avatarSrcSet` in the contracts), because `ownProfileSchema`
 * and `memberProfileSchema` carry only an `avatarAssetId`. A member who uploaded a 200 px photo got
 * `w128` and nothing else, so at DPR >= 2 the browser chose the `w320` candidate, the serving route
 * 404'd, `MediaImage.onError` fired, and their photo silently became the neutral "no photo" icon on
 * exactly the phone this PWA is built for.
 *
 * Deriving every rung costs nothing and lies to nobody: `deriveVariants` resizes with
 * `withoutEnlargement`, so the `w320` rung of a 200 px original is a 200 px WebP — present, correct,
 * never upscaled, and a few kilobytes. The ladder is now a pure function of the purpose, which is
 * precisely what every call site already assumes.
 */
export function widthsForPurpose(purpose: MediaPurpose): number[] {
  return [...(PURPOSE_WIDTHS[purpose] ?? [])];
}

/**
 * Orphan-sweeper cadence and windows (R-07). Named constants next to the ceilings they live with,
 * the `domains/types.ts:86-96` pattern (`DOMAIN_VERIFY_INTERVAL_S` / `DOMAIN_VERIFY_DEADLINE_MS`):
 * the job reads them, the integration suite back-dates against them, and nobody re-derives a number.
 */

/** Sweeper cadence (seconds). The job re-arms itself with this `startAfter`; no scheduler exists. */
export const MEDIA_SWEEP_INTERVAL_S = 60 * 60;

/**
 * How long a `pending` asset may sit before it is an abandoned upload (24 h).
 *
 * The number is NOT arbitrary and must not be tightened casually: the Supabase resumable (TUS)
 * upload URL handed out at `start` is itself "valid for up to 24 hours"
 * [supabase.com/docs/guides/storage/uploads/resumable-uploads; RESEARCH R-07 and Pitfall 3], so a
 * member who picked a file on a train can still legitimately finish the PUT up to that moment.
 * Past it nothing legitimate can still be in flight, which is exactly when collecting is safe.
 */
export const MEDIA_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a soft-deleted (`deleted`) or `rejected` asset keeps its bytes (1 h). Short enough that a
 * tenant is not billed for retired photos, long enough that a member who removes their photo and
 * immediately puts it back is not racing the collector.
 */
export const MEDIA_DELETED_TTL_MS = 60 * 60 * 1000;

/** Rows collected per sweeper run. One run is bounded; the re-arm picks up the remainder. */
export const MEDIA_SWEEP_BATCH = 100;
