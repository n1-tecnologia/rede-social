// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminQuestion } from '@/lib/profile-form/test-fixtures';
import type { ReorderResult } from './actions';

/**
 * 12-15 Task 2 (D-582, UI-D-567, UI-D-568; T-12-33): the reorder mode of the active list against the
 * REAL catalog. The server action, the router and the toast are stubbed. Asserted: one write carrying ALL
 * the ids, focus kept on the pressed control at its new position, the live-region sentence, the disabled
 * edges, the revert and the toast on a failed write, the module-off and forbidden paths, and that rows
 * are not editor openers while the mode is on.
 */

const mocks = vi.hoisted(() => ({
  reorder: vi.fn(),
  refresh: vi.fn(),
  show: vi.fn(),
}));
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('./actions', () => ({
  reorderQuestionsAction: (ids: string[]) => mocks.reorder(ids),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: mocks.show, dismiss: vi.fn() }),
}));

const { QuestionList } = await import('./QuestionList');

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
  mocks.reorder.mockReset();
  mocks.refresh.mockReset();
  mocks.show.mockReset();
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
