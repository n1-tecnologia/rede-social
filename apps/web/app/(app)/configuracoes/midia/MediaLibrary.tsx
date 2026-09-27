'use client';

import type { MediaAsset } from '@tria/contracts/media';
import {
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  useMediaQuery,
  useToast,
} from '@tria/ui';
import { CircleAlert, Film } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { MediaAssetRow } from '@/components/media/MediaAssetRow';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { VideoUploadField } from '@/components/media/VideoUploadField';
import { loadMoreAssetsAction, removeAssetAction } from './actions';

/** UI-SPEC §Admin media step 4: re-fetch every 5 s while anything is processing… */
const POLL_INTERVAL_MS = 5_000;
/** …for at most 5 minutes, then stop and offer "Atualizar". Realtime status push is Phase 7. */
const POLL_CEILING_MS = 5 * 60 * 1000;

/** The two statuses that can still change on their own. */
function isPending(asset: MediaAsset): boolean {
  return asset.status === 'pending' || asset.status === 'processing';
}

/** Three rows (E6/loading) — the directory's eight, at the size this list actually opens at. */
const SKELETON_ROWS = [0, 1, 2];

/**
 * The library's loading shape, shared with `loading.tsx` so the route-level shell and any in-page
 * load look identical — the same rule `MembersSkeleton` follows for the directory (03-05). The
 * vocabulary is the row's: a `w-24 aspect-video` thumbnail block and two text bars, never a spinner.
 */
