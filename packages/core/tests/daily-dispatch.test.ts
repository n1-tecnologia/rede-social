import { describe, expect, it } from 'vitest';
import {
  dailyTenantSingletonKey,
  registerDailyTenantJobs,
  registeredDailyTenantJobs,
} from '../server/tenancy/daily-dispatch';

/**
 * `kernel.daily-tenant-dispatch` (08.7-01 Task 3, INSIGHT-16) at unit level: the registration seam
 * (names come from the app registry's code, validated here) and the per-tenant-day singleton key.
 * The dispatch itself (tenants read in SQL, the enqueues, the re-arm) is proven against Postgres in
 * `apps/api/tests/integration/dashboard-snapshot.test.ts` ("08.7 dispatch").
 */

const TENANT = '22222222-2222-4222-8222-222222222222';

describe('registerDailyTenantJobs (MOD-02: the kernel names no module queue)', () => {
  it('registers a queue name and lists each name once', () => {
    registerDailyTenantJobs(['dashboard.snapshot-build']);
    registerDailyTenantJobs(['dashboard.snapshot-build']);
    expect(registeredDailyTenantJobs()).toContain('dashboard.snapshot-build');
    expect(
      registeredDailyTenantJobs().filter((name) => name === 'dashboard.snapshot-build'),
    ).toHaveLength(1);
  });

  it('throws at registration on a name that is not a lower-case queue name', () => {
    for (const bad of ['Dashboard.Build', '', '1abc', 'a', 'dash board', 'x;drop']) {
      expect(() => registerDailyTenantJobs([bad])).toThrow(/invalid daily tenant job name/);
    }
    expect(registeredDailyTenantJobs()).not.toContain('x;drop');
  });

  it('registers nothing from a list that holds one bad name', () => {
    expect(() => registerDailyTenantJobs(['ok.queue', 'BAD'])).toThrow();
    expect(registeredDailyTenantJobs()).not.toContain('ok.queue');
  });
});

describe('dailyTenantSingletonKey (EP-55)', () => {
  it('is <tenantId>:<day>', () => {
    expect(dailyTenantSingletonKey(TENANT, '2026-10-17')).toBe(`${TENANT}:2026-10-17`);
  });
});
