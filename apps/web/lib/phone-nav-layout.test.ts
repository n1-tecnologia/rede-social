import { PHONE_MENU_BAR_ONLY, PHONE_MENU_NEVER_TOP, resolveBranding } from '@rede-social/contracts';
import { describe, expect, it } from 'vitest';
import * as phoneNavLayout from './phone-nav-layout';
import { placementAllowed, savedPhoneLayout } from './phone-nav-layout';

/**
 * 12.3-16 (D-695, D-697, UI-D-694) — the phone's menu the tenant's administrator arranges
 * (Configurações › Menu do app). It lives in the tenant's brand, delivered by the bootstrap: the
 * device cookies that kept it before 12.3 are gone and never read, and the editor's place rules are the
 * contract's own constants.
 */
describe('the saved phone menu', () => {
  it('is read from the brand: the three lists as the API keeps them', () => {
    const phoneMenu = {
      bar: ['store', 'home', 'communities'],
      top: ['events'],
      hidden: ['reels', 'profile'],
    };
    const branding = resolveBranding({ phoneMenu });
    expect(savedPhoneLayout(branding)).toEqual(phoneMenu);
  });

  it("is null when the brand has none: the shell's own menu", () => {
    expect(savedPhoneLayout(resolveBranding({}))).toBeNull();
    expect(savedPhoneLayout(resolveBranding(null))).toBeNull();
  });

  it('reads a corrupt stored value as no menu, never as a failure', () => {
    expect(savedPhoneLayout(resolveBranding({ phoneMenu: { bar: 'x' } }))).toBeNull();
  });

  it('no longer offers the cookie names, writer or readers (D-695)', () => {
    expect(Object.keys(phoneNavLayout).sort()).toEqual(['placementAllowed', 'savedPhoneLayout']);
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

  it("follows the contract's own lists, not a copy of them", () => {
    for (const key of PHONE_MENU_BAR_ONLY) {
      expect(placementAllowed(key, 'bar')).toBe(true);
      expect(placementAllowed(key, 'top')).toBe(false);
      expect(placementAllowed(key, 'hidden')).toBe(false);
    }
    for (const key of PHONE_MENU_NEVER_TOP) expect(placementAllowed(key, 'top')).toBe(false);
  });
});
