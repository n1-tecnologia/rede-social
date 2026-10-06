import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './context';
import { resolveRequestHost, verifyBearer } from './require-auth';

/**
 * The identity lane (08.1, D-305): a verified Bearer and the resolved host, and NOTHING about a
 * membership. Mounted on `/v1/join/*` and nowhere else — the only routes a session with no
 * membership on the host may reach, because joining is how that membership comes to exist.
 *
 * It sets `c.var.identity` and never sets `ctx`, so no tenant-lane handler (which reads `ctx`) can run
 * behind it, and it never opens a tenant-lane transaction. Writes behind it go through the admin lane
 * with explicit guards (`packages/core/server/tenancy/join.ts`). A forged `x-tenant-host` from a direct
 * API caller can only name which community the call is about, never grant one: the join refuses
 * blocked, removed and platform identities and requires both consents (T-08.1-07).
 */
export const requireIdentity = createMiddleware<AppEnv>(async (c, next) => {
  const payload = await verifyBearer(c);
  const { host, hostTenant } = await resolveRequestHost(c);
  c.set('identity', {
    userId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    host,
    hostTenant,
  });
  const log = c.get('logger');
  if (log) c.set('logger', log.child({ userId: payload.sub }));
  await next();
});
