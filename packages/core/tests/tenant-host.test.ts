import { describe, expect, it } from 'vitest';
import { cachedTenantHostCount, resolveTenantHost } from '../server/tenancy/tenant-host';

/**
 * WR-06 (phase-1 review): a host that could never be registered must be answered `unknown` BEFORE
 * the cache and before the admin-lane query. This suite has no database (the kernel unit config
 * points `DATABASE_URL` at a lazily-connecting placeholder), so a query here would reject — the
 * resolved `unknown` below is itself the proof that nothing was queried.
 */
describe('resolveTenantHost — host shape guard', () => {
  it('answers unknown for unregistrable hosts without touching the cache or the database', async () => {
    const before = cachedTenantHostCount();
    for (const host of ['[::1]', 'under_score.example', 'sp ace.example', 'a'.repeat(300)]) {
      await expect(resolveTenantHost(host)).resolves.toEqual({ kind: 'unknown' });
    }
    expect(cachedTenantHostCount()).toBe(before);
  });
});
