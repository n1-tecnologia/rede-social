import {
  type MediaAsset,
  type MediaKind,
  type MediaLimit,
  type MediaList,
  type MediaListQuery,
  type MediaPlayback,
  type MediaPurpose,
  type MediaStart,
  type MediaStartBody,
  mediaVariantUrl,
  PLAYBACK_TOKEN_TTL_SECONDS,
  REFUSED_IMAGE_MIMES,
  RESUMABLE_THRESHOLD_BYTES,
} from '@rede-social/contracts/media';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { mediaAssets, tenantDomains } from '../../db/schema';
import { withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { env, publicWebOrigin } from '../env';
import { ApiError } from '../http/api-error';
import { enqueueInTx } from '../jobs/boss';
import { moduleLogger } from '../logging';
import { decodeCursor, encodeCursor } from '../paging';
import { MEDIA_DERIVE_QUEUE, MEDIA_SWEEP_QUEUE, MEDIA_SWEEP_SINGLETON } from './index';
import { inspectMediaImage, inspectPdf, MediaImageError } from './inspect';
import {
  assertTenantKey,
  mediaAssetPrefix,
  mediaKeyFor,
  mediaOriginalKey,
  mediaVariantKey,
  parseVariant,
} from './keys';
import {
  limitFor,
  MEDIA_SWEEP_INTERVAL_S,
  MEDIA_TENANT_BYTES_CEILING,
  MEDIA_TENANT_VIDEO_SECONDS_CEILING,
  MediaLimitError,
  widthsForPurpose,
} from './limits';
import {
  downloadObject,
  invalidateSignedUrl,
  listObjects,
  MEDIA_VARIANT_CACHE_CONTROL,
  objectInfo,
  putObject,
  removeObjects,
  removeQuietly,
  signRead,
  signUpload,
} from './storage';
import { deriveVariants, probeSize } from './variants';
import { videoProvider } from './video/index';

/**
 * The media broker (MEDIA-01, MEDIA-02, TENANT-04) — a tenant-lane service that returns upload
 * TARGETS and read REDIRECTS, and never a byte parser.
 *
 * Invariants (pinned by `apps/api/tests/integration/media.test.ts`):
 *  - every object key is built server-side from `ctx.tenantId` (the membership of record, never a
 *    host, a body field or a row) and asserted with `assertTenantKey` before ANY Storage call. A
 *    tenant-B session asking for a tenant-A assetId resolves under B's own prefix, so the refusal is
 *    a plain 404 with no `Location` and no tenant name — isolation is structural (T-03-01);
 *  - FILE BYTES NEVER ENTER A REQUEST BODY (CLAUDE.md §4, Cloud Run's 32 MiB cap): `start` hands out
 *    a signed Storage URL, the browser uploads directly, `complete` re-reads the object;
 *  - the request path decodes the image HEADER only and enqueues; derivation (download, resize, N
 *    uploads) runs in the worker (T-03-04, the 02-13 prohibition);
 *  - a file whose bytes are not what it claimed never becomes an asset: the object is removed and
 *    the request refused with a machine code from `MEDIA_ISSUES` (T-03-03);
 *  - `complete` is idempotent — a row already `processing`/`ready` answers unchanged and enqueues
 *    nothing — and the enqueue carries `singletonKey = assetId` under the `short` queue policy, so
 *    two concurrent confirmations produce exactly ONE derivation job.
 *
 * Lane confinement inside the area is grep-pinned by this plan's acceptance criteria: the service
 * and the derive job are the only files that open the admin transaction lane, and the Storage client
 * itself is reached ONLY through `./storage.ts`.
 */

const log = moduleLogger('media');

/** Test seam (the `brandingInternals` style): runs between derivation and the first variant write. */
export const mediaInternals = {
  async beforeVariantWrite(): Promise<void> {},
};

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'> & { requestId?: string };

type AssetRow = {
  id: string;
  tenantId: string;
  /** Who uploaded it — the intra-tenant authorization fact `assertMayRetire` reads (T-03-50). */
  ownerUserId: string;
  kind: string;
  purpose: string;
  status: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  aspectRatio: string | null;
  variantWidths: number[];
  filename: string | null;
  failureReason: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

const ASSET_COLUMNS = {
  id: mediaAssets.id,
  tenantId: mediaAssets.tenantId,
  ownerUserId: mediaAssets.ownerUserId,
  kind: mediaAssets.kind,
  purpose: mediaAssets.purpose,
  status: mediaAssets.status,
  mime: mediaAssets.mime,
  bytes: mediaAssets.bytes,
  width: mediaAssets.width,
  height: mediaAssets.height,
  durationSeconds: mediaAssets.durationSeconds,
  aspectRatio: mediaAssets.aspectRatio,
  variantWidths: mediaAssets.variantWidths,
  filename: mediaAssets.filename,
  failureReason: mediaAssets.failureReason,
  createdAt: mediaAssets.createdAt,
  deletedAt: mediaAssets.deletedAt,
} as const;

/**
 * The payload shape every consumer sees. It carries NO signed URL (Pitfall 5): `url` and
 * `variants[].url` are stable `/v1/media/…` paths, so a cached payload can never outlive its URLs.
 */
export function assetView(row: AssetRow): MediaAsset {
  return {
    id: row.id,
    kind: row.kind as MediaKind,
    purpose: row.purpose as MediaPurpose,
    status: row.status as MediaAsset['status'],
    mime: row.mime,
    bytes: Number(row.bytes),
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    aspectRatio: row.aspectRatio,
    filename: row.filename,
    failureReason: row.failureReason,
    variants: (row.variantWidths ?? []).map((width) => ({
      width,
      url: mediaVariantUrl(row.id, `w${width}`),
    })),
    url: mediaVariantUrl(row.id, 'original'),
    createdAt: row.createdAt.toISOString(),
  };
}

const validationFailed = (issue: string, extra?: Record<string, unknown>): ApiError =>
  new ApiError(400, 'VALIDATION_FAILED', { media: issue, ...extra });

const tooLarge = (maxBytes: number): ApiError =>
  new ApiError(413, 'VALIDATION_FAILED', { media: 'too_large', maxBytes });

/**
 * `corsOrigin` is the tenant's own browser-facing origin, which the provider's CORS rule for the
 * direct PUT must name. The ROUTE derives it from the validated `x-tenant-host` header so this file
 * stays free of header parsing; when the caller sent no host (a server-to-server client, the
 * integration suite) the video branch falls back to the tenant's verified primary domain.
 */
export type StartUploadOptions = { corsOrigin?: string | null };

/**
 * `POST /v1/media/uploads { kind: 'video' }` (MEDIA-03) — the branch that replaced 03-01's named
 * `501 { media: 'video_provider_missing' }` seam.
 *
 * The bytes go browser -> provider and never through Cloud Run, exactly like an image: the answer is
 * a TARGET. What differs is who stores them (`videoProvider`, not Storage — unless the provider is
 * the fake, which deliberately targets the same private bucket) and what is charged: video is
 * metered in MINUTES, so the ceiling is `sum(duration_seconds)` rather than `sum(bytes)`.
 *
 * Like the byte ceiling (R-16), the minutes ceiling is a SOFT quota: read and insert share one admin
 * transaction with no row lock, because the arbiter is a ceiling and not a balance. It is also
 * necessarily approximate in a second way — a `pending` video has no duration yet, so a tenant can
 * start several uploads that only later prove to exceed the ceiling. The per-purpose duration cap in
 * the event job is the backstop that deletes the provider asset when that happens.
 */
async function startVideoUpload(
  ctx: Ctx,
  body: MediaStartBody,
  limit: MediaLimit,
  opts: StartUploadOptions,
): Promise<MediaStart> {
  const assetId = crypto.randomUUID();

  const decision = await withAdminTx(async (tx) => {
    const [totals] = await tx
      .select({ total: sql<string>`coalesce(sum(${mediaAssets.durationSeconds}), 0)` })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.tenantId, ctx.tenantId), isNull(mediaAssets.deletedAt)));
    if (Number(totals?.total ?? 0) >= MEDIA_TENANT_VIDEO_SECONDS_CEILING) {
      return { accepted: false as const };
    }

    // Only when the route could not derive it: one indexed read on a rare, admin-only path.
    let corsOrigin = opts.corsOrigin ?? null;
    if (!corsOrigin) {
      const [primary] = await tx
        .select({ host: tenantDomains.host })
        .from(tenantDomains)
        .where(
          and(
            eq(tenantDomains.tenantId, ctx.tenantId),
            eq(tenantDomains.isPrimary, true),
            isNotNull(tenantDomains.verifiedAt),
          ),
        )
        .limit(1);
      corsOrigin = primary ? publicWebOrigin(primary.host) : null;
    }

    await tx.insert(mediaAssets).values({
      id: assetId,
      tenantId: ctx.tenantId,
      ownerUserId: ctx.userId,
      kind: body.kind,
      purpose: body.purpose,
      status: 'pending',
      provider: videoProvider.name,
      mime: body.mime,
      bytes: body.size,
      filename: body.filename ?? null,
    });
    return { accepted: true as const, corsOrigin };
  });

  if (!decision.accepted) {
    log.warn(
      {
        event: 'media.upload_rejected',
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        kind: 'video',
        reason: 'quota_exceeded',
      },
      'video upload refused: the tenant stored-minutes ceiling is reached',
    );
    throw new ApiError(413, 'VALIDATION_FAILED', { media: 'quota_exceeded' });
  }

  if (!decision.corsOrigin) {
    // A community with no verified domain has no origin a browser could upload from. Never reached
    // through the web app, which always sends `x-tenant-host`.
    log.error(
      { event: 'media.upload_start_failed', tenantId: ctx.tenantId, assetId, reason: 'no_origin' },
      'no browser origin for a video upload: the community has no verified primary domain',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  let upload: Awaited<ReturnType<typeof videoProvider.createDirectUpload>>;
  try {
    upload = await videoProvider.createDirectUpload({
      assetId,
      tenantId: ctx.tenantId,
      corsOrigin: decision.corsOrigin,
      test: env.NODE_ENV !== 'production',
    });
  } catch (error) {
    log.error(
      {
        event: 'media.upload_start_failed',
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        assetId,
        provider: videoProvider.name,
        // A `VideoProviderError` message carries a kind and a status and nothing else (T-03-41).
        err: error instanceof Error ? error.message : String(error),
      },
      'the video provider refused to mint a direct upload',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  await withAdminTx(async (tx) => {
    await tx
      .update(mediaAssets)
      .set({ providerAssetId: upload.providerUploadId })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.tenantId, ctx.tenantId)));
  });

  log.info(
    {
      event: 'media.upload_start',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      assetId,
      kind: body.kind,
      purpose: body.purpose,
      mime: body.mime,
      size: body.size,
      provider: videoProvider.name,
    },
    'video upload started',
  );

  return {
    assetId,
    provider: videoProvider.name,
    signedUrl: upload.uploadUrl,
    // The provider owns the object: there is no Storage token and no object name to hand back.
    token: null,
    path: null,
    maxBytes: limit.maxBytes,
    resumableThresholdBytes: RESUMABLE_THRESHOLD_BYTES,
  };
}

