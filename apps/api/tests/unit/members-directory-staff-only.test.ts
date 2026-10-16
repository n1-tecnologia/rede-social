import type { TenantRole } from '@rede-social/contracts';
import type { AppEnv, RequestContext } from '@rede-social/core/server/auth/context';
import { errorEnvelope } from '@rede-social/core/server/http/api-error';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * pendencias-backend item 7 (quick 261016-jsq, ROLE-06): `GET /v1/members` is for the tenant's staff
 * only, `GET /v1/members/{membershipId}` stays open to every tenant role. DB-free: the real
 * `membersRoutes` router with `requireAuth` replaced by a stub that reads the role from a test-only
 * header (in production the role is the membership row `requireAuth` read on this request) and the
 * kernel profiles service mocked, so the only thing under test is the route wiring.
 */
const mocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  getMemberProfile: vi.fn(),
}));

vi.mock('@rede-social/core/server/auth/require-auth', async () => {
  const { createMiddleware } = await import('hono/factory');
  return {
    requireAuth: createMiddleware<AppEnv>(async (c, next) => {
      const role = (c.req.header('x-test-role') ?? 'member') as TenantRole;
      const ctx: RequestContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        role,
        requestId: 'req-1',
        events: [],
      };
      c.set('ctx', ctx);
      c.set('logger', { info: vi.fn() } as unknown as AppEnv['Variables']['logger']);
      await next();
    }),
  };
});

vi.mock('@rede-social/core/server/profiles/index', () => ({
  listMembers: mocks.listMembers,
  getMemberProfile: mocks.getMemberProfile,
}));

const { membersRoutes } = await import('../../src/routes/members');

const PROFILE_ID = '5b1f0c1e-8a43-4c1b-9d2a-3f6e7a8b9c0d';

function app() {
  const root = new Hono<AppEnv>();
  root.onError((err, c) => {
    const { body, status } = errorEnvelope(err, 'req-1');
    return c.json(body, status);
  });
  root.route('/v1/members', membersRoutes);
  return root;
}

const get = (path: string, role: TenantRole) =>
  app().request(path, { headers: { 'x-test-role': role } });

type ErrorBody = { error: { code: string; details?: unknown } };

beforeEach(() => {
  mocks.listMembers.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  mocks.getMemberProfile.mockReset().mockResolvedValue({
    membershipId: PROFILE_ID,
    displayName: 'Ana Souza',
    bio: null,
    avatarAssetId: null,
    avatarUrl: null,
  });
});

describe('pendencias item 7: GET /v1/members is staff-only', () => {
  it('1. a member gets 403 FORBIDDEN with no details on every query, before validation', async () => {
    for (const path of [
      '/v1/members',
      '/v1/members?q=ana',
      '/v1/members?cursor=abc',
      '/v1/members?limit=0',
    ]) {
      const res = await get(path, 'member');
      expect(res.status, path).toBe(403);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.code, path).toBe('FORBIDDEN');
      expect(body.error.details, path).toBeUndefined();
    }
    expect(mocks.listMembers).not.toHaveBeenCalled();
  });

  it('2. admin_tenant and support_tenant get 200 and the parsed query reaches listMembers', async () => {
    for (const role of ['admin_tenant', 'support_tenant'] as const) {
      mocks.listMembers.mockClear();
      const plain = await get('/v1/members', role);
      expect(plain.status, role).toBe(200);
      expect(await plain.json()).toEqual({ items: [], nextCursor: null });
      const search = await get('/v1/members?q=ana', role);
      expect(search.status, role).toBe(200);
      expect(mocks.listMembers).toHaveBeenCalledTimes(2);
      expect(mocks.listMembers.mock.calls[1]?.[0]).toMatchObject({ role });
      expect(mocks.listMembers.mock.calls[1]?.[1]).toMatchObject({ q: 'ana' });
    }
  });

  it('3. validation still applies to staff: support_tenant with ?limit=0 is 400 VALIDATION_FAILED', async () => {
    const res = await get('/v1/members?limit=0', 'support_tenant');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    expect(mocks.listMembers).not.toHaveBeenCalled();
  });

  it('4. the single read stays open: a member opens a profile by id (200)', async () => {
    const res = await get(`/v1/members/${PROFILE_ID}`, 'member');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { membershipId: string }).membershipId).toBe(PROFILE_ID);
    expect(mocks.getMemberProfile).toHaveBeenCalledTimes(1);
    expect(mocks.getMemberProfile.mock.calls[0]?.[1]).toBe(PROFILE_ID);
  });

  it('5. OpenAPI: the list declares 403, the single read declares none', () => {
    const doc = membersRoutes.getOpenAPIDocument({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
    });
    const list = doc.paths?.['/']?.get?.responses ?? {};
    const read = doc.paths?.['/{membershipId}']?.get?.responses ?? {};
    expect(Object.keys(list)).toContain('403');
    expect(Object.keys(read)).not.toContain('403');
  });
});
