'use client';

import { MediaImage } from '@rede-social/core/ui';
import { EventPhotoViewer, type EventPhotoViewerItem } from '@rede-social/module-events/ui';
import { cn } from '@rede-social/ui';
import { Images } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export type PhotoAlbum = {
  id: string;
  title: string;
  /** The chip: `{category} · {date}`. */
  chip: string;
  date: string;
  /** Under the filter of one event: `{n} fotos · {date}`. */
  countLine: string;
  photos: EventPhotoViewerItem[];
};

/**
 * The "Fotos" screen's body (2026-10-06, REINE's `event-photos`): chips ("Todos" or one event), the
 * albums as three-column grids, each photo opening the shared `EventPhotoViewer` on its album.
 */
export function PhotosGallery({
  albums,
  initialFilter,
  labels,
}: {
  albums: PhotoAlbum[];
  initialFilter: string;
  labels: { all: string; filters: string; empty: string };
}) {
  const t = useTranslations('events');
  const [filter, setFilter] = useState(initialFilter);
  const [viewer, setViewer] = useState<{ albumId: string; index: number } | null>(null);
  const visible = filter === 'all' ? albums : albums.filter((album) => album.id === filter);
  const open = viewer ? albums.find((album) => album.id === viewer.albumId) : undefined;

  const chip = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      aria-pressed={filter === id}
      onClick={() => setFilter(id)}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        filter === id ? 'bg-brand text-on-brand' : 'bg-bg-input text-text-secondary',
      )}
    >
      {label}
    </button>
  );

  if (albums.length === 0) {
    return (
      <div
        data-testid="photos-empty"
        className="flex flex-col items-center gap-2 px-4 py-16 text-center"
      >
        <Images aria-hidden size={28} className="text-text-tertiary" />
        <p className="text-sm text-text-secondary">{labels.empty}</p>
      </div>
    );
  }

  return (
    <>
      <div className="border-b border-border bg-bg py-2">
        <fieldset className="flex min-w-0 gap-2 overflow-x-auto border-0 px-4 py-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <legend className="sr-only">{labels.filters}</legend>
          {chip('all', labels.all)}
          {albums.map((album) => chip(album.id, album.chip))}
        </fieldset>
      </div>

      <div className="flex flex-col pt-3">
        {visible.map((album) => (
          <section key={album.id} data-testid="photos-album" className="mb-5">
            {filter === 'all' ? (
              <div className="mb-2 flex items-baseline justify-between px-4">
                <h2 className="truncate text-sm font-bold text-text">{album.title}</h2>
                <span className="ml-3 shrink-0 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                  {album.date}
                </span>
              </div>
            ) : (
              <p className="mb-2 px-4 text-xs text-text-tertiary">{album.countLine}</p>
            )}
            <ul className="grid grid-cols-3 gap-0.5">
              {album.photos.map((photo, index) => (
                <li key={photo.id}>
                  <button
                    type="button"
                    aria-label={t('photos.open', { index: index + 1, total: album.photos.length })}
                    onClick={() => setViewer({ albumId: album.id, index })}
                    className="relative block aspect-square w-full overflow-hidden bg-bg-secondary transition-opacity active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
                  >
                    <MediaImage
                      assetId={photo.assetId}
                      widths={photo.variantWidths}
                      alt={photo.alt}
                      sizes="(min-width: 680px) 227px, 33vw"
                      ratio="aspect-square"
                      className="h-full w-full"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {viewer && open?.photos[viewer.index] ? (
        <EventPhotoViewer
          photos={open.photos}
          index={viewer.index}
          labels={{
            dialog: t('photos.viewer.label', { title: open.title }),
            close: t('photos.viewer.close'),
            previous: t('photos.viewer.previous'),
            next: t('photos.viewer.next'),
            counter: t('photos.viewer.counter', {
              index: viewer.index + 1,
              total: open.photos.length,
            }),
          }}
          onIndexChange={(index) => setViewer({ albumId: open.id, index })}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </>
  );
}