/**
 * `POST /v1/media/uploads` (MEDIA-01): validates the DECLARED facts, charges the tenant's storage
 * ceiling, records a `pending` row and mints a signed Storage target. Nothing is decoded here — the
 * declared mime buys a fast refusal, `complete` is where the bytes are judged.
 *
 * Order: unknown (kind, purpose) → HEIC by name → mime allow-list → byte cap → tenant ceiling.
 *
 * The ceiling is read and the row inserted in ONE admin transaction, and the sum is deliberately NOT
 * locked: the arbiter is a soft quota, not a balance, so a small overshoot when two uploads start in
 * the same millisecond is acceptable and far cheaper than serialising every upload of a tenant
 * behind a row lock. What matters is that no row exists when the ceiling refuses (R-16, T-03-06).
 */
export async function startUpload(
  ctx: Ctx,
  body: MediaStartBody,
  opts: StartUploadOptions = {},
): Promise<MediaStart> {
  // V1 publishes admin-only (PROJECT.md, ROADMAP criterion 4): only an `admin_tenant` may spend the
  // community's video minutes. Checked FIRST for the video kind so a member never learns which
  // video mimes or caps exist. V2's member posting removes this one predicate; Phase 5's stories
  // add a `story` purpose to the same table rather than a second rule (T-03-44).
  if (body.kind === 'video' && ctx.role !== 'admin_tenant') {
    throw new ApiError(403, 'FORBIDDEN');
  }

  let limit: ReturnType<typeof limitFor>;
  try {
    limit = limitFor(body.kind, body.purpose);
  } catch (error) {
    if (error instanceof MediaLimitError) throw validationFailed('type_not_allowed');
    throw error;
  }

  // RESEARCH Pitfall 2: refused by NAME here and again by DECODED FORMAT at `complete`.
  if ((REFUSED_IMAGE_MIMES as readonly string[]).includes(body.mime.toLowerCase())) {
    throw validationFailed('heic_unsupported');
  }
  if (!limit.mimes.includes(body.mime)) throw validationFailed('type_not_allowed');
  if (body.size > limit.maxBytes) throw tooLarge(limit.maxBytes);

  if (body.kind === 'video') return startVideoUpload(ctx, body, limit, opts);

  const assetId = crypto.randomUUID();
  const key = mediaOriginalKey(ctx.tenantId, assetId);
  assertTenantKey(key, ctx.tenantId);

  // R-16 / T-03-06: the ceiling is charged BEFORE a row exists, in the same transaction as the
  // insert, with the tenant predicate explicit (the admin lane bypasses RLS).
  const accepted = await withAdminTx(async (tx) => {
    const [totals] = await tx
      .select({ total: sql<string>`coalesce(sum(${mediaAssets.bytes}), 0)` })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.tenantId, ctx.tenantId), isNull(mediaAssets.deletedAt)));
    const used = Number(totals?.total ?? 0);
    if (used + body.size > MEDIA_TENANT_BYTES_CEILING) return false;

    await tx.insert(mediaAssets).values({
      id: assetId,
      tenantId: ctx.tenantId,
      ownerUserId: ctx.userId,
      kind: body.kind,
      purpose: body.purpose,
      status: 'pending',
      provider: 'supabase',
      mime: body.mime,
      bytes: body.size,
      filename: body.filename ?? null,
    });
    return true;
  });
  if (!accepted) {
    log.warn(
      {
        event: 'media.upload_rejected',
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        reason: 'quota_exceeded',
      },
      'media upload refused: the tenant storage ceiling is reached',
    );
    throw new ApiError(413, 'VALIDATION_FAILED', { media: 'quota_exceeded' });
  }

  let signed: Awaited<ReturnType<typeof signUpload>>;
  try {
    signed = await signUpload(key);
  } catch (error) {
    log.error(
      {
        event: 'media.upload_start_failed',
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        assetId,
        key,
        err: error instanceof Error ? error.message : String(error),
      },
      'could not mint a signed upload url',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  log.info(
    {
      event: 'media.upload_start',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      assetId,
      kind: body.kind,
      purpose: body.purpose,
      mime: body.mime,
      size: body.size,
      key,
    },
    'media upload started',
  );

  return {
    assetId,
    provider: 'supabase',
    signedUrl: signed.signedUrl,
    token: signed.token,
    path: key,
    maxBytes: limit.maxBytes,
    resumableThresholdBytes: RESUMABLE_THRESHOLD_BYTES,
  };
}

/**
 * The asset visible to the caller's TENANT lane, or `undefined`.
 *
 * The name is older than the predicate: RLS on `media_assets` supplies the tenant clause and nothing
 * else (`media_assets_tenant_select` is `tenant_id = app.tenant_id() and deleted_at is null`), so
 * this loads the COMMUNITY's asset, not the caller's own. Cross-tenant refusal is structural here;
 * intra-tenant authorization is NOT, and every mutating caller must add it itself — see
 * `assertMayRetire` (T-03-50).
 */
async function loadOwnAsset(ctx: Ctx, assetId: string): Promise<AssetRow | undefined> {
  return withTenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select(ASSET_COLUMNS)
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1);
    return row as AssetRow | undefined;
  });
}

