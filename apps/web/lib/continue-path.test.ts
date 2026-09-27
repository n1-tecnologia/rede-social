import { describe, expect, it } from 'vitest';
import { isContinuablePath, safeContinuePath } from './continue-path';

/**
 * The continue cookie's two predicates (FEED-07, widened by 06-06 for calendar links, D-211, T-06-41).
 *
 *  1. `isContinuablePath` accepts EXACTLY the shareable post link and the two event calendar shapes
 *     (a lowercase uuid, optionally followed by `/entrar`), and nothing else;
 *  2. `safeContinuePath` keeps every open-redirect guard it had: protocol-relative paths, control
 *     characters, over-length values and anything outside the accepted shapes are refused.
 */

const UUID = '0e000000-0000-4000-8000-000000000e02';

describe('isContinuablePath — the shareable paths, and only those', () => {
  it.each([
    ['/post/x'],
    ['/post/11111111-1111-4111-8111-111111111111'],
    [`/eventos/${UUID}`],
    [`/eventos/${UUID}/entrar`],
  ])('accepts %s', (path) => {
    expect(isContinuablePath(path)).toBe(true);
  });

  it.each([
    ['/eventos'],
    ['/eventos/novo'],
    [`/eventos/${UUID}/editar`],
    [`/eventos/${UUID}/entrar/aviso`],
    [`/eventos/${UUID}/check-in`],
    [`/eventos/${UUID.toUpperCase()}`],
    [`/eventos/${UUID}/entrar/`],
    [`/eventos/${UUID}x`],
    ['/configuracoes'],
    ['/inicio'],
    ['/post/x/y'],
  ])('rejects %s', (path) => {
    expect(isContinuablePath(path)).toBe(false);
  });
});

describe('safeContinuePath — the open-redirect rules are unchanged', () => {
  it('passes the accepted shapes through untouched', () => {
    expect(safeContinuePath('/post/x')).toBe('/post/x');
    expect(safeContinuePath(`/eventos/${UUID}`)).toBe(`/eventos/${UUID}`);
    expect(safeContinuePath(`/eventos/${UUID}/entrar`)).toBe(`/eventos/${UUID}/entrar`);
  });

  it.each([
    ['//evil.com'],
    ['/\\evil.com'],
    ['//evil.com/eventos/x'],
    ['https://evil.com/post/x'],
    [`https://evil.com/eventos/${UUID}/entrar`],
    ['post/x'],
    ['/post/x\n'],
    ['/post/\u0000x'],
    [`/eventos/${UUID}/entrar\r\nSet-Cookie: x=1`],
    [`/post/${'a'.repeat(600)}`],
    ['/configuracoes'],
    [''],
  ])('refuses %j', (raw) => {
    expect(safeContinuePath(raw)).toBeNull();
  });

  it('refuses a missing value', () => {
    expect(safeContinuePath(undefined)).toBeNull();
    expect(safeContinuePath(null)).toBeNull();
  });
});
