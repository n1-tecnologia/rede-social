// @vitest-environment happy-dom

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminQuestion, archivedQuestion, uuid } from '@/lib/profile-form/test-fixtures';

/**
 * 12-17 Task 1 (D-595, UI-D-579; PFORM-21, T-12-37): the export confirmation of the summary card against
 * the REAL catalog. The download starter, the router and the toast are stubbed. Asserted: the button's
 * three states (shown, disabled with its helper when no member exists), the dialog's exact copy, the
 * pending lock (label "Preparando…", both buttons disabled), the success toast (6 seconds), the failure
 * toast with a closed dialog, and the forbidden toast with a refresh.
 */

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  refresh: vi.fn(),
  show: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  replace: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
  impact: vi.fn(),
  reactivate: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('./actions', () => ({
  createQuestionAction: (body: unknown, options: unknown) => mocks.create(body, options),
  updateQuestionAction: (id: string, body: unknown, options: unknown) =>
    mocks.update(id, body, options),
  replaceQuestionAction: (body: unknown, options: unknown) => mocks.replace(body, options),
  archiveQuestionAction: (id: string) => mocks.archive(id),
  deleteQuestionAction: (id: string) => mocks.remove(id),
  readImpactAction: (input: unknown) => mocks.impact(input),
  reactivateQuestionAction: (id: string) => mocks.reactivate(id),
  reorderQuestionsAction: vi.fn(),
}));
vi.mock('@/app/(auth)/completar-perfil/actions', () => ({ saveProfileFormAction: vi.fn() }));
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
const { ImpactDialog } = await import('./ImpactDialog');
const { ArchiveDialog } = await import('./ArchiveDialog');
const { ExportDialog } = await import('./ExportDialog');
const { QuestionEditorSheet } = await import('./QuestionEditorSheet');
const { ArchivedList } = await import('./ArchivedList');
const { QuestionBuilder } = await import('./QuestionBuilder');

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

// ── Task 3 (UI-D-596, E06): every dialog and sheet of the builder under load, failure and keyboard ────

/** An opener button plus the dialog it opens: the pattern the focus-restoration tests share. */
function Opened({
  children,
}: {
  children: (state: { open: boolean; onClose: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      {children({ open, onClose: () => setOpen(false) })}
    </>
  );
}

const LONG_TITLE = 'T'.repeat(120);

interface DialogCase {
  name: string;
  title: string;
  confirm: string;
  cancel: string;
  /** The same dialog with the host's `onConfirm` injected (ExportDialog owns its own action). */
  node: (state: {
    open: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>;
  }) => ReactNode;
}

const impactCase = (
  kind: 'add' | 'make' | 'reactivate' | 'replace',
  title: string,
  confirm: string,
): DialogCase => ({
  name: `ImpactDialog ${kind}`,
  title,
  confirm,
  cancel: 'Voltar',
  node: ({ open, onClose, onConfirm }) => (
    <ImpactDialog
      open={open}
      kind={kind}
      members={12}
      note={kind === 'replace' ? `“${LONG_TITLE}” será arquivada.` : undefined}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  ),
});

const DIALOGS: DialogCase[] = [
  impactCase('add', 'Adicionar pergunta obrigatória?', 'Adicionar e exigir'),
  impactCase('make', 'Tornar a pergunta obrigatória?', 'Tornar obrigatória'),
  impactCase('reactivate', 'Reativar pergunta obrigatória?', 'Reativar e exigir'),
  impactCase('replace', 'Substituir a pergunta?', 'Substituir'),
  {
    name: 'ArchiveDialog archive',
    title: 'Arquivar esta pergunta?',
    confirm: 'Arquivar',
    cancel: 'Cancelar',
    node: ({ open, onClose, onConfirm }) => (
      <ArchiveDialog
        open={open}
        kind="archive"
        answerCount={12}
        required
        onConfirm={onConfirm}
        onClose={onClose}
      />
    ),
  },
  {
    name: 'ArchiveDialog delete',
    title: 'Excluir esta pergunta?',
    confirm: 'Excluir',
    cancel: 'Cancelar',
    node: ({ open, onClose, onConfirm }) => (
      <ArchiveDialog
        open={open}
        kind="delete"
        answerCount={0}
        required={false}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    ),
  },
];

function renderCase(item: DialogCase, onConfirm: () => Promise<void>) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <Opened>{(state) => item.node({ ...state, onConfirm })}</Opened>
    </NextIntlClientProvider>,
  );
}
const opener = () => screen.getByRole('button', { name: 'Abrir' });
function openFromOpener() {
  opener().focus();
  fireEvent.click(opener());
}

