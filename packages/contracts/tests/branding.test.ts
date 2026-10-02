import { describe, expect, it } from 'vitest';
import {
  adminBrandingSchema,
  brandStyleVars,
  contrastRatio,
  contrastReport,
  deriveBrandColors,
  hostBrandingSchema,
  NAVY,
  NEUTRAL_BRAND,
  relativeLuminance,
  resolveBranding,
  toHostBranding,
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

  it('toHostBranding drops the panel-only facts (iconUrl, iconVersion)', () => {
    const resolved = resolveBranding({ iconUrl: '/x.png', iconVersion: 2 });
    const host = toHostBranding(resolved);
    expect(host).not.toHaveProperty('iconUrl');
    expect(host).not.toHaveProperty('iconVersion');
    expect(Object.keys(host).sort()).toEqual(['colors', 'faviconUrl', 'iconUrls', 'logoUrl']);
  });
});

describe('adminBrandingSchema (08-06, ADMIN-01, D-342)', () => {
  const report = contrastReport(deriveBrandColors({ primary: '#7c3aed', secondary: '#a78bfa' }));
  const body = {
    tenant: {
      displayName: 'Rede Demo',
      branding: { colors: { primary: '#7c3aed', secondary: '#a78bfa' }, iconVersion: 1 },
      contrast: report,
    },
  };

  it('accepts the three brand facts and fills the stored jsonb defaults', () => {
    const parsed = adminBrandingSchema.parse(body);
    expect(parsed.tenant.displayName).toBe('Rede Demo');
    expect(parsed.tenant.branding.logoUrl).toBeNull();
    expect(parsed.tenant.branding.iconVersion).toBe(1);
    expect(parsed.tenant.contrast).toEqual(report);
  });

  it('refuses any platform-only fact: no id, slug, status, domains or admins on the tenant lane', () => {
    for (const extra of [
      { id: '6f2c5b1e-4d3a-4c2b-9e8f-1a2b3c4d5e6f' },
      { slug: 'rede-demo' },
      { status: 'active' },
    ]) {
      expect(adminBrandingSchema.safeParse({ tenant: { ...body.tenant, ...extra } }).success).toBe(
        false,
      );
    }
    expect(adminBrandingSchema.safeParse({ ...body, domains: [] }).success).toBe(false);
    expect(adminBrandingSchema.safeParse({ ...body, admins: [] }).success).toBe(false);
  });
});
