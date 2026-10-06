import { BRAND_STYLE_VARS, NAVY, resolveBranding } from '@rede-social/contracts/branding';
import { describe, expect, it } from 'vitest';
import { brandScope } from './brand-scope';
import { titleFontStack } from './title-font-rules';

/**
 * The app's brand scope (2026-10-03): what the authenticated shell's root and the logged-out pages'
 * `<main>` carry for a resolved brand. The claims a later edit could quietly break:
 *
 *  1. A brand without a look (every tenant saved before it, the neutral brand of the platform and
 *     generic hosts) carries the five `--brand-*` keys and NOTHING else: no attribute, no font.
 *  2. A saved look adds its custom properties after the five keys, its markers, and the one
 *     stylesheet of a catalogue family; the dark accent is the look's own dark primary.
 *  3. A family the catalogue does not know keeps Manrope: no marker, no stylesheet.
 */
describe('brandScope', () => {
  it('is exactly the five brand keys for a brand without a look', () => {
    for (const raw of [{}, { colors: { primary: '#7c3aed', secondary: '#a78bfa' } }]) {
      const scope = brandScope(resolveBranding(raw));
      expect(Object.keys(scope.style).sort()).toEqual([...BRAND_STYLE_VARS].sort());
      expect(scope.attributes).toEqual({});
      expect(scope.titleFontHref).toBeNull();
    }
  });

  it('adds the saved look: its markers, its keys and the family’s stylesheet', () => {
    const scope = brandScope(
      resolveBranding({
        colors: { primary: '#7c3aed', secondary: '#a78bfa' },
        look: {
          lightTone: 'amarelado',
          darkColors: { primary: '#ffb4a8' },
          titleFont: 'Poppins',
          buttonColors: { fill: { light: '#e3af3f' } },
        },
      }),
    );
    expect(scope.attributes).toEqual({
      'data-bg-tone': 'amarelado',
      'data-dark-primary': '',
      'data-title-font': '',
    });
    expect(scope.style['--brand-primary']).toBe('#7c3aed');
    expect(scope.style['--brand-primary-dark']).toBe('#ffb4a8');
    expect(scope.style['--brand-on-primary-dark']).toBe(NAVY);
    expect(scope.style['--brand-title-font']).toBe(titleFontStack('Poppins'));
    expect(scope.style['--button-fill-light']).toBe('#e3af3f');
    expect(scope.titleFontHref).toBe(
      'https://fonts.googleapis.com/css2?family=Poppins:wght@700&display=swap',
    );
  });

  it('keeps Manrope for a family the catalogue does not know', () => {
    const scope = brandScope(resolveBranding({ look: { titleFont: 'Nao Existe Esta Fonte' } }));
    expect(scope.attributes).not.toHaveProperty('data-title-font');
    expect(scope.style).not.toHaveProperty('--brand-title-font');
    expect(scope.titleFontHref).toBeNull();
  });
});
