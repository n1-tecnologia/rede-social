// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseCardView, MyCasesPageView } from '@/lib/chat-view';

/**
 * 12.4-13 Task 2 (UI-D-821, UI-D-832; UC M12, M13, M15; W11): the "Meus chamados" list. The catalog is the
 * REAL pt-BR one through next-intl's own translator; the server action is a mock and only `InfiniteScroll`
 * and `PullToRefresh` are swapped for buttons (happy-dom has no scroll sentinel and no touch pull).
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    useTranslations: (namespace: string) => {
      let tr = byNamespace.get(namespace);
      if (!tr) {
        tr = actual.createTranslator({ locale: 'pt-BR', messages, namespace });
        byNamespace.set(namespace, tr);
      }
      return tr;
    },
  };
});

vi.mock('../actions', () => ({ loadMoreMyCasesAction: vi.fn() }));

vi.mock('@rede-social/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rede-social/ui')>();
  const { createElement, Fragment } = await import('react');
  return {
    ...actual,
    InfiniteScroll: ({
      hasMore,
      enabled = true,
      onLoadMore,
    }: {
      hasMore: boolean;
      enabled?: boolean;
      onLoadMore: () => void | Promise<void>;
    }) =>
      hasMore && enabled
        ? createElement(
            'button',
            { type: 'button', 'data-testid': 'load-more', onClick: () => void onLoadMore() },
            'load-more',
          )
        : null,
    PullToRefresh: ({
      children,
      onRefresh,
    }: {
      children: ReactNode;
      onRefresh: () => Promise<void> | void;
    }) =>
      createElement(
        Fragment,
        null,
        createElement(
          'button',
          { type: 'button', 'data-testid': 'pull', onClick: () => void onRefresh() },
          'pull',
        ),
        children,
      ),
  };
});

const { loadMoreMyCasesAction } = await import('../actions');
const { MyCasesList } = await import('./MyCasesList');
const action = vi.mocked(loadMoreMyCasesAction);

let seq = 0;
function card(over: Partial<CaseCardView> = {}): CaseCardView {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    href: `/suporte/${id}`,
    number: seq,
    title: `Chamado #${seq}`,
    state: { state: 'closed', label: 'Fechado', tone: 'neutral', glyph: 'Lock' },
    subject: `Assunto ${seq}`,
    hasSubject: true,
    preview: 'Equipe: ok',
    category: 'Outro',
    time: 'Ontem',
    closed: true,
    ...over,
  };
}

const active = (over: Partial<CaseCardView> = {}) =>
  card({
    state: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
    closed: false,
    ...over,
  });

function page(over: Partial<MyCasesPageView> = {}): MyCasesPageView {
  return { current: null, items: [], total: 0, nextCursor: null, ...over };
}

beforeEach(() => {
  seq = 0;
  action.mockReset();
});
afterEach(cleanup);

const titles = () => screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const cardNumbers = () =>
  Array.from(document.querySelectorAll('a[data-case-card]')).map((a) => a.textContent);

describe('MyCasesList sections (UC M12, M13)', () => {
  it('only a current case: just "Chamado atual" with its count', () => {
    render(<MyCasesList initial={page({ current: active(), total: 1 })} />);
    expect(titles()).toEqual(['Chamado atual1']);
    expect(screen.queryByText('Anteriores')).toBeNull();
  });

  it('only past cases: just "Anteriores", the count being the closed ones', () => {
    render(<MyCasesList initial={page({ items: [card(), card()], total: 2 })} />);
    expect(titles()).toEqual(['Anteriores2']);
    expect(cardNumbers()).toHaveLength(2);
  });

  it('both: "Chamado atual" then "Anteriores", the past count being the closed total', () => {
    render(
      <MyCasesList initial={page({ current: active(), items: [card(), card()], total: 2 })} />,
    );
    expect(titles()).toEqual(['Chamado atual1', 'Anteriores2']);
  });

  it('neither: the empty state with its copy and the "Falar com a equipe" action, no redirect', () => {
    render(<MyCasesList initial={page()} />);
    expect(screen.getByText('Você ainda não abriu nenhum chamado')).toBeTruthy();
    expect(
      screen.getByText('Quando você falar com a equipe, o chamado aparece aqui.'),
    ).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Falar com a equipe' });
    expect(cta.getAttribute('href')).toBe('/suporte');
    expect(titles()).toEqual([]);
  });
});

describe('MyCasesList paging (UC M13 overflow, M15)', () => {
  it('appends the next page with the cursor and never repeats a card', async () => {
    const first = card();
    const second = card();
    const third = card();
    action.mockResolvedValue({
      ok: true,
      ...page({ items: [second, third], total: 3, nextCursor: null }),
    });
    render(<MyCasesList initial={page({ items: [first, second], total: 3, nextCursor: 'c1' })} />);

    fireEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(cardNumbers()).toHaveLength(3));
    expect(action).toHaveBeenCalledWith('c1');
    expect(new Set(cardNumbers()).size).toBe(3);
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('load-more appends only items: the current case and the counts stay as they were', async () => {
    const current = active();
    action.mockResolvedValue({
      ok: true,
      ...page({
        current: active({ subject: 'OUTRO' }),
        items: [card()],
        total: 9,
        nextCursor: null,
      }),
    });
    render(
      <MyCasesList initial={page({ current, items: [card()], total: 2, nextCursor: 'c1' })} />,
    );
    fireEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(cardNumbers()).toHaveLength(3));
    expect(screen.queryByText('OUTRO')).toBeNull();
    expect(titles()).toEqual(['Chamado atual1', 'Anteriores2']);
  });

  it('a failed page keeps the rows, shows the inline line and retries', async () => {
    action.mockResolvedValueOnce({ ok: false });
    render(<MyCasesList initial={page({ items: [card()], total: 1, nextCursor: 'c1' })} />);
    fireEvent.click(screen.getByTestId('load-more'));
    await screen.findByText('Não foi possível carregar mais chamados.');
    expect(cardNumbers()).toHaveLength(1);
    expect(screen.queryByTestId('load-more')).toBeNull();

    action.mockResolvedValueOnce({ ok: true, ...page({ items: [card()], total: 2 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    fireEvent.click(await screen.findByTestId('load-more'));
    await waitFor(() => expect(cardNumbers()).toHaveLength(2));
    expect(screen.queryByText('Não foi possível carregar mais chamados.')).toBeNull();
  });

  it('a page that throws is the same inline failure, never an unhandled rejection', async () => {
    action.mockRejectedValueOnce(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MyCasesList initial={page({ items: [card()], total: 1, nextCursor: 'c1' })} />);
    fireEvent.click(screen.getByTestId('load-more'));
    await screen.findByText('Não foi possível carregar mais chamados.');
    spy.mockRestore();
  });
});

describe('the Anteriores count is the closed total (WR-03)', () => {
  const closedCards = (count: number) => Array.from({ length: count }, () => card());

  it('a current case, 20 of 25 closed ones loaded: "Anteriores" reads 25, with no subtraction', () => {
    render(
      <MyCasesList
        initial={page({
          current: active(),
          items: closedCards(20),
          total: 25,
          nextCursor: 'c1',
        })}
      />,
    );
    expect(titles()).toEqual(['Chamado atual1', 'Anteriores25']);
  });

  it('exactly 20 closed with no more pages reads 20', () => {
    render(
      <MyCasesList
        initial={page({ current: active(), items: closedCards(20), total: 20, nextCursor: null })}
      />,
    );
    expect(titles()).toEqual(['Chamado atual1', 'Anteriores20']);
  });

  it('a current case and no closed one draws no "Anteriores" section', () => {
    render(<MyCasesList initial={page({ current: active(), total: 0 })} />);
    expect(titles()).toEqual(['Chamado atual1']);
    expect(screen.queryByText('Anteriores')).toBeNull();
  });

  it("a pull-to-refresh replaces the number with the answer's total", async () => {
    action.mockResolvedValue({
      ok: true,
      ...page({ current: active(), items: closedCards(2), total: 7, nextCursor: 'c9' }),
    });
    render(<MyCasesList initial={page({ items: closedCards(1), total: 1 })} />);
    expect(titles()).toEqual(['Anteriores1']);
    fireEvent.click(screen.getByTestId('pull'));
    await waitFor(() => expect(titles()).toEqual(['Chamado atual1', 'Anteriores7']));
  });
});

describe('MyCasesList refresh (W11)', () => {
  it('asks for page 1 with a null cursor and REPLACES the current case, the list and the counts', async () => {
    const stale = card({ subject: 'VELHO' });
    action.mockResolvedValue({
      ok: true,
      ...page({
        current: active({ subject: 'NOVO ATUAL' }),
        items: [card({ subject: 'NOVO PASSADO' })],
        total: 1,
        nextCursor: null,
      }),
    });
    render(<MyCasesList initial={page({ items: [stale], total: 1, nextCursor: 'c1' })} />);
    expect(titles()).toEqual(['Anteriores1']);

    fireEvent.click(screen.getByTestId('pull'));
    await screen.findByText('NOVO ATUAL');
    expect(action).toHaveBeenCalledWith(null);
    expect(screen.queryByText('VELHO')).toBeNull();
    expect(screen.getByText('NOVO PASSADO')).toBeTruthy();
    expect(titles()).toEqual(['Chamado atual1', 'Anteriores1']);
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('a refresh that fails keeps what is on screen', async () => {
    action.mockResolvedValue({ ok: false });
    render(<MyCasesList initial={page({ items: [card({ subject: 'FICA' })], total: 1 })} />);
    fireEvent.click(screen.getByTestId('pull'));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(screen.getByText('FICA')).toBeTruthy();
  });

  it('a page that was in flight when the list was refreshed is dropped, not appended to the new list', async () => {
    let release: (value: unknown) => void = () => {};
    action.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)) as never);
    render(<MyCasesList initial={page({ items: [card()], total: 5, nextCursor: 'c1' })} />);
    fireEvent.click(screen.getByTestId('load-more'));

    action.mockResolvedValueOnce({
      ok: true,
      ...page({ items: [card({ subject: 'FRESCO' })], total: 1, nextCursor: null }),
    });
    fireEvent.click(screen.getByTestId('pull'));
    await screen.findByText('FRESCO');

    release({ ok: true, ...page({ items: [card({ subject: 'ATRASADO' })], total: 5 }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText('ATRASADO')).toBeNull();
    expect(cardNumbers()).toHaveLength(1);
  });
});

describe('MyCasesList first load error (UC M15)', () => {
  it('shows the card with retry, and a successful retry shows the list', async () => {
    action.mockResolvedValue({ ok: true, ...page({ items: [card()], total: 1 }) });
    render(<MyCasesList initial={null} />);
    expect(screen.getByText('Não foi possível carregar seus chamados.')).toBeTruthy();
    expect(screen.getByText('Verifique sua conexão e tente de novo.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(cardNumbers()).toHaveLength(1));
    expect(action).toHaveBeenCalledWith(null);
    expect(screen.queryByText('Não foi possível carregar seus chamados.')).toBeNull();
  });

  it('a retry that fails again keeps the error card', async () => {
    action.mockResolvedValue({ ok: false });
    render(<MyCasesList initial={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(action).toHaveBeenCalledWith(null));
    expect(screen.getByText('Não foi possível carregar seus chamados.')).toBeTruthy();
  });
});

describe('12.5-16 a list holding a voice card and a text card (D-860)', () => {
  it('keeps both cards in the server order, the glyph only on the recording', () => {
    render(
      <MyCasesList
        initial={page({
          items: [
            card({
              subject: 'Com voz',
              preview: 'Equipe: Mensagem de voz · 0:42',
              previewKind: 'voice',
            }),
            card({ subject: 'Com texto', preview: 'Equipe: ok', previewKind: 'text' }),
            card({
              subject: 'Apagada',
              preview: 'Você: Mensagem de voz apagada',
              previewKind: 'voiceDeleted',
            }),
          ],
          total: 3,
        })}
      />,
    );
    const cards = Array.from(document.querySelectorAll('a[data-case-card]'));
    expect(cards).toHaveLength(3);
    expect(cards.map((a) => a.querySelector('p')?.textContent)).toEqual([
      'Com voz',
      'Com texto',
      'Apagada',
    ]);
    expect(cards.map((a) => a.querySelector('[data-case-preview] svg') !== null)).toEqual([
      true,
      false,
      false,
    ]);
    expect(cards[0]?.querySelector('[data-case-preview]')?.textContent).toBe(
      'Equipe: Mensagem de voz · 0:42',
    );
    expect(cards[2]?.querySelector('[data-case-preview]')?.textContent).toBe(
      'Você: Mensagem de voz apagada',
    );
  });
});
