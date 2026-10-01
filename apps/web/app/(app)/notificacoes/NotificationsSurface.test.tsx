// @vitest-environment happy-dom

import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRowView } from '@/lib/notifications-view';

/**
 * 07-14 — the C-WR-03 races on `/notificacoes` (07 review C-WR-03, D-230, D-231, 07-VERIFICATION
 * truth 14), pinned on the shipped `NotificationsSurface`.
 *
 * Both defects are interleavings, so the actions and `fetch` are deferred by hand and the test picks
 * the order: a load-more held open while a pull-to-refresh replaces the list (the `generation` guard),
 * and a mark-all held open while a row is tapped (the scoped rollback). A live merge during a
 * load-more is the control: it only prepends, so the guard must not drop that page.
 *
 * The catalog is the REAL pt-BR one through next-intl's own translator. Only `InfiniteScroll` and
 * `PullToRefresh` are swapped for buttons (happy-dom has no IntersectionObserver scroll and no touch
 * pull); every other primitive, the toast provider included, is the shipped one. Realtime is a no-op.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  // Vitest runs from `apps/web` (the `ParticipantsList.test.tsx` precedent).
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

const { createTranslator } = await import('next-intl');
const tn = createTranslator({ locale: 'pt-BR', messages, namespace: 'notifications' });

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    // The surface asks for `notifications` and `app.error`; one stable translator per namespace.
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

vi.mock('./actions', () => ({
  loadMoreNotificationsAction: vi.fn(),
  refreshNotificationsAction: vi.fn(),
}));

vi.mock('@rede-social/core/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/core/ui')>()),
  useRealtimeTopic: vi.fn(),
}));

vi.mock('@rede-social/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rede-social/ui')>();
  const { createElement, Fragment } = await import('react');
  return {
    ...actual,
    /** The sentinel as a button: one click is one `onLoadMore`, shown only while it would arm. */
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
    /** The pull as a button, followed by the list it wraps. */
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
          { type: 'button', 'data-testid': 'pull-refresh', onClick: () => void onRefresh() },
          'pull-refresh',
        ),
        children,
      ),
  };
});

const { loadMoreNotificationsAction, refreshNotificationsAction } = await import('./actions');
const { NotificationsSurface } = await import('./NotificationsSurface');

const loadMore = vi.mocked(loadMoreNotificationsAction);
const refreshAction = vi.mocked(refreshNotificationsAction);

type LoadMoreResult = Awaited<ReturnType<typeof loadMoreNotificationsAction>>;
type RefreshResult = Awaited<ReturnType<typeof refreshNotificationsAction>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** One row as the server would hand it: a glyph row with no target (a `<button>`, no navigation). */
function rowView(id: string, unread: boolean): NotificationRowView {
  return {
    id,
    href: null,
    unread,
    leading: { glyph: true },
    glyph: 'Bell',
    glyphTone: 'neutral',
    sentence: `row-${id}.`,
    time: 'agora',
    preview: null,
    removed: false,
  };
}

/** `/api/notifications/read-all` answers with whatever the case parks here; everything else is 200. */
const net = { readAll: null as Promise<Response> | null };
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith('/api/notifications/read-all') && net.readAll) return net.readAll;
  return new Response(null, { status: 200 });
});

function renderSurface(props: {
  unread: NotificationRowView[];
  unreadCursor: string | null;
  read?: NotificationRowView[];
  readCursor?: string | null;
  readStarted: boolean;
}) {
  return render(
    <ToastProvider>
      <NotificationsSurface
        initialUnread={props.unread}
        initialUnreadCursor={props.unreadCursor}
        initialRead={props.read ?? []}
        initialReadCursor={props.readCursor ?? null}
        readStarted={props.readStarted}
        tenantName="Rede Demo"
        tenantId="11111111-1111-4111-8111-111111111111"
        userId="22222222-2222-4222-8222-222222222222"
      />
    </ToastProvider>,
  );
}

/** The rendered rows' ids, top to bottom (the sentence is `row-<id>.`). */
function rowIds(): string[] {
  return screen
    .queryAllByTestId('notification-item')
    .map((item) => /row-([a-z0-9]+)\./.exec(item.textContent ?? '')?.[1] ?? '?');
}

