// @vitest-environment happy-dom

import { join } from 'node:path';
import { REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import {
  type InboxCaseView,
  type InboxRowView,
  inboxRowView,
  tenantDayKeys,
} from '@/lib/chat-view';
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
    // The order key: descends with the creation index, so a list built in creation order is in server order.
    lastMessageAt: new Date(Date.UTC(2026, 8, 30, 17, 0, 0) - seq * 60_000)
      .toISOString()
      .replace('.000Z', '.000000Z'),
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
const rowNames = () =>
  Array.from(document.querySelectorAll('[data-inbox-list] a')).map(
    (a) => a.querySelector('[data-inbox-name]')?.textContent,
  );

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

  it('a signal, a (re)subscribe and a refocus read page 1 with the current query and replace the window it covers', async () => {
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
    // WR-01: 'Antigo' is not in the fresh page, so it left the tab; it is not kept under 'Novo'.
    expect(rowNames()).toEqual(['Novo']);

    await act(async () => {
      realtime().options.onSubscribed?.();
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(inboxUrls().length).toBe(3));
    expect(new Set(inboxUrls())).toEqual(new Set(['/api/chat/inbox?tab=resolved&owner=me']));
  });

  it('a row still in the fresh page is merged at the top by case id, once', async () => {
    mocks.search.current = 'aba=resolvidos&resp=eu';
    const kept = view({ name: 'Antigo' });
    inboxAnswer = () => Response.json({ items: [kept], nextCursor: null });
    renderInbox({ initialItems: [view()] });
    await screen.findByRole('link', { name: /Antigo/ });

    const fresh = view({ name: 'Novo' });
    inboxAnswer = () => Response.json({ items: [fresh, kept], nextCursor: null });
    await act(async () => {
      realtime().onSignal(REALTIME_EVENTS.chatCase, { id: 'x' });
    });
    await screen.findByRole('link', { name: /Novo/ });
    expect(rowNames()).toEqual(['Novo', 'Antigo']);
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

describe('WR-01 / T7: a row that left the tab leaves on the next refetch (UI-D-830, A-UI-12)', () => {
  const links = (name: string) =>
    screen.queryAllByRole('link').filter((a) => a.textContent?.includes(name));
  const signal = () =>
    act(async () => {
      realtime().onSignal(REALTIME_EVENTS.chatCase, { id: 'whatever' });
    });

  it('tracer: case #42 resolved by a colleague leaves "Em aberto" on the next refetch, the others stay', async () => {
    const a = view({ name: 'Alice' });
    const b = view({ name: 'Bruno' }, { number: 42 });
    const c = view({ name: 'Carla' });
    renderInbox({ initialItems: [a, b, c] });
    expect(rowNames()).toEqual(['Alice', 'Bruno', 'Carla']);

    inboxAnswer = () =>
      Response.json({ items: [{ ...a, preview: 'preview novo' }, c], nextCursor: null });
    await signal();
    await waitFor(() => expect(links('Bruno')).toHaveLength(0));
    expect(links('Alice')).toHaveLength(1);
    expect(links('Alice')[0]?.textContent).toContain('preview novo');
    expect(rowNames()).toEqual(['Alice', 'Carla']);
  });

  it("only page 1 loaded with a cursor: the list is the fresh page and the cursor is the answer's", async () => {
    const a = view({ name: 'Alice' });
    const b = view({ name: 'Bruno' });
    const c = view({ name: 'Carla' });
    renderInbox({ initialItems: [a, b, c], initialCursor: 'c0' });
    inboxAnswer = () => Response.json({ items: [a, c], nextCursor: 'c1' });
    await signal();
    await waitFor(() => expect(rowNames()).toEqual(['Alice', 'Carla']));
    mocks.loadMore.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    fireEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(mocks.loadMore).toHaveBeenCalled());
    expect(mocks.loadMore.mock.calls[0]?.[0]).toBe('c1');
  });

  it('several pages loaded: the fresh window replaces what it covers, deeper rows stay, the cursor stays', async () => {
    const [r1, r2, r3] = [view({ name: 'R1' }), view({ name: 'R2' }), view({ name: 'R3' })];
    const [r4, r5, r6] = [view({ name: 'R4' }), view({ name: 'R5' }), view({ name: 'R6' })];
    renderInbox({ initialItems: [r1, r2, r3], initialCursor: 'c1' });
    mocks.loadMore.mockResolvedValueOnce({ ok: true, items: [r4, r5, r6], nextCursor: 'c2' });
    fireEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(rowNames()).toHaveLength(6));

    const newer = '2026-09-30T18:00:00.000000Z';
    inboxAnswer = () =>
      Response.json({
        items: [{ ...r2, lastMessageAt: newer, preview: 'r2 novo' }, r1, r4],
        nextCursor: 'cX',
      });
    await signal();
    await waitFor(() => expect(rowNames()).toEqual(['R2', 'R1', 'R4', 'R5', 'R6']));
    expect(links('R2')).toHaveLength(1);
    expect(links('R2')[0]?.textContent).toContain('r2 novo');

    mocks.loadMore.mockResolvedValueOnce({ ok: true, items: [], nextCursor: null });
    fireEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledTimes(2));
    expect(mocks.loadMore.mock.calls[1]?.[0]).toBe('c2');
  });

  it('an answer that ends the view after a failed page: the list is the answer, no load-more, no page error', async () => {
    const r1 = view({ name: 'R1' });
    const r2 = view({ name: 'R2' });
    renderInbox({ initialItems: [r1, r2], initialCursor: 'c1' });
    mocks.loadMore.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(document.querySelector('[data-inbox-page-error]')).not.toBeNull());

    inboxAnswer = () => Response.json({ items: [r1], nextCursor: null });
    await signal();
    await waitFor(() => expect(rowNames()).toEqual(['R1']));
    expect(document.querySelector('[data-inbox-page-error]')).toBeNull();
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('an empty answer empties the list and the view shows its own empty sentence', async () => {
    renderInbox({ initialItems: [view({ name: 'Alice' })] });
    inboxAnswer = () => Response.json({ items: [], nextCursor: null });
    await signal();
    await waitFor(() => expect(document.querySelector('[data-inbox-empty]')).not.toBeNull());
    expect(rowNames()).toEqual([]);
    expect(text(document.querySelector('[data-inbox-empty]'))).toContain(
      'Nenhum chamado em aberto',
    );
  });

  it('a FAILED read keeps every row on screen', async () => {
    renderInbox({ initialItems: [view({ name: 'Alice' }), view({ name: 'Bruno' })] });
    inboxAnswer = () => new Response('boom', { status: 500 });
    await signal();
    await waitFor(() => expect(inboxUrls().length).toBe(1));
    await act(async () => {});
    expect(rowNames()).toEqual(['Alice', 'Bruno']);
  });

  it('the payload is never read: any payload refetches', async () => {
    renderInbox({ initialItems: [view({ name: 'Alice' })] });
    for (const payload of [null, undefined, 'texto', { id: 1 }, { conversationId: 'outro' }]) {
      fetchMock.mockClear();
      await act(async () => {
        realtime().onSignal(REALTIME_EVENTS.chatMessage, payload);
      });
      await waitFor(() => expect(inboxUrls().length).toBe(1));
    }
  });

  describe('WR-06: a page-1 refetch that lands while a load-more is in flight drops no row', () => {
    it('a refetch during a load-more keeps the row between the fresh tail and the old cursor (WR-06)', async () => {
      const [r1, r2, r3] = [view({ name: 'R1' }), view({ name: 'R2' }), view({ name: 'R3' })];
      const [r4, r5] = [view({ name: 'R4' }), view({ name: 'R5' })];
      const fresh = view({ name: 'NEW', lastMessageAt: '2026-09-30T18:00:00.000000Z' });
      renderInbox({ initialItems: [r1, r2, r3], initialCursor: 'c1' });

      // The load-more for 'c1' is held open: its page is not appended yet.
      const gates: Array<(answer: unknown) => void> = [];
      mocks.loadMore.mockImplementationOnce(() => new Promise((resolve) => gates.push(resolve)));
      fireEvent.click(screen.getByTestId('load-more'));
      await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledTimes(1));
      expect(mocks.loadMore.mock.calls[0]?.[0]).toBe('c1');

      // A fresh page 1 lands in the meantime: [NEW, R1, R2], and R3 sits between its tail and the old cursor.
      inboxAnswer = () => Response.json({ items: [fresh, r1, r2], nextCursor: 'cX' });
      await signal();
      await waitFor(() => expect(rowNames()).toContain('NEW'));

      await act(async () => {
        gates[0]?.({ ok: true, items: [r4, r5], nextCursor: 'c2' });
      });
      await waitFor(() => expect(rowNames()).toContain('R4'));
      // The discriminating assertion: R3 is in neither the fresh page nor the late page, yet the server lists it.
      expect(rowNames()).toEqual(['NEW', 'R1', 'R2', 'R3', 'R4', 'R5']);

      // A pin that also holds before the fix: the late page always sets its own cursor.
      mocks.loadMore.mockResolvedValueOnce({ ok: true, items: [], nextCursor: null });
      fireEvent.click(screen.getByTestId('load-more'));
      await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledTimes(2));
      expect(mocks.loadMore.mock.calls[1]?.[0]).toBe('c2');
    });

    // After a successful append `pagesRef` is 2, so this is a regression pin for the WR-01 behaviour, NOT the
    // proof that the in-flight mark is cleared (the refused and rejected cases below are).
    it('a second refetch after the late page still drops a row that left its window and leaves the cursor (WR-01 still holds)', async () => {
      const [r1, r2, r3] = [view({ name: 'R1' }), view({ name: 'R2' }), view({ name: 'R3' })];
      const [r4, r5] = [view({ name: 'R4' }), view({ name: 'R5' })];
      const fresh = view({ name: 'NEW', lastMessageAt: '2026-09-30T18:00:00.000000Z' });
      renderInbox({ initialItems: [r1, r2, r3], initialCursor: 'c1' });

      const gates: Array<(answer: unknown) => void> = [];
      mocks.loadMore.mockImplementationOnce(() => new Promise((resolve) => gates.push(resolve)));
      fireEvent.click(screen.getByTestId('load-more'));
      await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledTimes(1));

      inboxAnswer = () => Response.json({ items: [fresh, r1, r2], nextCursor: 'cX' });
      await signal();
      await waitFor(() => expect(rowNames()).toContain('NEW'));
      await act(async () => {
        gates[0]?.({ ok: true, items: [r4, r5], nextCursor: 'c2' });
      });
      await waitFor(() => expect(rowNames()).toContain('R4'));

      // R2 left its window; the deeper R4 and R5 stay and the cursor is left alone.
      inboxAnswer = () => Response.json({ items: [fresh, r1, r3], nextCursor: 'cY' });
      await signal();
      await waitFor(() => expect(rowNames()).toEqual(['NEW', 'R1', 'R3', 'R4', 'R5']));

      mocks.loadMore.mockResolvedValueOnce({ ok: true, items: [], nextCursor: null });
      fireEvent.click(screen.getByTestId('load-more'));
      await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledTimes(2));
      expect(mocks.loadMore.mock.calls[1]?.[0]).toBe('c2');
    });

    // The real proof that the mark is cleared: on these exits `pagesRef` stays at 1, so only a stuck mark
    // could keep the next refetch from being the whole view.
    it.each([
      ['a refused page', () => Promise.resolve({ ok: false })],
      ['a rejected call', () => Promise.reject(new Error('boom'))],
    ])(
      '%s clears the in-flight mark: the next refetch is the whole view again (WR-06)',
      async (_name, answer) => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const [r1, r2, r3] = [view({ name: 'R1' }), view({ name: 'R2' }), view({ name: 'R3' })];
          renderInbox({ initialItems: [r1, r2, r3], initialCursor: 'c1' });
          mocks.loadMore.mockImplementationOnce(answer);
          fireEvent.click(screen.getByTestId('load-more'));
          await waitFor(() =>
            expect(document.querySelector('[data-inbox-page-error]')).not.toBeNull(),
          );

          inboxAnswer = () => Response.json({ items: [r1, r2], nextCursor: 'c9' });
          await signal();
          // With the mark stuck true, R3 would be kept as a "deeper" row.
          await waitFor(() => expect(rowNames()).toEqual(['R1', 'R2']));

          // The page-error line stays (a whole answer with a cursor does not clear it) and the sentinel is
          // disabled until it is dismissed.
          const line = document.querySelector('[data-inbox-page-error]') as HTMLElement;
          fireEvent.click(within(line).getByRole('button', { name: 'Tentar novamente' }));
          mocks.loadMore.mockResolvedValueOnce({ ok: true, items: [], nextCursor: null });
          fireEvent.click(await screen.findByTestId('load-more'));
          await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledTimes(2));
          expect(mocks.loadMore.mock.calls[1]?.[0]).toBe('c9');
        } finally {
          spy.mockRestore();
        }
      },
    );
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

