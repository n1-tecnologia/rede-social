import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.2-17 (DBT-39, D-538, T-09.2-83/84/85): the coordinates a request talks to. The environment is
 * stubbed with the central pair; everything else is the real module.
 */
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'central-pk',
  },
}));

import {
  coordinatesFromPair,
  getSupabaseCoordinates,
  isAllowedSupabaseOrigin,
  staleAuthCookieNames,
  storageKeyFor,
} from './supabase-coordinates';

const REF = 'abcdefghijklmnopqrst';
const HOSTED = `https://${REF}.supabase.co`;

let errorSpy: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = undefined;
});

describe('isAllowedSupabaseOrigin', () => {
  it('accepts a hosted project over https in production and in development', () => {
    expect(isAllowedSupabaseOrigin(HOSTED, { production: true })).toBe(true);
    expect(isAllowedSupabaseOrigin(`${HOSTED}/`, { production: true })).toBe(true);
    expect(isAllowedSupabaseOrigin(HOSTED, { production: false })).toBe(true);
  });

  it('refuses http, a foreign host, a look-alike and the bare apex in production', () => {
    for (const url of [
      `http://${REF}.supabase.co`,
      'https://evil.example.com',
      'https://x.supabase.co.evil.com',
      'https://evil.com/x.supabase.co',
      'https://supabase.co',
      `https://a.${REF}.supabase.co`,
      `https://${REF}.supabase.co:8443`,
      `https://${REF}.supabase.com`,
    ]) {
      expect(isAllowedSupabaseOrigin(url, { production: true }), url).toBe(false);
    }
  });

  it('refuses userinfo, a path, a query, a fragment and unparsable input', () => {
    for (const url of [
      `https://user@${REF}.supabase.co`,
      `https://user:pw@${REF}.supabase.co`,
      `${HOSTED}/auth/v1`,
      `${HOSTED}?x=1`,
      `${HOSTED}#x`,
      `${HOSTED}?`,
      'not a url',
      '',
    ]) {
      expect(isAllowedSupabaseOrigin(url, { production: true }), url).toBe(false);
    }
    expect(isAllowedSupabaseOrigin(undefined)).toBe(false);
    expect(isAllowedSupabaseOrigin(42)).toBe(false);
  });

  it('admits the local stack only outside production', () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321']) {
      expect(isAllowedSupabaseOrigin(url, { production: false }), url).toBe(true);
      expect(isAllowedSupabaseOrigin(url, { production: true }), url).toBe(false);
    }
    expect(isAllowedSupabaseOrigin('http://192.168.0.5:54321', { production: false })).toBe(false);
    expect(isAllowedSupabaseOrigin('http://127.0.0.1.evil.com', { production: false })).toBe(false);
  });
});

describe('storageKeyFor', () => {
  it('uses the first hostname label like supabase-js 2.116.0', () => {
    expect(storageKeyFor(HOSTED)).toBe(`sb-${REF}-auth-token`);
    expect(storageKeyFor('http://127.0.0.1:54321')).toBe('sb-127-auth-token');
  });
});

describe('staleAuthCookieNames', () => {
  const current = `sb-${REF}-auth-token`;

  it("selects other projects' cookies, chunks included, and keeps the current project's", () => {
    const names = [
      'sb-oldref-auth-token',
      'sb-oldref-auth-token.0',
      'sb-oldref-auth-token.1',
      current,
      `${current}.0`,
      `${current}.1`,
      'tenant_slug',
      'rede_theme',
      `${current}-code-verifier`,
    ];
    expect(staleAuthCookieNames(names, current)).toEqual([
      'sb-oldref-auth-token',
      'sb-oldref-auth-token.0',
      'sb-oldref-auth-token.1',
    ]);
  });

  it('does not mistake a project whose ref extends the current one for the current one', () => {
    expect(staleAuthCookieNames(['sb-abc-auth-token-auth-token'], 'sb-abc-auth-token')).toEqual([
      'sb-abc-auth-token-auth-token',
    ]);
    // Not a chunk (`.<digits>` only), so not an auth cookie at all.
    expect(staleAuthCookieNames(['sb-abc-auth-token.x'], 'sb-abc-auth-token')).toEqual([]);
  });

  it('is empty when nothing else is there', () => {
    expect(staleAuthCookieNames([], current)).toEqual([]);
    expect(staleAuthCookieNames([current, `${current}.0`], current)).toEqual([]);
  });
});