function row(id: string): HTMLElement {
  const found = screen
    .getAllByTestId('notification-item')
    .find((item) => (item.textContent ?? '').includes(`row-${id}.`));
  if (!found) throw new Error(`row ${id} is not rendered`);
  return found;
}

/** Lets every settled promise and the state updates it schedules land. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  net.readAll = null;
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  loadMore.mockReset();
  refreshAction.mockReset();
});

describe('NotificationsSurface — C-WR-03 races', () => {
  it('1. stale page: a load-more that started before a pull-to-refresh drops its page and the next load-more asks for the refreshed cursor (D-231, NOTIF-02 adjacency and ordering, UI E02)', async () => {
    renderSurface({
      unread: [rowView('a', true), rowView('b', true)],
      unreadCursor: 'c1',
      readStarted: false,
    });
    expect(rowIds()).toEqual(['a', 'b']);

    // The load-more leaves for the page after `c1` and is held open.
    const stalePage = deferred<LoadMoreResult>();
    loadMore.mockReturnValueOnce(stalePage.promise);
    fireEvent.click(screen.getByTestId('load-more'));
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(loadMore).toHaveBeenLastCalledWith('unread', 'c1');

    // A pull-to-refresh lands first and REPLACES the list: a new row on top, a new cursor.
    refreshAction.mockResolvedValueOnce({
      ok: true,
      unread: {
        items: [rowView('n', true), rowView('a', true), rowView('b', true)],
        nextCursor: 'c1-new',
      },
      read: null,
    } satisfies RefreshResult);
    fireEvent.click(screen.getByTestId('pull-refresh'));
    await waitFor(() => expect(rowIds()).toEqual(['n', 'a', 'b']));

    // Only now does the stale page arrive.
    await act(async () => {
      stalePage.resolve({
        ok: true,
        items: [rowView('c', true), rowView('d', true)],
        nextCursor: 'c2',
      });
      await stalePage.promise;
    });
    await flush();

    // The refreshed page IS the list: nothing stale appended, no duplicate, newest first.
    expect(rowIds()).toEqual(['n', 'a', 'b']);
    expect(document.querySelector('[data-notifications-page-error]')).toBeNull();

    // The next page continues from the REFRESHED cursor, never the stale page's `c2`.
    loadMore.mockReturnValueOnce(new Promise<LoadMoreResult>(() => {}));
    fireEvent.click(screen.getByTestId('load-more'));
    expect(loadMore).toHaveBeenCalledTimes(2);
    expect(loadMore).toHaveBeenLastCalledWith('unread', 'c1-new');
  });

  it('2. tapped: a failed mark-all gives the tint back only to the rows it cleared, and rows tapped before or during it stay read (D-230, UI E04 error, no second POST while it runs)', async () => {
    renderSurface({
      unread: [rowView('a', true), rowView('b', true), rowView('c', true)],
      unreadCursor: null,
      readStarted: true,
    });
    expect(screen.queryByTestId('load-more')).toBeNull();

    // `a` is tapped BEFORE the mark-all: its own read POST leaves, its tint clears.
    fireEvent.click(row('a'));
    expect(row('a').getAttribute('data-unread')).toBe('false');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/notifications/a/read',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    );

    // The mark-all POST is held open.
    const readAll = deferred<Response>();
    net.readAll = readAll.promise;
    const markAll = screen.getByTestId('notifications-mark-all');
    expect(markAll.textContent).toContain(tn('markAll'));
    fireEvent.click(markAll);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/notifications/read-all',
      expect.objectContaining({ method: 'POST' }),
    );

    // Optimistic: every tint is cleared, and no enabled mark-all control is offered while the POST
    // runs (no second POST can start). The UI-SPEC's "aria-busy and disabled" half is the
    // `gap E04 loading` case below: at HEAD the button is withdrawn instead, because no loaded row is
    // unread any more.
    for (const id of ['a', 'b', 'c']) expect(row(id).getAttribute('data-unread')).toBe('false');
    const during = screen.queryByTestId('notifications-mark-all') as HTMLButtonElement | null;
    expect(during === null || during.disabled).toBe(true);

    // `b` is tapped WHILE the mark-all is in flight.
    fireEvent.click(row('b'));
    expect(row('b').getAttribute('data-unread')).toBe('false');

    // The mark-all fails.
    await act(async () => {
      readAll.resolve(new Response(null, { status: 500 }));
      await readAll.promise;
    });
    await flush();

    // Only `c` (cleared by mark-all alone) gets its tint back; `a` and `b` stay read.
    expect(row('a').getAttribute('data-unread')).toBe('false');
    expect(row('b').getAttribute('data-unread')).toBe('false');
    expect(row('c').getAttribute('data-unread')).toBe('true');

    // One error toast, in the catalog's words.
    const toasts = screen
      .queryAllByRole('status')
      .filter((node) => node.textContent === tn('errors.markAll'));
    expect(toasts).toHaveLength(1);

    // One row is unread again, so the button is back and idle.
    const idle = screen.getByTestId('notifications-mark-all') as HTMLButtonElement;
    expect(idle.getAttribute('aria-busy')).toBeNull();
    expect(idle.disabled).toBe(false);
  });

  it('3. live merge: a visibilitychange merge during a load-more only prepends, and the load-more page is still appended (the guard drops a page only after a replacing refresh)', async () => {
    expect(document.visibilityState).toBe('visible');
    renderSurface({
      unread: [rowView('a', true), rowView('b', true)],
      unreadCursor: 'c1',
      readStarted: false,
    });

    const page = deferred<LoadMoreResult>();
    loadMore.mockReturnValueOnce(page.promise);
    fireEvent.click(screen.getByTestId('load-more'));
    expect(loadMore).toHaveBeenLastCalledWith('unread', 'c1');

    // The return to visible re-reads page 1 of Novas and merges the new row at the top.
    refreshAction.mockResolvedValue({
      ok: true,
      unread: {
        items: [rowView('n', true), rowView('a', true), rowView('b', true)],
        nextCursor: 'c1-new',
      },
      read: null,
    } satisfies RefreshResult);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(rowIds()).toEqual(['n', 'a', 'b']));

    await act(async () => {
      page.resolve({
        ok: true,
        items: [rowView('c', true), rowView('d', true)],
        nextCursor: 'c2',
      });
      await page.promise;
    });
    await flush();

    expect(rowIds()).toEqual(['n', 'a', 'b', 'c', 'd']);
    expect(document.querySelector('[data-notifications-page-error]')).toBeNull();
  });
});

/**
 * Two product gaps 07-14 found while pinning C-WR-03. The plan is test-only, so they are recorded
 * here as EXPECTED FAILURES, with the planned assertions unchanged (07-14-SUMMARY, phase
 * deferred-items, WINDOWS). Each `it.fails` turns red the moment the product is fixed. Then make it a
 * plain `it`.
 */
