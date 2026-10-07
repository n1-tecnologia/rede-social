// @vitest-environment happy-dom
import {
  contrastRatio,
  DARK_BG,
  deriveBrandColors,
  LIGHT_BG,
  NAVY,
  NEUTRAL_BRAND,
  WHITE,
} from '@rede-social/contracts/branding';
import { buttonInk, buttonRampEnd } from '@rede-social/core/ui';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode, useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatContrastRatio } from '@/lib/contrast-ratio';
import type { TenantDraft } from './TenantDraftProvider';

/**
 * Personalização's preview-only colours: the ground tones (`BackgroundTonePicker`, both modes), the
 * dark mode's card (`DarkColorsCard`), the buttons' card (`ButtonColorsCard`) and the titles' and
 * app name's inks (`FontColorFields`), all through the shared `PreviewColorField`.
 *
 * The catalog is the REAL pt-BR one through next-intl's own translator (a missing key throws), the
 * draft is a small stateful stand-in for `TenantDraftProvider` (its `update` is recorded and applied)
 * and the preview's `setTheme` is a spy. happy-dom has no stylesheet, so `useThemeSurfaces` keeps the
 * system's neutrals (the contracts' LIGHT_BG, WHITE and DARK_BG): the contrast lines are asserted
 * against exactly those.
 *
 * Claims:
 *  1. Each tone picker is ONE dropdown (`ToneSelect`, a select-only combobox named by its label and
 *     the chosen tone) whose list holds the eight predefined tones, the system's tone first and
 *     chosen by default, each swatch (the trigger's too) painted from the tone's own token by id, and
 *     no free colour input at all; a pick, by click or keyboard, stores the id (`null` for the
 *     default), closes the list and turns the preview to that theme, the focus on the trigger too.
 *     Its keyboard and closing in full are ToneSelect.test.
 *  2. The dark card opens on the derived colours (`deriveBrandColors`), says "Automática" until one
 *     is picked, stores only a complete hex (lower-cased), drops a partial one on leaving the field,
 *     resets to `null`, and turns the preview dark on any interaction; its contrast lines measure the
 *     dark primary against its ink and against the dark ground.
 *  3. The inks open on the theme text colours, store the light and the dark value apart, reset each
 *     on its own, turn the preview to the field's theme, and carry their contrast.
 *  4. The buttons' card opens each mode on what the phone paints while unset (the primary and its
 *     text; in dark the dark accent), says "Automática", or "Igual ao modo claro" where the dark
 *     mode inherits the light button; stores only a complete hex, in its own field; resets one
 *     field by a name that says which; turns the preview to the field's mode; measures the text on
 *     the button, the pair the phone paints; and paints its samples inline on each mode's ground,
 *     never through a brand scope. Its style comes first, one for both modes (solid by default,
 *     switching it leaves the preview's theme); a gradient names its "Cor inicial" and "Cor final"
 *     per mode, opens on the automatic gradient (each mode's accent to its ramp, never the
 *     secondary, so its pill reads as the solid button's), inherits each light colour in dark (the
 *     whole light gradient, text included, while the dark mode has no last colour of its own),
 *     says "Igual ao modo claro" only beside the very colour the light mode shows (a dark text of
 *     its own on the other side of the first colour turns the automatic last colour the other
 *     way), paints its samples with the very gradient the phone gets, measures the text where it
 *     reads worst (at either end), and keeps its last colours aside while solid.
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

vi.mock('./TenantDraftProvider', () => ({
  useTenantDraft: () => harness.useContext(harness.DraftContext),
}));
// The look's cards read the same stand-in through their own context (2026-10-03).
vi.mock('./brand-look-context', () => ({
  useBrandLook: () => harness.useContext(harness.DraftContext),
}));

vi.mock('../preview/TenantPreviewProvider', () => ({
  useTenantPreview: () => ({ setTheme: harness.setTheme }),
}));

const { BackgroundTonePicker } = await import('./BackgroundTonePicker');
const { DarkColorsCard } = await import('./DarkColorsCard');
const { FontColorFields } = await import('./FontColorFields');
const { ButtonColorsCard } = await import('./ButtonColorsCard');

type WizardCopy = {
  brand: {
    background: { title: string };
    dark: { title: string; automatic: string; reset: string };
    font: { colors: { default: string; reset: string; titles: string; appName: string } };
    buttons: {
      title: string;
      light: string;
      dark: string;
      automatic: string;
      inherited: string;
      reset: string;
    };
  };
};
const W = (harness.messages.platform as unknown as { wizard: WizardCopy }).wizard;
const NUDGE = (harness.messages.profile as unknown as { nudge: { action: string } }).nudge;

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
function FakeDraft({ initial, children }: { initial?: Partial<TenantDraft>; children: ReactNode }) {
  const [draft, setDraft] = useState<TenantDraft>({ ...BASE, ...initial });
  const update = useCallback((patch: Partial<TenantDraft>) => {
    harness.update(patch);
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);
  const value = {
    draft,
    colors: { primary: draft.primary, secondary: draft.secondary },
    update,
    logo: null,
    icon: null,
  };
  return <harness.DraftContext.Provider value={value}>{children}</harness.DraftContext.Provider>;
}

/** The pill a check shows: the app's own formatter (a failing ratio rounds down). */
const pill = (value: number, min: number) =>
  value >= min
    ? `AA ${formatContrastRatio(value, true)}:1`
    : `Baixo ${formatContrastRatio(value, false)}:1`;

const input = (id: string) => document.getElementById(id) as HTMLInputElement;

/** An accessible name that starts with `prefix` (the visible label; the name adds the field). */
const startsWith = (prefix: string) => (name: string) => name.startsWith(prefix);

beforeEach(() => {
  harness.update.mockReset();
  harness.setTheme.mockReset();
});
afterEach(cleanup);

