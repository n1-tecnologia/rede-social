import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoundedTtlCache, isRegistrableHost, normalizeHost } from '../src/hosts';

/** WR-06 (phase-1 review): host caches are keyed by client input, so they must be bounded and shaped. */

describe('isRegistrableHost — the tenant_domains_host_chk predicate', () => {
  it('accepts what the database would store', () => {
    for (const host of ['tria-demo.localhost', 'comunidade.cliente.com.br', 'a.b', '127.0.0.1']) {
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
    expect(isRegistrableHost(normalizeHost('TRIA-DEMO.LOCALHOST:3000') ?? '')).toBe(true);
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
