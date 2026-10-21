// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-13 — "Exigir assinatura para entrar" (UI-D-516, D-491, D-492, PAY-08, PAY-31, A-UI-2, A-UI-10),
 * against the REAL merged pt-BR catalog through next-intl's own `createTranslator` (ICU plurals
 * included). Stubbed: the server actions, the router and the toast. Real: the row, the shipped
 * `Switch`, `ConfirmDialog` (with its new children slot), `Card` and `SectionTitle`.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, refresh, preview, setGate } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  refresh: vi.fn(),
  preview: vi.fn(),
  setGate: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;

vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('./actions', () => ({ previewGateAction: preview, setGateAction: setGate }));

const { GateSwitchRow } = await import('./GateSwitchRow');

const onRequiredChange = vi.fn();

function renderRow(patch: { required?: boolean; canEnable?: boolean } = {}) {
  return render(
    <GateSwitchRow
      tenantName="Rede Demo"
      required={patch.required ?? false}
      canEnable={patch.canEnable ?? true}
      onRequiredChange={onRequiredChange}
    />,
  );
}

const gateSwitch = () => screen.getByRole('switch', { name: 'Exigir assinatura para entrar' });
const dialog = () => screen.getByRole('dialog', { name: 'Exigir assinatura em Rede Demo?' });
const releaseBox = () => screen.getByRole('checkbox') as HTMLInputElement;
const confirmButton = () =>
  within(dialog()).getByRole('button', { name: 'Exigir assinatura' }) as HTMLButtonElement;
const cancelButton = () =>
  within(dialog()).getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement;

async function openDialog(count: number) {
  preview.mockResolvedValue({ ok: true, count });
  fireEvent.click(gateSwitch());
  await screen.findByRole('dialog');
}

beforeEach(() => {
  for (const mock of [toast.show, refresh, preview, setGate, onRequiredChange]) mock.mockReset();
});
afterEach(cleanup);