describe('the confirm dialogs: pending, failure and focus (UI-D-596, E06)', () => {
  for (const item of DIALOGS) {
    it(`${item.name} pending: both buttons lock and the confirm spins while the action runs`, async () => {
      let finish: () => void = () => undefined;
      const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
      renderCase(item, onConfirm);
      openFromOpener();
      expect(screen.getByRole('heading', { name: item.title })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: item.confirm }));
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: item.confirm }) as HTMLButtonElement).disabled,
        ).toBe(true),
      );
      const confirm = screen.getByRole('button', { name: item.confirm });
      expect(confirm.getAttribute('aria-busy')).toBe('true');
      expect(
        (screen.getByRole('button', { name: item.cancel }) as HTMLButtonElement).disabled,
      ).toBe(true);
      // A second press while it runs does nothing.
      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      await act(async () => finish());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it(`${item.name} failure: the host's failed action ends in a closed dialog and no state change`, async () => {
      // The host (sheet or list) turns a failed result into its documented toast and changes nothing;
      // the dialog's own duty is to close when the action settles, whatever it settled to.
      const hostToast = vi.fn();
      const state = { changed: false };
      const onConfirm = vi.fn(async () => {
        const result: { ok: boolean } = await Promise.resolve({ ok: false });
        if (!result.ok) hostToast();
        else state.changed = true;
      });
      renderCase(item, onConfirm);
      openFromOpener();
      fireEvent.click(screen.getByRole('button', { name: item.confirm }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(hostToast).toHaveBeenCalledTimes(1);
      expect(state.changed).toBe(false);
    });

    it(`${item.name} focus: the focus trap holds Escape and Cancel returns focus to the opener`, async () => {
      const onConfirm = vi.fn(async () => undefined);
      renderCase(item, onConfirm);
      openFromOpener();
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
      fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(opener());

      openFromOpener();
      fireEvent.click(screen.getByRole('button', { name: item.cancel }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(opener());
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it(`${item.name} wrap: the title and body break long words and the buttons come after them`, () => {
      renderCase(
        item,
        vi.fn(async () => undefined),
      );
      openFromOpener();
      const dialog = screen.getByRole('dialog');
      const heading = within(dialog).getByRole('heading', { name: item.title });
      expect(heading.className).toContain('break-words');
      const body = dialog.querySelector('p') as HTMLElement;
      expect(body.className).toContain('break-words');
      // The footer is the last block of the panel: the buttons sit below the title and the body.
      const buttons = within(dialog).getAllByRole('button');
      expect(buttons.map((button) => button.textContent)).toEqual([item.cancel, item.confirm]);
      expect(
        heading.compareDocumentPosition(buttons[0] as HTMLElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  }

  it('ImpactDialog replace wrap: a 120-character title inside the body stays inside the dialog', () => {
    const replace = DIALOGS[3] as DialogCase;
    renderCase(
      replace,
      vi.fn(async () => undefined),
    );
    openFromOpener();
    const body = screen.getByRole('dialog').querySelector('p') as HTMLElement;
    expect(body.textContent).toContain(LONG_TITLE);
    expect(body.className).toContain('break-words');
    expect(body.className).toContain('max-w-full');
  });

  it('ImpactDialog plural: the body reads 1 member in the singular and many in the plural', () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <ImpactDialog open kind="add" members={1} onConfirm={vi.fn()} onClose={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('dialog').textContent).toContain(
      '1 membro vai precisar responder antes de continuar usando a comunidade.',
    );
    rerender(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <ImpactDialog open kind="add" members={12} onConfirm={vi.fn()} onClose={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('dialog').textContent).toContain(
      '12 membros vão precisar responder antes de continuar usando a comunidade.',
    );
  });

  it('ImpactDialog reactivate: the body adds that the kept answers still count', () => {
    render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <ImpactDialog open kind="reactivate" members={3} onConfirm={vi.fn()} onClose={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('dialog').textContent).toContain(
      'As respostas guardadas continuam valendo.',
    );
  });

  it('ArchiveDialog plural: the kept-answers sentence reads 1 in the singular and many in the plural', () => {
    const show = (answerCount: number) =>
      render(
        <NextIntlClientProvider locale="pt-BR" messages={messages}>
          <ArchiveDialog
            open
            kind="archive"
            answerCount={answerCount}
            required={false}
            onConfirm={vi.fn()}
            onClose={vi.fn()}
          />
        </NextIntlClientProvider>,
      );
    show(1);
    expect(screen.getByRole('dialog').textContent).toContain(
      'A 1 resposta continua guardada e entra na exportação.',
    );
    cleanup();
    show(12);
    expect(screen.getByRole('dialog').textContent).toContain(
      'As 12 respostas continuam guardadas e entram na exportação.',
    );
    expect(screen.getByRole('dialog').textContent).not.toContain('Quem ainda não respondeu');
  });
});

describe('ExportDialog pending, failure and focus (UI-D-579, UI-D-596, E06)', () => {
  function mountExport() {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <Opened>{(state) => <ExportDialog open={state.open} onClose={state.onClose} />}</Opened>
      </NextIntlClientProvider>,
    );
  }

  it('ExportDialog pending: "Preparando…" and both buttons locked until the download settles', async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    mocks.download.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    mountExport();
    openFromOpener();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preparando…' })).toBeTruthy());
    expect(
      (screen.getByRole('button', { name: 'Preparando…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await act(async () => finish({ ok: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ExportDialog failure: the dialog closes with the documented toast and nothing else changes', async () => {
    mocks.download.mockResolvedValueOnce({ ok: false, status: 500 });
    mountExport();
    openFromOpener();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.show).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível exportar agora. Tente de novo.',
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('ExportDialog focus: Escape and Cancelar return focus to the opener, and no download starts', async () => {
    mountExport();
    openFromOpener();
    expect((screen.getByRole('dialog') as HTMLElement).contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener());
    openFromOpener();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener());
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('ExportDialog wrap: the title and the body break long words', () => {
    mountExport();
    openFromOpener();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading').className).toContain('break-words');
    expect((dialog.querySelector('p') as HTMLElement).className).toContain('break-words');
  });
});

describe('the real hosts: a failed write closes the confirmation, toasts and changes no state (E06)', () => {
  const SAVE_FAILED =
    'Não foi possível salvar a pergunta agora. Suas alterações continuam aqui. Tente de novo.';
  const onClose = vi.fn();

  function sheet(
    mode: 'create' | 'edit' | 'replace',
    question: ReturnType<typeof adminQuestion> | null,
  ) {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <QuestionEditorSheet
          open
          mode={mode}
          question={question}
          tenantName="Ana Mentoria"
          limit={30}
          onClose={onClose}
          onReplace={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
  }
  const save = () => screen.getByRole('button', { name: /^(Salvar pergunta|Salvando…)$/ });

  beforeEach(() => {
    onClose.mockReset();
    mocks.impact.mockResolvedValue({ ok: true, members: 5 });
  });

  it('ImpactDialog add failure: the create fails after the confirm, the draft stays in the sheet', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'failed' });
    sheet('create', null);
    fireEvent.click(screen.getByRole('radio', { name: /^Texto curto/ }));
    fireEvent.change(screen.getByLabelText('Pergunta'), { target: { value: 'Cargo' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Obrigatória' }));
    await act(async () => {
      fireEvent.click(save());
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar e exigir' }));
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Adicionar pergunta obrigatória?' })).toBeNull();
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'error', message: SAVE_FAILED });
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Pergunta') as HTMLInputElement).value).toBe('Cargo');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('ImpactDialog make failure: the update fails after the confirm, the switch stays on', async () => {
    const question = adminQuestion('short_text', { title: 'Cargo', revision: 2 });
    mocks.update.mockResolvedValue({ ok: false, code: 'failed' });
    sheet('edit', question);
    fireEvent.click(screen.getByRole('switch', { name: 'Obrigatória' }));
    await act(async () => {
      fireEvent.click(save());
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tornar obrigatória' }));
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Tornar a pergunta obrigatória?' })).toBeNull();
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'error', message: SAVE_FAILED });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Obrigatória' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('ImpactDialog replace failure: the atomic replace fails, nothing is archived and the sheet stays', async () => {
    const question = adminQuestion('single_choice', {
      title: 'Como conheceu?',
      required: true,
      answerCount: 4,
      options: [
        { id: uuid(9701), label: 'A', answerCount: 2 },
        { id: uuid(9702), label: 'B', answerCount: 2 },
      ],
    });
    mocks.replace.mockResolvedValue({ ok: false, code: 'failed' });
    sheet('replace', question);
    fireEvent.click(screen.getByRole('radio', { name: /^E-mail/ }));
    await act(async () => {
      fireEvent.click(save());
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Substituir' }));
    });
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Substituir a pergunta?' })).toBeNull();
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'error', message: SAVE_FAILED });
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ImpactDialog reactivate failure: the write fails after the confirm and the row stays archived', async () => {
    const archived = archivedQuestion('short_text', { title: 'Telefone antigo', required: true });
    mocks.reactivate.mockResolvedValue({ ok: false, code: 'failed' });
    render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <ArchivedList
          questions={[archived]}
          activeCount={3}
          limit={30}
          timeZone="America/Sao_Paulo"
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reativar pergunta: Telefone antigo' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reativar pergunta obrigatória?' });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Reativar e exigir' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.reactivate).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível reativar agora. Tente de novo.',
    });
    expect(screen.getByText('Telefone antigo')).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('ArchiveDialog archive failure and delete failure: each toasts its documented sentence and the sheet stays', async () => {
    mocks.archive.mockResolvedValue({ ok: false, code: 'failed' });
    sheet('edit', adminQuestion('short_text', { title: 'Cargo', answerCount: 3, revision: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar pergunta' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    });
    expect(screen.queryByRole('heading', { name: 'Arquivar esta pergunta?' })).toBeNull();
    expect(mocks.show).toHaveBeenLastCalledWith({
      tone: 'error',
      message: 'Não foi possível arquivar agora. Tente de novo.',
    });
    cleanup();

    mocks.remove.mockResolvedValue({ ok: false, code: 'failed' });
    sheet('edit', adminQuestion('short_text', { title: 'Cargo', answerCount: 0, revision: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir pergunta' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    });
    expect(screen.queryByRole('heading', { name: 'Excluir esta pergunta?' })).toBeNull();
    expect(mocks.show).toHaveBeenLastCalledWith({
      tone: 'error',
      message: 'Não foi possível excluir agora. Tente de novo.',
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the discard dialog: pending, failure and focus (UI-D-569, UI-D-596)', () => {
  const question = adminQuestion('short_text', { title: 'Cargo', revision: 2 });
  function host() {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <QuestionBuilder questions={[question]} limit={30} tenantName="Ana Mentoria" />
      </NextIntlClientProvider>,
    );
  }
  function openDirtyEditor() {
    const row = screen.getByRole('button', { name: 'Editar pergunta: Cargo' });
    row.focus();
    fireEvent.click(row);
    fireEvent.change(screen.getByLabelText('Pergunta'), { target: { value: 'Mexi' } });
    return row;
  }

  it('discard dialog pending: the confirm is synchronous, so nothing locks and nothing is awaited', () => {
    host();
    openDirtyEditor();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Descartar as alterações?' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Descartar' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(
      (screen.getByRole('button', { name: 'Continuar editando' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('discard dialog failure: there is no write to fail; "Continuar editando" keeps the draft and sends nothing', async () => {
    host();
    openDirtyEditor();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Descartar as alterações?' })).toBeNull(),
    );
    expect((screen.getByLabelText('Pergunta') as HTMLInputElement).value).toBe('Mexi');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('discard dialog focus: Descartar closes the sheet and focus returns to the row that opened it', async () => {
    host();
    const row = openDirtyEditor();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(row);
  });

  it('discard dialog focus: while it is open, Escape closes the dialog and never the sheet under it', async () => {
    host();
    openDirtyEditor();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Descartar as alterações?' })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Descartar as alterações?' })).toBeNull(),
    );
    expect(screen.getByLabelText('Pergunta')).toBeTruthy();
  });
});

describe('the sheets: focus trap, restoration and the close rules (UI-D-596)', () => {
  const A = adminQuestion('short_text', { title: 'Cargo', revision: 2 });
  const B = adminQuestion('dropdown', {
    title: 'Origem',
    options: [
      { id: uuid(9801), label: 'Instagram', answerCount: 0 },
      { id: uuid(9802), label: 'Indicação', answerCount: 0 },
    ],
  });
  function host() {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <QuestionBuilder questions={[A, B]} limit={30} tenantName="Ana Mentoria" />
      </NextIntlClientProvider>,
    );
  }
  const sheetDialog = () => screen.getAllByRole('dialog')[0] as HTMLElement;
  const backdrop = () => sheetDialog().previousElementSibling as HTMLElement;
  const addButton = () => screen.getByRole('button', { name: 'Adicionar pergunta' });
  const previewButton = () => screen.getByRole('button', { name: 'Ver como o membro vê' });

  it('editor sheet focus: opens with focus inside, traps Escape, and restores focus to the opener when clean', async () => {
    host();
    addButton().focus();
    fireEvent.click(addButton());
    expect(sheetDialog().contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(addButton());

    addButton().focus();
    fireEvent.click(addButton());
    fireEvent.click(backdrop());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(addButton());
  });

  it('editor sheet dirty guard: Escape and the backdrop ask first when edited, and close at once when clean', async () => {
    host();
    fireEvent.click(addButton());
    fireEvent.click(screen.getByRole('radio', { name: /^Texto curto/ }));
    fireEvent.change(screen.getByLabelText('Pergunta'), { target: { value: 'Mexi' } });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Descartar as alterações?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Descartar as alterações?' })).toBeNull(),
    );

    fireEvent.click(backdrop());
    expect(screen.getByRole('heading', { name: 'Descartar as alterações?' })).toBeTruthy();
    expect(screen.getByLabelText('Pergunta')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('preview sheet focus: opens with focus inside, Escape and the backdrop close at once, focus returns to the opener', async () => {
    host();
    previewButton().focus();
    fireEvent.click(previewButton());
    expect(screen.getByRole('dialog', { name: 'Como o membro vê' })).toBeTruthy();
    expect(sheetDialog().contains(document.activeElement)).toBe(true);
    // Even after typing, nothing is guarded: a preview holds no work.
    fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'x' } });
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Descartar as alterações?')).toBeNull();
    expect(document.activeElement).toBe(previewButton());

    previewButton().focus();
    fireEvent.click(previewButton());
    fireEvent.click(backdrop());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(previewButton());
  });
});

describe('the list: names, live region, 44px targets and no raw HTML (UI-D-596)', () => {
  const A = adminQuestion('short_text', { title: 'Cargo' });
  const B = adminQuestion('dropdown', { title: 'Origem' });
  const C = adminQuestion('acceptance', { title: 'Regulamento' });
  function host() {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <QuestionBuilder questions={[A, B, C]} limit={30} tenantName="Ana Mentoria" />
      </NextIntlClientProvider>,
    );
  }

  it('reorder buttons carry names that include the question title, and the live region is polite', () => {
    host();
    fireEvent.click(screen.getByRole('button', { name: 'Reordenar' }));
    for (const title of ['Cargo', 'Origem', 'Regulamento']) {
      expect(screen.getByRole('button', { name: `Subir “${title}”` })).toBeTruthy();
      expect(screen.getByRole('button', { name: `Descer “${title}”` })).toBeTruthy();
    }
    const live = document.querySelector('[data-reorder-live]') as HTMLElement;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('aria-atomic')).toBe('true');
  });

  it('every interactive target of the list carries a 44px class', () => {
    host();
    // The rows are whole-row buttons with min-h-11 and the actions row uses the md button (h-11).
    for (const row of screen.getAllByRole('button', { name: /^Editar pergunta:/ })) {
      expect(row.className).toContain('min-h-11');
    }
    for (const name of ['Adicionar pergunta', 'Reordenar', 'Ver como o membro vê']) {
      expect(screen.getByRole('button', { name }).className).toContain('h-11');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Reordenar' }));
    for (const button of screen.getAllByRole('button', { name: /^(Subir|Descer) / })) {
      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('min-w-[44px]');
    }
  });

  it('the export button keeps the transparent 44px hit area of the small button', () => {
    render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <FormSummaryCard summary={{ total: 3, complete: 1, hasRequired: true }} />
      </NextIntlClientProvider>,
    );
    const button = screen.getByRole('button', { name: 'Exportar respostas (CSV)' });
    // An outline sm button: its 1px border must not shave the centred 44px box to 42px.
    for (const token of ['border', 'after:top-1/2', 'after:h-11', 'after:-translate-y-1/2']) {
      expect(button.className.split(/\s+/)).toContain(token);
    }
    expect(button.className).not.toMatch(/after:-?inset-y-/);
  });

  it('no element of the builder folder injects raw HTML (source scan)', () => {
    const dir = join(process.cwd(), 'app', '(app)', 'configuracoes', 'formulario-de-perfil');
    const files = readdirSync(dir).filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, file).not.toMatch(
        /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/,
      );
    }
    for (const file of ['api/profile-form/export/route.ts', 'lib/profile-form/download.ts']) {
      const source = readFileSync(
        join(process.cwd(), file.startsWith('api') ? `app/${file}` : file),
        'utf8',
      );
      expect(source, file).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=/);
    }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* 12.1-17 Task 2: the opener's refusals, the used option and the reactivation toast (D-632, UI-D-651) */
/* ------------------------------------------------------------------------------------------------ */

describe('12.1-17 Task 2: an opener cannot be archived, deleted, retyped or lose a used option (D-632, UI-D-651)', () => {
  const onClose = vi.fn();
  const optionIds = [uuid(9801), uuid(9802), uuid(9803)];
  const baseOptions = [
    { id: optionIds[0] as string, label: 'Tenho uma clínica', answerCount: 0 },
    { id: optionIds[1] as string, label: 'Trabalho em uma clínica', answerCount: 0 },
    { id: optionIds[2] as string, label: 'Estou aprendendo', answerCount: 0 },
  ];

  /** An opener and `count` questions that depend on it through its first option (or none). */
  function world(count: number, overrides: Partial<ReturnType<typeof adminQuestion>> = {}) {
    const opener = adminQuestion('single_choice', {
      title: 'Você tem clínica?',
      options: baseOptions,
      opensCount: count,
      ...overrides,
    });
    const dependents = Array.from({ length: count }, (_, at) =>
      adminQuestion('short_text', {
        title: `Dependente ${at + 1}`,
        condition: { questionId: opener.id, values: [optionIds[0] as string] },
      }),
    );
    return { opener, dependents, questions: [opener, ...dependents] };
  }

  function sheet(
    question: ReturnType<typeof adminQuestion>,
    questions: ReturnType<typeof adminQuestion>[],
  ) {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <QuestionEditorSheet
          open
          mode="edit"
          question={question}
          questions={questions}
          steps={[]}
          tenantName="Ana Mentoria"
          limit={30}
          onClose={onClose}
          onReplace={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
  }
  const alertOf = () => document.querySelector('[data-dependents-alert]') as HTMLElement | null;
  const titles = (el: HTMLElement) =>
    within(el)
      .getAllByRole('listitem')
      .map((li) => li.textContent);

  beforeEach(() => onClose.mockReset());

  it('archive: the client refuses from the list it holds, with the list, and opens no dialog', () => {
    const { opener, questions } = world(3, { answerCount: 4 });
    sheet(opener, questions);
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar pergunta' }));
    const alert = alertOf() as HTMLElement;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('data-dependents-alert')).toBe('archive');
    expect(
      within(alert).getByText('Esta pergunta abre outras e não pode ser arquivada agora.'),
    ).toBeTruthy();
    expect(titles(alert)).toEqual(['Dependente 1', 'Dependente 2', 'Dependente 3']);
    expect(screen.queryByRole('dialog', { name: 'Arquivar esta pergunta?' })).toBeNull();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it('delete: refused the same way, with the delete title', () => {
    const { opener, questions } = world(2);
    sheet(opener, questions);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir pergunta' }));
    const alert = alertOf() as HTMLElement;
    expect(
      within(alert).getByText('Esta pergunta abre outras e não pode ser excluída agora.'),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Excluir esta pergunta?' })).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('the alert sits directly above the footer button, inside the sheet', () => {
    const { opener, questions } = world(1);
    sheet(opener, questions);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir pergunta' }));
    const alert = alertOf() as HTMLElement;
    const saveButton = screen.getByRole('button', { name: 'Salvar pergunta' });
    expect(alert.nextElementSibling).toBe(saveButton);
  });

  it('retype: "Trocar tipo" does not open the grid, the alert appears under the type row', () => {
    const { opener, questions } = world(2);
    sheet(opener, questions);
    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }));
    expect(screen.queryByRole('group', { name: 'Tipo de resposta' })).toBeNull();
    const alert = alertOf() as HTMLElement;
    expect(alert.getAttribute('data-dependents-alert')).toBe('type');
    expect(
      within(alert).getByText('Esta pergunta abre outras e não pode mudar de tipo agora.'),
    ).toBeTruthy();
    // Under the type row, before the title field.
    const title = screen.getByLabelText('Pergunta');
    expect(alert.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a question that opens nothing archives and retypes as before', () => {
    const lone = adminQuestion('single_choice', {
      title: 'Sozinha',
      options: baseOptions,
      answerCount: 2,
    });
    sheet(lone, [lone]);
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar pergunta' }));
    expect(alertOf()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Arquivar esta pergunta?' })).toBeTruthy();
  });

  it('lists five titles and "e mais 2 perguntas" for seven, and "e mais 1 pergunta" for six', () => {
    const seven = world(7, { answerCount: 1 });
    const { unmount } = sheet(seven.opener, seven.questions);
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar pergunta' }));
    expect(titles(alertOf() as HTMLElement)).toHaveLength(5);
    expect(within(alertOf() as HTMLElement).getByText('e mais 2 perguntas')).toBeTruthy();
    unmount();
    const six = world(6, { answerCount: 1 });
    sheet(six.opener, six.questions);
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar pergunta' }));
    expect(within(alertOf() as HTMLElement).getByText('e mais 1 pergunta')).toBeTruthy();
  });

  it('race: archive reaches the server, which answers its own dependents list', async () => {
    // The page does not know the dependents (opensCount 0): the confirmation opens, the server refuses.
    const lone = adminQuestion('single_choice', {
      title: 'Sozinha',
      options: baseOptions,
      answerCount: 2,
    });
    mocks.archive.mockResolvedValue({
      ok: false,
      code: 'hasDependents',
      dependents: Array.from({ length: 6 }, (_, at) => ({
        id: uuid(9900 + at),
        title: `Nova ${at + 1}`,
      })),
    });
    sheet(lone, [lone]);
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar pergunta' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Arquivar esta pergunta?' })).getByRole(
          'button',
          { name: 'Arquivar' },
        ),
      );
    });
    const alert = alertOf() as HTMLElement;
    expect(alert.getAttribute('data-dependents-alert')).toBe('archive');
    expect(titles(alert)).toHaveLength(5);
    expect(within(alert).getByText('e mais 1 pergunta')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('race: a delete answered with has_dependents shows the delete alert', async () => {
    const lone = adminQuestion('single_choice', { title: 'Sozinha', options: baseOptions });
    mocks.remove.mockResolvedValue({
      ok: false,
      code: 'hasDependents',
      dependents: [{ id: uuid(9910), title: 'Surgiu agora' }],
    });
    sheet(lone, [lone]);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir pergunta' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Excluir esta pergunta?' })).getByRole('button', {
          name: 'Excluir',
        }),
      );
    });
    const alert = alertOf() as HTMLElement;
    expect(alert.getAttribute('data-dependents-alert')).toBe('delete');
    expect(titles(alert)).toEqual(['Surgiu agora']);
  });

  it('race: an update that retypes answers with the retype alert under the type row', async () => {
    const lone = adminQuestion('single_choice', { title: 'Sozinha', options: baseOptions });
    mocks.update.mockResolvedValue({
      ok: false,
      code: 'conflict',
      issue: 'has_dependents',
      dependents: [{ id: uuid(9911), title: 'Depende agora' }],
    });
    sheet(lone, [lone]);
    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Lista suspensa/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar pergunta' }));
    });
    const alert = alertOf() as HTMLElement;
    expect(alert.getAttribute('data-dependents-alert')).toBe('type');
    expect(titles(alert)).toEqual(['Depende agora']);
  });
});

describe('12.1-17 Task 2: an option used by a condition (D-632, UI-D-651)', () => {
  const onClose = vi.fn();
  const ids = [uuid(9821), uuid(9822), uuid(9823)];
  const options = [
    { id: ids[0] as string, label: 'Tenho uma clínica', answerCount: 0 },
    { id: ids[1] as string, label: 'Trabalho em uma clínica', answerCount: 0 },
    { id: ids[2] as string, label: 'Estou aprendendo', answerCount: 0 },
  ];
  const opener = adminQuestion('single_choice', {
    title: 'Você tem clínica?',
    options,
    opensCount: 3,
  });
  const dependents = [0, 1, 2].map((at) =>
    adminQuestion('short_text', {
      title: `Dependente ${at + 1}`,
      // The first option opens three questions, the second opens the last one too.
      condition: {
        questionId: opener.id,
        values: at === 2 ? [ids[0] as string, ids[1] as string] : [ids[0] as string],
      },
    }),
  );

  function sheet(question = opener, questions = [opener, ...dependents]) {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <QuestionEditorSheet
          open
          mode="edit"
          question={question}
          questions={questions}
          steps={[]}
          tenantName="Ana Mentoria"
          limit={30}
          onClose={onClose}
          onReplace={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
  }

  beforeEach(() => onClose.mockReset());

  it('shows Split in place of the remove button, with the count and the screen-reader text', () => {
    sheet();
    expect(screen.queryByRole('button', { name: 'Remover opção 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover opção 2' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remover opção 3' })).toBeTruthy();
    const used = document.querySelectorAll('[data-option-used]');
    expect(used).toHaveLength(2);
    expect(used[0]?.className).toContain('size-11');
    expect(used[0]?.textContent).toBe('Opção usada em uma condição. Não pode ser removida.');
    expect(screen.getByText('Abre 3 perguntas')).toBeTruthy();
    expect(screen.getByText('Abre 1 pergunta')).toBeTruthy();
    const note = screen.getByText(
      'As opções que abrem perguntas não podem ser removidas. Você pode renomear e mudar a ordem.',
    );
    expect(note.closest('[role="status"]')).toBeTruthy();
  });

  it('rename and reorder still work on a used option, and the id stays stable', async () => {
    mocks.update.mockResolvedValue({ ok: true, question: opener, pending: null });
    sheet();
    fireEvent.change(screen.getByLabelText('Opção 1'), {
      target: { value: 'Tenho clínica própria' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Descer opção 1' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar pergunta' }));
    });
    const body = mocks.update.mock.calls[0]?.[1] as { options: { id?: string; label: string }[] };
    expect(body.options.map((o) => o.id)).toEqual([ids[1], ids[0], ids[2]]);
    expect(body.options[1]?.label).toBe('Tenho clínica própria');
  });

  it('shows no used-option note, no Split and no caption for an opener-free question', () => {
    const lone = adminQuestion('single_choice', { title: 'Sozinha', options });
    sheet(lone, [lone]);
    expect(document.querySelector('[data-option-used]')).toBeNull();
    expect(screen.queryByText(/não podem ser removidas\. Você pode renomear/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Remover opção 1' })).toBeTruthy();
  });

  it('race: the server refuses a removed option and the alert names it, with the list', async () => {
    // The page did not know about the dependents (the list it holds has none), so the remove button is there.
    const lone = adminQuestion('single_choice', { title: 'Sozinha', options });
    mocks.update.mockResolvedValue({
      ok: false,
      code: 'conflict',
      issue: 'has_dependents',
      dependents: [
        { id: uuid(9930), title: 'Quantas salas?' },
        { id: uuid(9931), title: 'Nome da clínica' },
      ],
    });
    sheet(lone, [lone]);
    fireEvent.click(screen.getByRole('button', { name: 'Remover opção 3' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar pergunta' }));
    });
    const alert = document.querySelector('[data-dependents-alert]') as HTMLElement;
    expect(alert.getAttribute('data-dependents-alert')).toBe('option');
    expect(
      within(alert).getByText(
        'A opção “Estou aprendendo” abre outras perguntas e não pode ser removida agora.',
      ),
    ).toBeTruthy();
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Quantas salas?', 'Nome da clínica']);
  });
});

describe('12.1-17 Task 2: reactivating a shown question whose opener is archived (UI-D-651)', () => {
  const opener = archivedQuestion('single_choice', {
    title: 'Você tem clínica, trabalha em clínica ou está aprendendo?',
    options: [{ id: uuid(9851), label: 'Tenho', answerCount: 0 }],
  });
  const shown = archivedQuestion('short_text', {
    title: 'Nome da clínica',
    required: true,
    condition: { questionId: opener.id, values: [uuid(9851)] },
  });
  const SENTENCE =
    'Para reativar “Nome da clínica”, reative antes “Você tem clínica, trabalha em clínica ou está aprendendo?”, que decide se ela aparece.';

  function list(
    questions = [shown, opener],
    activeQuestions: ReturnType<typeof adminQuestion>[] = [],
  ) {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <ArchivedList
          questions={questions}
          activeCount={3}
          limit={30}
          activeQuestions={activeQuestions}
          timeZone="America/Sao_Paulo"
        />
      </NextIntlClientProvider>,
    );
  }
  const reactivate = (title: string) =>
    screen.getByRole('button', { name: `Reativar pergunta: ${title}` });

  it('opens no dialog, reads no impact and toasts the one sentence', async () => {
    list();
    await act(async () => {
      fireEvent.click(reactivate('Nome da clínica'));
    });
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'error', message: SENTENCE });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.impact).not.toHaveBeenCalled();
    expect(mocks.reactivate).not.toHaveBeenCalled();
  });

  it('lets the same question through once its opener is not archived (it is active)', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 0 });
    mocks.reactivate.mockResolvedValue({ ok: true });
    const activeOpener = adminQuestion('single_choice', { title: 'Abridora ativa' });
    list(
      [{ ...shown, condition: { questionId: activeOpener.id, values: [uuid(9851)] } }],
      [activeOpener],
    );
    await act(async () => {
      fireEvent.click(reactivate('Nome da clínica'));
    });
    expect(mocks.reactivate).toHaveBeenCalledTimes(1);
  });

  it('says the same sentence when the server answers condition_invalid (a race)', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 0 });
    const activeOpener = adminQuestion('single_choice', { title: 'Abridora que saiu agora' });
    mocks.reactivate.mockResolvedValue({
      ok: false,
      code: 'conditionInvalid',
      openerId: activeOpener.id,
    });
    list(
      [{ ...shown, condition: { questionId: activeOpener.id, values: [uuid(9851)] } }],
      [activeOpener],
    );
    await act(async () => {
      fireEvent.click(reactivate('Nome da clínica'));
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message:
        'Para reativar “Nome da clínica”, reative antes “Abridora que saiu agora”, que decide se ela aparece.',
    });
  });

  it('falls back to the failure toast when the server names an opener the page cannot title', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 0 });
    mocks.reactivate.mockResolvedValue({
      ok: false,
      code: 'conditionInvalid',
      openerId: uuid(9999),
    });
    list([{ ...shown, condition: { questionId: uuid(9998), values: [uuid(9851)] } }], []);
    await act(async () => {
      fireEvent.click(reactivate('Nome da clínica'));
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível reativar agora. Tente de novo.',
    });
  });
});

describe('12.1-17 Task 3: ImpactDialog for a conditional question and for a removed condition (D-634, UI-D-649)', () => {
  function impactDialog(props: {
    kind: 'add' | 'make' | 'reactivate' | 'replace' | 'unconditional';
    members: number;
    note?: string;
    conditionNote?: string;
  }) {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <ImpactDialog open onConfirm={vi.fn()} onClose={vi.fn()} {...props} />
      </NextIntlClientProvider>,
    );
  }
  const SENTENCE = 'Só conta quem vê esta pergunta: quem respondeu “Tem clínica?” com “Tenho”.';

  it('the removal case has its own title, plural body and confirm label', () => {
    impactDialog({ kind: 'unconditional', members: 6 });
    const dlg = screen.getByRole('dialog', { name: 'Remover a condição?' });
    expect(dlg.textContent).toContain(
      '6 membros que hoje não veem esta pergunta vão precisar respondê-la antes de continuar usando a comunidade. Quem já respondeu mantém a resposta.',
    );
    expect(within(dlg).getByRole('button', { name: 'Remover e exigir' })).toBeTruthy();
    expect(within(dlg).getByRole('button', { name: 'Voltar' })).toBeTruthy();
  });

  it('the removal case does not repeat the add body', () => {
    impactDialog({ kind: 'unconditional', members: 6 });
    expect(screen.getByRole('dialog').textContent).not.toContain(
      'Quem já respondeu as outras perguntas',
    );
  });

  for (const [kind, title] of [
    ['add', 'Adicionar pergunta obrigatória?'],
    ['make', 'Tornar a pergunta obrigatória?'],
    ['reactivate', 'Reativar pergunta obrigatória?'],
    ['replace', 'Substituir a pergunta?'],
  ] as const) {
    it(`${kind}: the condition sentence closes the body`, () => {
      impactDialog({ kind, members: 2, conditionNote: SENTENCE });
      const body = screen.getByRole('dialog', { name: title }).querySelector('p');
      expect(body?.textContent?.endsWith(SENTENCE)).toBe(true);
    });
  }

  it('without a condition note the Phase 12 bodies are untouched', () => {
    impactDialog({ kind: 'reactivate', members: 2 });
    expect(screen.getByRole('dialog').textContent).toContain(
      'As respostas guardadas continuam valendo.',
    );
    expect(screen.getByRole('dialog').textContent).not.toContain('Só conta quem vê');
  });

  it('the replace note comes before the condition note', () => {
    impactDialog({ kind: 'replace', members: 2, note: 'Nota de troca.', conditionNote: SENTENCE });
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text.indexOf('Nota de troca.')).toBeLessThan(text.indexOf('Só conta quem vê'));
  });
});

