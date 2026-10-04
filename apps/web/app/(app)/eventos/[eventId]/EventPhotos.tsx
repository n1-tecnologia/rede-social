'use client';

import { mediaAcceptFor } from '@rede-social/contracts/media';
import type { EventPhoto } from '@rede-social/module-events/contracts';
import { EventPhotoGrid, EventPhotoViewer } from '@rede-social/module-events/ui';
import { Button, Card, ConfirmDialog, SectionTitle, useToast } from '@rede-social/ui';
import { ImagePlus, Images, Loader2, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, type ReactNode, useId, useRef, useState } from 'react';
import {
  type AssetStatusResult,
  fetchAssetStatusAction,
} from '@/app/(app)/configuracoes/midia/actions';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import { addEventPhotoAction, loadEventPhotosAction, removeEventPhotoAction } from '../actions';

export interface EventPhotosProps {
  eventId: string;
  /** The event's title, for each photo's alternative text and the viewer's name. */
  eventTitle: string;
  /** The composed `events.event.manage` permission: "Adicionar fotos" and the remove buttons. */
  canManage: boolean;
  /** The first page the SERVER read; this island owns every page after it. */
  initialItems: EventPhoto[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all. */
  initialError?: boolean;
}

const ACCEPT = mediaAcceptFor('image', 'post');

/**
 * The readiness wait between an upload and its add. `complete` leaves an image `processing` while
 * the worker derives its ladder (usually a second or two), and the API takes a photo only once it is
 * `ready`, so each upload is re-read on this backoff: 1 s, 1.5 s, 2.25 s… capped at 5 s, for at most
 * `PHOTO_READY_TIMEOUT_MS` in all. Timers only: no clock is read.
 */
export const PHOTO_READY_FIRST_DELAY_MS = 1_000;
export const PHOTO_READY_MAX_DELAY_MS = 5_000;
export const PHOTO_READY_TIMEOUT_MS = 90_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `true` once the asset is `ready`; `false` when it failed, vanished or took too long. */
async function waitUntilReady(assetId: string): Promise<boolean> {
  let delay = PHOTO_READY_FIRST_DELAY_MS;
  let waited = 0;
  while (waited < PHOTO_READY_TIMEOUT_MS) {
    await sleep(delay);
    waited += delay;
    let answer: AssetStatusResult;
    try {
      answer = await fetchAssetStatusAction(assetId);
    } catch {
      answer = { ok: false, code: 'generic' };
    }
    if (answer.ok) {
      if (answer.status === 'ready') return true;
      if (answer.status !== 'pending' && answer.status !== 'processing') return false;
    } else if (answer.code === 'notFound') {
      return false;
    }
    delay = Math.min(delay * 1.5, PHOTO_READY_MAX_DELAY_MS);
  }
  return false;
}

/** The first page as a value, so a server re-render with the SAME photos never resets the island. */
const seedKeyOf = (items: EventPhoto[], cursor: string | null, error: boolean) =>
  `${error ? 'error' : 'ok'}|${cursor ?? ''}|${items.map((photo) => photo.id).join(',')}`;

/**
 * The detail page's "Fotos" (2026-10-03, the REINE prototype): the 3-column grid
 * (`EventPhotoGrid`), the viewer (`EventPhotoViewer`) a tap opens, "Ver mais fotos" while the API
 * has more, and the empty state. Every member views; the composed `events.event.manage`
 * permission adds "Adicionar fotos" and a remove button per photo, behind a confirm.
 *
 * **Adding is the media pipeline, then one add per photo.** The admin picks several images; each
 * goes through `useSignedUpload` (`purpose: 'post'`: the browser uploads the bytes straight to the
 * signed target, never through a request body) one after the other, as the composer does. Each
 * completed upload is then waited on until its ladder is derived (`waitUntilReady`) and linked with
 * `addEventPhotoAction`; the answered photo is put at the top of the grid at once (newest first, the
 * API's own order). One toast closes the batch: how many were added, or how many failed.
 *
 * **Removing is confirmed** (the danger `ConfirmDialog`): the photo leaves the event for every
 * member and the API retires its asset. A photo another admin already removed counts as removed.
 *
 * **No clock, no formatted instant**: a photo carries none. The SERVER's first page seeds the
 * island and re-seeds it only when it changes (a pull, a navigation), never on a re-render that
 * brings the same photos back.
 */
export function EventPhotos({
  eventId,
  eventTitle,
  canManage,
  initialItems,
  initialCursor,
  initialError = false,
}: EventPhotosProps) {
  const t = useTranslations('events');
  const toast = useToast();
  const headingId = useId();

  const seedKey = seedKeyOf(initialItems, initialCursor, initialError);
  const [seed, setSeed] = useState(seedKey);
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadError, setLoadError] = useState(initialError);
  if (seed !== seedKey) {
    setSeed(seedKey);
    setItems(initialItems);
    setCursor(initialCursor);
    setLoadError(initialError);
  }
  // The latest list, for the async paths that must not read a stale render's value.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [removing, setRemoving] = useState<EventPhoto | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [batch, setBatch] = useState<{
    current: number;
    total: number;
    phase: 'uploading' | 'preparing';
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  /** The adds the current batch started, one per completed upload. */
  const attachments = useRef<Promise<boolean>[]>([]);

