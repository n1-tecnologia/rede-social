import { createRoute } from '@hono/zod-openapi';
import {
  type AdminBranding,
  adminBrandingSchema,
  apiErrorEnvelopeSchema,
  brandingColorsBodySchema,
} from '@rede-social/contracts';
import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { setBrandingColors } from '@rede-social/core/server/platform/branding';
import { getTenantDetail } from '@rede-social/core/server/platform/tenants';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import { createOpenApiApp } from '../../http/openapi';

/**
 * `/v1/admin/branding/*` (ADMIN-01, D-342, UI-D-279) — the `admin_tenant` edits their OWN brand with
 * the super_admin's editor and the super_admin's kernel services, unchanged.
 *
 * TENANT OF RECORD ONLY (T-08-31): no path, query or body of this router carries a tenant id. Every
 * handler passes `ctx.tenantId` — the membership `requireAuth` resolved — to the same services the
 * platform lane calls with its path id (`setBrandingColors`, and in the uploads `startBrandingUpload`,
 * `completeBrandingUpload`, `removeIconOverride`). Those services build every Storage key from the
 * tenant id they receive, so nothing here can reach another tenant's prefix, and they invalidate every
 * host of the tenant after commit (`invalidateAllTenantHosts`), exactly as on the platform lane. A
 * session on another tenant's host is 403 `TENANT_HOST_MISMATCH` before any of this runs.
 *
 * PERMISSION, NEVER ROLE (D-338): every route needs `tenant.manage`; support and member get 403
 * `FORBIDDEN`. The same contrast gate applies (a failing pair without `confirmLowContrast: true` is
 * the 400 `{ confirmLowContrast: 'required', contrastReport }` the platform route answers), and both
 * lanes write the same columns, so whichever save comes last wins (D-342).
 *
 * Answers are the three brand facts only (`adminBrandingSchema`), never the platform detail. Every
 * answer is `no-store`; log lines carry ids and versions only.
 */
const branding = createOpenApiApp();
branding.use('*', requireAuth);

const manage = requirePermission(KERNEL_PERMISSIONS.tenantManage);

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});
const brandResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: adminBrandingSchema } },
});

/** The caller's tenant brand, read through the platform service with the SESSION's tenant id. */
async function brandOf(tenantId: string): Promise<AdminBranding> {
  const detail = await getTenantDetail(tenantId);
  if (!detail) throw new ApiError(404, 'NOT_FOUND');
  const { displayName, branding: stored, contrast } = detail.tenant;
  return { tenant: { displayName, branding: stored, contrast } };
}

const readRoute = createRoute({
  method: 'get',
  path: '/',
  middleware: [manage] as const,
  responses: {
    200: brandResponse(
      "The caller's tenant brand: display name, the stored branding (logo, square override, derived icons, iconVersion, colours) and the both-modes contrast report",
    ),
    403: envelope('FORBIDDEN — the caller does not hold `tenant.manage` in this tenant'),
  },
});

const colorsRoute = createRoute({
  method: 'put',
  path: '/colors',
  middleware: [manage] as const,
  request: {
    body: {
      content: { 'application/json': { schema: brandingColorsBodySchema } },
      required: true,
    },
  },
  responses: {
    200: brandResponse(
      'The two source colours persisted with their derivations and the contrast report in both modes; a primary change bumps iconVersion and re-derives the maskable icon',
    ),
    400: envelope(
      'VALIDATION_FAILED — a malformed colour, or { confirmLowContrast: "required", contrastReport } when a check fails and the body did not carry confirmLowContrast: true (nothing persisted)',
    ),
    403: envelope('FORBIDDEN — the caller does not hold `tenant.manage` in this tenant'),
  },
});

export const adminBrandingRoutes = branding
  .openapi(readRoute, async (c) => {
    const body = await brandOf(c.get('ctx').tenantId);
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  })
  .openapi(colorsRoute, async (c) => {
    const ctx = c.get('ctx');
    const applied = await setBrandingColors(ctx.tenantId, c.req.valid('json'), {
      userId: ctx.userId,
      logger: c.get('logger'),
    });
    const body = await brandOf(ctx.tenantId);
    c.get('logger')?.info(
      {
        event: 'admin.branding.colors',
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        rederive: applied.rederive,
        iconVersion: applied.branding.iconVersion,
      },
      'tenant brand colours saved',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  });