/** The asset's UPLOADER, or the community's admin: the one intra-tenant rule both lanes share. */
function isOwnerOrAdmin(ctx: Ctx, row: AssetRow): boolean {
  return row.ownerUserId === ctx.userId || ctx.role === 'admin_tenant';
}

/**
 * The intra-tenant write predicate for an asset: its UPLOADER, or the community's admin (T-03-50).
 *
 * It cannot be admin-only. `updateOwnProfile` retires the outgoing photo through `deleteAsset` on
 * R-07 replace-on-write (`server/profiles/service.ts`), with the MEMBER's own ctx, so an admin-only
 * gate would take every member's ability to change their avatar with it.
 *
 * The refusal is the same bare `404 NOT_FOUND` the miss branch answers, on purpose. `GET /v1/members`
 * publishes every member's `avatarAssetId` (`memberProfileSchema`), so a caller arrives here holding
 * an id they did not have to guess: a 403 would confirm "that id exists and is somebody else's",
 * turning the delete lane into an ownership oracle over the whole directory. One answer for a
 * nonexistent id, another community's asset and a fellow member's asset keeps the vocabulary closed
 * and keeps the cross-tenant 404 (`isolation.test.ts`) structural rather than a second rule.
 *
 * `listAssets` answers 403 instead, and that is not a contradiction: it is a pure ROLE gate on a
 * collection, with no id in the request, so its refusal discloses nothing about any particular row.
 */
