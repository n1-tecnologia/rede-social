// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminQuestion, archivedQuestion } from '@/lib/profile-form/test-fixtures';
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
}));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('./actions', () => ({
  reorderQuestionsAction: (ids: string[]) => mocks.reorder(ids),
  readImpactAction: (input: unknown) => mocks.impact(input),
  reactivateQuestionAction: (id: string) => mocks.reactivate(id),
  createQuestionAction: vi.fn(),
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

function show(questions = [A, B, C], props: { onOpen?: (id: string) => void } = {}) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <QuestionList
        questions={questions}
        limit={30}
        onOpen={props.onOpen ? (question) => props.onOpen?.(question.id) : undefined}
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
});
