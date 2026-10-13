import { z } from 'zod';

/**
 * Media broker contract (MEDIA-01, MEDIA-02, TENANT-04).
 *
 * Pure module — no node imports — so client components may import it through `@rede-social/contracts/media`
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
 * Member uploads are jpeg/png/webp (images), mp4/quicktime (video) and, as attachments, PDF, the
 * four office document mimes and the three image mimes (`ATTACHMENT_MIMES`) ONLY.
 * Vector uploads are absent from every allow-list on purpose: a member-uploaded vector rendered in
 * `<img>` is a stored-XSS surface with a far larger attacker population than the admin-only brand
 * logo path (RESEARCH §Anti-Patterns, threat T-03-09).
 */

/** The PRIVATE Storage bucket every member upload lands in (TENANT-04). */
export const MEDIA_BUCKET = 'media';

export const MEDIA_KINDS = ['image', 'video', 'file'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * `lesson` (08.3, D-409, COURSE-12) is a VIDEO-only purpose: a course lesson's recording, uploaded
 * through the same direct-to-provider pipeline as a `post` video but with the long-form caps below.
 * Course, category, track and live covers and the instructor photo reuse `cover`; lesson materials
 * reuse `attachment`. There is deliberately no `image.lesson` or `file.lesson` pair.
 */
export const MEDIA_PURPOSES = ['avatar', 'post', 'cover', 'story', 'attachment', 'lesson'] as const;
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

/**
 * Where the asset's bytes actually live. `fake` is the local video provider (03-06): it stores into
 * the same private `media` bucket but is reached through the `VideoProvider` seam, so a row must be
 * able to say so — otherwise every non-production video asset would have to lie about its provider
 * and 03-07's screen could not tell a simulated transcode from a real one.
 */
export const MEDIA_PROVIDERS = ['supabase', 'mux', 'fake'] as const;
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
  // A video purpose: the provider derives thumbnails and the HLS ladder, Storage derives nothing.
  lesson: [],
};

export type MediaLimit = {
  readonly mimes: readonly string[];
  readonly maxBytes: number;
  readonly maxDurationSeconds?: number;
};

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const VIDEO_MIMES = ['video/mp4', 'video/quicktime'] as const;

/**
 * What a `file`-kind `attachment` may be (08.3-03, D-410, COURSE-07): PDF, a spreadsheet, a slide
 * deck or an image, each at the bucket's 50 MiB per-file cap. The feed's attachments widen with it
 * (FEED-01 says "PDF and similar"). Every entry has a magic-byte check in the kernel's `inspectFile`
 * — `%PDF-`, the ZIP signature for the two OOXML mimes, the OLE signature for the two legacy ones,
 * the sharp decode for the images — so nothing here is accepted on its declared name alone. Word
 * documents are deliberately absent: the decision names the four kinds and nothing else.
 */
export const ATTACHMENT_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIMES)[number];

/** The kind label a UI shows for an attachment, derived from its mime; `file` is the fallback. */
export const ATTACHMENT_KINDS = ['pdf', 'sheet', 'slides', 'image', 'file'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

const ATTACHMENT_KIND_BY_MIME: Record<AttachmentMime, AttachmentKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet',
  'application/vnd.ms-excel': 'sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slides',
  'application/vnd.ms-powerpoint': 'slides',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
};

