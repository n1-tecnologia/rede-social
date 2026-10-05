// @vitest-environment happy-dom
import { NEUTRAL_BRAND } from '@rede-social/contracts/branding';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleFont } from '@/lib/title-font';
import type { TenantDraft } from './TenantDraftProvider';

/**
 * The title font's card after the owner's "only behind Editar" (2026-10-02): the search, the kinds
 * and the list of families stay closed until "Editar" beside "Fonte escolhida".
 *
 * The catalog is the REAL pt-BR one through next-intl's own translator (a missing key throws); the
 * Google catalogue is three families and the samples' loader is a spy (no network); the draft is a
 * small stateful stand-in for `TenantDraftProvider`.
 *
 * Claims:
 *  1. Closed by default: the toggle says "Editar" with `aria-expanded="false"` and `aria-controls`
 *     naming a `hidden` editor; no search box, no kind chips, no family radios reach the
 *     accessibility tree, and no family's letters are fetched. Its accessible name starts with the
 *     visible label and says what it edits.
 *  2. "Editar" opens all three in place (the label turns into "Concluir"), the default first and
 *     checked, and only then fetches the visible families' letters; "Concluir" closes them again and
 *     the search typed before survives the round trip.
 *  3. The list keeps its behaviour when open: a pick stores the family, a search narrows the list
 *     and its count, and "Usar a fonte padrão" stays on the line, open or closed.
 *  4. The line sits right under the sample; the inks (`FontColorFields`) come after the line and
 *     the editor, outside it.
 *  5. The sample is the tenant's screen in the preview's theme: that theme's ground tone and inks
 *     (the app name's on its line, the titles' on the others), and none without a choice.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  const React = await import('react');
  return {
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    DraftContext: React.createContext<unknown>(null),
    useContext: React.useContext,
    update: vi.fn(),
    setTheme: vi.fn(),
    theme: 'light' as 'light' | 'dark',
    loadFontSamples: vi.fn(),
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
  ['Poppins', 'sans', [400, 700]],
];

vi.mock('@/lib/title-font', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/title-font')>();
  return {
    ...actual,
    loadGoogleFonts: () => Promise.resolve(FONTS),
    loadFontSamples: harness.loadFontSamples,
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

const { TitleFontPicker } = await import('./TitleFontPicker');

type FontCopy = {
  edit: string;
  done: string;
  editName: string;
  doneName: string;
  sampleLight: string;
  sampleDark: string;
  reset: string;
  searchLabel: string;
  categories: { all: string; serif: string };
};
const F = (harness.messages.platform as unknown as { wizard: { brand: { font: FontCopy } } }).wizard
  .brand.font;

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

function FakeDraft({ initial, children }: { initial?: Partial<TenantDraft>; children: ReactNode }) {
  const [draft, setDraft] = useState<TenantDraft>({ ...BASE, ...initial });
  const update = useCallback((patch: Partial<TenantDraft>) => {
    harness.update(patch);
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);
  const value = {
    draft,
    colors: { primary: draft.primary, secondary: draft.secondary },
    // The draft here only ever holds valid colours, so the preview's copy is the draft's own.
    previewColors: { darkColors: draft.darkColors, fontColors: draft.fontColors },
    update,
    logo: null,
    icon: null,
  };
  return <harness.DraftContext.Provider value={value}>{children}</harness.DraftContext.Provider>;
}

const renderPicker = (initial?: Partial<TenantDraft>) =>
  render(
    <FakeDraft initial={initial}>
      <TitleFontPicker />
    </FakeDraft>,
  );

/** The catalogue resolved: the (hidden) editor shows the list, not the loading line. */
const listReady = () =>
  waitFor(() => expect(document.querySelector('[data-font-list]')).not.toBeNull());

beforeEach(() => {
  harness.update.mockReset();
  harness.setTheme.mockReset();
  harness.loadFontSamples.mockReset();
  harness.theme = 'light';
});
afterEach(cleanup);

