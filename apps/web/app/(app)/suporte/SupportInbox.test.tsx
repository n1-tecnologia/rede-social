// @vitest-environment happy-dom

import { join } from 'node:path';
import { REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { InboxCaseView, InboxRowView } from '@/lib/chat-view';
import type { SupportInboxProps } from './SupportInbox';

/**
 * 12.4-14 (UI-D-823, UI-D-824, UI-D-830, UI-D-832, D-805; UC S01 to S08; T-12.4-64, T-12.4-68): the team's
 * inbox list. The catalog is the real pt-BR one, `fetch` is the BFF `GET /api/chat/inbox` of plan 20, the
 * load-more server action and Realtime are recorders, and only `InfiniteScroll` and `PullToRefresh` are
 * swapped for buttons (happy-dom has no scroll sentinel and no touch pull).
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  loadMore: vi.fn(),
  realtime: vi.fn(),
  search: { current: '' },
  segment: { current: null as string | null },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  usePathname: () => '/suporte',
  useSelectedLayoutSegment: () => mocks.segment.current,
  useSearchParams: () => new URLSearchParams(mocks.search.current),
}));
vi.mock('./actions', () => ({
  loadMoreInboxAction: (...args: unknown[]) => mocks.loadMore(...args),
}));
vi.mock('@rede-social/core/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/core/ui')>()),
  useRealtimeTopic: (...args: unknown[]) => mocks.realtime(...args),
}));
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
    PullToRefresh: ({ children }: { children: ReactNode }) =>
      createElement(Fragment, null, children),
  };
});

const { SupportInbox } = await import('./SupportInbox');

const TENANT_ID = '99999999-9999-4999-8999-999999999999';

let seq = 0;
function view(over: Partial<InboxRowView> = {}, kase: Partial<InboxCaseView> | null = {}) {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const row: InboxRowView = {
    conversationId: id,
    href: `/suporte/${id}`,
    name: `Membro ${seq}`,
    avatar: null,
    preview: `preview ${seq}`,
    time: '10:00',
    awaiting: false,
    state: 'active',
    case:
      kase === null
        ? null
        : {
            number: seq,
            subjectLine: `#${seq} · Assunto ${seq}`,
            state: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
            priority: null,
            meta: 'Pagamento · Sem responsável',
            ...kase,
          },
    ...over,
  };
  return row;
}

const fetchMock = vi.fn();
let inboxAnswer: (url: string) => Promise<Response> | Response = () =>
  Response.json({ items: [], nextCursor: null });

const inboxUrls = () =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/api/chat/inbox'));

function ui(over: Partial<SupportInboxProps> = {}): ReactNode {
  const props: SupportInboxProps = {
    tenantId: TENANT_ID,
    initialItems: [],
    initialCursor: null,
    initialError: false,
    ...over,
  };
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <SupportInbox {...props} />
    </NextIntlClientProvider>
  );
}

const renderInbox = (over: Partial<SupportInboxProps> = {}) => render(ui(over));

/** What the list last handed to `useRealtimeTopic`. */
function realtime() {
  const call = mocks.realtime.mock.calls.at(-1) as unknown[];
  return {
    topic: call[0] as string,
    events: call[1] as string[],
    onSignal: call[2] as (event: string, payload: unknown) => void,
    options: call[3] as { onSubscribed?: () => void },
  };
}

beforeEach(() => {
  seq = 0;
  mocks.replace.mockReset();
  mocks.push.mockReset();
  mocks.loadMore.mockReset();
  mocks.realtime.mockReset();
  mocks.search.current = '';
  mocks.segment.current = null;
  fetchMock.mockReset();
  inboxAnswer = () => Response.json({ items: [], nextCursor: null });
  fetchMock.mockImplementation(async (url: string) => inboxAnswer(String(url)));
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

const hasClass = (element: Element | null | undefined, ...names: string[]) =>
  element !== null &&
  element !== undefined &&
  names.every((name) => element.classList.contains(name));
const text = (element: Element | null | undefined) => element?.textContent ?? '';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('12.4-14 tracer: the staff switches to Resolvidos and the rows show the case facts', () => {
  it('a tab change writes the URL, the URL drives the BFF refetch, and each row shows its facts', async () => {
    const initial = [view({}, { priority: null })];
    const { rerender } = renderInbox({ initialItems: initial });
    expect(inboxUrls()).toEqual([]);

    // The tab control: the click only WRITES the URL (router.replace, no scroll).
    fireEvent.click(screen.getByRole('tab', { name: 'Resolvidos' }));
    expect(mocks.replace).toHaveBeenCalledWith('/suporte?aba=resolvidos', { scroll: false });

    // The URL changes (Next re-renders with the new search params): page 1 is read for the new tab.
    const resolved = view(
      { name: 'Maria' },
      {
        number: 42,
        subjectLine: '#42 · Ingresso não chegou',
        state: { state: 'resolved', label: 'Resolvido', tone: 'success', glyph: 'CircleCheck' },
        priority: { priority: 'high', label: 'Alta', tone: 'danger', pill: true },
        meta: 'Pagamento · Com Carla',
      },
    );
    inboxAnswer = () => Response.json({ items: [resolved], nextCursor: null });
    mocks.search.current = 'aba=resolvidos';
    rerender(ui({ initialItems: initial }));

    await waitFor(() => expect(inboxUrls()).toEqual(['/api/chat/inbox?tab=resolved']));
    const link = await screen.findByRole('link', { name: /Maria/ });
    expect(link.querySelector('[data-inbox-subject]')?.textContent).toBe(
      '#42 · Ingresso não chegou',
    );
    expect(link.textContent).toContain('Resolvido');
    expect(link.textContent).toContain('Alta');
    expect(link.querySelector('[data-inbox-meta-text]')?.textContent).toBe('Pagamento · Com Carla');
    // Every row link keeps the current query string (the filters survive opening a case).
    expect(link.getAttribute('href')).toBe(`${resolved.href}?aba=resolvidos`);
  });
});

describe('the refetch carries the view in the API vocabulary (D-805, checker W12)', () => {
  it('a URL with every key reads page 1 with tab, owner and priority', async () => {
    mocks.search.current = 'aba=resolvidos&resp=eu&prio=alta&aguardando=1';
    renderInbox({ initialItems: [view()] });
    await waitFor(() =>
      expect(inboxUrls()).toEqual(['/api/chat/inbox?tab=resolved&owner=me&priority=high']),
    );
  });

  it('on the open tab the toggle adds awaiting=1', async () => {
    mocks.search.current = 'resp=eu&prio=alta&aguardando=1';
    renderInbox({ initialItems: [view()] });
    await waitFor(() =>
      expect(inboxUrls()).toEqual(['/api/chat/inbox?tab=open&owner=me&priority=high&awaiting=1']),
    );
  });

  it('the default URL reads nothing: the server already sent the default page 1', () => {
    renderInbox({ initialItems: [view()] });
    expect(inboxUrls()).toEqual([]);
  });

  it('an unknown value in the URL falls back to the default view and reads nothing (T-12.4-64)', () => {
    mocks.search.current = 'aba=tudo&resp=%27%3Bdrop&prio=urgente&aguardando=sim';
    renderInbox({ initialItems: [view()] });
    expect(inboxUrls()).toEqual([]);
  });

  it('load-more passes the cursor and the same filters in the API vocabulary', async () => {
    mocks.search.current = 'aba=resolvidos&resp=eu&prio=alta';
    const first = view();
    inboxAnswer = () => Response.json({ items: [first], nextCursor: 'cursor-2' });
    renderInbox({ initialItems: [view()], initialCursor: 'cursor-1' });
    await screen.findByRole('link', { name: /Membro 1/ });
    mocks.loadMore.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    fireEvent.click(await screen.findByTestId('load-more'));
    await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledTimes(1));
    expect(mocks.loadMore).toHaveBeenCalledWith('cursor-2', {
      tab: 'resolved',
      owner: 'me',
      priority: 'high',
    });
  });

  it('load-more on the default view sends the open tab and no other filter', async () => {
    renderInbox({ initialItems: [view()], initialCursor: 'cursor-1' });
    mocks.loadMore.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    fireEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledTimes(1));
    expect(mocks.loadMore).toHaveBeenCalledWith('cursor-1', { tab: 'open' });
  });

  it('with the toggle on (open tab) load-more says awaiting: true', async () => {
    mocks.search.current = 'aguardando=1';
    inboxAnswer = () => Response.json({ items: [view()], nextCursor: 'cursor-2' });
    renderInbox({ initialItems: [view()] });
    fireEvent.click(await screen.findByTestId('load-more'));
    await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledTimes(1));
    expect(mocks.loadMore).toHaveBeenCalledWith('cursor-2', { tab: 'open', awaiting: true });
  });
});

