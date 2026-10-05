import { describe, expect, it } from 'vitest';
import {
  BUTTON_STYLES,
  brandingLookBodySchema,
  brandLookSchema,
  brandStyleVars,
  contrastRatio,
  contrastReport,
  DARK_TONES,
  DEFAULT_DARK_TONE,
  DEFAULT_LIGHT_TONE,
  DEFAULT_TITLE_FONT,
  deriveBrandColors,
  emptyBrandLook,
  hostBrandingSchema,
  isFontFamilyName,
  LIGHT_TONES,
  NAVY,
  NEUTRAL_BRAND,
  normalizeBrandLook,
  relativeLuminance,
  resolveBranding,
  toHostBranding,
  WHITE,
  withDarkPrimary,
} from '../src/branding';
import { hostTenantSchema } from '../src/hosts';

/**
 * TENANT-02 / D-25 / D-41: the derivation and contrast maths every brand consumer shares (API save
 * path, seed, panel preview, e-mail templates). Pure functions, no I/O.
 */

describe('contrastRatio — WCAG 2.x', () => {
  it('black on white is 21:1 and the ratio is symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2);
  });

  it('matches the WebAIM reference pair #777777 / #ffffff = 4.48:1', () => {
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('a color against itself is 1:1', () => {
    expect(contrastRatio('#7c3aed', '#7c3aed')).toBe(1);
  });

  it('relativeLuminance spans 0 (black) to 1 (white)', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
  });
});

