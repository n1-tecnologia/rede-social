import type { HostTenantStatus } from '@rede-social/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  getRequiredTenantSchema,
  isBehind,
  setRequiredTenantSchemaForTests,
} from '../server/migrations/required';
import {
  cachedTenantHostCount,
  type HostStatusFacts,
  hostStatus,
  resolveTenantHost,
} from '../server/tenancy/tenant-host';

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

/**
 * 09.2-08 (D-542, D-545, D-537): the host status, a pure ranking of control-plane facts. Precedence, highest
 * first: suspended > preparing > unavailable > updating > active.
 */
describe('hostStatus precedence', () => {
  const REQUIRED = { count: 10, head: '20261022000010' };
  const BEHIND = { count: 9, head: '20261022000009' };

  type Flags = { suspended: boolean; preparing: boolean; unavailable: boolean; updating: boolean };
  const facts = (f: Flags): HostStatusFacts => ({
    tenantStatus: f.suspended ? 'suspended' : 'active',
    projectState: f.preparing ? 'preparing' : 'ready',
    health: f.unavailable ? 'unreachable' : 'healthy',
    applied: f.updating ? BEHIND : REQUIRED,
    required: REQUIRED,
  });
  const expected = (f: Flags): HostTenantStatus =>
    f.suspended
      ? 'suspended'
      : f.preparing
        ? 'preparing'
        : f.unavailable
          ? 'unavailable'
          : f.updating
            ? 'updating'
            : 'active';

  const all: Flags[] = [];
  for (let mask = 0; mask < 16; mask += 1) {
    all.push({
      suspended: (mask & 1) !== 0,
      preparing: (mask & 2) !== 0,
      unavailable: (mask & 4) !== 0,
      updating: (mask & 8) !== 0,
    });
  }

  it.each(all)('every combination ranks by the fixed precedence: %o', (flags) => {
    expect(hostStatus(facts(flags))).toBe(expected(flags));
  });

  it('a paused project is unavailable, exactly like an unreachable one', () => {
    for (const health of ['paused', 'unreachable']) {
      expect(hostStatus({ ...facts(NONE), health })).toBe('unavailable');
    }
  });

  it('any project state other than ready is preparing', () => {
    for (const projectState of ['preparing', 'failed', 'paused', 'migrating', 'x_y']) {
      expect(hostStatus({ ...facts(NONE), projectState })).toBe('preparing');
    }
  });

  it('a tenant with no health row, an unknown probe, no schema-state row or no binding is not held out', () => {
    const base = facts(NONE);
    expect(hostStatus({ ...base, health: null })).toBe('active');
    expect(hostStatus({ ...base, health: 'unknown' })).toBe('active');
    expect(hostStatus({ ...base, applied: null })).toBe('active');
    expect(hostStatus({ ...base, projectState: null })).toBe('active');
  });

  it('the gate is off while no required schema is known (null)', () => {
    expect(hostStatus({ ...facts(NONE), applied: BEHIND, required: null })).toBe('active');
    setRequiredTenantSchemaForTests(null);
    try {
      expect(getRequiredTenantSchema()).toBeNull();
    } finally {
      setRequiredTenantSchemaForTests(undefined);
    }
  });
});

const NONE = { suspended: false, preparing: false, unavailable: false, updating: false };

describe('isBehind boundaries (D-545)', () => {
  const required = { count: 10, head: '20261022000010' };

  it('applied one below is behind, on the count and on the head', () => {
    expect(isBehind({ count: 9, head: '20261022000010' }, required)).toBe(true);
    expect(isBehind({ count: 10, head: '20261022000009' }, required)).toBe(true);
  });

  it('equal is not behind', () => {
    expect(isBehind({ count: 10, head: '20261022000010' }, required)).toBe(false);
  });

  it('applied one above is never behind (a rolled-back image)', () => {
    expect(isBehind({ count: 11, head: '20261022000011' }, required)).toBe(false);
    expect(isBehind({ count: 11, head: '20261022000009' }, required)).toBe(true);
  });

  it('a null required, a missing applied or a null column is never behind', () => {
    expect(isBehind({ count: 1, head: '1' }, null)).toBe(false);
    expect(isBehind(null, required)).toBe(false);
    expect(isBehind(undefined, required)).toBe(false);
    expect(isBehind({ count: null, head: null }, required)).toBe(false);
    expect(isBehind({ count: null, head: '20261022000009' }, required)).toBe(true);
  });

  it('the test seam refuses to run outside NODE_ENV=test', () => {
    const before = process.env.NODE_ENV;
    try {
      vi.stubEnv('NODE_ENV', 'production');
      expect(() => setRequiredTenantSchemaForTests(required)).toThrow();
    } finally {
      vi.unstubAllEnvs();
      if (before !== undefined) process.env.NODE_ENV = before;
    }
    setRequiredTenantSchemaForTests(required);
    expect(getRequiredTenantSchema()).toEqual(required);
    setRequiredTenantSchemaForTests(undefined);
    // 09.2-15: cleared, the requirement is what the repository ships (the image manifest in production).
    expect(getRequiredTenantSchema()?.count).toBeGreaterThan(100);
  });
});
