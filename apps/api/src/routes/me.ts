import { createRoute } from '@hono/zod-openapi';
import {
  acceptInviteBodySchema,
  acceptInviteResponseSchema,
  apiErrorEnvelopeSchema,
  type Bootstrap,
  bootstrapSchema,
  resolveBranding,
  TENANT_ROLES,
} from '@tria/contracts';
import { memberships, tenants, users } from '@tria/core/db/schema';
import { withTenantTx } from '@tria/core/db/tenant-tx';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
import { acceptInvite } from '@tria/core/server/tenancy/accept-invite';
import { eq } from 'drizzle-orm';
import { createOpenApiApp } from '../http/openapi';
import { enabledModulesForBootstrap, permissionsFor } from '../modules/registry';

const me = createOpenApiApp();
me.use('*', requireAuth);

const isTenantRole = (value: string): value is Bootstrap['membership']['role'] =>
  (TENANT_ROLES as readonly string[]).includes(value);
const isStatus = (value: string): value is Bootstrap['membership']['status'] =>
  value === 'active' || value === 'blocked' || value === 'invited';

/** `X-Client-IP` is set by the web server action from Vercel's `x-real-ip` (T-04-03: trusted hop only). */
const CLIENT_IP_HEADER = 'X-Client-IP';

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

/**
 * `POST /v1/me/accept-invite` (ROLE-03, D-29): the invited first admin accepts the tenant rules and
 * TRIA's terms. The tenant and the user come ONLY from `ctx` — the verified Bearer and its membership
 * — never from the body; the body carries the two consent versions and nothing else. The password
 * was set through Supabase by the web action before this call and never reaches the API (D-10).
 * `requireAuth` lets an `invited` membership reach exactly this route and `/bootstrap`.
 */
const acceptInviteRoute = createRoute({
  method: 'post',
  path: '/accept-invite',
  request: {
    body: { content: { 'application/json': { schema: acceptInviteBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: 'Membership active, both consents recorded, invite accepted; where to land',
      content: { 'application/json': { schema: acceptInviteResponseSchema } },
    },
    400: envelope('Stale consent versions ({ consents: "stale" }) or invalid payload'),
    403: envelope("Not the caller's own invited membership / host mismatch"),
    409: envelope('Membership is not invited (INVITE_STATE_INVALID { reason: "not_invited" })'),
  },
});

/** `GET /v1/me/bootstrap` — everything is read inside the tenant lane, scoped by the membership's tenant. */
export const meRoutes = me
  .openapi(
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

      // The flags come from the same tenant lane, through the 30 s cache (ROLE-06 concurrency).
      const flags = await moduleFlags.flags(ctx);

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
          // D-25: the whole jsonb, resolved — every color key present, `{}` becomes the neutral brand.
          branding: resolveBranding(tenant.branding),
        },
        // Enabled keys from `tenant_modules`, decorated by the registry and sorted by nav order.
        modules: enabledModulesForBootstrap(flags.keys, flags.settings),
        permissions: permissionsFor(membership.role, flags.keys),
        counters: { unreadNotifications: 0, unreadConversations: 0 },
      };
      return c.json(body, 200);
    },
  )
  .openapi(acceptInviteRoute, async (c) => {
    const ctx = c.get('ctx');
    const body = c.req.valid('json');

    const result = await acceptInvite({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      rulesVersion: body.rulesVersion,
      termsVersion: body.termsVersion,
      ip: c.req.header(CLIENT_IP_HEADER) ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      logger: c.get('logger'),
    });

    c.header('Cache-Control', 'no-store');
    return c.json({ tenantSlug: result.tenantSlug, landing: '/inicio' as const }, 200);
  });