describe('12.5-16 voice previews on the staff inbox row (D-860, D-868, UI-D-853, UI-D-858, UI-D-857)', () => {
  const t = createTranslator({
    locale: 'pt-BR',
    messages,
    namespace: 'chat',
  }) as unknown as Parameters<typeof inboxRowView>[1]['t'];
  const keys = tenantDayKeys(Date.parse('2026-10-01T01:30:00Z'), 'America/Sao_Paulo');
  const AVATAR_ASSET = '3a000000-0000-4000-8000-000000000001';

  /** A row from the real view function with the real catalog, so the words under test are the catalog's. */
  function fromApi(lastMessage: Record<string, unknown>, name: string): InboxRowView {
    seq += 1;
    const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
    return inboxRowView(
      {
        conversationId: id,
        member: {
          membershipId: '2a000000-0000-4000-8000-000000000001',
          displayName: name,
          avatarAssetId: AVATAR_ASSET,
          state: 'active',
        },
        lastMessage: { seq: 4, preview: '', authorFirstName: null, side: 'member', ...lastMessage },
        lastMessageAt: '2026-09-30T17:02:00.000000Z',
        awaiting: false,
      } as Parameters<typeof inboxRowView>[0],
      { timeZone: 'America/Sao_Paulo', keys, t },
    );
  }

  const previewOf = (name: RegExp) =>
    screen.getByRole('link', { name }).querySelector('[data-inbox-preview]') as HTMLElement;

  it('tracer: a team recording shows the microphone glyph and "Ana: Mensagem de voz · 0:42" on one truncated line', () => {
    renderInbox({
      initialItems: [
        fromApi({ side: 'staff', authorFirstName: 'Ana', voiceSeconds: 42 }, 'Membro Voz'),
      ],
    });
    const preview = previewOf(/Membro Voz/);
    const glyph = preview.querySelector('svg');
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(glyph?.classList.contains('shrink-0')).toBe(true);
    expect(text(preview)).toBe('Ana: Mensagem de voz · 0:42');
    expect(
      hasClass(preview.querySelector('[data-inbox-preview-text]'), 'truncate', 'min-w-0'),
    ).toBe(true);
  });

  it("a member's recording reads 'Mensagem de voz · 0:42' with the glyph", () => {
    renderInbox({ initialItems: [fromApi({ voiceSeconds: 42 }, 'Membro Voz')] });
    const preview = previewOf(/Membro Voz/);
    expect(preview.querySelector('svg')).not.toBeNull();
    expect(text(preview)).toBe('Mensagem de voz · 0:42');
  });

  it('an awaiting voice row keeps text-text on the preview; otherwise the secondary ink', () => {
    renderInbox({
      initialItems: [
        { ...fromApi({ voiceSeconds: 42 }, 'Aguarda Voz'), awaiting: true },
        fromApi({ voiceSeconds: 42 }, 'Respondido Voz'),
      ],
    });
    expect(hasClass(previewOf(/Aguarda Voz/), 'text-text')).toBe(true);
    expect(hasClass(previewOf(/Respondido Voz/), 'text-text-secondary')).toBe(true);
  });

  it('a text row has no glyph and the shipped markup', () => {
    renderInbox({ initialItems: [fromApi({ preview: 'Oi, tudo bem?' }, 'Membro Texto')] });
    const preview = previewOf(/Membro Texto/);
    expect(preview.querySelector('svg')).toBeNull();
    expect(preview.querySelector('[data-inbox-preview-text]')).toBeNull();
    expect(hasClass(preview, 'truncate')).toBe(true);
    expect(text(preview)).toBe('Oi, tudo bem?');
  });

  it('a deleted recording reads "Mensagem de voz apagada" with no glyph and no duration, prefixes kept', () => {
    renderInbox({
      initialItems: [
        fromApi({ voiceSeconds: 42, voiceDeleted: true }, 'Membro Gone'),
        fromApi(
          { side: 'staff', authorFirstName: 'Ana', voiceSeconds: 42, voiceDeleted: true },
          'Equipe Gone',
        ),
      ],
    });
    const member = previewOf(/Membro Gone/);
    expect(member.querySelector('svg')).toBeNull();
    expect(text(member)).toBe('Mensagem de voz apagada');
    const team = previewOf(/Equipe Gone/);
    expect(team.querySelector('svg')).toBeNull();
    expect(text(team)).toBe('Ana: Mensagem de voz apagada');
  });

  it('UI-D-857: the row shows no media id, URL, file name or size beside a recording', () => {
    renderInbox({
      initialItems: [
        fromApi(
          {
            voiceSeconds: 42,
            mediaId: '7b000000-0000-4000-8000-000000000009',
            url: 'https://x/a.webm',
          },
          'Membro Voz',
        ),
      ],
    });
    const link = screen.getByRole('link', { name: /Membro Voz/ });
    expect(link.textContent).not.toMatch(/7b000000|https?:|\.webm|\bKB\b|\bMB\b/);
  });

  it('a case opened by voice reads "#42 · Mensagem de voz" on the row, with no duration', () => {
    renderInbox({
      initialItems: [
        view(
          { name: 'Caso Voz', preview: 'Mensagem de voz · 0:42', previewKind: 'voice' },
          {
            number: 42,
            subjectLine: '#42 · Mensagem de voz',
          },
        ),
      ],
    });
    const link = screen.getByRole('link', { name: /Caso Voz/ });
    expect(text(link.querySelector('[data-inbox-subject]'))).toBe('#42 · Mensagem de voz');
  });
});
