import { normalizeHost, TENANT_HOST_HEADER } from '@tria/contracts';
import { createMiddleware } from 'hono/factory';
import { type JWTPayload, jwtVerify } from 'jose';
import { ApiError } from '../http/api-error';
import { membershipForUser } from '../tenancy/membership';
import { resolveTenantHost } from '../tenancy/tenant-host';
import type { AppEnv } from './context';
import { JWKS, JWT_ISSUER } from './jwks';

/**
 * Order is fixed: verify -> membership -> blocked -> host. A blocked member on the wrong host still gets
 * MEMBERSHIP_BLOCKED. The host header can only DENY a session (403 TENANT_HOST_MISMATCH); the tenant of
 * record is always the membership (TENANT-01, D-23). `Host`/`X-Forwarded-Host` are never read.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED');

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, { issuer: JWT_ISSUER, audience: 'authenticated' }));
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN');
  }
  const userId = payload.sub;
  if (!userId) throw new ApiError(401, 'INVALID_TOKEN');

  // Per request, no cache (AUTH-06, D-09).
  const membership = await membershipForUser(userId);
  if (!membership) throw new ApiError(403, 'NO_MEMBERSHIP');
  if (membership.status === 'blocked' || membership.tenantStatus !== 'active') {
    throw new ApiError(403, 'MEMBERSHIP_BLOCKED', { tenantName: membership.tenantDisplayName });
  }

  const host = normalizeHost(c.req.header(TENANT_HOST_HEADER));
  if (host) {
    const resolved = await resolveTenantHost(host);
    if (resolved.kind === 'tenant' && resolved.tenantId !== membership.tenantId) {
      // No details on purpose: the body must not name either tenant.
      throw new ApiError(403, 'TENANT_HOST_MISMATCH');
    }
  }

  c.set('ctx', {
    userId,
    tenantId: membership.tenantId,
    role: membership.role,
    requestId: c.get('requestId'),
    events: [],
  });
  await next();
});
