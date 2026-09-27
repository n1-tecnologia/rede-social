'use client';

import { cn } from '@tria/ui';
import { MapPin, Video } from 'lucide-react';
import { EventCover } from './EventCover';

/**
 * The detail page's hero (UI-D-204), ported from the prototype's `card-magazine` 16/10 cover onto
 * `EventCover geometry="hero"`.
 *
 * The bottom overlay sits at `bottom-3 left-4 right-4` [proto]: the overline 12/700 uppercase, the
 * title at **24/700** (`line-clamp-3`, the page's visual anchor; the prototype's `text-lg` is
 * normalised up to the Title role) and the place line 12/400 with `MapPin` / `Video` 12. There is no
 * top-left pill (`typeLabel` is dropped).
 *
 * Presentational and props-only: it formats no date and **ships no words** (PWA-03). The host passes
 * the finished overline (countdown, "É hoje!", "Acontecendo agora", "Aconteceu em …"), the place
 * string and the cover alt. The same overlay is drawn twice from ONE definition: white over the
 * photo's veil, or the inherited `--brand-on-primary` ink over the gradient (D-69), so the two
 * branches can never drift in size or position.
 *
 * The title is an `h2`: the page's `h1` is the sticky `PageHeader`'s.
 */
export interface EventHeroProps {
  title: string;
  /** The hero line, already formatted in the tenant's timezone by the host. */
  overline: string;
  /** The venue name, or the host's "Online". */
  place: string;
  placeKind: 'venue' | 'online';
  /** Null takes the `--brand-gradient` branch (D-69). */
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  coverAlt: string;
}

export function EventHero({
  title,
  overline,
  place,
  placeKind,
  coverAssetId,
  coverVariantWidths,
  coverAlt,
}: EventHeroProps) {
  const PlaceIcon = placeKind === 'online' ? Video : MapPin;

  const bottom = (onPhoto: boolean) => (
    <div className="absolute right-4 bottom-3 left-4">
      <p
        data-testid="event-hero-overline"
        className={cn(
          'text-xs font-bold uppercase tracking-wider',
          onPhoto ? 'text-white/80' : 'opacity-80',
        )}
      >
        {overline}
      </p>
      <h2
        data-testid="event-hero-title"
        className={cn(
          'mt-1 line-clamp-3 text-2xl font-bold leading-tight',
          onPhoto && 'text-white',
        )}
      >
        {title}
      </h2>
      <p
        data-testid="event-hero-place"
        className={cn(
          'mt-1 flex min-w-0 items-center gap-1 text-xs font-normal',
          onPhoto ? 'text-white/85' : 'opacity-85',
        )}
      >
        <PlaceIcon size={12} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">{place}</span>
      </p>
    </div>
  );

  return (
    <EventCover
      geometry="hero"
      coverAssetId={coverAssetId}
      coverVariantWidths={coverVariantWidths}
      coverAlt={coverAlt}
      eager
      overlay={bottom(true)}
      fallbackOverlay={bottom(false)}
    />
  );
}
