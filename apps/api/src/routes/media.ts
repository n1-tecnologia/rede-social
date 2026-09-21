import { createRoute, z } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@tria/contracts';
import {
  mediaAssetSchema,
  mediaStartBodySchema,
  mediaStartSchema,
  mediaVariantParamSchema,
} from '@tria/contracts/media';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import {
  completeUpload,
  deleteAsset,
  serveVariant,
  startUpload,
} from '@tria/core/server/media/service';
import { createOpenApiApp } from '../http/openapi';

/**
 * `/v1/media/*` (MEDIA-01, MEDIA-02, TENANT-04) — the tenant-lane media broker.
 *
 * TENANT LANE ONLY: every handler runs behind `requireAuth`, so `ctx.tenantId` is the membership of
 * record. A `super_admin` has no membership and therefore no business here (RESEARCH Pitfall 8); the
 * platform branding path stays in the platform lane and is deliberately not migrated into the broker.
 *
 * There is NO request-body parser for file bytes anywhere in this file (CLAUDE.md §4, Cloud Run's
 * 32 MiB HTTP/1 cap): `POST /uploads` answers a signed Storage target, the browser uploads directly,
 * and `POST /uploads/{assetId}/complete` confirms. `/uploads` is declared BEFORE
 * `/{assetId}/{variant}` so the literal segment wins the match.
 */
const media = createOpenApiApp();
media.use('*', requireAuth);

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

const assetResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: mediaAssetSchema } },
});

const assetParams = z.object({ assetId: z.uuid() });
const variantParams = z.object({ assetId: z.uuid(), variant: mediaVariantParamSchema });

const startRoute = createRoute({
  method: 'post',
  path: '/uploads',
  request: {
    body: { content: { 'application/json': { schema: mediaStartBodySchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'A signed Storage target for `<tenant_id>/media/<assetId>/original` in the PRIVATE media bucket; PUT the bytes there below `resumableThresholdBytes`, TUS above it (`token` goes in `x-signature`, `path` is the objectName), then confirm with complete',
      content: { 'application/json': { schema: mediaStartSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED { media: "type_not_allowed" | "heic_unsupported" } — the (kind, purpose) pair or the declared mime is not accepted',
    ),
    413: envelope(
      'VALIDATION_FAILED { media: "too_large", maxBytes } above the kind+purpose cap, or { media: "quota_exceeded" } when the tenant storage ceiling is reached (no row is created)',
    ),
    501: envelope('NOT_IMPLEMENTED { media: "video_provider_missing" } — video lands in 03-06'),
  },
});

const completeRoute = createRoute({
  method: 'post',
  path: '/uploads/{assetId}/complete',
  request: { params: assetParams },
  responses: {
    200: assetResponse(
      'The object was verified (size, content type, image header) and recorded; an image is `processing` with ONE kernel.media-derive-variants job enqueued (variants follow once the worker ran), a file is `ready`. Idempotent: a second call answers the same body and enqueues nothing',
    ),
    400: envelope(
      'VALIDATION_FAILED { media: "not_an_image" | "format_mismatch" | "heic_unsupported" | "too_large" } — the object was removed; pick another file',
    ),
    404: envelope(
      'NOT_FOUND { media: "object_missing" } — no such asset for this community, or the upload never happened',
    ),
  },
});

const variantRoute = createRoute({
  method: 'get',
  path: '/{assetId}/{variant}',
  request: { params: variantParams },
  responses: {
    302: {
      description:
        'Location: a freshly signed Storage URL valid one hour, with Cache-Control: private, max-age=1500. No database read happens here: the key is built from the caller own community id',
    },
    400: envelope('VALIDATION_FAILED — the variant is not `original` or a known `w<width>`'),
    404: envelope(
      'NOT_FOUND — no such object under the caller own community prefix. Identical answer for a nonexistent id and for another community asset',
    ),
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{assetId}',
  request: { params: assetParams },
  responses: {
    200: assetResponse('Soft-deleted: invisible to every read; the objects go with the sweeper'),
    404: envelope('NOT_FOUND — no such asset for this community'),
  },
});

export const mediaRoutes = media
  .openapi(startRoute, async (c) => {
    const ctx = c.get('ctx');
    const body = c.req.valid('json');
    const start = await startUpload(ctx, body);
    c.header('Cache-Control', 'no-store');
    return c.json(start, 201);
  })
  .openapi(completeRoute, async (c) => {
    const ctx = c.get('ctx');
    const { assetId } = c.req.valid('param');
    const asset = await completeUpload(ctx, assetId);
    c.header('Cache-Control', 'no-store');
    return c.json(asset, 200);
  })
  .openapi(variantRoute, async (c) => {
    const ctx = c.get('ctx');
    const { assetId, variant } = c.req.valid('param');
    const { url } = await serveVariant(ctx, assetId, variant);
    // Private: the redirect is per-member and must never reach a shared cache. 1500 s sits well
    // inside the signed URL's hour, so a cached redirect can never point at an expired target.
    c.header('Cache-Control', 'private, max-age=1500');
    c.header('Location', url);
    return c.body(null, 302);
  })
  .openapi(deleteRoute, async (c) => {
    const ctx = c.get('ctx');
    const { assetId } = c.req.valid('param');
    const asset = await deleteAsset(ctx, assetId);
    c.header('Cache-Control', 'no-store');
    return c.json(asset, 200);
  });
