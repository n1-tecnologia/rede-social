'use client';

import type { ReportListState, ReportResolveAction } from '@rede-social/contracts/moderation';
import {
  Button,
  buttonClasses,
  Card,
  Chip,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  Skeleton,
  StatusPill,
  useToast,
} from '@rede-social/ui';
import { ChevronRight, CircleAlert, Flag } from 'lucide-react';
import Link from 'next/link';
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
import type { ReportQueueRow } from '@/lib/reports';
import { loadMoreReportsAction, resolveReport } from './actions';
import { DirectMessageReportRow } from './DirectMessageReportRow';
import { ResolveSheet } from './ResolveSheet';

export interface ReportsQueueProps {
  /** Page 1 for the URL's `?estado=`, already finished on the server (pills, bodies, resolve rows, tenant-zone dates). */
  initialItems: ReportQueueRow[];
  initialCursor: string | null;
  /** The URL's `?estado=`, normalised by the page: anything unknown is `abertas`. */
  estado: ReportListState;
  /** `true` when the server could not read page 1 at all. */
  initialError?: boolean;
  /** Interpolated into the author block step's body. */
  tenantName: string;
}

/** The three chips, in the order UI-D-637 draws them. */
const FILTERS: { key: 'open' | 'resolved' | 'all'; estado: ReportListState }[] = [
  { key: 'open', estado: 'abertas' },
  { key: 'resolved', estado: 'resolvidas' },
  { key: 'all', estado: 'todas' },
];

/** The canonical URL of a chip: the bare route for the default, else the API's own `estado`. */
function queueUrl(estado: ReportListState): string {
  if (estado === 'abertas') return '/configuracoes/denuncias';
  return `/configuracoes/denuncias?${new URLSearchParams({ estado }).toString()}`;
}

/**
 * The media path a reported recording asks for on the player's first tap (D-731): the route every voice bubble uses.
 * The gate behind it answers 404 for anyone who is neither a participant nor a reader of the report that carries the
 * asset, so the screen never decides who may hear it (UI-D-881).
 */
export function reportVoiceSrc(mediaId: string): string {
  return `/v1/media/${mediaId}/original`;
}

const SKELETON_KEYS = ['one', 'two', 'three', 'four', 'five', 'six'] as const;

