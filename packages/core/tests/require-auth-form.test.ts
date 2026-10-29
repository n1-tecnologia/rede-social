import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../server/auth/context';
import { ApiError, errorEnvelope } from '../server/http/api-error';
import type { Membership } from '../server/tenancy/membership';

/**
 * 12-05 (D-581, D-584, D-585, PFORM-10, PFORM-11): `requireAuth` answers the profile-form count the SQL
 * rule computed on the membership row, LAST in the chain. Proven without a database: the token, the host
 * and the membership lookups are replaced at the module boundary (the `require-auth-cut.test.ts` mould),
 * so what is under test is the middleware's ORDER and answers. The two lookups themselves are proven
 * against a counted `execute`. `vi.mock` is top level (Vitest 5).
 */
const state: { membership: Membership | null } = { membership: null };
const executed: string[] = [];
let nextRows: unknown[] = [];

vi.mock('jose', () => ({
  jwtVerify: async () => ({ payload: { sub: 'user-1' } }),
  createRemoteJWKSet: () => ({}),
}));
vi.mock('../server/auth/jwks', () => ({
  JWKS: {},
  JWT_ISSUER: 'issuer',
  jwksFor: () => ({}),
  issuerFor: () => 'issuer',
}));
vi.mock('../server/tenancy/tenant-host', () => ({
  resolveTenantHost: async () => ({
    kind: 'tenant',
    tenantId: 'tenant-1',
    status: 'active',
    displayName: 'Rede Lab',
    apiUrl: 'http://127.0.0.1:54321',
  }),
}));
// The lookups' own dependencies: one counted `execute`, whatever the statement.
const fakeDb = {
  execute: async (statement: unknown) => {
    executed.push(JSON.stringify(statement));
    return nextRows;
  },
};
vi.mock('../db/client', () => ({ db: fakeDb }));
vi.mock('../db/project-pools', () => ({
  withHandle: async (_project: unknown, fn: (handle: { db: typeof fakeDb }) => unknown) =>
    fn({ db: fakeDb }),
}));
vi.mock('../server/tenancy/project-registry', () => ({
  resolveProject: async () => ({ projectId: 'p0' }),
}));
vi.mock('../server/tenancy/membership', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/tenancy/membership')>();
  return {
    ...original,
    membershipInTenant: async () => state.membership,
    membershipsOfUser: async () => (state.membership ? [state.membership] : []),
  };
});

const { requireAuth, PROFILE_FORM_ALLOWED_PATHS } = await import('../server/auth/require-auth');
const real = await vi.importActual<typeof import('../server/tenancy/membership')>(
  '../server/tenancy/membership',
);

const membership = (profileFormMissing: number, over: Partial<Membership> = {}) =>
  ({
    tenantId: 'tenant-1',
    tenantSlug: 'rede-lab',
    tenantDisplayName: 'Rede Lab',
    role: 'member',
    status: 'active',
    tenantStatus: 'active',
    accessState: 'open',
    profileFormMissing,
    ...over,
  }) satisfies Membership;

function app() {
  const hono = new Hono<AppEnv>({ strict: false });
  hono.use('*', async (c, next) => {
    c.set('requestId', 'req-1');
    await next();
  });
  hono.onError((err, c) => {
    const { body, status } = errorEnvelope(err, 'req-1');
    return c.json(body, status);
  });
  hono.use('*', requireAuth);
  for (const path of [
    '/v1/me/bootstrap',
    '/v1/me/profile-form',
    '/v1/me/profile-form/answers',
    '/v1/me/profile-form/answers/x',
    '/v1/me/profile-form-x',
    '/v1/me/counters',
    '/v1/me/profile',
    '/v1/feed',
    '/v1/me/invite',
  ]) {
    hono.get(path, (c) => c.json({ ok: true }));
  }
  return hono;
}

const call = (path: string) =>
  app().request(path, { headers: { authorization: 'Bearer token', 'x-tenant-host': 'lab.test' } });
const body = async (res: Response) =>
  (await res.json()) as { error?: { code: string; details?: Record<string, unknown> } };

beforeEach(() => {
  state.membership = null;
  executed.length = 0;
  nextRows = [];
});

