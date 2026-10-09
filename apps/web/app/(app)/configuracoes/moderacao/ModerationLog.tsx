'use client';

import type { ModerationAction } from '@rede-social/contracts/moderation';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  useToast,
} from '@rede-social/ui';
import { CircleAlert, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { ModerationLogRow, ModerationLogSkeleton } from '@/components/admin/ModerationLogRow';
import { MODERATION_LOG_FILTERS, type ModerationLogRowView } from '@/lib/moderation-view';
import { loadMoreModerationLogAction } from './actions';

export interface ModerationLogProps {
  /** Page 1 for the URL's `?acao=`, already formatted on the server (sentences, tenant-zone times). */
  initialItems: ModerationLogRowView[];
  initialCursor: string | null;
  /** The URL's `?acao=`, normalised by the page: an unknown value is `null` ("Tudo"). */
  acao: ModerationAction | null;
  /** `true` when the server could not read page 1 at all (UI-D-283 first-load failure). */
  initialError?: boolean;
}

/** The canonical URL for a chip — the API's own action value, or the bare route for "Tudo". */
function logUrl(action: ModerationAction | null): string {
  if (action === null) return '/configuracoes/moderacao';
  return `/configuracoes/moderacao?${new URLSearchParams({ acao: action }).toString()}`;
}

/**
 * The Moderação list (MODER-03, D-337, UI-D-277, UI-D-283) — READ-ONLY by design: rows are not
 * links and carry no action; there is no export, edit or delete anywhere on the screen.
 *
 * - **The URL is the filter.** The chip row is bound to `?acao=` through `router.replace` inside a
 *   transition (the `/membros` rule); while it is pending the list shows 6 row skeletons. The server
 *   renders page 1 for the new value and this component RE-SEEDS from it during render (React's
 *   documented alternative to an effect), so the previous filter's rows never paint under the new
 *   chip.
 * - **Keyset paging through `InfiniteScroll`.** A page APPENDS; nothing on screen moves. A
 *   GENERATION guard drops a page that started before a chip change or a pull-to-refresh replaced
 *   the list: appending it (and adopting its cursor) would mix two filters or skip rows.
 * - **Failures.** A first-load failure is the card `EmptyState` with a retry; a load-more failure is
 *   an inline line plus a retry, with every loaded row kept. A 403 (the permission was lost in
 *   another tab) toasts and refreshes (UI-D-284), and the refreshed page answers `notFound()`.
 *
 * No clock and no date formatting here: every row arrives finished from the server.
 */
export function ModerationLog({
  initialItems,
  initialCursor,
  acao,
  initialError,
}: ModerationLogProps) {
  const t = useTranslations('moderation.log');
  const router = useRouter();
  const { show } = useToast();
  const [navigating, startNavigation] = useTransition();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [firstLoadFailed, setFirstLoadFailed] = useState(Boolean(initialError));
  const [pageFailed, setPageFailed] = useState(false);

  /**
   * Bumped whenever the list is REPLACED (a new filter's page 1, a refresh). A load-more captures
   * the value it started under and drops its page when the committed value has moved on.
   */
  const [generation, setGeneration] = useState(0);
  const committedGeneration = useRef(0);
  useLayoutEffect(() => {
    committedGeneration.current = generation;
  }, [generation]);

  // The server answered a NEW `?acao=` (or a refresh): re-seed from its page 1 during render.
  const [seededAcao, setSeededAcao] = useState(acao);
  const [seededItems, setSeededItems] = useState(initialItems);
  if (seededAcao !== acao || seededItems !== initialItems) {
    setGeneration((value) => value + 1);
    setSeededAcao(acao);
    setSeededItems(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFirstLoadFailed(Boolean(initialError));
    setPageFailed(false);
  }

  const forbidden = useCallback(() => {
    show({ tone: 'error', message: t('errors.forbidden') });
    router.refresh();
  }, [router, show, t]);

  const choose = (action: ModerationAction | null) => {
    if (action === acao) return;
    startNavigation(() => {
      router.replace(logUrl(action), { scroll: false });
    });
  };

  const loadMore = useCallback(async () => {
    if (cursor === null) return;
    const mine = generation;
    const stale = () => committedGeneration.current !== mine;
    try {
      const page = await loadMoreModerationLogAction(cursor, acao);
      if (stale()) return;
      if (!page.ok) {
        if (page.code === 'forbidden') forbidden();
        setPageFailed(true);
        return;
      }
      setItems((previous) => {
        // A row already on screen is never drawn twice (keyset pages cannot overlap, but a page
        // racing a refresh could; the generation guard catches that, this is the belt).
        const held = new Set(previous.map((row) => row.id));
        return [...previous, ...page.items.filter((row) => !held.has(row.id))];
      });
      setCursor(page.nextCursor);
      setPageFailed(false);
    } catch (error) {
      if (stale()) return;
      console.error('moderation.log.load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [acao, cursor, forbidden, generation]);

  /** Page 1 again for the current chip — what the pull calls. */
  const refresh = useCallback(async () => {
    try {
      const page = await loadMoreModerationLogAction(null, acao);
      if (!page.ok) {
        if (page.code === 'forbidden') forbidden();
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setGeneration((value) => value + 1);
      setItems(page.items);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('moderation.log.refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [acao, forbidden, items.length]);

  /** Re-arms the sentinel (which is on screen) rather than fetching, so one tap loads one page. */
  const retryPage = useCallback(() => setPageFailed(false), []);
  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  let body: ReactNode;
  if (navigating) {
    body = <ModerationLogSkeleton count={6} />;
  } else if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4 md:px-0">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={t('errors.title')}
          body={t('errors.generic')}
          action={
            <Button variant="outline" onClick={retryFirst}>
              {t('errors.retry')}
            </Button>
          }
        />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="px-4 md:px-0" data-moderation-log-empty={acao === null ? 'all' : 'filtered'}>
        <EmptyState
          variant="card"
          icon={ShieldCheck}
          title={acao === null ? t('empty.title') : t('filteredEmpty.title')}
          body={acao === null ? t('empty.body') : t('filteredEmpty.body')}
        />
      </div>
    );
  } else {
    body = (
      <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
        <ol aria-label={t('label')} data-moderation-log>
          {items.map((view) => (
            <ModerationLogRow key={view.id} view={view} />
          ))}
        </ol>
        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<ModerationLogSkeleton count={3} />}
        />
        {pageFailed ? (
          <div
            data-moderation-log-page-error
            className="flex flex-col items-center gap-3 px-4 py-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('errors.loadMore')}</p>
            <Button variant="outline" onClick={retryPage}>
              {t('errors.retry')}
            </Button>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="px-4 text-xs font-normal text-text-tertiary md:px-0">{t('permanent')}</p>
        {/* UI-D-277: five chips that scroll sideways at 320px and never wrap, with no scrollbar
            drawn over them (2026-10-09). */}
        <div
          data-moderation-log-filters
          className="mt-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {MODERATION_LOG_FILTERS.map((filter) => (
            <Chip
              key={filter.key}
              active={filter.action === acao}
              onClick={() => choose(filter.action)}
            >
              {t(`filters.${filter.key}`)}
            </Chip>
          ))}
        </div>
      </div>
      <PullToRefresh onRefresh={refresh}>{body}</PullToRefresh>
    </div>
  );
}