function assertMayRetire(ctx: Ctx, row: AssetRow): void {
  if (isOwnerOrAdmin(ctx, row)) return;
  log.warn(
    {
      event: 'media.retire_refused',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      assetId: row.id,
    },
    'a member tried to retire an asset they do not own',
  );
  throw new ApiError(404, 'NOT_FOUND');
}

/**
 * `GET /v1/media/{assetId}` (quick-260929-ka5) — ONE asset, in whatever live status it is in, for its
 * UPLOADER or the community's admin. It exists for the story composer's readiness poll: after a video
 * is handed to the provider, the composer re-reads the row until it is `ready`, `failed` or
 * `rejected` (the 2026-09-29 incident, where the composer said "Processando" forever). No status is
 * filtered out on purpose: the uploader must be able to SEE a `failed`/`rejected` video to be told why.
 *
 * Why owner-or-admin and not every member: the list is admin-only (T-03-48), and `GET /v1/members`
 * publishes every member's `avatarAssetId`, so a member-wide by-id read would be a metadata oracle
 * over the whole directory (sizes, dimensions, upload times of other people's photos). This mirrors
 * the delete lane's rule (`assertMayRetire`, T-03-50) and its ONE-404 vocabulary: an unknown id,
 * another community's asset (invisible to the tenant lane, so structural), a soft-deleted row and a
 * fellow member's asset all answer the same bare `404 NOT_FOUND` with no details payload.
 */
export async function getAsset(ctx: Ctx, assetId: string): Promise<MediaAsset> {
  const row = await loadOwnAsset(ctx, assetId);
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  if (!isOwnerOrAdmin(ctx, row)) {
    log.warn(
      {
        event: 'media.read_refused',
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        assetId: row.id,
      },
      'a member tried to read an asset they do not own',
    );
    throw new ApiError(404, 'NOT_FOUND');
  }
  return assetView(row);
}

