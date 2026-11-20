'use client';

import { REALTIME_EVENTS, userTopic } from '@rede-social/contracts/realtime';
import { TenantLogo, useRealtimeTopic } from '@rede-social/core/ui';
import { InboxRow } from '@rede-social/module-chat/ui';
import {
  Badge,
  Button,
  buttonClasses,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  Skeleton,
} from '@rede-social/ui';
import { CircleAlert, Headset, Mic, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  type ConversationRowView,
  type ConversationsPageView,
  type PreviewKind,
  reconcileInboxPage,
  type SupportRowView,
} from '@/lib/chat-view';

export interface ConversationsListProps {
  /** Page 1, finished by the server in the tenant clock (UI-D-862); `null` when the server could not read it. */
  initial: ConversationsPageView | null;
  /** The tenant and the member, from the bootstrap: the member's own user topic is the live signal (D-240). */
  tenantId: string;
  userId: string;
  /** The tenant's display name and logo, for the pinned support row's avatar. */
  tenantName: string;
  logoUrl: string | null;
}

/** The glyph before a preview: the microphone for a recording only (UI-D-866, UI-D-853). */
function previewLeading(kind: PreviewKind) {
  return kind === 'voice' ? <Mic aria-hidden size={14} className="shrink-0" /> : undefined;
}

/**
 * The support row's avatar slot (UI-D-862): the tenant logo contained in a 40px neutral disc, or the `Headset`
 * glyph on `bg-bg-tertiary` when the tenant has none. Decorative: the row's name carries the words.
 */
function SupportAvatar({ tenantName, logoUrl }: { tenantName: string; logoUrl: string | null }) {
  return (
    <span
      aria-hidden
      data-support-avatar
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-tertiary text-text-secondary"
    >
      {logoUrl ? (
        <TenantLogo
          logoUrl={logoUrl}
          displayName={tenantName}
          size="thread"
          hideOnError
          className="h-6 max-w-7"
        />
      ) : (
        <Headset aria-hidden size={20} />
      )}
    </span>
  );
}

function SupportRow({
  row,
  tenantName,
  logoUrl,
}: {
  row: SupportRowView;
  tenantName: string;
  logoUrl: string | null;
}) {
  return (
    <InboxRow
      href={row.href}
      avatar={null}
      avatarSlot={<SupportAvatar tenantName={tenantName} logoUrl={logoUrl} />}
      name={row.name}
      preview={row.preview}
      previewMuted={row.idle}
      previewLeading={previewLeading(row.previewKind)}
      time=""
      awaiting={row.unread}
      state="active"
      label={row.label}
      unread={row.unread ? <Badge count={1} variant="dot" /> : undefined}
    />
  );
}

function DirectRow({ row }: { row: ConversationRowView }) {
  return (
    <InboxRow
      href={row.href}
      avatar={row.avatar}
      name={row.name}
      preview={row.preview}
      previewLeading={previewLeading(row.previewKind)}
      time={row.time}
      awaiting={row.unread !== null}
      state={row.removed ? 'removed' : 'active'}
      label={row.label}
      unread={row.unread ? <Badge count={row.unread.count} /> : undefined}
    />
  );
}

/**
 * The loading rows (UI-D-863): the row's own geometry (`min-h-18 items-start gap-3 px-4 py-3`, a 40px circle, two
 * bars and the time bar), `aria-busy`. Shared by `loading.tsx` (the header renders at once), the retry after a
 * failed first read and the load-more sentinel, so the swap to rows moves nothing.
 */
export function ConversationsSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy data-conversations-skeleton>
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered.
          key={index}
          data-conversations-skeleton-row
          className="flex min-h-18 items-start gap-3 border-b border-divider px-4 py-3"
        >
          <Skeleton variant="circle" className="h-10 w-10 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" width={index % 2 === 0 ? '46%' : '38%'} className="h-3.5" />
            <Skeleton variant="text" width={index % 2 === 0 ? '78%' : '64%'} className="h-3.5" />
          </div>
          <Skeleton variant="text" width={32} className="h-3 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** One page of the Conversas BFF read (`GET /api/chat/direct`, finished views); `null` when it could not be read. */
