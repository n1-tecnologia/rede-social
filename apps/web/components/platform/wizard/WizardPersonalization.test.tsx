// @vitest-environment happy-dom
import {
  contrastRatio,
  deriveBrandColors,
  LIGHT_BG,
  NEUTRAL_BRAND,
} from '@rede-social/contracts/branding';
import { buttonInk, buttonRampEnd } from '@rede-social/core/ui';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ButtonColors, DarkColors, FontColors } from '@/lib/bg-tone';
import { formatContrastRatio } from '@/lib/contrast-ratio';
import type { TenantDraft } from './TenantDraftProvider';

/**
 * Personalização's Cores card and the preview-only look (the fixes of 2026-10-02's review).
 *
 * The catalog is the REAL pt-BR one through next-intl's own translator (a missing key throws); the
 * draft is a stand-in for `TenantDraftProvider`; the cards that are tested on their own (the dark
 * card, the buttons, the font, the logo) are stubbed; the kernel mini-shells are the real
 * `BrandPreview`. happy-dom has no stylesheet, so `useThemeSurfaces` keeps the gray (the contracts'
 * LIGHT_BG).
 *
 * Claims:
 *  1. Below `xl` the mini-shells are the only preview, so they carry the light tone (light frame),
 *     the dark mode's last valid colours and tone (dark frame) and each theme's buttons (the dark
 *     frame inheriting the light button); with none, nothing changes.
 *  2. A chosen light tone gets its own line: the primary against THAT ground (front only).
 *  3. While a preview-only colour that the saved readout cannot see is set (a light tone, a dark
 *     primary, a dark tone, a button colour or the gradient, automatic or not), a line says the
 *     pills above measure the saved colours.
 *  4. A gradient reaches each frame whole: its image beside its first colour, the automatic one
 *     from the primary (light) and from the dark mode's own primary (dark), each ending on its
 *     ramp (`buttonRampEnd`), never on a secondary.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return {
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    value: null as unknown,
    setTheme: vi.fn(),
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    useTranslations: (namespace?: string) => {
      const key = namespace ?? '';
      let tr = byNamespace.get(key);
      if (!tr) {
        tr = actual.createTranslator({
          locale: 'pt-BR',
          messages: harness.messages,
          namespace,
          onError: (error) => {
            throw error;
          },
        });
        byNamespace.set(key, tr);
      }
      return tr;
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement('a', { href, ...rest }, children),
  };
});

vi.mock('./TenantDraftProvider', () => ({ useTenantDraft: () => harness.value }));
vi.mock('./brand-look-context', () => ({ useBrandLook: () => harness.value }));
vi.mock('../preview/TenantPreviewProvider', () => ({
  useTenantPreview: () => ({ setTheme: harness.setTheme, theme: 'light' }),
}));
vi.mock('./DarkColorsCard', () => ({ DarkColorsCard: () => null }));
vi.mock('./ButtonColorsCard', () => ({ ButtonColorsCard: () => null }));
vi.mock('./TitleFontPicker', () => ({ TitleFontPicker: () => null }));
vi.mock('./WizardBrandPicker', () => ({ WizardBrandPicker: () => null }));

const { WizardPersonalization } = await import('./WizardPersonalization');

type WizardCopy = { brand: { contrastSaved: string; background: { primaryContrast: string } } };
const W = (harness.messages.platform as unknown as { wizard: WizardCopy }).wizard;

/** The button colours with only what is given set, solid unless said otherwise. */
function buttonColors(
  fill: Partial<ButtonColors['fill']> = {},
  ink: Partial<ButtonColors['ink']> = {},
  fillEnd: Partial<ButtonColors['fillEnd']> = {},
  style: ButtonColors['style'] = 'solid',
): ButtonColors {
  return {
    style,
    fill: { light: null, dark: null, ...fill },
    fillEnd: { light: null, dark: null, ...fillEnd },
    ink: { light: null, dark: null, ...ink },
  };
}

const BASE: TenantDraft = {
  displayName: 'Clube Aurora',
  slug: 'clube-aurora',
  slugTouched: false,
  primary: NEUTRAL_BRAND.primary,
  secondary: NEUTRAL_BRAND.secondary,
  modules: {},
  adminEmail: 'admin@clube.test',
  contrastConfirmed: false,
  titleFont: null,
  lightTone: null,
  darkColors: { primary: null, secondary: null, tone: null },
  fontColors: { title: { light: null, dark: null }, appName: { light: null, dark: null } },
  buttonColors: buttonColors(),
  host: '',
  hostReady: true,
  dataReady: true,
  fieldErrors: {},
  pendingSlug: null,
  createdId: null,
};

