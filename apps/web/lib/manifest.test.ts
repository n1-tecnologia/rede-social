import { NEUTRAL_BRAND, resolveBranding } from '@tria/contracts/branding';
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  iconsFor,
  isAllowedIconUrl,
  isManifestSlug,
  manifestPath,
  NEUTRAL_ICONS,
  NEUTRAL_MANIFEST_SLUG,
  neutralManifest,
  shortName,
} from './manifest';

const origin = 'http://127.0.0.1:54321';
const bucket = `${origin}/storage/v1/object/public/branding/11111111-1111-1111-1111-111111111111/branding/icons/1`;
const derived = {
  i192: `${bucket}/icon-192.png`,
  i512: `${bucket}/icon-512.png`,
  maskable512: `${bucket}/icon-maskable-512.png`,
  apple180: `${bucket}/apple-touch-icon-180.png`,
};

describe('lib/manifest — buildManifest (PWA-01, D-25)', () => {
  it('1. emits the locked id scheme, / start_url + scope, standalone, pt-BR, the neutral bg and three PNG icons', () => {
    const m = buildManifest({
      slug: 'tria-demo',
      displayName: 'TRIA Demo',
      themeColor: '#7c3aed',
      icons: NEUTRAL_ICONS,
    });
    expect(m.id).toBe('/?tenant=tria-demo');
    expect(m.name).toBe('TRIA Demo');
    expect(m.short_name).toBe('TRIA Demo');
    expect(m.start_url).toBe('/');
    expect(m.scope).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.lang).toBe('pt-BR');
    expect(m.background_color).toBe('#f5f7fb');
    expect(m.theme_color).toBe('#7c3aed');
    expect(m.icons).toHaveLength(3);
    expect(m.icons?.map((i) => [i.sizes, i.purpose, i.type])).toEqual([
      ['192x192', 'any', 'image/png'],
      ['512x512', 'any', 'image/png'],
      ['512x512', 'maskable', 'image/png'],
    ]);
  });

  it('2. shortName cuts at 12 characters without a trailing space and keeps short names as-is', () => {
    const cut = shortName('Associação Beneficente São José');
    expect(cut.length).toBeLessThanOrEqual(12);
    expect(cut).toBe(cut.trimEnd());
    expect(cut).toBe('Associação B');
    expect(shortName('Associação  Beneficente')).toBe('Associação');
    expect(shortName('TRIA Demo')).toBe('TRIA Demo');
    expect(shortName('  TRIA  ')).toBe('TRIA');
  });

  it('3. manifestPath and isManifestSlug: tenant slugs and the reserved _tria only', () => {
    expect(manifestPath('tria-demo')).toBe('/m/tria-demo/manifest.webmanifest');
    expect(manifestPath(null)).toBe('/m/_tria/manifest.webmanifest');
    expect(isManifestSlug(NEUTRAL_MANIFEST_SLUG)).toBe(true);
    expect(isManifestSlug('tria-demo')).toBe(true);
    expect(isManifestSlug('Tria_Demo')).toBe(false);
    expect(isManifestSlug('a')).toBe(false);
    expect(isManifestSlug('')).toBe(false);
    expect(isManifestSlug('not a slug')).toBe(false);
  });

  it('4. neutralManifest is TRIA on the reserved slug with the neutral primary and icons', () => {
    const m = neutralManifest();
    expect(m.name).toBe('TRIA');
    expect(m.id).toBe('/?tenant=_tria');
    expect(m.theme_color).toBe(NEUTRAL_BRAND.primary);
    expect(m.icons?.map((i) => i.src)).toEqual([
      NEUTRAL_ICONS.i192,
      NEUTRAL_ICONS.i512,
      NEUTRAL_ICONS.maskable512,
    ]);
  });
});

describe('lib/manifest — icon allow-list (T-02-72)', () => {
  it('5. isAllowedIconUrl: /icons/* and the public branding bucket on the Supabase origin only', () => {
    expect(isAllowedIconUrl('/icons/tria-192.png', origin)).toBe(true);
    expect(isAllowedIconUrl(derived.i192, origin)).toBe(true);
    expect(isAllowedIconUrl('https://evil.example/icon.png', origin)).toBe(false);
    expect(isAllowedIconUrl(`${origin}/storage/v1/object/public/media/x.png`, origin)).toBe(false);
    expect(isAllowedIconUrl('javascript:alert(1)', origin)).toBe(false);
    expect(isAllowedIconUrl('/icons/../auth/x.png', origin)).toBe(false);
    expect(isAllowedIconUrl('//evil.example/icons/x.png', origin)).toBe(false);
    expect(isAllowedIconUrl('', origin)).toBe(false);
    expect(isAllowedIconUrl('/seed-logos/demo.svg', origin)).toBe(false);
  });

  it('6. iconsFor: no derived icons → the neutral set', () => {
    expect(iconsFor(resolveBranding({}), origin)).toEqual(NEUTRAL_ICONS);
  });

  it('7. iconsFor: four allowed derived icons → those four; favicon = faviconUrl when allowed, else i192', () => {
    const withFavicon = iconsFor(
      resolveBranding({ iconUrls: derived, faviconUrl: `${bucket}/favicon-48.png` }),
      origin,
    );
    expect(withFavicon).toEqual({ ...derived, favicon: `${bucket}/favicon-48.png` });

    const foreignFavicon = iconsFor(
      resolveBranding({ iconUrls: derived, faviconUrl: 'https://evil.example/favicon.ico' }),
      origin,
    );
    expect(foreignFavicon).toEqual({ ...derived, favicon: derived.i192 });

    const noFavicon = iconsFor(resolveBranding({ iconUrls: derived, faviconUrl: null }), origin);
    expect(noFavicon.favicon).toBe(derived.i192);
  });

  it('8. iconsFor: one foreign value makes the WHOLE set fall back — never mixed', () => {
    const tampered = { ...derived, maskable512: 'https://evil.example/mask.png' };
    expect(iconsFor(resolveBranding({ iconUrls: tampered }), origin)).toEqual(NEUTRAL_ICONS);

    const otherBucket = { ...derived, i512: `${origin}/storage/v1/object/public/media/i512.png` };
    expect(iconsFor(resolveBranding({ iconUrls: otherBucket }), origin)).toEqual(NEUTRAL_ICONS);
  });
});