describe('deriveBrandColors — the D-25 derivations', () => {
  it('a saturated primary gets white text; the dark variant is lighter than the primary', () => {
    const colors = deriveBrandColors({ primary: '#7c3aed', secondary: '#a78bfa' });
    expect(colors.onPrimary).toBe('#ffffff');
    expect(colors.primaryDark).toMatch(/^#[0-9a-f]{6}$/);
    expect(relativeLuminance(colors.primaryDark)).toBeGreaterThan(relativeLuminance('#7c3aed'));
    expect(colors.onPrimaryDark).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('a very light primary picks navy for the text', () => {
    expect(deriveBrandColors({ primary: '#f5f7fb', secondary: '#ffffff' }).onPrimary).toBe(NAVY);
  });

  it('canonicalises the two source colors to lower-case', () => {
    const colors = deriveBrandColors({ primary: '#7C3AED', secondary: '#A78BFA' });
    expect(colors.primary).toBe('#7c3aed');
    expect(colors.secondary).toBe('#a78bfa');
  });

  it('is deterministic — the persisted derivations can never disagree with a live computation', () => {
    const a = deriveBrandColors({ primary: '#0f766e', secondary: '#14b8a6' });
    const b = deriveBrandColors({ primary: '#0f766e', secondary: '#14b8a6' });
    expect(a).toEqual(b);
  });

  it('refuses anything that is not #rrggbb', () => {
    for (const bad of ['7c3aed', '#7c3ae', '#7c3aedff', 'rgb(1,2,3)', '#ggg000', '']) {
      expect(() => deriveBrandColors({ primary: bad, secondary: '#a78bfa' })).toThrow();
    }
  });
});

describe('contrastReport — the three panel warnings', () => {
  it('reports AA text and UI thresholds for the seed demo brand', () => {
    const report = contrastReport(deriveBrandColors({ primary: '#7c3aed', secondary: '#a78bfa' }));
    expect(report.onPrimary.ratio).toBeGreaterThanOrEqual(4.5);
    expect(report.onPrimary.ok).toBe(true);
    expect(report.lightSurface.ok).toBe(true);
    expect(report.darkSurface.ok).toBe(true);
  });

  it('flags a primary that vanishes against the light neutral surface', () => {
    const report = contrastReport(deriveBrandColors({ primary: '#f5f7fb', secondary: '#ffffff' }));
    expect(report.lightSurface.ratio).toBeCloseTo(1, 2);
    expect(report.lightSurface.ok).toBe(false);
  });
});

describe('resolveBranding — tenants.branding jsonb → complete brand', () => {
  it('{} resolves to the neutral fallback with no logo (edge TENANT-02/empty)', () => {
    const resolved = resolveBranding({});
    expect(resolved.logoUrl).toBeNull();
    expect(resolved.faviconUrl).toBeNull();
    expect(resolved.iconUrl).toBeNull();
    expect(resolved.iconUrls).toBeNull();
    expect(resolved.iconVersion).toBe(0);
    expect(resolved.colors).toEqual(deriveBrandColors(NEUTRAL_BRAND));
    expect(resolved.colors.primary).toBe('#2e6fd0');
  });

  it('null and undefined behave like {}', () => {
    expect(resolveBranding(null)).toEqual(resolveBranding({}));
    expect(resolveBranding(undefined)).toEqual(resolveBranding({}));
  });

  it('lower-cases the source colors and derives the three missing keys', () => {
    const resolved = resolveBranding({ colors: { primary: '#7C3AED', secondary: '#A78BFA' } });
    expect(resolved.colors).toEqual(
      deriveBrandColors({ primary: '#7c3aed', secondary: '#a78bfa' }),
    );
    expect(resolved.colors.primary).toBe('#7c3aed');
    expect(resolved.colors.onPrimary).toBe('#ffffff');
  });

  it('keeps persisted derivations when present instead of recomputing them', () => {
    const resolved = resolveBranding({
      colors: {
        primary: '#7c3aed',
        secondary: '#a78bfa',
        onPrimary: '#16233b',
        primaryDark: '#000001',
        onPrimaryDark: '#000002',
      },
    });
    expect(resolved.colors.onPrimary).toBe('#16233b');
    expect(resolved.colors.primaryDark).toBe('#000001');
    expect(resolved.colors.onPrimaryDark).toBe('#000002');
  });

  it('passes logo and icon facts through untouched', () => {
    const resolved = resolveBranding({
      logoUrl: '/seed-logos/rede-demo.svg',
      iconUrls: { i192: 'a', i512: 'b', maskable512: 'c', apple180: 'd' },
      iconVersion: 3,
    });
    expect(resolved.logoUrl).toBe('/seed-logos/rede-demo.svg');
    expect(resolved.iconUrls).toEqual({ i192: 'a', i512: 'b', maskable512: 'c', apple180: 'd' });
    expect(resolved.iconVersion).toBe(3);
  });

  it('is loud, not blue, on a malformed color: a corrupt row must never render the neutral brand', () => {
    expect(() =>
      resolveBranding({ colors: { primary: 'purple', secondary: '#a78bfa' } }),
    ).toThrow();
  });
});

describe('brandStyleVars — exactly the five --brand-* keys (T-02-03)', () => {
  it('emits the five known custom properties and nothing else', () => {
    const vars = brandStyleVars(resolveBranding({}));
    expect(Object.keys(vars).sort()).toEqual(
      [
        '--brand-on-primary',
        '--brand-on-primary-dark',
        '--brand-primary',
        '--brand-primary-dark',
        '--brand-secondary',
      ].sort(),
    );
    expect(vars['--brand-primary']).toBe('#2e6fd0');
    expect(vars['--brand-secondary']).toBe('#5b9cf8');
  });
});

describe('hostTenantSchema / hostBrandingSchema — strict public contract (T-02-04)', () => {
  const body = {
    slug: 'rede-demo',
    displayName: 'Rede Demo',
    status: 'active',
    isPrimary: true,
    primaryHost: 'rede-demo.localhost',
    branding: toHostBranding(
      resolveBranding({ colors: { primary: '#7c3aed', secondary: '#a78bfa' } }),
    ),
  };

  it('accepts the exact by-host body', () => {
    expect(hostTenantSchema.safeParse(body).success).toBe(true);
  });

  it('rejects any extra key at the top level or inside branding', () => {
    expect(hostTenantSchema.safeParse({ ...body, plan: 'pilot' }).success).toBe(false);
    expect(hostTenantSchema.safeParse({ ...body, tenantId: 'x' }).success).toBe(false);
    expect(hostBrandingSchema.safeParse({ ...body.branding, iconVersion: 0 }).success).toBe(false);
  });

  it('rejects an unknown status and a missing primaryHost', () => {
    expect(hostTenantSchema.safeParse({ ...body, status: 'deleted' }).success).toBe(false);
    const { primaryHost: _omitted, ...withoutPrimary } = body;
    expect(hostTenantSchema.safeParse(withoutPrimary).success).toBe(false);
  });

  it('toHostBranding drops the panel-only facts (iconUrl, iconVersion) and carries the look', () => {
    const resolved = resolveBranding({ iconUrl: '/x.png', iconVersion: 2 });
    const host = toHostBranding(resolved);
    expect(host).not.toHaveProperty('iconUrl');
    expect(host).not.toHaveProperty('iconVersion');
    expect(Object.keys(host).sort()).toEqual([
      'colors',
      'faviconUrl',
      'iconUrls',
      'logoUrl',
      'look',
    ]);
    expect(host.look).toEqual(emptyBrandLook());
  });

  it('carries a saved look through the strict answer; an answer without it reads the default look', () => {
    const resolved = resolveBranding({
      colors: { primary: '#7c3aed', secondary: '#a78bfa' },
      look: { lightTone: 'amarelado', buttonColors: { style: 'gradient' } },
    });
    const parsed = hostTenantSchema.parse({ ...body, branding: toHostBranding(resolved) });
    expect(parsed.branding.look?.lightTone).toBe('amarelado');
    expect(parsed.branding.look?.buttonColors.style).toBe('gradient');
    // An API older than the web sends no `look`: the strict answer still parses, and resolves to
    // the system's look.
    const { look: _look, ...older } = toHostBranding(resolved);
    const parsedOlder = hostBrandingSchema.parse(older);
    expect(parsedOlder.look).toBeUndefined();
    expect(resolveBranding(parsedOlder).look).toEqual(emptyBrandLook());
  });
});

/**
 * The look beyond the pair (2026-10-03): six settings the wizard used to preview only, persisted in
 * `tenants.branding.look`. `null` is always the system's own value, so an older brand renders as
 * before; the stored shape is tolerant of unknown keys (a newer API must not break an older web)
 * and loud on malformed values; the body of the look's route is strict at every level.
 */
describe('brand look — tones, buttons, dark colours, title font and font colours', () => {
  const ALL_NULL = {
    lightTone: null,
    darkTone: null,
    darkColors: { primary: null, secondary: null },
    titleFont: null,
    fontColors: { title: { light: null, dark: null }, appName: { light: null, dark: null } },
    buttonColors: {
      style: 'solid',
      fill: { light: null, dark: null },
      fillEnd: { light: null, dark: null },
      ink: { light: null, dark: null },
    },
  };

  it('the closed lists: eight tones per theme, the defaults first, two button styles', () => {
    expect([...LIGHT_TONES]).toEqual([
      'cinza',
      'amarelado',
      'laranjado',
      'avermelhado',
      'lilas',
      'azulado',
      'agua',
      'esverdeado',
    ]);
    expect([...DARK_TONES]).toEqual([
      'grafite',
      'cafe',
      'terracota',
      'vinho',
      'berinjela',
      'azul-noite',
      'petroleo',
      'musgo',
    ]);
    expect(LIGHT_TONES[0]).toBe(DEFAULT_LIGHT_TONE);
    expect(DARK_TONES[0]).toBe(DEFAULT_DARK_TONE);
    expect([...BUTTON_STYLES]).toEqual(['solid', 'gradient']);
  });

  it('a stored brand without a look (or with {}) reads the all-null look', () => {
    expect(emptyBrandLook()).toEqual(ALL_NULL);
    expect(brandLookSchema.parse({})).toEqual(ALL_NULL);
    expect(resolveBranding({}).look).toEqual(ALL_NULL);
    expect(resolveBranding({ look: {} }).look).toEqual(ALL_NULL);
  });

  it('fills the gaps of a partial look, lower-cases its hexes and drops unknown keys', () => {
    const look = brandLookSchema.parse({
      buttonColors: { fill: { light: '#E3AF3F' }, future: true },
      fontColors: { title: { dark: '#FFD27A' } },
      somethingNew: 'x',
    });
    expect(look.buttonColors.fill).toEqual({ light: '#e3af3f', dark: null });
    expect(look.buttonColors.style).toBe('solid');
    expect(look.fontColors.title).toEqual({ light: null, dark: '#ffd27a' });
    expect(look).not.toHaveProperty('somethingNew');
    expect(look.buttonColors).not.toHaveProperty('future');
  });

  it('is loud on a malformed value, like a malformed brand colour', () => {
    for (const bad of [
      { lightTone: 'rosa' },
      { darkTone: 'cinza' },
      { darkColors: { primary: 'red' } },
      { titleFont: 'Pop"pins' },
      { buttonColors: { style: 'outline' } },
      { fontColors: { appName: { light: '#fff' } } },
    ]) {
      expect(() => resolveBranding({ look: bad }), JSON.stringify(bad)).toThrow();
    }
  });

  it('normalizeBrandLook: the default tones and Manrope have ONE spelling, null', () => {
    const look = normalizeBrandLook(
      brandLookSchema.parse({
        lightTone: DEFAULT_LIGHT_TONE,
        darkTone: DEFAULT_DARK_TONE,
        titleFont: DEFAULT_TITLE_FONT,
      }),
    );
    expect(look.lightTone).toBeNull();
    expect(look.darkTone).toBeNull();
    expect(look.titleFont).toBeNull();
    const kept = normalizeBrandLook(
      brandLookSchema.parse({ lightTone: 'lilas', darkTone: 'musgo', titleFont: 'Poppins' }),
    );
    expect([kept.lightTone, kept.darkTone, kept.titleFont]).toEqual(['lilas', 'musgo', 'Poppins']);
    expect(resolveBranding({ look: { lightTone: 'cinza' } }).look.lightTone).toBeNull();
  });

  it('isFontFamilyName: letters, digits and single inner spaces, 60 at most', () => {
    for (const name of ['Poppins', 'Open Sans', 'M PLUS 1p', 'Source Sans 3', 'a'.repeat(60)]) {
      expect(isFontFamilyName(name), name).toBe(true);
    }
    for (const value of [
      '',
      ' Poppins',
      'Poppins ',
      'Open  Sans',
      'Pop"pins',
      "Pop'pins",
      'Poppins;color:red',
      'Poppins&text=x',
      'Poppins)',
      'Lóra',
      'a'.repeat(61),
      42,
      null,
    ]) {
      expect(isFontFamilyName(value), String(value)).toBe(false);
    }
  });
});

describe('withDarkPrimary — the dark accent follows the look', () => {
  const pair = deriveBrandColors({ primary: '#7c3aed', secondary: '#a78bfa' });

  it('no own dark primary: the derivation stands (the very same object)', () => {
    expect(withDarkPrimary(pair, null)).toBe(pair);
    expect(withDarkPrimary(pair, undefined)).toBe(pair);
  });

  it('an own dark primary replaces the accent and takes the ink that reads on it', () => {
    const pale = withDarkPrimary(pair, '#FFB4A8');
    expect(pale.primaryDark).toBe('#ffb4a8');
    expect(pale.onPrimaryDark).toBe(NAVY);
    expect(withDarkPrimary(pair, '#1a237e').onPrimaryDark).toBe(WHITE);
    // The light half is never touched.
    expect([pale.primary, pale.secondary, pale.onPrimary]).toEqual([
      pair.primary,
      pair.secondary,
      pair.onPrimary,
    ]);
  });

  it('resolveBranding: the look own dark primary wins over the persisted accent', () => {
    const resolved = resolveBranding({
      colors: { ...pair, primaryDark: '#000001', onPrimaryDark: '#000002' },
      look: { darkColors: { primary: '#ffb4a8' } },
    });
    expect(resolved.colors.primaryDark).toBe('#ffb4a8');
    expect(resolved.colors.onPrimaryDark).toBe(NAVY);
    expect(brandStyleVars(resolved)['--brand-primary-dark']).toBe('#ffb4a8');
    // A dark secondary of its own never enters the five colours (the CSS reads it apart).
    expect(
      resolveBranding({ colors: pair, look: { darkColors: { secondary: '#00ff00' } } }).colors,
    ).toEqual(pair);
  });
});

describe('brandingLookBodySchema — PUT …/branding/look, strict at every level', () => {
  it('{} is the whole system look (a PUT replaces the look)', () => {
    expect(brandingLookBodySchema.parse({})).toEqual(emptyBrandLook());
  });

  it('accepts a complete look and returns it canonical in case', () => {
    const parsed = brandingLookBodySchema.parse({
      lightTone: 'amarelado',
      darkTone: 'cafe',
      darkColors: { primary: '#FFB4A8', secondary: null },
      titleFont: 'Playfair Display',
      fontColors: { title: { light: '#7C2D12', dark: '#FFD27A' }, appName: { light: '#0F766E' } },
      buttonColors: {
        style: 'gradient',
        fill: { light: '#E3AF3F', dark: '#F0CB7A' },
        fillEnd: { light: '#FFD27A' },
        ink: { light: '#382317' },
      },
    });
    expect(parsed.darkColors.primary).toBe('#ffb4a8');
    expect(parsed.fontColors.appName).toEqual({ light: '#0f766e', dark: null });
    expect(parsed.buttonColors.fillEnd).toEqual({ light: '#ffd27a', dark: null });
    expect(parsed.titleFont).toBe('Playfair Display');
  });

  it('refuses an unknown key at the top level and inside every group', () => {
    for (const bad of [
      { brand: 'x' },
      { darkColors: { tone: 'cafe' } },
      { fontColors: { body: { light: null } } },
      { fontColors: { title: { sepia: '#000000' } } },
      { buttonColors: { hover: { light: '#000000' } } },
      { buttonColors: { fill: { light: '#000000', dim: '#111111' } } },
    ]) {
      expect(brandingLookBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses values outside the rules: free colours as tones, short hexes, unsafe names', () => {
    for (const bad of [
      { lightTone: '#f5efe5' },
      { lightTone: 'grafite' },
      { darkTone: 'amarelado' },
      { darkColors: { primary: '#fff' } },
      { titleFont: 'Poppins, serif' },
      { titleFont: 'Poppins&display=block' },
      { titleFont: 'a'.repeat(61) },
      { buttonColors: { style: 'outline' } },
      { buttonColors: { ink: { dark: 'rgb(0,0,0)' } } },
    ]) {
      expect(brandingLookBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