describe('BackgroundTonePicker', () => {
  const BG = W.brand.background as { title: string; lightBody: string; darkBody: string };
  /** The dropdown's trigger: a combobox named by the label followed by the chosen tone. */
  const trigger = (tone: string) => screen.getByRole('combobox', { name: `${BG.title} ${tone}` });
  /** The list a trigger controls, open or not. */
  const listOf = (combo: HTMLElement) =>
    document.getElementById(combo.getAttribute('aria-controls') ?? '') as HTMLElement;
  const hintOf = (combo: HTMLElement) =>
    document.getElementById(combo.getAttribute('aria-describedby') ?? '')?.textContent;

  it('light: a closed dropdown on the gray, the eight tones in its list, no free colour', () => {
    render(
      <FakeDraft>
        <BackgroundTonePicker mode="light" />
      </FakeDraft>,
    );
    const picker = document.querySelector('[data-tone-picker="light"]') as HTMLElement;
    const combo = trigger('Cinza claro (padrão)');
    expect(picker.contains(combo)).toBe(true);
    expect(combo.getAttribute('aria-expanded')).toBe('false');
    expect(hintOf(combo)).toBe(BG.lightBody);
    // The trigger's swatch is the chosen tone, painted from the tone's own token by id.
    const own = combo.querySelector('[data-bg-tone]');
    expect(own?.getAttribute('data-bg-tone')).toBe('cinza');
    expect(own?.getAttribute('data-theme')).toBe('light');
    expect(own?.className).toContain('bg-[var(--tone-ground)]');
    // Closed, the list lives in the picker (the specs reach `[data-tone-picker] [data-tone-option]`)
    // out of reach; open, it is in the top layer, over the neighbouring cards.
    const list = listOf(combo);
    expect(picker.contains(list)).toBe(true);
    expect(list.hidden).toBe(true);
    expect(list.getAttribute('popover')).toBe('manual');
    expect(screen.queryByRole('option')).toBeNull();

    fireEvent.click(combo);
    expect(combo.getAttribute('aria-expanded')).toBe('true');
    const listbox = screen.getByRole('listbox', { name: BG.title });
    expect(listbox).toBe(list);
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('data-tone-option'))).toEqual([
      'cinza',
      'amarelado',
      'laranjado',
      'avermelhado',
      'lilas',
      'azulado',
      'agua',
      'esverdeado',
    ]);
    expect(options.map((option) => option.textContent)).toEqual([
      'Cinza claro (padrão)',
      'Amarelado',
      'Laranjado',
      'Avermelhado',
      'Lilás',
      'Azulado',
      'Verde-água',
      'Esverdeado',
    ]);
    // The gray alone is selected, with the check (a cue that is not a colour), and starts active.
    const selected = options.filter((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected.map((option) => option.getAttribute('data-tone-option'))).toEqual(['cinza']);
    expect(listbox.querySelectorAll('svg')).toHaveLength(1);
    expect(listbox.querySelector('[data-tone-option="cinza"] svg')).not.toBeNull();
    expect(combo.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    // Each option's swatch paints its own tone by id, on the light theme.
    const amber = listbox.querySelector('[data-tone-option="amarelado"] [data-bg-tone]');
    expect(amber?.getAttribute('data-bg-tone')).toBe('amarelado');
    expect(amber?.getAttribute('data-theme')).toBe('light');
    expect(amber?.className).toContain('bg-[var(--tone-ground)]');
    // No colour in the markup, no field of any kind, and opening stores nothing.
    expect(picker.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
    expect(picker.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('light: a tone clicked is stored by id, closes the list and turns the preview light', () => {
    render(
      <FakeDraft>
        <BackgroundTonePicker mode="light" />
      </FakeDraft>,
    );
    fireEvent.click(trigger('Cinza claro (padrão)'));
    fireEvent.click(screen.getByRole('option', { name: 'Amarelado' }));
    expect(harness.update).toHaveBeenLastCalledWith({ lightTone: 'amarelado' });
    expect(harness.setTheme).toHaveBeenLastCalledWith('light');
    // The trigger names and shows the new tone, closed, with the focus back on it.
    const combo = trigger('Amarelado');
    expect(combo.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(combo);
    expect(combo.querySelector('[data-bg-tone]')?.getAttribute('data-bg-tone')).toBe('amarelado');
    // The selection and its check moved with the choice.
    fireEvent.click(combo);
    const amber = screen.getByRole('option', { name: 'Amarelado' });
    expect(amber.getAttribute('aria-selected')).toBe('true');
    expect(amber.querySelector('svg')).not.toBeNull();
    expect(document.querySelector('[data-tone-option="cinza"] svg')).toBeNull();
    // The gray is the system's tone again: null.
    fireEvent.click(screen.getByRole('option', { name: 'Cinza claro (padrão)' }));
    expect(harness.update).toHaveBeenLastCalledWith({ lightTone: null });
    expect(harness.update).toHaveBeenCalledTimes(2);
  });

  it('light: the keyboard opens, moves and chooses; Escape closes, the focus on the trigger', () => {
    render(
      <FakeDraft>
        <BackgroundTonePicker mode="light" />
      </FakeDraft>,
    );
    const combo = trigger('Cinza claro (padrão)');
    combo.focus();
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(combo.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Amarelado' }).id,
    );
    fireEvent.keyDown(combo, { key: 'Escape' });
    expect(combo.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(combo);
    expect(harness.update).not.toHaveBeenCalled();
    // Typed letters jump by name, accents aside ("li" is Lilás); Enter chooses it.
    fireEvent.keyDown(combo, { key: 'l' });
    fireEvent.keyDown(combo, { key: 'i' });
    expect(combo.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Lilás' }).id,
    );
    fireEvent.keyDown(combo, { key: 'Enter' });
    expect(harness.update).toHaveBeenLastCalledWith({ lightTone: 'lilas' });
    expect(harness.setTheme).toHaveBeenLastCalledWith('light');
    expect(document.activeElement).toBe(trigger('Lilás'));
  });

  it('light: choosing the chosen tone again, or pressing outside, only closes the list', () => {
    render(
      <FakeDraft initial={{ lightTone: 'azulado' }}>
        <BackgroundTonePicker mode="light" />
      </FakeDraft>,
    );
    fireEvent.click(trigger('Azulado'));
    fireEvent.click(screen.getByRole('option', { name: 'Azulado' }));
    expect(trigger('Azulado').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger('Azulado'));
    expect(trigger('Azulado').getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(document.body);
    expect(trigger('Azulado').getAttribute('aria-expanded')).toBe('false');
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('light: a restored tone is the chosen one, an explicit gray reads as the default', () => {
    const { unmount } = render(
      <FakeDraft initial={{ lightTone: 'azulado' }}>
        <BackgroundTonePicker mode="light" />
      </FakeDraft>,
    );
    const combo = trigger('Azulado');
    expect(combo.querySelector('[data-bg-tone]')?.getAttribute('data-bg-tone')).toBe('azulado');
    fireEvent.click(combo);
    expect(screen.getByRole('option', { name: 'Azulado' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    unmount();
    render(
      <FakeDraft initial={{ lightTone: 'cinza' }}>
        <BackgroundTonePicker mode="light" />
      </FakeDraft>,
    );
    expect(trigger('Cinza claro (padrão)')).toBeTruthy();
  });

  it('light: the focus reaching the trigger turns the preview light, storing nothing', () => {
    render(
      <FakeDraft>
        <BackgroundTonePicker mode="light" />
      </FakeDraft>,
    );
    fireEvent.focusIn(trigger('Cinza claro (padrão)'));
    expect(harness.setTheme).toHaveBeenCalledWith('light');
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('dark: its own dropdown of eight, grafite first, swatches from the dark token', () => {
    render(
      <FakeDraft initial={{ darkColors: { primary: '#ffb4a8', secondary: null, tone: null } }}>
        <BackgroundTonePicker mode="dark" />
      </FakeDraft>,
    );
    const combo = trigger('Grafite (padrão)');
    expect(document.querySelector('[data-tone-picker="dark"]')?.contains(combo)).toBe(true);
    expect(hintOf(combo)).toBe(BG.darkBody);
    const own = combo.querySelector('[data-dark-tone]');
    expect(own?.getAttribute('data-dark-tone')).toBe('grafite');
    expect(own?.getAttribute('data-theme')).toBe('dark');
    expect(own?.className).toContain('bg-[var(--dtone-ground)]');
    fireEvent.click(combo);
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.getAttribute('data-tone-option'))).toEqual([
      'grafite',
      'cafe',
      'terracota',
      'vinho',
      'berinjela',
      'azul-noite',
      'petroleo',
      'musgo',
    ]);
    expect(options.map((option) => option.textContent)).toEqual([
      'Grafite (padrão)',
      'Marrom',
      'Terracota',
      'Vinho',
      'Berinjela',
      'Azul-noite',
      'Petróleo',
      'Musgo',
    ]);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-tone-option="grafite"] svg')).not.toBeNull();
    const swatch = document.querySelector('[data-tone-option="cafe"] [data-dark-tone]');
    expect(swatch?.getAttribute('data-dark-tone')).toBe('cafe');
    expect(swatch?.getAttribute('data-theme')).toBe('dark');
    expect(swatch?.className).toContain('bg-[var(--dtone-ground)]');
    expect(document.querySelector('[data-bg-tone]')).toBeNull();

    // A pick keeps the other dark colours and turns the preview dark.
    fireEvent.click(screen.getByRole('option', { name: 'Musgo' }));
    expect(harness.update).toHaveBeenLastCalledWith({
      darkColors: { primary: '#ffb4a8', secondary: null, tone: 'musgo' },
    });
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    const musgo = trigger('Musgo').querySelector('[data-dark-tone]');
    expect(musgo?.getAttribute('data-dark-tone')).toBe('musgo');
    fireEvent.click(trigger('Musgo'));
    fireEvent.click(screen.getByRole('option', { name: 'Grafite (padrão)' }));
    expect(harness.update).toHaveBeenLastCalledWith({
      darkColors: { primary: '#ffb4a8', secondary: null, tone: null },
    });
  });
});

describe('DarkColorsCard', () => {
  const derived = deriveBrandColors(NEUTRAL_BRAND);

  it('opens on the derived colours, automatic, with the grafite ground chosen', () => {
    render(
      <FakeDraft>
        <DarkColorsCard />
      </FakeDraft>,
    );
    expect(input('darkPrimary').value).toBe(derived.primaryDark);
    expect(input('darkSecondary').value).toBe(NEUTRAL_BRAND.secondary);
    // Grouped under the card's name: the two labels repeat the Cores card's pair.
    const pair = screen.getByRole('group', { name: W.brand.dark.title });
    expect(pair.contains(input('darkPrimary'))).toBe(true);
    expect(pair.contains(input('darkSecondary'))).toBe(true);
    expect(screen.getAllByText(W.brand.dark.automatic)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: startsWith(W.brand.dark.reset) })).toBeNull();
    expect(
      screen.getByRole('combobox', { name: `${W.brand.background.title} Grafite (padrão)` }),
    ).toBeTruthy();
    // Saved with the tenant since 2026-10-03: no "preview only" note any more.
    expect(document.body.textContent).not.toMatch(/prévia/);
  });

  it('follows the light pair while automatic', () => {
    render(
      <FakeDraft initial={{ primary: '#7c3aed', secondary: '#f59e0b' }}>
        <DarkColorsCard />
      </FakeDraft>,
    );
    const pair = deriveBrandColors({ primary: '#7c3aed', secondary: '#f59e0b' });
    expect(input('darkPrimary').value).toBe(pair.primaryDark);
    expect(input('darkSecondary').value).toBe('#f59e0b');
  });

  it('stores only a complete hex, lower-cased, and turns the preview dark', () => {
    render(
      <FakeDraft>
        <DarkColorsCard />
      </FakeDraft>,
    );
    const field = input('darkPrimary');
    fireEvent.focusIn(field);
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    fireEvent.change(field, { target: { value: '#ffb' } });
    expect(harness.update).not.toHaveBeenCalled();
    expect(field.value).toBe('#ffb');
    // Leaving the field with a partial hex shows the stored (here the automatic) colour again.
    fireEvent.focusOut(field, { relatedTarget: null });
    expect(field.value).toBe(derived.primaryDark);

    fireEvent.change(field, { target: { value: '#FFB4A8' } });
    expect(harness.update).toHaveBeenLastCalledWith({
      darkColors: { primary: '#ffb4a8', secondary: null, tone: null },
    });
    fireEvent.change(input('darkSecondary'), { target: { value: '#ffd27a' } });
    expect(harness.update).toHaveBeenLastCalledWith({
      darkColors: { primary: '#ffb4a8', secondary: '#ffd27a', tone: null },
    });
  });

  it('"Usar a cor automática" goes back to null and to the derived colour', () => {
    render(
      <FakeDraft
        initial={{ darkColors: { primary: '#ffb4a8', secondary: '#ffd27a', tone: 'cafe' } }}
      >
        <DarkColorsCard />
      </FakeDraft>,
    );
    expect(input('darkPrimary').value).toBe('#ffb4a8');
    // Each reset names its field: the card holds two with the same visible label.
    const resets = screen.getAllByRole('button', { name: startsWith(W.brand.dark.reset) });
    expect(resets.map((button) => button.textContent)).toEqual([
      W.brand.dark.reset,
      W.brand.dark.reset,
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Usar a cor automática: Cor primária' }));
    expect(harness.update).toHaveBeenLastCalledWith({
      darkColors: { primary: null, secondary: '#ffd27a', tone: 'cafe' },
    });
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    expect(input('darkPrimary').value).toBe(derived.primaryDark);
    expect(screen.getAllByRole('button', { name: startsWith(W.brand.dark.reset) })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Usar a cor automática: Cor secundária' }),
    ).toBeTruthy();
  });

  it('measures the dark primary against its ink and against the dark ground', () => {
    render(
      <FakeDraft initial={{ darkColors: { primary: '#ffb4a8', secondary: null, tone: null } }}>
        <DarkColorsCard />
      </FakeDraft>,
    );
    const ink = deriveBrandColors({ primary: '#ffb4a8', secondary: NEUTRAL_BRAND.secondary });
    const onPrimary = document.querySelector('[data-dark-contrast-check="contrastOnPrimary"]');
    const surface = document.querySelector('[data-dark-contrast-check="contrastSurface"]');
    expect(onPrimary?.textContent).toBe(pill(contrastRatio('#ffb4a8', ink.onPrimary), 4.5));
    expect(surface?.textContent).toBe(pill(contrastRatio('#ffb4a8', DARK_BG), 3));
  });

  it('warns on a dark primary that disappears into the dark ground', () => {
    render(
      <FakeDraft initial={{ darkColors: { primary: '#1a1d26', secondary: null, tone: null } }}>
        <DarkColorsCard />
      </FakeDraft>,
    );
    const surface = document.querySelector('[data-dark-contrast-check="contrastSurface"]');
    expect(surface?.textContent).toMatch(/^Baixo /);
  });
});

describe('FontColorFields', () => {
  it('opens every ink on the theme text colour, as "Padrão"', () => {
    render(
      <FakeDraft>
        <FontColorFields />
      </FakeDraft>,
    );
    expect(input('titleColorLight').value).toBe(NAVY);
    expect(input('titleColorDark').value).toBe('#f2f5fa');
    expect(input('appNameColorLight').value).toBe(NAVY);
    expect(input('appNameColorDark').value).toBe('#f2f5fa');
    expect(screen.getAllByText(W.brand.font.colors.default)).toHaveLength(4);
    expect(screen.getByRole('group', { name: W.brand.font.colors.titles })).toBeTruthy();
    expect(screen.getByRole('group', { name: W.brand.font.colors.appName })).toBeTruthy();
  });

  it('stores the light and the dark value apart, and turns the preview to the field theme', () => {
    render(
      <FakeDraft>
        <FontColorFields />
      </FakeDraft>,
    );
    fireEvent.focusIn(input('titleColorDark'));
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    fireEvent.change(input('titleColorDark'), { target: { value: '#FFD27A' } });
    expect(harness.update).toHaveBeenLastCalledWith({
      fontColors: {
        title: { light: null, dark: '#ffd27a' },
        appName: { light: null, dark: null },
      },
    });
    fireEvent.focusIn(input('titleColorLight'));
    expect(harness.setTheme).toHaveBeenLastCalledWith('light');
    fireEvent.change(input('titleColorLight'), { target: { value: '#7c2d12' } });
    expect(harness.update).toHaveBeenLastCalledWith({
      fontColors: {
        title: { light: '#7c2d12', dark: '#ffd27a' },
        appName: { light: null, dark: null },
      },
    });
    fireEvent.change(input('appNameColorLight'), { target: { value: '#0f766e' } });
    expect(harness.update).toHaveBeenLastCalledWith({
      fontColors: {
        title: { light: '#7c2d12', dark: '#ffd27a' },
        appName: { light: '#0f766e', dark: null },
      },
    });
    expect(harness.setTheme).toHaveBeenLastCalledWith('light');
  });

  it('resets one value without moving the other', () => {
    render(
      <FakeDraft
        initial={{
          fontColors: {
            title: { light: '#7c2d12', dark: '#ffd27a' },
            appName: { light: null, dark: null },
          },
        }}
      >
        <FontColorFields />
      </FakeDraft>,
    );
    const titles = screen.getByRole('group', { name: W.brand.font.colors.titles });
    const resets = within(titles).getAllByRole('button', {
      name: startsWith(W.brand.font.colors.reset),
    });
    expect(resets).toHaveLength(2);
    fireEvent.click(
      within(titles).getByRole('button', {
        name: 'Usar a cor padrão: Cor dos títulos, Modo escuro',
      }),
    );
    expect(harness.update).toHaveBeenLastCalledWith({
      fontColors: {
        title: { light: '#7c2d12', dark: null },
        appName: { light: null, dark: null },
      },
    });
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    expect(input('titleColorDark').value).toBe('#f2f5fa');
    expect(input('titleColorLight').value).toBe('#7c2d12');
  });

  it('carries each ink contrast: titles on the ground and the cards, the name on the top bar', () => {
    render(
      <FakeDraft
        initial={{
          fontColors: {
            title: { light: '#9ca3af', dark: null },
            appName: { light: null, dark: '#64718a' },
          },
        }}
      >
        <FontColorFields />
      </FakeDraft>,
    );
    const text = (key: string) =>
      document.querySelector(`[data-font-contrast="${key}"]`)?.textContent;
    // #9ca3af fails both places; the cards' 4.5:1 is the one with the least room, so it is shown.
    expect(contrastRatio('#9ca3af', LIGHT_BG)).toBeLessThan(3);
    expect(text('title-light')).toBe(pill(contrastRatio('#9ca3af', WHITE), 4.5));
    expect(text('title-light')).toMatch(/^Baixo /);
    // The default dark ink: the same ratio on both (no stylesheet here), held to the cards' floor.
    expect(text('title-dark')).toBe(pill(contrastRatio('#f2f5fa', DARK_BG), 4.5));
    expect(text('title-dark')).toMatch(/^AA /);
    expect(text('appName-light')).toBe(pill(contrastRatio(NAVY, WHITE), 4.5));
    expect(text('appName-dark')).toBe(pill(contrastRatio('#64718a', DARK_BG), 4.5));
  });

  it('holds a title ink to 4.5:1 on the cards even when it passes the large titles (3:1)', () => {
    // #e8590c reads on the ground for the 24px titles but not for the 16px names on a white card.
    const onGround = contrastRatio('#e8590c', LIGHT_BG);
    const onCards = contrastRatio('#e8590c', WHITE);
    expect(onGround).toBeGreaterThanOrEqual(3);
    expect(onCards).toBeLessThan(4.5);
    render(
      <FakeDraft
        initial={{
          fontColors: {
            title: { light: '#e8590c', dark: null },
            appName: { light: '#e8590c', dark: null },
          },
        }}
      >
        <FontColorFields />
      </FakeDraft>,
    );
    const text = (key: string) =>
      document.querySelector(`[data-font-contrast="${key}"]`)?.textContent;
    expect(text('title-light')).toBe(pill(onCards, 4.5));
    expect(text('title-light')).toMatch(/^Baixo /);
    expect(text('appName-light')).toBe(pill(onCards, 4.5));
  });

  it('passes a title ink that reads in every place, showing the place with the least room', () => {
    // #4b5563: 7.0:1 on the gray ground (3:1 floor) and 7.6:1 on the white cards (4.5:1 floor).
    render(
      <FakeDraft
        initial={{
          fontColors: {
            title: { light: '#4b5563', dark: null },
            appName: { light: null, dark: null },
          },
        }}
      >
        <FontColorFields />
      </FakeDraft>,
    );
    const shown = document.querySelector('[data-font-contrast="title-light"]')?.textContent;
    expect(shown).toBe(pill(contrastRatio('#4b5563', WHITE), 4.5));
    expect(shown).toMatch(/^AA /);
  });
});

describe('ButtonColorsCard', () => {
  const derived = deriveBrandColors(NEUTRAL_BRAND);
  /** The reference (Reine): a gold button with chocolate text. */
  const GOLD = '#e3af3f';
  const CHOCOLATE = '#382317';
  const DEEP = '#1a237e';
  /** A pale gold, the reference gold's lighter end. */
  const PALE = '#ffd27a';
  type Colors = TenantDraft['buttonColors'];
  /** Button colours with only what is given set, solid unless said otherwise. */
  const buttons = (
    fill: Partial<Colors['fill']> = {},
    ink: Partial<Colors['ink']> = {},
    fillEnd: Partial<Colors['fillEnd']> = {},
    style: Colors['style'] = 'solid',
  ): Colors => ({
    style,
    fill: { light: null, dark: null, ...fill },
    fillEnd: { light: null, dark: null, ...fillEnd },
    ink: { light: null, dark: null, ...ink },
  });
  /** The same, as a gradient. */
  const gradient = (
    fill: Partial<Colors['fill']> = {},
    fillEnd: Partial<Colors['fillEnd']> = {},
    ink: Partial<Colors['ink']> = {},
  ): Colors => buttons(fill, ink, fillEnd, 'gradient');
  /** The card's own copy, the style's and the gradient's keys included. */
  const B = W.brand.buttons as typeof W.brand.buttons & {
    style: string;
    styleSolid: string;
    styleGradient: string;
    gradientBody: string;
    fill: string;
    fillStart: string;
    fillEnd: string;
    ink: string;
  };
  /** White or navy, whichever reads better on the worse of two colours (the gradient's rule). */
  const inkOn = (a: string, b: string) =>
    Math.min(contrastRatio(WHITE, a), contrastRatio(WHITE, b)) >=
    Math.min(contrastRatio(NAVY, a), contrastRatio(NAVY, b))
      ? WHITE
      : NAVY;
  /**
   * A gradient's automatic last colour as the kernel computes it (`buttonRampEnd`): `fill` moved
   * 30% away from `ink`, by default the white or navy that reads on it.
   */
  const rampOf = (fill: string, ink: string = buttonInk(fill)): string => {
    const end = buttonRampEnd(fill, ink);
    if (!end) throw new Error(`no ramp for ${fill} under ${ink}`);
    return end;
  };
  const renderCard = (initial?: Partial<TenantDraft>) =>
    render(
      <FakeDraft initial={initial}>
        <ButtonColorsCard />
      </FakeDraft>,
    );
  /** The quiet label a field shows instead of its reset ("Automática", "Igual ao modo claro"). */
  const fallbackOf = (id: string) =>
    document.querySelector(`[data-preview-color="${id}"] [data-preview-color-fallback]`)
      ?.textContent ?? null;
  /** The quiet label of a gradient's one field, keyed by its first colour's id. */
  const gradientFallbackOf = (id: string) =>
    document.querySelector(`[data-gradient-color="${id}"] [data-preview-color-fallback]`)
      ?.textContent ?? null;
  const contrast = (mode: 'light' | 'dark') =>
    document.querySelector(`[data-button-contrast="${mode}"]`)?.textContent;

  it('opens each mode on what the phone paints while unset, automatic, one group per mode', () => {
    renderCard();
    expect(input('buttonFillLight').value).toBe(NEUTRAL_BRAND.primary);
    expect(input('buttonInkLight').value).toBe(derived.onPrimary);
    expect(input('buttonFillDark').value).toBe(derived.primaryDark);
    expect(input('buttonInkDark').value).toBe(derived.onPrimaryDark);
    expect(screen.getAllByText(W.brand.buttons.automatic)).toHaveLength(4);
    expect(screen.queryByText(W.brand.buttons.inherited)).toBeNull();
    expect(screen.queryByRole('button', { name: startsWith(W.brand.buttons.reset) })).toBeNull();
    const light = screen.getByRole('group', { name: W.brand.buttons.light });
    const dark = screen.getByRole('group', { name: W.brand.buttons.dark });
    expect(light.contains(input('buttonFillLight'))).toBe(true);
    expect(light.contains(input('buttonInkLight'))).toBe(true);
    expect(dark.contains(input('buttonFillDark'))).toBe(true);
    expect(dark.contains(input('buttonInkDark'))).toBe(true);
    expect(document.querySelector('[data-button-colors]')?.textContent).toContain(
      W.brand.buttons.title,
    );
    // Saved with the tenant since 2026-10-03: no "preview only" note any more.
    expect(document.body.textContent).not.toMatch(/prévia/);
  });

  it('follows the primary and the dark mode’s own primary while automatic', () => {
    renderCard({
      primary: '#7c3aed',
      secondary: '#f59e0b',
      darkColors: { primary: '#ffb4a8', secondary: null, tone: null },
    });
    const pair = deriveBrandColors({ primary: '#7c3aed', secondary: '#f59e0b' });
    const darkPair = deriveBrandColors({ primary: '#ffb4a8', secondary: '#f59e0b' });
    expect(input('buttonFillLight').value).toBe('#7c3aed');
    expect(input('buttonInkLight').value).toBe(pair.onPrimary);
    expect(input('buttonFillDark').value).toBe('#ffb4a8');
    expect(input('buttonInkDark').value).toBe(darkPair.onPrimary);
  });

  it('shows the dark mode taking the light button ("Igual ao modo claro") until its own', () => {
    renderCard({ buttonColors: buttons({ light: GOLD }, { light: CHOCOLATE }) });
    expect(input('buttonFillDark').value).toBe(GOLD);
    expect(input('buttonInkDark').value).toBe(CHOCOLATE);
    expect(fallbackOf('buttonFillDark')).toBe(W.brand.buttons.inherited);
    expect(fallbackOf('buttonInkDark')).toBe(W.brand.buttons.inherited);
    // The light ones are the tenant's own: a reset each, no quiet label.
    expect(fallbackOf('buttonFillLight')).toBeNull();
    expect(fallbackOf('buttonInkLight')).toBeNull();
    expect(screen.getAllByRole('button', { name: startsWith(W.brand.buttons.reset) })).toHaveLength(
      2,
    );

    // A dark button of its own: its text goes back to the automatic one for THAT button.
    fireEvent.change(input('buttonFillDark'), { target: { value: '#1A237E' } });
    expect(harness.update).toHaveBeenLastCalledWith({
      buttonColors: buttons({ light: GOLD, dark: DEEP }, { light: CHOCOLATE }),
    });
    expect(input('buttonInkDark').value).toBe(WHITE);
    expect(fallbackOf('buttonInkDark')).toBe(W.brand.buttons.automatic);
  });

  it('inherits the automatic text too when only the light button is set', () => {
    renderCard({ buttonColors: buttons({ light: GOLD }) });
    expect(input('buttonInkLight').value).toBe(NAVY);
    expect(fallbackOf('buttonInkLight')).toBe(W.brand.buttons.automatic);
    expect(input('buttonInkDark').value).toBe(NAVY);
    expect(fallbackOf('buttonInkDark')).toBe(W.brand.buttons.inherited);
  });

  it('turns the preview to the mode of the field in focus, storing nothing', () => {
    renderCard();
    fireEvent.focusIn(input('buttonFillDark'));
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    fireEvent.focusIn(input('buttonInkLight'));
    expect(harness.setTheme).toHaveBeenLastCalledWith('light');
    fireEvent.focusIn(input('buttonInkDark'));
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('never lets a half-typed hex reach the draft, and drops it on leaving the field', () => {
    renderCard();
    const field = input('buttonFillLight');
    fireEvent.change(field, { target: { value: '#e3a' } });
    fireEvent.change(input('buttonInkDark'), { target: { value: '#38' } });
    expect(harness.update).not.toHaveBeenCalled();
    expect(field.value).toBe('#e3a');
    fireEvent.focusOut(field, { relatedTarget: null });
    expect(field.value).toBe(NEUTRAL_BRAND.primary);
  });

  it('stores a complete hex, lower-cased, in its own field only, and turns the preview', () => {
    renderCard();
    fireEvent.change(input('buttonFillDark'), { target: { value: '#FFD27A' } });
    expect(harness.update).toHaveBeenLastCalledWith({ buttonColors: buttons({ dark: '#ffd27a' }) });
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    fireEvent.change(input('buttonInkLight'), { target: { value: '#382317' } });
    expect(harness.update).toHaveBeenLastCalledWith({
      buttonColors: buttons({ dark: '#ffd27a' }, { light: CHOCOLATE }),
    });
    expect(harness.setTheme).toHaveBeenLastCalledWith('light');
    expect(harness.update).toHaveBeenCalledTimes(2);
  });

  it('resets one field by a reset that names the field and the mode', () => {
    renderCard({
      buttonColors: buttons({ light: GOLD, dark: DEEP }, { light: CHOCOLATE, dark: '#fafafa' }),
    });
    const resets = screen.getAllByRole('button', { name: startsWith(W.brand.buttons.reset) });
    expect(resets.map((button) => button.textContent)).toEqual([
      W.brand.buttons.reset,
      W.brand.buttons.reset,
      W.brand.buttons.reset,
      W.brand.buttons.reset,
    ]);
    fireEvent.click(
      screen.getByRole('button', { name: 'Usar a cor automática: Cor do texto, Modo escuro' }),
    );
    expect(harness.update).toHaveBeenLastCalledWith({
      buttonColors: buttons({ light: GOLD, dark: DEEP }, { light: CHOCOLATE }),
    });
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    // The reset is gone with its click: the focus lands on the field's hex, never on <body>.
    expect(document.activeElement).toBe(input('buttonInkDark'));
    // Back to the text that reads on the dark button; the other fields untouched.
    expect(input('buttonInkDark').value).toBe(WHITE);
    expect(fallbackOf('buttonInkDark')).toBe(W.brand.buttons.automatic);
    expect(input('buttonFillDark').value).toBe(DEEP);
    expect(input('buttonInkLight').value).toBe(CHOCOLATE);

    fireEvent.click(
      screen.getByRole('button', { name: 'Usar a cor automática: Cor do botão, Modo claro' }),
    );
    expect(harness.update).toHaveBeenLastCalledWith({
      buttonColors: buttons({ dark: DEEP }, { light: CHOCOLATE }),
    });
    expect(harness.setTheme).toHaveBeenLastCalledWith('light');
    expect(input('buttonFillLight').value).toBe(NEUTRAL_BRAND.primary);
    expect(screen.getAllByRole('button', { name: startsWith(W.brand.buttons.reset) })).toHaveLength(
      2,
    );
  });

  it('measures the text on the button: exactly the pair the phone paints, per mode', () => {
    renderCard({ buttonColors: buttons({ light: GOLD }, { light: CHOCOLATE }) });
    expect(contrast('light')).toBe(pill(contrastRatio(GOLD, CHOCOLATE), 4.5));
    expect(contrast('light')).toMatch(/^AA /);
    // The dark mode paints the same inherited pair, so it reads the same.
    expect(contrast('dark')).toBe(contrast('light'));
    cleanup();

    renderCard();
    expect(contrast('light')).toBe(
      pill(contrastRatio(NEUTRAL_BRAND.primary, derived.onPrimary), 4.5),
    );
    expect(contrast('dark')).toBe(
      pill(contrastRatio(derived.primaryDark, derived.onPrimaryDark), 4.5),
    );
  });

  it('warns on a text that does not read on its button, and only informs', () => {
    // White on the reference gold: 2:1, under the 4.5:1 a 14px bold label needs.
    expect(contrastRatio(GOLD, WHITE)).toBeLessThan(4.5);
    renderCard({ buttonColors: buttons({ light: GOLD }, { light: WHITE }) });
    expect(contrast('light')).toBe(pill(contrastRatio(GOLD, WHITE), 4.5));
    expect(contrast('light')).toMatch(/^Baixo /);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('holds the text on the button to 4.5:1, not the 3:1 of a surface, in the warning tone', () => {
    // Red with its automatic navy text: 4.17:1, a fail for a 14px bold label (a 3:1 floor passes it).
    renderCard({ buttonColors: buttons({ light: '#ef4444' }) });
    expect(input('buttonInkLight').value).toBe(NAVY);
    expect(contrast('light')).toBe('Baixo 4,1:1');
    expect(document.querySelector('[data-button-contrast="light"]')?.className).toContain(
      'text-warning',
    );
    cleanup();
    // Just under the floor, the number never reads as the floor itself (review BTN-CARD-3).
    renderCard({ buttonColors: buttons({ light: '#777777' }, { light: WHITE }) });
    expect(contrast('light')).toBe('Baixo 4,4:1');
    cleanup();
    renderCard({ buttonColors: buttons({ light: GOLD }, { light: CHOCOLATE }) });
    expect(document.querySelector('[data-button-contrast="light"]')?.className).toContain(
      'text-success',
    );
  });

  it('paints each sample inline on its mode’s ground, never through a brand scope', () => {
    renderCard({
      lightTone: 'amarelado',
      darkColors: { primary: null, secondary: null, tone: 'cafe' },
      buttonColors: buttons({ light: GOLD }, { light: CHOCOLATE }),
    });
    const light = document.querySelector('[data-button-sample="light"]') as HTMLElement;
    const dark = document.querySelector('[data-button-sample="dark"]') as HTMLElement;
    expect(light.getAttribute('data-theme')).toBe('light');
    expect(light.getAttribute('data-bg-tone')).toBe('amarelado');
    expect(light.hasAttribute('data-dark-tone')).toBe(false);
    expect(dark.getAttribute('data-theme')).toBe('dark');
    expect(dark.getAttribute('data-dark-tone')).toBe('cafe');
    expect(dark.hasAttribute('data-bg-tone')).toBe(false);

    const sample = light.querySelector('button') as HTMLButtonElement;
    expect(sample.textContent).toBe(NUDGE.action);
    expect(sample.style.backgroundColor).toBe(GOLD);
    expect(sample.style.color).toBe(CHOCOLATE);
    const darkSample = dark.querySelector('button') as HTMLButtonElement;
    expect(darkSample.style.backgroundColor).toBe(GOLD);
    expect(darkSample.style.color).toBe(CHOCOLATE);
    // Inert: out of the tab order and of the accessibility tree.
    expect(sample.tabIndex).toBe(-1);
    expect(screen.queryByRole('button', { name: NUDGE.action })).toBeNull();
    // Never a brand scope (the specs count the BrandPreview frames) nor a second device screen.
    expect(document.querySelector('[data-brand-scope], [data-device-screen]')).toBeNull();
  });

  it('leaves the default tones off the samples', () => {
    renderCard({
      lightTone: 'cinza',
      darkColors: { primary: null, secondary: null, tone: 'grafite' },
    });
    expect(
      document.querySelector('[data-button-sample="light"]')?.hasAttribute('data-bg-tone'),
    ).toBe(false);
    expect(
      document.querySelector('[data-button-sample="dark"]')?.hasAttribute('data-dark-tone'),
    ).toBe(false);
    const sample = document.querySelector('[data-button-sample="dark"] button') as HTMLElement;
    expect(sample.style.backgroundColor).toBe(derived.primaryDark);
    expect(sample.style.color).toBe(derived.onPrimaryDark);
  });

  it('asks the style first, one for both modes: solid by default, the gradient on a click', () => {
    renderCard();
    const card = document.querySelector('[data-button-colors]') as HTMLElement;
    const group = screen.getByRole('group', { name: B.style });
    const solid = within(group).getByRole('button', { name: B.styleSolid });
    const gradientOption = within(group).getByRole('button', { name: B.styleGradient });
    expect(solid.getAttribute('aria-pressed')).toBe('true');
    expect(gradientOption.getAttribute('aria-pressed')).toBe('false');
    expect(card.getAttribute('data-button-style')).toBe('solid');
    // Above the modes' columns.
    const light = screen.getByRole('group', { name: B.light });
    expect(group.compareDocumentPosition(light) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById('buttonFillEndLight')).toBeNull();
    expect(screen.queryByText(B.gradientBody)).toBeNull();
    // A solid sample paints no image at all, whatever the button's classes would.
    const sample = document.querySelector('[data-button-sample="light"] button') as HTMLElement;
    expect(sample.style.backgroundImage).toBe('none');

    fireEvent.click(gradientOption);
    expect(harness.update).toHaveBeenLastCalledWith({ buttonColors: gradient() });
    // The style is both modes': the preview keeps the theme it shows.
    expect(harness.setTheme).not.toHaveBeenCalled();
    expect(card.getAttribute('data-button-style')).toBe('gradient');
    expect(gradientOption.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(B.gradientBody)).toBeTruthy();
    // The style it already has changes nothing.
    fireEvent.click(gradientOption);
    expect(harness.update).toHaveBeenCalledTimes(1);
  });

  it('names a gradient’s colours per mode, opening on the automatic gradient', () => {
    renderCard({ buttonColors: gradient() });
    // Each mode's accent, ending on that accent moved away from the text that reads on it.
    const accent = { light: NEUTRAL_BRAND.primary, dark: derived.primaryDark } as const;
    for (const mode of ['light', 'dark'] as const) {
      const group = screen.getByRole('group', { name: B[mode] });
      const suffix = mode === 'light' ? 'Light' : 'Dark';
      const modeName = mode === 'light' ? 'claro' : 'escuro';
      // ONE field, "Cor do botão", holding both colours, each hex named for its colour and mode.
      expect(within(group).getByRole('group', { name: B.fill })).toBeTruthy();
      expect(within(group).getByLabelText(`${B.fillStart}, ${B[mode]}`)).toBe(
        input(`buttonFill${suffix}`),
      );
      expect(within(group).getByLabelText(`${B.fillEnd}, ${B[mode]}`)).toBe(
        input(`buttonFillEnd${suffix}`),
      );
      expect(within(group).getByLabelText(B.ink)).toBe(input(`buttonInk${suffix}`));
      // Each picker says which colour and which mode.
      expect(
        within(group).getByLabelText(`Escolher a cor inicial do botão no modo ${modeName}`),
      ).toBeTruthy();
      expect(
        within(group).getByLabelText(`Escolher a cor final do botão no modo ${modeName}`),
      ).toBeTruthy();
      const start = accent[mode];
      const end = rampOf(start);
      expect(input(`buttonFill${suffix}`).value).toBe(start);
      expect(input(`buttonFillEnd${suffix}`).value).toBe(end);
      // Never the secondary, which no single text read on together with the primary.
      expect(end).not.toBe(NEUTRAL_BRAND.secondary);
      // The automatic text reads on both colours: the very text of the solid button.
      expect(input(`buttonInk${suffix}`).value).toBe(inkOn(start, end));
      expect(input(`buttonInk${suffix}`).value).toBe(buttonInk(start));
    }
    // One quiet label per field: the gradient's and the text's, in each mode.
    expect(screen.getAllByText(B.automatic)).toHaveLength(4);
    expect(screen.queryByText(B.inherited)).toBeNull();
    // The swatch's two halves, each its own colour alone: the first left, the last right.
    const halves = {
      start: NEUTRAL_BRAND.primary,
      end: rampOf(NEUTRAL_BRAND.primary),
    };
    for (const [stop, colour] of Object.entries(halves)) {
      const half = document.querySelector(
        `[data-gradient-color="buttonFillLight"] [data-gradient-stop="${stop}"]`,
      ) as HTMLElement;
      expect(half.style.backgroundColor, stop).toBe(colour);
      expect(half.style.backgroundImage, stop).toBe('');
    }
  });

  it('shows the dark mode taking each light colour, and the text with the very same gradient', () => {
    renderCard({ buttonColors: gradient({ light: GOLD }, { light: PALE }, { light: CHOCOLATE }) });
    expect(input('buttonFillDark').value).toBe(GOLD);
    expect(input('buttonFillEndDark').value).toBe(PALE);
    expect(input('buttonInkDark').value).toBe(CHOCOLATE);
    expect(gradientFallbackOf('buttonFillDark')).toBe(B.inherited);
    expect(fallbackOf('buttonInkDark')).toBe(B.inherited);

    // A last colour of its own: the field has a colour of its own (a reset, no quiet label), and
    // the text goes automatic.
    fireEvent.change(input('buttonFillEndDark'), { target: { value: '#1A237E' } });
    expect(harness.update).toHaveBeenLastCalledWith({
      buttonColors: gradient({ light: GOLD }, { light: PALE, dark: DEEP }, { light: CHOCOLATE }),
    });
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    expect(gradientFallbackOf('buttonFillDark')).toBeNull();
    expect(fallbackOf('buttonInkDark')).toBe(B.automatic);
    expect(input('buttonInkDark').value).toBe(inkOn(GOLD, DEEP));
    cleanup();

    // The light first colour alone: the dark mode takes the whole light gradient, its automatic
    // last colour (the gold's ramp) and its text included, and says so.
    renderCard({ buttonColors: gradient({ light: GOLD }) });
    expect(input('buttonFillEndLight').value).toBe(rampOf(GOLD));
    expect(gradientFallbackOf('buttonFillLight')).toBeNull();
    expect(input('buttonFillDark').value).toBe(GOLD);
    expect(input('buttonFillEndDark').value).toBe(rampOf(GOLD));
    expect(input('buttonInkDark').value).toBe(buttonInk(GOLD));
    expect(gradientFallbackOf('buttonFillDark')).toBe(B.inherited);
    expect(fallbackOf('buttonInkDark')).toBe(B.inherited);
  });

  it('never says "Igual ao modo claro" beside a last colour the light mode does not show', () => {
    // A dark text of its own on the other side of the inherited gold turns the automatic last
    // colour the other way: deeper under white, where the light one brightens under chocolate.
    renderCard({ buttonColors: gradient({ light: GOLD }, {}, { light: CHOCOLATE, dark: WHITE }) });
    expect(input('buttonFillEndLight').value).toBe(rampOf(GOLD, CHOCOLATE));
    expect(input('buttonFillEndDark').value).toBe(rampOf(GOLD, WHITE));
    expect(input('buttonFillEndDark').value).not.toBe(input('buttonFillEndLight').value);
    // Not the light gradient any more, so the field says "Automática", never the light one's; the
    // text is its own (a reset, no quiet label).
    expect(gradientFallbackOf('buttonFillDark')).toBe(B.automatic);
    expect(fallbackOf('buttonInkDark')).toBeNull();
    cleanup();

    // A dark text on the same side keeps the very colours of the light gradient, and says so.
    renderCard({ buttonColors: gradient({ light: GOLD }, {}, { dark: CHOCOLATE }) });
    expect(input('buttonFillEndDark').value).toBe(input('buttonFillEndLight').value);
    expect(gradientFallbackOf('buttonFillDark')).toBe(B.inherited);
  });

  it('paints each sample with the very gradient the phone gets, the text on it', () => {
    renderCard({
      buttonColors: gradient(
        { light: GOLD, dark: DEEP },
        { light: PALE, dark: GOLD },
        { light: CHOCOLATE },
      ),
    });
    const light = document.querySelector('[data-button-sample="light"] button') as HTMLElement;
    const dark = document.querySelector('[data-button-sample="dark"] button') as HTMLElement;
    expect(light.style.backgroundColor).toBe(GOLD);
    expect(light.style.backgroundImage).toBe(`linear-gradient(135deg, ${GOLD}, ${PALE})`);
    expect(light.style.color).toBe(CHOCOLATE);
    expect(dark.style.backgroundColor).toBe(DEEP);
    expect(dark.style.backgroundImage).toBe(`linear-gradient(135deg, ${DEEP}, ${GOLD})`);
    expect(dark.style.color).toBe(inkOn(DEEP, GOLD));
    // Still never a brand scope nor a second device screen.
    expect(document.querySelector('[data-brand-scope], [data-device-screen]')).toBeNull();
  });

  it('measures the text where it reads worst on the gradient', () => {
    // White reads on the deep end (13:1) but barely on the gold one (2:1): the pill says the worse.
    const worst = Math.min(contrastRatio(GOLD, WHITE), contrastRatio(DEEP, WHITE));
    renderCard({ buttonColors: gradient({ light: GOLD }, { light: DEEP }, { light: WHITE }) });
    expect(contrast('light')).toBe(pill(worst, 4.5));
    expect(contrast('light')).toMatch(/^Baixo /);
    cleanup();

    // The same two colours the other way round: the worst point is now the LAST colour, which a
    // pill measuring the first colour alone would never see (it would read 13:1 and pass).
    expect(contrastRatio(DEEP, WHITE)).toBeGreaterThanOrEqual(4.5);
    renderCard({ buttonColors: gradient({ light: DEEP }, { light: GOLD }, { light: WHITE }) });
    expect(contrast('light')).toBe(pill(worst, 4.5));
    expect(contrast('light')).toMatch(/^Baixo /);
    // The dark mode takes that whole gradient, so it warns the same.
    expect(contrast('dark')).toBe(contrast('light'));
    cleanup();

    // The automatic gradient of the neutral pair, with its automatic text: on each mode, exactly
    // the solid button's pill, since its last colour only moves away from the text.
    renderCard();
    const solid = { light: contrast('light'), dark: contrast('dark') };
    cleanup();
    renderCard({ buttonColors: gradient() });
    for (const mode of ['light', 'dark'] as const) {
      expect(contrast(mode), mode).toBe(solid[mode]);
    }
    const start = NEUTRAL_BRAND.primary;
    const ink = buttonInk(start);
    expect(contrast('light')).toBe(
      pill(Math.min(contrastRatio(start, ink), contrastRatio(rampOf(start, ink), ink)), 4.5),
    );
    // Where the primary to the secondary read 3.2:1 at worst, the untouched gradient passes.
    expect(contrast('light')).toMatch(/^AA /);
  });

  it('keeps a gradient’s last colours aside while solid, and brings them back', () => {
    renderCard({ buttonColors: gradient({ light: GOLD }, { light: PALE }) });
    fireEvent.click(screen.getByRole('button', { name: B.styleSolid }));
    expect(harness.update).toHaveBeenLastCalledWith({
      buttonColors: buttons({ light: GOLD }, {}, { light: PALE }),
    });
    expect(document.getElementById('buttonFillEndLight')).toBeNull();
    // Solid: the button's one colour again, and a sample without an image.
    const light = screen.getByRole('group', { name: B.light });
    expect(within(light).getByLabelText(B.fill)).toBe(input('buttonFillLight'));
    const sample = document.querySelector('[data-button-sample="light"] button') as HTMLElement;
    expect(sample.style.backgroundImage).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: B.styleGradient }));
    expect(input('buttonFillEndLight').value).toBe(PALE);
    expect(harness.setTheme).not.toHaveBeenCalled();
  });

  it('resets a gradient’s two colours by one reset that names the field and the mode', () => {
    renderCard({ buttonColors: gradient({ light: GOLD }, { light: PALE }) });
    fireEvent.click(
      screen.getByRole('button', { name: 'Usar a cor automática: Cor do botão, Modo claro' }),
    );
    // Both colours of that mode go back to automatic at once.
    expect(harness.update).toHaveBeenLastCalledWith({ buttonColors: gradient() });
    expect(harness.setTheme).toHaveBeenLastCalledWith('light');
    expect(input('buttonFillLight').value).toBe(NEUTRAL_BRAND.primary);
    expect(input('buttonFillEndLight').value).toBe(rampOf(NEUTRAL_BRAND.primary));
    expect(gradientFallbackOf('buttonFillLight')).toBe(B.automatic);
    // The focus lands on the field's first colour, never on <body>.
    expect(document.activeElement).toBe(input('buttonFillLight'));
  });

  it('never lets a half-typed last colour reach the draft', () => {
    renderCard({ buttonColors: gradient() });
    const field = input('buttonFillEndDark');
    fireEvent.focusIn(field);
    expect(harness.setTheme).toHaveBeenLastCalledWith('dark');
    fireEvent.change(field, { target: { value: '#ffd2' } });
    expect(harness.update).not.toHaveBeenCalled();
    fireEvent.focusOut(field, { relatedTarget: null });
    // Back to the automatic last colour: the dark accent's ramp.
    expect(field.value).toBe(rampOf(derived.primaryDark));
  });
});
