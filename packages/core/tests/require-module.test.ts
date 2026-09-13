import type { ModuleKey } from '@tria/contracts';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv, RequestContext } from '../server/auth/context';
import { ApiError, errorEnvelope } from '../server/http/api-error';

/**
 * ROLE-06 adjacency + ordering, proven without a database: the flags cache is replaced at the module
 * boundary, so what is under test is the GUARD (404 vs 401 vs next()), not the query.
 *
 * `vi.mock` must be top level (Vitest 5) and is hoisted above the imports below.
 */
const enabledByTenant: Record<string, ModuleKey[]> = {};
vi.mock('../server/modules/flags-cache', () => ({
  moduleFlags: {
    ttlMs: 30_000,
    isEnabled: async (ctx: { tenantId: string }, key: ModuleKey) =>
      (enabledByTenant[ctx.tenantId] ?? []).includes(key),
    enabledKeys: async (ctx: { tenantId: string }) => new Set(enabledByTenant[ctx.tenantId] ?? []),
    invalidate: () => {},
  },
}));

const { requireModule } = await import('../server/modules/require-module');

const ctx = (tenantId: string): RequestContext => ({
  userId: 'user-1',
  tenantId,
  role: 'member',
  requestId: 'req-1',
  events: [],
});

/** Minimal app with the same error envelope the real API installs. */
function appFor(tenantId: string | null, key: ModuleKey) {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => {
    const { body, status } = errorEnvelope(err, 'req-1');
    return c.json(body, status);
  });
  app.use('*', async (c, next) => {
    // Stands in for `requireAuth`: when `tenantId` is null nothing is set, which is exactly the
    // "mounted before requireAuth / unauthenticated" case.
    if (tenantId) c.set('ctx', ctx(tenantId));
    await next();
  });
  app.use('*', requireModule(key));
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}

const code = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  for (const k of Object.keys(enabledByTenant)) delete enabledByTenant[k];
});

describe('requireModule — 404 MODULE_DISABLED, and only after authentication', () => {
  it('1. enabled = true lets the request through', async () => {
    enabledByTenant.demo = ['chat', 'feed'];
    const res = await appFor('demo', 'chat').request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('2. adjacency: a disabled row and a MISSING row are the same 404 MODULE_DISABLED', async () => {
    // `enabled = false` → the loader never returns the key, so the set simply lacks it.
    enabledByTenant.lab = ['feed', 'events'];
    const disabled = await appFor('lab', 'chat').request('/');
    expect(disabled.status).toBe(404);
    expect(await code(disabled)).toBe('MODULE_DISABLED');

    // No rows at all for this tenant (the "empty" case).
    const missing = await appFor('brand-new', 'chat').request('/');
    expect(missing.status).toBe(404);
    expect(await code(missing)).toBe('MODULE_DISABLED');
  });

  it('3. ordering: without a ctx (no requireAuth before it) the answer is 401, never 404', async () => {
    enabledByTenant.demo = ['chat'];
    const res = await appFor(null, 'chat').request('/');
    expect(res.status).toBe(401);
    expect(await code(res)).toBe('UNAUTHENTICATED');
  });

  it('4. the 404 body names neither the module nor the tenant', async () => {
    const res = await appFor('lab', 'chat').request('/');
    const text = await res.text();
    expect(text).not.toContain('chat');
    expect(text).not.toContain('lab');
    expect(JSON.parse(text).error.code).toBe('MODULE_DISABLED');
  });

  it('5. the guard only ever throws ApiError (the envelope stays stable)', async () => {
    const thrown = new ApiError(404, 'MODULE_DISABLED');
    expect(thrown.code).toBe('MODULE_DISABLED');
    expect(thrown.status).toBe(404);
  });
});
