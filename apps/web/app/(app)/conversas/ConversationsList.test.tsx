// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRowView, ConversationsPageView, SupportRowView } from '@/lib/chat-view';

/**
 * 11-19 Task 1 (CHAT-06, D-719, D-721, UI-D-862, UI-D-866, UI-D-879): the Conversas list draws what the API
 * returned, already finished by the view functions of plan 18: the support row pinned first with its dot, then the
 * direct rows in the given order, each ONE link named by its finished label, with the unread count `Badge`
 * (`99+` above 99), the `Mic` glyph for a voice preview and the neutral "Membro removido". The catalog is the REAL
 * pt-BR one through next-intl's own translator; `InfiniteScroll` and `PullToRefresh` are swapped for buttons
 * (happy-dom has no scroll sentinel and no touch pull).
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

const mocks = vi.hoisted(() => ({ push: vi.fn(), realtime: vi.fn() }));

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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn() }),
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

const { ConversationsList } = await import('./ConversationsList');

const support = (over: Partial<SupportRowView> = {}): SupportRowView => ({
  name: 'Equipe Rede Lab',
  href: '/suporte',
  preview: 'Equipe: Seu ingresso já está liberado.',
  previewKind: 'text',
  idle: false,
  unread: true,
  label: 'Equipe Rede Lab. Equipe: Seu ingresso já está liberado., mensagem nova',
  ...over,
});

let seq = 0;
const row = (over: Partial<ConversationRowView> = {}): ConversationRowView => {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const name = over.name ?? `Membro ${seq}`;
  return {
    conversationId: id,
    href: `/conversas/${id}`,
    name,
    removed: false,
    avatar: null,
    profileHref: `/membros/${id}`,
    preview: `prévia ${seq}`,
    previewKind: 'text',
    time: '14:12',
    lastMessageAt: `2026-11-19T14:${String(59 - seq).padStart(2, '0')}:00.000000Z`,
    unread: null,
    label: `${name}. prévia ${seq}`,
    ...over,
  };
};

const page = (rows: ConversationRowView[], over: Partial<ConversationsPageView> = {}) =>
  ({ support: support(), rows, nextCursor: null, ...over }) satisfies ConversationsPageView;

const TENANT_ID = '99999999-9999-4999-8999-999999999999';
const USER_ID = '88888888-8888-4888-8888-888888888888';

const ui = (initial: ConversationsPageView | null): ReactNode => (
  <ConversationsList
    initial={initial}
    tenantId={TENANT_ID}
    userId={USER_ID}
    tenantName="Rede Lab"
    logoUrl={null}
  />
);
const renderList = (initial: ConversationsPageView | null) => render(ui(initial));

const has = (element: Element | null | undefined, ...names: string[]) =>
  element !== null &&
  element !== undefined &&
  names.every((name) => element.classList.contains(name));
const links = () =>
  within(screen.getByRole('list', { name: 'Suas conversas' })).getAllByRole('link');

const fetchMock = vi.fn();
/** What the BFF `GET /api/chat/direct` answers next, by URL. */
let directAnswer: (url: string) => Promise<Response> | Response = () =>
  Response.json({ rows: [], nextCursor: null });

