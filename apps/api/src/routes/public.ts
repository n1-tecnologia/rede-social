import { createRoute, z } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema, hostTenantSchema, normalizeHost } from '@tria/contracts';
import { ApiError } from '@tria/core/server/http/api-error';
import { resolveTenantHost } from '@tria/core/server/tenancy/tenant-host';
import { createOpenApiApp } from '../http/openapi';

/**
 * Unauthenticated routes. `GET /tenants/by-host` is registered FIRST on purpose: plan 01-04 appends
 * `GET /tenants/{slug}` and `POST /signup/{slug}` AFTER it — Hono resolves in registration order and
 * `by-host` is itself a valid slug shape, so the literal path must win.
 */
export const publicRoutes = createOpenApiApp().openapi(
  createRoute({
    method: 'get',
    path: '/tenants/by-host',
    request: {
      query: z.object({ host: z.string().min(1).max(253) }),
    },
    responses: {
      200: {
        description: 'Tenant served on this host (D-20): slug and display name only',
        content: { 'application/json': { schema: hostTenantSchema } },
      },
      404: {
        description: 'No active tenant registered for this host',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  }),
  async (c) => {
    const host = normalizeHost(c.req.valid('query').host);
    const resolved = host ? await resolveTenantHost(host) : { kind: 'unknown' as const };
    if (resolved.kind !== 'tenant') throw new ApiError(404, 'TENANT_NOT_FOUND');
    // The web BFF holds its own cache; nothing in between may store this answer.
    c.header('Cache-Control', 'no-store');
    return c.json({ slug: resolved.slug, displayName: resolved.displayName }, 200);
  },
);
