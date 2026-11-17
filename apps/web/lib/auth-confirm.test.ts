import { describe, expect, it } from 'vitest';
import {
  CONFIRM_CONTINUE_PATH,
  CONFIRM_POST_PATH,
  continueHref,
  failureDestination,
  isAcceptInvitePath,
  isCrossSiteSubmission,
  isOtpType,
  sameOriginPath,
  sanitizeNext,
} from './auth-confirm';

const ORIGIN = 'http://rede-demo.localhost:3000';

describe('sameOriginPath', () => {
  it('keeps a same-origin path with its query', () => {
    expect(sameOriginPath('/redefinir-senha', ORIGIN)).toBe('/redefinir-senha');
    expect(sameOriginPath('/aceitar-convite?x=1', ORIGIN)).toBe('/aceitar-convite?x=1');
  });

  it('sends every hostile or relative spelling to /inicio', () => {
    for (const bad of [
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'inicio',
    ]) {
      expect(sameOriginPath(bad, ORIGIN)).toBe('/inicio');
    }
  });
});

describe('sanitizeNext (no request origin)', () => {
  it('uses the same table against a fixed reference origin', () => {
    expect(sanitizeNext('/redefinir-senha')).toBe('/redefinir-senha');
    expect(sanitizeNext('/aceitar-convite?x=1')).toBe('/aceitar-convite?x=1');
    for (const bad of [
      null,
      undefined,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'inicio',
    ]) {
      expect(sanitizeNext(bad)).toBe('/inicio');
    }
  });
});

describe('isOtpType', () => {
  it('accepts exactly the five allowed types', () => {
    for (const t of ['recovery', 'email', 'signup', 'invite', 'magiclink']) {
      expect(isOtpType(t)).toBe(true);
    }
    expect(isOtpType(null)).toBe(false);
    expect(isOtpType('')).toBe(false);
    expect(isOtpType('nonsense')).toBe(false);
  });
});

describe('isAcceptInvitePath / failureDestination', () => {
  it('only the exact invite path counts as an invite', () => {
    expect(isAcceptInvitePath('/aceitar-convite')).toBe(true);
    expect(isAcceptInvitePath('/aceitar-convite?x=1')).toBe(true);
    expect(isAcceptInvitePath('/aceitar-convite-x')).toBe(false);
    expect(isAcceptInvitePath('/outra?next=/aceitar-convite')).toBe(false);
  });

  it('maps the failure destinations as the route always did', () => {
    expect(failureDestination('invite', '/inicio')).toBe('/convite-expirado');
    expect(failureDestination('recovery', '/aceitar-convite')).toBe('/convite-expirado');
    expect(failureDestination('recovery', '/aceitar-convite-x')).toBe(
      '/esqueci-senha?erro=link-invalido',
    );
    expect(failureDestination('signup', '/inicio')).toBe('/verifique-seu-email?erro=link-invalido');
    for (const t of ['recovery', 'email', 'magiclink', null, 'nonsense']) {
      expect(failureDestination(t, '/redefinir-senha')).toBe('/esqueci-senha?erro=link-invalido');
    }
  });
});

describe('paths and continueHref', () => {
  it('names the two paths', () => {
    expect(CONFIRM_POST_PATH).toBe('/auth/confirm');
    expect(CONFIRM_CONTINUE_PATH).toBe('/auth/continuar');
  });

  it('builds the interstitial href in order', () => {
    expect(continueHref('abc', 'recovery', '/redefinir-senha')).toBe(
      '/auth/continuar?token_hash=abc&type=recovery&next=%2Fredefinir-senha',
    );
  });

  it('round-trips an awkward token', () => {
    const token = 'a&b=c+d "e"';
    const href = continueHref(token, 'recovery', '/x?y=1&z=2');
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('token_hash')).toBe(token);
    expect(params.get('next')).toBe('/x?y=1&z=2');
  });
});

describe('isCrossSiteSubmission', () => {
  const h = (init: Record<string, string>) => ({
    get: (name: string) => init[name.toLowerCase()] ?? null,
  });
  const hosts = ['rede-demo.localhost:3000'];

  it('refuses Sec-Fetch-Site cross-site, accepts same-origin', () => {
    expect(isCrossSiteSubmission(h({ 'sec-fetch-site': 'cross-site' }), hosts)).toBe(true);
    expect(isCrossSiteSubmission(h({ 'sec-fetch-site': 'same-origin' }), hosts)).toBe(false);
  });

  it('judges same-site by the Origin host', () => {
    expect(
      isCrossSiteSubmission(
        h({ 'sec-fetch-site': 'same-site', origin: 'http://rede-demo.localhost:3000' }),
        hosts,
      ),
    ).toBe(false);
    expect(
      isCrossSiteSubmission(
        h({ 'sec-fetch-site': 'same-site', origin: 'http://other.localhost:3000' }),
        hosts,
      ),
    ).toBe(true);
  });

  it('refuses a foreign or unparseable Origin, accepts null and absent', () => {
    expect(isCrossSiteSubmission(h({ origin: 'https://evil.example' }), hosts)).toBe(true);
    expect(isCrossSiteSubmission(h({ origin: 'garbage' }), hosts)).toBe(true);
    expect(isCrossSiteSubmission(h({ origin: 'null' }), hosts)).toBe(false);
    expect(isCrossSiteSubmission(h({}), hosts)).toBe(false);
  });

  it('fails open with no hosts and matches any host passed', () => {
    expect(isCrossSiteSubmission(h({ origin: 'https://evil.example' }), [])).toBe(false);
    expect(
      isCrossSiteSubmission(h({ origin: 'https://social.example.com' }), [
        'social.example.com',
        'internal:3000',
      ]),
    ).toBe(false);
  });
});