const directUrls = () =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/api/chat/direct'));

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
  mocks.push.mockReset();
  mocks.realtime.mockReset();
  fetchMock.mockReset();
  directAnswer = () => Response.json({ rows: [], nextCursor: null });
  fetchMock.mockImplementation(async (url: string) => directAnswer(String(url)));
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConversationsList (UI-D-862, UI-D-879)', () => {
  it('is a list named "Suas conversas" with the support row first and the rows in the given order', () => {
    const carla = row({ name: 'Carla Nunes', unread: { count: 2, text: '2' } });
    const rafael = row({ name: 'Rafael Lima' });
    renderList(page([carla, rafael]));
    const all = links();
    expect(all).toHaveLength(3);
    expect(all[0]?.getAttribute('href')).toBe('/suporte');
    expect(all[1]?.getAttribute('href')).toBe(carla.href);
    expect(all[2]?.getAttribute('href')).toBe(rafael.href);
    expect(all.map((a) => a.querySelector('[data-inbox-name]')?.textContent)).toEqual([
      'Equipe Rede Lab',
      'Carla Nunes',
      'Rafael Lima',
    ]);
  });

  it('every row is ONE link whose accessible name is the finished label (the count clause only when unread)', () => {
    const unread = row({
      name: 'Larissa Souza',
      unread: { count: 7, text: '7' },
      label: 'Larissa Souza, 7 mensagens novas. prévia 1',
    });
    const read = row({ name: 'Bruno', label: 'Bruno. prévia 2' });
    renderList(page([unread, read]));
    expect(
      screen.getByRole('link', { name: 'Larissa Souza, 7 mensagens novas. prévia 1' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bruno. prévia 2' })).toBeTruthy();
    expect(
      screen.getByRole('link', {
        name: 'Equipe Rede Lab. Equipe: Seu ingresso já está liberado., mensagem nova',
      }),
    ).toBeTruthy();
  });

  it('the support row shows the dot (a flag, never a number) and opens /suporte', () => {
    renderList(page([row()]));
    const first = links()[0] as HTMLElement;
    expect(first.querySelector('[data-badge-dot]')).not.toBeNull();
    expect(first.getAttribute('href')).toBe('/suporte');
  });

  it('a read support row draws no dot, and an idle one reads in the tertiary tone', () => {
    renderList(
      page([], {
        support: support({
          unread: false,
          idle: true,
          preview: 'Fale com a equipe de Rede Lab',
          label: 'Equipe Rede Lab. Fale com a equipe de Rede Lab',
        }),
      }),
    );
    const first = links()[0] as HTMLElement;
    expect(first.querySelector('[data-badge-dot]')).toBeNull();
    expect(has(first.querySelector('[data-inbox-preview]'), 'text-text-tertiary')).toBe(true);
  });

  it('draws the count Badge, capped at 99+, and nothing when read', () => {
    renderList(
      page([
        row({ name: 'Cap', unread: { count: 100, text: '99+' } }),
        row({ name: 'Few', unread: { count: 3, text: '3' } }),
        row({ name: 'Read' }),
      ]),
    );
    const byName = (name: string) =>
      links().find(
        (a) => a.querySelector('[data-inbox-name]')?.textContent === name,
      ) as HTMLElement;
    const trailing = (name: string) =>
      byName(name).querySelector('[data-inbox-time]')?.parentElement;
    expect(trailing('Cap')?.textContent).toContain('99+');
    expect(trailing('Few')?.textContent).toContain('3');
    expect(trailing('Read')?.textContent).toBe('14:12');
    expect(byName('Cap').querySelector('[data-inbox-dot]')).toBeNull();
    expect(has(byName('Cap').querySelector('[data-inbox-preview]'), 'text-text')).toBe(true);
    expect(has(byName('Read').querySelector('[data-inbox-preview]'), 'text-text-secondary')).toBe(
      true,
    );
  });

  it('a voice preview carries the Mic glyph before the text and a text preview carries none', () => {
    renderList(
      page([
        row({ name: 'Voz', previewKind: 'voice', preview: 'Mensagem de voz · 0:42' }),
        row({ name: 'Texto' }),
      ]),
    );
    const voz = links().find((a) => a.textContent?.includes('Mensagem de voz')) as HTMLElement;
    expect(voz.querySelector('[data-inbox-preview] svg[aria-hidden]')).not.toBeNull();
    const texto = links().find(
      (a) => a.querySelector('[data-inbox-name]')?.textContent === 'Texto',
    );
    expect(texto?.querySelector('[data-inbox-preview] svg')).toBeNull();
  });

  it('a removed member reads Membro removido, with the neutral avatar, and stays', () => {
    renderList(
      page([row({ name: 'Membro removido', removed: true, avatar: null, profileHref: null })]),
    );
    const removed = links()[1] as HTMLElement;
    const name = removed.querySelector('[data-inbox-name]');
    expect(name?.textContent).toBe('Membro removido');
    expect(has(name, 'text-text-tertiary')).toBe(true);
    expect(removed.querySelector('svg')).not.toBeNull();
  });

  it('long names and previews are one truncated line each, in a min-w-0 column', () => {
    renderList(page([row({ name: 'N'.repeat(90), preview: 'P'.repeat(300) })]));
    const target = links()[1] as HTMLElement;
    expect(has(target.querySelector('[data-inbox-name]'), 'truncate')).toBe(true);
    expect(has(target.querySelector('[data-inbox-preview]'), 'truncate')).toBe(true);
    expect(has(target, 'min-h-18')).toBe(true);
  });

  it('member strings are text nodes: markup in a name or preview never becomes an element', () => {
    renderList(page([row({ name: '<img src=x onerror=alert(1)>', preview: '<b>oi</b>' })]));
    expect(document.querySelector('img[src="x"], b')).toBeNull();
    expect(links()[1]?.querySelector('[data-inbox-name]')?.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('a plain left click is a client navigation (router.push); a modified click keeps the browser', () => {
    const target = row({ name: 'Carla' });
    renderList(page([target]));
    const link = links()[1] as HTMLElement;
    fireEvent.click(link);
    expect(mocks.push).toHaveBeenCalledWith(target.href);
    mocks.push.mockReset();
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('the column is the 680px single column on every breakpoint', () => {
    renderList(page([row()]));
    const column = screen
      .getByRole('list', { name: 'Suas conversas' })
      .closest('[data-conversations]');
    expect(has(column, 'mx-auto', 'w-full', 'max-w-[680px]')).toBe(true);
  });
});

/**
 * 11-19 Task 2 (CHAT-06, UI-D-863; UC E1 empty, loading, error, populated, overflow): the states and the live
 * refresh. The blank state keeps the support row and draws the card under it; a failed first read draws the card
 * and NO support row; a failed later page keeps the rows with the inline retry line; a fresh page 1 merges by
 * conversation id at the top without moving the scroll or the focus.
 */
describe('ConversationsList states (UI-D-863)', () => {
  it('blank: the support row stays and the card sits under it with Encontrar pessoas to /membros', () => {
    renderList(
      page([], {
        support: support({
          unread: false,
          idle: true,
          preview: 'Fale com a equipe de Rede Lab',
          label: 'Equipe Rede Lab. Fale com a equipe de Rede Lab',
        }),
      }),
    );
    expect(links()).toHaveLength(1);
    expect(links()[0]?.getAttribute('href')).toBe('/suporte');
    expect(screen.getByText('Você ainda não conversou com outros membros')).toBeTruthy();
    expect(screen.getByText('Abra o perfil de um membro e toque em Enviar mensagem.')).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Encontrar pessoas' });
    expect(cta.getAttribute('href')).toBe('/membros');
    // No "Nova conversa" button and no member search exist (D-720, deferred).
    expect(screen.queryByText(/nova conversa/i)).toBeNull();
    expect(document.querySelector('input')).toBeNull();
  });

  it('a populated list draws no blank card', () => {
    renderList(page([row()]));
    expect(screen.queryByText('Você ainda não conversou com outros membros')).toBeNull();
  });

  it('first read failed: the error card with Tentar novamente and NO support row', () => {
    renderList(null);
    expect(screen.getByText('Não foi possível carregar suas conversas.')).toBeTruthy();
    expect(screen.getByText('Verifique sua conexão e tente de novo.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Suas conversas' })).toBeNull();
    expect(document.querySelector('[data-support-avatar]')).toBeNull();
  });

  it('Tentar novamente shows the skeleton (aria-busy), then draws the list when the read lands', async () => {
    const target = row({ name: 'Carla' });
    let release: (response: Response) => void = () => undefined;
    directAnswer = () => new Promise<Response>((resolve) => (release = resolve));
    renderList(null);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(document.querySelector('[aria-busy]')).not.toBeNull());
    expect(directUrls()).toEqual(['/api/chat/direct']);
    await act(async () => {
      release(Response.json(page([target])));
    });
    await waitFor(() => expect(links()).toHaveLength(2));
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('Tentar novamente that fails again goes back to the card', async () => {
    directAnswer = () => new Response(null, { status: 502 });
    renderList(null);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar suas conversas.')).toBeTruthy(),
    );
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('paging: the next page is APPENDED by cursor, a row already on screen is not repeated, the support row is not drawn twice', async () => {
    const first = row({ name: 'Primeira' });
    const second = row({ name: 'Segunda' });
    directAnswer = () => Response.json({ rows: [first, second], nextCursor: null });
    renderList(page([first], { nextCursor: 'cursor-1' }));
    fireEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(links()).toHaveLength(3));
    expect(directUrls()).toEqual(['/api/chat/direct?cursor=cursor-1']);
    expect(links().map((a) => a.getAttribute('href'))).toEqual([
      '/suporte',
      first.href,
      second.href,
    ]);
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('a failed later page keeps the rows and shows the inline retry line; Tentar novamente re-arms the sentinel', async () => {
    const first = row({ name: 'Primeira' });
    directAnswer = () => new Response(null, { status: 502 });
    renderList(page([first], { nextCursor: 'cursor-1' }));
    fireEvent.click(screen.getByTestId('load-more'));
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar mais conversas.')).toBeTruthy(),
    );
    expect(links()).toHaveLength(2);
    expect(screen.queryByTestId('load-more')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(screen.queryByText('Não foi possível carregar mais conversas.')).toBeNull();
    expect(screen.getByTestId('load-more')).toBeTruthy();
  });

  it('pull to refresh asks page 1 and replaces the window', async () => {
    const old = row({ name: 'Antiga' });
    const fresh = row({ name: 'Nova', unread: { count: 4, text: '4' } });
    directAnswer = () => Response.json(page([fresh]));
    renderList(page([old]));
    fireEvent.click(screen.getByTestId('pull'));
    await waitFor(() =>
      expect(links().map((a) => a.querySelector('[data-inbox-name]')?.textContent)).toEqual([
        'Equipe Rede Lab',
        'Nova',
      ]),
    );
  });
});

describe('ConversationsList live refresh (UI-D-863, D-240)', () => {
  it('listens to chat.unread on the member own user topic and refetches page 1 on the signal and on (re)subscribe', async () => {
    renderList(page([row()]));
    const live = realtime();
    expect(live.topic).toBe(`tenant:${TENANT_ID}:user:${USER_ID}`);
    expect(live.events).toContain('chat.unread');
    await act(async () => live.onSignal('chat.unread', { conversationId: 'x' }));
    await waitFor(() => expect(directUrls()).toEqual(['/api/chat/direct']));
    await act(async () => live.options.onSubscribed?.());
    await waitFor(() => expect(directUrls()).toHaveLength(2));
  });

  it('refetches on refocus (visibilitychange to visible) and never while hidden', async () => {
    renderList(page([row()]));
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(directUrls()).toHaveLength(1));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(directUrls()).toHaveLength(1);
  });

  it('refetches are coalesced: one in flight and at most one more queued', async () => {
    let release: (response: Response) => void = () => undefined;
    directAnswer = () => new Promise<Response>((resolve) => (release = resolve));
    renderList(page([row()]));
    const live = realtime();
    await act(async () => {
      live.onSignal('chat.unread', {});
      live.onSignal('chat.unread', {});
      live.onSignal('chat.unread', {});
    });
    expect(directUrls()).toHaveLength(1);
    directAnswer = () => Response.json(page([row()]));
    await act(async () => release(Response.json(page([row()]))));
    await waitFor(() => expect(directUrls()).toHaveLength(2));
  });

  it('the merge puts a moved conversation at the top by id, instantly, and keeps the scroll offset and the focused row', async () => {
    const a = row({ name: 'Ana' });
    const b = row({ name: 'Beto' });
    const c = row({ name: 'Caio' });
    // Caio gets news: he moves to the top, with the count; the others keep their order.
    const caioNow = {
      ...c,
      unread: { count: 3, text: '3' },
      lastMessageAt: '2026-11-19T15:30:00.000000Z',
      label: 'Caio, 3 mensagens novas. prévia',
    };
    directAnswer = () => Response.json(page([caioNow, a, b]));
    renderList(page([a, b, c]));

    document.documentElement.scrollTop = 120;
    const anaLink = links().find((l) => l.getAttribute('href') === a.href) as HTMLElement;
    anaLink.focus();
    expect(document.activeElement).toBe(anaLink);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    await act(async () => realtime().onSignal('chat.unread', {}));
    await waitFor(() =>
      expect(links().map((l) => l.querySelector('[data-inbox-name]')?.textContent)).toEqual([
        'Equipe Rede Lab',
        'Caio',
        'Ana',
        'Beto',
      ]),
    );
    // Nothing scrolled, and the focus is still on Ana's row (the same link, wherever it sits now).
    expect(document.documentElement.scrollTop).toBe(120);
    expect(scrollTo).not.toHaveBeenCalled();
    expect((document.activeElement as HTMLElement | null)?.getAttribute('href')).toBe(a.href);
    // The moved row is a normal row: no animation class anywhere in the list.
    expect(
      document.querySelector(
        '[data-conversations] [class*="animate-"], [data-conversations] [class*="transition-transform"]',
      ),
    ).toBeNull();
  });

  it('the focus stays on the focused row when a reorder moves it', async () => {
    const a = row({ name: 'Ana' });
    const b = row({ name: 'Beto' });
    // Beto gets news and goes first; React keeps his row and MOVES Ana's below it, and Ana's link holds the focus.
    directAnswer = () =>
      Response.json(page([{ ...b, lastMessageAt: '2026-11-19T15:30:00.000000Z' }, a]));
    renderList(page([a, b]));
    const anaLink = links().find((l) => l.getAttribute('href') === a.href) as HTMLElement;
    anaLink.focus();
    expect(document.activeElement).toBe(anaLink);
    await act(async () => realtime().onSignal('chat.unread', {}));
    await waitFor(() => expect(links()[1]?.getAttribute('href')).toBe(b.href));
    expect((document.activeElement as HTMLElement | null)?.getAttribute('href')).toBe(a.href);
  });

  it('a row the API no longer lists leaves on the refetch (the screen draws exactly the API answer)', async () => {
    const a = row({ name: 'Ana' });
    const b = row({ name: 'Beto' });
    directAnswer = () => Response.json(page([a]));
    renderList(page([a, b]));
    await act(async () => realtime().onSignal('chat.unread', {}));
    await waitFor(() => expect(links()).toHaveLength(2));
    expect(links().map((l) => l.getAttribute('href'))).toEqual(['/suporte', a.href]);
  });

  it('a failed refetch keeps what is on screen', async () => {
    directAnswer = () => new Response(null, { status: 502 });
    renderList(page([row({ name: 'Ana' })]));
    await act(async () => realtime().onSignal('chat.unread', {}));
    await waitFor(() => expect(directUrls()).toHaveLength(1));
    expect(links()).toHaveLength(2);
    expect(screen.queryByText('Não foi possível carregar suas conversas.')).toBeNull();
  });

  it('the support row follows the fresh page too (its dot clears when the member read the reply)', async () => {
    directAnswer = () =>
      Response.json(
        page([], {
          support: support({
            unread: false,
            label: 'Equipe Rede Lab. Equipe: Seu ingresso já está liberado.',
          }),
        }),
      );
    renderList(page([row()]));
    expect(links()[0]?.querySelector('[data-badge-dot]')).not.toBeNull();
    await act(async () => realtime().onSignal('chat.unread', {}));
    await waitFor(() => expect(links()[0]?.querySelector('[data-badge-dot]')).toBeNull());
  });

  it('an answer that is not an object (a malformed body) is a failed read, never a crash', async () => {
    directAnswer = () => new Response('not json', { status: 200 });
    renderList(page([row()]));
    await act(async () => realtime().onSignal('chat.unread', {}));
    await waitFor(() => expect(directUrls()).toHaveLength(1));
    expect(links()).toHaveLength(2);
  });
});

describe('ConversationsSkeleton (UI-D-863)', () => {
  it('is three rows at the row geometry with aria-busy', async () => {
    const { ConversationsSkeleton } = await import('./ConversationsList');
    const { container } = render(<ConversationsSkeleton count={3} />);
    const root = container.querySelector('[aria-busy]');
    expect(root).not.toBeNull();
    const rows = container.querySelectorAll('[data-conversations-skeleton-row]');
    expect(rows).toHaveLength(3);
    expect(has(rows[0], 'min-h-18', 'border-b', 'border-divider')).toBe(true);
  });
});
