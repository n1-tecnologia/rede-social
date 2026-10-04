// @vitest-environment happy-dom
import { NEUTRAL_BRAND } from '@rede-social/contracts/branding';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyButtonColors } from '@/lib/bg-tone';
import type { GoogleFont } from '@/lib/title-font';
import type { TenantDraft } from './TenantDraftProvider';

/**
 * The inks' samples (2026-10-03): the owner asked for the titles' and the app name's colours to
 * come with the sample the title font's card already shows. Right above "Cor dos títulos", one
 * sample per theme in the fields' own two columns, each a piece of that theme's screen drawn with
 * the lines of the card's sample, in that theme's inks.
 *
 * The catalog is the REAL pt-BR one through next-intl's own translator (a missing key throws); the
 * Google catalogue is two families and a chosen family resolves at once (no network); the draft is
 * a small stateful stand-in for `TenantDraftProvider` and the preview's `setTheme` is a spy.
 *
 * Claims:
 *  1. The row sits right above "Cor dos títulos", in the fields' own grid, light then dark; each
 *     sample declares its theme on the screen's ground with a label naming it, never a brand scope
 *     nor a device screen, and holds nothing to focus.
 *  2. Each sample carries its own theme's ground tone only, and never the default one.
 *  3. Without a choice every line keeps its theme's own text colour and the app's font.
 *  4. Each sample paints its own theme's inks, the titles' on the title and the card's name, the
 *     app name's on the name; a theme without an ink keeps its own, never the other theme's.
 *  5. Typing repaints only the sample of the field's theme, and only once the hex is complete; the
 *     reset paints the theme's own ink again.
 *  6. Every line is in the chosen family, with no synthesized bold; the label is not.
 *  7. The app name is the top bar's: the display name, the placeholder while it is empty, and none
 *     with a logo (the titles stay).
 *  8. Inside the title font's card: after the font's line and its editor, the card's sample keeping
 *     its single theme, and each line drawn exactly as the card's sample draws the same line.
 *  9. No line of any sample draws past its column: the names cut with an ellipsis, an event's name
 *     at two lines, and a title (one word, "Comunidades", that a very wide family makes wider than a
 *     sample) is cut at the column's edge, never wrapped, so it never runs onto the other theme's
 *     sample or off the card. happy-dom has no layout engine, so this is asserted on the classes that
 *     produce it (the ParticipantsList.test.tsx precedent); the widths were measured in Chrome.
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
    theme: 'light' as 'light' | 'dark',
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

const FONTS: readonly GoogleFont[] = [
  ['Bebas Neue', 'display', [400]],
  ['Lora', 'serif', [400, 700]],
];

vi.mock('@/lib/title-font', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/title-font')>();
  return {
    ...actual,
    loadGoogleFonts: () => Promise.resolve(FONTS),
    loadFontSamples: () => {},
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
  useTenantPreview: () => ({ setTheme: harness.setTheme, theme: harness.theme }),
}));

const { FontColorFields } = await import('./FontColorFields');
const { TitleFontPicker } = await import('./TitleFontPicker');

type FontCopy = {
  sampleLight: string;
  sampleDark: string;
  colors: { titles: string; reset: string };
};
const platform = harness.messages.platform as unknown as {
  wizard: { brand: { font: FontCopy } };
  devicePreview: { sample: { eventTitle: string } };
};
const F = platform.wizard.brand.font;
const EVENT_NAME = platform.devicePreview.sample.eventTitle;
const COMMUNITIES = (harness.messages.communities as unknown as { list: { title: string } }).list
  .title;
const EVENTS = (harness.messages.events as unknown as { list: { title: string } }).list.title;
const NAME_PLACEHOLDER = (
  harness.messages.platformBranding as unknown as { preview: { namePlaceholder: string } }
).preview.namePlaceholder;

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
  // The buttons' card's own shape, whatever it holds: these samples never read it.
  buttonColors: emptyButtonColors(),
  host: '',
  hostReady: true,
  dataReady: true,
  fieldErrors: {},
  pendingSlug: null,
  createdId: null,
};

/** The draft's inks as a test writes them: the theme colours left out are unset. */
const inksOf = (
  title: Partial<TenantDraft['fontColors']['title']> = {},
  appName: Partial<TenantDraft['fontColors']['appName']> = {},
): TenantDraft['fontColors'] => ({
  title: { light: null, dark: null, ...title },
  appName: { light: null, dark: null, ...appName },
});

