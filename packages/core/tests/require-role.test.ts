import type { TenantRole } from '@tria/contracts';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv, RequestContext } from '../server/auth/context';
import { errorEnvelope } from '../server/http/api-error';
import { KERNEL_ROLE_PERMISSIONS, requireRole } from '../server/rbac/require-role';

/** ROLE-06: the role is whatever `requireAuth` read from the membership row on THIS request. */
const ctx = (role: TenantRole): RequestContext => ({
  userId: 'user-1',
  tenantId: 'tenant-1',
  role,
  requestId: 'req-1',
  events: [],
});

function appFor(role: TenantRole | null, ...allowed: TenantRole[]) {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => {
    const { body, status } = errorEnvelope(err, 'req-1');
    return c.json(body, status);
  });
  app.use('*', async (c, next) => {
    if (role) c.set('ctx', ctx(role));
    await next();
  });
  app.use('*', requireRole(...allowed));
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}

const code = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('requireRole — 403 FORBIDDEN for the wrong role', () => {
  it('1. a member on an admin-only route gets 403 FORBIDDEN (not 404)', async () => {
    const res = await appFor('member', 'admin_tenant').request('/');
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('FORBIDDEN');
  });

  it('2. the admin of the tenant passes', async () => {
    const res = await appFor('admin_tenant', 'admin_tenant').request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('3. several allowed roles: support passes, member still does not', async () => {
    expect(
      (await appFor('support_tenant', 'admin_tenant', 'support_tenant').request('/')).status,
    ).toBe(200);
    expect((await appFor('member', 'admin_tenant', 'support_tenant').request('/')).status).toBe(
      403,
    );
  });

  it('4. ordering: no ctx at all (guard mounted before requireAuth) is 401, never 403', async () => {
    const res = await appFor(null, 'admin_tenant').request('/');
    expect(res.status).toBe(401);
    expect(await code(res)).toBe('UNAUTHENTICATED');
  });

  it('5. KERNEL_ROLE_PERMISSIONS: admins manage, support answers chat, members consume (V1)', () => {
    expect(KERNEL_ROLE_PERMISSIONS.admin_tenant).toContain('tenant.manage');
    expect(KERNEL_ROLE_PERMISSIONS.admin_tenant).toContain('content.publish');
    expect(KERNEL_ROLE_PERMISSIONS.support_tenant).toEqual(['chat.support']);
    expect(KERNEL_ROLE_PERMISSIONS.member).toEqual([]);
  });
});
