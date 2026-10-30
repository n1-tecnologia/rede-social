// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 12-17 Task 1 (D-595, UI-D-579; PFORM-21, T-12-37): the export confirmation of the summary card against
 * the REAL catalog. The download starter, the router and the toast are stubbed. Asserted: the button's
 * three states (shown, disabled with its helper when no member exists), the dialog's exact copy, the
 * pending lock (label "Preparando…", both buttons disabled), the success toast (6 seconds), the failure
 * toast with a closed dialog, and the forbidden toast with a refresh.
 */

const mocks = vi.hoisted(() => ({ download: vi.fn(), refresh: vi.fn(), show: vi.fn() }));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/lib/profile-form/download', () => ({
  startCsvDownload: (url: string) => mocks.download(url),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: mocks.show, dismiss: vi.fn() }),
}));

const { FormSummaryCard } = await import('./FormSummaryCard');

const EXPORT_BODY =
  'O arquivo traz uma linha por membro, com nome, e-mail e as respostas, inclusive das perguntas arquivadas. Ele contém dados pessoais: guarde com cuidado. A exportação fica registrada no histórico de moderação.';

function card(summary = { total: 12, complete: 9, hasRequired: true }) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <FormSummaryCard summary={summary} />
    </NextIntlClientProvider>,
  );
}

const exportButton = () => screen.getByRole('button', { name: 'Exportar respostas (CSV)' });
const dialog = () => screen.queryByRole('dialog');
const confirmButton = () => screen.getByRole('button', { name: /^(Exportar|Preparando…)$/ });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.download.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('ExportDialog: the button on the summary card (UI-D-566, UI-D-579)', () => {
  it('shows the outline button and no helper while members exist', () => {
    card();
    expect((exportButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('Ainda não há membros para exportar.')).toBeNull();
  });

  it('disables the button with the helper text when the member total is 0', () => {
    card({ total: 0, complete: 0, hasRequired: true });
    const button = exportButton() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const helper = screen.getByText('Ainda não há membros para exportar.');
    expect(button.getAttribute('aria-describedby')).toBe(helper.id);
    fireEvent.click(button);
    expect(dialog()).toBeNull();
  });

  it('keeps the button when no question is required (the degenerate title)', () => {
    card({ total: 5, complete: 0, hasRequired: false });
    expect(screen.getByText('Nenhuma pergunta obrigatória')).toBeTruthy();
    expect((exportButton() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ExportDialog: the confirmation (D-595, UI-D-579, PFORM-21)', () => {
  it('opens with the catalog strings verbatim and writes nothing until the confirm', () => {
    card();
    fireEvent.click(exportButton());
    expect(dialog()).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Exportar respostas?' })).toBeTruthy();
    // The wording "fica registrado" is the catalog string verbatim, true because the API commits the audit row first.
    expect(screen.getByText(EXPORT_BODY)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeTruthy();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('cancel closes without a request', async () => {
    card();
    fireEvent.click(exportButton());
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('pending: the label reads "Preparando…" and both buttons are disabled while the download runs', async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    mocks.download.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    card();
    fireEvent.click(exportButton());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirmButton().textContent).toBe('Preparando…'));
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.download).toHaveBeenCalledWith('/api/profile-form/export');

    await act(async () => finish({ ok: true }));
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('success: the dialog closes and the toast says the download started, for 6 seconds', async () => {
    card();
    fireEvent.click(exportButton());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(dialog()).toBeNull());
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Arquivo gerado. O download começou.',
      durationMs: 6000,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('failure: the dialog closes, the toast tells it honestly and nothing is refreshed', async () => {
    mocks.download.mockResolvedValueOnce({ ok: false, status: 502 });
    card();
    fireEvent.click(exportButton());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(dialog()).toBeNull());
    expect(mocks.show).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível exportar agora. Tente de novo.',
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('a network error (status null) is the same honest failure', async () => {
    mocks.download.mockResolvedValueOnce({ ok: false, status: null });
    card();
    fireEvent.click(exportButton());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(dialog()).toBeNull());
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível exportar agora. Tente de novo.',
    });
  });

  it('forbidden: the shipped forbidden toast and a refresh into the page’s not-found', async () => {
    mocks.download.mockResolvedValueOnce({ ok: false, status: 403 });
    card();
    fireEvent.click(exportButton());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(dialog()).toBeNull());
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Você não tem mais permissão para esta ação.',
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('never puts a personal datum in a toast: every toast message is a catalog sentence', async () => {
    mocks.download.mockResolvedValueOnce({ ok: false, status: 500 });
    card();
    fireEvent.click(exportButton());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(dialog()).toBeNull());
    for (const call of mocks.show.mock.calls) {
      expect(String(call[0].message)).not.toMatch(/@|;|\r|\n/);
    }
  });
});
