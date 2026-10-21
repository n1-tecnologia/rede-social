// @vitest-environment happy-dom
import type { AccessItem } from '@rede-social/contracts/payments';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessSheetView, type PaymentsTranslator } from '@/lib/payments-view';

/**
 * 09.1-14 — the access sheet (UI-D-518, D-489, D-504), against the REAL pt-BR catalog through
 * next-intl's own translator. Stubbed: the server actions and the toast. Real: the sheet, the shipped
 * `BottomSheet` and `ConfirmDialog`, the buttons and the pills.
 *
 * The sheet never decides a guard: every action sends only `{ email }`, and what it reports is the
 * server's answer. The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, block, unblock } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  block: vi.fn(),
  unblock: vi.fn(),
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

vi.mock('./actions', () => ({
  blockAccessAction: block,
  unblockAccessAction: unblock,
}));

const { AccessSheet } = await import('./AccessSheet');
const { createTranslator } = await import('next-intl');

const t = createTranslator({ locale: 'pt-BR', messages }) as unknown as PaymentsTranslator;
const NOW = '2026-10-21T12:00:00.000Z';
const CTX = {
  gatewayName: 'Kiwify',
  timeZone: 'America/Sao_Paulo',
  serverNow: NOW,
  gateRequired: true,
};

function item(patch: Partial<AccessItem> = {}): AccessItem {
  return {
    id: 'ana@exemplo.com.br',
    email: 'ana@exemplo.com.br',
    source: 'kiwify',
    state: 'active',
    validUntil: '2026-11-12T15:00:00.000Z',
    hasAccount: true,
    updatedAt: '2026-10-21T11:57:00.000Z',
    ...patch,
  };
}

const MANUAL = item({ source: 'manual', validUntil: null, hasAccount: false });
const BLOCKED = item({ source: 'manual', state: 'blocked', validUntil: null });

function mount(access: AccessItem) {
  const onSettled = vi.fn();
  const onClose = vi.fn();
  render(
    <AccessSheet
      open
      view={accessSheetView(access, t, CTX)}
      tenantName="Rede Demo"
      onClose={onClose}
      onSettled={onSettled}
    />,
  );
  return { onSettled, onClose };
}

const dialog = () => screen.getAllByRole('dialog').at(-1) as HTMLElement;
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  toast.show.mockReset();
  block.mockReset();
  unblock.mockReset();
});

afterEach(cleanup);

describe('AccessSheet: the identity and the three rows (E06 partial)', () => {
  it('titles the sheet with the e-mail and lets a very long one wrap (break-all) at 320px (E06 long-text)', () => {
    const long = `${'a'.repeat(64)}@${'clinica-de-estetica-avancada'.repeat(2)}.com.br`;
    mount(item({ id: long, email: long }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.className).toContain('[&_h2]:break-all');
    expect(within(sheet).getByRole('heading', { name: long })).toBeTruthy();
  });

  it('draws Origem, Situação and Validade, "Atualizado {when}" and the pills line', () => {
    mount(MANUAL);
    const sheet = screen.getByRole('dialog');
    const rows = Array.from(sheet.querySelectorAll('dl > div')).map((row) => row.textContent);
    expect(rows).toEqual(['OrigemManual', 'SituaçãoAtivo', 'ValidadeSem data de validade']);
    expect(within(sheet).getByText('Atualizado há 3 min')).toBeTruthy();
    const pills = Array.from(sheet.querySelectorAll('[data-access-sheet-pills] > span')).map(
      (pill) => pill.textContent,
    );
    expect(pills).toEqual(['Ativo', 'Manual', 'Ainda sem conta']);
  });

  it('prints the long validity of a gateway row in the tenant timezone', () => {
    mount(item());
    expect(
      within(screen.getByRole('dialog')).getByText('Válido até 12 de nov. de 2026'),
    ).toBeTruthy();
  });
});

describe('AccessSheet: the actions by case (D-489, D-504)', () => {
  it('a gateway row offers only "Bloquear acesso" and the gateway note', () => {
    mount(item());
    expect(button('Bloquear acesso')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desbloquear acesso' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover liberação' })).toBeNull();
    expect(
      screen.getByText('Este acesso vem do Kiwify e muda sozinho com a assinatura.'),
    ).toBeTruthy();
  });

  it('a blocked row offers "Desbloquear acesso" and says a manual block wins', () => {
    mount(BLOCKED);
    expect(button('Desbloquear acesso')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bloquear acesso' })).toBeNull();
    expect(screen.getByText('Um bloqueio manual vale mais que a assinatura.')).toBeTruthy();
  });

  it('stacks the actions full width at 44px', () => {
    mount(item());
    const action = button('Bloquear acesso');
    expect(action.className).toContain('w-full');
    expect(action.parentElement?.className).toContain('flex-col');
    expect(action.parentElement?.className).toContain('gap-2');
  });
});

describe('AccessSheet: block (danger dialog, then the server decides)', () => {
  it('opens the danger dialog with the contract words and sends only the e-mail', async () => {
    block.mockResolvedValue({
      ok: true,
      access: item({ source: 'manual', state: 'blocked', validUntil: null }),
      serverNow: NOW,
    });
    const { onSettled } = mount(item());
    fireEvent.click(button('Bloquear acesso'));

    const confirm = dialog();
    expect(
      within(confirm).getByRole('heading', { name: 'Bloquear ana@exemplo.com.br?' }),
    ).toBeTruthy();
    expect(
      within(confirm).getByText(
        'Esta pessoa não consegue entrar em Rede Demo, mesmo com a assinatura em dia. Você pode desbloquear quando quiser.',
      ),
    ).toBeTruthy();
    expect(block).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Bloquear' }));
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(block).toHaveBeenCalledWith('ana@exemplo.com.br');
    expect(onSettled.mock.calls[0]?.[0]).toMatchObject({
      kind: 'changed',
      change: 'block',
      access: { state: 'blocked', source: 'manual' },
    });
  });

  it('cancel writes nothing', () => {
    const { onSettled } = mount(item());
    fireEvent.click(button('Bloquear acesso'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancelar' }));
    expect(block).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('a vanished row (404) is reported as gone, never as a block', async () => {
    block.mockResolvedValue({ ok: false, code: 'gone' });
    const { onSettled } = mount(item());
    fireEvent.click(button('Bloquear acesso'));
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Bloquear' }));
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(onSettled.mock.calls[0]?.[0]).toEqual({ kind: 'gone', email: 'ana@exemplo.com.br' });
  });

  it('a lost permission is reported as forbidden', async () => {
    block.mockResolvedValue({ ok: false, code: 'forbidden' });
    const { onSettled } = mount(item());
    fireEvent.click(button('Bloquear acesso'));
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Bloquear' }));
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith({ kind: 'forbidden' }));
  });

  it('any other failure toasts the generic line and settles nothing', async () => {
    block.mockResolvedValue({ ok: false, code: 'generic' });
    const { onSettled } = mount(item());
    fireEvent.click(button('Bloquear acesso'));
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Bloquear' }));
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Algo deu errado. Tente novamente.',
      }),
    );
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('a rejected action reads like any failed write', async () => {
    block.mockRejectedValue(new Error('network'));
    const { onSettled } = mount(item());
    fireEvent.click(button('Bloquear acesso'));
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Bloquear' }));
    });
    await waitFor(() => expect(toast.show).toHaveBeenCalledTimes(1));
    expect(onSettled).not.toHaveBeenCalled();
  });
});

describe('AccessSheet: unblock (no dialog, it only restores the previous state)', () => {
  it('acts at once and reports the server row', async () => {
    unblock.mockResolvedValue({ ok: true, access: item(), serverNow: NOW });
    const { onSettled } = mount(BLOCKED);
    await act(async () => {
      fireEvent.click(button('Desbloquear acesso'));
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(screen.queryAllByRole('dialog')).toHaveLength(1);
    expect(unblock).toHaveBeenCalledWith('ana@exemplo.com.br');
    expect(onSettled.mock.calls[0]?.[0]).toMatchObject({
      kind: 'changed',
      change: 'unblock',
      access: { state: 'active', source: 'kiwify' },
    });
  });

  it('ignores a second tap while the write runs and marks the button busy', async () => {
    let finish: (value: unknown) => void = () => {};
    unblock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount(BLOCKED);
    const action = button('Desbloquear acesso');
    fireEvent.click(action);
    await waitFor(() => expect(action.getAttribute('aria-busy')).toBe('true'));
    fireEvent.click(action);
    expect(unblock).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: false, code: 'generic' }));
  });

  it('a vanished row is reported as gone', async () => {
    unblock.mockResolvedValue({ ok: false, code: 'gone' });
    const { onSettled } = mount(BLOCKED);
    await act(async () => {
      fireEvent.click(button('Desbloquear acesso'));
    });
    await waitFor(() =>
      expect(onSettled).toHaveBeenCalledWith({ kind: 'gone', email: 'ana@exemplo.com.br' }),
    );
  });
});
