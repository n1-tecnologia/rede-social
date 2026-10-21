// @vitest-environment happy-dom
import type { AccessItem } from '@rede-social/contracts/payments';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-14 — the "Liberar e-mail" sheet (UI-D-518, D-490, D-504, E06), against the REAL pt-BR catalog.
 * Stubbed: the server action and the toast. Real: the shipped `BottomSheet`, `Input` and `Button`.
 *
 * The sheet decides nothing: it sends the address as typed and renders the server's refusal under the
 * field. The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, release } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  release: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('./actions', () => ({ releaseEmailAction: release }));

const { ReleaseEmailSheet } = await import('./ReleaseEmailSheet');

const NOW = '2026-10-21T12:00:00.000Z';
const RELEASED: AccessItem = {
  id: 'caio@exemplo.com.br',
  email: 'caio@exemplo.com.br',
  source: 'manual',
  state: 'active',
  validUntil: null,
  hasAccount: false,
  updatedAt: NOW,
};

function mount() {
  const onSettled = vi.fn();
  const onClose = vi.fn();
  render(<ReleaseEmailSheet open onClose={onClose} onSettled={onSettled} />);
  return { onSettled, onClose };
}

const field = () => screen.getByLabelText('E-mail') as HTMLInputElement;
const submit = () => screen.getByRole('button', { name: 'Liberar acesso' }) as HTMLButtonElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });

beforeEach(() => {
  toast.show.mockReset();
  release.mockReset();
});

afterEach(cleanup);

describe('ReleaseEmailSheet: empty (E06 empty)', () => {
  it('starts with an empty e-mail field built for an address and a disabled submit', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Liberar e-mail' })).toBeTruthy();
    expect(field().value).toBe('');
    expect(field().id).toBe('payments-release-email');
    expect(field().type).toBe('email');
    expect(field().getAttribute('inputmode')).toBe('email');
    expect(field().getAttribute('autocomplete')).toBe('off');
    expect(field().getAttribute('autocapitalize')).toBe('none');
    expect(submit().disabled).toBe(true);
    expect(screen.getByText('A pessoa precisa criar a conta com este mesmo e-mail.')).toBeTruthy();
  });

  it('enables the submit once the field holds something, and not for spaces alone', () => {
    mount();
    type('   ');
    expect(submit().disabled).toBe(true);
    type('caio@exemplo.com.br');
    expect(submit().disabled).toBe(false);
  });

  it('the brand submit is full width', () => {
    mount();
    expect(submit().className).toContain('w-full');
  });
});

describe('ReleaseEmailSheet: loading (E06 loading)', () => {
  it('marks the submit busy while the write runs and ignores a second submit', async () => {
    let finish: (value: unknown) => void = () => {};
    release.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount();
    type('caio@exemplo.com.br');
    fireEvent.click(submit());
    await waitFor(() => expect(submit().getAttribute('aria-busy')).toBe('true'));
    fireEvent.click(submit());
    fireEvent.submit(field().closest('form') as HTMLFormElement);
    expect(release).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: false, code: 'generic' }));
  });
});

describe('ReleaseEmailSheet: success (D-490: before the person has an account)', () => {
  it('sends the address as typed and reports the server row', async () => {
    release.mockResolvedValue({ ok: true, access: RELEASED, serverNow: NOW });
    const { onSettled } = mount();
    type('Caio@Exemplo.com.br');
    await act(async () => {
      fireEvent.click(submit());
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(release).toHaveBeenCalledWith('Caio@Exemplo.com.br');
    expect(onSettled).toHaveBeenCalledWith({
      kind: 'released',
      email: 'caio@exemplo.com.br',
      access: RELEASED,
      serverNow: NOW,
    });
    expect(toast.show).not.toHaveBeenCalled();
  });
});

describe('ReleaseEmailSheet: the refusals (E06 error)', () => {
  it('an invalid address shows "Informe um e-mail válido." under the field and keeps the sheet', async () => {
    release.mockResolvedValue({ ok: false, code: 'email_invalid' });
    const { onSettled } = mount();
    type('caio');
    await act(async () => {
      fireEvent.click(submit());
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Informe um e-mail válido.');
    expect(field().value).toBe('caio');
    expect(onSettled).not.toHaveBeenCalled();
    type('caio@');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a blocked e-mail (409) says to unblock before releasing', async () => {
    release.mockResolvedValue({ ok: false, code: 'blocked' });
    const { onSettled } = mount();
    type('duda@exemplo.com.br');
    await act(async () => {
      fireEvent.click(submit());
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Este e-mail está bloqueado. Desbloqueie antes de liberar.');
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('any other failure toasts the release line, keeps the typed value and settles nothing', async () => {
    release.mockResolvedValue({ ok: false, code: 'generic' });
    const { onSettled } = mount();
    type('caio@exemplo.com.br');
    await act(async () => {
      fireEvent.click(submit());
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível liberar o acesso. Tente novamente.',
      }),
    );
    expect(field().value).toBe('caio@exemplo.com.br');
    expect(onSettled).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a rejected action reads like any failed write', async () => {
    release.mockRejectedValue(new Error('network'));
    mount();
    type('caio@exemplo.com.br');
    await act(async () => {
      fireEvent.click(submit());
    });
    await waitFor(() => expect(toast.show).toHaveBeenCalledTimes(1));
  });

  it('a vanished row (404) and a lost permission go to the host to toast and refresh', async () => {
    release.mockResolvedValueOnce({ ok: false, code: 'gone' });
    const { onSettled } = mount();
    type('caio@exemplo.com.br');
    await act(async () => {
      fireEvent.click(submit());
    });
    await waitFor(() =>
      expect(onSettled).toHaveBeenCalledWith({ kind: 'gone', email: 'caio@exemplo.com.br' }),
    );
    release.mockResolvedValueOnce({ ok: false, code: 'forbidden' });
    await act(async () => {
      fireEvent.click(submit());
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith({ kind: 'forbidden' }));
  });
});
