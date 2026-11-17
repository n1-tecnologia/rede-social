'use client';

import {
  Button,
  buttonClasses,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  SectionTitle,
} from '@rede-social/ui';
import { MessageCircle, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import type { CaseCardView, MyCasesPageView } from '@/lib/chat-view';
import { loadMoreMyCasesAction } from '../actions';
import { CaseCard, CaseCardSkeleton } from './CaseCard';

export interface MyCasesListProps {
  /** Page 1, formatted by the server in the tenant clock; `null` when the server could not read it. */
  initial: MyCasesPageView | null;
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle className="flex items-baseline justify-between gap-2 text-sm">
        <span>{title}</span>
        <span className="text-xs font-normal normal-case tracking-normal text-text-tertiary">
          {count}
        </span>
      </SectionTitle>
      {children}
    </section>
  );
}

/**
 * The member's "Meus chamados" list (CASE-14, UI-D-821, UI-D-832, D-803) [designed]: "Chamado atual"
 * (only when there is an active case, at most one) and "Anteriores" (only when there is a closed one,
 * newest first), each headed by the shipped `SectionTitle` with its count at the right.
 *
 * - **Paging:** `InfiniteScroll` by keyset through `loadMoreMyCasesAction(cursor)`; the answer's `items`
 *   are APPENDED (a card already on screen is not repeated) and its `current` and `total` are ignored, so a
 *   load-more never moves the sections. A failed page keeps the rows and shows the inline retry line.
 * - **Refresh:** `PullToRefresh` (the phone) asks the same action for page 1 with a NULL cursor, whose
 *   answer carries `current`, `items` and `total`, and REPLACES all three (W11). A refresh that fails keeps
 *   what is on screen. A page that was in flight when the list was refreshed is dropped (the generation
 *   guard), so a stale page can never land on the new list.
 * - **States:** a first read that failed shows the shipped error card with "Tentar novamente" (the retry is
 *   the same page-1 ask); a member with no case at all sees the empty state with "Falar com a equipe", not
 *   a redirect.
 */
export function MyCasesList({ initial }: MyCasesListProps) {
  const t = useTranslations('chat');
  const te = useTranslations('app.error');

  const [current, setCurrent] = useState<CaseCardView | null>(initial?.current ?? null);
  const [items, setItems] = useState<CaseCardView[]>(initial?.items ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [firstLoadFailed, setFirstLoadFailed] = useState(initial === null);
  const [pageFailed, setPageFailed] = useState(false);

  /** Bumped by every page-1 ask, so a page requested before it cannot land on the replaced list. */
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    try {
      const page = await loadMoreMyCasesAction(null);
      if (generation.current !== mine) return;
      if (!page.ok) return;
      setCurrent(page.current);
      setItems(page.items);
      setTotal(page.total);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('chat.my_cases_refresh_failed', { error: String(error) });
    }
  }, []);

  /** APPEND the next keyset page; a card already on screen is not repeated. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const mine = generation.current;
    try {
      const page = await loadMoreMyCasesAction(cursor);
      if (generation.current !== mine) return;
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      setItems((existing) => {
        const ids = new Set(existing.map((card) => card.id));
        return [...existing, ...page.items.filter((card) => !ids.has(card.id))];
      });
      setCursor(page.nextCursor);
    } catch (error) {
      if (generation.current !== mine) return;
      console.error('chat.my_cases_load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor]);

  /** Re-arms the sentinel (which is on screen) rather than fetching, so one tap loads one page. */
  const retryPage = useCallback(() => setPageFailed(false), []);

  if (firstLoadFailed && current === null && items.length === 0) {
    return (
      <div className="px-4 pt-4">
        <EmptyState
          variant="card"
          icon={TriangleAlert}
          data-my-cases-error
          title={t('mine.errors.load.title')}
          body={t('mine.errors.load.body')}
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              {te('retry')}
            </Button>
          }
        />
      </div>
    );
  }

  if (current === null && items.length === 0) {
    return (
      <PullToRefresh onRefresh={refresh}>
        <div className="px-4 pt-4">
          <EmptyState
            variant="card"
            icon={MessageCircle}
            data-my-cases-empty
            title={t('mine.empty.title')}
            body={t('mine.empty.body')}
            action={
              <Link href="/suporte" className={buttonClasses({ variant: 'brand', size: 'md' })}>
                {t('mine.empty.cta')}
              </Link>
            }
          />
        </div>
      </PullToRefresh>
    );
  }

  const previousCount = Math.max(total - (current ? 1 : 0), items.length);

  return (
    <PullToRefresh onRefresh={refresh}>
      <div data-my-cases className="flex flex-col gap-6 px-4 pb-6 pt-2">
        {current ? (
          <Section title={t('mine.current')} count={1}>
            <CaseCard card={current} />
          </Section>
        ) : null}

        {items.length > 0 ? (
          <Section title={t('mine.previous')} count={previousCount}>
            <ul className="flex flex-col gap-2">
              {items.map((card) => (
                <li key={card.id}>
                  <CaseCard card={card} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<CaseCardSkeleton count={1} />}
        />

        {pageFailed ? (
          <div
            data-my-cases-page-error
            className="flex flex-col items-center gap-3 py-2 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('mine.errors.more')}</p>
            <Button variant="outline" onClick={retryPage}>
              {te('retry')}
            </Button>
          </div>
        ) : null}
      </div>
    </PullToRefresh>
  );
}