describe('GateSwitchRow: the row and its disabled state (A-UI-2, D-491)', () => {
  it('names the section, the title and the helper', () => {
    renderRow();
    expect(screen.getByText('Quem pode entrar')).toBeTruthy();
    expect(screen.getByText('Exigir assinatura para entrar')).toBeTruthy();
    expect(
      screen.getByText(
        'Só entra quem tem acesso liberado: assinatura ativa ou liberação manual. A equipe nunca precisa de assinatura.',
      ),
    ).toBeTruthy();
    expect(gateSwitch().getAttribute('aria-checked')).toBe('false');
    expect(
      screen.queryByText('Salve a integração e cadastre um produto de acesso para ativar.'),
    ).toBeNull();
  });

  it('is disabled and aria-disabled with the note while the server says it cannot be enabled', () => {
    renderRow({ canEnable: false });
    const control = gateSwitch() as HTMLButtonElement;
    expect(control.disabled).toBe(true);
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByText('Salve a integração e cadastre um produto de acesso para ativar.'),
    ).toBeTruthy();
    fireEvent.click(control);
    expect(preview).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays operable while ON even if canEnable is false, so the admin can always switch it off', () => {
    renderRow({ required: true, canEnable: false });
    expect((gateSwitch() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('GateSwitchRow: turning ON reads the preview first (PAY-31, E04 loading/error)', () => {
  it('leaves the switch off and toasts when the preview fails; no dialog, nothing written', async () => {
    preview.mockResolvedValue({ ok: false, code: 'generic' });
    renderRow();
    fireEvent.click(gateSwitch());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível verificar os membros atuais. Nada foi alterado.',
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(gateSwitch().getAttribute('aria-checked')).toBe('false');
    expect(setGate).not.toHaveBeenCalled();
  });

  it('ignores a second tap while the preview is being read, and marks the switch busy', async () => {
    let resolvePreview: (value: { ok: true; count: number }) => void = () => {};
    preview.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    renderRow();
    fireEvent.click(gateSwitch());
    await waitFor(() => expect(gateSwitch().getAttribute('aria-busy')).toBe('true'));
    fireEvent.click(gateSwitch());
    fireEvent.click(gateSwitch());
    expect(preview).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePreview({ ok: true, count: 0 });
    });
    await screen.findByRole('dialog');
    expect(gateSwitch().getAttribute('aria-busy')).toBeNull();
  });

  it('toasts the shipped forbidden line and refreshes when the preview is refused for permission', async () => {
    preview.mockResolvedValue({ ok: false, code: 'forbidden' });
    renderRow();
    fireEvent.click(gateSwitch());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Você não tem mais permissão para esta ação.',
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('GateSwitchRow: nobody to cut (count 0)', () => {
  it('opens the brand dialog with the plain body and no checkbox; the switch is still off', async () => {
    renderRow();
    await openDialog(0);
    expect(
      within(dialog()).getByText(
        'Novos cadastros e quem pedir para participar precisarão de uma assinatura ativa ou de uma liberação manual. A equipe não é afetada.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(confirmButton().className).toContain('text-brand');
    expect(gateSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('writes { required: true, releaseExisting: false } and toasts the plain line; the switch turns on from the answer', async () => {
    setGate.mockResolvedValue({ ok: true, required: true, released: 0 });
    renderRow();
    await openDialog(0);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(gateSwitch().getAttribute('aria-checked')).toBe('true'));
    expect(setGate).toHaveBeenCalledWith({ required: true, releaseExisting: false });
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Assinatura exigida para entrar.',
    });
    expect(onRequiredChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('GateSwitchRow: members would be cut (count n, A-UI-10)', () => {
  it('names the count in the plural body and offers the release box CHECKED, tone brand, with the checked helper', async () => {
    renderRow();
    await openDialog(3);
    expect(
      within(dialog()).getByText(
        '3 membros estão sem acesso registrado. Quem ficar sem acesso passará a ver “Assinatura pendente”. A equipe não é afetada.',
      ),
    ).toBeTruthy();
    expect(releaseBox().checked).toBe(true);
    expect(releaseBox().className).toContain('accent-brand');
    expect(releaseBox().className).toContain('size-5');
    expect(releaseBox().className).not.toMatch(/\bmt-/);
    expect(within(dialog()).getByLabelText('Liberar o acesso dos 3 membros atuais')).toBe(
      releaseBox(),
    );
    const helper = within(dialog()).getByText(
      'Eles entram com uma liberação manual, que você pode remover depois na aba Acessos.',
    );
    expect(helper.getAttribute('aria-live')).toBe('polite');
    expect(confirmButton().className).toContain('text-brand');
    expect(confirmButton().className).not.toContain('text-danger');
  });

  it('uses the singular forms for one member', async () => {
    renderRow();
    await openDialog(1);
    expect(within(dialog()).getByText(/^1 membro está sem acesso registrado\./)).toBeTruthy();
    expect(within(dialog()).getByLabelText('Liberar o acesso do membro atual')).toBe(releaseBox());
  });

  it('turns the tone to danger and the helper to the cleared text when the box is cleared, and back when checked', async () => {
    renderRow();
    await openDialog(3);
    fireEvent.click(releaseBox());
    expect(releaseBox().checked).toBe(false);
    expect(confirmButton().className).toContain('text-danger');
    const helper = within(dialog()).getByText(
      'Eles passarão a ver “Assinatura pendente” até haver uma assinatura ativa ou uma liberação.',
    );
    expect(helper.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(releaseBox());
    expect(confirmButton().className).toContain('text-brand');
  });

  it('confirms with the box checked: sends releaseExisting true and toasts the SERVER figure, not the preview', async () => {
    setGate.mockResolvedValue({ ok: true, required: true, released: 2 });
    renderRow();
    await openDialog(3);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(gateSwitch().getAttribute('aria-checked')).toBe('true'));
    expect(setGate).toHaveBeenCalledWith({ required: true, releaseExisting: true });
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Assinatura exigida. Acesso liberado para 2 membros.',
    });
  });

  it('uses the singular in the toast for one released member', async () => {
    setGate.mockResolvedValue({ ok: true, required: true, released: 1 });
    renderRow();
    await openDialog(3);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'success',
        message: 'Assinatura exigida. Acesso liberado para 1 membro.',
      }),
    );
  });

  it('confirms with the box cleared: sends releaseExisting false and toasts the plain line', async () => {
    setGate.mockResolvedValue({ ok: true, required: true, released: 0 });
    renderRow();
    await openDialog(3);
    fireEvent.click(releaseBox());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(gateSwitch().getAttribute('aria-checked')).toBe('true'));
    expect(setGate).toHaveBeenCalledWith({ required: true, releaseExisting: false });
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Assinatura exigida para entrar.',
    });
  });

  it('reports a server release of 0 with the box checked as the plain toast (nobody was left to release)', async () => {
    setGate.mockResolvedValue({ ok: true, required: true, released: 0 });
    renderRow();
    await openDialog(3);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'success',
        message: 'Assinatura exigida para entrar.',
      }),
    );
  });

  it('cancelling writes nothing and leaves the switch off', async () => {
    renderRow();
    await openDialog(3);
    fireEvent.click(cancelButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setGate).not.toHaveBeenCalled();
    expect(gateSwitch().getAttribute('aria-checked')).toBe('false');
  });
});

describe('GateSwitchRow: while the confirmed write runs (E04 loading) and when it fails (E04 error)', () => {
  it('disables the box and both footer buttons, and does NOT flip the switch before the answer', async () => {
    let finish: (value: { ok: true; required: true; released: number }) => void = () => {};
    setGate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderRow();
    await openDialog(3);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(releaseBox().disabled).toBe(true));
    expect(confirmButton().disabled).toBe(true);
    expect(cancelButton().disabled).toBe(true);
    expect(gateSwitch().getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      finish({ ok: true, required: true, released: 3 });
    });
    await waitFor(() => expect(gateSwitch().getAttribute('aria-checked')).toBe('true'));
  });

  it('closes the dialog, leaves the switch off and toasts the generic line when the write fails', async () => {
    setGate.mockResolvedValue({ ok: false, code: 'generic' });
    renderRow();
    await openDialog(3);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Algo deu errado. Tente novamente.',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(gateSwitch().getAttribute('aria-checked')).toBe('false');
    expect(onRequiredChange).not.toHaveBeenCalled();
  });

  it('refreshes after a stale-setup refusal, so the disabled state catches up with the server', async () => {
    setGate.mockResolvedValue({ ok: false, code: 'gate_requires_setup' });
    renderRow();
    await openDialog(0);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(gateSwitch().getAttribute('aria-checked')).toBe('false');
  });
});

describe('GateSwitchRow: turning OFF needs no confirmation (D-491)', () => {
  it('writes { required: false } at once, busy until the answer, then toasts and turns off', async () => {
    let finish: (value: { ok: true; required: false; released: number }) => void = () => {};
    setGate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderRow({ required: true });
    fireEvent.click(gateSwitch());
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(gateSwitch().getAttribute('aria-busy')).toBe('true'));
    expect(gateSwitch().getAttribute('aria-checked')).toBe('true');
    expect(setGate).toHaveBeenCalledWith({ required: false });
    expect(preview).not.toHaveBeenCalled();

    await act(async () => {
      finish({ ok: true, required: false, released: 0 });
    });
    await waitFor(() => expect(gateSwitch().getAttribute('aria-checked')).toBe('false'));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Assinatura não é mais exigida.',
    });
    expect(onRequiredChange).toHaveBeenCalledWith(false);
  });

  it('reverts (stays on) and toasts when switching off fails', async () => {
    setGate.mockResolvedValue({ ok: false, code: 'generic' });
    renderRow({ required: true });
    fireEvent.click(gateSwitch());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Algo deu errado. Tente novamente.',
      }),
    );
    expect(gateSwitch().getAttribute('aria-checked')).toBe('true');
    expect(gateSwitch().getAttribute('aria-busy')).toBeNull();
  });
});
