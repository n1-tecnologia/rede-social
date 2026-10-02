// @vitest-environment happy-dom
import { contrastReport, deriveBrandColors } from '@rede-social/contracts/branding';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrandingView } from '@/lib/branding-view';

/**
 * 08-06 (ADMIN-01, UI-D-279, E11) — the Marca name card. The catalog is the REAL `admin.json` (the
 * BrandingForm.test pattern); the router, the toast and the server action are stubbed.
 *
 * Claims: the button is disabled until the trimmed value differs and is valid; empty and spaces-only
 * show "Informe o nome da comunidade." and never save; the pending label; success toasts "Nome salvo."
 * and refreshes; a failure toasts and keeps the typed value; a server field error shows under the
 * input; a lost permission toasts it and refreshes (UI-D-284).
 */

const { admin, toast, router } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const catalog = JSON.parse(
    readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'admin.json'), 'utf8'),
  );
  return {
    admin: catalog.admin as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    router: { push: vi.fn(), refresh: vi.fn() },
  };
});

const lookup = (ns: string, key: string) => {
  const path = [...ns.split('.').slice(1), ...key.split('.')];
  const raw = path.reduce<unknown>(
    (node, part) => (node as Record<string, unknown>)?.[part],
    admin,
  );
  return String(raw ?? key);
};

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => lookup(ns, key),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { DisplayNameCard } = await import('./DisplayNameCard');

const SAVE = 'Salvar nome';
const REQUIRED = 'Informe o nome da comunidade.';

function view(displayName: string): BrandingView {
  const colors = deriveBrandColors({ primary: '#7c3aed', secondary: '#a78bfa' });
  return {
    displayName,
    logoUrl: null,
    iconUrl: null,
    faviconUrl: null,
    iconUrls: null,
    iconVersion: 0,
    iconsReady: false,
    hasSource: false,
    colors,
    contrast: contrastReport(colors),
  };
}

function setup(action = vi.fn()) {
  render(<DisplayNameCard initialName="Rede Demo" action={action} />);
  const input = screen.getByLabelText('Nome de exibição') as HTMLInputElement;
  const button = () => screen.getByRole('button', { name: /Salvar nome|Salvando…/ });
  return { input, button, action };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DisplayNameCard (E11)', () => {
  it('shows the saved name; disabled until the trimmed value differs; maxLength 60', () => {
    const { input, button } = setup();
    expect(input.value).toBe('Rede Demo');
    expect(input.maxLength).toBe(60);
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '  Rede Demo  ' } });
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'Rede Demo Ação' } });
    expect((button() as HTMLButtonElement).disabled).toBe(false);
  });

  it('empty and spaces-only show the required error and never save', () => {
    const { input, button, action } = setup();
    for (const value of ['', '    ']) {
      fireEvent.change(input, { target: { value } });
      expect(screen.getByRole('alert').textContent).toContain(REQUIRED);
      expect((button() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.submit(input.closest('form') as HTMLFormElement);
    }
    expect(action).not.toHaveBeenCalled();
  });

  it('pending reads "Salvando…"; success toasts "Nome salvo." and refreshes', async () => {
    let resolve: (value: unknown) => void = () => {};
    const action = vi.fn(() => new Promise((r) => (resolve = r)));
    const { input, button } = setup(action);
    fireEvent.change(input, { target: { value: '  Comunidade Nova 🎉 ' } });
    fireEvent.click(button());
    expect(action).toHaveBeenCalledWith('Comunidade Nova 🎉');
    expect(
      ((await screen.findByRole('button', { name: 'Salvando…' })) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => resolve({ ok: true, view: view('Comunidade Nova 🎉') }));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Nome salvo.' });
    expect(router.refresh).toHaveBeenCalled();
    expect(input.value).toBe('Comunidade Nova 🎉');
    expect((screen.getByRole('button', { name: SAVE }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a failure toasts and keeps the typed value', async () => {
    const action = vi.fn(async () => ({ ok: false, code: 'failed' }));
    const { input, button } = setup(action);
    fireEvent.change(input, { target: { value: 'Outro nome' } });
    await act(async () => fireEvent.click(button()));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar o nome. Tente novamente.',
    });
    expect(input.value).toBe('Outro nome');
    expect((button() as HTMLButtonElement).disabled).toBe(false);
  });

  it('a server field error shows under the input', async () => {
    const action = vi.fn(async () => ({ ok: false, code: 'tooLong' }));
    const { input, button } = setup(action);
    fireEvent.change(input, { target: { value: 'Outro nome' } });
    await act(async () => fireEvent.click(button()));
    expect(screen.getByRole('alert').textContent).toContain('Use até 60 caracteres.');
  });

  it('a lost permission toasts it and refreshes into notFound (UI-D-284)', async () => {
    const action = vi.fn(async () => ({ ok: false, code: 'forbidden' }));
    const { input, button } = setup(action);
    fireEvent.change(input, { target: { value: 'Outro nome' } });
    await act(async () => fireEvent.click(button()));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Você não tem mais permissão para esta ação.',
    });
    expect(router.refresh).toHaveBeenCalled();
  });
});
