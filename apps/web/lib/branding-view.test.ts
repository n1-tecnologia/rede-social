import { adminBrandingSchema, type PlatformTenantDetail } from '@rede-social/contracts';
import { deriveBrandColors, emptyBrandLook, NEUTRAL_BRAND } from '@rede-social/contracts/branding';
import { describe, expect, it } from 'vitest';
import { brandingViewKey, brandLookKey, toBrandingView } from './branding-view';

const contrast = {
  onPrimary: { ratio: 5.2, ok: true },
  lightSurface: { ratio: 4.1, ok: true },
  darkSurface: { ratio: 2.9, ok: false },
};

function detail(branding: Record<string, unknown>): PlatformTenantDetail {
  return {
    tenant: {
      id: '6f2c5b1e-4d3a-4c2b-9e8f-1a2b3c4d5e6f',
      slug: 'assoc',
      displayName: 'Associação São José',
      status: 'active',
      timezone: 'America/Sao_Paulo',
      createdAt: '2026-09-16T00:00:00.000Z',
      branding,
      contrast,
    },
    modules: [],
    domains: [],
    invites: [],
    admins: [],
  } as unknown as PlatformTenantDetail;
}

const icons = (version: number) => ({
  i192: `https://s.test/storage/v1/object/public/branding/t/branding/icons/${version}/icon-192.png`,
  i512: `https://s.test/storage/v1/object/public/branding/t/branding/icons/${version}/icon-512.png`,
  maskable512: `https://s.test/storage/v1/object/public/branding/t/branding/icons/${version}/maskable-512.png`,
  apple180: `https://s.test/storage/v1/object/public/branding/t/branding/icons/${version}/apple-180.png`,
});

describe('toBrandingView (02-14)', () => {
  it('an empty branding jsonb → no assets, version 0, icons not ready, no source, neutral colours', () => {
    const view = toBrandingView(detail({}));
    expect(view.logoUrl).toBeNull();
    expect(view.iconUrl).toBeNull();
    expect(view.faviconUrl).toBeNull();
    expect(view.iconUrls).toBeNull();
    expect(view.iconVersion).toBe(0);
    expect(view.iconsReady).toBe(false);
    expect(view.hasSource).toBe(false);
    expect(view.colors).toEqual(deriveBrandColors(NEUTRAL_BRAND));
    expect(view.displayName).toBe('Associação São José');
  });

  it('a logo with icons derived for the current version → ready + source', () => {
    const view = toBrandingView(
      detail({
        logoUrl: 'https://s.test/logo.svg',
        iconVersion: 2,
        iconUrls: icons(2),
        colors: { primary: '#7c3aed', secondary: '#a78bfa' },
      }),
    );
    expect(view.iconsReady).toBe(true);
    expect(view.hasSource).toBe(true);
    expect(view.colors.primary).toBe('#7c3aed');
    expect(view.colors.onPrimary).toBe(
      deriveBrandColors({ primary: '#7c3aed', secondary: '#a78bfa' }).onPrimary,
    );
  });

  it('a bumped iconVersion with the previous set → not ready (the worker has not run yet)', () => {
    const view = toBrandingView(
      detail({ logoUrl: 'https://s.test/logo.svg', iconVersion: 3, iconUrls: icons(2) }),
    );
    expect(view.iconsReady).toBe(false);
    expect(view.hasSource).toBe(true);
    expect(view.iconVersion).toBe(3);
  });

  it('a square override alone counts as a source; the contrast report passes through untouched', () => {
    const view = toBrandingView(detail({ iconUrl: 'https://s.test/icon.png' }));
    expect(view.hasSource).toBe(true);
    expect(view.logoUrl).toBeNull();
    expect(view.contrast).toBe(contrast);
  });
});

describe('toBrandingView on the tenant lane (08-06, D-342)', () => {
  const stored = {
    logoUrl: 'https://s.test/logo.svg',
    iconVersion: 2,
    iconUrls: icons(2),
    colors: { primary: '#7c3aed', secondary: '#a78bfa' },
  };

  it('the admin subset maps to exactly the view the platform detail maps to', () => {
    const admin = adminBrandingSchema.parse({
      tenant: { displayName: 'Associação São José', branding: stored, contrast },
    });
    const fromAdmin = toBrandingView(admin);
    const fromPlatform = toBrandingView(detail(stored));
    expect(fromAdmin).toEqual(fromPlatform);
    expect(fromAdmin.displayName).toBe('Associação São José');
    expect(fromAdmin.iconsReady).toBe(true);
    expect(fromAdmin.contrast).toEqual(contrast);
  });

  it('an empty admin brand is the shipped no-logo state (neutral colours, no source)', () => {
    const view = toBrandingView(
      adminBrandingSchema.parse({ tenant: { displayName: 'Nova', branding: {}, contrast } }),
    );
    expect(view.hasSource).toBe(false);
    expect(view.logoUrl).toBeNull();
    expect(view.colors).toEqual(deriveBrandColors(NEUTRAL_BRAND));
  });
});

/**
 * 2026-10-03: the view carries the saved look (canonical, all `null` for an older brand), and the
 * look editor's key follows the look alone, so a pair save never throws away a look being edited.
 */
describe('the look in the Marca view', () => {
  it('reads an older brand as the system look and a saved one canonical', () => {
    expect(toBrandingView(detail({})).look).toEqual(emptyBrandLook());
    const view = toBrandingView(
      detail({ look: { lightTone: 'cinza', darkTone: 'cafe', titleFont: 'Manrope' } }),
    );
    expect(view.look.lightTone).toBeNull();
    expect(view.look.darkTone).toBe('cafe');
    expect(view.look.titleFont).toBeNull();
  });

  it('keys the look editor on the look alone, the form on the pair and the assets', () => {
    const before = toBrandingView(detail({ colors: { primary: '#7c3aed', secondary: '#a78bfa' } }));
    const pairSaved = toBrandingView(
      detail({ colors: { primary: '#0f766e', secondary: '#14b8a6' } }),
    );
    expect(brandLookKey(pairSaved)).toBe(brandLookKey(before));
    expect(brandingViewKey(pairSaved)).not.toBe(brandingViewKey(before));
    const lookSaved = toBrandingView(
      detail({
        colors: { primary: '#7c3aed', secondary: '#a78bfa' },
        look: { lightTone: 'lilas' },
      }),
    );
    expect(brandLookKey(lookSaved)).not.toBe(brandLookKey(before));
    expect(brandingViewKey(lookSaved)).toBe(brandingViewKey(before));
  });
});