/**
 * `POST /v1/media/uploads/{assetId}/complete` (MEDIA-01, MEDIA-02): the object must exist under the
 * CALLER's own prefix, its Storage metadata is re-read, only the image HEADER is decoded and a
 * refused file is removed from the bucket. Then ONE transaction records the measured facts and
 * enqueues exactly one `kernel.media-derive-variants` job.
 *
 * A foreign assetId is invisible to the tenant lane, so it takes the same 404 branch a nonexistent
 * one does: no existence oracle (T-03-01).
 */
export async function completeUpload(ctx: Ctx, assetId: string): Promise<MediaAsset> {
  const row = await loadOwnAsset(ctx, assetId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', { media: 'object_missing' });

  // Idempotent: a retried or concurrent confirmation answers the same body and enqueues nothing.
  if (row.status === 'processing' || row.status === 'ready') return assetView(row);
  if (row.status !== 'pending') throw validationFailed(row.failureReason ?? 'not_ready');

  const limit = limitFor(row.kind as MediaKind, row.purpose as MediaPurpose);
  const key = mediaOriginalKey(ctx.tenantId, assetId);
  assertTenantKey(key, ctx.tenantId);

  const reject = async (reason: string): Promise<never> => {
    await removeQuietly([key], log, 'media.upload_remove_failed');
    // The row survives as status='rejected' with failure_reason = the machine code the member was
    // given: a refused upload stays auditable and the 03-08 sweeper has something definite to
    // collect, instead of a `pending` row that merely looks abandoned.
    await withAdminTx(async (tx) => {
      await tx
        .update(mediaAssets)
        .set({ status: 'rejected', failureReason: reason })
        .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.tenantId, ctx.tenantId)));
    });
    log.warn(
      {
        event: 'media.upload_rejected',
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        assetId,
        key,
        reason,
      },
      'media upload rejected',
    );
    throw validationFailed(reason);
  };

  // The 02-13 order: info() -> size -> contentType -> header decode -> remove on refusal -> 400.
  const info = await objectInfo(key);
  if (!info) throw new ApiError(404, 'NOT_FOUND', { media: 'object_missing' });
  if (typeof info.size === 'number' && info.size > limit.maxBytes) await reject('too_large');
  if (info.contentType && info.contentType !== row.mime) await reject('format_mismatch');

  const buf = await downloadObject(key);
  if (!buf) throw new ApiError(404, 'NOT_FOUND', { media: 'object_missing' });
  if (buf.length > limit.maxBytes) await reject('too_large');

  let width: number | null = null;
  let height: number | null = null;
  try {
    if (row.kind === 'image') {
      const decoded = await inspectMediaImage(buf, row.mime);
      width = decoded.width;
      height = decoded.height;
    } else {
      inspectPdf(buf);
    }
  } catch (error) {
    if (error instanceof MediaImageError) await reject(error.reason);
    throw error;
  }

  // A `file` needs no ladder, so it is `ready` right here; an image goes to the worker.
  const isFile = row.kind === 'file';
  const bytes = typeof info.size === 'number' ? info.size : buf.length;

  await withAdminTx(async (tx) => {
    await tx
      .update(mediaAssets)
      .set({
        bytes,
        width,
        height,
        status: isFile ? 'ready' : 'processing',
        readyAt: isFile ? new Date() : null,
      })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.tenantId, ctx.tenantId)));
    if (!isFile) {
      await enqueueInTx(
        tx,
        MEDIA_DERIVE_QUEUE,
        { tenantId: ctx.tenantId, assetId, attempt: 0 },
        { singletonKey: assetId },
      );
    }
  });

  log.info(
    {
      event: 'media.complete',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      assetId,
      kind: row.kind,
      purpose: row.purpose,
      bytes,
      width,
      height,
    },
    'media upload completed',
  );

  const fresh = await loadOwnAsset(ctx, assetId);
  if (!fresh) throw new ApiError(500, 'INTERNAL');
  return assetView(fresh);
}

/**
 * `GET /v1/media/{assetId}/{variant}` (TENANT-04, R-05): ZERO database reads.
 *
 * The key is a pure function of the CALLER's own tenant id and the path parameters, so a tenant-B
 * session asking for a tenant-A assetId looks under `<B>/media/<A's assetId>/…`, which cannot exist:
 * Storage answers object-not-found and the route answers the same `404 NOT_FOUND` a nonexistent id
 * gets — no `Location`, no details payload, nothing naming another community (T-03-01, D-23,
 * SCHEMA-CONVENTIONS §(j): never 403).
 */
export async function serveVariant(
  ctx: Ctx,
  assetId: string,
  variant: string,
): Promise<{ url: string }> {
  if (!parseVariant(variant)) throw new ApiError(400, 'VALIDATION_FAILED');
  const key = mediaKeyFor(ctx.tenantId, assetId, variant);
  if (!key) throw new ApiError(400, 'VALIDATION_FAILED');
  assertTenantKey(key, ctx.tenantId);
  try {
    return { url: await signRead(key) };
  } catch {
    throw new ApiError(404, 'NOT_FOUND');
  }
}