/** A stand-in for `TenantDraftProvider`: the draft in state, every patch recorded, then applied. */
function FakeDraft({
  initial,
  withLogo = false,
  children,
}: {
  initial?: Partial<TenantDraft>;
  withLogo?: boolean;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<TenantDraft>({ ...BASE, ...initial });
  const update = useCallback((patch: Partial<TenantDraft>) => {
    harness.update(patch);
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);
  const value = {
    draft,
    colors: { primary: draft.primary, secondary: draft.secondary },
    // Only complete hexes reach this draft (the fields keep a half-typed one), so the preview's
    // copy is the draft's own.
    previewColors: {
      darkColors: draft.darkColors,
      fontColors: draft.fontColors,
      buttonColors: draft.buttonColors,
    },
    update,
    logo: withLogo ? { file: new File([], 'logo.png'), url: 'blob:logo' } : null,
    icon: null,
  };
  return <harness.DraftContext.Provider value={value}>{children}</harness.DraftContext.Provider>;
}

const renderFields = (initial?: Partial<TenantDraft>, withLogo = false) =>
  render(
    <FakeDraft initial={initial} withLogo={withLogo}>
      <FontColorFields />
    </FakeDraft>,
  );

type Mode = 'light' | 'dark';

const sample = (mode: Mode) =>
  document.querySelector(`[data-font-color-sample="${mode}"]`) as HTMLElement;
const titlesOf = (mode: Mode) =>
  Array.from(sample(mode).querySelectorAll<HTMLElement>('[data-font-color-sample-title]'));
const appNameOf = (mode: Mode) =>
  sample(mode).querySelector<HTMLElement>('[data-font-color-sample-app-name]');
/** Every line of a sample drawn in the title font: the app name (when drawn) and the titles. */
const linesOf = (mode: Mode) =>
  Array.from(
    sample(mode).querySelectorAll<HTMLElement>(
      '[data-font-color-sample-app-name], [data-font-color-sample-title]',
    ),
  );

/** The colour a line was painted with inline, whichever notation the DOM keeps; '' for none. */
const inkOf = (el: Element | null) => {
  const color = (el as HTMLElement | null)?.style.color ?? '';
  const rgb = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  return rgb
    ? `#${rgb
        .slice(1)
        .map((c) => Number(c).toString(16).padStart(2, '0'))
        .join('')}`
    : color.toLowerCase();
};

const input = (id: string) => document.getElementById(id) as HTMLInputElement;

beforeEach(() => {
  harness.update.mockReset();
  harness.setTheme.mockReset();
  harness.theme = 'light';
});
afterEach(cleanup);

describe('the inks’ samples', () => {
  it('puts one sample per theme right above "Cor dos títulos", in the fields’ own grid', () => {
    renderFields();
    const row = document.querySelector('[data-font-color-samples]') as HTMLElement;
    const titles = screen.getByRole('group', { name: F.colors.titles });
    // First in the inks' block, and right above the titles' group.
    expect(row.parentElement?.hasAttribute('data-font-colors')).toBe(true);
    expect(row.parentElement?.firstElementChild).toBe(row);
    expect(row.nextElementSibling).toBe(titles);
    // The fields' grid, margin apart: the same columns at the same widths, the same gap.
    const fieldsGrid = titles.querySelector('.grid') as HTMLElement;
    const classes = (el: Element) => el.className.split(' ').filter((name) => name !== 'mt-3');
    expect(classes(row)).toEqual(classes(fieldsGrid));
    expect(classes(row)).toContain('md:grid-cols-2');
    // Light on the left, dark on the right, as the fields under them.
    expect(
      Array.from(row.children).map((child) => child.getAttribute('data-font-color-sample')),
    ).toEqual(['light', 'dark']);
    expect(
      Array.from(fieldsGrid.querySelectorAll('input[type="color"]')).map((field) =>
        field.closest('[data-preview-color]')?.getAttribute('data-preview-color'),
      ),
    ).toEqual(['titleColorLight', 'titleColorDark']);
  });

  it('draws each sample on its theme’s ground, labelled, with the card’s lines', () => {
    renderFields();
    for (const [mode, label] of [
      ['light', F.sampleLight],
      ['dark', F.sampleDark],
    ] as const) {
      const box = sample(mode);
      expect(box.getAttribute('data-theme')).toBe(mode);
      expect(box.className.split(' ')).toEqual(expect.arrayContaining(['bg-bg', 'text-text']));
      expect(box.firstElementChild?.textContent).toBe(label);
      expect(appNameOf(mode)?.textContent).toBe(BASE.displayName);
      expect(titlesOf(mode).map((line) => line.textContent)).toEqual([COMMUNITIES, EVENT_NAME]);
    }
    // A picture, not a control: nothing to focus or to press, the samples themselves included.
    const row = document.querySelector('[data-font-color-samples]') as HTMLElement;
    expect(row.querySelectorAll('a, button, input, select, textarea, [tabindex]')).toHaveLength(0);
    // Never a brand scope (the specs count the BrandPreview frames) nor a second device screen.
    expect(document.querySelector('[data-brand-scope], [data-device-screen]')).toBeNull();
    // Drawing them changes nothing: not the draft, not the preview's theme.
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.setTheme).not.toHaveBeenCalled();
  });

  it('carries each theme’s own ground tone only, and never the default one', () => {
    renderFields({
      lightTone: 'amarelado',
      darkColors: { primary: null, secondary: null, tone: 'cafe' },
    });
    expect(sample('light').getAttribute('data-bg-tone')).toBe('amarelado');
    expect(sample('light').hasAttribute('data-dark-tone')).toBe(false);
    expect(sample('dark').getAttribute('data-dark-tone')).toBe('cafe');
    expect(sample('dark').hasAttribute('data-bg-tone')).toBe(false);
    cleanup();

    renderFields({
      lightTone: 'cinza',
      darkColors: { primary: null, secondary: null, tone: 'grafite' },
    });
    for (const mode of ['light', 'dark'] as const) {
      expect(sample(mode).hasAttribute('data-bg-tone')).toBe(false);
      expect(sample(mode).hasAttribute('data-dark-tone')).toBe(false);
    }
  });

  it('keeps, without a choice, each theme’s own text colour and the app’s font', () => {
    renderFields();
    for (const mode of ['light', 'dark'] as const) {
      const lines = linesOf(mode);
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        // No inline colour: `text-text` under the box's theme, the colour the phone leaves alone.
        expect(inkOf(line)).toBe('');
        expect(line.className.split(' ')).toContain('text-text');
        expect(line.style.fontFamily).toBe('');
      }
    }
  });

  it('paints each theme’s inks on its own sample, never on the other one', () => {
    renderFields({
      fontColors: inksOf({ light: '#7c2d12', dark: '#ffd27a' }, { light: '#0f766e' }),
    });
    expect(titlesOf('light').map(inkOf)).toEqual(['#7c2d12', '#7c2d12']);
    expect(inkOf(appNameOf('light'))).toBe('#0f766e');
    expect(titlesOf('dark').map(inkOf)).toEqual(['#ffd27a', '#ffd27a']);
    // No dark ink for the app name: it keeps the dark theme's own, not the light one's.
    expect(inkOf(appNameOf('dark'))).toBe('');
  });

  it('repaints only its theme’s sample, on a complete hex; a reset paints the theme ink', () => {
    renderFields();
    fireEvent.change(input('titleColorDark'), { target: { value: '#ffd2' } });
    expect(harness.update).not.toHaveBeenCalled();
    expect(titlesOf('dark').map(inkOf)).toEqual(['', '']);

    fireEvent.change(input('titleColorDark'), { target: { value: '#FFD27A' } });
    expect(titlesOf('dark').map(inkOf)).toEqual(['#ffd27a', '#ffd27a']);
    expect(titlesOf('light').map(inkOf)).toEqual(['', '']);
    expect(inkOf(appNameOf('dark'))).toBe('');

    fireEvent.change(input('appNameColorLight'), { target: { value: '#0f766e' } });
    expect(inkOf(appNameOf('light'))).toBe('#0f766e');
    expect(inkOf(appNameOf('dark'))).toBe('');
    expect(titlesOf('light').map(inkOf)).toEqual(['', '']);

    fireEvent.click(
      screen.getByRole('button', { name: 'Usar a cor padrão: Cor dos títulos, Modo escuro' }),
    );
    expect(titlesOf('dark').map(inkOf)).toEqual(['', '']);
    expect(inkOf(appNameOf('light'))).toBe('#0f766e');
  });

  it('draws every line in the chosen family, with no synthesized bold; the label is not', () => {
    renderFields({ titleFont: 'Lora' });
    for (const mode of ['light', 'dark'] as const) {
      for (const line of linesOf(mode)) {
        expect(line.style.fontFamily).toMatch(/^"?Lora"?, var\(--font-manrope\)/);
        expect(line.style.getPropertyValue('font-synthesis')).toBe('none');
      }
      expect(sample(mode).firstElementChild?.hasAttribute('style')).toBe(false);
    }
  });

  it('names the app as the top bar does: the name, the placeholder, none with a logo', () => {
    renderFields({ displayName: '  Clube Aurora  ' });
    expect(appNameOf('light')?.textContent).toBe('Clube Aurora');
    expect(appNameOf('dark')?.textContent).toBe('Clube Aurora');
    cleanup();

    renderFields({ displayName: '   ' });
    expect(appNameOf('light')?.textContent).toBe(NAME_PLACEHOLDER);
    expect(appNameOf('dark')?.textContent).toBe(NAME_PLACEHOLDER);
    cleanup();

    // With a logo the top bar shows the logo alone: no name to colour, the titles stay.
    renderFields({ fontColors: inksOf({}, { light: '#0f766e', dark: '#ffd27a' }) }, true);
    for (const mode of ['light', 'dark'] as const) {
      expect(appNameOf(mode)).toBeNull();
      expect(titlesOf(mode)).toHaveLength(2);
    }
  });
});

