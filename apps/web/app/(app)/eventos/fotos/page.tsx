import type { EventSummary } from '@rede-social/module-events/contracts';
import { EmptyState } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadEventPhotos, loadEventSections } from '@/lib/events';
import { eventDateLabel, eventPhase } from '@/lib/events-view';
import { type PhotoAlbum, PhotosGallery } from './PhotosGallery';

/** How many of the most recent events that are over the page reads photos for. */
const ALBUMS_MAX = 12;

/**
 * `/eventos/fotos` (2026-10-06, the REINE prototype's "Fotos" of the events menu): the official
 * photos of the events that are over, one album per event, filtered by chips ("Todos" or one
 * event), each photo opening the shared viewer. `?evento={id}` opens on that event (the detail
 * page's "Ver galeria"). Real photos only: the events' own galleries (`GET /v1/events/{id}/photos`),
 * read here for the most recent `ALBUMS_MAX` events; an event with none has no album.
 */
export default async function EventsPhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ evento?: string | string[] }>;
}) {
  const [t, bootstrap, sections, query] = await Promise.all([
    getTranslations('events'),
    requireBootstrap(),
    loadEventSections(),
    searchParams,
  ]);

  const head = (subtitle: string | null) => (
    <div className="px-4 pt-4 pb-3">
      <h1 data-brand-title className="text-2xl font-bold text-text">
        {t('reine.photosPage.title')}
      </h1>
      {subtitle ? <p className="mt-0.5 text-sm text-text-secondary">{subtitle}</p> : null}
    </div>
  );

  if (!sections) {
    return (
      <div className="mx-auto w-full max-w-[680px] pb-6">
        {head(null)}
        <div className="px-4">
          <EmptyState
            variant="card"
            icon={CircleAlert}
            title={t('errors.title')}
            body={t('errors.generic')}
            action={
              <a
                href="/eventos/fotos"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
              >
                {t('errors.retry')}
              </a>
            }
          />
        </div>
      </div>
    );
  }

  const nowMs = Date.now();
  const tz = bootstrap.tenant.timezone;
  const unique = new Map<string, EventSummary>();
  for (const event of [...sections.upcoming, ...sections.past]) unique.set(event.id, event);
  const over = [...unique.values()]
    .filter(
      (event) =>
        event.status !== 'cancelled' && eventPhase(event.startsAt, event.endsAt, nowMs) === 'P3',
    )
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
    .slice(0, ALBUMS_MAX);
  const pages = await Promise.all(over.map((event) => loadEventPhotos(event.id)));

  const albums: PhotoAlbum[] = over
    .map((event, index) => {
      const date = eventDateLabel(event, tz, nowMs, t);
      const photos = pages[index]?.items ?? [];
      return {
        id: event.id,
        title: event.title,
        chip: `${event.category ?? t('reine.photosPage.eventFallback')} · ${date}`,
        date,
        countLine: t('reine.photosPage.count', { count: photos.length, date }),
        photos: photos.map((photo, i) => ({
          id: photo.id,
          assetId: photo.mediaAssetId,
          variantWidths: photo.variantWidths,
          alt: t('photos.alt', { index: i + 1, title: event.title }),
        })),
      };
    })
    .filter((album) => album.photos.length > 0);

  const total = albums.reduce((sum, album) => sum + album.photos.length, 0);
  const requested = Array.isArray(query.evento) ? query.evento[0] : query.evento;
  const initialFilter = albums.some((album) => album.id === requested)
    ? (requested ?? 'all')
    : 'all';

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col pb-6">
      {head(
        albums.length > 0
          ? t('reine.photosPage.subtitle', { photos: total, events: albums.length })
          : null,
      )}
      <PhotosGallery
        albums={albums}
        initialFilter={initialFilter}
        labels={{
          all: t('reine.photosPage.all'),
          filters: t('reine.photosPage.filtersLabel'),
          empty: t('reine.photosPage.empty'),
        }}
      />
    </div>
  );
}
