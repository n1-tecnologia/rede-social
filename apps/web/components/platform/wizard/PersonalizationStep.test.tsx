// @vitest-environment happy-dom
import { NEUTRAL_BRAND } from '@rede-social/contracts/branding';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode, useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DARK_TONE, DEFAULT_LIGHT_TONE } from '@/lib/bg-tone';
import type { TenantDraft } from './TenantDraftProvider';

/**
 * The Personalização step whole, with the pieces of 2026-10-03's second round side by side: the
 * grounds as dropdowns (`BackgroundTonePicker` over `ToneSelect`, in the Cores card and in the dark
 * card), the buttons' style ahead of their colours (`ButtonColorsCard`) and the inks' samples over
 * the inks (`FontColorFields`, inside the title font's card). Each one is tested on its own
 * (PersonalizationColors.test, ToneSelect.test, FontColorSamples.test); this file holds the seams
 * between them, which no card sees alone.
 *
 * The catalog is the REAL pt-BR one through next-intl's own translator (a missing key throws); the
 * draft is a small stateful stand-in for `TenantDraftProvider` that every card reads and writes;
 * the Google catalogue never answers (the font list is not under test) and the logo card is
 * stubbed.
 *
 * Claims:
 *  1. The step holds the three in its order: the light ground's dropdown in the Cores card, the
 *     dark ground's in the dark card, the buttons' style first in their card, and the inks' two
 *     samples (light, then dark) right above the inks. No radio is left of the old tone grid, and
 *     none of them adds a brand scope or a device screen (the specs count the two mini frames).
 *  2. One draft feeds them all: a ground picked in either dropdown re-tints that mode's samples in
 *     the buttons' card and in the inks', and the mini frames, leaving the other mode's alone; the
 *     system's tone leaves them bare again.
 *  3. Their controls sit inside the step's form and never submit it (the style switch, the
 *     dropdowns' triggers and rows); "Continuar" alone does.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  const React = await import('react');
  return {
    // Vitest runs from `apps/web` (the `NotificationsSurface.test.tsx` precedent).
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    DraftContext: React.createContext<unknown>(null),
    useContext: React.useContext,
    update: vi.fn(),
    setTheme: vi.fn(),
    push: vi.fn(),
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
  useRouter: () => ({ push: harness.push, replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement('a', { href, ...rest }, children),
  };
});

vi.mock('@/lib/title-font', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/title-font')>();
  return {
    ...actual,
    // Never settles: the font list is not under test, and no state lands after a test ends.
    loadGoogleFonts: () => new Promise<never>(() => {}),
    loadFontSamples: vi.fn(),
    useTitleFont: (family: string | null) => (family ? actual.titleFontStack(family) : null),
  };
});

vi.mock('./TenantDraftProvider', () => ({
  useTenantDraft: () => harness.useContext(harness.DraftContext),
}));
// The look's cards read the same stand-in through their own context (2026-10-03).
vi.mock('./brand-look-context', () => ({
  useBrandLook: () => harness.useContext(harness.DraftContext),
}));

vi.mock('../preview/TenantPreviewProvider', () => ({
  useTenantPreview: () => ({ setTheme: harness.setTheme, theme: 'light' }),
}));

vi.mock('./WizardBrandPicker', () => ({ WizardBrandPicker: () => null }));

const { WizardPersonalization } = await import('./WizardPersonalization');

type Mode = 'light' | 'dark';
type WizardCopy = {
  actions: { next: string };
  brand: {
    background: { title: string };
    tones: { default: string } & Record<Mode, Record<string, string>>;
    buttons: { style: string; styleGradient: string };
  };
};
const W = (harness.messages.platform as unknown as { wizard: WizardCopy }).wizard;

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
  buttonColors: {
    style: 'solid',
    fill: { light: null, dark: null },
    fillEnd: { light: null, dark: null },
    ink: { light: null, dark: null },
  },
  host: '',
  hostReady: true,
  dataReady: true,
  fieldErrors: {},
  pendingSlug: null,
  createdId: null,
};

/** A stand-in for `TenantDraftProvider`: the draft in state, every patch recorded, then applied. */
function FakeDraft({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<TenantDraft>(BASE);
  const update = useCallback((patch: Partial<TenantDraft>) => {
    harness.update(patch);
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);
  const value = {
    draft,
    colors: { primary: draft.primary, secondary: draft.secondary },
    // Only valid values ever reach this draft, so the preview's copy is the draft's own.
    previewColors: {
      darkColors: draft.darkColors,
      fontColors: draft.fontColors,
      buttonColors: draft.buttonColors,
    },
    moduleKeys: [],
    logo: null,
    icon: null,
    restored: true,
    update,
  };
  return <harness.DraftContext.Provider value={value}>{children}</harness.DraftContext.Provider>;
}

const renderStep = () =>
  render(
    <FakeDraft>
      <WizardPersonalization />
    </FakeDraft>,
  );

/** A tone as its dropdown names it; the system's one says it is the default. */
function toneName(mode: Mode, tone: string): string {
  const name = W.brand.tones[mode][tone] ?? tone;
  const fallback = mode === 'light' ? DEFAULT_LIGHT_TONE : DEFAULT_DARK_TONE;
  return tone === fallback ? W.brand.tones.default.replace('{tone}', name) : name;
}

/** A ground's dropdown, named by its label followed by the chosen tone. */
const trigger = (mode: Mode, tone: string) =>
  screen.getByRole('combobox', { name: `${W.brand.background.title} ${toneName(mode, tone)}` });

/** Opens a ground's dropdown on its current tone and picks another one with the pointer. */
function pick(mode: Mode, from: string, to: string) {
  fireEvent.click(trigger(mode, from));
  fireEvent.click(screen.getByRole('option', { name: toneName(mode, to) }));
}

const at = (selector: string) => document.querySelector(selector) as HTMLElement;

/** `b` comes after `a` in the document. */
const follows = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** Each mode's samples outside the phone: the buttons' card's and the inks'. */
const SAMPLES: Record<Mode, readonly string[]> = {
  light: ['[data-button-sample="light"]', '[data-font-color-sample="light"]'],
  dark: ['[data-button-sample="dark"]', '[data-font-color-sample="dark"]'],
};

beforeEach(() => {
  harness.update.mockReset();
  harness.setTheme.mockReset();
  harness.push.mockReset();
});
afterEach(cleanup);

describe('the Personalização step, its second round together', () => {
  it('holds the dropdowns, the buttons’ style and the inks’ samples, in the step’s order', () => {
    renderStep();
    const light = trigger('light', DEFAULT_LIGHT_TONE);
    const dark = trigger('dark', DEFAULT_DARK_TONE);
    // The two grounds are the step's only dropdowns: the Cores card's, then the dark card's.
    expect(screen.getAllByRole('combobox')).toEqual([light, dark]);
    expect(at('[data-tone-picker="light"]').contains(light)).toBe(true);
    expect(at('[data-dark-colors] [data-tone-picker="dark"]').contains(dark)).toBe(true);
    expect(document.querySelectorAll('[data-tone-picker] input')).toHaveLength(0);

    // The buttons' style comes first in its card, ahead of the first colour.
    const card = at('[data-button-colors]');
    const style = within(card).getByRole('group', { name: W.brand.buttons.style });
    expect(follows(style, at('#buttonFillLight'))).toBe(true);

    // The inks' samples, light then dark, in the title font's card right above the titles' inks.
    const samples = at('[data-font-color-samples]');
    expect(at('[data-title-font-picker]').contains(samples)).toBe(true);
    expect(
      Array.from(samples.querySelectorAll('[data-font-color-sample]'), (sample) =>
        sample.getAttribute('data-font-color-sample'),
      ),
    ).toEqual(['light', 'dark']);
    expect(follows(samples, at('[data-font-color="title"]'))).toBe(true);

    // The step's order: Cores, the dark card, Botões, the title font.
    expect(follows(light, dark)).toBe(true);
    expect(follows(dark, style)).toBe(true);
    expect(follows(style, samples)).toBe(true);
    // The mini frames stay the only brand scopes (the specs count two); no second device screen.
    expect(document.querySelectorAll('[data-brand-scope]')).toHaveLength(2);
    expect(document.querySelector('[data-device-screen]')).toBeNull();
  });

  it('feeds every sample from one draft: a ground picked re-tints its own mode’s only', () => {
    renderStep();
    pick('dark', DEFAULT_DARK_TONE, 'cafe');
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    for (const selector of SAMPLES.dark) {
      expect(at(selector).getAttribute('data-dark-tone'), selector).toBe('cafe');
    }
    for (const selector of SAMPLES.light) {
      expect(at(selector).hasAttribute('data-bg-tone'), selector).toBe(false);
    }

    pick('light', DEFAULT_LIGHT_TONE, 'amarelado');
    expect(harness.setTheme).toHaveBeenLastCalledWith('light');
    for (const selector of SAMPLES.light) {
      expect(at(selector).getAttribute('data-bg-tone'), selector).toBe('amarelado');
    }
    for (const selector of SAMPLES.dark) {
      expect(at(selector).getAttribute('data-dark-tone'), selector).toBe('cafe');
    }
    // The title font's own sample and the mini frames take both, each under its own theme.
    expect(at('[data-font-sample]').getAttribute('data-bg-tone')).toBe('amarelado');
    expect(at('[data-font-sample]').getAttribute('data-dark-tone')).toBe('cafe');
    expect(at('[data-brand-scope][data-theme="light"]').getAttribute('data-bg-tone')).toBe(
      'amarelado',
    );
    expect(at('[data-brand-scope][data-theme="dark"]').getAttribute('data-dark-tone')).toBe('cafe');

    // The system's tones leave every sample bare again.
    pick('light', 'amarelado', DEFAULT_LIGHT_TONE);
    pick('dark', 'cafe', DEFAULT_DARK_TONE);
    expect(harness.update).toHaveBeenLastCalledWith({
      darkColors: { primary: null, secondary: null, tone: null },
    });
    for (const selector of [...SAMPLES.light, ...SAMPLES.dark, '[data-font-sample]']) {
      expect(at(selector).hasAttribute('data-bg-tone'), selector).toBe(false);
      expect(at(selector).hasAttribute('data-dark-tone'), selector).toBe(false);
    }
  });

  it('never submits the step from the new controls; "Continuar" alone does', () => {
    renderStep();
    const form = document.querySelector('form') as HTMLFormElement;
    const submits = vi.fn();
    form.addEventListener('submit', submits);

    // The style switch: both modes', so the preview keeps its theme; the gradient's fields show.
    const card = at('[data-button-colors]');
    expect(form.contains(card)).toBe(true);
    fireEvent.click(within(card).getByRole('button', { name: W.brand.buttons.styleGradient }));
    expect(card.getAttribute('data-button-style')).toBe('gradient');
    expect(document.getElementById('buttonFillEndLight')).not.toBeNull();
    expect(harness.setTheme).not.toHaveBeenCalled();

    // The dropdowns: a trigger and a row, then a trigger closed by Escape.
    pick('light', DEFAULT_LIGHT_TONE, 'lilas');
    fireEvent.click(trigger('dark', DEFAULT_DARK_TONE));
    fireEvent.keyDown(trigger('dark', DEFAULT_DARK_TONE), { key: 'Escape' });
    expect(trigger('dark', DEFAULT_DARK_TONE).getAttribute('aria-expanded')).toBe('false');
    expect(submits).not.toHaveBeenCalled();
    expect(harness.push).not.toHaveBeenCalled();

    // The control: the step's one submit button does submit, and the step moves on.
    fireEvent.click(screen.getByRole('button', { name: W.actions.next }));
    expect(submits).toHaveBeenCalledTimes(1);
    expect(harness.push).toHaveBeenCalledWith('/plataforma/novo/dominio');
  });
});
