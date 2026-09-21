import { z } from 'zod';

/**
 * Media broker contract (MEDIA-01, MEDIA-02, TENANT-04).
 *
 * Pure module — no node imports — so client components may import it through `@tria/contracts/media`
 * for the pick-time UX gate (`classifyMediaFile`, `mediaAcceptFor`), exactly as `apps/web/lib/upload.ts`
 * uses `classifyFile`/`BRANDING_MAX_BYTES` today. It is deliberately NOT re-exported from
 * `./index.ts`: the root barrel has been frozen since Phase 2 wave 2.
 *
 * The flow this contract describes (CLAUDE.md §4 — bytes NEVER transit Cloud Run):
 *   `POST /v1/media/uploads` -> 201 `mediaStartSchema` (a target, never a parser)
 *   browser PUTs (<= RESUMABLE_THRESHOLD_BYTES) or TUS-uploads the bytes straight to Storage
 *   `POST /v1/media/uploads/{assetId}/complete` -> 200 `mediaAssetSchema`
 *   `GET /v1/media/{assetId}/{variant}` -> 302 to a freshly signed Storage URL
 *
 * A payload NEVER carries a signed Storage URL (RESEARCH Pitfall 5): `mediaAssetSchema.url` and
 * `variants[].url` are stable `/v1/media/...` paths, so a cached payload can never outlive its URLs.
 *
 * Member uploads are jpeg/png/webp (images), mp4/quicktime (video) and pdf (attachments) ONLY.
 * Vector uploads are absent from every allow-list on purpose: a member-uploaded vector rendered in
 * `<img>` is a stored-XSS surface with a far larger attacker population than the admin-only brand
 * logo path (RESEARCH §Anti-Patterns, threat T-03-09).
 */

/** The PRIVATE Storage bucket every member upload lands in (TENANT-04). */
export const MEDIA_BUCKET = 'media';