describe('requireAuth - the profile form (D-581, D-584)', () => {
  it('1. one missing answer is 403 PROFILE_FORM_PENDING with the tenant name only; none reaches the route', async () => {
    state.membership = membership(1);
    const res = await call('/v1/me/profile');
    expect(res.status).toBe(403);
    const payload = await body(res);
    expect(payload.error?.code).toBe('PROFILE_FORM_PENDING');
    expect(payload.error?.details).toEqual({ tenantName: 'Rede Lab' });
    state.membership = membership(0);
    expect((await call('/v1/me/profile')).status).toBe(200);
  });

  it('1b. the boundary: many missing is gated like one, zero is not', async () => {
    state.membership = membership(7);
    expect((await body(await call('/v1/feed'))).error?.code).toBe('PROFILE_FORM_PENDING');
    state.membership = membership(0);
    expect((await call('/v1/feed')).status).toBe(200);
  });

  it('2. only the three exact paths pass, with or without a trailing slash', async () => {
    state.membership = membership(1);
    expect([...PROFILE_FORM_ALLOWED_PATHS]).toEqual([
      '/v1/me/bootstrap',
      '/v1/me/profile-form',
      '/v1/me/profile-form/answers',
    ]);
    for (const ok of [
      '/v1/me/bootstrap',
      '/v1/me/profile-form',
      '/v1/me/profile-form/',
      '/v1/me/profile-form/answers',
      '/v1/me/profile-form/answers/',
    ]) {
      expect((await call(ok)).status, ok).toBe(200);
    }
    for (const refused of [
      '/v1/me/profile-form/answers/x',
      '/v1/me/profile-form-x',
      '/v1/me/counters',
      '/v1/me/profile',
      '/v1/feed',
    ]) {
      const res = await call(refused);
      expect(res.status, refused).toBe(403);
      expect((await body(res)).error?.code, refused).toBe('PROFILE_FORM_PENDING');
    }
  });

  it('3. the full refusal order: suspended, blocked, invited, payment blocked, cut, and only then the form', async () => {
    const cases: Array<[string, Membership, string, string]> = [
      [
        'suspended wins',
        membership(1, { tenantStatus: 'suspended', accessState: 'cut' }),
        '/v1/feed',
        'TENANT_SUSPENDED',
      ],
      [
        'blocked wins',
        membership(1, { status: 'blocked', accessState: 'cut' }),
        '/v1/feed',
        'MEMBERSHIP_BLOCKED',
      ],
      ['invited wins', membership(1, { status: 'invited' }), '/v1/feed', 'MEMBERSHIP_INVITED'],
      [
        'payment blocked wins',
        membership(1, { accessState: 'blocked' }),
        '/v1/feed',
        'MEMBERSHIP_BLOCKED',
      ],
      [
        'cut wins over the form',
        membership(1, { accessState: 'cut' }),
        '/v1/feed',
        'SUBSCRIPTION_PENDING',
      ],
      [
        'cut also wins on a form path it cannot reach',
        membership(1, { accessState: 'cut' }),
        '/v1/me/profile-form',
        'SUBSCRIPTION_PENDING',
      ],
      ['the form is last', membership(1), '/v1/feed', 'PROFILE_FORM_PENDING'],
    ];
    for (const [label, row, path, code] of cases) {
      state.membership = row;
      expect((await body(await call(path))).error?.code, label).toBe(code);
    }
    // The invited onboarding path stays reachable and is not turned into a form refusal.
    state.membership = membership(1, { status: 'invited' });
    expect((await call('/v1/me/invite')).status).toBe(200);
  });

  it('4. each lookup issues exactly one execute and selects the count from the _gate twin', async () => {
    nextRows = [
      {
        tenant_id: 'tenant-1',
        tenant_slug: 'rede-lab',
        tenant_display_name: 'Rede Lab',
        role: 'member',
        status: 'active',
        tenant_status: 'active',
        access_state: 'open',
        profile_form_missing: 2,
      },
    ];
    const one = await real.membershipInTenant('user-1', 'tenant-1');
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain('membership_in_tenant_gate');
    expect(executed[0]).toContain('profile_form_missing');
    expect(one?.profileFormMissing).toBe(2);
    const all = await real.membershipsOfUser('user-1');
    expect(executed).toHaveLength(2);
    expect(executed[1]).toContain('memberships_of_user_gate');
    expect(all.map((m) => m.profileFormMissing)).toEqual([2]);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['non-numeric', 'x'],
    ['null', null],
    ['NaN', Number.NaN],
    ['empty string', ''],
  ])(
    '4b. a %s count is a broken invariant (a throw), never "not pending"',
    async (_label, value) => {
      nextRows = [
        {
          tenant_id: 'tenant-1',
          tenant_slug: 'rede-lab',
          tenant_display_name: 'Rede Lab',
          role: 'member',
          status: 'active',
          tenant_status: 'active',
          access_state: 'open',
          profile_form_missing: value,
        },
      ];
      await expect(real.membershipInTenant('user-1', 'tenant-1')).rejects.toThrow(
        /profile form count/,
      );
    },
  );

  it('4c. a numeric string from the driver is parsed (bigint-like integers)', async () => {
    nextRows = [
      {
        tenant_id: 'tenant-1',
        tenant_slug: 'rede-lab',
        tenant_display_name: 'Rede Lab',
        role: 'member',
        status: 'active',
        tenant_status: 'active',
        access_state: 'open',
        profile_form_missing: '3',
      },
    ];
    expect((await real.membershipInTenant('user-1', 'tenant-1'))?.profileFormMissing).toBe(3);
  });

  it.each(['admin_tenant', 'support_tenant'] as const)(
    '5. a %s row (the SQL gives 0) is never refused, whatever the other columns say',
    async (role) => {
      state.membership = membership(0, { role });
      for (const path of ['/v1/feed', '/v1/me/profile', '/v1/me/counters']) {
        expect((await call(path)).status, path).toBe(200);
      }
    },
  );

  it('6. ApiError is the type thrown (the envelope code is the contract)', () => {
    expect(new ApiError(403, 'PROFILE_FORM_PENDING').code).toBe('PROFILE_FORM_PENDING');
  });
});