describe('getSupabaseCoordinates', () => {
  const central = {
    url: 'http://127.0.0.1:54321',
    publishableKey: 'central-pk',
    origin: 'http://127.0.0.1:54321',
    wsOrigin: 'ws://127.0.0.1:54321',
    cookieKey: 'sb-127-auth-token',
    source: 'central',
  };

  it('gives the environment pair to the platform, a generic host and a tenant of the central project', () => {
    expect(getSupabaseCoordinates({ mode: 'platform', host: 'p.example' })).toEqual(central);
    expect(getSupabaseCoordinates({ mode: 'generic', host: 'localhost' })).toEqual(central);
    expect(getSupabaseCoordinates({ mode: 'tenant', host: 'a.example' })).toEqual(central);
    expect(getSupabaseCoordinates(null)).toEqual(central);
  });

  it("gives a tenant of another project that project's own coordinates", () => {
    expect(
      getSupabaseCoordinates({
        mode: 'tenant',
        host: 'b.example',
        supabaseUrl: HOSTED,
        publishableKey: 'pk-b',
      }),
    ).toEqual({
      url: HOSTED,
      publishableKey: 'pk-b',
      origin: HOSTED,
      wsOrigin: `wss://${REF}.supabase.co`,
      cookieKey: `sb-${REF}-auth-token`,
      source: 'tenant',
    });
  });

  it('is null for a half pair and for a disallowed address, and logs the host only', () => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cases = [
      { supabaseUrl: HOSTED },
      { publishableKey: 'pk-b' },
      { supabaseUrl: HOSTED, publishableKey: '' },
      { supabaseUrl: 'https://evil.example.com', publishableKey: 'pk-b' },
      { supabaseUrl: 'https://x.supabase.co.evil.com', publishableKey: 'pk-b' },
      { supabaseUrl: `https://u@${REF}.supabase.co`, publishableKey: 'pk-b' },
      { supabaseUrl: `${HOSTED}/auth`, publishableKey: 'pk-b' },
    ];
    for (const extra of cases) {
      expect(getSupabaseCoordinates({ mode: 'tenant', host: 'b.example', ...extra })).toBeNull();
    }
    expect(errorSpy).toHaveBeenCalledTimes(cases.length);
    for (const call of errorSpy.mock.calls) {
      expect(call).toEqual(['tenant-host.coordinates_rejected', { host: 'b.example' }]);
    }
  });

  it('never reads a coordinate from a platform or generic subject', () => {
    expect(
      getSupabaseCoordinates({
        mode: 'generic',
        host: 'localhost',
        supabaseUrl: HOSTED,
        publishableKey: 'pk-b',
      }),
    ).toEqual(central);
  });

  it('is a pure function of its input: interleaved calls never share a value (P76)', async () => {
    const subjects = ['aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccc'].map(
      (ref) => ({
        mode: 'tenant',
        host: `${ref}.example`,
        supabaseUrl: `https://${ref}.supabase.co`,
        publishableKey: `pk-${ref}`,
      }),
    );
    const results = await Promise.all(
      subjects.map(async (subject, index) => {
        await new Promise((r) => setTimeout(r, (subjects.length - index) * 3));
        return getSupabaseCoordinates(subject);
      }),
    );
    expect(results.map((r) => r?.cookieKey)).toEqual([
      'sb-aaaaaaaaaaaaaaaaaaaa-auth-token',
      'sb-bbbbbbbbbbbbbbbbbbbb-auth-token',
      'sb-cccccccccccccccccccc-auth-token',
    ]);
  });
});

describe('coordinatesFromPair', () => {
  it('applies the same rule to an explicit pair', () => {
    expect(coordinatesFromPair(HOSTED, 'pk-b')?.source).toBe('tenant');
    expect(coordinatesFromPair('https://evil.example.com', 'pk-b')).toBeNull();
    expect(coordinatesFromPair(HOSTED, '')).toBeNull();
  });
});