describe('NotificationsSurface — C-WR-03 known gaps (expected failures at HEAD)', () => {
  it.fails('gap E04 loading: the mark-all button is aria-busy and disabled while its POST runs (UI-D-252; at HEAD it is withdrawn, because the optimistic step leaves no loaded row unread)', async () => {
    renderSurface({
      unread: [rowView('a', true), rowView('b', true), rowView('c', true)],
      unreadCursor: null,
      readStarted: true,
    });
    net.readAll = deferred<Response>().promise;
    fireEvent.click(screen.getByTestId('notifications-mark-all'));

    const busy = screen.getByTestId('notifications-mark-all') as HTMLButtonElement;
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.disabled).toBe(true);
  });

  it.fails('gap own read POST: a row activated while a mark-all is in flight sends its own read POST, the premise the scoped rollback keeps its tint on (at HEAD `activate` posts only while the row looks unread, and mark-all already cleared it)', async () => {
    renderSurface({
      unread: [rowView('a', true), rowView('b', true), rowView('c', true)],
      unreadCursor: null,
      readStarted: true,
    });
    net.readAll = deferred<Response>().promise;
    fireEvent.click(screen.getByTestId('notifications-mark-all'));
    fireEvent.click(row('b'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/notifications/b/read',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    );
  });
});
