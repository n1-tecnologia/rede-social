import { describe, expect, it } from 'vitest';
import {
  LINK_RETURN_COOKIE,
  LINK_RETURN_MAX_AGE_S,
  linkReturnCookieOptions,
  linkReturnFor,
  linkReturnScreen,
  parseLinkReturn,
} from './link-return';

/**
 * The marker cookie of a confirmation / recovery / invite link opened in a browser (quick
 * 261007-kyp): which marker a successful exchange writes, how it is read back (strict allow-list)
 * and which screen a gated device shows for it on a given path. Node environment: the module imports
 * nothing from push or UI.
 */

describe('linkReturnFor', () => {
  it('1. signup and email links are signup', () => {
    expect(linkReturnFor('signup', '/inicio')).toBe('signup');
    expect(linkReturnFor('email', '/inicio')).toBe('signup');
  });

  it('2. recovery is recovery, unless its next is the invite landing (the invite mail fallback)', () => {
    expect(linkReturnFor('recovery', '/redefinir-senha')).toBe('recovery');
    expect(linkReturnFor('recovery', '/aceitar-convite')).toBe('invite');
  });

  it('3. invite links are invite whatever the next', () => {
    expect(linkReturnFor('invite', '/aceitar-convite?x=1')).toBe('invite');
    expect(linkReturnFor('invite', '/inicio')).toBe('invite');
  });

  it('4. magiclink, empty and unknown types write nothing', () => {
    expect(linkReturnFor('magiclink', '/inicio')).toBeNull();
    expect(linkReturnFor('', '/inicio')).toBeNull();
    expect(linkReturnFor('whatever', '/inicio')).toBeNull();
  });

  it('5. a next that merely starts with the invite path is not an invite', () => {
    expect(linkReturnFor('recovery', '/aceitar-convite-x')).toBe('recovery');
    expect(linkReturnFor('signup', '/aceitar-convite-x')).toBe('signup');
  });
});

describe('parseLinkReturn', () => {
  it('6. accepts exactly signup, recovery and invite', () => {
    expect(parseLinkReturn('signup')).toBe('signup');
    expect(parseLinkReturn('recovery')).toBe('recovery');
    expect(parseLinkReturn('invite')).toBe('invite');
  });

  it('7. everything else is null and never echoed', () => {
    for (const raw of [
      undefined,
      '',
      'Signup',
      'RECOVERY',
      ' signup',
      'signup ',
      'magiclink',
      '<script>',
      'x'.repeat(5000),
    ]) {
      expect(parseLinkReturn(raw)).toBeNull();
    }
  });
});

describe('linkReturnScreen', () => {
  it('8. no marker: no screen on any path', () => {
    expect(linkReturnScreen(null, '/inicio')).toBeNull();
    expect(linkReturnScreen(null, '/redefinir-senha')).toBeNull();
  });

  it('9. signup shows on every path', () => {
    expect(linkReturnScreen('signup', '/inicio')).toBe('show');
    expect(linkReturnScreen('signup', '/redefinir-senha')).toBe('show');
    expect(linkReturnScreen('signup', '/entrar')).toBe('show');
  });

  it('10. recovery passes on its own form and below it, shows elsewhere', () => {
    expect(linkReturnScreen('recovery', '/redefinir-senha')).toBe('pass');
    expect(linkReturnScreen('recovery', '/redefinir-senha/anything')).toBe('pass');
    expect(linkReturnScreen('recovery', '/inicio')).toBe('show');
    expect(linkReturnScreen('recovery', '/aceitar-convite')).toBe('show');
    expect(linkReturnScreen('recovery', '/redefinir-senhax')).toBe('show');
  });

  it('11. invite passes on its own form and below it, shows elsewhere', () => {
    expect(linkReturnScreen('invite', '/aceitar-convite')).toBe('pass');
    expect(linkReturnScreen('invite', '/aceitar-convite/x')).toBe('pass');
    expect(linkReturnScreen('invite', '/redefinir-senha')).toBe('show');
    expect(linkReturnScreen('invite', '/inicio')).toBe('show');
    expect(linkReturnScreen('invite', '/aceitar-convite-x')).toBe('show');
  });
});

describe('cookie policy', () => {
  it('12. HttpOnly, SameSite lax, path /, ten minutes, no domain', () => {
    expect(LINK_RETURN_COOKIE).toBe('link_return');
    expect(LINK_RETURN_MAX_AGE_S).toBe(600);
    expect(linkReturnCookieOptions.httpOnly).toBe(true);
    expect(linkReturnCookieOptions.sameSite).toBe('lax');
    expect(linkReturnCookieOptions.path).toBe('/');
    expect(linkReturnCookieOptions.maxAge).toBe(600);
    expect('domain' in linkReturnCookieOptions).toBe(false);
  });
});
