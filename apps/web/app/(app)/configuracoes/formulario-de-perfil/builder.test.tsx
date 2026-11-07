// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { treeLayoutOf } from '@/lib/profile-form/branch-layout';
import { buildBranchTree } from '@/lib/profile-form/branch-tree';
import {
  adminBranch,
  adminQuestion,
  adminStep,
  archivedQuestion,
  clinicAdminList,
  clinicId,
  uuid,
} from '@/lib/profile-form/test-fixtures';
import type { ImpactActionResult, ReactivateResult, ReorderResult } from './actions';

/**
 * 12-15 Task 2 (D-582, UI-D-567, UI-D-568; T-12-33): the reorder mode of the active list against the
 * REAL catalog. The server action, the router and the toast are stubbed. Asserted: one write carrying ALL
 * the ids, focus kept on the pressed control at its new position, the live-region sentence, the disabled
 * edges, the revert and the toast on a failed write, the module-off and forbidden paths, and that rows
 * are not editor openers while the mode is on.
 */

const mocks = vi.hoisted(() => ({
  reorder: vi.fn(),
  impact: vi.fn(),
  reactivate: vi.fn(),
  refresh: vi.fn(),
  show: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  createStep: vi.fn(),
  renameStep: vi.fn(),
  deleteStep: vi.fn(),
  layout: vi.fn(),
  createBranch: vi.fn(),
  updateBranch: vi.fn(),
  undoBranch: vi.fn(),
  archiveBranch: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('./actions', () => ({
  reorderQuestionsAction: (ids: string[]) => mocks.reorder(ids),
  readImpactAction: (input: unknown) => mocks.impact(input),
  reactivateQuestionAction: (id: string) => mocks.reactivate(id),
  reactivateBranchAction: vi.fn(),
  createQuestionAction: (...args: unknown[]) => mocks.create(...args),
  createStepAction: (...args: unknown[]) => mocks.createStep(...args),
  renameStepAction: (...args: unknown[]) => mocks.renameStep(...args),
  deleteStepAction: (...args: unknown[]) => mocks.deleteStep(...args),
  reorderLayoutAction: (...args: unknown[]) => mocks.layout(...args),
  createBranchAction: (...args: unknown[]) => mocks.createBranch(...args),
  updateBranchAction: (...args: unknown[]) => mocks.updateBranch(...args),
  undoBranchAction: (...args: unknown[]) => mocks.undoBranch(...args),
  archiveBranchAction: (...args: unknown[]) => mocks.archiveBranch(...args),
}));
vi.mock('@/app/(auth)/completar-perfil/actions', () => ({
  saveProfileFormAction: (...args: unknown[]) => mocks.save(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: mocks.show, dismiss: vi.fn() }),
}));

const { QuestionList } = await import('./QuestionList');
const { ArchivedList } = await import('./ArchivedList');
const { QuestionBuilder } = await import('./QuestionBuilder');

const A = adminQuestion('short_text', { title: 'Cargo' });
const B = adminQuestion('dropdown', { title: 'Origem' });
const C = adminQuestion('acceptance', { title: 'Regulamento' });

function show(
  questions = [A, B, C],
  props: {
    onOpen?: (id: string) => void;
    branches?: ReturnType<typeof adminBranch>[];
    steps?: ReturnType<typeof adminStep>[];
    onEditBranch?: (branchId: string) => void;
    onAddToBranch?: (branchId: string, stepId: string) => void;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <QuestionList
        questions={questions}
        limit={30}
        steps={props.steps}
        branches={props.branches}
        onOpen={props.onOpen ? (question) => props.onOpen?.(question.id) : undefined}
        onEditBranch={props.onEditBranch ? (branch) => props.onEditBranch?.(branch.id) : undefined}
        onAddToBranch={
          props.onAddToBranch
            ? (branch, stepId) => props.onAddToBranch?.(branch.id, stepId)
            : undefined
        }
      />
    </NextIntlClientProvider>,
  );
}

const reorderButton = () => screen.getByRole('button', { name: /^(Reordenar|Concluir)$/ });
const up = (title: string) => screen.getByRole('button', { name: `Subir “${title}”` });
const down = (title: string) => screen.getByRole('button', { name: `Descer “${title}”` });
/** The titles of the rows, in DOM order. */
const order = () =>
  screen
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.line-clamp-3')?.textContent ?? '');
const live = () => document.querySelector('[data-reorder-live]')?.textContent ?? '';

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.reorder.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('reorder mode: the toggle and the rows (UI-D-567)', () => {
  it('toggles "Reordenar" to "Concluir" with aria-pressed, and rows stop being editor openers', () => {
    show();
    expect(reorderButton().getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Editar pergunta: Cargo' })).toBeTruthy();

    fireEvent.click(reorderButton());
    expect(reorderButton().textContent).toBe('Concluir');
    expect(reorderButton().getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /^Editar pergunta:/ })).toBeNull();
    expect(up('Cargo')).toBeTruthy();
    expect(down('Regulamento')).toBeTruthy();
  });

  it('opens the editor only outside the mode, through the onOpen prop', () => {
    const onOpen = vi.fn();
    show([A, B, C], { onOpen });
    fireEvent.click(screen.getByRole('button', { name: 'Editar pergunta: Origem' }));
    expect(onOpen).toHaveBeenCalledWith(B.id);
    fireEvent.click(reorderButton());
    expect(screen.queryByRole('button', { name: /^Editar pergunta:/ })).toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('disables "Subir" on the first row and "Descer" on the last, and both for a list of one', () => {
    show();
    fireEvent.click(reorderButton());
    expect((up('Cargo') as HTMLButtonElement).disabled).toBe(true);
    expect((down('Cargo') as HTMLButtonElement).disabled).toBe(false);
    expect((up('Regulamento') as HTMLButtonElement).disabled).toBe(false);
    expect((down('Regulamento') as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    show([A]);
    fireEvent.click(reorderButton());
    expect((up('Cargo') as HTMLButtonElement).disabled).toBe(true);
    expect((down('Cargo') as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives each reorder button a 44px target and a name that includes the question title', () => {
    show();
    fireEvent.click(reorderButton());
    expect(up('Origem').className).toContain('min-h-[44px]');
    expect(up('Origem').className).toContain('min-w-[44px]');
    expect(down('Origem').getAttribute('aria-label')).toBe('Descer “Origem”');
  });
});

describe('reorder mode: one write per move (D-582)', () => {
  it('moves the row, saves ALL the active ids in the new order and announces the position', async () => {
    show();
    fireEvent.click(reorderButton());
    await act(async () => {
      fireEvent.click(down('Cargo'));
    });
    expect(mocks.reorder).toHaveBeenCalledTimes(1);
    // the whole list, not only the moved pair
    expect(mocks.reorder).toHaveBeenCalledWith([B.id, A.id, C.id]);
    expect(order()).toEqual(['Origem', 'Cargo', 'Regulamento']);
    expect(live()).toBe('“Cargo” agora é a pergunta 2 de 3.');
  });

  it('numbers the rows by their new position', async () => {
    show();
    fireEvent.click(reorderButton());
    await act(async () => {
      fireEvent.click(up('Regulamento'));
    });
    const positions = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector('[aria-hidden="true"].w-5')?.textContent);
    expect(positions).toEqual(['1', '2', '3']);
    expect(order()).toEqual(['Cargo', 'Regulamento', 'Origem']);
  });

  it('keeps focus on the pressed control at its new position', async () => {
    show();
    fireEvent.click(reorderButton());
    await act(async () => {
      fireEvent.click(down('Cargo'));
    });
    expect(document.activeElement).toBe(down('Cargo'));
    await act(async () => {
      fireEvent.click(up('Regulamento'));
    });
    // Regulamento moved from last to second and its "Subir" is still enabled
    expect(order()).toEqual(['Origem', 'Regulamento', 'Cargo']);
    expect(document.activeElement).toBe(up('Regulamento'));
  });

  it('hands focus to the sibling control when the pressed one is disabled at an edge', async () => {
    show();
    fireEvent.click(reorderButton());
    await act(async () => {
      fireEvent.click(up('Origem'));
    });
    // Origem is now first: "Subir" is disabled, so "Descer" of the same row takes the focus
    expect(order()[0]).toBe('Origem');
    expect((up('Origem') as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(down('Origem'));
  });

  it('ignores a second press while a write is in flight and marks the buttons busy', async () => {
    let release: (value: ReorderResult) => void = () => {};
    mocks.reorder.mockReturnValue(
      new Promise<ReorderResult>((resolve) => {
        release = resolve;
      }),
    );
    show();
    fireEvent.click(reorderButton());
    await act(async () => {
      fireEvent.click(down('Cargo'));
    });
    expect(down('Cargo').getAttribute('aria-busy')).toBe('true');
    expect(up('Regulamento').getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      fireEvent.click(up('Regulamento'));
    });
    expect(mocks.reorder).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ ok: true });
    });
    expect(down('Cargo').getAttribute('aria-busy')).toBeNull();
    // and the screen refreshes only when the mode ends
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(reorderButton());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes the page when "Concluir" ends the mode', () => {
    show();
    fireEvent.click(reorderButton());
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(reorderButton());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Editar pergunta: Cargo' })).toBeTruthy();
  });
});

describe('reorder mode: failures (UI-D-567, UI-D-568)', () => {
  it('puts the row back and toasts when the write fails', async () => {
    mocks.reorder.mockResolvedValue({ ok: false, code: 'failed' });
    show();
    fireEvent.click(reorderButton());
    await act(async () => {
      fireEvent.click(down('Cargo'));
    });
    expect(order()).toEqual(['Cargo', 'Origem', 'Regulamento']);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar a nova ordem. A lista voltou como estava.',
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(live()).toBe('');
    // the pressed control keeps focus at the old position
    expect(document.activeElement).toBe(down('Cargo'));
  });

  it('treats a thrown action like a failed write', async () => {
    mocks.reorder.mockRejectedValue(new Error('network'));
    show();
    fireEvent.click(reorderButton());
    await act(async () => {
      fireEvent.click(down('Cargo'));
    });
    expect(order()).toEqual(['Cargo', 'Origem', 'Regulamento']);
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  it('toasts the module-off sentence and refreshes into the not-found page', async () => {
    mocks.reorder.mockResolvedValue({ ok: false, code: 'moduleOff' });
    show();
    fireEvent.click(reorderButton());
    await act(async () => {
      fireEvent.click(down('Cargo'));
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'O Formulário de perfil foi desativado para esta comunidade.',
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(order()).toEqual(['Cargo', 'Origem', 'Regulamento']);
  });

  it('reuses the shipped forbidden toast and the same refresh for a lost permission', async () => {
    mocks.reorder.mockResolvedValue({ ok: false, code: 'forbidden' });
    show();
    fireEvent.click(reorderButton());
    await act(async () => {
      fireEvent.click(down('Cargo'));
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Você não tem mais permissão para esta ação.',
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes and toasts the failed-order sentence when the list changed under the admin', async () => {
    mocks.reorder.mockResolvedValue({ ok: false, code: 'mismatch' });
    show();
    fireEvent.click(reorderButton());
    await act(async () => {
      fireEvent.click(down('Cargo'));
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar a nova ordem. A lista voltou como estava.',
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('the list itself', () => {
  it('has a polite live region from the first render and never fetches', () => {
    const { container } = show();
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toBeTruthy();
    expect(within(container).getAllByRole('listitem')).toHaveLength(3);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fireEvent.click(reorderButton());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* Task 3: the Arquivadas tab, "Reativar" and the impact confirmation (D-585, D-588, UI-D-576/578).   */
/* ------------------------------------------------------------------------------------------------ */

const OPTIONAL = archivedQuestion('short_text', {
  title: 'Cargo antigo',
  required: false,
  answerCount: 4,
  archivedAt: '2026-10-20T15:30:00.000Z',
});
const REQUIRED = archivedQuestion('phone', {
  title: 'Telefone antigo',
  required: true,
  answerCount: 1,
  archivedAt: '2026-10-21T02:30:00.000Z',
});
const NEVER_ANSWERED = archivedQuestion('link', {
  title: 'Site',
  required: false,
  answerCount: 0,
});

function showArchived(
  questions = [OPTIONAL, REQUIRED, NEVER_ANSWERED],
  props: { activeCount?: number; limit?: number; timeZone?: string } = {},
) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <ArchivedList
        questions={questions}
        activeCount={props.activeCount ?? 3}
        limit={props.limit ?? 30}
        timeZone={props.timeZone ?? 'America/Sao_Paulo'}
      />
    </NextIntlClientProvider>,
  );
}

const reactivateButton = (title: string) =>
  screen.getByRole('button', { name: `Reativar pergunta: ${title}` }) as HTMLButtonElement;
const dialog = (name: string) => screen.getByRole('dialog', { name });

describe('ArchivedList: the rows (UI-D-578)', () => {
  it('shows the note, then a card per question with type, date, answers kept and the state', () => {
    const { container } = showArchived();
    const text = container.textContent ?? '';
    expect(text).toContain(
      'Perguntas arquivadas não são mais feitas aos membros. As respostas continuam guardadas e entram na exportação.',
    );
    expect(text).toContain(
      'Ao reativar uma pergunta obrigatória, quem ainda não a respondeu volta a ser chamado para responder.',
    );
    expect(text).toContain('Cargo antigo');
    expect(text).toContain('Texto curto');
    expect(text).toContain('Arquivada em 20/10/2026 · 4 respostas guardadas');
    expect(text).toContain('Era opcional');
    expect(text).toContain('Era obrigatória');
    // 02:30 UTC on the 21st is 23:30 on the 20th in the tenant's zone
    expect(text).toContain('Arquivada em 20/10/2026 · 1 resposta guardada');
    expect(text).toContain('Sem respostas guardadas');
  });

  it('reads the date in the tenant time zone, not in UTC', () => {
    // 02:30 UTC on the 21st is still the 20th in São Paulo
    showArchived([REQUIRED], { timeZone: 'America/Sao_Paulo' });
    expect(document.body.textContent).toContain('Arquivada em 20/10/2026');
    cleanup();
    showArchived([REQUIRED], { timeZone: 'UTC' });
    expect(document.body.textContent).toContain('Arquivada em 21/10/2026');
  });

  it('never makes a row an editor opener: the only buttons are the Reativar ones', () => {
    showArchived();
    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual([
      'Reativar pergunta: Cargo antigo',
      'Reativar pergunta: Telefone antigo',
      'Reativar pergunta: Site',
    ]);
    expect(screen.queryByRole('button', { name: /^Editar pergunta:/ })).toBeNull();
  });

  it('wraps a long title and keeps Reativar on its own line below', () => {
    const long = archivedQuestion('short_text', { title: 'x'.repeat(120) });
    const { container } = showArchived([long]);
    expect(container.querySelector('h3')?.className).toContain('break-words');
    const button = reactivateButton(long.title);
    // the button sits in its own block after the text block, never beside the title
    expect(button.parentElement?.previousElementSibling?.querySelector('h3')).toBeTruthy();
  });

  it('shows the empty state when nothing is archived', () => {
    showArchived([]);
    expect(screen.getByText('Nenhuma pergunta arquivada')).toBeTruthy();
    expect(
      screen.getByText(
        'Quando você arquivar uma pergunta, ela aparece aqui com as respostas guardadas.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ArchivedList: Reativar an OPTIONAL question', () => {
  it('opens the brand confirmation, reads no impact, reactivates and toasts', async () => {
    mocks.reactivate.mockResolvedValue({ ok: true } satisfies ReactivateResult);
    showArchived();
    fireEvent.click(reactivateButton('Cargo antigo'));
    const confirm = dialog('Reativar pergunta?');
    expect(confirm.textContent).toContain(
      'Ela volta ao fim do formulário e as respostas guardadas voltam a valer.',
    );
    expect(mocks.impact).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Reativar' }));
    });
    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledWith(OPTIONAL.id));
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Pergunta reativada.' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the admin goes back', async () => {
    showArchived();
    fireEvent.click(reactivateButton('Cargo antigo'));
    await act(async () => {
      fireEvent.click(within(dialog('Reativar pergunta?')).getByRole('button', { name: 'Voltar' }));
    });
    expect(mocks.reactivate).not.toHaveBeenCalled();
    expect(mocks.impact).not.toHaveBeenCalled();
  });

  it('toasts and changes nothing when the write fails', async () => {
    mocks.reactivate.mockResolvedValue({ ok: false, code: 'failed' } satisfies ReactivateResult);
    showArchived();
    fireEvent.click(reactivateButton('Cargo antigo'));
    await act(async () => {
      fireEvent.click(
        within(dialog('Reativar pergunta?')).getByRole('button', { name: 'Reativar' }),
      );
    });
    await waitFor(() =>
      expect(mocks.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível reativar agora. Tente de novo.',
      }),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('treats a thrown action like a failed write', async () => {
    mocks.reactivate.mockRejectedValue(new Error('network'));
    showArchived();
    fireEvent.click(reactivateButton('Cargo antigo'));
    await act(async () => {
      fireEvent.click(
        within(dialog('Reativar pergunta?')).getByRole('button', { name: 'Reativar' }),
      );
    });
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));
    expect(mocks.show.mock.calls[0]?.[0]).toMatchObject({ tone: 'error' });
  });

  it('answers the limit refusal of the server with the limit sentence and a refresh', async () => {
    mocks.reactivate.mockResolvedValue({ ok: false, code: 'limit' } satisfies ReactivateResult);
    showArchived();
    fireEvent.click(reactivateButton('Cargo antigo'));
    await act(async () => {
      fireEvent.click(
        within(dialog('Reativar pergunta?')).getByRole('button', { name: 'Reativar' }),
      );
    });
    await waitFor(() =>
      expect(mocks.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Você chegou ao limite de 30 perguntas ativas. Arquive uma para adicionar outra.',
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('sends a lost permission and a module turned off to a refresh with their own toast', async () => {
    mocks.reactivate.mockResolvedValue({ ok: false, code: 'forbidden' } satisfies ReactivateResult);
    showArchived();
    fireEvent.click(reactivateButton('Cargo antigo'));
    await act(async () => {
      fireEvent.click(
        within(dialog('Reativar pergunta?')).getByRole('button', { name: 'Reativar' }),
      );
    });
    await waitFor(() =>
      expect(mocks.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Você não tem mais permissão para esta ação.',
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    mocks.show.mockReset();
    mocks.refresh.mockReset();
    mocks.reactivate.mockResolvedValue({ ok: false, code: 'moduleOff' } satisfies ReactivateResult);
    fireEvent.click(reactivateButton('Site'));
    await act(async () => {
      fireEvent.click(
        within(dialog('Reativar pergunta?')).getByRole('button', { name: 'Reativar' }),
      );
    });
    await waitFor(() =>
      expect(mocks.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'O Formulário de perfil foi desativado para esta comunidade.',
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('ArchivedList: Reativar a REQUIRED question (D-585, UI-D-576, T-12-34)', () => {
  it('reads the impact first and opens the impact dialog with the plural body', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 12 } satisfies ImpactActionResult);
    mocks.reactivate.mockResolvedValue({ ok: true } satisfies ReactivateResult);
    showArchived();
    fireEvent.click(reactivateButton('Telefone antigo'));
    const confirm = await screen.findByRole('dialog', { name: 'Reativar pergunta obrigatória?' });
    expect(mocks.impact).toHaveBeenCalledWith({ change: 'reactivate', questionId: REQUIRED.id });
    expect(confirm.textContent).toContain(
      '12 membros vão precisar responder antes de continuar usando a comunidade. Quem já respondeu as outras perguntas responde só esta. As respostas guardadas continuam valendo.',
    );
    // nothing is written until the admin confirms
    expect(mocks.reactivate).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Reativar e exigir' }));
    });
    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledWith(REQUIRED.id));
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Pergunta reativada.' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('uses the singular body for one member', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 1 } satisfies ImpactActionResult);
    showArchived();
    fireEvent.click(reactivateButton('Telefone antigo'));
    const confirm = await screen.findByRole('dialog', { name: 'Reativar pergunta obrigatória?' });
    expect(confirm.textContent).toContain(
      '1 membro vai precisar responder antes de continuar usando a comunidade.',
    );
  });

  it('writes nothing when the admin goes back from the impact dialog', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 3 } satisfies ImpactActionResult);
    showArchived();
    fireEvent.click(reactivateButton('Telefone antigo'));
    const confirm = await screen.findByRole('dialog', { name: 'Reativar pergunta obrigatória?' });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Voltar' }));
    });
    expect(mocks.reactivate).not.toHaveBeenCalled();
  });

  it('reactivates directly, with no dialog, when the impact is zero members', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 0 } satisfies ImpactActionResult);
    mocks.reactivate.mockResolvedValue({ ok: true } satisfies ReactivateResult);
    showArchived();
    await act(async () => {
      fireEvent.click(reactivateButton('Telefone antigo'));
    });
    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledWith(REQUIRED.id));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Pergunta reativada.' });
  });

  it('does NOT write when the impact read fails, and says so', async () => {
    mocks.impact.mockResolvedValue({ ok: false, code: 'failed' } satisfies ImpactActionResult);
    showArchived();
    await act(async () => {
      fireEvent.click(reactivateButton('Telefone antigo'));
    });
    await waitFor(() =>
      expect(mocks.show).toHaveBeenCalledWith({
        tone: 'error',
        message:
          'Não foi possível calcular quantos membros serão afetados. Nada foi salvo. Tente de novo.',
      }),
    );
    expect(mocks.reactivate).toHaveBeenCalledTimes(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('does NOT write when the impact action throws', async () => {
    mocks.impact.mockRejectedValue(new Error('network'));
    showArchived();
    await act(async () => {
      fireEvent.click(reactivateButton('Telefone antigo'));
    });
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));
    expect(mocks.reactivate).toHaveBeenCalledTimes(0);
  });

  it('sends a forbidden or module-off impact read to a refresh, still without a write', async () => {
    mocks.impact.mockResolvedValue({ ok: false, code: 'moduleOff' } satisfies ImpactActionResult);
    showArchived();
    await act(async () => {
      fireEvent.click(reactivateButton('Telefone antigo'));
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'O Formulário de perfil foi desativado para esta comunidade.',
    });
    expect(mocks.reactivate).toHaveBeenCalledTimes(0);
  });
});

describe('ArchivedList: the active limit', () => {
  it('opens no dialog, reads and writes nothing, and says the limit sentence', async () => {
    showArchived([OPTIONAL, REQUIRED], { activeCount: 30, limit: 30 });
    await act(async () => {
      fireEvent.click(reactivateButton('Cargo antigo'));
    });
    await act(async () => {
      fireEvent.click(reactivateButton('Telefone antigo'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.impact).not.toHaveBeenCalled();
    expect(mocks.reactivate).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledTimes(2);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Você chegou ao limite de 30 perguntas ativas. Arquive uma para adicionar outra.',
    });
  });
});

describe('"Adicionar pergunta" (12-16, UI-D-565)', () => {
  function showWithAdd(questions = [A, B, C], limit = 30) {
    const onAdd = vi.fn();
    render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <QuestionList questions={questions} limit={limit} onAdd={onAdd} />
      </NextIntlClientProvider>,
    );
    return onAdd;
  }
  const addButton = () => screen.getByRole('button', { name: 'Adicionar pergunta' });

  it('joins the actions row as the brand button and calls onAdd', () => {
    const onAdd = showWithAdd();
    expect(addButton().className).toContain('bg-button');
    fireEvent.click(addButton());
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('is disabled at the active limit, where the limit line is shown', () => {
    showWithAdd([A, B, C], 3);
    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-limit-line]')).not.toBeNull();
  });

  it('is absent when the host gives no onAdd', () => {
    show();
    expect(screen.queryByRole('button', { name: 'Adicionar pergunta' })).toBeNull();
  });
});

describe('QuestionBuilder: the host of the list, the empty state and the editor sheet (12-16)', () => {
  function host(questions = [A, B, C]) {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <QuestionBuilder questions={questions} limit={30} tenantName="Ana Mentoria" />
      </NextIntlClientProvider>,
    );
  }

  it('makes "Adicionar pergunta" the call to action of the empty state and opens the sheet', () => {
    host([]);
    expect(screen.getByText('Seu formulário ainda está vazio')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pergunta' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Nova pergunta')).toBeTruthy();
  });

  it('opens a fresh create sheet from the list action each time', () => {
    host();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pergunta' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Tipo de resposta' })).toBeTruthy();
  });

  it("opens the sheet in edit mode with the row's data when a row is tapped", () => {
    host();
    fireEvent.click(screen.getByRole('button', { name: 'Editar pergunta: Origem' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Editar pergunta' })).toBeTruthy();
    expect((within(dialog).getByLabelText('Pergunta') as HTMLInputElement).value).toBe('Origem');
    expect(within(dialog).getByText('Tipo: Lista suspensa')).toBeTruthy();
  });

  it('re-opens the same question with a fresh draft after the sheet was closed', () => {
    host();
    fireEvent.click(screen.getByRole('button', { name: 'Editar pergunta: Cargo' }));
    fireEvent.change(screen.getByLabelText('Pergunta'), { target: { value: 'Mexi' } });
    fireEvent.click(screen.getByRole('dialog').previousElementSibling as HTMLElement);
    expect(screen.getByText('Descartar as alterações?')).toBeTruthy();
  });

  it('moves from an answered question to the replace flow, with the old data copied', () => {
    const answered = adminQuestion('single_choice', {
      title: 'Como conheceu?',
      answerCount: 5,
      options: [
        { id: uuid(9301), label: 'Instagram', answerCount: 3 },
        { id: uuid(9302), label: 'Indicação', answerCount: 2 },
      ],
    });
    host([answered]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar pergunta: Como conheceu?' }));
    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'Criar nova pergunta e arquivar esta',
      })[0] as HTMLElement,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Substituir pergunta' })).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'Tipo de resposta' })).toBeTruthy();
    expect(
      within(dialog).getByText(/“Como conheceu\?” será arquivada quando você salvar esta/),
    ).toBeTruthy();
  });
});

describe('"Ver como o membro vê": the real form in a preview sheet (12-17, UI-D-580, PU-8, PFORM-23)', () => {
  const opts = [
    { id: uuid(9401), label: 'Instagram', answerCount: 3 },
    { id: uuid(9402), label: 'Indicação', answerCount: 2 },
  ];
  const everyKind = () => [
    adminQuestion('short_text', {
      title: 'Qual é o seu cargo?',
      required: true,
      showOnProfile: true,
      answerCount: 7,
    }),
    adminQuestion('long_text', { title: 'Texto longo' }),
    adminQuestion('dropdown', { title: 'Lista', options: opts, allowOther: true }),
    adminQuestion('multiple_choice', { title: 'Várias', options: opts }),
    adminQuestion('single_choice', { title: 'Uma', options: opts }),
    adminQuestion('number', { title: 'Número' }),
    adminQuestion('date', { title: 'Data' }),
    adminQuestion('phone', { title: 'Telefone' }),
    adminQuestion('email', { title: 'E-mail' }),
    adminQuestion('link', { title: 'Link' }),
    adminQuestion('yes_no', { title: 'Sim ou não' }),
    adminQuestion('acceptance', { title: 'Aceite', required: true }),
    adminQuestion('rating', { title: 'Nota', required: true }),
  ];

  function host(questions = everyKind()) {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <QuestionBuilder questions={questions} limit={30} tenantName="Ana Mentoria" />
      </NextIntlClientProvider>,
    );
  }
  const opener = () => screen.getByRole('button', { name: 'Ver como o membro vê' });
  const sheet = () => screen.queryByRole('dialog', { name: 'Como o membro vê' });

  it('is a ghost button in the actions row, disabled with no active question', () => {
    render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <QuestionList questions={[]} limit={30} onPreview={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect((opener() as HTMLButtonElement).disabled).toBe(true);
  });

  it('is enabled beside "Adicionar pergunta" and "Reordenar" when a question exists', () => {
    host([A]);
    expect((opener() as HTMLButtonElement).disabled).toBe(false);
    const row = opener().parentElement as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Adicionar pergunta' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Reordenar' })).toBeTruthy();
  });

  it('is not offered by the empty state (no actions row without a question)', () => {
    host([]);
    expect(screen.queryByRole('button', { name: 'Ver como o membro vê' })).toBeNull();
  });

  it('opens "Como o membro vê" with the banner, every active question in the admin order, and no Salvar or Sair', () => {
    const questions = everyKind();
    host(questions);
    fireEvent.click(opener());
    const dialog = sheet() as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(
      within(dialog).getByText('Prévia: nada do que você preencher aqui é salvo.'),
    ).toBeTruthy();
    // Every active question, in the order of the list (the order members see).
    const form = dialog.querySelector('form') as HTMLFormElement;
    const text = form.textContent ?? '';
    let last = -1;
    for (const title of ['Qual é o seu cargo?', 'Texto longo', 'Lista', 'Várias', 'Uma', 'Nota']) {
      const at = text.indexOf(title);
      expect(at, title).toBeGreaterThan(last);
      last = at;
    }
    expect(within(dialog).getAllByText('Obrigatória')).toHaveLength(3);
    // The public notice shows because the flag is on, exactly as the member sees it.
    expect(within(dialog).getByText('Esta resposta aparece no seu perfil.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Sair/ })).toBeNull();
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(within(dialog).getAllByRole('button', { name: 'Fechar' })).toHaveLength(1);
  });

  it('shows the first-time member: nothing pre-filled, nothing flagged, no member answer or count', () => {
    host();
    fireEvent.click(opener());
    const dialog = sheet() as HTMLElement;
    expect((within(dialog).getByLabelText('Qual é o seu cargo?') as HTMLInputElement).value).toBe(
      '',
    );
    expect(dialog.querySelector('[data-flagged]')).toBeNull();
    expect(within(dialog).queryByText('Falta responder')).toBeNull();
    expect(within(dialog).queryByRole('status')).toBeNull();
    // An admin-side aggregate (7 answers) never reaches the member form.
    expect(dialog.textContent).not.toMatch(/\b7\b/);
    expect(dialog.textContent).not.toMatch(/\d+ respostas?/);
  });

  it('sends nothing: after touching all 13 control kinds, no fetch and no server action ran', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      host();
      fireEvent.click(opener());
      const dialog = sheet() as HTMLElement;
      const inside = within(dialog);
      fireEvent.change(inside.getByLabelText('Qual é o seu cargo?'), { target: { value: 'novo' } });
      fireEvent.change(inside.getByLabelText('Texto longo'), { target: { value: 'longo' } });
      fireEvent.change(inside.getByLabelText('Lista'), { target: { value: '__other__' } });
      fireEvent.change(inside.getByLabelText('Qual?'), { target: { value: 'outra' } });
      fireEvent.click(inside.getAllByRole('checkbox', { name: 'Instagram' })[0] as HTMLElement);
      fireEvent.click(inside.getAllByRole('radio', { name: 'Indicação' })[0] as HTMLElement);
      fireEvent.change(inside.getByLabelText('Número'), { target: { value: '12,5' } });
      fireEvent.change(inside.getByLabelText('Data'), { target: { value: '2026-05-01' } });
      fireEvent.change(inside.getByLabelText('Telefone'), { target: { value: '11912345678' } });
      fireEvent.change(inside.getByLabelText('E-mail'), { target: { value: 'a@b.co' } });
      fireEvent.change(inside.getByLabelText('Link'), { target: { value: 'https://x.co' } });
      fireEvent.click(inside.getByRole('button', { name: 'Sim' }));
      fireEvent.click(inside.getByRole('checkbox', { name: 'Aceite' }));
      fireEvent.click(inside.getByRole('radio', { name: '4 estrelas' }));
      expect((inside.getByLabelText('Qual é o seu cargo?') as HTMLInputElement).value).toBe('novo');
      await act(async () => {
        fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
      });
      fireEvent.click(inside.getByRole('button', { name: 'Fechar' }));

      expect(fetchSpy).not.toHaveBeenCalled();
      for (const name of [
        'reorder',
        'impact',
        'reactivate',
        'create',
        'save',
        'refresh',
        'createStep',
        'renameStep',
        'deleteStep',
        'layout',
      ] as const) {
        expect(mocks[name], name).not.toHaveBeenCalled();
      }
      expect(mocks.show).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('closes at once on Fechar, on Escape and on the backdrop (no dirty guard in a preview)', async () => {
    host();
    fireEvent.click(opener());
    fireEvent.change(screen.getByLabelText('Qual é o seu cargo?'), { target: { value: 'x' } });
    fireEvent.click(within(sheet() as HTMLElement).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(sheet()).toBeNull());

    fireEvent.click(opener());
    fireEvent.change(screen.getByLabelText('Qual é o seu cargo?'), { target: { value: 'y' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(sheet()).toBeNull());
    expect(screen.queryByText('Descartar as alterações?')).toBeNull();

    fireEvent.click(opener());
    fireEvent.click((sheet() as HTMLElement).previousElementSibling as HTMLElement);
    await waitFor(() => expect(sheet()).toBeNull());
  });

  it('starts every opening from a blank form again', async () => {
    host();
    fireEvent.click(opener());
    fireEvent.change(screen.getByLabelText('Qual é o seu cargo?'), { target: { value: 'sobrou' } });
    fireEvent.click(within(sheet() as HTMLElement).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(sheet()).toBeNull());
    fireEvent.click(opener());
    expect((screen.getByLabelText('Qual é o seu cargo?') as HTMLInputElement).value).toBe('');
  });
});

describe('previewForm: the pure member form for a first-time viewer (12-17, PFORM-23)', () => {
  it('copies the definitions, nulls every answer and strips every admin-side count', async () => {
    const { previewForm } = await import('./PreviewSheet');
    const q = adminQuestion('single_choice', {
      title: 'Uma',
      required: true,
      answerCount: 9,
      options: [{ id: uuid(9501), label: 'A', answerCount: 4 }],
    });
    const result = previewForm([q]);
    expect(result.mode).toBe('first');
    expect(result.missingRequired).toBe(0);
    expect(result.questions).toHaveLength(1);
    const member = result.questions[0] as Record<string, unknown>;
    expect(member.answer).toBeNull();
    expect(member.title).toBe('Uma');
    expect(member.options).toEqual([{ id: uuid(9501), label: 'A' }]);
    expect(JSON.stringify(result)).not.toContain('answerCount');
    expect(Object.keys(member)).not.toContain('revision');
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* 12.1-16: steps in the builder (D-623, D-627, D-633; PFORM-27, PFORM-28, PFORM-37, PFORM-42).        */
/* ------------------------------------------------------------------------------------------------ */

const S1 = adminStep({ title: 'Informações gerais', questionCount: 2 });
const S2 = adminStep({ title: 'Sobre a sua clínica', questionCount: 2 });
const S3 = adminStep({ title: 'Contato', questionCount: 1 });
const S4 = adminStep({ title: 'Rotina', questionCount: 0 });

const QA = adminQuestion('single_choice', {
  title: 'Tem clínica?',
  stepId: S1.id,
  required: true,
  opensCount: 1,
  options: [{ id: uuid(9601), label: 'Tenho clínica', answerCount: 0 }],
});
const QB = adminQuestion('short_text', { title: 'Nome profissional', stepId: S1.id });
/** 12.2-15: the branch that QC sits in (the opener QA lives in ANOTHER step, D-643). */
const BR1 = adminBranch({
  openerQuestionId: QA.id,
  values: [uuid(9601)],
  questionCount: 1,
});
const QC = adminQuestion('short_text', {
  title: 'Nome da clínica',
  stepId: S2.id,
  branchId: BR1.id,
});
const QD = adminQuestion('number', { title: 'Quantas pessoas?', stepId: S2.id });
const QE = adminQuestion('phone', { title: 'Telefone', stepId: S3.id });

/** Four steps: the last one empty. The numbers across the form are QA 1, QB 2, QC 3, QD 4, QE 5. */
const FOUR_STEPS = {
  questions: [QA, QB, QC, QD, QE],
  steps: [S1, S2, S3, S4],
  branches: [BR1],
};

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function builder(
  props: {
    questions: ReturnType<typeof adminQuestion>[];
    steps: ReturnType<typeof adminStep>[];
    branches?: ReturnType<typeof adminBranch>[];
  },
  limit = 30,
) {
  const element = (next: typeof props) => (
    <Providers>
      <QuestionBuilder
        questions={next.questions}
        steps={next.steps}
        branches={next.branches}
        limit={limit}
        tenantName="Ana Mentoria"
      />
    </Providers>
  );
  const view = render(element(props));
  return { ...view, again: (next: typeof props) => view.rerender(element(next)) };
}

const well = (name: string) => screen.getByRole('region', { name });
const wellTitles = () =>
  screen.queryAllByRole('region').map((el) => el.querySelector('h3')?.textContent);
/** The `li` that are question rows; the `li` that only wraps a branch block (12.2-15) is not a row. */
const isRowItem = (item: HTMLElement) =>
  !(item.firstElementChild as HTMLElement | null)?.className.includes('border-l-2');
const rowTitles = (name: string) =>
  within(well(name))
    .queryAllByRole('listitem')
    .filter(isRowItem)
    .map((item) => item.querySelector('.line-clamp-3')?.textContent ?? '');
const stepUp = (title: string) => screen.getByRole('button', { name: `Subir etapa “${title}”` });
const stepDown = (title: string) => screen.getByRole('button', { name: `Descer etapa “${title}”` });
const questionUp = (title: string) => screen.getByRole('button', { name: `Subir “${title}”` });
const questionDown = (title: string) => screen.getByRole('button', { name: `Descer “${title}”` });
const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;
const positions = () =>
  screen
    .getAllByRole('listitem')
    .filter(isRowItem)
    .map((item) => item.querySelector('[aria-hidden="true"].w-5')?.textContent);
const stepsNote =
  'Os membros respondem uma etapa por vez e avançam com “Avançar”. Uma etapa sem pergunta visível para o membro é pulada.';

describe('12.1-16 Task 1 (tracer): "Adicionar etapa" turns the flat list into step wells (UI-D-642, UI-D-643)', () => {
  it('ONE step is Phase 12: the flat list, no step chrome, plus the new outline button in the actions row', () => {
    const { container } = builder({ questions: [QA, QB], steps: [S1] });
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(screen.queryByText(stepsNote)).toBeNull();
    expect(screen.queryByText('Etapa 1')).toBeNull();
    expect(screen.queryByText('Informações gerais')).toBeNull();
    const add = screen.getByRole('button', { name: 'Adicionar etapa' });
    expect(add.className).toContain('border');
    expect(add.className).not.toContain('bg-button');
    const row = add.parentElement as HTMLElement;
    expect(Array.from(row.querySelectorAll('button')).map((button) => button.textContent)).toEqual([
      'Adicionar pergunta',
      'Adicionar etapa',
      'Reordenar',
      'Ver como o membro vê',
    ]);
    expect(container.querySelector('[data-steps-note]')).toBeNull();
  });

  it('ONE step renders the list byte for byte as Phase 12 does, apart from the new button', () => {
    const phase12 = render(
      <Providers>
        <QuestionList questions={[QA, QB]} limit={30} onAdd={vi.fn()} onPreview={vi.fn()} />
      </Providers>,
    );
    const normalise = (html: string) => html.replace(/ (id|aria-describedby)="[^"]*"/g, '');
    const expected = normalise(
      (phase12.container.querySelector('section') as HTMLElement).outerHTML,
    );
    cleanup();

    const { container } = builder({ questions: [QA, QB], steps: [S1] });
    const list = container.querySelector('section') as HTMLElement;
    const addStep = within(list).getByRole('button', { name: 'Adicionar etapa' });
    addStep.remove();
    expect(normalise(list.outerHTML)).toBe(expected);
  });

  it('adds a step through the sheet: disabled save, the typed title, then the BFF action', async () => {
    mocks.createStep.mockResolvedValue({ ok: true, step: S2 });
    builder({ questions: [QA, QB], steps: [S1] });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar etapa' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Nova etapa' })).toBeTruthy();
    const save = within(sheet).getByRole('button', { name: 'Salvar etapa' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Título da etapa'), {
      target: { value: 'Sobre a sua clínica' },
    });
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(mocks.createStep).toHaveBeenCalledWith({ title: 'Sobre a sua clínica' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('re-lays the list in place: one step becomes two wells under the note, the new one empty and last', async () => {
    mocks.createStep.mockResolvedValue({ ok: true, step: S4 });
    const view = builder({ questions: [QA, QB], steps: [S1] });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar etapa' }));
    fireEvent.change(screen.getByLabelText('Título da etapa'), { target: { value: 'Rotina' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar etapa' }));
    });
    // the page re-reads after the write: the new step arrives last and empty
    view.again({ questions: [QA, QB], steps: [{ ...S1, questionCount: 2 }, S4] });

    expect(screen.getByText(stepsNote)).toBeTruthy();
    expect(wellTitles()).toEqual(['Informações gerais', 'Rotina']);
    expect(rowTitles('Informações gerais')).toEqual(['Tem clínica?', 'Nome profissional']);
    const last = well('Rotina');
    expect(within(last).getByText('Etapa 2')).toBeTruthy();
    expect(within(last).getByText('Sem perguntas')).toBeTruthy();
    expect(
      within(last).getByText(
        'Esta etapa está vazia. Enquanto estiver vazia, os membros não a veem.',
      ),
    ).toBeTruthy();
    expect(within(last).queryAllByRole('listitem')).toHaveLength(0);
    // and back to ONE step returns the flat list
    view.again({ questions: [QA, QB], steps: [S1] });
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(screen.queryByText(stepsNote)).toBeNull();
  });

  it('puts the note row under the micro-title and before the wells, and keeps the same count title', () => {
    builder(FOUR_STEPS);
    const title = screen.getByText('Perguntas ativas (5)');
    const note = document.querySelector('[data-steps-note]') as HTMLElement;
    expect(note.getAttribute('role')).toBe('status');
    expect(note.className).toContain('bg-bg-tertiary');
    expect(title.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      note.compareDocumentPosition(well('Informações gerais')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('pluralises the meta line of each well: two, one, none', () => {
    builder(FOUR_STEPS);
    expect(within(well('Informações gerais')).getByText('2 perguntas')).toBeTruthy();
    expect(within(well('Contato')).getByText('1 pergunta')).toBeTruthy();
    expect(within(well('Rotina')).getByText('Sem perguntas')).toBeTruthy();
  });

  it('PFORM-37 ordering: the numbers run 1..N across the wells, in the order members see', () => {
    builder(FOUR_STEPS);
    expect(wellTitles()).toEqual([
      'Informações gerais',
      'Sobre a sua clínica',
      'Contato',
      'Rotina',
    ]);
    expect(positions()).toEqual(['1', '2', '3', '4', '5']);
    expect(rowTitles('Sobre a sua clínica')).toEqual(['Nome da clínica', 'Quantas pessoas?']);
  });

  it('PFORM-37 empty: a form with no step and no question keeps the empty state, and both buttons work', () => {
    builder({ questions: [], steps: [] });
    expect(screen.getByText('Seu formulário ainda está vazio')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar etapa' }));
    expect(screen.getByRole('heading', { name: 'Nova etapa' })).toBeTruthy();
    cleanup();

    builder({ questions: [], steps: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pergunta' }));
    expect(screen.getByRole('heading', { name: 'Nova pergunta' })).toBeTruthy();
  });

  it('PFORM-37 empty: two steps and no question show the empty wells instead of the empty state', () => {
    builder({ questions: [], steps: [S1, S4] });
    expect(screen.queryByText('Seu formulário ainda está vazio')).toBeNull();
    expect(screen.getAllByText('Sem perguntas')).toHaveLength(2);
    expect(screen.getByText('Perguntas ativas (0)')).toBeTruthy();
  });

  it('PFORM-37 adjacency: two steps with the same title are two distinct wells, told apart by their eyebrow', async () => {
    const twinA = adminStep({ title: 'Etapa igual', questionCount: 1 });
    const twinB = adminStep({ title: 'Etapa igual', questionCount: 1 });
    const a = adminQuestion('short_text', { title: 'Primeira', stepId: twinA.id });
    const b = adminQuestion('short_text', { title: 'Segunda', stepId: twinB.id });
    mocks.renameStep.mockResolvedValue({ ok: true, step: twinB });
    builder({ questions: [a, b], steps: [twinA, twinB] });
    const wells = screen.getAllByRole('region', { name: 'Etapa igual' });
    expect(wells).toHaveLength(2);
    expect(within(wells[0] as HTMLElement).getByText('Etapa 1')).toBeTruthy();
    expect(within(wells[1] as HTMLElement).getByText('Etapa 2')).toBeTruthy();
    expect(within(wells[1] as HTMLElement).getByText('Segunda')).toBeTruthy();
    // the second well's pencil renames the SECOND step, by id
    fireEvent.click(
      within(wells[1] as HTMLElement).getByRole('button', { name: 'Renomear etapa: Etapa igual' }),
    );
    fireEvent.change(screen.getByLabelText('Título da etapa'), { target: { value: 'Outra' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar etapa' }));
    });
    expect(mocks.renameStep).toHaveBeenCalledWith({
      id: twinB.id,
      revision: twinB.revision,
      title: 'Outra',
    });
  });
});

describe('12.1-16 Task 2: rename, delete, per-step "Adicionar pergunta" and the limit lines (D-633, UI-D-644, UI-D-645)', () => {
  it('opens the step sheet in rename mode prefilled from the pencil of a well', () => {
    builder(FOUR_STEPS);
    fireEvent.click(screen.getByRole('button', { name: 'Renomear etapa: Contato' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Renomear etapa' })).toBeTruthy();
    expect((within(sheet).getByLabelText('Título da etapa') as HTMLInputElement).value).toBe(
      'Contato',
    );
  });

  it('rename calls the action with the stored revision and refreshes', async () => {
    mocks.renameStep.mockResolvedValue({ ok: true, step: S3 });
    builder(FOUR_STEPS);
    fireEvent.click(screen.getByRole('button', { name: 'Renomear etapa: Contato' }));
    fireEvent.change(screen.getByLabelText('Título da etapa'), {
      target: { value: 'Fale conosco' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar etapa' }));
    });
    expect(mocks.renameStep).toHaveBeenCalledWith({
      id: S3.id,
      revision: S3.revision,
      title: 'Fale conosco',
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('a stale revision refreshes and the retry carries the newest revision without losing the typed title', async () => {
    mocks.renameStep.mockResolvedValueOnce({ ok: false, code: 'stale_revision' });
    mocks.renameStep.mockResolvedValueOnce({ ok: true, step: S3 });
    const view = builder(FOUR_STEPS);
    fireEvent.click(screen.getByRole('button', { name: 'Renomear etapa: Contato' }));
    fireEvent.change(screen.getByLabelText('Título da etapa'), {
      target: { value: 'Fale conosco' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar etapa' }));
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    // the page re-read: another admin had renamed the step, its revision moved on
    view.again({
      questions: FOUR_STEPS.questions,
      steps: [S1, S2, { ...S3, title: 'Outro nome', revision: S3.revision + 2 }, S4],
    });
    expect((screen.getByLabelText('Título da etapa') as HTMLInputElement).value).toBe(
      'Fale conosco',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar etapa' }));
    });
    expect(mocks.renameStep).toHaveBeenLastCalledWith({
      id: S3.id,
      revision: S3.revision + 2,
      title: 'Fale conosco',
    });
  });

  it('delete is offered for an empty step and absent for a step that holds questions', () => {
    builder(FOUR_STEPS);
    fireEvent.click(screen.getByRole('button', { name: 'Renomear etapa: Rotina' }));
    expect(screen.getByRole('button', { name: 'Excluir etapa' })).toBeTruthy();
    cleanup();

    builder(FOUR_STEPS);
    fireEvent.click(screen.getByRole('button', { name: 'Renomear etapa: Contato' }));
    expect(screen.queryByRole('button', { name: 'Excluir etapa' })).toBeNull();
    expect(
      screen.getByText('Para excluir esta etapa, mova ou arquive as perguntas dela primeiro.'),
    ).toBeTruthy();
  });

  it('delete confirms, then calls the action for that step and refreshes', async () => {
    mocks.deleteStep.mockResolvedValue({ ok: true });
    builder(FOUR_STEPS);
    fireEvent.click(screen.getByRole('button', { name: 'Renomear etapa: Rotina' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir etapa' }));
    expect(mocks.deleteStep).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Excluir esta etapa?' })).getByRole('button', {
          name: 'Excluir',
        }),
      );
    });
    await waitFor(() => expect(mocks.deleteStep).toHaveBeenCalledWith(S4.id));
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Etapa excluída.' });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('the footer of a well opens a NEW question sheet that carries THIS step, through the create action', async () => {
    mocks.create.mockResolvedValue({ ok: true, question: QE, pending: null });
    builder(FOUR_STEPS);
    fireEvent.click(
      screen.getByRole('button', { name: 'Adicionar pergunta à etapa: Sobre a sua clínica' }),
    );
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Nova pergunta' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Texto curto/ }));
    fireEvent.change(within(sheet).getByLabelText('Pergunta'), { target: { value: 'Cidade' } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar pergunta' }));
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({ title: 'Cidade', stepId: S2.id });
  });

  it('the top "Adicionar pergunta" names no step: the server adds to the LAST one', async () => {
    mocks.create.mockResolvedValue({ ok: true, question: QE, pending: null });
    builder(FOUR_STEPS);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pergunta' }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Texto curto/ }));
    fireEvent.change(within(sheet).getByLabelText('Pergunta'), { target: { value: 'Cidade' } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar pergunta' }));
    });
    expect(Object.keys(mocks.create.mock.calls[0]?.[0] as object)).not.toContain('stepId');
  });

  it('at 10 steps "Adicionar etapa" is disabled and the line takes its number from the limit', () => {
    const ten = Array.from({ length: 10 }, (_, at) => adminStep({ title: `Etapa nº ${at + 1}` }));
    const view = builder({ questions: [], steps: ten });
    expect(isDisabled(screen.getByRole('button', { name: 'Adicionar etapa' }))).toBe(true);
    expect(document.querySelector('[data-step-limit-line]')?.textContent).toBe(
      'Você chegou ao limite de 10 etapas. Exclua uma etapa vazia para adicionar outra.',
    );
    view.unmount();

    const nine = ten.slice(0, 9);
    builder({ questions: [], steps: nine });
    expect(isDisabled(screen.getByRole('button', { name: 'Adicionar etapa' }))).toBe(false);
    expect(document.querySelector('[data-step-limit-line]')).toBeNull();
  });

  it('at 30 questions every "Adicionar pergunta", the top one and each step footer, is disabled with Phase 12 line', () => {
    const many = Array.from({ length: 30 }, (_, at) =>
      adminQuestion('short_text', { title: `Pergunta ${at + 1}`, stepId: at < 15 ? S1.id : S2.id }),
    );
    builder({ questions: many, steps: [S1, S2] });
    expect(isDisabled(screen.getByRole('button', { name: 'Adicionar pergunta' }))).toBe(true);
    for (const footer of screen.getAllByRole('button', { name: /^Adicionar pergunta à etapa:/ })) {
      expect(isDisabled(footer)).toBe(true);
    }
    expect(document.querySelector('[data-limit-line]')?.textContent).toBe(
      'Você chegou ao limite de 30 perguntas ativas. Arquive uma para adicionar outra.',
    );
  });

  it('the empty well renders its line and its footer button, and the footer opens the editor for it', () => {
    builder(FOUR_STEPS);
    const empty = well('Rotina');
    expect(within(empty).getByText(/^Esta etapa está vazia/)).toBeTruthy();
    fireEvent.click(
      within(empty).getByRole('button', { name: 'Adicionar pergunta à etapa: Rotina' }),
    );
    expect(screen.getByRole('heading', { name: 'Nova pergunta' })).toBeTruthy();
  });
});

describe('12.1-16 Task 3: reorder on steps and within steps, and the refusals that name the two questions (D-623, UI-D-646)', () => {
  const enterReorder = () => fireEvent.click(screen.getByRole('button', { name: 'Reordenar' }));

  beforeEach(() => {
    mocks.layout.mockResolvedValue({ ok: true });
  });

  it('PFORM-37 adjacency: the step arrows replace the pencil and are disabled on the first and last step', () => {
    builder(FOUR_STEPS);
    enterReorder();
    expect(screen.queryByRole('button', { name: /^Renomear etapa/ })).toBeNull();
    expect(isDisabled(stepUp('Informações gerais'))).toBe(true);
    expect(isDisabled(stepDown('Informações gerais'))).toBe(false);
    expect(isDisabled(stepUp('Rotina'))).toBe(false);
    expect(isDisabled(stepDown('Rotina'))).toBe(true);
    expect(stepUp('Contato').className).toContain('min-h-[44px]');
    expect(stepDown('Contato').className).toContain('min-w-[44px]');
  });

  it('moves a step, saves the WHOLE layout at once, announces its place and renumbers 1..N', async () => {
    builder(FOUR_STEPS);
    enterReorder();
    await act(async () => {
      fireEvent.click(stepUp('Contato'));
    });
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.layout).toHaveBeenCalledWith({
      steps: [
        { id: S1.id, questionIds: [QA.id, QB.id] },
        { id: S3.id, questionIds: [QE.id] },
        { id: S2.id, questionIds: [QC.id, QD.id] },
        { id: S4.id, questionIds: [] },
      ],
    });
    expect(mocks.reorder).not.toHaveBeenCalled();
    expect(wellTitles()).toEqual([
      'Informações gerais',
      'Contato',
      'Sobre a sua clínica',
      'Rotina',
    ]);
    expect(live()).toBe('A etapa “Contato” agora é a etapa 2 de 4.');
    // PFORM-37 ordering: contiguous numbering in the order members now see
    expect(positions()).toEqual(['1', '2', '3', '4', '5']);
    expect(rowTitles('Contato')).toEqual(['Telefone']);
    expect(within(well('Contato')).getByText('Etapa 2')).toBeTruthy();
    // focus follows the moved step
    expect(document.activeElement).toBe(stepUp('Contato'));
  });

  it('a question arrow moves a question ONLY inside its step: the edges of a step are disabled', () => {
    builder(FOUR_STEPS);
    enterReorder();
    expect(isDisabled(questionUp('Tem clínica?'))).toBe(true);
    expect(isDisabled(questionDown('Tem clínica?'))).toBe(false);
    // Nome profissional is last in its step although another step follows
    expect(isDisabled(questionDown('Nome profissional'))).toBe(true);
    // Nome da clínica is first in its step although another step precedes
    expect(isDisabled(questionUp('Nome da clínica'))).toBe(true);
    // a step with one question has both disabled
    expect(isDisabled(questionUp('Telefone'))).toBe(true);
    expect(isDisabled(questionDown('Telefone'))).toBe(true);
  });

  it('moves a question inside its step and saves the layout with the new order', async () => {
    builder(FOUR_STEPS);
    enterReorder();
    await act(async () => {
      fireEvent.click(questionUp('Nome profissional'));
    });
    expect(mocks.layout).toHaveBeenCalledWith({
      steps: [
        { id: S1.id, questionIds: [QB.id, QA.id] },
        { id: S2.id, questionIds: [QC.id, QD.id] },
        { id: S3.id, questionIds: [QE.id] },
        { id: S4.id, questionIds: [] },
      ],
    });
    expect(rowTitles('Informações gerais')).toEqual(['Nome profissional', 'Tem clínica?']);
    expect(live()).toBe('“Nome profissional” agora é a pergunta 1 de 5.');
    expect(positions()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('a step that would go above the step holding an opener moves NOTHING and names the two questions', async () => {
    builder(FOUR_STEPS);
    enterReorder();
    await act(async () => {
      fireEvent.click(stepUp('Sobre a sua clínica'));
    });
    expect(mocks.layout).not.toHaveBeenCalled();
    expect(wellTitles()).toEqual([
      'Informações gerais',
      'Sobre a sua clínica',
      'Contato',
      'Rotina',
    ]);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message:
        '“Nome da clínica” precisa ficar depois de “Tem clínica?”, que decide se ela aparece.',
    });
    expect(live()).toBe('');
  });

  it('the opener step going down moves NOTHING and says the opener must come first', async () => {
    builder(FOUR_STEPS);
    enterReorder();
    await act(async () => {
      fireEvent.click(stepDown('Informações gerais'));
    });
    expect(mocks.layout).not.toHaveBeenCalled();
    expect(wellTitles()).toEqual([
      'Informações gerais',
      'Sobre a sua clínica',
      'Contato',
      'Rotina',
    ]);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message:
        '“Tem clínica?” precisa ficar antes de “Nome da clínica”, que só aparece conforme a resposta dela.',
    });
  });

  it('names the QUESTIONS, never the steps, in both refusal sentences', async () => {
    builder(FOUR_STEPS);
    enterReorder();
    await act(async () => {
      fireEvent.click(stepUp('Sobre a sua clínica'));
    });
    await act(async () => {
      fireEvent.click(stepDown('Informações gerais'));
    });
    for (const call of mocks.show.mock.calls) {
      const message = String((call[0] as { message: string }).message);
      expect(message).not.toContain('Informações gerais');
      expect(message).not.toContain('Sobre a sua clínica');
    }
    expect(mocks.show).toHaveBeenCalledTimes(2);
  });

  it('the server coded 409 (a race) puts the list back and renders the same sentence', async () => {
    mocks.layout.mockResolvedValue({
      ok: false,
      code: 'condition_order',
      questionId: QC.id,
      openerId: QA.id,
    });
    builder(FOUR_STEPS);
    enterReorder();
    await act(async () => {
      fireEvent.click(questionUp('Nome profissional'));
    });
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(rowTitles('Informações gerais')).toEqual(['Tem clínica?', 'Nome profissional']);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message:
        '“Nome da clínica” precisa ficar depois de “Tem clínica?”, que decide se ela aparece.',
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(live()).toBe('');
    // the pressed control keeps focus at the old position
    expect(document.activeElement).toBe(questionUp('Nome profissional'));
  });

  it('puts the steps back and toasts when the layout write fails', async () => {
    mocks.layout.mockResolvedValue({ ok: false, code: 'failed' });
    builder(FOUR_STEPS);
    enterReorder();
    await act(async () => {
      fireEvent.click(stepUp('Contato'));
    });
    expect(wellTitles()).toEqual([
      'Informações gerais',
      'Sobre a sua clínica',
      'Contato',
      'Rotina',
    ]);
    expect(positions()).toEqual(['1', '2', '3', '4', '5']);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar a nova ordem. A lista voltou como estava.',
    });
  });

  it('a form with ONE step sends the layout body too (and the flat list still moves rows)', async () => {
    builder({ questions: [QA, QB], steps: [S1] });
    enterReorder();
    await act(async () => {
      fireEvent.click(questionDown('Tem clínica?'));
    });
    expect(mocks.layout).toHaveBeenCalledWith({
      steps: [{ id: S1.id, questionIds: [QB.id, QA.id] }],
    });
    expect(mocks.reorder).not.toHaveBeenCalled();
  });

  it('a form with no step known keeps the legacy body', async () => {
    mocks.reorder.mockResolvedValue({ ok: true });
    builder({ questions: [QA, QB], steps: [] });
    enterReorder();
    await act(async () => {
      fireEvent.click(questionDown('Tem clínica?'));
    });
    expect(mocks.reorder).toHaveBeenCalledWith([QB.id, QA.id]);
    expect(mocks.layout).not.toHaveBeenCalled();
  });

  it('refreshes the page when "Concluir" ends the mode', () => {
    builder(FOUR_STEPS);
    enterReorder();
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Renomear etapa: Contato' })).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* 12.2-15 Task 1 (tracer): a branch is a block under its opener (D-640, D-641, D-642, UI-D-666/667)  */
/* ------------------------------------------------------------------------------------------------ */

describe('12.2-15 Task 1 (tracer): a branch is a block under its opener, with a strip and white rows', () => {
  const OPENER_TITLE = 'Você tem clínica, trabalha em clínica ou está aprendendo?';
  const B1_LABEL = `Se “${OPENER_TITLE}” for “Tenho uma clínica”`;
  const B2_LABEL = 'Se “A clínica tem equipe?” for Sim';
  const B3_LABEL = 'Se “Tem sócio?” for Sim';
  const B4_LABEL = `Se “${OPENER_TITLE}” for “Estou aprendendo”`;

  /** The clinic form of the contracts: one step, B1 (Q2, Q3), B2 (Q4, Q5), B3 (Q6), B4 (Q7). */
  const clinic = () => clinicAdminList();
  const showClinic = (props: Parameters<typeof show>[1] = {}) => {
    const list = clinic();
    return show(list.questions, { steps: list.steps, branches: list.branches, ...props });
  };
  const rowOf = (title: string) =>
    screen.getByRole('button', { name: `Editar pergunta: ${title}` }).closest('li') as HTMLElement;
  const strips = (root: ParentNode = document) =>
    Array.from(root.querySelectorAll('[data-branch-strip]')) as HTMLElement[];
  const labelOf = (strip: HTMLElement) => strip.querySelector('.line-clamp-2')?.textContent;

  it('draws the block INSIDE the opener row, right under it, with the rail and a strip', () => {
    showClinic();
    const opener = rowOf(OPENER_TITLE);
    const rails = Array.from(opener.querySelectorAll(':scope > div.border-l-2'));
    expect(rails).toHaveLength(2); // B1 and B4: several branches of one opener are consecutive blocks
    expect(
      rails.map((rail) => labelOf(rail.querySelector('[data-branch-strip]') as HTMLElement)),
    ).toEqual([B1_LABEL, B4_LABEL]);
    expect(rails[0]?.className).toContain('ml-1 border-l-2 border-border-secondary pl-3');
    // the block comes AFTER the opener's own white card
    expect(opener.firstElementChild?.querySelector('button')).toBeTruthy();
    expect(opener.firstElementChild?.className).not.toContain('border-l-2');
  });

  it('puts the rows of the branch inside its rail, in a list named by the strip', () => {
    showClinic();
    const rail = rowOf(OPENER_TITLE).querySelector(':scope > div.border-l-2') as HTMLElement;
    const list = rail.querySelector(':scope > ul') as HTMLElement;
    expect(document.getElementById(list.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      B1_LABEL,
    );
    const titles = Array.from(
      list.querySelectorAll(':scope > li > div:first-child .line-clamp-3'),
    ).map((el) => el.textContent);
    expect(titles).toEqual(['A clínica tem equipe?', 'Nome da clínica']);
  });

  it('writes the label of an unnamed branch as "Se “{opener}” for {options}", with no final period', () => {
    showClinic();
    const labels = strips().map(labelOf);
    expect(labels).toEqual([B1_LABEL, B2_LABEL, B3_LABEL, B4_LABEL]);
    for (const label of labels) expect(label?.endsWith('.')).toBe(false);
  });

  it('says the count of each strip as a plural', () => {
    showClinic();
    const metas = strips().map((strip) =>
      Array.from(strip.querySelectorAll('span'))
        .map((span) => span.textContent)
        .find((text) => /pergunta/.test(text ?? '') && !/Se “/.test(text ?? '')),
    );
    expect(metas).toEqual(['2 perguntas', '2 perguntas', '1 pergunta', '1 pergunta']);
  });

  it('a named branch shows the name on line 1 and the same sentence on line 2', () => {
    const list = clinic();
    const named = list.branches?.map((branch) =>
      branch.id === clinicId('B1') ? { ...branch, name: 'Quem tem clínica' } : branch,
    );
    show(list.questions, { steps: list.steps, branches: named });
    const strip = strips()[0] as HTMLElement;
    const lines = Array.from(strip.querySelectorAll('.line-clamp-2')).map((el) => el.textContent);
    expect(lines).toEqual(['Quem tem clínica', B1_LABEL]);
    // the other three keep a single line
    expect(
      strips()
        .slice(1)
        .map((s) => s.querySelectorAll('.line-clamp-2').length),
    ).toEqual([1, 1, 1]);
  });

  it('an opener wears "Abre N" for the questions of the branches that hang DIRECTLY on it', () => {
    showClinic();
    expect(
      within(rowOf(OPENER_TITLE).firstElementChild as HTMLElement).getByText('Abre 3 perguntas'),
    ).toBeTruthy();
    expect(
      within(rowOf('A clínica tem equipe?').firstElementChild as HTMLElement).getByText(
        'Abre 2 perguntas',
      ),
    ).toBeTruthy();
    expect(
      within(rowOf('Tem sócio?').firstElementChild as HTMLElement).getByText('Abre 1 pergunta'),
    ).toBeTruthy();
    // a row that is both a member and an opener wears the pill inside the rail
    expect(rowOf('A clínica tem equipe?').closest('div.border-l-2')).toBeTruthy();
    // a plain leaf has no pill, and never "Abre 0"
    expect(
      within(rowOf('Nome do sócio').firstElementChild as HTMLElement).queryByText(/Abre/),
    ).toBeNull();
  });

  it('a question row no longer carries "Condicional" or the "Só aparece se" line', () => {
    const { container } = showClinic();
    expect(screen.queryByText('Condicional')).toBeNull();
    expect(screen.queryByText(/Só aparece se/)).toBeNull();
    expect(container.querySelector('[data-condition-line]')).toBeNull();
  });

  it('the accessible description of a row in a branch gains "Fica no ramo: {label}."', () => {
    showClinic();
    const button = screen.getByRole('button', { name: 'Editar pergunta: Nome da clínica' });
    const description = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toContain(`Fica no ramo: ${B1_LABEL}.`);
    const root = screen.getByRole('button', { name: `Editar pergunta: ${OPENER_TITLE}` });
    const rootDescription = document.getElementById(root.getAttribute('aria-describedby') ?? '');
    expect(rootDescription?.textContent).not.toContain('Fica no ramo');
    expect(rootDescription?.textContent).toContain('Abre 3 perguntas.');
  });

  it('keeps the numbers global, 1..N, in the order members see', () => {
    showClinic();
    const numbers = screen
      .getAllByRole('listitem')
      .filter(isRowItem)
      .map((item) => item.querySelector('[aria-hidden="true"].w-5')?.textContent);
    expect(numbers).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('opens the editor with the question that was clicked inside a block', () => {
    const onOpen = vi.fn();
    showClinic({ onOpen });
    fireEvent.click(screen.getByRole('button', { name: 'Editar pergunta: Nome do sócio' }));
    expect(onOpen).toHaveBeenCalledWith(clinicId('Q6'));
  });

  it('shows the pencil with the label and hands the branch to onEditBranch', () => {
    const onEditBranch = vi.fn();
    showClinic({ onEditBranch });
    fireEvent.click(screen.getByRole('button', { name: `Editar ramo: ${B2_LABEL}` }));
    expect(onEditBranch).toHaveBeenCalledWith(clinicId('B2'));
  });

  it('a form with no branch renders no strip, no rail and no list named by a strip', () => {
    const { container } = show([A, B, C]);
    expect(strips(container)).toHaveLength(0);
    expect(container.querySelector('.border-l-2')).toBeNull();
    expect(container.querySelector('ul[aria-labelledby]')).toBeNull();
    expect(screen.queryByText(/Abre/)).toBeNull();
    expect(screen.queryByText('Condicional')).toBeNull();
  });

  it('a form with branches in the read but a flat read of steps still renders one step as a flat list', () => {
    const { container } = showClinic();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(container.querySelector('[data-steps-note]')).toBeNull();
  });

  it('the page hands the branches of the read to the builder: a block shows through QuestionBuilder', () => {
    const list = clinic();
    builder({ questions: list.questions, steps: list.steps, branches: list.branches });
    expect(strips()).toHaveLength(4);
  });

  it('leaves the Arquivadas list unchanged: no strip, no condition sentence', () => {
    showArchived([archivedQuestion('short_text', { title: 'Antiga', branchId: clinicId('B1') })]);
    expect(screen.queryByText('Condicional')).toBeNull();
    expect(screen.queryByText(/Só aparece se/)).toBeNull();
    expect(document.querySelector('[data-branch-strip]')).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* 12.2-15 Task 2: nested, several, empty and cross-step branches, the description and the footer     */
/* ------------------------------------------------------------------------------------------------ */

describe('12.2-15 Task 2: every state of a branch in the Lista is drawn from the one tree (D-641, D-643)', () => {
  const X1 = adminStep({ title: 'Primeira' });
  const X2 = adminStep({ title: 'Segunda' });
  const XQ = adminQuestion('single_choice', {
    title: 'Atua como?',
    stepId: X1.id,
    options: [
      { id: uuid(9801), label: 'Dono', answerCount: 0 },
      { id: uuid(9802), label: 'Sócio', answerCount: 0 },
    ],
  });
  const XB = adminBranch({ openerQuestionId: XQ.id, values: [uuid(9801)], questionCount: 3 });
  const XA = adminQuestion('short_text', {
    title: 'Nome do negócio',
    stepId: X1.id,
    branchId: XB.id,
  });
  const XC = adminQuestion('short_text', { title: 'Cidade', stepId: X2.id, branchId: XB.id });
  const XD = adminQuestion('short_text', {
    title: 'Telefone fixo',
    stepId: X2.id,
    branchId: XB.id,
  });
  const XE = adminQuestion('short_text', { title: 'Observação', stepId: X2.id });
  const XB_LABEL = 'Se “Atua como?” for “Dono”';
  const XS_LABEL = 'Se “Atua como?” for “Sócio”';

  const strips = (root: ParentNode = document) =>
    Array.from(root.querySelectorAll('[data-branch-strip]')) as HTMLElement[];
  const railOf = (strip: HTMLElement) => strip.parentElement as HTMLElement;
  const rowOf = (title: string) =>
    screen.getByRole('button', { name: `Editar pergunta: ${title}` }).closest('li') as HTMLElement;
  const railsAbove = (element: HTMLElement) => {
    let count = 0;
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (node.classList.contains('border-l-2')) count += 1;
    }
    return count;
  };

  it('nests three levels: each level of rail costs 18px, and the deepest row has exactly three rails', () => {
    const list = clinicAdminList();
    show(list.questions, { steps: list.steps, branches: list.branches });
    expect(railsAbove(rowOf('Nome da clínica'))).toBe(1);
    expect(railsAbove(rowOf('Quantos profissionais?'))).toBe(2);
    expect(railsAbove(rowOf('Nome do sócio'))).toBe(3);
    for (const strip of strips()) {
      const rail = railOf(strip);
      // ml-1 (4px) + the 2px rule + pl-3 (12px) = 18px a level
      expect(rail.className).toContain('ml-1');
      expect(rail.className).toContain('border-l-2');
      expect(rail.className).toContain('pl-3');
    }
  });

  it('a nested block sits INSIDE the row that opens it, not beside it', () => {
    const list = clinicAdminList();
    show(list.questions, { steps: list.steps, branches: list.branches });
    const middle = rowOf('A clínica tem equipe?');
    expect(middle.querySelectorAll(':scope > div.border-l-2')).toHaveLength(1);
    const deepest = rowOf('Tem sócio?');
    expect(deepest.querySelectorAll(':scope > div.border-l-2')).toHaveLength(1);
  });

  it('draws several branches of one opener as consecutive blocks, in layout order, never merged', () => {
    // the list order is Sócio first, but the questions of Dono come first in the form
    const other = adminBranch({ openerQuestionId: XQ.id, values: [uuid(9802)], questionCount: 1 });
    const XF = adminQuestion('short_text', {
      title: 'Qual sociedade?',
      stepId: X1.id,
      branchId: other.id,
    });
    show([XQ, XA, XF], { branches: [other, XB] });
    const opener = rowOf('Atua como?');
    const rails = Array.from(opener.querySelectorAll(':scope > div.border-l-2')) as HTMLElement[];
    expect(
      rails.map((rail) => strips(rail)[0]?.querySelector('.line-clamp-2')?.textContent),
    ).toEqual([XB_LABEL, XS_LABEL]);
    expect(rails[0]?.nextElementSibling).toBe(rails[1]);
    expect(within(rails[0] as HTMLElement).queryByText('Qual sociedade?')).toBeNull();
    expect(within(rails[1] as HTMLElement).getByText('Qual sociedade?')).toBeTruthy();
  });

  it('an EMPTY branch shows the empty line and no row, and keeps its place under the opener', () => {
    const empty = adminBranch({ openerQuestionId: XQ.id, values: [uuid(9802)], questionCount: 0 });
    const { container } = show([XQ, XA], { branches: [XB, empty] });
    const block = strips()
      .map(railOf)
      .find((rail) => rail.textContent?.includes('Sócio')) as HTMLElement;
    expect(
      within(block).getByText(
        'Este ramo está vazio. Ele só muda algo para os membros quando tiver uma pergunta.',
      ),
    ).toBeTruthy();
    expect(block.querySelectorAll('li')).toHaveLength(0);
    expect(block.querySelector('ul')).toBeNull();
    expect(within(block).getByText('Sem perguntas')).toBeTruthy();
    expect(container.querySelectorAll('[data-branch-empty]')).toHaveLength(1);
    // the branch with questions still draws its row
    expect(screen.getByRole('button', { name: 'Editar pergunta: Nome do negócio' })).toBeTruthy();
  });

  it('a branch whose questions are all archived reads as empty (nothing active is left to draw)', () => {
    const left = adminBranch({ openerQuestionId: XQ.id, values: [uuid(9802)], questionCount: 2 });
    show([XQ], { branches: [left] });
    expect(document.querySelectorAll('[data-branch-empty]')).toHaveLength(1);
    expect(screen.getByText('Sem perguntas')).toBeTruthy();
  });

  it('draws one block per step run: the run in the opener step and the run in the other step', () => {
    show([XQ, XA, XC, XD, XE], { steps: [X1, X2], branches: [XB] });
    const all = strips();
    expect(all).toHaveLength(2);
    // each strip repeats the label, and each block has its own rail
    expect(all.map((strip) => strip.querySelector('.line-clamp-2')?.textContent)).toEqual([
      XB_LABEL,
      XB_LABEL,
    ]);
    expect(railOf(all[0] as HTMLElement)).not.toBe(railOf(all[1] as HTMLElement));
    // the block in the first step sits under the opener; the one in the second is a root run
    expect(rowOf('Atua como?').contains(all[0] as HTMLElement)).toBe(true);
    expect(well('Segunda').contains(all[1] as HTMLElement)).toBe(true);
    // the cross-step line appears only on the run whose opener is in another step
    expect(
      within(railOf(all[1] as HTMLElement)).getByText(
        'A pergunta que decide está na etapa “Primeira”.',
      ),
    ).toBeTruthy();
    expect(within(railOf(all[0] as HTMLElement)).queryByText(/A pergunta que decide/)).toBeNull();
  });

  it('each run counts its own rows, and the numbers stay global across the steps', () => {
    show([XQ, XA, XC, XD, XE], { steps: [X1, X2], branches: [XB] });
    const metas = strips().map(
      (strip) =>
        Array.from(strip.querySelectorAll('span'))
          .map((span) => span.textContent ?? '')
          .find((text) => /^\d+ perguntas?$/.test(text)) ?? '',
    );
    expect(metas).toEqual(['1 pergunta', '2 perguntas']);
    expect(
      screen
        .getAllByRole('listitem')
        .filter(isRowItem)
        .map((item) => item.querySelector('[aria-hidden="true"].w-5')?.textContent),
    ).toEqual(['1', '2', '3', '4', '5']);
    expect(rowTitles('Segunda')).toEqual(['Cidade', 'Telefone fixo', 'Observação']);
  });

  it("a form with branches but a step with no question still renders that step's empty well", () => {
    show([XQ, XA], { steps: [X1, X2], branches: [XB] });
    expect(within(well('Segunda')).getByText('Sem perguntas')).toBeTruthy();
    expect(
      within(well('Segunda')).getByText(
        'Esta etapa está vazia. Enquanto estiver vazia, os membros não a veem.',
      ),
    ).toBeTruthy();
    expect(strips(well('Segunda'))).toHaveLength(0);
  });

  it('wires the footer: hands the branch and the step of the run to onAddToBranch', () => {
    const onAddToBranch = vi.fn();
    show([XQ, XA, XC, XD, XE], { steps: [X1, X2], branches: [XB], onAddToBranch });
    const footers = screen.getAllByRole('button', {
      name: `Adicionar pergunta ao ramo: ${XB_LABEL}`,
    });
    expect(footers).toHaveLength(2);
    fireEvent.click(footers[0] as HTMLElement);
    fireEvent.click(footers[1] as HTMLElement);
    expect(onAddToBranch.mock.calls).toEqual([
      [XB.id, X1.id],
      [XB.id, X2.id],
    ]);
  });

  it('hands the LAST step to onAddToBranch for an empty branch', () => {
    const onAddToBranch = vi.fn();
    const empty = adminBranch({ openerQuestionId: XQ.id, values: [uuid(9802)], questionCount: 0 });
    show([XQ, XA, XE], { steps: [X1, X2], branches: [XB, empty], onAddToBranch });
    fireEvent.click(
      screen.getByRole('button', { name: `Adicionar pergunta ao ramo: ${XS_LABEL}` }),
    );
    expect(onAddToBranch).toHaveBeenCalledWith(empty.id, X2.id);
  });

  it('shows the footer only when the list receives onAddToBranch', () => {
    show([XQ, XA], { branches: [XB] });
    expect(screen.queryByRole('button', { name: /^Adicionar pergunta ao ramo/ })).toBeNull();
    cleanup();
    show([XQ, XA], { branches: [XB], onAddToBranch: vi.fn() });
    const footer = screen.getByRole('button', { name: `Adicionar pergunta ao ramo: ${XB_LABEL}` });
    expect(footer.textContent).toBe('Adicionar pergunta ao ramo');
  });

  it('a flat list (no steps) still hands the real step of the questions to the footer', () => {
    const onAddToBranch = vi.fn();
    show([XQ, XA], { branches: [XB], onAddToBranch });
    fireEvent.click(screen.getByRole('button', { name: /^Adicionar pergunta ao ramo:/ }));
    expect(onAddToBranch).toHaveBeenCalledWith(XB.id, X1.id);
  });

  it('names the pencil and the footer with the label, and clamps a 60 character name to two lines', () => {
    const name = 'N'.repeat(60);
    const named = { ...XB, name };
    show([XQ, XA], { branches: [named], onEditBranch: vi.fn(), onAddToBranch: vi.fn() });
    expect(screen.getByRole('button', { name: `Editar ramo: ${name}` })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `Adicionar pergunta ao ramo: ${name}` }),
    ).toBeTruthy();
    const label = strips()[0]?.querySelector('.line-clamp-2') as HTMLElement;
    expect(label.textContent).toBe(name);
    expect(label.className).toContain('break-words');
    // the answers are never hidden by the name
    expect(within(strips()[0] as HTMLElement).getByText(XB_LABEL)).toBeTruthy();
  });

  it('keeps 44px targets on the strip and the footer, and writes no half-step spacing class', () => {
    show([XQ, XA], { branches: [XB], onEditBranch: vi.fn(), onAddToBranch: vi.fn() });
    const pencil = screen.getByRole('button', { name: `Editar ramo: ${XB_LABEL}` });
    expect(pencil.className).toContain('min-h-[44px]');
    expect(pencil.className).toContain('min-w-[44px]');
    // the footer is the shipped ghost button with its 44px hit area (`hitArea`), like the well's footer
    const footer = screen.getByRole('button', { name: /^Adicionar pergunta ao ramo:/ });
    expect(footer.className).toContain('after:h-11');
    // no markup of the list or the block writes a half-step spacing class (UI-D-684)
    for (const file of ['QuestionList.tsx', 'BranchBlock.tsx']) {
      const source = readFileSync(
        join(process.cwd(), 'app/(app)/configuracoes/formulario-de-perfil', file),
        'utf8',
      );
      expect(source).not.toMatch(/(^|[^a-z])(gap|p|m|px|py|mt|mb|ml|mr)-(0\.5|1\.5|2\.5|3\.5)/);
    }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* 12.2-15 Task 3: reorder by blocks, the branch arrows and the refusals that name two questions       */
/* ------------------------------------------------------------------------------------------------ */

describe('12.2-15 Task 3: reorder moves blocks as units (D-652, UI-D-668)', () => {
  const OPENER_TITLE = 'Você tem clínica, trabalha em clínica ou está aprendendo?';
  const B1_LABEL = `Se “${OPENER_TITLE}” for “Tenho uma clínica”`;
  const B2_LABEL = 'Se “A clínica tem equipe?” for Sim';
  const B4_LABEL = `Se “${OPENER_TITLE}” for “Estou aprendendo”`;
  const ids = (...keys: string[]) => keys.map((key) => clinicId(key));
  const enterReorder = () => fireEvent.click(screen.getByRole('button', { name: 'Reordenar' }));
  const branchUp = (label: string) =>
    screen.getByRole('button', { name: `Subir ramo “${label}”` }) as HTMLButtonElement;
  const branchDown = (label: string) =>
    screen.getByRole('button', { name: `Descer ramo “${label}”` }) as HTMLButtonElement;
  const stripLabels = () =>
    Array.from(document.querySelectorAll('[data-branch-strip]')).map(
      (strip) => strip.querySelector('.line-clamp-2')?.textContent,
    );
  const clinicList = () => {
    const list = clinicAdminList();
    const step = list.steps[0];
    if (!step) throw new Error('the clinic fixture has a step');
    return { list, step };
  };
  const reorderClinic = () => {
    const { list, step } = clinicList();
    show(list.questions, { steps: list.steps, branches: list.branches });
    enterReorder();
    return { list, step };
  };

  beforeEach(() => {
    mocks.layout.mockResolvedValue({ ok: true });
  });

  it('an opener moves with its whole block: the sent layout carries Q2 and everything under it', async () => {
    const { step } = reorderClinic();
    await act(async () => {
      fireEvent.click(questionDown('A clínica tem equipe?'));
    });
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.layout).toHaveBeenCalledWith({
      steps: [{ id: step.id, questionIds: ids('Q1', 'Q3', 'Q2', 'Q4', 'Q5', 'Q6', 'Q7') }],
    });
    expect(live()).toBe('“A clínica tem equipe?” agora é a pergunta 3 de 7.');
  });

  it('a question inside a branch swaps with its sibling only, and a sibling that opens a block counts as one place', async () => {
    const { step } = reorderClinic();
    await act(async () => {
      fireEvent.click(questionDown('Quantos profissionais?'));
    });
    expect(mocks.layout).toHaveBeenCalledWith({
      steps: [{ id: step.id, questionIds: ids('Q1', 'Q2', 'Q5', 'Q6', 'Q4', 'Q3', 'Q7') }],
    });
  });

  it('the sent layout is already in tree order, with the same ids in the same step', async () => {
    const { list, step } = reorderClinic();
    await act(async () => {
      fireEvent.click(questionUp('Nome da clínica'));
    });
    const sent = mocks.layout.mock.calls[0]?.[0] as {
      steps: { id: string; questionIds: string[] }[];
    };
    const tree = buildBranchTree({
      steps: list.steps,
      questions: list.questions,
      branches: list.branches,
    });
    const asLayout = sent.steps.map((entry) => ({
      stepId: entry.id,
      questionIds: entry.questionIds,
    }));
    expect(treeLayoutOf(asLayout, tree)).toEqual(asLayout);
    expect([...(sent.steps[0]?.questionIds ?? [])].sort()).toEqual(
      list.questions.map((question) => question.id).sort(),
    );
    expect(sent.steps[0]?.id).toBe(step.id);
  });

  it('an arrow never changes the step or the branch of a question', async () => {
    const { list } = reorderClinic();
    const stepOf = new Map(list.questions.map((question) => [question.id, question.stepId]));
    const before = stripLabels();
    await act(async () => {
      fireEvent.click(questionDown('Nome da clínica'));
    });
    await act(async () => {
      fireEvent.click(questionDown('A clínica tem equipe?'));
    });
    for (const call of mocks.layout.mock.calls) {
      const sent = call[0] as { steps: { id: string; questionIds: string[] }[] };
      for (const entry of sent.steps) {
        for (const id of entry.questionIds) expect(stepOf.get(id)).toBe(entry.id);
      }
    }
    // every row is still inside the same rail: the strips, in the same order, with the same rows
    expect(stripLabels()).toEqual(before);
    expect(
      within(
        screen
          .getByRole('button', { name: 'Subir “Nome do sócio”' })
          .closest('div.border-l-2') as HTMLElement,
      ).getAllByText('Nome do sócio').length,
    ).toBe(1);
  });

  it('the arrows of a lone question or of the only root are disabled and send nothing', async () => {
    reorderClinic();
    for (const title of [OPENER_TITLE, 'Nome do sócio', 'A clínica tem equipe?']) {
      const upButton = questionUp(title);
      const downButton = questionDown(title);
      if (title === 'A clínica tem equipe?') {
        expect(isDisabled(upButton)).toBe(true); // first of its run
        expect(isDisabled(downButton)).toBe(false);
      } else {
        expect(isDisabled(upButton)).toBe(true);
        expect(isDisabled(downButton)).toBe(true);
      }
      await act(async () => {
        fireEvent.click(upButton);
      });
    }
    expect(mocks.layout).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('shows the branch arrows only for an opener with two runs in the step, disabled on the first and last', () => {
    reorderClinic();
    expect(screen.queryByRole('button', { name: /^Editar ramo/ })).toBeNull();
    expect(isDisabled(branchUp(B1_LABEL))).toBe(true);
    expect(isDisabled(branchDown(B1_LABEL))).toBe(false);
    expect(isDisabled(branchUp(B4_LABEL))).toBe(false);
    expect(isDisabled(branchDown(B4_LABEL))).toBe(true);
    expect(branchUp(B4_LABEL).className).toContain('min-h-[44px]');
    // Q2 has a single branch: no arrows for it
    expect(screen.queryByRole('button', { name: `Subir ramo “${B2_LABEL}”` })).toBeNull();
    expect(screen.queryByRole('button', { name: `Descer ramo “${B2_LABEL}”` })).toBeNull();
  });

  it('moves a branch run as a block among the runs of its opener, saves at once and announces its place', async () => {
    const { step } = reorderClinic();
    await act(async () => {
      fireEvent.click(branchDown(B1_LABEL));
    });
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.layout).toHaveBeenCalledWith({
      steps: [{ id: step.id, questionIds: ids('Q1', 'Q7', 'Q2', 'Q4', 'Q5', 'Q6', 'Q3') }],
    });
    expect(stripLabels()).toEqual([B4_LABEL, B1_LABEL, B2_LABEL, 'Se “Tem sócio?” for Sim']);
    expect(live()).toBe(`O ramo “${B1_LABEL}” agora é o ramo 2 de 2 desta pergunta.`);
    expect(mocks.reorder).not.toHaveBeenCalled();
  });

  it('keeps focus on the moved branch control (its sibling when it is now at the edge)', async () => {
    reorderClinic();
    await act(async () => {
      fireEvent.click(branchDown(B1_LABEL));
    });
    // B1 is now the last run: its "Descer" is disabled, so the focus lands on its "Subir"
    expect(document.activeElement).toBe(branchUp(B1_LABEL));
  });

  it('a press at the first or last run changes nothing and sends nothing', async () => {
    reorderClinic();
    await act(async () => {
      fireEvent.click(branchUp(B1_LABEL));
      fireEvent.click(branchDown(B4_LABEL));
    });
    expect(mocks.layout).not.toHaveBeenCalled();
    expect(stripLabels()[0]).toBe(B1_LABEL);
  });

  it('a server coded 409 puts the branch back and renders the same sentence naming the two questions', async () => {
    mocks.layout.mockResolvedValue({
      ok: false,
      code: 'condition_order',
      questionId: clinicId('Q7'),
      openerId: clinicId('Q1'),
    });
    reorderClinic();
    await act(async () => {
      fireEvent.click(branchUp(B4_LABEL));
    });
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(stripLabels()).toEqual([B1_LABEL, B2_LABEL, 'Se “Tem sócio?” for Sim', B4_LABEL]);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: `“Onde estuda?” precisa ficar depois de “${OPENER_TITLE}”, que decide se ela aparece.`,
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(live()).toBe('');
  });

  it('puts the branch back and toasts when the write fails', async () => {
    mocks.layout.mockResolvedValue({ ok: false, code: 'failed' });
    reorderClinic();
    await act(async () => {
      fireEvent.click(branchDown(B1_LABEL));
    });
    expect(stripLabels()[0]).toBe(B1_LABEL);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar a nova ordem. A lista voltou como estava.',
    });
  });

  describe('the refusals name the two QUESTIONS (D-652)', () => {
    const X1 = adminStep({ title: 'Primeira' });
    const X2 = adminStep({ title: 'Segunda' });
    const XQ = adminQuestion('yes_no', { title: 'Tem clínica?', stepId: X1.id });
    const XB = adminBranch({ openerQuestionId: XQ.id, values: ['true'], questionCount: 2 });
    const XA = adminQuestion('short_text', {
      title: 'Nome da clínica',
      stepId: X2.id,
      branchId: XB.id,
    });
    const XN = adminQuestion('short_text', {
      title: 'Quantas salas?',
      stepId: X2.id,
      branchId: XB.id,
    });
    const scenario = { questions: [XQ, XA, XN], steps: [X1, X2], branches: [XB] };

    it('a step arrow that puts a branch question above its opener moves NOTHING and says it must follow', async () => {
      builder(scenario);
      enterReorder();
      await act(async () => {
        fireEvent.click(stepUp('Segunda'));
      });
      expect(mocks.layout).not.toHaveBeenCalled();
      expect(wellTitles()).toEqual(['Primeira', 'Segunda']);
      expect(mocks.show).toHaveBeenCalledWith({
        tone: 'error',
        message:
          '“Nome da clínica” precisa ficar depois de “Tem clínica?”, que decide se ela aparece.',
      });
      expect(live()).toBe('');
    });

    it('the opener step going down moves NOTHING and says the opener must come first', async () => {
      builder(scenario);
      enterReorder();
      await act(async () => {
        fireEvent.click(stepDown('Primeira'));
      });
      expect(mocks.layout).not.toHaveBeenCalled();
      expect(mocks.show).toHaveBeenCalledWith({
        tone: 'error',
        message:
          '“Tem clínica?” precisa ficar antes de “Nome da clínica”, que só aparece conforme a resposta dela.',
      });
    });

    it('the arrows of a question that is alone with its opener in its branch are both disabled', async () => {
      const lone = adminQuestion('short_text', { title: 'Cargo', stepId: X1.id });
      const same = adminQuestion('short_text', {
        title: 'Nome do negócio',
        stepId: X1.id,
        branchId: XB.id,
      });
      builder({ questions: [XQ, same, lone], steps: [X1, X2], branches: [XB] });
      enterReorder();
      expect(isDisabled(questionUp('Nome do negócio'))).toBe(true);
      expect(isDisabled(questionDown('Nome do negócio'))).toBe(true);
      await act(async () => {
        fireEvent.click(questionUp('Nome do negócio'));
      });
      expect(mocks.layout).not.toHaveBeenCalled();
    });
  });
});

describe('12.2-16 Task 1: the Lista footer adds a question into a branch (D-651)', () => {
  const T1 = adminStep({ title: 'Geral' });
  const T2 = adminStep({ title: 'Clínica' });
  const OPT = [
    { id: uuid(9501), label: 'Tenho', answerCount: 0 },
    { id: uuid(9502), label: 'Não tenho', answerCount: 0 },
  ];
  const OPENER = adminQuestion('single_choice', {
    title: 'Tem clínica?',
    stepId: T1.id,
    options: OPT,
    opensCount: 1,
  });
  const BR = adminBranch({
    openerQuestionId: OPENER.id,
    values: [uuid(9501)],
    name: 'Quem tem clínica',
    questionCount: 1,
  });
  const MEMBER = adminQuestion('short_text', {
    title: 'Nome da clínica',
    stepId: T2.id,
    branchId: BR.id,
  });
  const EMPTY = adminBranch({
    openerQuestionId: OPENER.id,
    values: [uuid(9502)],
    name: 'Ramo vazio',
  });

  const footer = (label: string) =>
    screen.getByRole('button', { name: `Adicionar pergunta ao ramo: ${label}` });

  it('wires the footer: the create sheet opens with the branch and the step of the run chosen', async () => {
    mocks.create.mockResolvedValue({ ok: true, question: MEMBER, pending: null });
    builder({ questions: [OPENER, MEMBER], steps: [T1, T2], branches: [BR] });
    fireEvent.click(footer('Quem tem clínica'));
    expect(screen.getByRole('dialog', { name: 'Nova pergunta' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^Texto curto/ }));
    expect((screen.getByLabelText('Ramo') as HTMLSelectElement).value).toBe(BR.id);
    expect((screen.getByLabelText('Etapa') as HTMLSelectElement).value).toBe(T2.id);

    fireEvent.change(screen.getByLabelText('Pergunta'), { target: { value: 'Telefone' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar pergunta' }));
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const body = mocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.branchId).toBe(BR.id);
    expect(body.stepId).toBe(T2.id);
    expect('condition' in body).toBe(false);
  });

  it('puts an empty branch into the last step', () => {
    builder({ questions: [OPENER, MEMBER], steps: [T1, T2], branches: [BR, EMPTY] });
    fireEvent.click(footer('Ramo vazio'));
    fireEvent.click(screen.getByRole('radio', { name: /^Texto curto/ }));
    expect((screen.getByLabelText('Ramo') as HTMLSelectElement).value).toBe(EMPTY.id);
    expect((screen.getByLabelText('Etapa') as HTMLSelectElement).value).toBe(T2.id);
  });

  it('opens the ordinary create sheet from the top button, with no branch chosen', () => {
    builder({ questions: [OPENER, MEMBER], steps: [T1, T2], branches: [BR] });
    fireEvent.click(
      screen.getAllByRole('button', { name: /^Adicionar pergunta$/ })[0] as HTMLElement,
    );
    fireEvent.click(screen.getByRole('radio', { name: /^Texto curto/ }));
    expect((screen.getByLabelText('Ramo') as HTMLSelectElement).value).toBe('');
  });
});

describe('12.2-16 Task 2: "Criar ramo" hands over to the branch sheet, never stacked (D-651, UI-D-670)', () => {
  const U1 = adminStep({ title: 'Geral' });
  const OA = uuid(9901);
  const OB = uuid(9902);
  const OPENER = adminQuestion('single_choice', {
    title: 'Tem clínica?',
    stepId: U1.id,
    options: [
      { id: OA, label: 'Tenho', answerCount: 0 },
      { id: OB, label: 'Não tenho', answerCount: 0 },
    ],
  });
  const PLAIN = adminQuestion('short_text', { title: 'Cargo', stepId: U1.id });
  const SAVED = adminBranch({ openerQuestionId: OPENER.id, values: [OB], name: null });

  beforeEach(() => {
    mocks.createBranch.mockResolvedValue({ ok: true, branch: SAVED });
  });

  const openOpener = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Editar pergunta: Tem clínica?' }));
  const createBranchButton = () => screen.getByRole('button', { name: 'Criar ramo' });

  it('closes the question sheet and opens "Novo ramo" with the opener, with one sheet in the page', () => {
    builder({ questions: [OPENER, PLAIN], steps: [U1], branches: [] });
    openOpener();
    expect(screen.getByRole('dialog', { name: 'Editar pergunta' })).toBeTruthy();
    fireEvent.click(createBranchButton());
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Novo ramo' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Editar pergunta' })).toBeNull();
    expect(document.querySelector('[data-branch-opener]')?.textContent).toContain('Tem clínica?');
    expect(screen.getByLabelText('Tenho')).toBeTruthy();
  });

  it('goes through the dirty guard: nothing typed is lost silently, and the sheets never overlap', () => {
    builder({ questions: [OPENER, PLAIN], steps: [U1], branches: [] });
    openOpener();
    fireEvent.change(screen.getByLabelText('Pergunta'), { target: { value: 'Novo título' } });
    fireEvent.click(createBranchButton());
    expect(screen.queryByRole('dialog', { name: 'Novo ramo' })).toBeNull();
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Descartar as alterações?' })).getByRole('button', {
        name: 'Continuar editando',
      }),
    );
    expect(screen.getByRole('dialog', { name: 'Editar pergunta' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Novo ramo' })).toBeNull();

    fireEvent.click(createBranchButton());
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Descartar as alterações?' })).getByRole('button', {
        name: 'Descartar',
      }),
    );
    expect(screen.getByRole('dialog', { name: 'Novo ramo' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Editar pergunta' })).toBeNull();
  });

  it('creates the branch, toasts, refreshes the page and closes the sheet', async () => {
    builder({ questions: [OPENER, PLAIN], steps: [U1], branches: [] });
    openOpener();
    fireEvent.click(createBranchButton());
    fireEvent.click(screen.getByLabelText('Não tenho'));
    fireEvent.change(screen.getByLabelText('Nome do ramo (opcional)'), {
      target: { value: 'Sem clínica' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar ramo' }));
    });
    expect(mocks.createBranch).toHaveBeenCalledWith({
      openerQuestionId: OPENER.id,
      values: [OB],
      name: 'Sem clínica',
    });
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Ramo criado.' });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the branch sheet without writing when the admin leaves it untouched', async () => {
    builder({ questions: [OPENER, PLAIN], steps: [U1], branches: [] });
    openOpener();
    fireEvent.click(createBranchButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.createBranch).not.toHaveBeenCalled();
  });

  it('can start again after the first branch sheet: a fresh sheet per opening', () => {
    builder({ questions: [OPENER, PLAIN], steps: [U1], branches: [] });
    openOpener();
    fireEvent.click(createBranchButton());
    fireEvent.click(screen.getByLabelText('Tenho'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Descartar as alterações?' })).getByRole('button', {
        name: 'Descartar',
      }),
    );
    openOpener();
    fireEvent.click(createBranchButton());
    expect((screen.getByLabelText('Tenho') as HTMLInputElement).checked).toBe(false);
  });

  it('hands the sheet the question for a question that is not an opener type: no block at all', () => {
    builder({ questions: [OPENER, PLAIN], steps: [U1], branches: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Editar pergunta: Cargo' }));
    expect(document.querySelector('[data-branches-block]')).toBeNull();
  });
});

describe('12.2-17 Task 1: an existing branch opens from the Lista and from its opener (D-640, UI-D-671)', () => {
  const V1 = adminStep({ title: 'Geral' });
  const V2 = adminStep({ title: 'Clínica' });
  const OA = uuid(9801);
  const OB = uuid(9802);
  const OPENER = adminQuestion('single_choice', {
    title: 'Tem clínica?',
    stepId: V1.id,
    options: [
      { id: OA, label: 'Tenho', answerCount: 0 },
      { id: OB, label: 'Não tenho', answerCount: 0 },
    ],
    opensCount: 1,
  });
  const BR = adminBranch({
    openerQuestionId: OPENER.id,
    values: [OA],
    name: 'Quem tem clínica',
    revision: 2,
    questionCount: 1,
  });
  const MEMBER = adminQuestion('short_text', {
    title: 'Nome da clínica',
    stepId: V2.id,
    branchId: BR.id,
  });

  beforeEach(() => {
    mocks.updateBranch.mockResolvedValue({ ok: true, branch: { ...BR, revision: 3 } });
  });

  const props = () => ({ questions: [OPENER, MEMBER], steps: [V1, V2], branches: [BR] });
  const pencil = () => screen.getByRole('button', { name: 'Editar ramo: Quem tem clínica' });

  it('opens the edit sheet from the pencil of the strip, with the branch as it is stored', () => {
    builder(props());
    fireEvent.click(pencil());
    expect(screen.getByRole('dialog', { name: 'Editar ramo' })).toBeTruthy();
    expect((screen.getByLabelText('Pergunta que decide') as HTMLSelectElement).value).toBe(
      OPENER.id,
    );
    expect((screen.getByLabelText('Tenho') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Nome do ramo (opcional)') as HTMLInputElement).value).toBe(
      'Quem tem clínica',
    );
    expect(
      within(screen.getByRole('dialog', { name: 'Editar ramo' })).getByText('Nome da clínica'),
    ).toBeTruthy();
  });

  it('opens the same sheet from a row of "Ramos desta pergunta", with one sheet in the page', () => {
    builder(props());
    fireEvent.click(screen.getByRole('button', { name: 'Editar pergunta: Tem clínica?' }));
    expect(screen.getByRole('dialog', { name: 'Editar pergunta' })).toBeTruthy();
    const block = document.querySelector('[data-branches-block]') as HTMLElement;
    fireEvent.click(within(block).getByRole('button', { name: /Quem tem clínica/ }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Editar ramo' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Editar pergunta' })).toBeNull();
  });

  it('goes through the dirty guard of the question sheet before it opens the branch', () => {
    builder(props());
    fireEvent.click(screen.getByRole('button', { name: 'Editar pergunta: Tem clínica?' }));
    fireEvent.change(screen.getByLabelText('Pergunta'), { target: { value: 'Outro título' } });
    const block = document.querySelector('[data-branches-block]') as HTMLElement;
    fireEvent.click(within(block).getByRole('button', { name: /Quem tem clínica/ }));
    expect(screen.queryByRole('dialog', { name: 'Editar ramo' })).toBeNull();
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Descartar as alterações?' })).getByRole('button', {
        name: 'Descartar',
      }),
    );
    expect(screen.getByRole('dialog', { name: 'Editar ramo' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Editar pergunta' })).toBeNull();
  });

  it('saves under the revision of the branch, toasts, refreshes and closes the sheet', async () => {
    builder(props());
    fireEvent.click(pencil());
    fireEvent.click(screen.getByLabelText('Não tenho'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar ramo' }));
    });
    expect(mocks.updateBranch).toHaveBeenCalledWith(BR.id, { revision: 2, values: [OA, OB] });
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Ramo salvo.' });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('retries under the new revision when the page re-reads the branch after a stale answer', async () => {
    mocks.updateBranch.mockResolvedValueOnce({ ok: false, code: 'stale_revision' });
    const view = builder(props());
    fireEvent.click(pencil());
    fireEvent.click(screen.getByLabelText('Não tenho'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar ramo' }));
    });
    expect(screen.getByRole('dialog', { name: 'Editar ramo' })).toBeTruthy();
    view.again({ ...props(), branches: [{ ...BR, revision: 7 }] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar ramo' }));
    });
    expect(mocks.updateBranch).toHaveBeenLastCalledWith(BR.id, { revision: 7, values: [OA, OB] });
  });

  it('turns "Adicionar pergunta ao ramo" into the create sheet with the branch and its last step', () => {
    builder(props());
    fireEvent.click(pencil());
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pergunta ao ramo' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Nova pergunta' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^Texto curto/ }));
    expect((screen.getByLabelText('Ramo') as HTMLSelectElement).value).toBe(BR.id);
    expect((screen.getByLabelText('Etapa') as HTMLSelectElement).value).toBe(V2.id);
  });

  it('opens a fresh sheet per opening, and never an edit sheet for an archived or vanished branch', () => {
    const view = builder(props());
    fireEvent.click(pencil());
    fireEvent.change(screen.getByLabelText('Nome do ramo (opcional)'), { target: { value: 'x' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Descartar as alterações?' })).getByRole('button', {
        name: 'Descartar',
      }),
    );
    fireEvent.click(pencil());
    expect((screen.getByLabelText('Nome do ramo (opcional)') as HTMLInputElement).value).toBe(
      'Quem tem clínica',
    );
    view.again({ ...props(), branches: [] });
    expect(screen.queryByRole('dialog', { name: 'Editar ramo' })).toBeNull();
  });

  it('undoes a branch from its sheet: impact read, confirmation, toast, refresh, sheet closed', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 2 });
    mocks.undoBranch.mockResolvedValue({ ok: true });
    builder(props());
    fireEvent.click(pencil());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Desfazer ramo' }));
    });
    expect(mocks.impact).toHaveBeenCalledWith({ change: 'undo_branch', branchId: BR.id });
    const confirm = screen.getByRole('dialog', { name: 'Desfazer este ramo?' });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Desfazer e exigir' }));
    });
    expect(mocks.undoBranch).toHaveBeenCalledWith(BR.id);
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Ramo desfeito.' });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('archives a branch from its sheet: confirmation, toast, refresh, sheet closed', async () => {
    mocks.archiveBranch.mockResolvedValue({
      ok: true,
      branch: { ...BR, archivedAt: '2026-11-06' },
    });
    builder(props());
    fireEvent.click(pencil());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arquivar ramo' }));
    });
    const confirm = screen.getByRole('dialog', { name: 'Arquivar este ramo?' });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Arquivar ramo' }));
    });
    expect(mocks.archiveBranch).toHaveBeenCalledWith(BR.id);
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Ramo arquivado.' });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the sheet open and names the openers to undo first when the server refuses', async () => {
    mocks.archiveBranch.mockResolvedValue({
      ok: false,
      code: 'hasDependents',
      dependents: [{ id: uuid(9899), title: 'Tem equipe?' }],
    });
    builder(props());
    fireEvent.click(pencil());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arquivar ramo' }));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Arquivar este ramo?' })).getByRole('button', {
          name: 'Arquivar ramo',
        }),
      );
    });
    expect(screen.getByRole('dialog', { name: 'Editar ramo' })).toBeTruthy();
    expect(screen.getByText('Este ramo não pode ser arquivado agora.')).toBeTruthy();
    expect(screen.getByText('Tem equipe?')).toBeTruthy();
    expect(mocks.show).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* 12.2-19: the Lista | Fluxo selector and the Fluxo in the builder (D-647, D-648; UI-D-665, UI-D-677). */
/* ------------------------------------------------------------------------------------------------ */

describe('12.2-19 Task 1 (tracer): the selector exists only with a branch, and the Fluxo opens the editors (D-647, D-648, UI-D-665)', () => {
  const CLINIC = clinicAdminList();
  const withBranches = () => ({
    questions: CLINIC.questions,
    steps: CLINIC.steps,
    branches: CLINIC.branches ?? [],
  });
  const group = () => screen.getByRole('group', { name: 'Como ver as perguntas' });
  const flowButton = () => within(group()).getByRole('button', { name: 'Fluxo' });
  const listButton = () => within(group()).getByRole('button', { name: 'Lista' });
  const flowSection = () => screen.queryByRole('region', { name: 'Fluxo do formulário' });
  const Q1 = 'Você tem clínica, trabalha em clínica ou está aprendendo?';

  it('renders no selector and no Fluxo for a form without a branch (byte for byte Phase 12.1)', () => {
    builder({ questions: [QA, QB], steps: [S1, S2] });
    expect(screen.queryByRole('group', { name: 'Como ver as perguntas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fluxo' })).toBeNull();
    expect(flowSection()).toBeNull();
  });

  it('renders no selector when every branch is archived', () => {
    const archived = (CLINIC.branches ?? []).map((branch) => ({
      ...branch,
      archivedAt: '2026-11-06T10:00:00.000Z',
    }));
    builder({ ...withBranches(), branches: archived });
    expect(screen.queryByRole('group', { name: 'Como ver as perguntas' })).toBeNull();
  });

  it('shows the selector with a branch: Lista | Fluxo, Lista pressed, named by an sr-only element', () => {
    builder(withBranches());
    expect(listButton().getAttribute('aria-pressed')).toBe('true');
    expect(flowButton().getAttribute('aria-pressed')).toBe('false');
    const label = document.getElementById(group().getAttribute('aria-labelledby') as string);
    expect(label?.textContent).toBe('Como ver as perguntas');
    expect(label?.className).toContain('sr-only');
    expect(flowSection()).toBeNull();
    expect(document.querySelector('[data-branch-strip]')).not.toBeNull();
  });

  it('sits between the actions row and the "Perguntas ativas" micro-title, never wider than max-w-xs', () => {
    builder(withBranches());
    const add = screen.getByRole('button', { name: 'Adicionar pergunta' });
    const title = screen.getByText(/^Perguntas ativas \(\d+\)$/);
    expect(add.compareDocumentPosition(group()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group().compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const wrapper = group().parentElement as HTMLElement;
    expect(wrapper.className).toContain('w-full');
    expect(wrapper.className).toContain('max-w-xs');
  });

  it('switches to the Fluxo: the drawing replaces the list, and Reordenar and Adicionar etapa hide', () => {
    builder(withBranches());
    fireEvent.click(flowButton());
    expect(flowButton().getAttribute('aria-pressed')).toBe('true');
    expect(flowSection()).not.toBeNull();
    expect(document.querySelector('[data-branch-strip]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reordenar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adicionar etapa' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Adicionar pergunta' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver como o membro vê' })).toBeTruthy();
    fireEvent.click(listButton());
    expect(flowSection()).toBeNull();
    expect(screen.getByRole('button', { name: 'Reordenar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Adicionar etapa' })).toBeTruthy();
  });

  it('is disabled while Reordenar is on and enabled again when it ends', () => {
    builder(withBranches());
    fireEvent.click(screen.getByRole('button', { name: 'Reordenar' }));
    expect((flowButton() as HTMLButtonElement).disabled).toBe(true);
    expect((listButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect((flowButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the choice in component state: a re-read of the same form stays in the Fluxo', () => {
    const view = builder(withBranches());
    fireEvent.click(flowButton());
    view.again({ ...withBranches(), questions: [...CLINIC.questions] });
    expect(flowSection()).not.toBeNull();
  });

  it('falls back to the Lista when the last branch goes away, and does not come back on its own', () => {
    const view = builder(withBranches());
    fireEvent.click(flowButton());
    view.again({
      questions: CLINIC.questions.map((q) => ({ ...q, branchId: null })),
      steps: CLINIC.steps,
      branches: [],
    });
    expect(flowSection()).toBeNull();
    expect(screen.queryByRole('group', { name: 'Como ver as perguntas' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reordenar' })).toBeTruthy();
    view.again(withBranches());
    expect(listButton().getAttribute('aria-pressed')).toBe('true');
    expect(flowSection()).toBeNull();
  });

  it('opens the question sheet in edit mode from a node, with the question as it is', () => {
    builder(withBranches());
    fireEvent.click(flowButton());
    fireEvent.click(screen.getByRole('button', { name: 'Editar pergunta: Nome da clínica' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Editar pergunta' })).toBeTruthy();
    expect((screen.getByLabelText('Pergunta') as HTMLInputElement).value).toBe('Nome da clínica');
  });

  it('opens the branch sheet in edit mode from an edge, with the branch as it is stored', () => {
    builder(withBranches());
    fireEvent.click(flowButton());
    fireEvent.click(screen.getByRole('button', { name: 'Se for “Estou aprendendo” · 1 pergunta' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Editar ramo' })).toBeTruthy();
    expect((screen.getByLabelText('Pergunta que decide') as HTMLSelectElement).value).toBe(
      clinicId('Q1'),
    );
    expect((screen.getByLabelText('Estou aprendendo') as HTMLInputElement).checked).toBe(true);
  });

  it('returns focus to the node that opened the question sheet when it closes', async () => {
    builder(withBranches());
    fireEvent.click(flowButton());
    const target = screen.getByRole('button', { name: 'Editar pergunta: Nome da clínica' });
    target.focus();
    fireEvent.click(target);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Editar pergunta: Nome da clínica' }),
    );
  });

  it('returns focus to the edge that opened the branch sheet even when the browser never focused it', async () => {
    builder(withBranches());
    fireEvent.click(flowButton());
    const edge = screen.getByRole('button', { name: 'Se for “Estou aprendendo” · 1 pergunta' });
    // Safari does not focus a button on tap: the tap alone must be enough to find the way back.
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(edge);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(edge);
  });

  it('shows a write from a sheet opened over the Fluxo on return, from the same single read', () => {
    const view = builder(withBranches());
    fireEvent.click(flowButton());
    expect(screen.getByRole('button', { name: `Editar pergunta: ${Q1}` })).toBeTruthy();
    // The page re-reads after a write: a question archived meanwhile is gone from BOTH views.
    const without = CLINIC.questions.filter((q) => q.id !== clinicId('Q7'));
    view.again({ ...withBranches(), questions: without });
    expect(screen.queryByRole('button', { name: 'Editar pergunta: Onde estuda?' })).toBeNull();
    fireEvent.click(listButton());
    expect(screen.queryByRole('button', { name: 'Editar pergunta: Onde estuda?' })).toBeNull();
  });
});

describe('12.2-19 Task 3: "Ver como o membro vê" in the builder follows the branches it holds (D-651, UI-D-678)', () => {
  const CLINIC = clinicAdminList();
  const named = () => ({
    questions: CLINIC.questions,
    steps: CLINIC.steps,
    branches: (CLINIC.branches ?? []).map((branch) =>
      branch.id === clinicId('B1') ? { ...branch, name: 'Quem tem clínica' } : branch,
    ),
  });
  const preview = () => screen.getByRole('dialog', { name: 'Como o membro vê' });

  it('opens the whole block under the opener, then the nested one, and never shows a branch name', () => {
    builder(named());
    fireEvent.click(screen.getByRole('button', { name: 'Ver como o membro vê' }));
    expect(within(preview()).queryByLabelText('Nome da clínica')).toBeNull();
    expect(preview().querySelector('[data-revealed-branch]')).toBeNull();
    fireEvent.click(within(preview()).getByRole('radio', { name: 'Tenho uma clínica' }));
    const first = preview().querySelectorAll('[data-revealed-branch]');
    expect(first).toHaveLength(1);
    expect(within(first[0] as HTMLElement).getByLabelText('Nome da clínica')).toBeTruthy();
    expect(within(first[0] as HTMLElement).getByText('A clínica tem equipe?')).toBeTruthy();
    fireEvent.click(within(preview()).getAllByRole('button', { name: 'Sim' })[0] as HTMLElement);
    expect(preview().querySelectorAll('[data-revealed-branch]').length).toBeGreaterThanOrEqual(2);
    expect(within(preview()).getByText('Tem sócio?')).toBeTruthy();
    expect(preview().textContent).not.toContain('Quem tem clínica');
  });

  it('opens from the Fluxo too, over the same branches', () => {
    builder(named());
    fireEvent.click(screen.getByRole('button', { name: 'Fluxo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver como o membro vê' }));
    fireEvent.click(within(preview()).getByRole('radio', { name: 'Estou aprendendo' }));
    expect(within(preview()).getByLabelText('Onde estuda?')).toBeTruthy();
    expect(within(preview()).queryByLabelText('Nome da clínica')).toBeNull();
  });
});
