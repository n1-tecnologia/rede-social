'use client';

import { Button, InfiniteScroll } from '@rede-social/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMoreOwnerListAction } from '@/app/(app)/perfil/dashboard-actions';
import type { OwnerListMoreRequest, OwnerListRowView } from '@/lib/owner-list-view';
import { type OwnerListLayout, OwnerListRowSkeleton, OwnerListRows } from './OwnerListRows';

export interface OwnerListMoreProps {
  /** The list's own params (a band and its scope, or a member's list), sent with every page. */
  request: OwnerListMoreRequest;
  /** The cursor the server's first page ended on. */
  cursor: string;
  layout: OwnerListLayout;
  /** The shipped "e mais N" line, already worded; null for a list with no total to say. */
  more: string | null;
  labels: {
    /** "Ver todos" (`dashboard.tenantOwner.bandMembers.seeAll`). */
    seeAll: string;
    /** "Não foi possível carregar o restante da lista." (`dashboard.report.errors.more`). */
    error: string;
    /** "Tentar novamente" (`dashboard.report.errors.retry`). */
    retry: string;
  };
}

type Phase = 'idle' | 'paging';

/**
 * "Ver todos" continues the list in place (08.7-05, UI-D-477). The server renders the list's first
 * rows; this island starts as the shipped "e mais N" line and an ENABLED ghost "Ver todos". Pressing
 * it removes both, appends the next 20 rows from `loadMoreOwnerListAction`, moves focus to the first
 * appended row, and hands the rest to the shipped `InfiniteScroll` (pages of 20, the one-row
 * skeleton, nothing at the end). The URL does not change. A failed page shows the retry line under
 * the last row; "Tentar novamente" asks for the SAME cursor again. Rows are appended, never
 * replaced, and a row already on screen never shows twice. Without JavaScript the server's rows and
 * the "e mais N" line remain.
 */
export function OwnerListMore({
  request,
  cursor: first,
  layout,
  more,
  labels,
}: OwnerListMoreProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [rows, setRows] = useState<OwnerListRowView[]>([]);
  const [cursor, setCursor] = useState<string | null>(first);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const inFlight = useRef(false);
  const appended = useRef(0);
  const firstRef = useRef<HTMLLIElement>(null);

  const loadPage = useCallback(async () => {
    if (cursor === null || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const page = await loadMoreOwnerListAction({ ...request, cursor });
      if ('error' in page) {
        setFailed(true);
        return;
      }
      setFailed(false);
      if (appended.current === 0 && page.rows.length > 0) setFocusFirst(true);
      appended.current += page.rows.length;
      setRows((previous) => {
        const seen = new Set(previous.map((row) => row.id));
        return [...previous, ...page.rows.filter((row) => !seen.has(row.id))];
      });
      setCursor(page.nextCursor);
    } catch (error) {
      // A rejected action (a dead network) is a failed page: the rows on screen stay.
      console.error('dashboard.owner_list_more_failed', {
        name: error instanceof Error ? error.name : typeof error,
      });
      setFailed(true);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [cursor, request]);

  useEffect(() => {
    if (!focusFirst) return;
    setFocusFirst(false);
    const row = firstRef.current;
    const target = row?.querySelector<HTMLElement>('a, button') ?? row;
    target?.focus();
  }, [focusFirst]);

  const seeAll = useCallback(() => {
    setPhase('paging');
    void loadPage();
  }, [loadPage]);

  return (
    <>
      {rows.length > 0 ? <OwnerListRows rows={rows} layout={layout} firstRef={firstRef} /> : null}

      {phase === 'idle' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {more ? <p className="text-xs font-medium text-text-secondary">{more}</p> : <span />}
          <Button variant="ghost" size="sm" onClick={seeAll}>
            {labels.seeAll}
          </Button>
        </div>
      ) : null}

      {phase === 'paging' && rows.length > 0 ? (
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!failed && !loading}
          onLoadMore={loadPage}
          skeleton={<OwnerListRowSkeleton layout={layout} />}
        />
      ) : null}

      {phase === 'paging' && loading && rows.length === 0 ? (
        <OwnerListRowSkeleton layout={layout} />
      ) : null}

      {failed ? (
        <div
          role="alert"
          data-owner-list-error
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        >
          <p className="text-text-secondary">{labels.error}</p>
          <button
            type="button"
            onClick={() => void loadPage()}
            className="font-bold text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {labels.retry}
          </button>
        </div>
      ) : null}
    </>
  );
}
