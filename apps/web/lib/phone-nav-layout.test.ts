import { describe, expect, it } from 'vitest';
import {
  encodePhoneNavLayout,
  parseLegacyNavOrder,
  parsePhoneNavLayout,
  placementAllowed,
} from './phone-nav-layout';

/**
 * 2026-11-05 — the phone's menu kept on the device (Configurações › Menu do app): the cookie's text
 * both ways, read leniently (a cookie is user input), the 2026-10-28 order cookie still read, and the
 * editor's place rules.
 */
describe('the phone menu cookie', () => {
  it('round-trips the bar, the top and the hidden items', () => {
    const layout = {
      bar: ['store', 'home', 'communities'],
      top: ['events'],
      hidden: ['reels', 'profile'],
    };
    const text = encodePhoneNavLayout(layout);
    expect(text).toBe('b:store.home.communities|t:events|h:reels.profile');
    expect(parsePhoneNavLayout(text)).toEqual(layout);
  });

  it('drops bad and repeated keys, a key keeping its first list; no bar is no layout', () => {
    expect(parsePhoneNavLayout('b:home.Loja.home|t:home.events|h:<x>.reels')).toEqual({
      bar: ['home'],
      top: ['events'],
      hidden: ['reels'],
    });
    expect(parsePhoneNavLayout(undefined)).toBeNull();
    expect(parsePhoneNavLayout('t:events')).toBeNull();
    expect(parsePhoneNavLayout('lixo')).toBeNull();
  });

  it("reads 2026-10-28's order cookie as the bar", () => {
    expect(parseLegacyNavOrder('store.home.events')).toEqual({
      bar: ['store', 'home', 'events'],
      top: [],
      hidden: [],
    });
    expect(parseLegacyNavOrder('')).toBeNull();
  });
});

describe('placementAllowed', () => {
  it('Início only in the bar, Perfil never at the top, the rest anywhere', () => {
    expect(['bar', 'top', 'hidden'].map((p) => placementAllowed('home', p as 'bar'))).toEqual([
      true,
      false,
      false,
    ]);
    expect(['bar', 'top', 'hidden'].map((p) => placementAllowed('profile', p as 'bar'))).toEqual([
      true,
      false,
      true,
    ]);
    expect(['bar', 'top', 'hidden'].map((p) => placementAllowed('events', p as 'bar'))).toEqual([
      true,
      true,
      true,
    ]);
  });
});
