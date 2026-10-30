import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTH_PATH_PREFIXES,
  PROFILE_FORM_PATH,
  REQUEST_PATH_HEADER,
  safeNextPath,
} from './safe-next-path';

/**
 * `safeNextPath` (12-11, D-583, PFORM-15, T-12-27): the destination a gated member is sent back to is
 * a same-origin relative path or it is dropped. Exercised on the raw value, on one decode of it, on the
 * exclusions (the form itself and every `(auth)` route) and on idempotency.
 */

const appDir = join(__dirname, '..', 'app');
const folders = (dir: string) =>
  readdirSync(join(appDir, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

describe('safeNextPath: the accepted shape', () => {
  it.each([['/post/abc?x=1'], ['/inicio'], ['/cursos/abc/aulas/3'], ['/a%2Fb'], ['/perfil#topo']])(
    'passes %s through unchanged',
    (value) => {
      expect(safeNextPath(value)).toBe(value);
    },
  );

  it('names the request header the proxy sets', () => {
    expect(REQUEST_PATH_HEADER).toBe('x-rede-path');
  });
});

describe('safeNextPath: empty and malformed values degrade to null, never an error', () => {
  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['\t\n'],
    ['post/abc'],
    ['//evil.com'],
    ['/\\evil.com'],
    ['/a\\b'],
    ['https://evil.com'],
    ['javascript:alert(1)'],
    ['/post/\u0000x'],
    ['/post/x\r\nSet-Cookie: a=b'],
    ['/post/\u007fx'],
    [`/${'a'.repeat(500)}`],
  ])('refuses %j', (value) => {
    expect(safeNextPath(value as string | null | undefined)).toBeNull();
  });

  it('accepts exactly 500 characters and refuses 501', () => {
    expect(safeNextPath(`/${'a'.repeat(499)}`)).not.toBeNull();
    expect(safeNextPath(`/${'a'.repeat(500)}`)).toBeNull();
  });
});

describe('safeNextPath: encoded and look-alike variants are refused after exactly ONE decode', () => {
  it.each([
    ['/%2F%2Fevil.com'],
    ['/%2f%2fevil.com'],
    ['/%5Cevil.com'],
    ['/%0d%0aX'],
    ['/%09/evil'],
    ['/%00x'],
    ['/%E0%A4%A'],
    ['/%EF%BC%8Fevil.com'],
    ['/／evil.com'],
    ['/a∕b'],
    ['/a＼b'],
  ])('refuses %j', (value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it('never decodes twice: %252F stays %2F and %255C stays %5C', () => {
    expect(safeNextPath('/a%252F%252Fb')).toBe('/a%252F%252Fb');
    expect(safeNextPath('/a%255Cb')).toBe('/a%255Cb');
  });

  it('keeps a plain encoded slash inside a valid path', () => {
    expect(safeNextPath('/a%2Fb')).toBe('/a%2Fb');
  });
});

describe('safeNextPath: the exclusions', () => {
  it.each([
    [PROFILE_FORM_PATH],
    [`${PROFILE_FORM_PATH}?next=/inicio`],
    [`${PROFILE_FORM_PATH}/x`],
    [`${PROFILE_FORM_PATH}#a`],
    ['/completar%2Dperfil'],
    ['/entrar'],
    ['/entrar?x=1'],
    ['/entrar/'],
    ['/assinatura-pendente'],
    ['/participar'],
    ['/auth/blocked'],
    ['/auth/confirm?token_hash=abc'],
    ['/%65ntrar'],
    ['/entrar%3Fx'],
  ])('refuses %s', (value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it('does not refuse a path that merely starts with the same letters', () => {
    expect(safeNextPath('/completar-perfil-x')).toBe('/completar-perfil-x');
    expect(safeNextPath('/entrarx')).toBe('/entrarx');
    expect(safeNextPath('/authors')).toBe('/authors');
  });

  it('refuses every route folder under app/(auth): the list is derived from the folders', () => {
    const missing = folders('(auth)')
      .filter((name) => !AUTH_PATH_PREFIXES.includes(`/${name}`))
      .map((name) => `/${name}`);
    expect(missing, 'a (auth) folder is missing from AUTH_PATH_PREFIXES').toEqual([]);
    for (const name of folders('(auth)')) expect(safeNextPath(`/${name}`)).toBeNull();
  });

  it('refuses every route handler folder under app/auth through the /auth prefix', () => {
    expect(AUTH_PATH_PREFIXES).toContain('/auth');
    for (const name of folders('auth')) expect(safeNextPath(`/auth/${name}`)).toBeNull();
  });

  it('lists no prefix that has no folder behind it', () => {
    const real = new Set(['auth', ...folders('(auth)')].map((name) => `/${name}`));
    expect(AUTH_PATH_PREFIXES.filter((prefix) => !real.has(prefix))).toEqual([]);
  });
});

describe('safeNextPath: idempotency', () => {
  it.each([['/post/abc?x=1'], ['/a%2Fb'], ['/ação%20x'], ['//evil.com'], ['/entrar']])(
    'gives the same result twice for %j',
    (value) => {
      expect(safeNextPath(value)).toBe(safeNextPath(value));
    },
  );

  it('a validated path survives one encodeURIComponent and validates again unchanged', () => {
    const first = safeNextPath('/post/abc?x=1&y=2');
    expect(first).toBe('/post/abc?x=1&y=2');
    const param = encodeURIComponent(first as string);
    const received = new URLSearchParams(`next=${param}`).get('next');
    expect(safeNextPath(received)).toBe(first);
  });
});
