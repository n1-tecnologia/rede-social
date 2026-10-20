import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INICIO_TAB,
  INICIO_TABS,
  inicioTabFromParam,
  inicioTabHref,
  showsInicioTabs,
} from './tabs';

/**
 * 09-08 - the Início / Explorar chip registry (D-479, UI-D-491). Início is the default and the first
 * of the list; only a SINGLE string equal to `explorar` opens Explorar, so an unknown, empty or
 * repeated `?aba=` reads as Início with no notice (E01 error). The row itself is drawn only for a
 * viewer whose composed permissions say so (`showsInicioTabs`), never from a role comparison.
 */

describe('INICIO_TABS (D-479, ORDER IS THE CONTRACT)', () => {
  it('lists Início first and Explorar second', () => {
    expect(INICIO_TABS.map((tab) => tab.key)).toEqual(['inicio', 'explorar']);
    expect(INICIO_TABS.map((tab) => tab.labelKey)).toEqual([
      'social.tabs.home',
      'social.tabs.explore',
    ]);
    expect(DEFAULT_INICIO_TAB).toBe('inicio');
  });
});

describe('inicioTabFromParam (UI-D-491, E01 error)', () => {
  it('no value, an empty value and `inicio` read as inicio', () => {
    expect(inicioTabFromParam(undefined)).toBe('inicio');
    expect(inicioTabFromParam('')).toBe('inicio');
    expect(inicioTabFromParam('inicio')).toBe('inicio');
  });

  it('an unknown value and a repeated param read as inicio', () => {
    expect(inicioTabFromParam('xyz')).toBe('inicio');
    expect(inicioTabFromParam(['explorar', 'explorar'])).toBe('inicio');
    expect(inicioTabFromParam(['explorar'])).toBe('inicio');
    expect(inicioTabFromParam('EXPLORAR')).toBe('inicio');
    expect(inicioTabFromParam(' explorar')).toBe('inicio');
  });

  it('only a single `explorar` opens Explorar', () => {
    expect(inicioTabFromParam('explorar')).toBe('explorar');
  });
});

describe('inicioTabHref (UI-D-491)', () => {
  it('Início is the bare path and Explorar carries ?aba=explorar', () => {
    expect(inicioTabHref('inicio')).toBe('/inicio');
    expect(inicioTabHref('explorar')).toBe('/inicio?aba=explorar');
  });
});

describe('showsInicioTabs (D-479: the composed permissions decide, with social effective)', () => {
  const social = [{ key: 'feed' }, { key: 'social' }];

  it('a member (social.participate) sees the row', () => {
    expect(showsInicioTabs(['social.participate', 'feed.post.create'], social)).toBe(true);
  });

  it('a moderator (moderation.manage) sees the row', () => {
    expect(showsInicioTabs(['moderation.manage', 'content.publish'], social)).toBe(true);
  });

  it('support_tenant (neither permission) gets no row', () => {
    expect(showsInicioTabs(['chat.support.reply'], social)).toBe(false);
    expect(showsInicioTabs([], social)).toBe(false);
  });

  it('with the social module absent nobody gets the row, whatever the permissions', () => {
    const noSocial = [{ key: 'feed' }];
    expect(showsInicioTabs(['social.participate'], noSocial)).toBe(false);
    expect(showsInicioTabs(['moderation.manage'], noSocial)).toBe(false);
  });
});
