import { normalizeHost, TENANT_HOST_HEADER } from '@tria/contracts';
import { createMiddleware } from 'hono/factory';
import type { Logger } from 'pino';
import { verifyBearer } from '../auth/require-auth';
import { ApiError } from '../http/api-error';
import { resolveTenantHost } from '../tenancy/tenant-host';
import { isPlatformAdmin } from './platform-admins';

/** The platform lane's context: no tenant, no membership — that is the whole point of ROLE-01. */
export type PlatformContext = {
  userId: string;
  requestId: string;
};

export type PlatformEnv = {
  Variables: {
    platformCtx: PlatformContext;
    requestId: string;
    logger: Logger;
  };
};

/**
 * ROLE-01 + D-23. Guards `/v1/platform/*` INSTEAD of `requireAuth`: a `super_admin` legitimately has
 * no membership row, so `requireAuth` would answer 403 `NO_MEMBERSHIP` before the route ever ran.
 *
 * verify -> `platform_admins` (per request, admin lane) -> host rule:
 * a registered TENANT host is refused with 403 `TENANT_HOST_MISMATCH`, because in Phase 1 platform
 * sessions are served only on the platform domain (super_admin access to tenant domains is the
 * Phase 2 platform-panel concern). A generic host — no header at all, or an unregistered one such as
 * the platform host itself or a Vercel Preview URL — stays allowed, which is what keeps dev and
 * Preview working (D-21).
 */
export const requireSuperAdmin = () =>
  createMiddleware<PlatformEnv>(async (c, next) => {
    const payload = await verifyBearer(c);
    const userId = payload.sub;

    if (!(await isPlatformAdmin(userId))) throw new ApiError(403, 'FORBIDDEN');

    const host = normalizeHost(c.req.header(TENANT_HOST_HEADER));
    if (host) {
      const resolved = await resolveTenantHost(host);
      // No details: the body must not name the tenant this address serves.
      if (resolved.kind === 'tenant') throw new ApiError(403, 'TENANT_HOST_MISMATCH');
    }

    c.set('platformCtx', { userId, requestId: c.get('requestId') });
    const log = c.get('logger');
    if (log) c.set('logger', log.child({ userId }));
    await next();
  });