/** One row's loading shape: the pill line, a body, the meta line and the action; a voice row adds the 56px bar. */
export function ReportsQueueSkeleton({ count, voice = true }: { count: number; voice?: boolean }) {
  return (
    <div aria-hidden data-reports-skeleton className="flex flex-col gap-3 px-4 md:px-0">
      {SKELETON_KEYS.slice(0, count).map((key, index) => (
        <Card key={key} className="flex flex-col gap-2 p-4">
          <div className="flex gap-2">
            <Skeleton variant="rect" width={88} className="h-6 rounded-full" />
            <Skeleton variant="rect" width={64} className="h-6 rounded-full" />
          </div>
          {voice && index === 1 ? (
            <Skeleton
              variant="rect"
              data-reports-skeleton-voice
              className="h-14 w-70 max-w-full rounded-2xl"
            />
          ) : (
            <>
              <Skeleton variant="text" width="92%" className="h-4" />
              <Skeleton variant="text" width="64%" className="h-4" />
            </>
          )}
          <Skeleton variant="text" width="70%" className="h-3" />
          <div className="flex justify-end gap-2">
            <Skeleton variant="rect" width={96} className="h-9 rounded-xl" />
            <Skeleton variant="rect" width={84} className="h-9 rounded-xl" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** The body of a row by subject (UI-D-873). React text everywhere; a blank body is not drawn at all. */
function RowBody({ row }: { row: ReportQueueRow }) {
  const body = row.body;
  switch (body.kind) {
    case 'text':
    case 'story':
      return body.text === '' ? null : (
        <p data-report-body className="line-clamp-3 break-words text-sm font-normal text-text">
          {body.text}
        </p>
      );
    case 'community':
      return body.name === '' && body.description === '' ? null : (
        <div data-report-body className="flex min-w-0 flex-col gap-1">
          {body.name === '' ? null : (
            <p className="line-clamp-1 break-words text-sm font-bold text-text">{body.name}</p>
          )}
          {body.description === '' ? null : (
            <p className="line-clamp-2 break-words text-sm font-normal text-text">
              {body.description}
            </p>
          )}
        </div>
      );
    case 'message':
    case 'voice':
    case 'voiceGone':
      return <DirectMessageReportRow body={body} mediaSrc={reportVoiceSrc} />;
    case 'unavailable':
      return (
        <p data-report-body className="break-words text-sm font-normal text-text-tertiary">
          {body.text}
        </p>
      );
    default: {
      const unreachable: never = body;
      throw new Error(`unknown report body: ${String((unreachable as { kind: string }).kind)}`);
    }
  }
}

function ReportRow({ row, onResolve }: { row: ReportQueueRow; onResolve: () => void }) {
  const t = useTranslations('safety.queue');
  return (
    <li data-report-row={row.id} data-report-subject={row.subjectType} data-report-open={row.open}>
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="neutral">{row.typePill}</StatusPill>
          <StatusPill tone={row.statePill.tone}>{row.statePill.label}</StatusPill>
        </div>
        <RowBody row={row} />
        <p className="break-words text-xs font-normal text-text-tertiary">{row.meta}</p>
        <p className="break-words text-xs font-normal text-text-secondary">
          {t('author', { nome: row.author })}
        </p>
        {row.viewHref !== null || row.open ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {row.viewHref !== null ? (
              <Link
                href={row.viewHref}
                data-report-view
                className={buttonClasses({
                  variant: 'ghost',
                  size: 'sm',
                  hitArea: true,
                  className: 'text-text',
                })}
              >
                {row.viewLabel}
                <ChevronRight aria-hidden size={16} />
              </Link>
            ) : null}
            {row.open ? (
              <Button data-report-resolve variant="outline" size="sm" hitArea onClick={onResolve}>
                {t('resolve')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </li>
  );
}

/**
 * The administrator's report queue (MODER-04, MODER-05, D-616, D-731, D-732, UI-D-637, UI-D-873, UI-D-874), for six
 * subjects. It never decides anything: the API lists, the API resolves, and each row arrives finished.
 *
 * - **The URL is the filter.** The three chips ("Abertas" by default, "Resolvidas", "Todas") are bound to `?estado=`
 *   through `router.replace` in a transition, the `moderacao` rule; the server renders page 1 for the new value and
 *   this component RE-SEEDS from it during render, so the previous filter's rows never paint under the new chip. There
 *   is NO filter by subject (A-UI-14).
 * - **Keyset paging by 20 through `InfiniteScroll`.** A page APPENDS and nothing on screen moves; a generation guard
 *   drops a page that started before a chip change or a refresh replaced the list, so it can never repeat or skip a row.
 *   A failed page keeps every loaded row, shows an inline retry and stands the sentinel down.
 * - **Resolving.** "Resolver" opens the sheet; a success updates THAT row in place (its state pill, no "Resolver"),
 *   toasts "Denúncia resolvida." and reorders nothing. One request per report at a time (a double tap is one). A report
 *   another administrator resolved first answers 409: the row stops offering "Resolver", the toast says so and the
 *   page refreshes from the server. A refusal that leaves the report open (`not_removable`, `author_unavailable`, a
 *   failure) is the shipped error toast and the row stays.
 * - Nothing here notifies anyone: the author, the reporter and the reported member are never told of an outcome.
 */
export function ReportsQueue({
  initialItems,
  initialCursor,
  estado,
  initialError,
  tenantName,
}: ReportsQueueProps) {
  const t = useTranslations('safety.queue');
  const tl = useTranslations('moderation.log');
  const tmm = useTranslations('moderation.member');
  const router = useRouter();
  const { show } = useToast();
  const [navigating, startNavigation] = useTransition();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [firstLoadFailed, setFirstLoadFailed] = useState(Boolean(initialError));
  const [pageFailed, setPageFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  /** Bumped whenever the list is REPLACED (a new filter's page 1, a refresh); a stale page is dropped. */
  const [generation, setGeneration] = useState(0);
  const committedGeneration = useRef(0);
  useLayoutEffect(() => {
    committedGeneration.current = generation;
  }, [generation]);

  // The server answered a NEW `?estado=` (or a refresh): re-seed from its page 1 during render.
  const [seededEstado, setSeededEstado] = useState(estado);
  const [seededItems, setSeededItems] = useState(initialItems);
  if (seededEstado !== estado || seededItems !== initialItems) {
    setGeneration((value) => value + 1);
    setSeededEstado(estado);
    setSeededItems(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFirstLoadFailed(Boolean(initialError));
    setPageFailed(false);
  }

  const inFlight = useRef(new Set<string>());

  const forbidden = useCallback(() => {
    show({ tone: 'error', message: tl('errors.forbidden') });
    router.refresh();
  }, [router, show, tl]);

  const choose = (next: ReportListState) => {
    if (next === estado) return;
    startNavigation(() => {
      router.replace(queueUrl(next), { scroll: false });
    });
  };

  const loadMore = useCallback(async () => {
    if (cursor === null) return;
    const mine = generation;
    const stale = () => committedGeneration.current !== mine;
    try {
      const page = await loadMoreReportsAction(cursor, estado);
      if (stale()) return;
      if (!page.ok) {
        if (page.code === 'forbidden') forbidden();
        setPageFailed(true);
        return;
      }
      setItems((previous) => {
        // A row already on screen is never drawn twice (keyset pages cannot overlap; this is the belt).
        const held = new Set(previous.map((row) => row.id));
        return [...previous, ...page.items.filter((row) => !held.has(row.id))];
      });
      setCursor(page.nextCursor);
      setPageFailed(false);
    } catch (error) {
      if (stale()) return;
      console.error('reports.queue.load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor, estado, forbidden, generation]);

  /** Page 1 again for the current chip: what the pull calls. */
  const refresh = useCallback(async () => {
    try {
      const page = await loadMoreReportsAction(null, estado);
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
      console.error('reports.queue.refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [estado, forbidden, items.length]);

  const retryPage = useCallback(() => setPageFailed(false), []);
  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  /** The row after a resolution landed: no "Resolver", no legal rows, the pill the resolution leaves. */
  const settleRow = useCallback((id: string, resolution: ReportResolveAction | null) => {
    setItems((previous) =>
      previous.map((row) =>
        row.id === id
          ? {
              ...row,
              open: false,
              statePill: resolution === null ? row.statePill : row.outcome[resolution],
              resolve: { rows: [], helper: null },
            }
          : row,
      ),
    );
  }, []);

  const resolve = useCallback(
    async (row: ReportQueueRow, resolution: ReportResolveAction, reason?: string) => {
      // One request per report at a time: a second tap in the same frame is a no-op.
      if (inFlight.current.has(row.id)) return;
      inFlight.current.add(row.id);
      let result: Awaited<ReturnType<typeof resolveReport>>;
      try {
        result = await resolveReport(row.id, resolution, reason);
      } catch (error) {
        console.error('reports.queue.resolve_failed', { error: String(error) });
        result = { ok: false, code: 'failed' };
      } finally {
        inFlight.current.delete(row.id);
      }

      if (result.ok) {
        settleRow(row.id, resolution);
        show({ tone: 'success', message: t('toasts.resolved') });
        setSheetOpen(false);
        return;
      }
      switch (result.code) {
        case 'already_resolved':
          // Another administrator got there first: the row stops offering "Resolver" now and the page refreshes.
          settleRow(row.id, null);
          show({ tone: 'success', message: t('toasts.alreadyResolved') });
          setSheetOpen(false);
          router.refresh();
          return;
        case 'unauthenticated':
          show({ tone: 'error', message: tl('errors.forbidden') });
          setSheetOpen(false);
          router.refresh();
          return;
        default:
          // `not_removable`, `author_unavailable` and a plain failure: the shipped toast, the report stays open.
          show({ tone: 'error', message: tmm('errors.generic') });
      }
    },
    [router, settleRow, show, t, tl, tmm],
  );

  const selected = items.find((row) => row.id === selectedId) ?? null;

  let body: ReactNode;
  if (navigating) {
    body = <ReportsQueueSkeleton count={4} />;
  } else if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4 md:px-0" data-reports-error>
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={tl('errors.title')}
          body={tl('errors.generic')}
          action={
            <Button variant="outline" onClick={retryFirst}>
              {tl('errors.retry')}
            </Button>
          }
        />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="px-4 md:px-0" data-reports-empty={estado}>
        <EmptyState variant="card" icon={Flag} title={t('empty.title')} body={t('empty.body')} />
      </div>
    );
  } else {
    body = (
      <>
        <ol aria-label={t('title')} data-reports-list className="flex flex-col gap-3 px-4 md:px-0">
          {items.map((row) => (
            <ReportRow
              key={row.id}
              row={row}
              onResolve={() => {
                setSelectedId(row.id);
                setSheetOpen(true);
              }}
            />
          ))}
        </ol>
        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<ReportsQueueSkeleton count={2} voice={false} />}
        />
        {pageFailed ? (
          <div
            data-reports-page-error
            className="flex flex-col items-center gap-3 px-4 py-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{tl('errors.generic')}</p>
            <Button variant="outline" onClick={retryPage}>
              {tl('errors.retry')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        data-reports-filters
        className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {FILTERS.map((filter) => (
          <Chip
            key={filter.key}
            active={filter.estado === estado}
            onClick={() => choose(filter.estado)}
          >
            {t(`filter.${filter.key}`)}
          </Chip>
        ))}
      </div>
      <PullToRefresh onRefresh={refresh}>{body}</PullToRefresh>
      <ResolveSheet
        row={selected}
        open={sheetOpen && selected !== null}
        onClose={closeSheet}
        tenantName={tenantName}
        onResolve={resolve}
      />
    </div>
  );
}
