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
