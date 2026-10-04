'use client';

import { MediaImage } from '@rede-social/core/ui';
import { X } from 'lucide-react';

/**
 * The event's photo grid (2026-10-03, the REINE prototype's "Fotos": three columns, 2px gaps, square
 * tiles). Presentational and props-only: it fetches nothing, resolves no URL beyond `MediaImage`'s
 * stable `/v1/media/{id}/w{width}` paths and **ships no words** (PWA-03): every accessible name is
 * a prop the host built from its catalog.
 *
 * **Each tile is ONE button** that opens the viewer at its index; its accessible name ("Abrir foto
 * 3 de 12") is the whole description, so the image inside is decorative (`alt=""`): a photo of an
 * event has no caption to read. A manager's tile carries a SECOND button, a sibling and never a
 * child (no nested interactive content), in the top-right corner: a 44px hit area around a 28px
 * disc on the over-media ground, the host's confirm behind it.
 *
 * Square tiles crop (`object-cover`) on the `post` ladder; `sizes` asks for a third of the 680px
 * column, so a phone loads the 320 or 640 rung and never the 1600 one.
 */
export interface EventPhotoTile {
  /** The photo row's id (the remove target), never the asset's. */
  id: string;
  assetId: string;
  variantWidths: readonly number[];
  /** The tile button's accessible name, composed by the host ("Abrir foto 3 de 12"). */
  openLabel: string;
  /** The remove button's accessible name; absent draws no remove button (a member's view). */
  removeLabel?: string;
}

export interface EventPhotoGridProps {
  photos: readonly EventPhotoTile[];
  onOpen: (index: number) => void;
  /** A manager's remove, by index; the host confirms before it writes anything. */
  onRemove?: (index: number) => void;
  /** Photos whose removal is in flight: their remove button is disabled. */
  busyIds?: ReadonlySet<string>;
}

/** A third of the 680px column minus its gutter on a desktop, a third of the screen on a phone. */
const TILE_SIZES = '(min-width: 680px) 216px, 33vw';

export function EventPhotoGrid({ photos, onOpen, onRemove, busyIds }: EventPhotoGridProps) {
  return (
    <ul
      data-testid="event-photo-grid"
      className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-xl"
    >
      {photos.map((photo, index) => (
        <li key={photo.id} data-testid="event-photo" className="relative">
          <button
            type="button"
            aria-label={photo.openLabel}
            onClick={() => onOpen(index)}
            className="block w-full transition-opacity active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
          >
            <MediaImage
              assetId={photo.assetId}
              widths={photo.variantWidths}
              alt=""
              sizes={TILE_SIZES}
              ratio="aspect-square"
              className="w-full"
            />
          </button>
          {onRemove && photo.removeLabel ? (
            <button
              type="button"
              aria-label={photo.removeLabel}
              data-testid="event-photo-remove"
              disabled={busyIds?.has(photo.id) ?? false}
              onClick={() => onRemove(index)}
              className="group absolute top-0 right-0 flex h-11 w-11 items-start justify-end p-1.5 focus-visible:outline-none disabled:opacity-50"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors group-hover:bg-black/75 group-focus-visible:ring-2 group-focus-visible:ring-white">
                <X aria-hidden size={14} strokeWidth={2.5} />
              </span>
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