describe('TitleFontPicker behind "Editar"', () => {
  it('starts closed: no search, no kinds, no families, no letters fetched', async () => {
    renderPicker();
    await listReady();
    const toggle = screen.getByRole('button', { name: F.editName });
    expect(F.editName.startsWith(F.edit)).toBe(true);
    expect(F.doneName.startsWith(F.done)).toBe(true);
    expect(toggle.textContent).toBe(F.edit);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const editor = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(editor?.hasAttribute('hidden')).toBe(true);
    expect(editor?.contains(document.querySelector('[data-font-list]'))).toBe(true);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: F.categories.all })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(harness.loadFontSamples).not.toHaveBeenCalled();
    // Saved with the tenant since 2026-10-03: no "preview only" note any more.
    expect(document.body.textContent).not.toMatch(/prévia/);
  });

  it('"Editar" opens the three in place and fetches the letters; "Concluir" closes them', async () => {
    renderPicker();
    await listReady();
    fireEvent.click(screen.getByRole('button', { name: F.editName }));
    const toggle = screen.getByRole('button', { name: F.doneName });
    expect(toggle.textContent).toBe(F.done);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.hidden).toBe(false);
    expect(screen.getByRole('searchbox', { name: F.searchLabel })).toBeTruthy();
    expect(screen.getByRole('button', { name: F.categories.all })).toBeTruthy();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.value)).toEqual(['', 'Bebas Neue', 'Lora', 'Poppins']);
    expect(radios[0]?.checked).toBe(true);
    await waitFor(() => expect(harness.loadFontSamples).toHaveBeenCalledWith(FONTS));

    // A search, closed and reopened, is still there.
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lor' } });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe(F.edit);
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(toggle);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('lor');
  });

  it('keeps the list working when open: pick, search, kinds and the count', async () => {
    renderPicker();
    await listReady();
    fireEvent.click(screen.getByRole('button', { name: F.editName }));
    fireEvent.click(screen.getByRole('radio', { name: /Lora/ }));
    expect(harness.update).toHaveBeenLastCalledWith({ titleFont: 'Lora' });
    const chosen = document.querySelector('[data-font-chosen]') as HTMLElement;
    expect(chosen.textContent).toContain('Lora');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bebas' } });
    expect(
      (screen.getAllByRole('radio') as HTMLInputElement[]).map((radio) => radio.value),
    ).toEqual(['Bebas Neue']);
    expect(screen.getByText('1 fonte do Google')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: F.categories.serif }));
    const values = (screen.getAllByRole('radio') as HTMLInputElement[]).map((radio) => radio.value);
    expect(values).toEqual(['', 'Lora']);
  });

  it('"Usar a fonte padrão" stays on the line, closed or open', async () => {
    renderPicker({ titleFont: 'Lora' });
    await listReady();
    const line = document.querySelector('[data-font-chosen]') as HTMLElement;
    fireEvent.click(within(line).getByRole('button', { name: F.reset }));
    expect(harness.update).toHaveBeenLastCalledWith({ titleFont: null });
    expect(within(line).queryByRole('button', { name: F.reset })).toBeNull();
    expect(within(line).getByRole('button', { name: F.editName })).toBeTruthy();
  });

  it('puts the line right under the sample, and the inks after the line and the editor', async () => {
    renderPicker();
    await listReady();
    const sample = document.querySelector('[data-font-sample]') as Element;
    const inks = document.querySelector('[data-font-colors]') as Element;
    const line = document.querySelector('[data-font-chosen]') as Element;
    const editor = document.querySelector('[data-font-editor]') as Element;
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(sample.nextElementSibling).toBe(line);
    expect(follows(line, editor)).toBe(true);
    expect(follows(editor, inks)).toBe(true);
    expect(editor.contains(inks)).toBe(false);
    expect(inks.querySelectorAll('input[type="color"]')).toHaveLength(4);
  });
});

describe('the sample', () => {
  const sample = () => document.querySelector('[data-font-sample]') as HTMLElement;
  /** The colour a line was painted with inline, whichever notation the DOM keeps. */
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
  const titles = () => Array.from(document.querySelectorAll('[data-font-sample-title]'));
  const appName = () => document.querySelector('[data-font-sample-app-name]');

  it('without a choice: the light screen, no tone, the theme inks', async () => {
    renderPicker();
    await listReady();
    expect(sample().getAttribute('data-theme')).toBe('light');
    expect(sample().hasAttribute('data-bg-tone')).toBe(false);
    expect(sample().hasAttribute('data-dark-tone')).toBe(false);
    expect(sample().textContent).toContain(F.sampleLight);
    expect(titles()).toHaveLength(4);
    for (const line of [...titles(), appName()]) expect(inkOf(line)).toBe('');
  });

  it('paints the light tone and the light inks, each on its own lines', async () => {
    renderPicker({
      lightTone: 'amarelado',
      darkColors: { primary: null, secondary: null, tone: 'cafe' },
      fontColors: {
        title: { light: '#7c2d12', dark: '#ffd27a' },
        appName: { light: '#0f766e', dark: null },
      },
    });
    await listReady();
    expect(sample().getAttribute('data-theme')).toBe('light');
    // Both ids ride on the box; tokens.css applies each under its own theme only.
    expect(sample().getAttribute('data-bg-tone')).toBe('amarelado');
    expect(sample().getAttribute('data-dark-tone')).toBe('cafe');
    for (const line of titles()) expect(inkOf(line)).toBe('#7c2d12');
    expect(inkOf(appName())).toBe('#0f766e');
    expect(titles().some((line) => inkOf(line) === '#ffd27a')).toBe(false);
  });

  it('turns with the preview: the dark theme, its tone and its inks', async () => {
    harness.theme = 'dark';
    renderPicker({
      darkColors: { primary: null, secondary: null, tone: 'cafe' },
      fontColors: {
        title: { light: '#7c2d12', dark: '#ffd27a' },
        appName: { light: '#0f766e', dark: null },
      },
    });
    await listReady();
    expect(sample().getAttribute('data-theme')).toBe('dark');
    expect(sample().getAttribute('data-dark-tone')).toBe('cafe');
    expect(sample().textContent).toContain(F.sampleDark);
    for (const line of titles()) expect(inkOf(line)).toBe('#ffd27a');
    // No dark ink for the app name: it keeps the theme's own text colour.
    expect(inkOf(appName())).toBe('');
  });
});
