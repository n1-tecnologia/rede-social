import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../server/auth/context';
import { ApiError, errorEnvelope } from '../server/http/api-error';
import type { Membership } from '../server/tenancy/membership';

/**
 * 09.1-02 (D-496, D-497, PAY-13, PAY-14): `requireAuth` answers the access state the SQL gate
 * computed on the membership row. Proven without a database: the token, the host and the membership
 * lookups are replaced at the module boundary, so what is under test is the middleware's ORDER and
 * its answers, never the query. `vi.mock` is top level (Vitest 5).
 */
const state: { membership: Membership | null } = { membership: null };

vi.mock('jose', () => ({
  jwtVerify: async () => ({ payload: { sub: 'user-1' } }),
  createRemoteJWKSet: () => ({}),
}));
vi.mock('../server/auth/jwks', () => ({ JWKS: {}, JWT_ISSUER: 'issuer' }));
vi.mock('../server/tenancy/tenant-host', () => ({
  resolveTenantHost: async () => ({ kind: 'tenant', tenantId: 'tenant-1' }),
}));
vi.mock('../server/tenancy/membership', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/tenancy/membership')>();
  return {
    ...original,
    membershipInTenant: async () => state.membership,
    membershipsOfUser: async () => (state.membership ? [state.membership] : []),
  };
});

const { requireAuth, CUT_ALLOWED_PATHS } = await import('../server/auth/require-auth');

const membership = (accessState: Membership['accessState'], over: Partial<Membership> = {}) =>
  ({
    tenantId: 'tenant-1',
    tenantSlug: 'rede-lab',
    tenantDisplayName: 'Rede Lab',
    role: 'member',
    status: 'active',
    tenantStatus: 'active',
    accessState,
    ...over,
  }) satisfies Membership;

function app() {
  const hono = new Hono<AppEnv>();
  hono.use('*', async (c, next) => {
    c.set('requestId', 'req-1');
    await next();
  });
  hono.onError((err, c) => {
    const { body, status } = errorEnvelope(err, 'req-1');
    return c.json(body, status);
  });
  hono.use('*', requireAuth);
  hono.get('/v1/me/bootstrap', (c) => c.json({ ok: true }));
  hono.get('/v1/me/subscription', (c) => c.json({ ok: true }));
  hono.get('/v1/other', (c) => c.json({ ok: true }));
  return hono;
}

const call = (path: string) =>
  app().request(path, { headers: { authorization: 'Bearer token', 'x-tenant-host': 'lab.test' } });
const body = async (res: Response) =>
  (await res.json()) as { error?: { code: string; details?: { tenantName?: string } } };

beforeEach(() => {
  state.membership = null;
});

describe('requireAuth - the access state (D-496, D-497)', () => {
  it('1. a cut member is 403 SUBSCRIPTION_PENDING naming the tenant only', async () => {
    state.membership = membership('cut');
    const res = await call('/v1/me/bootstrap');
    expect(res.status).toBe(403);
    expect(await body(res)).toMatchObject({
      error: { code: 'SUBSCRIPTION_PENDING', details: { tenantName: 'Rede Lab' } },
    });
  });

  it('2. a manually blocked member of a gated tenant is MEMBERSHIP_BLOCKED', async () => {
    state.membership = membership('blocked');
    const res = await call('/v1/me/bootstrap');
    expect(res.status).toBe(403);
    expect(await body(res)).toMatchObject({
      error: { code: 'MEMBERSHIP_BLOCKED', details: { tenantName: 'Rede Lab' } },
    });
  });

  it.each(['open', 'granted'] as const)('3. state %s reaches the route', async (accessState) => {
    state.membership = membership(accessState);
    const res = await call('/v1/me/bootstrap');
    expect(res.status).toBe(200);
  });

  it('4. a cut member may reach the subscription route, with or without a trailing slash', async () => {
    state.membership = membership('cut');
    expect([...CUT_ALLOWED_PATHS]).toEqual(['/v1/me/subscription']);
    expect((await call('/v1/me/subscription')).status).toBe(200);
    expect((await call('/v1/me/subscription/')).status).toBe(200);
  });

  it('5. the cut answer comes AFTER the earlier refusals (order is fixed)', async () => {
    state.membership = membership('cut', { tenantStatus: 'suspended' });
    expect((await body(await call('/v1/me/bootstrap'))).error?.code).toBe('TENANT_SUSPENDED');
    state.membership = membership('cut', { status: 'blocked' });
    expect((await body(await call('/v1/me/bootstrap'))).error?.code).toBe('MEMBERSHIP_BLOCKED');
    state.membership = membership('cut', { status: 'invited' });
    expect((await body(await call('/v1/other'))).error?.code).toBe('MEMBERSHIP_INVITED');
  });

  it('6. ApiError is the type thrown (the envelope code is the contract)', () => {
    expect(new ApiError(403, 'SUBSCRIPTION_PENDING').code).toBe('SUBSCRIPTION_PENDING');
  });
});