export function MediaLibrarySkeleton() {
  return (
    <div aria-busy data-testid="media-skeleton" className="flex flex-col">
      {SKELETON_ROWS.map((index) => (
        <div
          key={index}
          className="flex min-h-14 items-center gap-3 border-b border-divider px-4 py-3 last:border-0"
        >
          <Skeleton variant="rect" className="w-24 shrink-0 rounded-lg aspect-video" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" width="55%" className="h-3.5" />
            <Skeleton variant="text" width="35%" className="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface MediaLibraryProps {
  /** The first page the SERVER rendered — the list is seeded from it. */
  initialItems: MediaAsset[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all. */
  initialError?: boolean;
  /** `bootstrap.tenant.timezone`, forwarded to every row's date (06-09). */
  timeZone: string;
}

/**
 * The admin media library's body (MEDIA-03, UI-SPEC §Admin media, E6).
 *
 * **Pagination is keyset** (R-11), the SAME contract the member directory uses: "Carregar mais"
 * renders exactly while the API returned a non-null `nextCursor`, appends the next page without
 * re-ordering or replacing anything already rendered, and keeps the existing rows visible while it
 * is pending. There is no infinite scroll.
 *
 * **The refresh rule is bounded by construction** (T-03-50): the poll exists only while a row can
 * still change, it stops after five minutes whatever happens, and it then hands the member an
 * explicit "Atualizar" instead of burning a phone's battery on a transcode that is never coming.
 * Phase 7 replaces the poll with a Broadcast subscription; the row-state contract does not change.
 *
 * Nothing here offers "pick an existing asset" — that reuse surface belongs to Phase 4's composer
 * and is explicitly deferred (CONTEXT §Deferred Ideas).
 */
export function MediaLibrary({
  initialItems,
  initialCursor,
  initialError,
  timeZone,
}: MediaLibraryProps) {
  const t = useTranslations('media');
  const toast = useToast();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [failed, setFailed] = useState(Boolean(initialError));
  const [loadingMore, startLoadMore] = useTransition();

  const [playing, setPlaying] = useState<MediaAsset | null>(null);
  const [confirming, setConfirming] = useState<MediaAsset | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pollExhausted, setPollExhausted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  /** Ids already announced as ready, so a re-render never repeats "Vídeo pronto.". */
  const announced = useRef<Set<string>>(new Set(initialItems.filter(readyish).map((a) => a.id)));

  const pending = items.some(isPending);

  /**
   * Re-reads the FIRST page and merges it over what is on screen: a status flip must be visible
   * without discarding pages the member already loaded, and the appended pages stay where they are.
   */
  const refreshFirstPage = useCallback(async () => {
    const page = await loadMoreAssetsAction();
    if (!page.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setItems((prev) => {
      const fresh = new Map(page.items.map((asset) => [asset.id, asset]));
      const merged = prev.map((asset) => fresh.get(asset.id) ?? asset);
      const known = new Set(merged.map((asset) => asset.id));
      // Anything the first page knows that the screen does not is NEW: it goes on top, newest first.
      const added = page.items.filter((asset) => !known.has(asset.id));
      const next = [...added, ...merged];

      // Each transition INTO ready is announced once, by id — never on every poll tick.
      const freshlyReady = next.filter((a) => a.status === 'ready' && !announced.current.has(a.id));
      for (const asset of next) if (readyish(asset)) announced.current.add(asset.id);
      if (freshlyReady.length > 0) setAnnouncement(t('player.ready'));

      return next;
    });
  }, [t]);

  // The bounded poll. It is armed only while something can still change, and the ceiling is measured
  // from the moment the polling started rather than from mount, so a video uploaded ten minutes into
  // a session still gets its own five minutes.
  useEffect(() => {
    if (!pending || pollExhausted) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      // The elapsed check runs BEFORE the re-fetch, so a Playwright `clock.fastForward` over the
      // ceiling costs a handful of cheap no-ops rather than seventy network round trips — which is
      // also why the e2e needs NO test-only override shipped in the component.
      if (Date.now() - startedAt >= POLL_CEILING_MS) {
        setPollExhausted(true);
        return;
      }
      void refreshFirstPage();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pending, pollExhausted, refreshFirstPage]);

  const manualRefresh = async () => {
    setRefreshing(true);
    try {
      setPollExhausted(false);
      await refreshFirstPage();
    } finally {
      setRefreshing(false);
    }
  };

  const loadMore = () => {
    if (!cursor) return;
    const from = cursor;
    startLoadMore(async () => {
      try {
        const page = await loadMoreAssetsAction(from);
        if (!page.ok) {
          setFailed(true);
          return;
        }
        setFailed(false);
        // APPEND: the rows already on screen keep their order and their DOM position.
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      } catch (error) {
        console.error('media.load_more_failed', { error: String(error) });
        setFailed(true);
      }
    });
  };

  const remove = async () => {
    const asset = confirming;
    if (!asset) return;
    const result = await removeAssetAction(asset.id);
    if (!result.ok) {
      toast.show({ tone: 'error', message: t('errors.generic') });
      return;
    }
    setItems((prev) => prev.filter((row) => row.id !== asset.id));
    if (playing?.id === asset.id) setPlaying(null);
    toast.show({ tone: 'success', message: t('toasts.videoRemoved') });
  };

  const errorState = (
    <EmptyState
      variant="card"
      icon={CircleAlert}
      title={t('errors.generic')}
      action={
        <Button variant="outline" onClick={() => void manualRefresh()}>
          {t('retry')}
        </Button>
      }
    />
  );

  let list: ReactNode;
  if (failed && items.length === 0) {
    list = errorState;
  } else if (items.length === 0) {
    list = (
      <EmptyState
        variant="card"
        icon={Film}
        title={t('library.empty.title')}
        body={t('library.empty.body')}
      />
    );
  } else {
    list = (
      <>
        <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
          <ul className="flex flex-col">
            {items.map((asset, index) => (
              <li
                key={asset.id}
                className={index === items.length - 1 ? undefined : 'border-b border-divider'}
              >
                <MediaAssetRow asset={asset} onOpen={setPlaying} timeZone={timeZone} />
                {asset.status === 'failed' || asset.status === 'rejected' ? (
                  <div className="px-4 pb-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => setConfirming(asset)}
                    >
                      {t('library.remove')}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>

        {failed ? <div className="mt-4">{errorState}</div> : null}

        {pollExhausted && pending ? (
          <div className="mt-4 px-4 md:px-0">
            <Button
              variant="outline"
              fullWidth
              loading={refreshing}
              onClick={() => void manualRefresh()}
            >
              {t('library.refresh')}
            </Button>
          </div>
        ) : null}

        {!failed && cursor !== null ? (
          <div className="mt-4 px-4 md:px-0">
            <Button variant="outline" fullWidth loading={loadingMore} onClick={loadMore}>
              {loadingMore ? t('library.loadingMore') : t('library.loadMore')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="media-library" data-polling={pending}>
      <VideoUploadField onUploaded={() => void refreshFirstPage()} />

      {list}

      {/* One announcement per row that reaches `ready` — the flip is the news, not the poll. */}
      <p aria-live="polite" data-testid="media-live" className="sr-only">
        {announcement}
      </p>

      <BottomSheet
        open={playing !== null}
        onClose={() => setPlaying(null)}
        title={playing?.filename ?? t('library.title')}
        desktopCard={isDesktop}
        className={isDesktop ? 'max-w-[680px]' : undefined}
      >
        {playing ? <VideoPlayer assetId={playing.id} status={playing.status} /> : null}
      </BottomSheet>

      <ConfirmDialog
        open={confirming !== null}
        tone="danger"
        title={t('confirm.removeVideo.title')}
        body={t('confirm.removeVideo.body')}
        confirmLabel={t('confirm.removeVideo.confirm')}
        cancelLabel={t('confirm.removeVideo.cancel')}
        onConfirm={remove}
        onClose={() => setConfirming(null)}
        onError={(error) => {
          console.error('media.remove_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('errors.generic') });
        }}
      />
    </div>
  );
}

/** Already in a terminal-or-ready state on first paint: never announced as "freshly" ready. */
function readyish(asset: MediaAsset): boolean {
  return !isPending(asset);
}
