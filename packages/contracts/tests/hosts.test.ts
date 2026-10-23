import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publicTenantSchema } from '../src/auth';
import { resolveBranding, toHostBranding } from '../src/branding';
import { ERROR_CODES } from '../src/errors';
import {
  createBoundedTtlCache,
  HOST_TENANT_STATUSES,
  hostTenantSchema,
  isRegistrableHost,
  normalizeHost,
} from '../src/hosts';

/** WR-06 (phase-1 review): host caches are keyed by client input, so they must be bounded and shaped. */

describe('isRegistrableHost — the tenant_domains_host_chk predicate', () => {
  it('accepts what the database would store', () => {
    for (const host of ['rede-demo.localhost', 'comunidade.cliente.com.br', 'a.b', '127.0.0.1']) {
      expect(isRegistrableHost(host)).toBe(true);
    }
  });

  it('rejects what the database would refuse, so it never becomes a cache key or a query', () => {
    for (const host of [
      '',
      'UPPER.example',
      'under_score.example',
      '[::1]',
      'evil.example/%00',
      'sp ace.example',
      `${'a'.repeat(254)}`,
    ]) {
      expect(isRegistrableHost(host)).toBe(false);
    }
    // normalizeHost lower-cases and strips the port, so the pair is what callers actually run.
    expect(isRegistrableHost(normalizeHost('REDE-DEMO.LOCALHOST:3000') ?? '')).toBe(true);
  });
});

describe('createBoundedTtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never grows past max: the least recently used key is evicted on insert', () => {
    const cache = createBoundedTtlCache<number>(3);
    cache.set('a', 1, 60_000);
    cache.set('b', 2, 60_000);
    cache.set('c', 3, 60_000);
    expect(cache.size).toBe(3);

    // `a` is touched, so `b` is now the least recently used.
    expect(cache.get('a')).toBe(1);
    cache.set('d', 4, 60_000);

    expect(cache.size).toBe(3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('a storm of distinct keys leaves the size at the bound', () => {
    const cache = createBoundedTtlCache<boolean>(50);
    for (let i = 0; i < 10_000; i += 1) cache.set(`host-${i}.example`, false, 60_000);
    expect(cache.size).toBe(50);
  });

  it('expired entries are dropped on read and do not count against the bound forever', () => {
    const cache = createBoundedTtlCache<string>(2);
    cache.set('x', 'v', 1_000);
    vi.advanceTimersByTime(1_001);
    expect(cache.get('x')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('delete removes a key so the next read misses', () => {
    const cache = createBoundedTtlCache<string>(2);
    cache.set('x', 'v', 60_000);
    cache.delete('x');
    expect(cache.get('x')).toBeUndefined();
  });

  it('refuses a non-positive bound', () => {
    expect(() => createBoundedTtlCache(0)).toThrow();
  });
});

/**
 * 09.2-08 (D-542, D-545): the by-host answer says five things about a host, carries the tenant's own project
 * coordinates only when it has them, and stays strict.
 */
describe('hostTenantSchema — host status and the optional project coordinates', () => {
  const body = {
    slug: 'rede-demo',
    displayName: 'Rede Demo',
    status: 'active',
    isPrimary: true,
    primaryHost: 'rede-demo.localhost',
    branding: toHostBranding(resolveBranding({})),
  };

  it('pins the closed set of host statuses, in precedence-free declaration order', () => {
    expect([...HOST_TENANT_STATUSES]).toEqual([
      'active',
      'suspended',
      'preparing',
      'updating',
      'unavailable',
    ]);
  });

  it('accepts each status and refuses anything else', () => {
    for (const status of HOST_TENANT_STATUSES) {
      expect(hostTenantSchema.safeParse({ ...body, status }).success).toBe(true);
    }
    for (const status of ['deleted', 'ready', 'paused', '', 'ACTIVE']) {
      expect(hostTenantSchema.safeParse({ ...body, status }).success).toBe(false);
    }
  });

  it('supabaseUrl and publishableKey are optional, valid when present and never empty', () => {
    expect(hostTenantSchema.safeParse(body).success).toBe(true);
    expect(
      hostTenantSchema.safeParse({
        ...body,
        supabaseUrl: 'https://abcdefgh.supabase.co',
        publishableKey: 'sb_publishable_x',
      }).success,
    ).toBe(true);
    expect(hostTenantSchema.safeParse({ ...body, supabaseUrl: 'not a url' }).success).toBe(false);
    expect(hostTenantSchema.safeParse({ ...body, publishableKey: '' }).success).toBe(false);
  });

  it('stays strict: an unknown key is a parse failure', () => {
    expect(hostTenantSchema.safeParse({ ...body, projectId: 'p' }).success).toBe(false);
    expect(hostTenantSchema.safeParse({ ...body, serviceKey: 'secret' }).success).toBe(false);
  });

  it('TENANT_PREPARING and TENANT_UPDATING join the error codes next to TENANT_UNAVAILABLE', () => {
    for (const code of ['TENANT_PREPARING', 'TENANT_UPDATING', 'TENANT_UNAVAILABLE']) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});

describe('publicTenantSchema primaryHost (09.2-17, D-36)', () => {
  const base = {
    slug: 'rede-b',
    displayName: 'Rede B',
    rulesText: 'x',
    rulesVersion: 1,
    termsVersion: 1,
  };

  it('is optional, so a tenant of the central project is unchanged', () => {
    expect(publicTenantSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a registrable host and refuses anything that is not one', () => {
    expect(
      publicTenantSchema.safeParse({ ...base, primaryHost: 'comunidade.cliente.com.br' }).success,
    ).toBe(true);
    for (const primaryHost of [
      '',
      'A.example',
      'evil.example/@x',
      'a b',
      'ex ample.com',
      'a'.repeat(254),
    ]) {
      expect(publicTenantSchema.safeParse({ ...base, primaryHost }).success, primaryHost).toBe(
        false,
      );
    }
  });
});
