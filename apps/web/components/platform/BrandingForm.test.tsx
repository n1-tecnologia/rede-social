// @vitest-environment happy-dom
import {
  type BrandLook,
  contrastReport,
  deriveBrandColors,
  emptyBrandLook,
} from '@rede-social/contracts/branding';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookFieldsOf } from '@/lib/bg-tone';
import type { BrandingView } from '@/lib/branding-view';
import { BrandLookContext, type BrandLookValue } from './wizard/brand-look-context';

/**
 * 08-02 (WINDOWS #71) — the Marca form keeps what the user typed across a server refresh.
 *
 * The page used to key `BrandingForm` on the whole view, so the poll's `router.refresh()` (icons
 * ready) remounted it and dropped a colour typed while that refresh was in flight; "Salvar
 * alterações" came back disabled (the 07-15 desktop red). The page now keys on the tenant only and
 * the form adopts a new `view` prop in place. A re-render with a new `view` is exactly what the
 * refresh does now, so these cases render the form, change the prop and read the result.
 *
 * The catalogs are the REAL `platform.json` and `platformBranding.json` (the ReactivateCommunity
 * pattern). Stubbed: the router, the toast and the two server actions. No upload actions are passed,
 * so the assets card stays out of the way.
 *
 * Claims:
 *  1. A colour typed before a refresh that flips `iconsReady` (and brings the logo and a new icon
 *     version) stays in the field, and "Salvar alterações" stays enabled.
 *  2. Untouched colours follow a refreshed view whose colours changed (another save won).
 *  3. A half-typed, still invalid hex is never overwritten by a refresh.
 *  4. A refresh older than the view on screen (a lower `iconVersion`) is dropped.
 */

const { catalogs, toast } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalogs: {
      platform: read('platform').platform as { new: { primary: string } },
      platformBranding: read('platformBranding').platformBranding as {
        colors: { save: string };
        look: { readOnly: string };
      },
    },
    toast: { show: vi.fn(), dismiss: vi.fn() },
  };
});

const lookup = (ns: string, key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown>)?.[part],
      (catalogs as Record<string, unknown>)[ns],
    );
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) =>
    lookup(ns, key, values),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { BrandingForm } = await import('./BrandingForm');

const TENANT = '33333333-3333-4333-8333-333333333371';
const PRIMARY_1 = '#b91c1c';
const SECONDARY_1 = '#f87171';
const PRIMARY_2 = '#0e7490';
const SAVE = catalogs.platformBranding.colors.save;
const PRIMARY_LABEL = catalogs.platform.new.primary;

/** A view; `pair` is the persisted source colours (the derived ones follow, as on the server). */
type ViewOver = Omit<Partial<BrandingView>, 'colors'> & {
  pair?: { primary: string; secondary: string };
};

function makeView({ pair, ...over }: ViewOver = {}): BrandingView {
  const colors = deriveBrandColors(pair ?? { primary: PRIMARY_1, secondary: SECONDARY_1 });
  return {
    displayName: 'Smoke 71',
    logoUrl: null,
    iconUrl: null,
    faviconUrl: null,
    iconUrls: null,
    iconVersion: 0,
    iconsReady: false,
    hasSource: false,
    contrast: contrastReport(colors),
    look: emptyBrandLook(),
    ...over,
    colors,
  };
}

/** The view the poll's refresh brings once the worker derived the icons of the uploaded logo. */
const iconsReadyView = (over: ViewOver = {}) =>
  makeView({
    logoUrl: 'http://127.0.0.1:54321/storage/v1/object/public/branding/t/branding/logo.svg',
    hasSource: true,
    iconVersion: 1,
    iconsReady: true,
    ...over,
  });

const actions = {
  saveColors: vi.fn(),
  status: vi.fn(),
} as unknown as Parameters<typeof BrandingForm>[0]['actions'];

const previewLabels = {
  light: 'Claro',
  dark: 'Escuro',
  lightAria: 'Prévia clara',
  darkAria: 'Prévia escura',
  login: 'Entrar',
};

function mount(view: BrandingView) {
  const ui = (next: BrandingView) => (
    <BrandingForm
      key={TENANT}
      tenantId={TENANT}
      view={next}
      previewLabels={previewLabels}
      actions={actions}
    />
  );
  const result = render(ui(view));
  return { refresh: (next: BrandingView) => result.rerender(ui(next)) };
}

const primaryField = () => screen.getByLabelText(PRIMARY_LABEL) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: SAVE }) as HTMLButtonElement;

afterEach(cleanup);