describe('12.1-17 Task 3: reactivating a required conditional question (UI-D-649)', () => {
  const opener = adminQuestion('single_choice', {
    title: 'Você tem clínica?',
    options: [
      { id: uuid(9861), label: 'Tenho uma clínica', answerCount: 0 },
      { id: uuid(9862), label: 'Estou aprendendo', answerCount: 0 },
    ],
  });
  const archived = archivedQuestion('short_text', {
    title: 'Nome da clínica',
    required: true,
    condition: { questionId: opener.id, values: [uuid(9861)] },
  });

  function list(question = archived) {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <ArchivedList
          questions={[question]}
          activeCount={3}
          limit={30}
          activeQuestions={[opener]}
          timeZone="America/Sao_Paulo"
        />
      </NextIntlClientProvider>,
    );
  }

  it('ends the impact dialog with who counts', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 3 });
    list();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reativar pergunta: Nome da clínica' }));
    });
    const dlg = await screen.findByRole('dialog', { name: 'Reativar pergunta obrigatória?' });
    expect(dlg.textContent).toContain(
      'Só conta quem vê esta pergunta: quem respondeu “Você tem clínica?” com “Tenho uma clínica”.',
    );
  });

  it('leaves the dialog as it was for an unconditional question', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 3 });
    list({ ...archived, condition: null });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reativar pergunta: Nome da clínica' }));
    });
    const dlg = await screen.findByRole('dialog', { name: 'Reativar pergunta obrigatória?' });
    expect(dlg.textContent).not.toContain('Só conta quem vê');
  });
});