  /** Appends the next page, never a photo already on screen; answers how many were new. */
  const loadMore = async (): Promise<number> => {
    if (!cursor || loadingMore) return 0;
    setLoadingMore(true);
    setMoreError(false);
    let result: Awaited<ReturnType<typeof loadEventPhotosAction>>;
    try {
      result = await loadEventPhotosAction(eventId, cursor);
    } catch {
      result = { ok: false, code: 'generic' };
    }
    setLoadingMore(false);
    if (!result.ok) {
      setMoreError(true);
      return 0;
    }
    const seen = new Set(itemsRef.current.map((photo) => photo.id));
    const fresh = result.items.filter((photo) => !seen.has(photo.id));
    setItems((current) => [
      ...current,
      ...fresh.filter((photo) => !current.some((item) => item.id === photo.id)),
    ]);
    setCursor(result.nextCursor);
    return fresh.length;
  };

  /** The first-load retry: page 1 again. */
  const retry = async () => {
    let result: Awaited<ReturnType<typeof loadEventPhotosAction>>;
    try {
      result = await loadEventPhotosAction(eventId);
    } catch {
      result = { ok: false, code: 'generic' };
    }
    if (!result.ok) {
      toast.show({ tone: 'error', message: t('photos.errors.load') });
      return;
    }
    setItems(result.items);
    setCursor(result.nextCursor);
    setLoadError(false);
  };

  /** One completed upload: wait for its ladder, add it, and put the photo at the top. */
  const attach = async (assetId: string): Promise<boolean> => {
    if (!(await waitUntilReady(assetId))) return false;
    let result: Awaited<ReturnType<typeof addEventPhotoAction>>;
    try {
      result = await addEventPhotoAction(eventId, assetId);
    } catch {
      return false;
    }
    if (!result.ok) return false;
    const photo = result.photo;
    setItems((current) =>
      current.some((item) => item.id === photo.id) ? current : [photo, ...current],
    );
    return true;
  };

  const upload = useSignedUpload({
    kind: 'image',
    purpose: 'post',
    // One toast closes the whole batch instead (below).
    successKey: null,
    onCompleted: (asset) => {
      attachments.current.push(attach(asset.id));
    },
  });