describe('the rows (UI-D-824; UC S06, S07)', () => {
  it('draws the priority pill for Alta and Baixa only, never for Normal', () => {
    renderInbox({
      initialItems: [
        view(
          { name: 'Ana' },
          { priority: { priority: 'high', label: 'Alta', tone: 'danger', pill: true } },
        ),
        view(
          { name: 'Bia' },
          { priority: { priority: 'low', label: 'Baixa', tone: 'neutral', pill: true } },
        ),
        view(
          { name: 'Caio' },
          { priority: { priority: 'normal', label: 'Normal', tone: 'neutral', pill: false } },
        ),
      ],
    });
    const textOf = (name: RegExp) => screen.getByRole('link', { name }).textContent ?? '';
    expect(textOf(/Ana/)).toContain('Alta');
    expect(textOf(/Bia/)).toContain('Baixa');
    expect(textOf(/Caio/)).not.toContain('Normal');
  });

  it('a row with no case facts (the previous API) draws as before, with no subject line', () => {
    renderInbox({ initialItems: [view({ name: 'Sem caso' }, null)] });
    const link = screen.getByRole('link', { name: /Sem caso/ });
    expect(link.querySelector('[data-inbox-subject]')).toBeNull();
    expect(link.querySelector('[data-inbox-meta]')).toBeNull();
  });

  it('the awaiting row keeps its screen-reader suffix and the open row is current', () => {
    const row = view({ name: 'Dani', awaiting: true });
    mocks.segment.current = row.conversationId;
    renderInbox({ initialItems: [row] });
    const link = screen.getByRole('link', { name: /Dani\s*, aguardando resposta/ });
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(link.querySelector('[data-inbox-dot]')).not.toBeNull();
  });

  it('a plain click on a row is a client navigation that keeps the query', () => {
    mocks.search.current = 'aba=fechados&resp=sem';
    inboxAnswer = () => Response.json({ items: [view({ name: 'Eli' })], nextCursor: null });
    renderInbox({ initialItems: [view()] });
    return screen.findByRole('link', { name: /Eli/ }).then((link) => {
      fireEvent.click(link);
      expect(mocks.push).toHaveBeenCalledWith(
        `${(link as HTMLAnchorElement).getAttribute('href')}`,
        {
          scroll: false,
        },
      );
      expect(link.getAttribute('href')).toMatch(/\?aba=fechados&resp=sem$/);
    });
  });
});

