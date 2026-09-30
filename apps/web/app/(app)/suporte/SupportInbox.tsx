'use client';

import { inboxTopic, REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import { useRealtimeTopic } from '@rede-social/core/ui';
import { InboxRow } from '@rede-social/module-chat/ui';
import { Button, EmptyState, InfiniteScroll, PullToRefresh, Skeleton } from '@rede-social/ui';
import { MessageCircle, TriangleAlert } from 'lucide-react';
import { useRouter, useSelectedLayoutSegment } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { InboxRowView } from '@/lib/chat-view';
import { loadMoreInboxAction } from './actions';

/**
 * One skeleton row at the inbox row's own 72px geometry (UI-D-265): a 40px circle, two text bars (the
 * name and the preview) and the 12px time bar on the right. Shared by the layout's Suspense fallback
 * and the load-more sentinel, so the swap to rows does not move anything.
 */
export function InboxSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy data-inbox-skeleton>
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered.
          key={index}
          className="flex min-h-18 items-center gap-3 border-b border-divider px-4 py-3"
        >
          <Skeleton variant="circle" className="h-10 w-10" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" width={index % 2 === 0 ? '52%' : '44%'} className="h-3.5" />
            <Skeleton variant="text" width={index % 2 === 0 ? '80%' : '72%'} className="h-3.5" />
          </div>
          <Skeleton variant="text" width={32} className="h-3 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export interface SupportInboxProps {
  tenantId: string;
  /** Page 1, formatted by the server in the tenant clock (UI-D-262). */
  initialItems: InboxRowView[];
  initialCursor: string | null;
  /** The server could not read page 1: the generic error card with a retry. */
  initialError: boolean;
}

interface InboxAnswer {
  items: InboxRowView[];
  nextCursor: string | null;
}

/** `fresh` on top (latest activity first), then every loaded row it does not replace (by id). */
function mergeTop(current: readonly InboxRowView[], fresh: readonly InboxRowView[]) {
  const ids = new Set(fresh.map((row) => row.conversationId));
  return [...fresh, ...current.filter((row) => !ids.has(row.conversationId))];
}

