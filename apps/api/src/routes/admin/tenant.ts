import { createRoute } from '@hono/zod-openapi';
import {
  adminBrandingSchema,
  adminTenantBodySchema,
  apiErrorEnvelopeSchema,
  type DisplayNameIssue,
} from '@rede-social/contracts';
import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { updateTenant } from '@rede-social/core/server/platform/tenants';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import type { ZodError } from 'zod';
import { createOpenApiApp, platformDefaultHook } from '../../http/openapi';
import { brandOf } from './branding';

/**
 * `PATCH /v1/admin/tenant` (ADMIN-01, UI-D-279, T-08-32) — the admin renames their own community.
 *
 * The body is `adminTenantBodySchema`: `{ displayName }` and NOTHING else (strict), so status, slug,
 * modules and domains are unreachable from the tenant lane — a body that carries any of them is a
 * 400 before the handler runs. The name rule is the platform's own (`tenantDisplayNameSchema`, ADMIN-01
 * encoding), and the write is the platform's `updateTenant`, called with `ctx.tenantId` (the
 * membership `requireAuth` resolved; no tenant id in the path or the body). `updateTenant` drops every
 * host of the tenant from the host cache after commit, like a platform rename.
 *
 * A name refusal answers `details.displayName` (`required` for empty or spaces-only, `too_long` above
 * 60) instead of the generic issue list, so the name card can say which; any other validation failure
 * (an unknown key) keeps the shared issue list. `tenant.manage` is the gate (D-338); support and
 * member get 403. The answer is the tenant lane's brand (`adminBrandingSchema`), `no-store`.
 */
const tenant = createOpenApiApp();
tenant.use('*', requireAuth);

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

/** Maps a refusal that is ONLY about the name to `{ displayName }`; anything else is the shared hook. */
const displayNameHook = (result: { success: boolean; error?: ZodError }): undefined => {
  if (result.success) return undefined;
  const issues = result.error?.issues ?? [];
  const onName = issues.filter((issue) => issue.path[0] === 'displayName');
  if (onName.length > 0 && onName.length === issues.length) {
    const reason: DisplayNameIssue = onName.some((issue) => issue.code === 'too_big')
      ? 'too_long'
      : 'required';
    throw new ApiError(400, 'VALIDATION_FAILED', { displayName: reason });
  }
  platformDefaultHook(result);
  return undefined;
};

const patchRoute = createRoute({
  method: 'patch',
  path: '/',
  middleware: [requirePermission(KERNEL_PERMISSIONS.tenantManage)] as const,
  request: {
    body: {
      content: { 'application/json': { schema: adminTenantBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        "The caller's tenant brand after the rename (the new display name, the unchanged branding and contrast report)",
      content: { 'application/json': { schema: adminBrandingSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED — `{ displayName: "required" }` (empty or spaces only), `{ displayName: "too_long" }` (over 60 characters), or the issue list for any other key (status, slug, modules, domains … are not accepted)',
    ),
    403: envelope('FORBIDDEN — the caller does not hold `tenant.manage` in this tenant'),
  },
});

export const adminTenantRoutes = tenant.openapi(
  patchRoute,
  async (c) => {
    const ctx = c.get('ctx');
    const { displayName } = c.req.valid('json');
    await updateTenant(
      ctx.tenantId,
      { displayName },
      { userId: ctx.userId, logger: c.get('logger') },
    );
    const body = await brandOf(ctx.tenantId);
    c.get('logger')?.info(
      { event: 'admin.tenant.rename', userId: ctx.userId, tenantId: ctx.tenantId },
      'tenant display name saved',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  },
  displayNameHook,
);