describe('live: the refetch is for the current tab and filters (UI-D-830, T-12.4-68)', () => {
  it('listens on the support-inbox topic for message, read and case signals', () => {
    renderInbox({ initialItems: [view()] });
    const { topic, events } = realtime();
    expect(topic).toBe(`tenant:${TENANT_ID}:support-inbox`);
    expect(events).toEqual(
      expect.arrayContaining([
        REALTIME_EVENTS.chatMessage,
        REALTIME_EVENTS.chatRead,
        REALTIME_EVENTS.chatCase,
      ]),
    );
  });

  it('a signal, a (re)subscribe and a refocus read page 1 with the current query and merge at the top', async () => {
    mocks.search.current = 'aba=resolvidos&resp=eu';
    const kept = view({ name: 'Antigo' });
    inboxAnswer = () => Response.json({ items: [kept], nextCursor: null });
    renderInbox({ initialItems: [view()] });
    await screen.findByRole('link', { name: /Antigo/ });
    fetchMock.mockClear();

    const fresh = view({ name: 'Novo' });
    inboxAnswer = () => Response.json({ items: [fresh], nextCursor: null });
    await act(async () => {
      realtime().onSignal(REALTIME_EVENTS.chatCase, { id: 'x' });
    });
    await screen.findByRole('link', { name: /Novo/ });
    expect(inboxUrls()).toEqual(['/api/chat/inbox?tab=resolved&owner=me']);
    const names = screen
      .getAllByRole('link')
      .map((a) => a.querySelector('[data-inbox-name]')?.textContent);
    expect(names).toEqual(['Novo', 'Antigo']);

    await act(async () => {
      realtime().options.onSubscribed?.();
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(inboxUrls().length).toBe(3));
    expect(new Set(inboxUrls())).toEqual(new Set(['/api/chat/inbox?tab=resolved&owner=me']));
  });

  it('coalesces: signals during a read produce exactly one more read', async () => {
    renderInbox({ initialItems: [view()] });
    const gates: Array<(response: Response) => void> = [];
    inboxAnswer = () => new Promise<Response>((resolve) => gates.push(resolve));
    await act(async () => {
      realtime().onSignal(REALTIME_EVENTS.chatMessage, {});
    });
    await waitFor(() => expect(inboxUrls().length).toBe(1));
    await act(async () => {
      realtime().onSignal(REALTIME_EVENTS.chatMessage, {});
      realtime().onSignal(REALTIME_EVENTS.chatRead, {});
      realtime().onSignal(REALTIME_EVENTS.chatCase, {});
    });
    expect(inboxUrls().length).toBe(1);
    gates[0]?.(Response.json({ items: [], nextCursor: null }));
    await waitFor(() => expect(inboxUrls().length).toBe(2));
    gates[1]?.(Response.json({ items: [], nextCursor: null }));
    await act(async () => {});
    expect(inboxUrls().length).toBe(2);
  });

  it('a read for a view the staff already left is discarded', async () => {
    const gates: Array<(response: Response) => void> = [];
    inboxAnswer = () => new Promise<Response>((resolve) => gates.push(resolve));
    const initial = [view({ name: 'Padrao' })];
    const { rerender } = renderInbox({ initialItems: initial });
    await act(async () => {
      realtime().onSignal(REALTIME_EVENTS.chatMessage, {});
    });
    await waitFor(() => expect(gates.length).toBe(1));
    mocks.search.current = 'aba=fechados';
    rerender(ui({ initialItems: initial }));
    await waitFor(() => expect(gates.length).toBe(2));
    // The stale read (default view) answers late: its rows must not reach the closed tab.
    gates[0]?.(Response.json({ items: [view({ name: 'Intruso' })], nextCursor: null }));
    gates[1]?.(Response.json({ items: [view({ name: 'Fechado 1' })], nextCursor: null }));
    await screen.findByRole('link', { name: /Fechado 1/ });
    expect(screen.queryByRole('link', { name: /Intruso/ })).toBeNull();
  });
});

describe('the five empty states, one per cause (UI-D-823, UI-D-832; UC S02)', () => {
  const empty = () => document.querySelector('[data-inbox-empty]');

  it('the default view says Nenhum chamado em aberto', () => {
    renderInbox();
    expect(text(empty())).toContain('Nenhum chamado em aberto');
    expect(text(empty())).toContain('Quando um membro pedir ajuda, o chamado aparece aqui.');
    expect(within(empty() as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('the toggle on says Ninguém aguardando resposta, and it wins over the open-tab sentence', async () => {
    mocks.search.current = 'aguardando=1';
    renderInbox();
    await waitFor(() => expect(text(empty())).toContain('Ninguém aguardando resposta'));
    expect(text(empty())).toContain('Todos os chamados em aberto já foram respondidos.');
    expect(text(empty())).not.toContain('Nenhum chamado em aberto');
  });

  it('Resolvidos and Fechados each have their own sentence', async () => {
    mocks.search.current = 'aba=resolvidos';
    const { rerender } = renderInbox();
    await waitFor(() => expect(text(empty())).toContain('Nenhum chamado resolvido'));
    expect(text(empty())).toContain(
      'Os chamados marcados como resolvidos aparecem aqui até serem fechados.',
    );
    mocks.search.current = 'aba=fechados';
    rerender(ui());
    await waitFor(() => expect(text(empty())).toContain('Nenhum chamado fechado'));
    expect(text(empty())).toContain('Os chamados fechados ficam guardados aqui.');
  });

  it('an owner or priority filter says Nenhum chamado com esses filtros with a Limpar filtros action', async () => {
    mocks.search.current = 'aba=resolvidos&resp=eu';
    renderInbox();
    await waitFor(() => expect(text(empty())).toContain('Nenhum chamado com esses filtros'));
    expect(text(empty())).toContain('Tente outro responsável ou outra prioridade.');
    fireEvent.click(within(empty() as HTMLElement).getByRole('button', { name: 'Limpar filtros' }));
    // The clear keeps the tab and drops owner, priority and toggle.
    expect(mocks.replace).toHaveBeenCalledWith('/suporte?aba=resolvidos', { scroll: false });
  });

  it('filters win over the toggle: a subset is never described as "everyone answered"', async () => {
    mocks.search.current = 'prio=alta&aguardando=1';
    renderInbox();
    await waitFor(() => expect(text(empty())).toContain('Nenhum chamado com esses filtros'));
    expect(text(empty())).not.toContain('Ninguém aguardando resposta');
  });

  it('the five titles are five distinct sentences', async () => {
    const titles = new Set<string>();
    for (const search of ['', 'aguardando=1', 'aba=resolvidos', 'aba=fechados', 'resp=eu']) {
      mocks.search.current = search;
      const view = renderInbox();
      await waitFor(() => expect(empty()).not.toBeNull());
      titles.add(empty()?.querySelector('h2, h3, p')?.textContent ?? '');
      view.unmount();
    }
    expect(titles.size).toBe(5);
  });
});

describe('loading and error (UI-D-832; UC S04, S05)', () => {
  it('first paint of a new view: six skeleton rows at the four-line geometry, and the controls stay', async () => {
    mocks.search.current = 'aba=fechados';
    const gate: Array<(response: Response) => void> = [];
    inboxAnswer = () => new Promise<Response>((resolve) => gate.push(resolve));
    renderInbox({ initialItems: [view({ name: 'Anterior' })] });
    await waitFor(() => expect(gate).toHaveLength(1));
    const rows = document.querySelectorAll('[data-inbox-skeleton-row]');
    expect(rows).toHaveLength(6);
    expect(hasClass(rows[0], 'items-start', 'min-h-18')).toBe(true);
    // A circle and four bars (name, subject, preview and the meta line) plus the time bar.
    expect(rows[0]?.querySelectorAll('[class*="rounded-full"]').length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.querySelectorAll('[class*="h-3"]').length).toBeGreaterThanOrEqual(4);
    // The rows of the view the staff left are not shown under the new tab.
    expect(screen.queryByRole('link', { name: /Anterior/ })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Fechados' })).toBeTruthy();
    gate[0]?.(Response.json({ items: [view({ name: 'Novo' })], nextCursor: null }));
    await screen.findByRole('link', { name: /Novo/ });
    expect(document.querySelectorAll('[data-inbox-skeleton-row]')).toHaveLength(0);
  });

  it('a plain refresh keeps the rows on screen while it reads', async () => {
    const gate: Array<(response: Response) => void> = [];
    inboxAnswer = () => new Promise<Response>((resolve) => gate.push(resolve));
    renderInbox({ initialItems: [view({ name: 'Fica' })] });
    await act(async () => {
      realtime().onSignal(REALTIME_EVENTS.chatMessage, {});
    });
    await waitFor(() => expect(gate).toHaveLength(1));
    expect(screen.getByRole('link', { name: /Fica/ })).toBeTruthy();
    expect(document.querySelectorAll('[data-inbox-skeleton-row]')).toHaveLength(0);
  });

  it('a failed first read of a view shows the shipped card with a retry that reads again', async () => {
    mocks.search.current = 'aba=resolvidos';
    inboxAnswer = () => new Response(null, { status: 500 });
    renderInbox({ initialItems: [view()] });
    const card = await waitFor(() => {
      const found = document.querySelector('[data-inbox-error]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    inboxAnswer = () => Response.json({ items: [view({ name: 'Voltou' })], nextCursor: null });
    fireEvent.click(within(card).getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByRole('link', { name: /Voltou/ });
    expect(document.querySelector('[data-inbox-error]')).toBeNull();
  });

  it('a failed page keeps its rows and shows the inline retry line', async () => {
    renderInbox({ initialItems: [view({ name: 'Mantida' })], initialCursor: 'cursor-1' });
    mocks.loadMore.mockResolvedValue({ ok: false });
    fireEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(document.querySelector('[data-inbox-page-error]')).not.toBeNull());
    expect(text(document.querySelector('[data-inbox-page-error]'))).toContain(
      'Não foi possível carregar mais chamados.',
    );
    expect(screen.getByRole('link', { name: /Mantida/ })).toBeTruthy();
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('the server could not read page 1: the card, not the empty sentence', () => {
    renderInbox({ initialError: true });
    expect(document.querySelector('[data-inbox-error]')).not.toBeNull();
    expect(document.querySelector('[data-inbox-empty]')).toBeNull();
  });
});