async function fetchPage1(): Promise<InboxAnswer | null> {
  try {
    const res = await fetch('/api/chat/inbox', {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    if (!res.ok) return null;
    return (await res.json()) as InboxAnswer;
  } catch {
    return null;
  }
}

/**
 * The staff inbox list (CHAT-03, UI-D-262, D-221, D-225, D-238) [designed]: every member conversation
 * of the tenant in ONE list, latest activity first. No chips, no filters, no resolve (D-221).
 *
 * - **Live, never dependent on Realtime** (UI-D-265, D-240): a `chat.message` or `chat.read` signal on
 *   `tenant:<t>:support-inbox`, every (re)subscribe and every refocus refetch page 1 through the BFF
 *   `GET /api/chat/inbox` and merge it by conversation id AT THE TOP, so a conversation with news moves
 *   up and a team read clears its dot for every staff member (D-225). Refetches are coalesced: one in
 *   flight, at most one more queued (T-07-71). The signal carries ids only; the rows always come from
 *   the API.
 * - **Paging:** `InfiniteScroll` by keyset through `loadMoreInboxAction`; a failed page keeps the rows
 *   and shows the inline line with a retry. `PullToRefresh` on the phone.
 * - **Navigation:** the rows are plain links (the module cannot import `next/link`); a plain left
 *   click is intercepted here and becomes a client navigation, so the shared layout, this list and its
 *   scroll position stay put while the right pane changes (UI-D-264). Modified clicks keep the
 *   browser's own behaviour (a new tab).
 * - **The open row** (`bg-bg-active`, `aria-current="page"`) is the selected layout segment.
 */
export function SupportInbox({
  tenantId,
  initialItems,
  initialCursor,
  initialError,
}: SupportInboxProps) {
  const t = useTranslations('chat');
  const te = useTranslations('app.error');
  const router = useRouter();
  const segment = useSelectedLayoutSegment();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [firstLoadFailed, setFirstLoadFailed] = useState(initialError);
  const [pageFailed, setPageFailed] = useState(false);

  /** How many keyset pages the list holds: page 1's cursor is replaced only while it is the last. */
  const pagesRef = useRef(1);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // The SERVER sent a different page 1 (a `router.refresh()`): re-seed rather than merge.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFirstLoadFailed(initialError);
    setPageFailed(false);
    pagesRef.current = 1;
  }

  const refreshing = useRef<{ busy: boolean; again: boolean }>({ busy: false, again: false });

  /** Page 1 again, merged at the top; one run at a time, one more queued (T-07-71). */
  const refreshPage1 = useCallback(async () => {
    const state = refreshing.current;
    if (state.busy) {
      state.again = true;
      return;
    }
    state.busy = true;
    try {
      do {
        state.again = false;
        const page = await fetchPage1();
        if (!page) {
          if (itemsRef.current.length === 0) setFirstLoadFailed(true);
          continue;
        }
        setItems((current) => mergeTop(current, page.items));
        if (pagesRef.current <= 1) setCursor(page.nextCursor);
        setFirstLoadFailed(false);
      } while (state.again);
    } finally {
      state.busy = false;
    }
  }, []);

  useRealtimeTopic(
    inboxTopic(tenantId),
    [REALTIME_EVENTS.chatMessage, REALTIME_EVENTS.chatRead],
    () => void refreshPage1(),
    { onSubscribed: () => void refreshPage1() },
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshPage1();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refreshPage1]);

  /** APPEND the next keyset page; a row already on screen (moved up by a merge) is not repeated. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await loadMoreInboxAction(cursor);
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      pagesRef.current += 1;
      setItems((current) => {
        const ids = new Set(current.map((row) => row.conversationId));
        return [...current, ...page.items.filter((row) => !ids.has(row.conversationId))];
      });
      setCursor(page.nextCursor);
    } catch (error) {
      console.error('chat.inbox_load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor]);

  /** Re-arms the sentinel (which is on screen) rather than fetching, so one tap loads one page. */
  const retryPage = useCallback(() => setPageFailed(false), []);

  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refreshPage1();
  }, [refreshPage1]);

  /** A plain left click on a row is a client navigation: the shared layout (and this list) stays. */
  const onRowClick = useCallback(
    (event: MouseEvent<HTMLUListElement>) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest('a[data-inbox-row]');
      const href = anchor?.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      router.push(href, { scroll: false });
    },
    [router],
  );

  let body: ReactNode;
  if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4 pt-4">
        <EmptyState
          variant="card"
          icon={TriangleAlert}
          data-inbox-error
          title={te('title')}
          body={te('body')}
          action={
            <Button variant="outline" onClick={retryFirst}>
              {te('retry')}
            </Button>
          }
        />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={MessageCircle}
        data-inbox-empty
        title={t('inbox.empty.title')}
        body={t('inbox.empty.body')}
      />
    );
  } else {
    body = (
      <>
        {/* The anchors inside are the interactive elements; this only turns their click into a
            client navigation (Enter on a focused row fires the same click). */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation of the child links bubbles here. */}
        <ul data-inbox-list onClick={onRowClick}>
          {items.map((row) => (
            <li key={row.conversationId}>
              <InboxRow
                href={row.href}
                active={segment === row.conversationId}
                avatar={row.avatar}
                name={row.name}
                preview={row.preview}
                time={row.time}
                awaiting={row.awaiting}
                awaitingSr={t('inbox.awaitingSr')}
                state={row.state}
                blockedLabel={t('blocked.pill')}
              />
            </li>
          ))}
        </ul>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<InboxSkeleton count={3} />}
        />

        {pageFailed ? (
          <div
            data-inbox-page-error
            className="flex flex-col items-center gap-3 px-4 py-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('inbox.errors.loadMore')}</p>
            <Button variant="outline" onClick={retryPage}>
              {te('retry')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <PullToRefresh onRefresh={refreshPage1} className="lg:flex-1">
      <div className="flex flex-col pb-6 lg:pb-0">{body}</div>
    </PullToRefresh>
  );
}