describe('BrandingForm adopts a refreshed view in place (WINDOWS #71)', () => {
  it('keeps a colour typed before the icons-ready refresh, and Salvar stays enabled', () => {
    const { refresh } = mount(makeView({ hasSource: true, logoUrl: 'logo-v0' }));
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(primaryField(), { target: { value: PRIMARY_2 } });
    expect(saveButton().disabled).toBe(false);

    refresh(iconsReadyView());

    expect(primaryField().value).toBe(PRIMARY_2);
    expect(saveButton().disabled).toBe(false);
    // The refresh itself was adopted: the app-icons card reads "ready".
    expect(document.querySelector('[data-icons-status="ready"]')).not.toBeNull();
  });

  it('follows the server colours when the user has not touched them', () => {
    const { refresh } = mount(makeView());
    refresh(iconsReadyView({ pair: { primary: PRIMARY_2, secondary: SECONDARY_1 } }));

    expect(primaryField().value).toBe(PRIMARY_2);
    expect(saveButton().disabled).toBe(true);
  });

  it('never overwrites a half-typed, still invalid hex', () => {
    const { refresh } = mount(makeView());
    fireEvent.change(primaryField(), { target: { value: '#0e7' } });

    refresh(iconsReadyView({ pair: { primary: PRIMARY_2, secondary: SECONDARY_1 } }));

    expect(primaryField().value).toBe('#0e7');
  });

  it('drops a refresh older than the view on screen', () => {
    const { refresh } = mount(iconsReadyView({ iconVersion: 2 }));
    refresh(makeView({ iconVersion: 1, pair: { primary: PRIMARY_2, secondary: SECONDARY_1 } }));

    expect(primaryField().value).toBe(PRIMARY_1);
    expect(document.querySelector('[data-icons-status="ready"]')).not.toBeNull();
  });
});

/**
 * 2026-10-09 — the tenant lane's Marca "atualizada conforme o tenant": with no look editor above
 * the form (its API has no route to save a look), the two frames paint the look as it is SAVED, and
 * a read-only line says who sets it; a tenant without a look renders the frames as before, and with
 * the editor above (the platform tab) the frames follow the look being edited, with no such line.
 */
describe('BrandingForm shows the saved look without a look editor', () => {
  const SAVED_LOOK: BrandLook = {
    ...emptyBrandLook(),
    lightTone: 'amarelado',
    darkTone: 'cafe',
    darkColors: { primary: '#ffb4a8', secondary: null },
    buttonColors: {
      style: 'solid',
      fill: { light: '#e3af3f', dark: null },
      fillEnd: { light: null, dark: null },
      ink: { light: '#382317', dark: null },
    },
  };
  const frame = (theme: 'light' | 'dark') =>
    document.querySelector(`[data-brand-scope][data-theme="${theme}"]`) as HTMLElement;
  const readOnly = () => screen.queryByText(catalogs.platformBranding.look.readOnly);

  it('paints the saved ground, dark mode and buttons, and says the platform team sets them', () => {
    mount(makeView({ look: SAVED_LOOK }));

    expect(frame('light').getAttribute('data-bg-tone')).toBe('amarelado');
    expect(frame('dark').getAttribute('data-dark-tone')).toBe('cafe');
    expect(frame('dark').style.getPropertyValue('--brand-primary-dark')).toBe('#ffb4a8');
    expect(frame('light').style.getPropertyValue('--button-fill-light')).toBe('#e3af3f');
    expect(frame('light').style.getPropertyValue('--button-ink-light')).toBe('#382317');
    // The dark mode's button inherits the light one, as in the app (`resolveButtonPairs`).
    expect(frame('dark').style.getPropertyValue('--button-fill-dark')).toBe('#e3af3f');
    expect(readOnly()).not.toBeNull();
  });

  it('a tenant without a look renders the frames as before', () => {
    mount(makeView());

    expect(frame('light').hasAttribute('data-bg-tone')).toBe(false);
    expect(frame('dark').hasAttribute('data-dark-tone')).toBe(false);
    for (const theme of ['light', 'dark'] as const) {
      expect(frame(theme).getAttribute('style') ?? '').not.toContain('--button-');
    }
    expect(frame('dark').style.getPropertyValue('--brand-primary-dark')).toBe(
      deriveBrandColors({ primary: PRIMARY_1, secondary: SECONDARY_1 }).primaryDark,
    );
    expect(readOnly()).not.toBeNull();
  });

  it('with the look editor above, the frames follow the look being edited and the line is gone', () => {
    const edited = lookFieldsOf({ ...emptyBrandLook(), lightTone: 'lilas', darkTone: 'vinho' });
    const value: BrandLookValue = {
      draft: { ...edited, displayName: 'Smoke 71' },
      colors: { primary: PRIMARY_1, secondary: SECONDARY_1 },
      previewColors: {
        darkColors: edited.darkColors,
        fontColors: edited.fontColors,
        buttonColors: edited.buttonColors,
      },
      logo: null,
      update: vi.fn(),
    };
    render(
      <BrandLookContext.Provider value={value}>
        <BrandingForm
          tenantId={TENANT}
          view={makeView({ look: SAVED_LOOK })}
          previewLabels={previewLabels}
          actions={actions}
        />
      </BrandLookContext.Provider>,
    );

    expect(frame('light').getAttribute('data-bg-tone')).toBe('lilas');
    expect(frame('dark').getAttribute('data-dark-tone')).toBe('vinho');
    expect(frame('light').getAttribute('style') ?? '').not.toContain('--button-');
    expect(readOnly()).toBeNull();
  });
});
