import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  apiErrorEnvelopeSchema,
  brandingColorsBodySchema,
  brandingLookBodySchema,
  brandingUploadBodySchema,
  brandingUploadParamsSchema,
  brandingUploadSchema,
  type PlatformTenantDetail,
  platformTenantDetailSchema,
} from '@rede-social/contracts';
import { ApiError } from '@rede-social/core/server/http/api-error';
import {
  completeBrandingUpload,
  removeIconOverride,
  setBrandingColors,
  setBrandingLook,
  startBrandingUpload,
} from '@rede-social/core/server/platform/branding';
import type { PlatformEnv } from '@rede-social/core/server/platform/require-super-admin';
import { getTenantDetail } from '@rede-social/core/server/platform/tenants';
import { platformDefaultHook } from '../../http/openapi';

/**
 * `/v1/platform/tenants/{id}/branding/*` — D-27/D-28/D-25/D-41 brand mutations, and since
 * 2026-10-03 the look beyond the pair (`PUT …/branding/look`, see `lookRoute`). Mounted by
 * `routes/platform/index.ts`, whose `requireSuperAdmin()` guards every handler here (ROLE-03); the
 * service builds every Storage key from the path tenant id, so nothing here can reach another
 * tenant's prefix (T-02-83/T-02-84).
 *
 * Uploads never pass through this API (CLAUDE.md §4, Cloud Run 32 MiB cap): the browser PUTs the
 * file straight to the signed Storage URL, then completes. Every answer is `Cache-Control:
 * no-store` and every mutation logs `platform.branding.<verb>` with `{ userId, requestId, tenantId }`
 * (T-02-87; the audit table is Phase 8). Mutations answer the fresh strict detail.
 */
const branding = new OpenAPIHono<PlatformEnv>({ defaultHook: platformDefaultHook });

const idParams = z.object({ id: z.uuid() });

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});
const detailResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: platformTenantDetailSchema } },
});

async function detailOr404(id: string): Promise<PlatformTenantDetail> {
  const detail = await getTenantDetail(id);
  if (!detail) throw new ApiError(404, 'NOT_FOUND');
  return detail;
}

