// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { deriveBrandColors, NAVY, NEUTRAL_BRAND, WHITE } from '@rede-social/contracts/branding';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BrandPreview,
  type BrandPreviewLabels,
  buttonGradientHover,
  buttonHover,
  buttonThemeVars,
} from '../ui';

afterEach(() => {
  cleanup();
});

const labels: BrandPreviewLabels = {
  light: 'Claro',
  dark: 'Escuro',
  lightAria: 'Prévia do aplicativo no modo claro',
  darkAria: 'Prévia do aplicativo no modo escuro',
  login: 'Entrar',
};
const colors = { primary: '#7c3aed', secondary: '#a78bfa' };

/** `--brand-primary: #7c3aed` or `--brand-primary:#7c3aed` (serialisation of custom properties varies). */
const varRe = (name: string, value: string) => new RegExp(`${name}:\\s*${value}`);

describe('BrandPreview (UI-SPEC E12, D-25/D-26/D-41)', () => {
  it('renders exactly two [data-brand-scope] frames, light then dark, with the brand vars inline', () => {
    const { container } = render(
      <BrandPreview
        colors={colors}
        displayName="Associação São José"
        logoUrl={null}
        labels={labels}
      />,
    );
    const frames = container.querySelectorAll('[data-brand-scope]');
    expect(frames).toHaveLength(2);
    expect(frames[0]?.getAttribute('data-theme')).toBe('light');
    expect(frames[1]?.getAttribute('data-theme')).toBe('dark');
    for (const frame of frames) {
      const style = frame.getAttribute('style') ?? '';
      expect(style).toMatch(varRe('--brand-primary', '#7c3aed'));
      const dark = style.match(/--brand-primary-dark:\s*(#[0-9a-f]{6})/)?.[1];
      expect(dark).toBeTruthy();
      expect(dark).not.toBe('#7c3aed');
      expect(frame.getAttribute('role')).toBe('img');
    }
    expect(frames[0]?.getAttribute('aria-label')).toBe(labels.lightAria);
    expect(frames[1]?.getAttribute('aria-label')).toBe(labels.darkAria);
  });

  it('E12/empty: without a logo the display name renders as text in both frames and there is no <img>', () => {
    const { container } = render(
      <BrandPreview
        colors={colors}
        displayName="Associação São José"
        logoUrl={null}
        labels={labels}
      />,
    );
    // TopBar name + body name per frame → 4 occurrences; at least twice is the contract.
    expect(screen.getAllByText('Associação São José').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('never shows the Rede Social mark nor the neutral fallback hex when colours are given', () => {
    const { container } = render(
      <BrandPreview
        colors={colors}
        displayName="Associação São José"
        logoUrl={null}
        labels={labels}
      />,
    );
    expect(screen.queryByText('Rede Social', { exact: true })).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(NEUTRAL_BRAND.primary);
  });

  it('E12/populated: with a logo it renders exactly two <img src=logo> (one per frame)', () => {
    const { container } = render(
      <BrandPreview
        colors={colors}
        displayName="Associação São José"
        logoUrl="https://x.test/logo.svg"
        labels={labels}
      />,
    );
    const imgs = Array.from(container.querySelectorAll('[data-brand-scope] img'));
    // TopBar + body per frame: four images, every one pointing at the given URL and nothing else.
    expect(imgs).toHaveLength(4);
    expect(imgs.every((img) => img.getAttribute('src') === 'https://x.test/logo.svg')).toBe(true);
    // Each frame carries the logo in its TopBar (alt = displayName) — exactly two of those.
    expect(container.querySelectorAll('img[alt="Associação São José"]')).toHaveLength(2);
    expect(container.querySelectorAll('img')).toHaveLength(4);
  });

  it('renders children once below the grid and the login CTA as a brand Button in each frame', () => {
    const { container } = render(
      <BrandPreview colors={colors} displayName="X" logoUrl={null} labels={labels}>
        <p>readout</p>
      </BrandPreview>,
    );
    expect(screen.getAllByText('readout')).toHaveLength(1);
    expect(container.querySelectorAll('[data-brand-scope] button')).toHaveLength(2);
    expect(screen.getAllByText('Entrar')).toHaveLength(2);
  });
});

/**
 * The tenant wizard's preview-only look (2026-10-02): each frame may show its theme's own ground
 * tone (an id tokens.css re-tints the frame by) and the dark frame the dark mode's own primary and
 * secondary. The claims: without the props nothing changes; each tone marks its own frame only;
 * the dark colours reach the dark frame only, the accent with the ink `deriveBrandColors` picks for
 * it; what is not tone-shaped or not a valid hex is left out; still exactly two brand scopes.
 */
describe('BrandPreview — the preview-only ground tones and dark colours', () => {
  const frames = (container: HTMLElement) => {
    const [light, dark] = Array.from(container.querySelectorAll('[data-brand-scope]'));
    return { light, dark, count: container.querySelectorAll('[data-brand-scope]').length };
  };
  const base = { colors, displayName: 'X', logoUrl: null, labels };

  it('renders exactly as before without them', () => {
    const plain = render(<BrandPreview {...base} />).container.innerHTML;
    cleanup();
    const empty = render(<BrandPreview {...base} lightTone={null} dark={null} />).container;
    expect(empty.innerHTML).toBe(plain);
    cleanup();
    const nulls = render(
      <BrandPreview {...base} dark={{ primary: null, secondary: null, tone: null }} />,
    ).container;
    expect(nulls.innerHTML).toBe(plain);
    cleanup();
    // The button colours (2026-10-03): absent, `null` or empty per theme, nothing changes either.
    for (const buttons of [
      null,
      { light: null, dark: null },
      { light: {}, dark: { fill: null, ink: null } },
    ]) {
      expect(render(<BrandPreview {...base} buttons={buttons} />).container.innerHTML).toBe(plain);
      cleanup();
    }
    expect(plain).not.toMatch(/data-bg-tone|data-dark-tone/);
    // No raw button key in any style (the button's classes name the resolved tokens, as always).
    expect(plain).not.toMatch(/style="[^"]*--button-/);
  });

  it('marks each frame with its own theme’s tone only', () => {
    const { container } = render(
      <BrandPreview {...base} lightTone="amarelado" dark={{ tone: 'azul-noite' }} />,
    );
    const { light, dark, count } = frames(container);
    expect(count).toBe(2);
    expect(light?.getAttribute('data-bg-tone')).toBe('amarelado');
    expect(light?.hasAttribute('data-dark-tone')).toBe(false);
    expect(dark?.getAttribute('data-dark-tone')).toBe('azul-noite');
    expect(dark?.hasAttribute('data-bg-tone')).toBe(false);
  });

  it('gives the dark frame alone the dark primary (with its ink) and the dark secondary', () => {
    const derived = deriveBrandColors(colors);
    const { container } = render(
      <BrandPreview {...base} dark={{ primary: '#F5D76E', secondary: '#123456' }} />,
    );
    const { light, dark } = frames(container);
    const darkStyle = dark?.getAttribute('style') ?? '';
    expect(darkStyle).toMatch(varRe('--brand-primary-dark', '#f5d76e'));
    expect(darkStyle).toMatch(varRe('--brand-on-primary-dark', NAVY));
    expect(darkStyle).toMatch(varRe('--brand-secondary', '#123456'));
    // Both primaries of the dark frame: the hover shade and the gradient read `--brand-primary`,
    // so a light primary left there would show its hue on the dark frame's button.
    expect(darkStyle).toMatch(varRe('--brand-primary', '#f5d76e'));
    expect(darkStyle).toMatch(varRe('--brand-on-primary', NAVY));
    expect(darkStyle).not.toContain('#7c3aed');

    const lightStyle = light?.getAttribute('style') ?? '';
    expect(lightStyle).toMatch(varRe('--brand-primary', '#7c3aed'));
    expect(lightStyle).toMatch(varRe('--brand-on-primary', derived.onPrimary));
    expect(lightStyle).toMatch(varRe('--brand-primary-dark', derived.primaryDark));
    expect(lightStyle).toMatch(varRe('--brand-on-primary-dark', derived.onPrimaryDark));
    expect(lightStyle).toMatch(varRe('--brand-secondary', '#a78bfa'));

    cleanup();
    const deep = frames(
      render(<BrandPreview {...base} dark={{ primary: '#1a237e' }} />).container,
    ).dark?.getAttribute('style');
    expect(deep).toMatch(varRe('--brand-on-primary-dark', WHITE));
    expect(deep).toMatch(varRe('--brand-on-primary', WHITE));
  });

  it('leaves out an id that is not tone-shaped and a colour the brand schema refuses', () => {
    const plain = render(<BrandPreview {...base} />).container.innerHTML;
    cleanup();
    const { container } = render(
      <BrandPreview
        {...base}
        lightTone={'amarelado" onclick="x'}
        dark={{ primary: '#12', secondary: 'red', tone: 'Azul Noite' }}
      />,
    );
    expect(container.innerHTML).toBe(plain);
  });
});

/**
 * The filled buttons' own colours (2026-10-03), already resolved by the caller: each frame carries
 * its OWN theme's raw keys inline (`buttonThemeVars`), which tokens.css reads into `bg-button` on
 * that frame. The claims: the light keys reach the light frame only and the dark ones the dark
 * frame only; the brand variables and the frames' count stay as they were (two brand scopes, two
 * buttons, the keys on the frame and never on the button); a fill without its ink gets the white
 * or navy that reads on it; an ink alone comes alone; a refused colour leaves the output identical.
 * A gradient (the second round of 2026-10-03) reaches its own frame whole, its image and hovered
 * image beside its first colour, and nothing else moves.
 */
describe('BrandPreview — the preview-only button colours', () => {
  const base = { colors, displayName: 'X', logoUrl: null, labels };
  const GOLD = '#e3af3f';
  const CHOCOLATE = '#382317';

  /** A frame's inline declarations, name to value (the serialisation's spacing aside). */
  const declarations = (frame: Element | undefined) => {
    const out: Record<string, string> = {};
    for (const part of (frame?.getAttribute('style') ?? '').split(';')) {
      const at = part.indexOf(':');
      if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
    return out;
  };
  /** The declarations that are not the buttons' raw keys. */
  const withoutButtons = (all: Record<string, string>) =>
    Object.fromEntries(Object.entries(all).filter(([name]) => !name.startsWith('--button-')));
  const buttonKeys = (all: Record<string, string>) =>
    Object.fromEntries(Object.entries(all).filter(([name]) => name.startsWith('--button-')));
  const framesOf = (container: HTMLElement) => {
    const [light, dark] = Array.from(container.querySelectorAll('[data-brand-scope]'));
    return { light, dark };
  };

  it('gives each frame its own theme’s keys, and nothing else moves', () => {
    const plain = framesOf(render(<BrandPreview {...base} />).container);
    const plainLight = declarations(plain.light);
    const plainDark = declarations(plain.dark);
    cleanup();

    const buttons = {
      light: { fill: '#E3AF3F', ink: '#382317' },
      dark: { fill: '#1a237e', ink: WHITE },
    };
    const { container } = render(<BrandPreview {...base} buttons={buttons} />);
    const { light, dark } = framesOf(container);
    const lightStyle = declarations(light);
    const darkStyle = declarations(dark);
    expect(buttonKeys(lightStyle)).toEqual({
      '--button-fill-light': GOLD,
      '--button-ink-light': CHOCOLATE,
      '--button-hover-light': `color-mix(in oklch, ${GOLD}, white 12%)`,
    });
    expect(buttonKeys(darkStyle)).toEqual({
      '--button-fill-dark': '#1a237e',
      '--button-ink-dark': WHITE,
      '--button-hover-dark': buttonHover('#1a237e', WHITE),
    });
    expect(buttonKeys(lightStyle)).toEqual(buttonThemeVars('light', buttons.light));
    expect(buttonKeys(darkStyle)).toEqual(buttonThemeVars('dark', buttons.dark));
    // The brand variables are untouched, frame by frame.
    expect(withoutButtons(lightStyle)).toEqual(plainLight);
    expect(withoutButtons(darkStyle)).toEqual(plainDark);
    // Still two brand scopes and two buttons; the keys sit on the frame, never on the button.
    expect(container.querySelectorAll('[data-brand-scope]')).toHaveLength(2);
    const ctas = container.querySelectorAll('[data-brand-scope] button');
    expect(ctas).toHaveLength(2);
    for (const cta of ctas) expect(cta.hasAttribute('style')).toBe(false);
  });

  it('completes a fill without its ink: white on a deep button, navy on a light one', () => {
    const { container } = render(
      <BrandPreview {...base} buttons={{ light: { fill: '#1a237e' }, dark: { fill: GOLD } }} />,
    );
    const { light, dark } = framesOf(container);
    expect(declarations(light)['--button-ink-light']).toBe(WHITE);
    expect(declarations(dark)['--button-ink-dark']).toBe(NAVY);
    expect(declarations(dark)['--button-hover-dark']).toBe(buttonHover(GOLD, NAVY));
  });

  it('sends an ink alone to its own frame, alone', () => {
    const plain = render(<BrandPreview {...base} />).container;
    const plainLight = framesOf(plain).light?.getAttribute('style');
    cleanup();
    const { container } = render(<BrandPreview {...base} buttons={{ dark: { ink: '#F2F5FA' } }} />);
    const { light, dark } = framesOf(container);
    expect(buttonKeys(declarations(dark))).toEqual({ '--button-ink-dark': '#f2f5fa' });
    expect(light?.getAttribute('style')).toBe(plainLight);
  });

  it('keeps the dark mode’s own colours beside the dark buttons', () => {
    const { container } = render(
      <BrandPreview
        {...base}
        dark={{ primary: '#F5D76E' }}
        buttons={{ dark: { fill: GOLD, ink: CHOCOLATE } }}
      />,
    );
    const dark = declarations(framesOf(container).dark);
    expect(dark['--brand-primary-dark']).toBe('#f5d76e');
    expect(dark['--button-fill-dark']).toBe(GOLD);
    expect(dark['--button-ink-dark']).toBe(CHOCOLATE);
  });

  it('gives each frame its own theme’s gradient, the image and the hovered image included', () => {
    const plain = framesOf(render(<BrandPreview {...base} />).container);
    const plainLight = declarations(plain.light);
    const plainDark = declarations(plain.dark);
    cleanup();

    const buttons = {
      light: { style: 'gradient', fill: '#E3AF3F', fillEnd: '#FFD27A', ink: CHOCOLATE },
      dark: { style: 'gradient', fill: '#1a237e', fillEnd: GOLD, ink: WHITE },
    } as const;
    const { container } = render(<BrandPreview {...base} buttons={buttons} />);
    const { light, dark } = framesOf(container);
    const lightStyle = declarations(light);
    const darkStyle = declarations(dark);
    expect(buttonKeys(lightStyle)).toEqual({
      '--button-fill-light': GOLD,
      '--button-ink-light': CHOCOLATE,
      '--button-hover-light': buttonHover(GOLD, CHOCOLATE),
      '--button-image-light': `linear-gradient(135deg, ${GOLD}, #ffd27a)`,
      '--button-image-hover-light': buttonGradientHover(GOLD, '#ffd27a', CHOCOLATE),
    });
    expect(buttonKeys(darkStyle)).toEqual(buttonThemeVars('dark', buttons.dark));
    expect(darkStyle['--button-image-dark']).toBe(`linear-gradient(135deg, #1a237e, ${GOLD})`);
    // Each frame its own theme's keys only, the brand variables untouched.
    const names = (style: Record<string, string>) => Object.keys(buttonKeys(style));
    expect(names(lightStyle).every((name) => name.endsWith('-light'))).toBe(true);
    expect(names(darkStyle).every((name) => name.endsWith('-dark'))).toBe(true);
    expect(withoutButtons(lightStyle)).toEqual(plainLight);
    expect(withoutButtons(darkStyle)).toEqual(plainDark);
    // Still two brand scopes and two buttons, the keys on the frames.
    expect(container.querySelectorAll('[data-brand-scope]')).toHaveLength(2);
    const ctas = container.querySelectorAll('[data-brand-scope] button');
    expect(ctas).toHaveLength(2);
    for (const cta of ctas) expect(cta.hasAttribute('style')).toBe(false);
  });

  it('chooses a gradient’s missing ink for both of its colours', () => {
    const { container } = render(
      <BrandPreview
        {...base}
        buttons={{ light: { style: 'gradient', fill: GOLD, fillEnd: '#1a237e' } }}
      />,
    );
    // Navy would read on the gold alone; on the gold-to-deep gradient white reads better.
    expect(declarations(framesOf(container).light)['--button-ink-light']).toBe(WHITE);
  });

  it('leaves out a colour the brand schema refuses, output identical', () => {
    const plain = render(<BrandPreview {...base} />).container.innerHTML;
    cleanup();
    const { container } = render(
      <BrandPreview
        {...base}
        buttons={{
          light: { fill: '#12', ink: 'red' },
          dark: { fill: 'var(--brand-primary)', ink: '#aabbcc;color:red' },
        }}
      />,
    );
    expect(container.innerHTML).toBe(plain);
  });
});
