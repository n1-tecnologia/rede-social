import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The policy builder (D-346, Pattern 10). Only the env is stubbed; `cspFor` reads the Supabase URL
 * and `NODE_ENV` per call, so each case sets exactly what it asserts on.
 */
const fakeEnv = vi.hoisted(() => ({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }));
vi.mock('@/lib/env', () => ({ env: fakeEnv }));

import { CSP_REPORT_PATH, cspFor, cspHeaderName, newNonce } from './csp';

function directive(policy: string, name: string): string | undefined {
  return policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

afterEach(() => {
  vi.unstubAllEnvs();
  fakeEnv.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
});

describe('cspFor', () => {
  it('puts the nonce and strict-dynamic in script-src, never in style-src (Pitfall 8)', () => {
    const policy = cspFor('abc123', { https: false, mode: 'enforce' });
    expect(directive(policy, 'script-src')).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    );
    expect(directive(policy, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(policy, 'style-src')).not.toContain('nonce-');
  });

  it('adds upgrade-insecure-requests only for https requests (Pitfall 9)', () => {
    expect(
      directive(cspFor('n', { https: true, mode: 'enforce' }), 'upgrade-insecure-requests'),
    ).toBe('upgrade-insecure-requests');
    expect(
      directive(cspFor('n', { https: false, mode: 'enforce' }), 'upgrade-insecure-requests'),
    ).toBeUndefined();
  });

  it('derives the Realtime twin from the Supabase scheme', () => {
    const local = directive(cspFor('n', { https: false, mode: 'enforce' }), 'connect-src');
    expect(local).toContain('http://127.0.0.1:54321');
    expect(local).toContain('ws://127.0.0.1:54321');
    expect(local).not.toContain('wss://');

    fakeEnv.NEXT_PUBLIC_SUPABASE_URL = 'https://abcd.supabase.co';
    const hosted = directive(cspFor('n', { https: true, mode: 'enforce' }), 'connect-src');
    expect(hosted).toContain('https://abcd.supabase.co');
    expect(hosted).toContain('wss://abcd.supabase.co');
    expect(hosted).not.toContain('ws://abcd');
    expect(directive(cspFor('n', { https: true, mode: 'enforce' }), 'img-src')).toContain(
      'https://abcd.supabase.co',
    );
  });

  it("allows 'unsafe-eval' only under next dev", () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(cspFor('n', { https: true, mode: 'enforce' })).not.toContain("'unsafe-eval'");
    vi.stubEnv('NODE_ENV', 'test');
    expect(cspFor('n', { https: false, mode: 'enforce' })).not.toContain("'unsafe-eval'");
    vi.stubEnv('NODE_ENV', 'development');
    expect(directive(cspFor('n', { https: false, mode: 'enforce' }), 'script-src')).toContain(
      "'unsafe-eval'",
    );
  });

  it('forbids framing, plugins and base rewrites, and names the two players and the report sink', () => {
    const policy = cspFor('n', { https: false, mode: 'report-only' });
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(policy, 'form-action')).toBe("form-action 'self'");
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    expect(directive(policy, 'frame-src')).toBe(
      'frame-src https://www.youtube-nocookie.com https://player.vimeo.com',
    );
    expect(directive(policy, 'worker-src')).toBe("worker-src 'self' blob:");
    expect(directive(policy, 'report-uri')).toBe(`report-uri ${CSP_REPORT_PATH}`);
    expect(
      directive(cspFor('n', { https: false, mode: 'enforce', reportUri: '/x' }), 'report-uri'),
    ).toBe('report-uri /x');
  });

  it('carries the nonce of each call, and newNonce mints a fresh 16-byte value every time', () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
    expect(cspFor(a, { https: false, mode: 'enforce' })).toContain(`'nonce-${a}'`);
    expect(cspFor(b, { https: false, mode: 'enforce' })).toContain(`'nonce-${b}'`);
    expect(cspFor(b, { https: false, mode: 'enforce' })).not.toContain(a);
  });
});

describe('cspHeaderName', () => {
  it('enforces only in enforce mode', () => {
    expect(cspHeaderName('enforce')).toBe('Content-Security-Policy');
    expect(cspHeaderName('report-only')).toBe('Content-Security-Policy-Report-Only');
  });
});