function stage(initial: Partial<TenantDraft> = {}) {
  const draft = { ...BASE, ...initial };
  const previewColors: {
    darkColors: DarkColors;
    fontColors: FontColors;
    buttonColors: ButtonColors;
  } = {
    darkColors: draft.darkColors,
    fontColors: draft.fontColors,
    buttonColors: draft.buttonColors,
  };
  harness.value = {
    draft,
    colors: { primary: draft.primary, secondary: draft.secondary },
    previewColors,
    moduleKeys: [],
    logo: null,
    restored: true,
    update: vi.fn(),
  };
  render(<WizardPersonalization />);
}

function frames() {
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-brand-scope]'));
  return {
    count: all.length,
    light: all.find((frame) => frame.getAttribute('data-theme') === 'light'),
    dark: all.find((frame) => frame.getAttribute('data-theme') === 'dark'),
  };
}

const styleHas = (frame: HTMLElement | undefined, name: string, value: string) =>
  new RegExp(`${name}:\\s*${value}(;|$)`, 'i').test(frame?.getAttribute('style') ?? '');

/** The value of `--name` in an inline style (a gradient holds parentheses no regex should see). */
const declared = (frame: HTMLElement | undefined, name: string) => {
  for (const part of (frame?.getAttribute('style') ?? '').split(';')) {
    const at = part.indexOf(':');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
};

afterEach(cleanup);

describe('the Cores card and the preview-only look', () => {
  it('without one: plain mini-shells, no tone line, no note', () => {
    stage();
    const { count, light, dark } = frames();
    expect(count).toBe(2);
    expect(light?.hasAttribute('data-bg-tone')).toBe(false);
    expect(dark?.hasAttribute('data-dark-tone')).toBe(false);
    expect(document.querySelector('[data-tone-contrast]')).toBeNull();
    expect(document.querySelector('[data-contrast-saved]')).toBeNull();
    expect(light?.getAttribute('style')).not.toContain('--button-');
    expect(dark?.getAttribute('style')).not.toContain('--button-');
  });

  it('the mini-shells carry the light tone and the dark colours and tone', () => {
    stage({
      lightTone: 'amarelado',
      darkColors: { primary: '#ffb4a8', secondary: '#ffd27a', tone: 'cafe' },
    });
    const { count, light, dark } = frames();
    expect(count).toBe(2);
    expect(light?.getAttribute('data-bg-tone')).toBe('amarelado');
    expect(styleHas(light, '--brand-primary', NEUTRAL_BRAND.primary)).toBe(true);
    expect(dark?.getAttribute('data-dark-tone')).toBe('cafe');
    expect(styleHas(dark, '--brand-primary-dark', '#ffb4a8')).toBe(true);
    expect(styleHas(dark, '--brand-primary', '#ffb4a8')).toBe(true);
    expect(styleHas(dark, '--brand-secondary', '#ffd27a')).toBe(true);
  });

  it('a light tone gets the primary measured on its own ground, and the note', () => {
    stage({ lightTone: 'azulado' });
    const line = document.querySelector('[data-tone-contrast]') as HTMLElement;
    expect(line.textContent).toContain(W.brand.background.primaryContrast);
    const value = contrastRatio(NEUTRAL_BRAND.primary, LIGHT_BG);
    expect(line.textContent).toContain(
      value >= 3
        ? `AA ${formatContrastRatio(value, true)}:1`
        : `Baixo ${formatContrastRatio(value, false)}:1`,
    );
    expect(document.querySelector('[data-contrast-saved]')?.textContent).toBe(
      W.brand.contrastSaved,
    );
  });

  it('a dark primary or a dark tone alone brings the note, not the light line', () => {
    stage({ darkColors: { primary: '#ffb4a8', secondary: null, tone: null } });
    expect(document.querySelector('[data-contrast-saved]')).not.toBeNull();
    expect(document.querySelector('[data-tone-contrast]')).toBeNull();
    cleanup();
    stage({ darkColors: { primary: null, secondary: null, tone: 'musgo' } });
    expect(document.querySelector('[data-contrast-saved]')).not.toBeNull();
    cleanup();
    // A dark secondary changes no contrast the pills report: no note.
    stage({ darkColors: { primary: null, secondary: '#ffd27a', tone: null } });
    expect(document.querySelector('[data-contrast-saved]')).toBeNull();
  });

  it('the mini-shells carry each theme’s buttons, the dark frame inheriting the light one', () => {
    stage({ buttonColors: buttonColors({ light: '#0f766e' }) });
    const { count, light, dark } = frames();
    expect(count).toBe(2);
    const ink = deriveBrandColors({ primary: '#0f766e', secondary: NEUTRAL_BRAND.secondary });
    expect(styleHas(light, '--button-fill-light', '#0f766e')).toBe(true);
    expect(styleHas(light, '--button-ink-light', ink.onPrimary)).toBe(true);
    expect(styleHas(dark, '--button-fill-dark', '#0f766e')).toBe(true);
    expect(styleHas(dark, '--button-ink-dark', ink.onPrimary)).toBe(true);
    // Each frame its own theme's keys only, and the primary untouched.
    expect(light?.getAttribute('style')).not.toMatch(/--button-[a-z]+-dark/);
    expect(dark?.getAttribute('style')).not.toMatch(/--button-[a-z]+-light/);
    expect(styleHas(light, '--brand-primary', NEUTRAL_BRAND.primary)).toBe(true);
  });

  it('a dark button of its own reaches the dark frame alone', () => {
    stage({ buttonColors: buttonColors({ dark: '#ffd27a' }, { dark: '#382317' }) });
    const { light, dark } = frames();
    expect(styleHas(dark, '--button-fill-dark', '#ffd27a')).toBe(true);
    expect(styleHas(dark, '--button-ink-dark', '#382317')).toBe(true);
    expect(light?.getAttribute('style')).not.toContain('--button-');
  });

  it('a button colour, even a text alone, brings the note, not the light line', () => {
    stage({ buttonColors: buttonColors({}, { light: '#382317' }) });
    expect(document.querySelector('[data-contrast-saved]')?.textContent).toBe(
      W.brand.contrastSaved,
    );
    expect(document.querySelector('[data-tone-contrast]')).toBeNull();
    cleanup();
    stage({ buttonColors: buttonColors({ dark: '#ffd27a' }) });
    expect(document.querySelector('[data-contrast-saved]')).not.toBeNull();
    cleanup();
    // A colour that is not a hex counts as unset: no note.
    stage({ buttonColors: buttonColors({ light: '#ffd' }, { dark: 'gold' }) });
    expect(document.querySelector('[data-contrast-saved]')).toBeNull();
  });

  it('the mini-shells carry each theme’s gradient, its image beside its first colour', () => {
    stage({
      buttonColors: buttonColors(
        { light: '#e3af3f' },
        { light: '#382317' },
        { light: '#ffd27a' },
        'gradient',
      ),
    });
    const { count, light, dark } = frames();
    expect(count).toBe(2);
    expect(declared(light, '--button-fill-light')).toBe('#e3af3f');
    expect(declared(light, '--button-image-light')).toBe(
      'linear-gradient(135deg, #e3af3f, #ffd27a)',
    );
    // The dark mode takes both light colours, so the same gradient with the same text.
    expect(declared(dark, '--button-image-dark')).toBe('linear-gradient(135deg, #e3af3f, #ffd27a)');
    expect(declared(dark, '--button-ink-dark')).toBe('#382317');
    expect(light?.getAttribute('style')).not.toMatch(/--button-[a-z-]+-dark/);
    expect(dark?.getAttribute('style')).not.toMatch(/--button-[a-z-]+-light/);
  });

  it('the gradient, even automatic, brings the note; its dark frame follows the dark primary', () => {
    /** The automatic last colour: `fill` moved away from the text that reads on it. */
    const ramp = (fill: string) => buttonRampEnd(fill, buttonInk(fill));
    stage({ buttonColors: buttonColors({}, {}, {}, 'gradient') });
    expect(document.querySelector('[data-contrast-saved]')).not.toBeNull();
    const primary = NEUTRAL_BRAND.primary;
    expect(declared(frames().light, '--button-image-light')).toBe(
      `linear-gradient(135deg, ${primary}, ${ramp(primary)})`,
    );
    cleanup();
    stage({
      darkColors: { primary: '#ffb4a8', secondary: '#a7f3d0', tone: null },
      buttonColors: buttonColors({}, {}, {}, 'gradient'),
    });
    // The dark mode's own primary to its own ramp: its secondary plays no part in the button.
    expect(declared(frames().dark, '--button-image-dark')).toBe(
      `linear-gradient(135deg, #ffb4a8, ${ramp('#ffb4a8')})`,
    );
  });
});