  /** Several files, one hook: each `pick` resolves before the next starts (the composer's queue). */
  const addPhotos = async (files: File[]) => {
    if (files.length === 0 || batch !== null) return;
    attachments.current = [];
    for (const [index, file] of files.entries()) {
      setBatch({ current: index + 1, total: files.length, phase: 'uploading' });
      await upload.pick(file);
    }
    setBatch({ current: files.length, total: files.length, phase: 'preparing' });
    const outcomes = await Promise.all(attachments.current);
    attachments.current = [];
    setBatch(null);
    const added = outcomes.filter(Boolean).length;
    const failed = files.length - added;
    // One toast for the batch (a newer toast replaces the current one): the failures, when any.
    if (failed > 0) {
      toast.show({ tone: 'error', message: t('photos.errors.add', { count: failed }) });
    } else if (added > 0) {
      toast.show({ tone: 'success', message: t('toasts.photosAdded', { count: added }) });
    }
  };

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void addPhotos(files);
  };

  const confirmRemove = async () => {
    const target = removing;
    if (!target) return;
    setBusyIds((current) => new Set(current).add(target.id));
    const result = await removeEventPhotoAction(eventId, target.id);
    setBusyIds((current) => {
      const next = new Set(current);
      next.delete(target.id);
      return next;
    });
    if (!result.ok) {
      toast.show({ tone: 'error', message: t('photos.errors.remove') });
      return;
    }
    setItems((current) => current.filter((photo) => photo.id !== target.id));
    toast.show({ tone: 'success', message: t('toasts.photoRemoved') });
  };

  const total = items.length;
  const tiles = items.map((photo, index) => ({
    id: photo.id,
    assetId: photo.mediaAssetId,
    variantWidths: photo.variantWidths,
    openLabel: t('photos.open', { index: index + 1, total }),
    ...(canManage ? { removeLabel: t('photos.remove', { index: index + 1 }) } : {}),
  }));
  const viewerPhotos = items.map((photo, index) => ({
    id: photo.id,
    assetId: photo.mediaAssetId,
    variantWidths: photo.variantWidths,
    alt: t('photos.alt', { index: index + 1, title: eventTitle }),
  }));
  const busy = batch !== null;

  let body: ReactNode;
  if (loadError && total === 0) {
    body = (
      <Card data-testid="event-photos-error" className="mx-4 flex flex-col items-center px-6 py-6">
        <TriangleAlert aria-hidden size={22} className="mb-2 text-text-tertiary" />
        <p className="text-center text-sm text-text-secondary">{t('photos.errors.load')}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void retry()}>
          {t('errors.retry')}
        </Button>
      </Card>
    );
  } else if (total === 0) {
    body = (
      <Card
        data-testid="event-photos-empty"
        className="mx-4 flex flex-col items-center px-6 py-8 text-center"
      >
        <span
          aria-hidden
          className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg-input text-brand"
        >
          <Images size={22} />
        </span>
        <p className="text-sm font-bold text-text">{t('photos.empty.title')}</p>
        <p className="mt-1 max-w-[260px] text-xs text-text-secondary">
          {canManage ? t('photos.empty.bodyManager') : t('photos.empty.body')}
        </p>
      </Card>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3 px-4">
        <EventPhotoGrid
          photos={tiles}
          onOpen={setViewerIndex}
          busyIds={busyIds}
          {...(canManage
            ? {
                onRemove: (index: number) => {
                  const photo = items[index];
                  if (photo) setRemoving(photo);
                },
              }
            : {})}
        />
        {cursor !== null ? (
          <Button
            variant="outline"
            size="sm"
            className="self-center"
            data-event-photos-more
            loading={loadingMore}
            onClick={() => void loadMore()}
          >
            {t('photos.more')}
          </Button>
        ) : null}
        {moreError ? (
          <p role="alert" className="text-center text-sm text-danger">
            {t('photos.errors.loadMore')}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} data-event-photos className="mt-6">
      <div className="mb-2 flex min-h-9 items-center justify-between gap-3 px-4">
        <SectionTitle id={headingId}>{t('photos.title')}</SectionTitle>
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            data-event-photos-add
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus aria-hidden size={16} />
            {t('photos.add')}
          </Button>
        ) : null}
      </div>

      {canManage ? (
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          tabIndex={-1}
          className="sr-only"
          data-event-photos-input
          // Operated only through the visible "Adicionar fotos" button above: hidden from assistive
          // tech too, so a screen reader meets ONE "Adicionar fotos" control, never two.
          aria-hidden
          onChange={onFiles}
        />
      ) : null}

      {canManage && batch !== null ? (
        <div className="mb-3 flex flex-col gap-2 px-4">
          <p
            aria-live="polite"
            data-event-photos-progress
            className="flex items-center gap-2 text-xs text-text-secondary"
          >
            <Loader2 aria-hidden size={14} className="shrink-0 animate-spin" />
            {batch.phase === 'uploading'
              ? t('photos.uploading', { current: batch.current, total: batch.total })
              : t('photos.preparing')}
          </p>
          {batch.phase === 'uploading' && upload.state === 'progress' ? (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={upload.progress}
              className="h-1 w-full overflow-hidden rounded-full bg-bg-tertiary"
            >
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-200 ease-linear"
                style={{ width: `${upload.progress}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {canManage && upload.error && batch === null ? (
        <p role="alert" className="mb-3 px-4 text-sm text-danger">
          {upload.error}
        </p>
      ) : null}

      {body}

      {viewerIndex !== null && viewerPhotos[viewerIndex] ? (
        <EventPhotoViewer
          photos={viewerPhotos}
          index={viewerIndex}
          labels={{
            dialog: t('photos.viewer.label', { title: eventTitle }),
            close: t('photos.viewer.close'),
            previous: t('photos.viewer.previous'),
            next: t('photos.viewer.next'),
            counter: t('photos.viewer.counter', { index: viewerIndex + 1, total }),
          }}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          hasMore={cursor !== null}
          onEndReached={() => {
            void loadMore().then((added) => {
              if (added > 0) setViewerIndex((index) => (index === null ? index : index + 1));
            });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        icon={Trash2}
        title={t('confirm.removePhoto.title')}
        body={t('confirm.removePhoto.body')}
        confirmLabel={t('confirm.removePhoto.confirm')}
        cancelLabel={t('confirm.removePhoto.dismiss')}
        onConfirm={confirmRemove}
        onClose={() => setRemoving(null)}
        onError={(error) => {
          // Shape only: never the event's title.
          console.error('events.photo_remove_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('photos.errors.remove') });
        }}
      />
    </section>
  );
}
