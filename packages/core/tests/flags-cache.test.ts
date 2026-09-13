import type { ModuleKey } from '@tria/contracts';
import { describe, expect, it } from 'vitest';
import {
  createModuleFlags,
  type FlagsContext,
  MODULE_FLAGS_TTL_MS,
  moduleFlags,
} from '../server/modules/flags-cache';

/**
 * ROLE-06 concurrency truth: the cache is keyed by TENANT ID with a 30 s TTL, so a flag flipped in the
 * database becomes visible within 30 s on every instance without a redeploy, `invalidate` makes it
 * immediate locally, and tenant A's refresh can never serve tenant B.
 *
 * Time is injected instead of using fake timers because the cache reads the clock directly — a stub
 * `now()` is what lets a test cross the TTL boundary exactly.
 */

const ctxFor = (tenantId: string): FlagsContext => ({
  userId: `user-${tenantId}`,
  tenantId,
  role: 'member',
});

/** Stub loader returning the keys the test wants, counting calls per tenant. */
function stubLoader(byTenant: Record<string, ModuleKey[]>) {
  const calls: string[] = [];
  const loader = async (ctx: FlagsContext) => {
    calls.push(ctx.tenantId);
    return (byTenant[ctx.tenantId] ?? []).map((moduleKey) => ({
      moduleKey,
      settings: { from: ctx.tenantId } as Record<string, unknown>,
    }));
  };
  return { loader, calls };
}

describe('moduleFlags — 30 s tenant-keyed cache (only tenant_modules is ever cached)', () => {
  it('1. loads once per tenant inside the TTL and reloads after it expires', async () => {
    let clock = 1_000;
    const { loader, calls } = stubLoader({ A: ['feed', 'events'] });
    const flags = createModuleFlags({ loader, now: () => clock });

    expect([...(await flags.enabledKeys(ctxFor('A')))].sort()).toEqual(['events', 'feed']);
    expect(await flags.isEnabled(ctxFor('A'), 'feed')).toBe(true);
    expect(await flags.isEnabled(ctxFor('A'), 'chat')).toBe(false);
    expect(calls).toEqual(['A']);

    // Still inside the window: no second query.
    clock += MODULE_FLAGS_TTL_MS - 1;
    await flags.enabledKeys(ctxFor('A'));
    expect(calls).toEqual(['A']);

    // One millisecond past it: refreshed.
    clock += 2;
    await flags.enabledKeys(ctxFor('A'));
    expect(calls).toEqual(['A', 'A']);
  });

  it('2. invalidate(tenantId) forces an immediate reload and picks up the new value', async () => {
    const clock = 0;
    const byTenant: Record<string, ModuleKey[]> = { A: ['feed'] };
    const { loader, calls } = stubLoader(byTenant);
    const flags = createModuleFlags({ loader, now: () => clock });

    expect(await flags.isEnabled(ctxFor('A'), 'chat')).toBe(false);

    byTenant.A = ['feed', 'chat'];
    // Without invalidation the stale answer stands (that is the deliberate ≤ 30 s staleness).
    expect(await flags.isEnabled(ctxFor('A'), 'chat')).toBe(false);
    expect(calls).toEqual(['A']);

    flags.invalidate('A');
    expect(await flags.isEnabled(ctxFor('A'), 'chat')).toBe(true);
    expect(calls).toEqual(['A', 'A']);
  });

  it('3. two tenants never share an entry — neither the keys nor the settings', async () => {
    let clock = 0;
    const { loader, calls } = stubLoader({ A: ['feed', 'chat'], B: ['events'] });
    const flags = createModuleFlags({ loader, now: () => clock });

    const a = await flags.flags(ctxFor('A'));
    const b = await flags.flags(ctxFor('B'));

    expect([...a.keys].sort()).toEqual(['chat', 'feed']);
    expect([...b.keys].sort()).toEqual(['events']);
    expect(await flags.isEnabled(ctxFor('B'), 'chat')).toBe(false);
    expect(a.settings.get('feed')).toEqual({ from: 'A' });
    expect(b.settings.get('events')).toEqual({ from: 'B' });
    expect(calls).toEqual(['A', 'B']);

    // Invalidating A leaves B's entry untouched.
    flags.invalidate('A');
    await flags.enabledKeys(ctxFor('B'));
    expect(calls).toEqual(['A', 'B']);

    // …and a refreshed A still answers only about A.
    clock += MODULE_FLAGS_TTL_MS + 1;
    expect(await flags.isEnabled(ctxFor('A'), 'events')).toBe(false);
  });

  it('4. an empty tenant (no rows at all) is cached as "nothing enabled", not as a miss', async () => {
    const clock = 0;
    const { loader, calls } = stubLoader({});
    const flags = createModuleFlags({ loader, now: () => clock });

    expect([...(await flags.enabledKeys(ctxFor('EMPTY')))]).toEqual([]);
    expect(await flags.isEnabled(ctxFor('EMPTY'), 'feed')).toBe(false);
    expect(calls).toEqual(['EMPTY']);
  });

  it('5. the shared instance ships the 30 s TTL and exposes only flag operations', () => {
    expect(moduleFlags.ttlMs).toBe(30_000);
    // No membership/blocked accessor exists to misuse: a block must be re-read per request (D-09).
    expect(Object.keys(moduleFlags).sort()).toEqual([
      'enabledKeys',
      'flags',
      'invalidate',
      'isEnabled',
      'ttlMs',
    ]);
  });
});