describe('inside the title font’s card', () => {
  const renderCard = (initial?: Partial<TenantDraft>) =>
    render(
      <FakeDraft initial={initial}>
        <TitleFontPicker />
      </FakeDraft>,
    );
  /** The catalogue resolved: the (hidden) editor shows the list, not the loading line. */
  const listReady = () =>
    waitFor(() => expect(document.querySelector('[data-font-list]')).not.toBeNull());

  it('comes after the font’s line and editor; the card’s sample keeps one theme', async () => {
    harness.theme = 'dark';
    renderCard({ fontColors: inksOf({ light: '#7c2d12', dark: '#ffd27a' }) });
    await listReady();
    const top = document.querySelector('[data-font-sample]') as HTMLElement;
    const editor = document.querySelector('[data-font-editor]') as HTMLElement;
    const row = document.querySelector('[data-font-color-samples]') as HTMLElement;
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(top, editor)).toBe(true);
    expect(follows(editor, row)).toBe(true);
    expect(editor.contains(row)).toBe(false);
    expect(top.contains(row)).toBe(false);
    // The card's sample still shows the preview's theme, with its four titles; the row shows both.
    expect(top.getAttribute('data-theme')).toBe('dark');
    const topTitles = Array.from(top.querySelectorAll<HTMLElement>('[data-font-sample-title]'));
    expect(topTitles).toHaveLength(4);
    expect(document.querySelectorAll('[data-font-sample-title]')).toHaveLength(4);
    expect(topTitles.map(inkOf)).toEqual(['#ffd27a', '#ffd27a', '#ffd27a', '#ffd27a']);
    expect(titlesOf('light').map(inkOf)).toEqual(['#7c2d12', '#7c2d12']);
    expect(titlesOf('dark').map(inkOf)).toEqual(['#ffd27a', '#ffd27a']);
  });

  it('draws each line exactly as the card’s sample draws the same line', async () => {
    renderCard({
      titleFont: 'Lora',
      fontColors: inksOf({ light: '#7c2d12' }, { light: '#0f766e' }),
    });
    await listReady();
    const top = document.querySelector('[data-font-sample]') as HTMLElement;
    const topLine = (text: string) =>
      Array.from(top.querySelectorAll<HTMLElement>('p')).find((p) => p.textContent === text);
    const line = (text: string) => linesOf('light').find((p) => p.textContent === text);
    for (const text of [BASE.displayName, COMMUNITIES, EVENT_NAME]) {
      const theirs = topLine(text);
      const ours = line(text);
      expect(theirs).toBeTruthy();
      expect(ours?.className).toBe(theirs?.className);
      // The same theme here (the preview shows the light one): the same family and the same ink.
      expect(ours?.getAttribute('style')).toBe(theirs?.getAttribute('style'));
    }
  });

  it('keeps every line in its column, a title wider than it cut at the column’s edge', async () => {
    renderCard();
    await listReady();
    const top = document.querySelector('[data-font-sample]') as HTMLElement;
    const lines = [
      ...Array.from(
        top.querySelectorAll<HTMLElement>('[data-font-sample-app-name], [data-font-sample-title]'),
      ),
      ...linesOf('light'),
      ...linesOf('dark'),
    ];
    // The card's sample draws five lines, each theme's sample three.
    expect(lines).toHaveLength(11);
    const classesOf = (line: HTMLElement) => line.className.split(' ');
    // Sideways, each line stops at its own column: a name truncates, an event's name clamps, a
    // title clips (Tailwind's `overflow-x: clip`).
    const held = ['truncate', 'line-clamp-2', 'overflow-x-clip'];
    for (const line of lines) {
      expect(
        classesOf(line).some((name) => held.includes(name)),
        line.textContent ?? '',
      ).toBe(true);
    }
    // The titles: one line in the phone, never broken nor ellipsized there, so a sample narrower
    // than the phone cuts them at its edge instead (never over the other theme's sample).
    const titles = lines.filter((line) => [COMMUNITIES, EVENTS].includes(line.textContent ?? ''));
    expect(titles.map((line) => line.textContent)).toEqual([
      COMMUNITIES,
      EVENTS,
      COMMUNITIES,
      COMMUNITIES,
    ]);
    for (const title of titles) {
      expect(classesOf(title)).toContain('overflow-x-clip');
      for (const reshapes of ['truncate', 'break-words', 'break-all']) {
        expect(classesOf(title)).not.toContain(reshapes);
      }
    }
  });
});