/**
 * `DELETE /v1/media/{assetId}`: a soft delete. The objects survive until the 03-08 sweeper collects
 * the prefix, so the request path stays fast; the row leaves every tenant-lane read immediately
 * (the select policy carries `deleted_at is null`).
 *
 * Two independent predicates, because RLS only supplies the first (T-03-50): the tenant lane makes
 * another community's asset invisible, and `assertMayRetire` makes a FELLOW member's asset
 * unretirable. Without the second, any member could destroy any photo in the community — the ids are
 * published by `GET /v1/members` and the 03-08 sweeper makes the loss irreversible an hour later.
 */
export async function deleteAsset(ctx: Ctx, assetId: string): Promise<MediaAsset> {
  const row = await loadOwnAsset(ctx, assetId);
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  assertMayRetire(ctx, row);

  const updated = await withAdminTx(async (tx) =>
    tx
      .update(mediaAssets)
      .set({ status: 'deleted', deletedAt: new Date() })
      .where(
        and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.tenantId, ctx.tenantId),
          isNull(mediaAssets.deletedAt),
        ),
      )
      .returning({ id: mediaAssets.id }),
  );
  if (updated.length === 0) throw new ApiError(404, 'NOT_FOUND');

  invalidateSignedUrl(mediaAssetPrefix(ctx.tenantId, assetId));

  log.info(
    {
      event: 'media.deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      assetId,
    },
    'media asset deleted',
  );

  return assetView({ ...row, status: 'deleted', deletedAt: new Date() });
}

/**
 * `GET /v1/media/{assetId}/playback` (MEDIA-03, TENANT-04, D-44) — a SHORT-LIVED signed playback
 * credential, minted per request against the CALLER's own membership.
 *
 * The refusal vocabulary is deliberately almost closed (T-03-49): the only distinguishable code is
 * `409 { media: 'not_ready' }`, and it is reachable only for the caller's OWN still-transcoding
 * asset. An unknown id, another community's asset, a soft-deleted row, a `failed`/`rejected` one and
 * a non-video kind ALL take the same bare `404 NOT_FOUND` with no details payload — the foreign row
 * is not "denied", it is invisible to the tenant lane, so the 404 is structural rather than a rule
 * this function has to remember (T-03-46).
 *
 * The token itself is never persisted, never cached and never logged: the log line carries the asset
 * id, the route answers `Cache-Control: no-store`, and the value dies with the response (T-03-47).
 */
