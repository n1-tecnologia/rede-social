import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  apiErrorEnvelopeSchema,
  type PlatformTenants,
  platformTenantsSchema,
} from '@tria/contracts';
import { ApiError } from '@tria/core/server/http/api-error';
import {
  type PlatformEnv,
  requireSuperAdmin,
} from '@tria/core/server/platform/require-super-admin';
import { listPlatformTenants } from '@tria/core/server/platform/tenants';

/**
 * The platform lane (ROLE-01, D-21/D-23). Its own `OpenAPIHono` because its environment is
 * `PlatformEnv`, not `AppEnv`: there is no `ctx` here — a `super_admin` has no membership and no
 * tenant, which is the whole point of keeping TRIA staff out of `memberships`.
 *
 * `requireSuperAdmin()` (never `requireAuth`, which would answer 403 NO_MEMBERSHIP first) guards
 * every path, and it also refuses a registered tenant host with 403 TENANT_HOST_MISMATCH.
 */
const platform = new OpenAPIHono<PlatformEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

platform.use('*', requireSuperAdmin());

/** `GET /v1/platform/tenants` — every community and which modules it has on (Phase 2's panel reads it too). */
export const platformRoutes = platform.openapi(
  createRoute({
    method: 'get',
    path: '/tenants',
    responses: {
      200: {
        description: 'Every tenant with its enabled modules (super_admin only)',
        content: { 'application/json': { schema: platformTenantsSchema } },
      },
      403: {
        description: 'Not a platform admin, or a platform session on a tenant host (D-23)',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  }),
  async (c) => {
    const { userId, requestId } = c.get('platformCtx');

    const rows = await listPlatformTenants();
    const body: PlatformTenants = {
      tenants: rows.map((t) => ({
        id: t.id,
        slug: t.slug,
        displayName: t.displayName,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        enabledModules: t.enabledModules,
      })),
    };

    // Cross-tenant reads are audited from day one (T-06-05; the full audit log is Phase 8).
    c.get('logger').info(
      { event: 'platform.tenants.list', userId, requestId, count: body.tenants.length },
      'platform read',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  },
);
