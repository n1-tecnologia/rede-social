import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `requestAccountDeletion`, `isLastAdmin` and the attempt limiter at unit level (13-13, NATIVE-19, T-13-29,
 * T-13-31): the order of the three steps, what a wrong password leaves untouched, the mapping of `AD001`, a sign-out
 * that fails after the commit, and the no-query answer for every role but the administrator. The same flow against
 * real GoTrue and Postgres is `apps/api/tests/integration/account-deletion.test.ts`.
 */

const h = vi.hoisted(() => ({
  calls: [] as string[],
  sqlResult: [{ due: new Date('2026-11-19T12:00:00Z') }] as unknown[],
  sqlError: null as unknown,
  adminRows: [{ others: 0 }] as unknown[],
}));

vi.mock('../db/tenant-tx', () => ({
  withTenantTx: vi.fn(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    h.calls.push('tenant-tx');
    return fn({
      execute: async (query: { queryChunks?: unknown[] }) => {
        const text = JSON.stringify(query.queryChunks ?? query);
        h.calls.push(text.includes('account_deletion_request') ? 'sql:request' : 'sql:other');
        if (h.sqlError) throw h.sqlError;
        return text.includes('account_deletion_request') ? h.sqlResult : h.adminRows;
      },
    });
  }),
}));
vi.mock('../server/tenancy/project-registry', () => ({
  resolveProject: vi.fn(async () => ({
    id: 'p',
    apiUrl: 'http://auth.test',
    publishableKey: 'pk',
    credentialSource: 'env',
  })),
}));
vi.mock('../server/supabase-admin', () => ({ supabaseAdminFor: vi.fn() }));
vi.mock('../db/project-pools', () => ({ withHandle: vi.fn() }));

const { requestAccountDeletion, isLastAdmin } = await import('../server/accounts/deletion');
const { createAttemptLimiter, deletionLimiterKeys } = await import('../server/accounts/rate-limit');

const ctx = { userId: 'u1', tenantId: 't1', role: 'member' as const };
const input = { password: 'SenhaSecreta-123', email: 'pessoa@example.com', accessToken: 'jwt' };
const logger = { info: vi.fn(), warn: vi.fn() };

function deps(overrides: { verify?: boolean; signOutFails?: boolean } = {}) {
  return {
    verifyPassword: vi.fn(async () => {
      h.calls.push('verify');
      return overrides.verify ?? true;
    }),
    signOutGlobal: vi.fn(async () => {
      h.calls.push('signout');
      if (overrides.signOutFails) throw new Error('auth down');
    }),
  };
}

beforeEach(() => {
  h.calls.length = 0;
  h.sqlError = null;
  h.adminRows = [{ others: 0 }];
  logger.info.mockClear();
  logger.warn.mockClear();
});

