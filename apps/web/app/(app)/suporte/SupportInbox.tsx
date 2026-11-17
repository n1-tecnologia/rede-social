'use client';

import { inboxTopic, REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import { useRealtimeTopic } from '@rede-social/core/ui';
import { InboxRow } from '@rede-social/module-chat/ui';
import {
  Button,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  Skeleton,
  StatusPill,
} from '@rede-social/ui';
import {
  CircleCheck,
  CircleDot,
  Lock,
  MessageCircle,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CaseStateGlyph, InboxCaseView, InboxRowView } from '@/lib/chat-view';
import {
  anyInboxFilter,
  INBOX_DEFAULTS,
  type InboxQueryState,
  inboxApiFilters,
  inboxApiQuery,
  inboxHref,
  parseInboxQuery,
} from '@/lib/inbox-query';
import { loadMoreInboxAction } from './actions';
import { InboxFilters } from './InboxFilters';

/**
 * One skeleton row at the inbox row's own four-line geometry (UI-D-824, UI-D-832): a 40px circle top aligned, the
 * four bars of name, subject line, preview and meta line (a pill and a text), and the 12px time bar on the
 * right. Shared by the layout's Suspense fallback, the first read of a new view and the load-more sentinel,
 * so the swap to rows does not move anything.
 */
export function InboxSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy data-inbox-skeleton>
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered.
          key={index}
          data-inbox-skeleton-row
          className="flex min-h-18 items-start gap-3 border-b border-divider px-4 py-3"
        >
          <Skeleton variant="circle" className="h-10 w-10 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" width={index % 2 === 0 ? '52%' : '44%'} className="h-3.5" />
            <Skeleton variant="text" width={index % 2 === 0 ? '78%' : '66%'} className="h-3.5" />
            <Skeleton variant="text" width={index % 2 === 0 ? '88%' : '74%'} className="h-3.5" />
            <div className="flex items-center gap-2">
              <Skeleton variant="rect" width={64} className="h-5 shrink-0 rounded-full" />
              <Skeleton variant="text" width="38%" className="h-3" />
            </div>
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

/** The glyph of a case state (named by the view layer, drawn here: the view stays client-safe data). */
const GLYPHS: Record<CaseStateGlyph, typeof CircleDot> = {
  CircleDot,
  UserCheck,
  CircleCheck,
  Lock,
};

/** The state pill and (only for Alta and Baixa) the priority pill the module's row draws (UI-D-824, A-UI-7). */
function casePills(kase: InboxCaseView) {
  const Glyph = GLYPHS[kase.state.glyph];
  return {
    statePill: (
      <StatusPill data-case-pill tone={kase.state.tone} className="shrink-0">
        <Glyph aria-hidden size={12} />
        {kase.state.label}
      </StatusPill>
    ),
    priorityPill: kase.priority?.pill ? (
      <StatusPill data-case-priority tone={kase.priority.tone} className="shrink-0">
        {kase.priority.label}
      </StatusPill>
    ) : undefined,
  };
}

type EmptyCause = 'open' | 'awaiting' | 'resolved' | 'closed' | 'filtered';

/**
 * Which of the five empty sentences a view earns (UI-D-823; never one generic line for different causes): an
 * owner or priority filter makes it "filtered" (a subset is never described as "everyone answered"), then the
 * toggle makes it "awaiting", else the tab's own.
 */
function emptyCause(query: InboxQueryState): EmptyCause {
  if (query.owner !== null || query.priority !== null) return 'filtered';
  if (query.awaiting) return 'awaiting';
  return query.tab === 'resolvidos' ? 'resolved' : query.tab === 'fechados' ? 'closed' : 'open';
}

/** The API query of the default view: the page the server renders is this one. */
const DEFAULT_VIEW = inboxApiQuery(INBOX_DEFAULTS);

/** Page 1 of one view (`apiQuery` in the API's vocabulary) through the BFF; `null` when it could not be read. */
async function fetchPage1(apiQuery: string): Promise<InboxAnswer | null> {
  try {
    const res = await fetch(`/api/chat/inbox?${apiQuery}`, {
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
 * The staff inbox list (CHAT-03, CASE-16, UI-D-262, UI-D-823, UI-D-824, D-221, D-225, D-238, D-805) [designed]: the
 * support cases of the tenant in ONE list, latest activity first, under the tabs and filters of
 * `InboxFilters`.
 *
 * - **The view lives in the URL** (UI-D-823): `?aba=&resp=&prio=&aguardando=` is read with
 *   `useSearchParams` (the shared layout cannot read the query) and a change is written with
 *   `router.replace` without scroll. The server renders the DEFAULT page 1; when the URL asks for another
 *   view this list reads page 1 of it through the BFF `GET /api/chat/inbox` (skeleton rows while that first
 *   read runs; a plain refresh keeps the rows on screen). Every row link carries the current query
 *   string, so opening `/suporte/{id}` keeps the filters. The client never decides which cases belong to a
 *   tab: the server filters and lists.
 * - **Live, never dependent on Realtime** (UI-D-830, D-240): a `chat.message`, `chat.read` or `chat.case`
 *   signal on `tenant:<t>:support-inbox`, every (re)subscribe and every refocus refetch page 1 FOR THE
 *   CURRENT VIEW and merge it by case id AT THE TOP, so a case with news moves up and a team read clears
 *   its dot for every staff member (D-225); a row whose state no longer belongs to the tab leaves on the
 *   next refetch, with no animation (A-UI-12). Refetches are coalesced: one in flight, at most one more
 *   queued (T-07-71), and a read for a view the staff already left is discarded. No polling.
 * - **Paging:** `InfiniteScroll` by keyset through `loadMoreInboxAction(cursor, filters)` with the same
 *   filters the first page was read with; a failed page keeps the rows and shows the inline line with a
 *   retry. `PullToRefresh` on the phone.
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
  const pathname = usePathname();
  const segment = useSelectedLayoutSegment();
  const searchParams = useSearchParams();

  // The view: ONE parse of the URL per distinct query string.
  const searchKey = searchParams.toString();
  const query = useMemo(() => parseInboxQuery(new URLSearchParams(searchKey)), [searchKey]);
  const apiKey = inboxApiQuery(query);

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [firstLoadFailed, setFirstLoadFailed] = useState(initialError);
  const [pageFailed, setPageFailed] = useState(false);
  /** The API query of the view `items` belongs to: the server's page 1 is the default view. */
  const [held, setHeld] = useState(DEFAULT_VIEW);
  /** The first read of a new view is running: skeleton rows instead of the previous view's rows. */
  const [viewLoading, setViewLoading] = useState(false);

  /** How many keyset pages the list holds: page 1's cursor is replaced only while it is the last. */
  const pagesRef = useRef(1);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;
  const heldRef = useRef(held);
  heldRef.current = held;

  // The SERVER sent a different page 1 (a `router.refresh()`): re-seed rather than merge. The server's
  // page is the default view, so a URL that asks for another one is read again by the effect below.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFirstLoadFailed(initialError);
    setPageFailed(false);
    setHeld(DEFAULT_VIEW);
    pagesRef.current = 1;
  }

  // The URL asks for a view the list does not hold: read its page 1 (UI-D-823). Skeleton rows meanwhile.
  useEffect(() => {
    if (held === apiKey) {
      setViewLoading(false);
      return;
    }
    let cancelled = false;
    setViewLoading(true);
    setFirstLoadFailed(false);
    setPageFailed(false);
    void fetchPage1(apiKey).then((page) => {
      if (cancelled) return;
      pagesRef.current = 1;
      if (page) {
        setItems(page.items);
        setCursor(page.nextCursor);
        setFirstLoadFailed(false);
      } else {
        setItems([]);
        setCursor(null);
        setFirstLoadFailed(true);
      }
      setHeld(apiKey);
      setViewLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiKey, held]);

  const refreshing = useRef<{ busy: boolean; again: boolean }>({ busy: false, again: false });

  /** Page 1 of the CURRENT view again, merged at the top; one run at a time, one more queued (T-07-71). */
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
        const key = apiKeyRef.current;
        // A view switch is running: its own read is page 1 of the new view, not this one.
        if (heldRef.current !== key) continue;
        const page = await fetchPage1(key);
        // The staff left this view while the read ran: its rows do not belong to the one on screen.
        if (apiKeyRef.current !== key || heldRef.current !== key) continue;
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
    [REALTIME_EVENTS.chatMessage, REALTIME_EVENTS.chatRead, REALTIME_EVENTS.chatCase],
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

  /** APPEND the next keyset page of the same view; a row already on screen (moved up by a merge) is not repeated. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const key = apiKeyRef.current;
    try {
      const page = await loadMoreInboxAction(cursor, inboxApiFilters(query));
      // The staff changed view while the page was on its way: it belongs to the previous one.
      if (apiKeyRef.current !== key || heldRef.current !== key) return;
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
  }, [cursor, query]);

  /** Re-arms the sentinel (which is on screen) rather than fetching, so one tap loads one page. */
  const retryPage = useCallback(() => setPageFailed(false), []);

  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refreshPage1();
  }, [refreshPage1]);

  /** A change of view is written to the URL (no scroll); the effect above reads the new page 1. */
  const changeQuery = useCallback(
    (next: InboxQueryState) => router.replace(inboxHref(pathname, next), { scroll: false }),
    [router, pathname],
  );

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
  if (viewLoading) {
    body = <InboxSkeleton count={6} />;
  } else if (firstLoadFailed && items.length === 0) {
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
    const cause = emptyCause(query);
    body = (
      <EmptyState
        icon={MessageCircle}
        data-inbox-empty
        data-inbox-empty-cause={cause}
        title={t(`inbox.empty.${cause}.title`)}
        body={t(`inbox.empty.${cause}.body`)}
        action={
          cause === 'filtered' && anyInboxFilter(query) ? (
            <Button
              variant="outline"
              onClick={() => changeQuery({ ...INBOX_DEFAULTS, tab: query.tab })}
            >
              {t('inbox.filter.clear')}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <>
        {/* The anchors inside are the interactive elements; this only turns their click into a
            client navigation (Enter on a focused row fires the same click). */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation of the child links bubbles here. */}
        <ul data-inbox-list onClick={onRowClick}>
          {items.map((row) => {
            const pills = row.case ? casePills(row.case) : null;
            return (
              <li key={row.conversationId}>
                <InboxRow
                  href={inboxHref(row.href, query)}
                  active={segment === row.conversationId}
                  avatar={row.avatar}
                  name={row.name}
                  preview={row.preview}
                  time={row.time}
                  awaiting={row.awaiting}
                  awaitingSr={t('inbox.awaitingSr')}
                  state={row.state}
                  blockedLabel={t('blocked.pill')}
                  subjectLine={row.case?.subjectLine}
                  statePill={pills?.statePill}
                  priorityPill={pills?.priorityPill}
                  metaText={row.case?.meta}
                />
              </li>
            );
          })}
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
    <>
      <InboxFilters query={query} onChange={changeQuery} />
      <PullToRefresh onRefresh={refreshPage1} className="lg:flex-1">
        <div className="flex flex-col pb-6 lg:pb-0">{body}</div>
      </PullToRefresh>
    </>
  );
}
