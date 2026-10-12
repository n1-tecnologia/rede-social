import { describe, expect, it } from 'vitest';
import { authLinkForwardTarget } from './auth-link-forward';

/**
 * The forward rule for a token link that reached `/` (quick 261012-s0v): exactly `/` with BOTH
 * `token_hash` and `type` forwards to `/auth/confirm` on the same origin with the identical query;
 * anything else is left to the rest of the proxy.
 */

describe('authLinkForwardTarget — forwards exactly the site_url-fallback shape', () => {
  it('rewrites only the pathname, keeping origin and query', () => {
    const target = authLinkForwardTarget(new URL('https://t.example/?token_hash=x&type=signup'));
    expect(target).not.toBeNull();
    expect(target?.pathname).toBe('/auth/confirm');
    expect(target?.search).toBe('?token_hash=x&type=signup');
    expect(target?.origin).toBe('https://t.example');
  });

  it.each([
    ['https://t.example/'],
    ['https://t.example/?token_hash=x'],
    ['https://t.example/?type=signup'],
    ['https://t.example/inicio?token_hash=x&type=signup'],
    ['https://t.example/auth/confirm?token_hash=x&type=signup'],
  ])('returns null for %s', (href) => {
    expect(authLinkForwardTarget(new URL(href))).toBeNull();
  });

  it('keeps extra params verbatim and in order', () => {
    const input = new URL('https://t.example/?token_hash=x&type=signup&next=%2Finicio&foo=bar');
    const target = authLinkForwardTarget(input);
    expect(target?.search).toBe(input.search);
    expect(target?.href).toBe(
      'https://t.example/auth/confirm?token_hash=x&type=signup&next=%2Finicio&foo=bar',
    );
  });

  it('keeps the origin, port included', () => {
    const target = authLinkForwardTarget(
      new URL('http://rede-demo.localhost:3000/?token_hash=x&type=signup'),
    );
    expect(target?.href).toBe(
      'http://rede-demo.localhost:3000/auth/confirm?token_hash=x&type=signup',
    );
  });

  it('does not mutate the input URL', () => {
    const input = new URL('https://t.example/?token_hash=x&type=signup');
    authLinkForwardTarget(input);
    expect(input.pathname).toBe('/');
    expect(input.href).toBe('https://t.example/?token_hash=x&type=signup');
  });
});
