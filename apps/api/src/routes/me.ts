import { createRoute } from '@hono/zod-openapi';
import { type Bootstrap, bootstrapSchema, TENANT_ROLES } from '@tria/contracts';
import { memberships, tenants, users } from '@tria/core/db/schema';
import { withTenantTx } from '@tria/core/db/tenant-tx';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { eq } from 'drizzle-orm';
import { createOpenApiApp } from '../http/openapi';

const me = createOpenApiApp();
me.use('*', requireAuth);

const isTenantRole = (value: string): value is Bootstrap['membership']['role'] =>
  (TENANT_ROLES as readonly string[]).includes(value);
const isStatus = (value: string): value is Bootstrap['membership']['status'] =>
  value === 'active' || value === 'blocked' || value === 'invited';

/** `GET /v1/me/bootstrap` — everything is read inside the tenant lane, scoped by the membership's tenant. */
export const meRoutes = me.openapi(
  createRoute({
    method: 'get',
    path: '/bootstrap',
    responses: {
      200: {
        description: 'Current user, membership, tenant and enabled modules',
        content: { 'application/json': { schema: bootstrapSchema } },
      },
    },
  }),
  async (c) => {
    const ctx = c.get('ctx');

    const data = await withTenantTx(ctx, async (tx) => {
      const [tenant] = await tx
        .select({
          id: tenants.id,
          slug: tenants.slug,
          displayName: tenants.displayName,
          branding: tenants.branding,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      const [user] = await tx
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1);
      const [membership] = await tx
        .select({ role: memberships.role, status: memberships.status })
        .from(memberships)
        .where(eq(memberships.userId, ctx.userId))
        .limit(1);
      return { tenant, user, membership };
    });

    const { tenant, user, membership } = data;
    if (!tenant || !user || !membership) throw new ApiError(500, 'INTERNAL');
    if (!isTenantRole(membership.role) || !isStatus(membership.status)) {
      throw new ApiError(500, 'INTERNAL');
    }

    const body: Bootstrap = {
      user: { id: user.id, email: user.email, name: user.name },
      membership: {
        tenantId: tenant.id,
        role: membership.role,
        status: membership.status,
        profile: { displayName: user.name, avatarUrl: null, bio: null },
      },
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        displayName: tenant.displayName,
        branding: {
          logoUrl: tenant.branding.logoUrl ?? null,
          faviconUrl: tenant.branding.faviconUrl ?? null,
          colors: tenant.branding.colors ?? {},
        },
      },
      // Plan 01-06 fills modules/permissions from tenant_modules + the module registry.
      modules: [],
      permissions: [],
      counters: { unreadNotifications: 0, unreadConversations: 0 },
    };
    return c.json(body, 200);
  },
);
