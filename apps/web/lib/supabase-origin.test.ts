import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAllowedSupabaseOrigin } from './supabase-origin';

/**
 * The origin rule with the e2e-only loopback flag (quick 261023-ssq). The matrix passes explicit
 * `{ production, allowLoopback }` options so it does not depend on `process.env`; the last block checks
 * the default read of `NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS`.
 */

const LOOPBACK_ACCEPTED = [
  'http://127.0.0.1:54321',
  'http://localhost:54321',
  'https://127.0.0.1:54321',
  'https://localhost:54321',
  'http://127.0.0.1',
  'http://localhost',
];

const REFUSED_WITH_FLAG = [
  'http://evil.com',
  'https://evil.com',
  'http://127.0.0.1.evil.com',
  'http://localhost.evil.com',
  'http://x@127.0.0.1',
  'http://x:y@localhost:54321',
  'http://127.0.0.1:54321/path',
  'http://127.0.0.1:54321?x=1',
  'http://127.0.0.1:54321#f',
  'http://127.0.0.1:54321?',
  'https://x.supabase.co.evil.com',
  'http://192.168.0.5:54321',
  'http://0.0.0.0:54321',
  'http://[::1]:54321',
  'ftp://127.0.0.1',
  '',
  'not a url',
  undefined,
  42,
];

const HOSTED_ACCEPTED = ['https://abcd.supabase.co', 'https://abcd.supabase.co/'];
const HOSTED_REFUSED = [
  'http://abcd.supabase.co',
  'https://abcd.supabase.co:8443',
  'https://a.b.supabase.co',
  'https://supabase.co',
];

describe('isAllowedSupabaseOrigin, flag off', () => {
  it('refuses http loopback in production and accepts it outside production', () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321']) {
      expect(isAllowedSupabaseOrigin(url, { production: true, allowLoopback: false }), url).toBe(
        false,
      );
      expect(isAllowedSupabaseOrigin(url, { production: false, allowLoopback: false }), url).toBe(
        true,
      );
    }
  });
});

describe('isAllowedSupabaseOrigin, flag on in a production build', () => {
  it('admits the loopback hosts, with or without a port', () => {
    for (const url of LOOPBACK_ACCEPTED) {
      expect(isAllowedSupabaseOrigin(url, { production: true, allowLoopback: true }), url).toBe(
        true,
      );
    }
  });

  it('still refuses everything else', () => {
    for (const url of REFUSED_WITH_FLAG) {
      expect(
        isAllowedSupabaseOrigin(url, { production: true, allowLoopback: true }),
        String(url),
      ).toBe(false);
    }
  });
});

describe('the hosted rule is unchanged', () => {
  it('accepts a bare hosted origin and refuses the near misses', () => {
    for (const allowLoopback of [false, true]) {
      for (const url of HOSTED_ACCEPTED) {
        expect(isAllowedSupabaseOrigin(url, { production: true, allowLoopback }), url).toBe(true);
      }
      for (const url of HOSTED_REFUSED) {
        expect(isAllowedSupabaseOrigin(url, { production: true, allowLoopback }), url).toBe(false);
      }
    }
  });

  it('answers the same with the flag on and off for every non-loopback input', () => {
    const corpus = [
      ...HOSTED_ACCEPTED,
      ...HOSTED_REFUSED,
      ...REFUSED_WITH_FLAG.filter(
        (url) =>
          typeof url !== 'string' || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url),
      ),
    ];
    for (const production of [true, false]) {
      for (const url of corpus) {
        expect(
          isAllowedSupabaseOrigin(url, { production, allowLoopback: true }),
          `${String(url)} production=${production}`,
        ).toBe(isAllowedSupabaseOrigin(url, { production, allowLoopback: false }));
      }
    }
  });
});

describe('the default read of the build-time flag', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('admits http loopback with NODE_ENV production and the flag exactly "1"', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS', '1');
    expect(isAllowedSupabaseOrigin('http://127.0.0.1:54321')).toBe(true);
  });

  it('refuses it for any other flag value, or none', () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const value of ['0', 'true', 'yes', ' 1', '1 ', '']) {
      vi.stubEnv('NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS', value);
      expect(isAllowedSupabaseOrigin('http://127.0.0.1:54321'), JSON.stringify(value)).toBe(false);
    }
    vi.stubEnv('NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS', undefined);
    expect(isAllowedSupabaseOrigin('http://127.0.0.1:54321')).toBe(false);
  });
});
