import { normalizeHost, TENANT_HOST_HEADER } from '@tria/contracts';
import { createMiddleware } from 'hono/factory';
import { type JWTPayload, jwtVerify } from 'jose';
import { ApiError } from '../http/api-error';
import { isPlatformAdmin } from '../platform/platform-admins';
import { membershipForUser } from '../tenancy/membership';
import { resolveTenantHost } from '../tenancy/tenant-host';
import type { AppEnv } from './context';
import { JWKS, JWT_ISSUER } from './jwks';

/**
 * Bearer parse + ES256 verification against the Supabase JWKS. Shared by `requireAuth` (tenant lane)
 * and `requireSuperAdmin` (platform lane) so both reject an absent, forged, expired or wrongly-signed
 * token identically — one implementation, one set of failure codes.
 */
export async function verifyBearer(c: {
  req: { header(name: string): string | undefined };
}): Promise<JWTPayload & { sub: string }> {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED');

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, { issuer: JWT_ISSUER, audience: 'authenticated' }));
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN');
  }
  if (!payload.sub) throw new ApiError(401, 'INVALID_TOKEN');
  return payload as JWTPayload & { sub: string };
}

/**
 * Order is fixed: verify -> membership -> tenant suspended -> blocked -> host. A suspended tenant
 * answers TENANT_SUSPENDED for every member, blocked or not (D-32: the community is unavailable as a
 * whole, so the member is not told about their own status); a blocked member on the wrong host still
 * gets MEMBERSHIP_BLOCKED; an `invited` membership passes (D-29: accept-invite runs in the tenant
 * lane). The host header can only DENY a session (403 TENANT_HOST_MISMATCH); the tenant of record is
 * always the membership (TENANT-01, D-23). `Host`/`X-Forwarded-Host` are never read.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const payload = await verifyBearer(c);
  const userId = payload.sub;

  // Per request, no cache (AUTH-06, D-09).
  const membership = await membershipForUser(userId);
  if (!membership) {
    // D-23: a platform admin has no membership by design. On a REGISTERED TENANT HOST that is a host
    // mismatch (platform sessions live on the platform host), not an orphan identity — so the web app
    // shows "Este endereço não pertence à sua comunidade." instead of /sem-comunidade. Only this rare
    // branch pays for the `platform_admins` lookup; an ordinary member still makes one query in total.
    const rawHost = normalizeHost(c.req.header(TENANT_HOST_HEADER));
    if (rawHost) {
      const resolved = await resolveTenantHost(rawHost);
      if (resolved.kind === 'tenant' && (await isPlatformAdmin(userId))) {
        throw new ApiError(403, 'TENANT_HOST_MISMATCH');
      }
    }
    throw new ApiError(403, 'NO_MEMBERSHIP');
  }
  if (membership.tenantStatus !== 'active') {
    throw new ApiError(403, 'TENANT_SUSPENDED', { tenantName: membership.tenantDisplayName });
  }
  if (membership.status === 'blocked') {
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
  // Every later log line of this request carries who and which tenant (observability, D-discretion).
  const log = c.get('logger');
  if (log) c.set('logger', log.child({ tenantId: membership.tenantId, userId }));
  await next();
});
