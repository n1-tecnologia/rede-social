// @vitest-environment happy-dom
import type { PlatformTenantDetail } from '@rede-social/contracts';
import { emptyBrandLook } from '@rede-social/contracts/branding';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveBrandLookResult } from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
import { type BrandingView, toBrandingView } from '@/lib/branding-view';

/**
 * The Marca tab's look editor (2026-10-03): the wizard's own cards, fed by `BrandLookProvider` with
 * the SAVED look, and ONE save for the whole look. The catalog is the REAL pt-BR one through
 * next-intl's own translator (a missing key throws); the save action is a spy; the font list never
 * loads (it is not under test).
 *
 * Claims:
 *  1. The cards open on the saved look (the light tone, the dark primary), and nothing is dirty.
 *  2. An edit makes the look dirty ("Salvar aparência" on, the unsaved line, "Descartar
 *     alterações"); discarding goes back to the saved look.
 *  3. Saving sends the WHOLE look in the contract's shape (`lookBodyOf`) for this tenant, confirms
 *     it and is clean again; a refusal says so and keeps the edit.
 *  4. Wrapped around the colours form, the editor's look reaches its two frames (and only two: the
 *     look's cards add no brand scope of their own).
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
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

MotionGlobalConfig.skipAnimations = true;

const { BrandLookForm, BrandLookProvider } = await import('./BrandLookEditor');
const { BrandingForm } = await import('./BrandingForm');

type LookCopy = {
  save: string;
  discard: string;
  unsaved: string;
  hint: string;
  lightTitle: string;
  errors: { invalid: string };
};
const B = harness.messages.platformBranding as unknown as {
  look: LookCopy;
  toasts: { saved: string };
};
const L = B.look;
const TONE_LABEL = (
  harness.messages.platform as unknown as { wizard: { brand: { background: { title: string } } } }
).wizard.brand.background.title;

const TENANT = '6f2c5b1e-4d3a-4c2b-9e8f-1a2b3c4d5e6f';

/** A Marca view of the tenant with a stored look (any part of it, as the jsonb may hold it). */
function viewWith(look: Record<string, unknown> = {}): BrandingView {
  return toBrandingView({
    tenant: {
      id: TENANT,
      slug: 'clube',
      displayName: 'Clube Aurora',
      status: 'active',
      timezone: 'America/Sao_Paulo',
      createdAt: '2026-10-03T00:00:00.000Z',
      branding: { colors: { primary: '#7c3aed', secondary: '#a78bfa' }, look },
      contrast: {
        onPrimary: { ratio: 5.7, ok: true },
        lightSurface: { ratio: 5.4, ok: true },
        darkSurface: { ratio: 4.2, ok: true },
      },
    },
    modules: [],
    domains: [],
    invites: [],
    admins: [],
  } as unknown as PlatformTenantDetail);
}

const save = vi.fn<(tenantId: string, look: unknown) => Promise<SaveBrandLookResult>>();

function renderEditor(view: BrandingView, extra?: ReactNode) {
  return render(
    <ToastProvider>
      <BrandLookProvider tenantId={TENANT} view={view} save={save as never}>
        {extra ?? <BrandLookForm />}
      </BrandLookProvider>
    </ToastProvider>,
  );
}

const saveButton = () => screen.getByRole('button', { name: L.save });
const input = (id: string) => document.getElementById(id) as HTMLInputElement;

beforeEach(() => {
  save.mockReset();
});
afterEach(cleanup);

describe('the Marca tab’s look editor', () => {
  it('opens on the saved look, with nothing to save', () => {
    renderEditor(viewWith({ lightTone: 'lilas', darkColors: { primary: '#ffb4a8' } }));
    expect(screen.getByText(L.lightTitle)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: `${TONE_LABEL} Lilás` })).toBeTruthy();
    expect(input('darkPrimary').value).toBe('#ffb4a8');
    expect(document.querySelector('[data-button-colors]')).not.toBeNull();
    expect(document.querySelector('[data-title-font-picker]')).not.toBeNull();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: L.discard })).toBeNull();
    expect(screen.getByText(L.hint)).toBeTruthy();
  });

  it('turns dirty on an edit, and "Descartar alterações" goes back to the saved look', () => {
    renderEditor(viewWith({ darkColors: { primary: '#ffb4a8' } }));
    fireEvent.change(input('darkPrimary'), { target: { value: '#1A237E' } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(L.unsaved)).toBeTruthy();
    // Reaching the button leaves the field, as the pointer does in the browser.
    fireEvent.focusOut(input('darkPrimary'), { relatedTarget: null });
    fireEvent.click(screen.getByRole('button', { name: L.discard }));
    expect(input('darkPrimary').value).toBe('#ffb4a8');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the whole look for this tenant, then is clean again', async () => {
    const saved = { ...emptyBrandLook(), darkColors: { primary: '#1a237e', secondary: null } };
    save.mockResolvedValue({ ok: true, view: viewWith(saved) });
    renderEditor(viewWith());
    fireEvent.change(input('darkPrimary'), { target: { value: '#1A237E' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(TENANT, saved);
    expect(await screen.findByText(B.toasts.saved)).toBeTruthy();
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(true));
  });

  it('says so when the look is refused, keeping the edit', async () => {
    save.mockResolvedValue({ ok: false, code: 'invalid' });
    renderEditor(viewWith());
    fireEvent.change(input('darkPrimary'), { target: { value: '#1a237e' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(await screen.findByText(L.errors.invalid)).toBeTruthy();
    expect(input('darkPrimary').value).toBe('#1a237e');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('paints the look on the colours card’s two frames, and only there', () => {
    const view = viewWith({ lightTone: 'amarelado', darkTone: 'cafe' });
    renderEditor(
      view,
      <BrandingForm
        tenantId={TENANT}
        view={view}
        previewLabels={{
          light: 'Claro',
          dark: 'Escuro',
          lightAria: 'Prévia clara',
          darkAria: 'Prévia escura',
          login: 'Entrar',
        }}
        actions={{ saveColors: vi.fn(), status: vi.fn() } as never}
        lookSlot={<BrandLookForm />}
      />,
    );
    const frames = document.querySelectorAll('[data-brand-scope]');
    expect(frames).toHaveLength(2);
    const light = document.querySelector('[data-brand-scope][data-theme="light"]');
    const dark = document.querySelector('[data-brand-scope][data-theme="dark"]');
    expect(light?.getAttribute('data-bg-tone')).toBe('amarelado');
    expect(dark?.getAttribute('data-dark-tone')).toBe('cafe');
    // The pair keeps its own save, apart from the look's.
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeTruthy();
    expect(saveButton()).toBeTruthy();
  });
});