const uploadStartRoute = createRoute({
  method: 'post',
  path: '/tenants/{id}/branding/uploads',
  request: {
    params: idParams,
    body: {
      content: { 'application/json': { schema: brandingUploadBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description:
        'A signed Storage URL (valid 2 h) for `<tenant_id>/branding/<uuid>.<ext>` in the public branding bucket; PUT the file there with `content-type` + `x-upsert: false`, then complete with `uploadId`',
      content: { 'application/json': { schema: brandingUploadSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED — kind not logo/icon, mime outside png/svg+xml/webp/jpeg, size not a positive integer',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
    413: envelope('VALIDATION_FAILED { size: "too_large", maxBytes } — above 2 MiB'),
  },
});

const uploadCompleteRoute = createRoute({
  method: 'post',
  path: '/tenants/{id}/branding/uploads/{uploadId}/complete',
  request: { params: brandingUploadParamsSchema },
  responses: {
    200: detailResponse(
      'The object was verified (size, content type, image header) and recorded as logoUrl (kind logo) or iconUrl (kind icon); iconVersion bumped and ONE kernel.branding-derive-icons job enqueued — iconUrls follow once the worker ran',
    ),
    400: envelope(
      'VALIDATION_FAILED { upload: "not_an_image" | "format_mismatch" | "svg_unsafe" | "too_large" } — the object was removed; pick another file',
    ),
    403: envelope('Not a platform admin'),
    404: envelope(
      'No such tenant, or NOT_FOUND { upload: "object_missing" } — the PUT never happened, expired or targeted another tenant',
    ),
  },
});

const colorsRoute = createRoute({
  method: 'put',
  path: '/tenants/{id}/branding/colors',
  request: {
    params: idParams,
    body: {
      content: { 'application/json': { schema: brandingColorsBodySchema } },
      required: true,
    },
  },
  responses: {
    200: detailResponse(
      'The two source colours persisted with their derivations (tenant.branding.colors) and the contrast report in both modes (tenant.contrast); a primary change bumps iconVersion and re-derives the maskable icon',
    ),
    400: envelope(
      'VALIDATION_FAILED — a malformed colour, or { confirmLowContrast: "required", contrastReport } when a check fails and the body did not carry confirmLowContrast: true (nothing persisted; re-submit with the flag after the user confirms)',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

/**
 * The look beyond the pair (2026-10-03): a SIBLING of `PUT …/branding/colors`, not more fields on
 * it, because the two writes share nothing but the jsonb. The colours route is the D-41 contrast
 * gate (its strict pair, the 400 `confirmLowContrast` round trip) and the icon path (a primary
 * change bumps `iconVersion` and re-derives the maskable icon); the look gates on nothing, feeds no
 * icon, and is ONE whole (a PUT of the complete look, every key left out being the system's value),
 * which optional fields on the colours body would have turned into keep-or-reset guesswork. The
 * panel saves each with its own button, so neither save carries the other's half-edited state.
 */
const lookRoute = createRoute({
  method: 'put',
  path: '/tenants/{id}/branding/look',
  request: {
    params: idParams,
    body: {
      content: { 'application/json': { schema: brandingLookBodySchema } },
      required: true,
    },
  },
  responses: {
    200: detailResponse(
      'The whole look stored in its canonical form (tenant.branding.look: the default tones and Manrope as null); colors.primaryDark / onPrimaryDark follow the dark mode own primary (or the derivation); logo, icons, iconVersion and the pair untouched; no icon derivation, no contrast gate',
    ),
    400: envelope(
      'VALIDATION_FAILED { issues } — an unknown key at any level, a colour that is not #rrggbb, a tone outside the two fixed lists, a style other than solid/gradient, or a font family name that is not ASCII letters and digits in single-spaced words (max 60)',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

const removeIconRoute = createRoute({
  method: 'delete',
  path: '/tenants/{id}/branding/icon',
  request: { params: idParams },
  responses: {
    200: detailResponse(
      'The square-icon override removed (iconUrl null, iconVersion bumped, the set re-derived from the logo by the worker); unchanged when there was no override',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

export const brandingRoutes = branding
  .openapi(uploadStartRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const upload = await startBrandingUpload(id, body, { userId, logger: c.get('logger') });

    c.get('logger').info(
      {
        event: 'platform.branding.upload_start',
        userId,
        requestId,
        tenantId: id,
        kind: body.kind,
        path: upload.path,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(upload, 201);
  })
  .openapi(uploadCompleteRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id, uploadId } = c.req.valid('param');

    const { iconVersion } = await completeBrandingUpload(id, uploadId, {
      userId,
      logger: c.get('logger'),
    });
    const detail = await detailOr404(id);

    c.get('logger').info(
      {
        event: 'platform.branding.complete',
        userId,
        requestId,
        tenantId: id,
        uploadId,
        iconVersion,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(detail, 200);
  })
  .openapi(colorsRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const applied = await setBrandingColors(id, body, { userId, logger: c.get('logger') });
    const detail = await detailOr404(id);

    c.get('logger').info(
      {
        event: 'platform.branding.colors',
        userId,
        requestId,
        tenantId: id,
        rederive: applied.rederive,
        iconVersion: applied.branding.iconVersion,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(detail, 200);
  })
  .openapi(lookRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const saved = await setBrandingLook(id, body, { userId, logger: c.get('logger') });
    const detail = await detailOr404(id);

    c.get('logger').info(
      {
        event: 'platform.branding.look',
        userId,
        requestId,
        tenantId: id,
        buttonStyle: saved.look.buttonColors.style,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(detail, 200);
  })
  .openapi(removeIconRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');

    const result = await removeIconOverride(id, { userId, logger: c.get('logger') });
    const detail = await detailOr404(id);

    c.get('logger').info(
      {
        event: 'platform.branding.icon_removed',
        userId,
        requestId,
        tenantId: id,
        removed: result.removed,
        iconVersion: result.iconVersion,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(detail, 200);
  });
