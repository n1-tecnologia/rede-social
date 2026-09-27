'use client';

import { Card, cn } from '@tria/ui';
import { MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { EventCover } from './EventCover';
import { type EventInfoCell, EventInfoGrid } from './EventInfoGrid';

/**
 * The check-in boarding pass (UI-D-208, sketch 006 surface 3), ported from the prototype's
 * `event-checkin` page onto the module's own pieces.
 *
 * From top to bottom, inside ONE `Card` at `mx-4` [proto]:
 *  1. `EventCover geometry="ticket"` (`aspect-video`, the [proto] veil), whose bottom overlay carries
 *     the overline date 12/700 uppercase, the title 16/700 `line-clamp-2` and the place line 12/400
 *     with `MapPin` 12, drawn white over a photo or in the inherited `--brand-on-primary` ink over the
 *     gradient (D-69; UI E08/empty);
 *  2. `EventInfoGrid layout="ticket"`: the 3-column Data / Horário / Local row, truncating;
 *  3. the perforation [proto]: two 24px `bg-bg` circles at `-left-3` / `-right-3`, which the Card's
 *     `overflow-hidden` clips into half-notches, and a dashed rule `mx-6` between them;
 *  4. the `children` slot: the bottom section the HOST fills by state (the code form, done, not open
 *     yet, closed, cancelled). One state at a time, never a form and a message together.
 *
 * **Dropped from the prototype** (UI-D-208, V2-EVENT-01): the pseudo-QR, the camera scanner, the "ou"
 * divider, the countdown pill and the browser-storage persistence. The typed code is the ticket's main
 * content.
 *
 * Presentational and props-only: it formats no date and **ships no words** (PWA-03). The title is an
 * `h2`: the page's `h1` is the sticky `PageHeader`'s.
 */
export interface EventTicketProps {
  title: string;
  /** The overline date, already formatted in the tenant's timezone by the host. */
  overline: string;
  /** The venue name. */
  place: string;
  /** Null takes the `--brand-gradient` branch (D-69). */
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  coverAlt: string;
  /** Exactly the three ticket cells (Data, Horário, Local), labels and values finished by the host. */
  cells: readonly EventInfoCell[];
  /** The bottom section, by state. */
  children: ReactNode;
  className?: string;
}

export function EventTicket({
  title,
  overline,
  place,
  coverAssetId,
  coverVariantWidths,
  coverAlt,
  cells,
  children,
  className,
}: EventTicketProps) {
  const bottom = (onPhoto: boolean) => (
    <div className="absolute right-4 bottom-3 left-4">
      <p
        data-testid="event-ticket-overline"
        className={cn(
          'truncate text-xs font-bold uppercase tracking-wider',
          onPhoto ? 'text-white/80' : 'opacity-80',
        )}
      >
        {overline}
      </p>
      <h2
        data-testid="event-ticket-title"
        className={cn(
          'mt-0.5 line-clamp-2 text-base font-bold leading-snug',
          onPhoto && 'text-white',
        )}
      >
        {title}
      </h2>
      <p
        data-testid="event-ticket-place"
        className={cn(
          'mt-1 flex min-w-0 items-center gap-1 text-xs font-normal',
          onPhoto ? 'text-white/85' : 'opacity-85',
        )}
      >
        <MapPin size={12} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">{place}</span>
      </p>
    </div>
  );

  return (
    <Card data-testid="event-ticket" className={cn('mx-4', className)}>
      <EventCover
        geometry="ticket"
        coverAssetId={coverAssetId}
        coverVariantWidths={coverVariantWidths}
        coverAlt={coverAlt}
        eager
        overlay={bottom(true)}
        fallbackOverlay={bottom(false)}
      />
      <EventInfoGrid layout="ticket" cells={cells} />
      <div data-testid="event-ticket-perforation" aria-hidden className="relative">
        <div className="absolute top-1/2 -left-3 h-6 w-6 -translate-y-1/2 rounded-full bg-bg" />
        <div className="absolute top-1/2 -right-3 h-6 w-6 -translate-y-1/2 rounded-full bg-bg" />
        <div className="mx-6 border-t border-dashed border-border-secondary" />
      </div>
      <div data-testid="event-ticket-section" className="flex flex-col px-5 pt-6 pb-5">
        {children}
      </div>
    </Card>
  );
}