describe('requestAccountDeletion', () => {
  it('verifies the password first, then runs the SQL request, then signs the person out, and answers the deadline', async () => {
    const d = deps();
    const result = await requestAccountDeletion(ctx, input, d, logger);
    expect(result).toEqual({ dueAt: '2026-11-19T12:00:00.000Z' });
    expect(h.calls).toEqual(['verify', 'tenant-tx', 'sql:request', 'signout']);
    expect(d.signOutGlobal).toHaveBeenCalledWith(expect.anything(), 'jwt');
  });

  it('a wrong password is 403 WRONG_PASSWORD before any SQL or sign-out', async () => {
    await expect(
      requestAccountDeletion(ctx, input, deps({ verify: false }), logger),
    ).rejects.toMatchObject({
      status: 403,
      code: 'WRONG_PASSWORD',
    });
    expect(h.calls).toEqual(['verify']);
  });

  it('maps SQLSTATE AD001 (also inside a wrapped driver error) to 409 LAST_ADMIN and does not sign out', async () => {
    h.sqlError = new Error('Failed query: select …', {
      cause: Object.assign(new Error('x'), { code: 'AD001' }),
    });
    await expect(requestAccountDeletion(ctx, input, deps(), logger)).rejects.toMatchObject({
      status: 409,
      code: 'LAST_ADMIN',
    });
    expect(h.calls).not.toContain('signout');
  });

  it('any other database failure is re-thrown untouched', async () => {
    h.sqlError = new Error('boom');
    await expect(requestAccountDeletion(ctx, input, deps(), logger)).rejects.toThrow('boom');
  });

  it('a failed global sign-out after the commit is logged by event only and the member still gets the deadline', async () => {
    const result = await requestAccountDeletion(ctx, input, deps({ signOutFails: true }), logger);
    expect(result.dueAt).toBe('2026-11-19T12:00:00.000Z');
    expect(logger.warn).toHaveBeenCalledWith(
      { event: 'account.deletion.signout_failed', tenantId: 't1' },
      expect.any(String),
    );
  });

  it('never puts the password, the address or the token into a log call', async () => {
    await requestAccountDeletion(ctx, input, deps(), logger);
    await requestAccountDeletion(ctx, input, deps({ signOutFails: true }), logger);
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain(input.password);
    expect(logged).not.toContain(input.email);
    expect(logged).not.toContain(input.accessToken);
  });

  it('refuses an empty, whitespace-only or 257-character password before touching anything', async () => {
    for (const password of ['', '   ', 'x'.repeat(257)]) {
      await expect(
        requestAccountDeletion(ctx, { ...input, password }, deps(), logger),
      ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(h.calls).toEqual([]);
  });
});

describe('isLastAdmin (UI-D-617)', () => {
  it('answers false with no query for a member and a support member', async () => {
    expect(await isLastAdmin({ ...ctx, role: 'member' })).toBe(false);
    expect(await isLastAdmin({ ...ctx, role: 'support_tenant' })).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('for an administrator counts the OTHER active administrators', async () => {
    h.adminRows = [{ others: 0 }];
    expect(await isLastAdmin({ ...ctx, role: 'admin_tenant' })).toBe(true);
    h.adminRows = [{ others: 1 }];
    expect(await isLastAdmin({ ...ctx, role: 'admin_tenant' })).toBe(false);
    h.adminRows = [{ others: '2' }];
    expect(await isLastAdmin({ ...ctx, role: 'admin_tenant' })).toBe(false);
  });
});

describe('attempt limiter (T-13-29)', () => {
  it('lets 5 attempts through inside the window, refuses the 6th without recording it, and frees a slot as the window slides', () => {
    let now = 0;
    const limiter = createAttemptLimiter({ max: 5, windowMs: 900_000, now: () => now });
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.consume(['user:a']), `attempt ${i + 1}`).toBe(true);
      now += 1_000;
    }
    expect(limiter.consume(['user:a'])).toBe(false);
    expect(limiter.consume(['user:a'])).toBe(false);
    // A different member is not limited.
    expect(limiter.consume(['user:b'])).toBe(true);
    // The first attempt (t=0) leaves the window at t=900,000.
    now = 900_000;
    expect(limiter.consume(['user:a'])).toBe(true);
    expect(limiter.consume(['user:a'])).toBe(false);
  });

  it('counts the address across members and refuses all-or-nothing', () => {
    const limiter = createAttemptLimiter({ max: 2, windowMs: 1_000, now: () => 0 });
    expect(limiter.consume(['user:a', 'ip:1'])).toBe(true);
    expect(limiter.consume(['user:b', 'ip:1'])).toBe(true);
    // The address is spent: a third member from it is refused, and nothing was recorded for that member.
    expect(limiter.consume(['user:c', 'ip:1'])).toBe(false);
    expect(limiter.consume(['user:c'])).toBe(true);
    expect(limiter.consume(['user:c'])).toBe(true);
    expect(limiter.consume(['user:c'])).toBe(false);
  });

  it('bounds the number of keys it remembers', () => {
    const limiter = createAttemptLimiter({ max: 1, windowMs: 1_000_000, maxKeys: 3, now: () => 0 });
    for (const key of ['a', 'b', 'c', 'd']) limiter.consume([key]);
    // `a` was dropped as the oldest, so it can attempt again; `d` is still remembered.
    expect(limiter.consume(['a'])).toBe(true);
    expect(limiter.consume(['d'])).toBe(false);
  });

  it('keys one attempt by member, plus the address when the web hop sent one', () => {
    expect(deletionLimiterKeys({ tenantId: 't', userId: 'u', ip: null })).toEqual(['user:t:u']);
    expect(deletionLimiterKeys({ tenantId: 't', userId: 'u', ip: ' 203.0.113.9 ' })).toEqual([
      'user:t:u',
      'ip:203.0.113.9',
    ]);
    expect(deletionLimiterKeys({ tenantId: 't', userId: 'u', ip: '   ' })).toEqual(['user:t:u']);
  });
});