/** `attachmentKindFor('application/vnd.ms-excel')` is `'sheet'`; an unknown mime is `'file'`. */
export function attachmentKindFor(mime: string | null | undefined): AttachmentKind {
  return ATTACHMENT_KIND_BY_MIME[(mime ?? '') as AttachmentMime] ?? 'file';
}

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
    // 08.3 (D-409, COURSE-12; RESEARCH A1): a long-form lecture, 4 GiB and 4 hours. Same mimes as a
    // post video; the ready-event job compares the provider's duration against this cap. The
    // playback token TTL and the per-tenant video-seconds ceiling are sized for it in 08.3-03.
    lesson: {
      mimes: VIDEO_MIMES,
      maxBytes: 4 * 1024 * 1024 * 1024,
      maxDurationSeconds: 4 * 60 * 60,
    },
  },
  file: {
    // 08.3-03 (D-410, COURSE-07): lesson materials — and, with them, the feed's attachments
    // (FEED-01 "PDF and similar") — are PDF, spreadsheets, slides or images at 50 MiB, the private
    // bucket's per-file cap (`file_size_limit`) and the Supabase Free ceiling.
    attachment: { mimes: ATTACHMENT_MIMES, maxBytes: 50 * 1024 * 1024 },
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
  // 03-01's named video seam. 03-06 replaced the 501 branch with the `VideoProvider` adapter, so
  // nothing emits this any more; the member is kept in the closed set because the web switches on
  // `MEDIA_ISSUES` exhaustively and a value that once shipped may still sit in an old payload.
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

/**
 * The FLOOR of a minted playback credential's life (seconds). Since 08.3-03 (D-409, COURSE-12) a
 * credential lives `max(floor, duration + margin)` capped at the provider's 12 h asset limit — see
 * `playbackTtlSeconds` — because a lesson may run four hours and Mux stops playback mid-play the
 * moment a token expires ("Expiration time should be at least the duration of the Asset"). Two
 * hours still exceeds every feed and story video (300 s / 60 s) with a wide margin, so a member who
 * pauses a reel never hits an expiry the UI would have to explain; and even the cap keeps a leaked
 * URL dying the same day (T-03-47).
 */
export const PLAYBACK_TOKEN_TTL_SECONDS = 2 * 60 * 60;
/** The slack past the asset's own duration: a member who pauses a lecture gets thirty minutes. */
export const PLAYBACK_TOKEN_MARGIN_SECONDS = 30 * 60;
/** The ceiling: Mux's maximum single-asset duration is 12 hours, and a token never outlives a day. */
export const PLAYBACK_TOKEN_MAX_TTL_SECONDS = 12 * 60 * 60;

/**
 * The credential's life for an asset of `durationSeconds` (`null` while unknown): the floor, or the
 * duration plus the margin when that is longer, never above the cap. Integer seconds end to end
 * (P47): the provider's duration is already `Math.trunc`'d at normalisation, so no float reaches
 * `expiresInSeconds`.
 *
 *   null → 7200, 60 → 7200, 7199 → 7200, 7200 → 9000, 14400 → 16200, 41401 → 43200.
 */
export function playbackTtlSeconds(durationSeconds: number | null): number {
  const wanted = Math.trunc(durationSeconds ?? 0) + PLAYBACK_TOKEN_MARGIN_SECONDS;
  return Math.min(PLAYBACK_TOKEN_MAX_TTL_SECONDS, Math.max(PLAYBACK_TOKEN_TTL_SECONDS, wanted));
}

/**
 * 200 answer of `GET /v1/media/{assetId}/playback` (MEDIA-03, TENANT-04, D-44).
 *
 * **These tokens are minted PER REQUEST against the caller's own membership and MUST NEVER be
 * cached, persisted, logged or embedded in a cacheable payload.** They are bearer credentials that
 * are valid at the streaming provider's edge, outside our infrastructure: anything that stores one
 * hands playback of a community's video to whoever reads that store. The route therefore answers
 * `Cache-Control: no-store`, the value never reaches the database, and the log line carries the
 * asset id and never the token.
 */
export const mediaPlaybackSchema = z
  .object({
    playbackId: z.string(),
    tokens: z
      .object({ playback: z.string(), thumbnail: z.string(), storyboard: z.string() })
      .strict(),
    expiresAt: z.string(),
  })
  .strict();
export type MediaPlayback = z.infer<typeof mediaPlaybackSchema>;

/**
 * `MEDIA_LIST_PAGE_SIZE` is R-11's number — the same page the member directory uses — and is what
 * `/configuracoes/midia` sends as `limit`; the server clamps to `1..MEDIA_LIST_MAX_PAGE_SIZE` so a
 * crafted `?limit=100000` cannot ask for an unbounded page.
 */
export const MEDIA_LIST_PAGE_SIZE = 25;
export const MEDIA_LIST_MAX_PAGE_SIZE = 50;

/**
 * The longest cursor this endpoint will look at. The envelope is a base64url JSON object carrying an
 * ISO timestamp and a uuid, so ~200 characters is already generous; the bound exists so a megabyte
 * of "cursor" is refused before it is decoded.
 */
const MEDIA_MAX_CURSOR_LENGTH = 400;

/**
 * Query of `GET /v1/media` (MEDIA-03). `cursor` is OPAQUE: pass back the previous `nextCursor`
 * verbatim — a tampered or stale value is NOT an error, it degrades to the first page (T-03-52).
 */
export const mediaListQuerySchema = z
  .object({
    kind: z.enum(MEDIA_KINDS).optional(),
    purpose: z.enum(MEDIA_PURPOSES).optional(),
    cursor: z.string().max(MEDIA_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MEDIA_LIST_MAX_PAGE_SIZE)
      .default(MEDIA_LIST_PAGE_SIZE),
  })
  .strict();
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;

/**
 * One keyset page of the community's assets, newest first. `nextCursor` is non-null EXACTLY when
 * another row exists beyond this page (the query over-fetches one row to decide it), so the screen
 * shows "Carregar mais" while — and only while — `nextCursor !== null`.
 */
export const mediaListSchema = z
  .object({ items: z.array(mediaAssetSchema), nextCursor: z.string().nullable() })
  .strict();
export type MediaList = z.infer<typeof mediaListSchema>;

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