export const MEDIA_KINDS = ['image', 'video', 'file'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_PURPOSES = ['avatar', 'post', 'cover', 'story', 'attachment'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export const MEDIA_STATUSES = [
  'pending',
  'processing',
  'ready',
  'failed',
  'rejected',
  'deleted',
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const MEDIA_PROVIDERS = ['supabase', 'mux'] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];

/** Every width the ladder may ever contain; `mediaVariantParamSchema` accepts exactly these. */
export const VARIANT_WIDTHS = [128, 320, 640, 1080, 1600] as const;
export type VariantWidth = (typeof VARIANT_WIDTHS)[number];

/** The WebP ladder derived per purpose. `attachment` derives nothing (a PDF has no variants). */
export const PURPOSE_WIDTHS: Record<MediaPurpose, readonly number[]> = {
  avatar: [128, 320],
  post: [320, 640, 1080, 1600],
  cover: [640, 1080, 1600],
  story: [640, 1080],
  attachment: [],
};

export type MediaLimit = {
  readonly mimes: readonly string[];
  readonly maxBytes: number;
  readonly maxDurationSeconds?: number;
};

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const VIDEO_MIMES = ['video/mp4', 'video/quicktime'] as const;

/**
 * The accepted (kind, purpose) pairs with their mime allow-list and byte cap. The browser reads the
 * SAME table for its pick-time gate; the server re-validates everything at `start` and again at
 * `complete` — the client copy is UX, never authorization.
 */
export const MEDIA_LIMITS: Record<MediaKind, Partial<Record<MediaPurpose, MediaLimit>>> = {
  image: {
    avatar: { mimes: IMAGE_MIMES, maxBytes: 8 * 1024 * 1024 },
    post: { mimes: IMAGE_MIMES, maxBytes: 15 * 1024 * 1024 },
    cover: { mimes: IMAGE_MIMES, maxBytes: 15 * 1024 * 1024 },
    story: { mimes: IMAGE_MIMES, maxBytes: 15 * 1024 * 1024 },
  },
  video: {
    post: { mimes: VIDEO_MIMES, maxBytes: 500 * 1024 * 1024, maxDurationSeconds: 300 },
    story: { mimes: VIDEO_MIMES, maxBytes: 500 * 1024 * 1024, maxDurationSeconds: 60 },
  },
  file: {
    attachment: { mimes: ['application/pdf'], maxBytes: 25 * 1024 * 1024 },
  },
};

/**
 * Refused BY NAME at `start` and again BY DECODED FORMAT at `complete` (RESEARCH Pitfall 2, VERIFIED
 * against this repo's sharp 0.35.4 / libvips 8.18.6): libvips parses the ISO-BMFF container without
 * the HEVC decoder, so `metadata()` succeeds and reports `format: 'heif'` while any operation that
 * touches pixels dies with `bad seek`. A name-only check would accept every iPhone photo and the
 * worker would fail AFTER the member was told the upload succeeded.
 */
export const REFUSED_IMAGE_MIMES = ['image/heic', 'image/heif'] as const;

/** Supabase's plain-PUT ceiling; above it the browser must use TUS with a fixed 6 MiB chunk. */
export const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;

/**
 * The closed refusal vocabulary. `details.media` on a 400/404/413 envelope always carries exactly
 * one of these, so the web can switch on it exhaustively and map each to pt-BR copy (03-04).
 */
export const MEDIA_ISSUES = [
  'type_not_allowed',
  'too_large',
  'heic_unsupported',
  'not_an_image',
  'format_mismatch',
  'object_missing',
  'quota_exceeded',
  'duration_too_long',
  'not_ready',
  'transcode_failed',
  'video_provider_missing',
] as const;
export type MediaIssue = (typeof MEDIA_ISSUES)[number];
/** `details.media` always parses with this — see the docblock above `MEDIA_ISSUES`. */
export const mediaIssueSchema = z.enum(MEDIA_ISSUES);

/** `POST /v1/media/uploads` body. The tenant is NEVER in the body: it comes from the membership. */
export const mediaStartBodySchema = z
  .object({
    kind: z.enum(MEDIA_KINDS),
    purpose: z.enum(MEDIA_PURPOSES),
    mime: z.string().min(1),
    size: z.number().int().positive(),
    filename: z.string().max(200).optional(),
  })
  .strict();
export type MediaStartBody = z.infer<typeof mediaStartBodySchema>;

/**
 * 201 answer of `start`. `token` is what `tus-js-client` needs in `x-signature` and `path` is its
 * `objectName`; both are null for a provider that does not hand out a Storage target (03-06 video).
 */
export const mediaStartSchema = z
  .object({
    assetId: z.uuid(),
    provider: z.enum(MEDIA_PROVIDERS),
    signedUrl: z.url(),
    token: z.string().nullable(),
    path: z.string().nullable(),
    maxBytes: z.number().int(),
    resumableThresholdBytes: z.number().int(),
  })
  .strict();
export type MediaStart = z.infer<typeof mediaStartSchema>;

/**
 * The asset as every consumer sees it. The video fields are declared NULLABLE now so 03-06 adds no
 * contract change (RESEARCH Pitfall 9's discipline applied ahead of time).
 */
export const mediaAssetSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(MEDIA_KINDS),
    purpose: z.enum(MEDIA_PURPOSES),
    status: z.enum(MEDIA_STATUSES),
    mime: z.string(),
    bytes: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    durationSeconds: z.number().int().nullable(),
    aspectRatio: z.string().nullable(),
    filename: z.string().nullable(),
    failureReason: z.string().nullable(),
    variants: z.array(z.object({ width: z.number().int(), url: z.string() })),
    url: z.string(),
    createdAt: z.string(),
  })
  .strict();
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

/** `original` or `w<one of VARIANT_WIDTHS>` — nothing else ever reaches a Storage key builder. */
export const mediaVariantParamSchema = z
  .string()
  .regex(new RegExp(`^(original|w(${VARIANT_WIDTHS.join('|')}))$`));

/** The STABLE serving path. Never a signed URL — the tenant check runs on every fetch (R-05). */
export function mediaVariantUrl(assetId: string, variant: string): string {
  return `/v1/media/${assetId}/${variant}`;
}

/** The `<input accept="...">` string for a (kind, purpose) pair; empty when the pair is not allowed. */
export function mediaAcceptFor(kind: MediaKind, purpose: MediaPurpose): string {
  return (MEDIA_LIMITS[kind][purpose]?.mimes ?? []).join(',');
}

/**
 * Pick-time UX gate (UX ONLY — the server re-validates everything). `'heic'` is a SIGNAL, not an
 * error: the browser re-encodes such a file to JPEG before starting the upload (R-12).
 */
export function classifyMediaFile(
  file: { type: string; size: number },
  kind: MediaKind,
  purpose: MediaPurpose,
): 'type' | 'size' | 'heic' | null {
  const type = file.type.toLowerCase();
  if ((REFUSED_IMAGE_MIMES as readonly string[]).includes(type)) return 'heic';
  const limit = MEDIA_LIMITS[kind][purpose];
  if (!limit) return 'type';
  if (!limit.mimes.includes(type)) return 'type';
  if (file.size > limit.maxBytes) return 'size';
  return null;
}
