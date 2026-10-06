import { createRoute } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@rede-social/contracts';
import { joinBodySchema, joinResponseSchema, joinStateSchema } from '@rede-social/contracts/join';
import { requireIdentity } from '@rede-social/core/server/auth/require-identity';
import { joinState, joinTenant } from '@rede-social/core/server/tenancy/join';
import { createOpenApiApp } from '../http/openapi';

/**
 * `/v1/join` — the IDENTITY lane (08.1, D-305, D-306). `requireIdentity` only: a verified Bearer and
 * the resolved host, never a membership, never a tenant-lane transaction. These are the only routes
 * a session WITHOUT a membership on the host may reach, because joining is how that membership comes
 * to exist; every tenant-lane route keeps answering such a session TENANT_HOST_MISMATCH. The write runs
 * in the admin lane behind the explicit guards of `packages/core/server/tenancy/join.ts`, and no
 * answer ever names, counts or hints at another community of the identity (D-302, D-309).
 */
const join = createOpenApiApp();
join.use('*', requireIdentity);

/** `X-Client-IP` is set by the web server action from Vercel's `x-real-ip` (T-04-03: trusted hop only). */
const CLIENT_IP_HEADER = 'X-Client-IP';

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

export const joinRoutes = join
  .openapi(
    createRoute({
      method: 'get',
      path: '/state',
      responses: {
        200: {
          description:
            "One fact about the HOST's community for the caller: joinable | member | invited | blocked | removed | platform_admin | suspended",
          content: { 'application/json': { schema: joinStateSchema } },
        },
        401: envelope('No or invalid Bearer (UNAUTHENTICATED / INVALID_TOKEN)'),
        404: envelope('The host is not a tenant host (NOT_FOUND)'),
      },
    }),
    async (c) => {
      const identity = c.get('identity');
      const body = await joinState({
        userId: identity.userId,
        host: identity.host,
        hostTenant: identity.hostTenant,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(body, 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post',
      path: '/',
      request: {
        body: { content: { 'application/json': { schema: joinBodySchema } }, required: true },
      },
      responses: {
        200: {
          description:
            'joined: an active member membership, the typed profile name and both consents were written; already_member: nothing was written',
          content: { 'application/json': { schema: joinResponseSchema } },
        },
        400: envelope('Stale consent versions ({ consents: "stale" }) or invalid payload'),
        401: envelope('No or invalid Bearer (UNAUTHENTICATED / INVALID_TOKEN)'),
        403: envelope(
          'TENANT_SUSPENDED { tenantName }, MEMBERSHIP_BLOCKED { tenantName } (blocked in THIS community), or FORBIDDEN (a removed membership or a platform account)',
        ),
        404: envelope(
          'The platform host (NOT_FOUND), or no such active community (TENANT_NOT_FOUND)',
        ),
        409: envelope(
          'The membership here is still invited (INVITE_STATE_INVALID { reason: "invite_pending" })',
        ),
      },
    }),
    async (c) => {
      const identity = c.get('identity');
      const result = await joinTenant({
        userId: identity.userId,
        host: identity.host,
        hostTenant: identity.hostTenant,
        body: c.req.valid('json'),
        ip: c.req.header(CLIENT_IP_HEADER) ?? null,
        userAgent: c.req.header('User-Agent') ?? null,
        logger: c.get('logger'),
      });
      c.header('Cache-Control', 'no-store');
      return c.json(result, 200);
    },
  );
