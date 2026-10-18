import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { requireRole } from '@rede-social/core/server/rbac/require-role';
import { ownerOverviewAnswerSchema } from '../contracts/index';
import { getOwnerOverview } from './overview';

/**
 * The dashboard's routes (08.7-01). The module owns its guard chain, so the mount in
 * `apps/api/src/app.ts` is a plain `.route('/v1/dashboard', dashboardRoutes)` and cannot forget one:
 * `requireAuth` (401; a session on another tenant's host is 403 `TENANT_HOST_MISMATCH`), then a
 * per-route `requireRole('admin_tenant')` on every owner read (403 `FORBIDDEN` for a member or the
 * support team, D-462). The dashboard has no ModuleKey (it is not a tenant toggle), so there is no
 * `requireModule` here; the area routes of later plans add the module of their area
 * (`requireModule('events')`, …) BEFORE the role, the ROLE-06 order.
 *
 * Every answer is `Cache-Control: no-store`: a number of the tenant's business never sits in a
 * shared cache. The admin-only RLS of `dashboard_snapshots` stands behind the role check.
 */
const dashboard = new OpenAPIHono<AppEnv>();

dashboard.use('*', requireAuth);

export const ownerOverviewRoute = createRoute({
  method: 'get',
  path: '/owner/overview',
  middleware: [requireRole('admin_tenant')] as const,
  responses: {
    200: {
      description:
        "The owner's Visão geral from the tenant's newest snapshot (built once a day after the tenant's local midnight, windows ending at the end of that day): `{ state: 'preparing' }` before the first build, else `{ state: 'ready', snapshot: { day, builtAt, windows }, members: { count, newMembers, previous } }` as raw integers (the client derives the change). No name ever travels in it.",
      content: { 'application/json': { schema: ownerOverviewAnswerSchema } },
    },
    401: { description: '`UNAUTHENTICATED`: no session.' },
    403: {
      description:
        '`FORBIDDEN` for any role but `admin_tenant`; `TENANT_HOST_MISMATCH` for a session of another tenant.',
    },
  },
});

export const dashboardRoutes = dashboard.openapi(ownerOverviewRoute, async (c) => {
  const answer = await getOwnerOverview(c.get('ctx'));
  c.header('Cache-Control', 'no-store');
  return c.json(ownerOverviewAnswerSchema.parse(answer), 200);
});
