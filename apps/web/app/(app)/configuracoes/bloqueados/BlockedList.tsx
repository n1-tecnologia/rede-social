'use client';

import {
  Avatar,
  Button,
  Card,
  EmptyState,
  InfiniteScroll,
  Skeleton,
  useToast,
} from '@rede-social/ui';
import { Ban, CircleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';
import type { BlockActionResult, BlockedPageResult } from '@/components/feed/safety-actions';
import type { BlockedMemberView } from '@/lib/blocks';

/**
 * The "Membros bloqueados" list (11-20, CHAT-07, D-723, D-724, UI-D-635).
 *
 * - **Rows.** The avatar (40), the name as PLAIN TEXT that truncates visually at 320px (`Membro removido` for a
 *   departed member, T-11-16) and an outline "Desbloquear". There is no dialog: one tap unblocks, the button
 *   reads "Desbloqueando…" while the call runs and locks (a double tap sends one request), the row leaves the list
 *   and a toast says "{nome} foi desbloqueado.". A failure keeps the row and raises the one shipped error toast.
 * - **Unblocking restores only the content filter** (D-724): nothing here, and no sentence of the catalog, says the
 *   follows come back.
 * - **Paging.** Keyset pages of 20 through `InfiniteScroll`; a page that fails keeps every loaded row and shows an
 *   inline retry, and the sentinel stands down meanwhile so a failing page cannot spin.
 * - **Empty.** A list with nobody blocked draws the empty state, never an empty column.
 *
 * The two actions arrive as props (the host passes server actions as it does for `onLike`), which keeps this client
 * file free of any server-only import.
 */
export interface BlockedListProps {
  initialItems: BlockedMemberView[];
  initialCursor: string | null;
  /** `true` when the server could not read page 1 at all. */
  initialError?: boolean;
  /** `unblockBlocked`: `DELETE /v1/blocks/{userId}` with the id the caller's own list returned. */
  unblockAction: (userId: string) => Promise<BlockActionResult>;
  /** `loadMoreBlocked`: the next keyset page. */
  loadMoreAction: (cursor: string) => Promise<BlockedPageResult>;
}

export function BlockedList({
  initialItems,
  initialCursor,
  initialError = false,
  unblockAction,
  loadMoreAction,
}: BlockedListProps) {
  const t = useTranslations('safety');
  const tq = useTranslations('safety.queue');
  const tf = useTranslations('feed');
  const te = useTranslations('app.error');
  const toast = useToast();
  const router = useRouter();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [pageFailed, setPageFailed] = useState(false);
  const [firstFailed, setFirstFailed] = useState(initialError);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // The ref is what makes a second tap in the same frame a no-op, before `pending` re-renders.
  const inFlight = useRef(new Set<string>());

  // The server sent a different first page (a navigation or a refresh): re-seed rather than merge.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setPageFailed(false);
    setFirstFailed(initialError);
  }

  const unblock = useCallback(
    async (member: BlockedMemberView) => {
      if (inFlight.current.has(member.userId)) return;
      inFlight.current.add(member.userId);
      setPending(new Set(inFlight.current));
      let ok = false;
      try {
        ok = (await unblockAction(member.userId)).ok;
      } catch (error) {
        console.error('safety.blocked.unblock_failed', { error: String(error) });
      } finally {
        inFlight.current.delete(member.userId);
        setPending(new Set(inFlight.current));
      }
      if (!ok) {
        toast.show({ tone: 'error', message: tf('errors.generic') });
        return;
      }
      setItems((previous) => previous.filter((row) => row.userId !== member.userId));
      toast.show({
        tone: 'success',
        message: t('block.unblocked', { nome: member.name ?? tq('removedMember') }),
      });
    },
    [unblockAction, toast, tf, t, tq],
  );

  const loadMore = useCallback(async () => {
    if (cursor === null) return;
    try {
      const page = await loadMoreAction(cursor);
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setItems((previous) => {
        // A row already on screen is never drawn twice (keyset pages cannot overlap; this is the belt).
        const held = new Set(previous.map((row) => row.userId));
        return [...previous, ...page.items.filter((row) => !held.has(row.userId))];
      });
      setCursor(page.nextCursor);
      setPageFailed(false);
    } catch (error) {
      console.error('safety.blocked.load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor, loadMoreAction]);

  if (firstFailed && items.length === 0) {
    return (
      <div className="px-4 md:px-0" data-blocked-error>
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={tf('errors.generic')}
          action={
            <Button variant="outline" onClick={() => router.refresh()}>
              {te('retry')}
            </Button>
          }
        />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-4 md:px-0" data-blocked-empty>
        <EmptyState
          variant="card"
          icon={Ban}
          title={t('blocked.emptyTitle')}
          body={t('blocked.emptyBody')}
        />
      </div>
    );
  }

  return (
    <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
      <ul aria-label={t('blocked.title')} data-blocked-list>
        {items.map((member) => {
          const name = member.name ?? tq('removedMember');
          const busy = pending.has(member.userId);
          return (
            <li
              key={member.userId}
              data-blocked-row
              className="flex items-center gap-3 px-4 py-3 md:px-4"
            >
              <Avatar src={member.avatarUrl} alt={name} size="md" />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">{name}</span>
              <Button
                variant="outline"
                size="sm"
                hitArea
                loading={busy}
                onClick={() => void unblock(member)}
                className="shrink-0"
              >
                {busy ? t('blocked.unblocking') : t('blocked.unblock')}
              </Button>
            </li>
          );
        })}
      </ul>
      <InfiniteScroll
        hasMore={cursor !== null}
        enabled={!pageFailed}
        onLoadMore={loadMore}
        skeleton={
          <div aria-hidden className="flex items-center gap-3 px-4 py-3">
            <Skeleton variant="circle" className="h-10 w-10 shrink-0" />
            <Skeleton variant="text" width="45%" className="h-4" />
            <Skeleton variant="rect" width={104} className="ml-auto h-9 shrink-0 rounded-xl" />
          </div>
        }
      />
      {pageFailed ? (
        <div
          data-blocked-page-error
          className="flex flex-col items-center gap-3 px-4 py-4 text-center"
        >
          <p className="text-sm font-normal text-danger">{tf('errors.generic')}</p>
          <Button variant="outline" onClick={() => setPageFailed(false)}>
            {te('retry')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