export async function playbackTokens(ctx: Ctx, assetId: string): Promise<MediaPlayback> {
  const row = await withTenantTx(ctx, async (tx) => {
    const [found] = await tx
      .select({
        id: mediaAssets.id,
        kind: mediaAssets.kind,
        status: mediaAssets.status,
        playbackId: mediaAssets.playbackId,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1);
    return found;
  });

  // One bare 404 for every miss. Ordered so the ONE extra code below can only ever describe an asset
  // the caller already provably owns.
  if (row?.kind !== 'video') throw new ApiError(404, 'NOT_FOUND');
  if (row.status === 'pending' || row.status === 'processing') {
    throw new ApiError(409, 'CONFLICT', { media: 'not_ready' });
  }
  if (row.status !== 'ready' || !row.playbackId) throw new ApiError(404, 'NOT_FOUND');

  let tokens: Awaited<ReturnType<typeof videoProvider.signPlayback>>;
  try {
    tokens = await videoProvider.signPlayback(row.playbackId, {
      expiresInSeconds: PLAYBACK_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    log.error(
      {
        event: 'media.playback_token_failed',
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        assetId,
        provider: videoProvider.name,
        // A `VideoProviderError` message carries a kind and a status and nothing else (T-03-41).
        err: error instanceof Error ? error.message : String(error),
      },
      'the video provider refused to mint a playback token',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  // The asset id, never the token: this line ends up in Cloud Logging, where a playback credential
  // would be readable by anyone with log access long after the response was discarded.
  log.info(
    {
      event: 'media.playback_token',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      assetId,
    },
    'playback token minted',
  );

  return {
    playbackId: row.playbackId,
    tokens,
    expiresAt: new Date(Date.now() + PLAYBACK_TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
}

/**
 * `GET /v1/media?kind=&purpose=&cursor=&limit=` (MEDIA-03) — one keyset page of the community's
 * assets, newest first.
 *
 * **`admin_tenant` ONLY in V1** (this plan's objective decision). The `media_assets` select policy is
 * tenant-wide because Phase 4's feed needs it, but the LISTING endpoint is an admin surface: a member
 * has no screen that enumerates the community's assets and exposing one would hand every member a
 * browsable inventory of everything ever uploaded (T-03-48). The refusal is checked BEFORE any tenant
 * consideration, so it cannot be used to probe another community either. Phase 4 widens this one
 * predicate when the composer's "pick an existing asset" affordance ships.
 *
 * Ordering is `created_at desc, id desc`, which is the leading pair of
 * `media_assets_tenant_status_created_idx`'s sibling ordering and TOTAL: two assets created in the
 * same microsecond occupy two stable adjacent slots that a page boundary can neither duplicate nor
 * skip. The cursor's `n` is the row's own `created_at`, read back from the projection.
 */
export async function listAssets(ctx: Ctx, query: MediaListQuery): Promise<MediaList> {
  if (ctx.role !== 'admin_tenant') throw new ApiError(403, 'FORBIDDEN');

  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    tx
      .select(ASSET_COLUMNS)
      .from(mediaAssets)
      .where(
        and(
          query.kind ? eq(mediaAssets.kind, query.kind) : undefined,
          query.purpose ? eq(mediaAssets.purpose, query.purpose) : undefined,
          // The tenant predicate is RLS, never the cursor (T-03-52): a tampered envelope can only
          // move the page boundary inside what this lane may already read.
          afterAt
            ? sql`(${mediaAssets.createdAt}, ${mediaAssets.id}) < (${afterAt}::timestamptz, ${afterId}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
      // Over-fetch by one: `nextCursor` is non-null EXACTLY when another row exists, so the screen
      // never renders a "Carregar mais" that comes back empty.
      .limit(limit + 1),
  );

  const page = (rows as AssetRow[]).slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ n: last.createdAt.toISOString(), id: last.id })
      : null;

  log.info(
    {
      event: 'media.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      kind: query.kind ?? null,
      purpose: query.purpose ?? null,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'media assets listed',
  );

  return { items: page.map(assetView), nextCursor };
}

export type DeriveOutcome = { outcome: 'derived' | 'skipped' | 'gone'; widths: number[] };

/**
 * The worker's half (MEDIA-02): download the original, derive the purpose's WebP ladder under
 * immutable keys, record the widths and flip the row to `ready`.
 *
 * Safe to run twice: `w<width>.webp` for a given assetId always carries the same content, so a
 * re-run upserts the same objects. The final update is conditional on `status in
 * ('processing','ready')`, so a row soft-deleted or rejected meanwhile is never resurrected.
 */
export async function deriveAssetVariants(
  tenantId: string,
  assetId: string,
): Promise<DeriveOutcome> {
  const row = await withAdminTx(async (tx) => {
    const [found] = await tx
      .select(ASSET_COLUMNS)
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.tenantId, tenantId)))
      .limit(1);
    return found as AssetRow | undefined;
  });
  if (!row || row.deletedAt || row.status === 'deleted' || row.status === 'rejected') {
    return { outcome: 'gone', widths: [] };
  }
  if (row.kind !== 'image') return { outcome: 'skipped', widths: [] };

  const t0 = Date.now();
  const originalKey = mediaOriginalKey(tenantId, assetId);
  assertTenantKey(originalKey, tenantId);
  const buf = await downloadObject(originalKey);
  if (!buf) return { outcome: 'gone', widths: [] };

  const probed = await probeSize(buf);
  // The ladder depends on the PURPOSE alone, never on `probed.width` (T-03-51): the serving URLs an
  // asset answers must be knowable from a payload that carries only its id. `deriveVariants` resizes
  // with `withoutEnlargement`, so a rung above the source is the source, not an upscale.
  const widths = widthsForPurpose(row.purpose as MediaPurpose);
  const derived = await deriveVariants(buf, widths);

  await mediaInternals.beforeVariantWrite();

  for (const variant of derived) {
    const key = mediaVariantKey(tenantId, assetId, variant.width);
    assertTenantKey(key, tenantId);
    await putObject(key, variant.body, {
      contentType: 'image/webp',
      cacheControl: MEDIA_VARIANT_CACHE_CONTROL,
    });
  }

  const producedWidths = derived.map((variant) => variant.width);
  const updated = await withAdminTx(async (tx) =>
    tx
      .update(mediaAssets)
      .set({
        variantWidths: producedWidths,
        width: probed.width,
        height: probed.height,
        status: 'ready',
        readyAt: new Date(),
      })
      .where(
        and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.tenantId, tenantId),
          isNull(mediaAssets.deletedAt),
          inArray(mediaAssets.status, ['processing', 'ready']),
        ),
      )
      .returning({ id: mediaAssets.id }),
  );
  if (updated.length === 0) return { outcome: 'skipped', widths: producedWidths };

  log.info(
    {
      event: 'media.variants_derived',
      tenantId,
      assetId,
      widths: producedWidths,
      ms: Date.now() - t0,
    },
    'media variants derived',
  );
  return { outcome: 'derived', widths: producedWidths };
}

/**
 * Queues the NEXT orphan sweep (03-08, R-07). Called from exactly two places: once when the worker
 * starts, and by `kernel.media-sweep-orphans` itself at the end of every run. Together those two are
 * the whole cadence — `boss.schedule()` stays unused in this codebase, and `kernel.domain-verify`
 * paces itself the same way (`jobs/boss.ts`, the `startAfter` paragraph of the `enqueueInTx`
 * docblock). One mechanism for periodic work, so the one the team already debugs is the one this
 * uses.
 *
 * The `singletonKey` is the CONSTANT `MEDIA_SWEEP_SINGLETON`: under `QUEUE_POLICY = 'short'` a
 * second arm while the first is still `created` is dropped by the `job_i1` partial unique index and
 * `send` returns `null`, so a worker restart that races a run's own re-arm cannot double the
 * cadence. Returns whether THIS call is the one that queued the job (a `null` id is the dropped
 * duplicate, which is a success, not a failure).
 */
export async function armSweeper(): Promise<boolean> {
  const id = await withAdminTx(async (tx) =>
    enqueueInTx(
      tx,
      MEDIA_SWEEP_QUEUE,
      {},
      { singletonKey: MEDIA_SWEEP_SINGLETON, startAfter: MEDIA_SWEEP_INTERVAL_S },
    ),
  );
  return id !== null;
}

/** What `purgeAsset` needs off a row; the sweeper selects exactly these four columns. */
export type PurgeableAsset = {
  id: string;
  tenantId: string;
  kind: string;
  providerAssetId: string | null;
};

export type PurgeOutcome = { purged: boolean; objects: number };

/**
 * Removes EVERY trace of one collected asset (03-08). The ordering is the whole contract, and it is
 * deliberate:
 *
 *   1. the Storage objects under `<tenant_id>/media/<assetId>/` — the original AND every derived
 *      `w<width>.webp`, listed rather than guessed, so a ladder that changed since the derivation
 *      still leaves nothing behind;
 *   2. the in-process signed-URL memo for that prefix, so no instance can hand out a URL to an
 *      object that no longer exists;
 *   3. the provider-side asset, when the row carries a `provider_asset_id` (a Mux/fake video);
 *   4. and only THEN the `media_assets` row.
 *
 * The row dies LAST because it is the only pointer to the bytes. Deleting it first and then failing
 * would leave unreferenced objects the tenant is still billed for and nothing left to find them by.
 * In this order a Storage or provider failure returns early and leaves a row the NEXT run collects
 * again — the "a failure leaves a recoverable state" discipline 02-09 established for `checkDomain`.
 * Everything here is therefore safe to re-run: an already-empty prefix and an already-deleted
 * provider asset both converge on the same end state.
 */
export async function purgeAsset(row: PurgeableAsset): Promise<PurgeOutcome> {
  const prefix = mediaAssetPrefix(row.tenantId, row.id);
  // The prefix itself is not a key; assert the one key that always exists under it, which is what
  // pins the whole listing to this tenant's own space before any Storage call (T-03-55).
  assertTenantKey(mediaOriginalKey(row.tenantId, row.id), row.tenantId);

  let keys: string[];
  try {
    keys = await listObjects(prefix);
  } catch (error) {
    log.warn(
      {
        event: 'media.purge.list_failed',
        tenantId: row.tenantId,
        assetId: row.id,
        err: error instanceof Error ? error.message : String(error),
      },
      'could not list the asset prefix; the row is left for the next sweep',
    );
    return { purged: false, objects: 0 };
  }

  if (keys.length > 0) {
    for (const key of keys) assertTenantKey(key, row.tenantId);
    try {
      await removeObjects(keys);
    } catch (error) {
      log.warn(
        {
          event: 'media.purge.storage_failed',
          tenantId: row.tenantId,
          assetId: row.id,
          objects: keys.length,
          err: error instanceof Error ? error.message : String(error),
        },
        'could not remove the asset objects; the row is left for the next sweep',
      );
      return { purged: false, objects: 0 };
    }
  }
  // The prefix form drops every memoised variant URL in one call (`storage.ts:invalidateSignedUrl`).
  invalidateSignedUrl(prefix);

  if (row.providerAssetId && row.kind === 'video') {
    try {
      await videoProvider.deleteAsset(row.providerAssetId);
    } catch (error) {
      log.warn(
        {
          event: 'media.purge.provider_failed',
          tenantId: row.tenantId,
          assetId: row.id,
          kind: row.kind,
          err: error instanceof Error ? error.message : String(error),
        },
        'the provider refused to delete the asset; the row is left for the next sweep',
      );
      return { purged: false, objects: keys.length };
    }
  }

  await withAdminTx(async (tx) =>
    tx
      .delete(mediaAssets)
      .where(and(eq(mediaAssets.id, row.id), eq(mediaAssets.tenantId, row.tenantId))),
  );

  log.info(
    {
      event: 'media.purged',
      tenantId: row.tenantId,
      assetId: row.id,
      objects: keys.length,
      hadProviderAsset: Boolean(row.providerAssetId),
    },
    'media asset purged',
  );
  return { purged: true, objects: keys.length };
}