async function fetchPage(cursor: string | null): Promise<ConversationsPageView | null> {
  try {
    const query = cursor ? `?${new URLSearchParams({ cursor }).toString()}` : '';
    const res = await fetch(`/api/chat/direct${query}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    if (
      typeof body !== 'object' ||
      body === null ||
      !Array.isArray((body as { rows?: unknown }).rows)
    ) {
      return null;
    }
    return body as ConversationsPageView;
  } catch {
    return null;
  }
}

/**
 * The Conversas list (CHAT-06, D-719, D-720, D-721, UI-D-862, UI-D-866, UI-D-879) [designed]: the pinned support
 * row first, then the direct conversations newest first, in one `mx-auto w-full max-w-[680px]` column on every
 * breakpoint (no desktop split for members, A-UI-3). It draws EXACTLY what the API answered, finished by the
 * view functions of 11-18: no filter, no flag and no "blocked me" fact is computed here (T-11-03), and every
 * member string is a React text node (T-11-16).
 *
 * Each row is the shipped `InboxRow` without its case lines: ONE link of at least 44px named by its finished
 * label ("{name}, {count} mensagens novas. {preview}", the count clause only when unread). The unread mark is the
 * shipped count `Badge` (`99+`) on a direct row and the dot on the support row (the support semantics stay a
 * flag, D-237). Rows are plain links (the module cannot import `next/link`); a plain left click is intercepted
 * here and becomes a client navigation, a modified click keeps the browser's own behaviour.
 */
export function ConversationsList({
  initial,
  tenantId,
  userId,
  tenantName,
  logoUrl,
}: ConversationsListProps) {
  const t = useTranslations('chat');
  const router = useRouter();

  const [support, setSupport] = useState(initial?.support);
  const [rows, setRows] = useState(initial?.rows ?? []);
  const [cursor, setCursor] = useState(initial?.nextCursor ?? null);
  const [firstLoadFailed, setFirstLoadFailed] = useState(initial === null);
  const [pageFailed, setPageFailed] = useState(false);
  /** The retry after a failed first read is running: skeleton rows instead of the card. */
  const [retrying, setRetrying] = useState(false);

  /** How many keyset pages the list holds: page 1's cursor is replaced only while it is the last. */
  const pagesRef = useRef(1);
  /** A load-more is in flight: a refetch that lands now must not read the list as the whole view. */
  const loadingMoreRef = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const listRef = useRef<HTMLUListElement>(null);
  /** The href of the row that held the focus when a merge was applied, put back after the commit. */
  const refocusRef = useRef<string | null>(null);
  const refreshing = useRef<{ busy: boolean; again: boolean }>({ busy: false, again: false });

  // The SERVER sent a different page 1 (the route was rendered again): re-seed rather than merge.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setSupport(initial?.support);
    setRows(initial?.rows ?? []);
    setCursor(initial?.nextCursor ?? null);
    setFirstLoadFailed(initial === null);
    setPageFailed(false);
    pagesRef.current = 1;
  }

  // A merge reorders the rows: a moved link may lose the focus in the browser, so the focus is put back on the
  // very same row (by its href) and nothing scrolls (`preventScroll`), WITHOUT touching the scroll offset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect must run after every commit of `rows`; it reads a ref, not the rows.
  useLayoutEffect(() => {
    const href = refocusRef.current;
    refocusRef.current = null;
    if (!href) return;
    const target = Array.from(
      listRef.current?.querySelectorAll<HTMLAnchorElement>('a[data-inbox-row]') ?? [],
    ).find((anchor) => anchor.getAttribute('href') === href);
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [rows]);

  /** Page 1 again, merged into the list by conversation id at the top; one run at a time, one more queued. */
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
        const page = await fetchPage(null);
        if (!page) continue; // A failed refetch keeps what is on screen.
        // The fresh page replaces the window of the server order it covers (the same rule the staff inbox
        // uses): a row that moved goes up, a row the API no longer lists leaves, deeper rows stay.
        const { items, whole } = reconcileInboxPage(rowsRef.current, page.rows, {
          holdsOnlyPage1: pagesRef.current <= 1 && !loadingMoreRef.current,
          hasMore: page.nextCursor !== null,
        });
        const active = document.activeElement;
        refocusRef.current =
          active instanceof HTMLAnchorElement && active.hasAttribute('data-inbox-row')
            ? active.getAttribute('href')
            : null;
        rowsRef.current = items;
        setRows(items);
        if (page.support) setSupport(page.support);
        if (whole) {
          pagesRef.current = 1;
          setCursor(page.nextCursor);
          if (page.nextCursor === null) setPageFailed(false);
        }
        setFirstLoadFailed(false);
      } while (state.again);
    } finally {
      state.busy = false;
    }
  }, []);

  // Live, never dependent on Realtime (D-240): the member's own `chat.unread` signal, every (re)subscribe and
  // every refocus refetch page 1. The signal carries ids only; the data always comes through the BFF.
  useRealtimeTopic(
    userTopic(tenantId, userId),
    [REALTIME_EVENTS.chatUnread],
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
    loadingMoreRef.current = true;
    try {
      const page = await fetchPage(cursor);
      if (!page) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      pagesRef.current += 1;
      setRows((current) => {
        const ids = new Set(current.map((row) => row.conversationId));
        return [...current, ...page.rows.filter((row) => !ids.has(row.conversationId))];
      });
      setCursor(page.nextCursor);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [cursor]);

  /** Re-arms the sentinel (which is on screen) rather than fetching, so one tap loads one page. */
  const retryPage = useCallback(() => setPageFailed(false), []);

  const retryFirst = useCallback(async () => {
    setRetrying(true);
    const page = await fetchPage(null);
    setRetrying(false);
    if (!page) {
      setFirstLoadFailed(true);
      return;
    }
    pagesRef.current = 1;
    setSupport(page.support);
    setRows(page.rows);
    setCursor(page.nextCursor);
    setPageFailed(false);
    setFirstLoadFailed(false);
  }, []);

  const onRowClick = useCallback(
    (event: MouseEvent<HTMLUListElement>) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest('a[data-inbox-row]');
      const href = anchor?.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      router.push(href);
    },
    [router],
  );

  let body: ReactNode;
  if (retrying) {
    body = <ConversationsSkeleton count={3} />;
  } else if (firstLoadFailed && rows.length === 0 && !support) {
    // One read feeds the page: a failed read draws no support row either (UI-D-863).
    body = (
      <div className="px-4 pt-4">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-conversations-error
          title={t('conversations.error.title')}
          body={t('conversations.error.body')}
          action={
            <Button variant="outline" onClick={() => void retryFirst()}>
              {t('conversations.error.retry')}
            </Button>
          }
        />
      </div>
    );
  } else {
    body = (
      <>
        {/* The anchors inside are the interactive elements; this only turns their click into a client
            navigation (Enter on a focused row fires the same click). */}
        {/* Tailwind's preflight sets `list-style: none` on every `ul` and WebKit then drops the list semantics, so
            the explicit role restores "list of N items" (UI-D-862, UI-D-879). */}
        {/* biome-ignore lint/a11y/noRedundantRoles: not redundant under preflight, see the note above. */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation of the child links bubbles here. */}
        <ul ref={listRef} role="list" aria-label={t('conversations.region')} onClick={onRowClick}>
          {support ? (
            <li>
              <SupportRow row={support} tenantName={tenantName} logoUrl={logoUrl} />
            </li>
          ) : null}
          {rows.map((row) => (
            <li key={row.conversationId}>
              <DirectRow row={row} />
            </li>
          ))}
        </ul>

        {rows.length === 0 && cursor === null ? (
          // Blank, the common case: the support row stays and the card sits under it (D-720: no "Nova conversa").
          <div className="px-4 pt-4">
            <EmptyState
              variant="card"
              icon={Users}
              data-conversations-empty
              title={t('conversations.empty.title')}
              body={t('conversations.empty.body')}
              action={
                <Link href="/membros" className={buttonClasses({ variant: 'outline', size: 'md' })}>
                  {t('conversations.empty.cta')}
                </Link>
              }
            />
          </div>
        ) : null}

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<ConversationsSkeleton count={2} />}
        />

        {pageFailed ? (
          <div
            data-conversations-page-error
            className="flex flex-col items-center gap-3 px-4 py-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('conversations.error.more')}</p>
            <Button variant="outline" onClick={retryPage}>
              {t('conversations.error.retry')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <PullToRefresh onRefresh={refreshPage1}>
      <div data-conversations className="mx-auto w-full max-w-[680px] pb-6">
        {body}
      </div>
    </PullToRefresh>
  );
}
