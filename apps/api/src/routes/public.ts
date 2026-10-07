import { createRoute, z } from '@hono/zod-openapi';
import {
  apiErrorEnvelopeSchema,
  hostTenantSchema,
  normalizeHost,
  publicTenantSchema,
  signupBodySchema,
  signupResponseSchema,
  toHostBranding,
} from '@rede-social/contracts';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { getPublicTenant } from '@rede-social/core/server/tenancy/public-tenant';
import { signupMember } from '@rede-social/core/server/tenancy/signup';
import { resolveTenantHost } from '@rede-social/core/server/tenancy/tenant-host';
import { createOpenApiApp } from '../http/openapi';

/**
 * Unauthenticated routes. `GET /tenants/by-host` is registered FIRST on purpose: `by-host` is itself a
 * valid slug shape, and Hono resolves in registration order, so the literal path must win over
 * `GET /tenants/{slug}` (01-01 integration case 10 guards it).
 *
 * The slug path params are typed `z.string()`, NOT `slugSchema`: a malformed slug must answer
 * 404 `TENANT_NOT_FOUND` (adjacency rule T-04-07), which `getPublicTenant` does — validating here
 * would turn `Rede-Demo` into a 400 and leak the difference between "bad shape" and "no such tenant".
 */
const slugParams = z.object({ slug: z.string() });

/** `X-Client-IP` is set by the web server action from Vercel's `x-real-ip` (T-04-03: trusted hop only). */
const CLIENT_IP_HEADER = 'X-Client-IP';

export const publicRoutes = createOpenApiApp()
  .openapi(
    createRoute({
      method: 'get',
      path: '/tenants/by-host',
      request: {
        query: z.object({ host: z.string().min(1).max(253) }),
      },
      responses: {
        200: {
          description:
            'Tenant served on this VERIFIED host (D-20/D-36): slug, display name, status (a suspended tenant still answers, D-32), primary-host facts (D-35) and the public brand (D-25) — nothing else',
          content: { 'application/json': { schema: hostTenantSchema } },
        },
        404: {
          description:
            'No VERIFIED tenant host matches (unregistered, or attached but not verified)',
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
      return c.json(
        {
          slug: resolved.slug,
          displayName: resolved.displayName,
          status: resolved.status,
          isPrimary: resolved.isPrimary,
          primaryHost: resolved.primaryHost,
          // Public subset only: `iconUrl`/`iconVersion` are panel facts (T-02-04).
          branding: toHostBranding(resolved.branding),
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: 'get',
      path: '/tenants/{slug}',
      request: { params: slugParams },
      responses: {
        200: {
          description:
            'Public tenant data for the sign-up page: name, rules text and both versions',
          content: { 'application/json': { schema: publicTenantSchema } },
        },
        404: {
          description: 'Unknown, suspended or malformed slug',
          content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
        },
      },
    }),
    async (c) => {
      const tenant = await getPublicTenant(c.req.valid('param').slug);
      c.header('Cache-Control', 'no-store');
      return c.json(tenant, 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post',
      path: '/signup/{slug}',
      request: {
        params: slugParams,
        body: { content: { 'application/json': { schema: signupBodySchema } }, required: true },
      },
      responses: {
        201: {
          description:
            'Member created with an unconfirmed e-mail and joined to the tenant; a confirmation mail follows (D-04 superseded)',
          content: { 'application/json': { schema: signupResponseSchema } },
        },
        400: {
          description: 'Invalid payload or stale consent versions',
          content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
        },
        404: {
          description: 'Unknown, suspended or malformed slug',
          content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
        },
        409: {
          description: 'E-mail already registered — the body never names the owning tenant (D-04)',
          content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
        },
      },
    }),
    async (c) => {
      const result = await signupMember({
        slug: c.req.valid('param').slug,
        body: c.req.valid('json'),
        ip: c.req.header(CLIENT_IP_HEADER) ?? null,
        userAgent: c.req.header('User-Agent') ?? null,
        logger: c.get('logger'),
      });
      c.header('Cache-Control', 'no-store');
      return c.json(result, 201);
    },
  );
