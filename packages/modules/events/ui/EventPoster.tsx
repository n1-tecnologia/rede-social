'use client';

import { cn } from '@rede-social/ui';
import { CalendarX2, Check, MapPin, Video } from 'lucide-react';
import { EventCover } from './EventCover';

/**
 * The gallery poster of `/eventos` (2026-10-03), ported from the REINE prototype's `EventPoster`
 * onto `EventCover geometry="poster"`: the 4/5 photo under its veil, the pill at the top left, and
 * at the bottom the category, the title, the place and the note (the countdown on an event the
 * viewer is in, "Últimas N vagas" on a limited one that is not theirs, 2026-10-03).
 * It fills the width its host gives it (the gallery's 256px slot).
 *
 * Presentational and props-only: it fetches nothing, formats no date, resolves no URL and **ships no
 * words** (PWA-03). The host passes `href`, every label and the already-formatted strings; relative
 * labels are computed on the server from the request instant, so nothing here reads a clock. A plain
 * `<a>`, never `next/link`: a module must not depend on the framework (MOD-02).
 *
 * **The pill** says where the viewer stands. `registered` ("Inscrito") is the prototype's gold pill:
 * the tenant's BUTTON fill under its gradient, with the button's text (the brand until a tenant sets
 * button colours). Every other kind sits on the over-media ground `bg-black/60 backdrop-blur-sm`:
 * `participated` with a leading `Check`, `cancelled` with `CalendarX2` (never `bg-danger`: white on
 * the danger red is 3.8:1, UI-D-202), and the date, `Agora` and `Encerrado` bare. Uppercase by CSS,
 * `whitespace-nowrap` alone in its row, so it never wraps into the photo.
 *
 * **Truncation is CSS only** (`truncate`, `line-clamp-2`): no `.slice()` of any string here, so a
 * multi-byte grapheme is never split and the 4/5 box never reflows.
 */
export type EventPosterBadgeKind =
  | 'registered'
  | 'participated'
  | 'date'
  | 'live'
  | 'ended'
  | 'cancelled';

export interface EventPosterBadge {
  kind: EventPosterBadgeKind;
  label: string;
}

export interface EventPosterProps {
  /** Built by the HOST (`/eventos/{id}`), never assembled inside the module. */
  href: string;
  /** The whole card's accessible name, composed by the host ("{title}, {when}"). */
  ariaLabel: string;
  title: string;
  /** The line above the title: the event's category ("Workshop"), or the host's fallback. */
  category: string;
  /** "São Paulo, SP", the venue name, or the host's "Online"; empty draws no place line. */
  place: string;
  placeKind: 'venue' | 'online';
  badge: EventPosterBadge;
  /** The countdown ("Faltam 4 dias") or the spots line ("Últimas 3 vagas"); undefined for none. */
  note?: string;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  coverAlt: string;
  /** A cancelled event's photo is desaturated (UI-D-202). */
  grayscale?: boolean;
  /** The first posters of a gallery load eagerly. */
  eager?: boolean;
}

const BADGE = 'inline-flex items-center whitespace-nowrap rounded-full uppercase';

/** "Inscrito": the prototype's gold pill, which is its button's gold. */
const BADGE_REGISTERED =
  'bg-button bg-(image:--button-image) px-3 py-1 text-[11px] font-semibold tracking-[0.5px] text-on-button';

/** Every other state, on the over-media ground. */
const BADGE_GROUND =
  'gap-1 bg-black/60 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white backdrop-blur-sm';

export function EventPoster({
  href,
  ariaLabel,
  title,
  category,
  place,
  placeKind,
  badge,
  note,
  coverAssetId,
  coverVariantWidths,
  coverAlt,
  grayscale = false,
  eager = false,
}: EventPosterProps) {
  const PlaceIcon = placeKind === 'online' ? Video : MapPin;

  /**
   * The bottom block, drawn twice from ONE definition so the photo and gradient branches can never
   * drift in size or position: white ink over the veil, or the inherited `--brand-on-primary` ink
   * (with opacity for the secondary lines) over the gradient.
   */
  const bottom = (onPhoto: boolean) => (
    <div className="absolute right-3.5 bottom-3 left-3.5">
      <p
        data-testid="event-poster-category"
        className={cn(
          'truncate text-[11px] font-bold uppercase tracking-wider',
          onPhoto ? 'text-white/75' : 'opacity-75',
        )}
      >
        {category}
      </p>
      <h3
        data-testid="event-poster-title"
        className={cn(
          'mt-1 line-clamp-2 text-[15px] font-bold leading-tight',
          onPhoto && 'text-white',
        )}
      >
        {title}
      </h3>
      {place ? (
        <p
          data-testid="event-poster-place"
          className={cn(
            'mt-1.5 flex min-w-0 items-center gap-1 text-[11px] font-semibold',
            onPhoto ? 'text-white/70' : 'opacity-70',
          )}
        >
          <PlaceIcon size={11} aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate">{place}</span>
        </p>
      ) : null}
      {note ? (
        <p
          data-testid="event-poster-note"
          className={cn('mt-1.5 text-[11px] font-bold tabular-nums', onPhoto && 'text-white')}
        >
          {note}
        </p>
      ) : null}
    </div>
  );

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid="event-poster"
      className="block rounded-xl transition-opacity active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <EventCover
        geometry="poster"
        coverAssetId={coverAssetId}
        coverVariantWidths={coverVariantWidths}
        coverAlt={coverAlt}
        grayscale={grayscale}
        eager={eager}
        overlay={bottom(true)}
        fallbackOverlay={bottom(false)}
      >
        <span className="absolute top-3 left-3">
          <span
            data-testid="event-poster-pill"
            data-kind={badge.kind}
            className={cn(BADGE, badge.kind === 'registered' ? BADGE_REGISTERED : BADGE_GROUND)}
          >
            {badge.kind === 'cancelled' ? (
              <CalendarX2 size={10} strokeWidth={3} aria-hidden />
            ) : null}
            {badge.kind === 'participated' ? <Check size={10} strokeWidth={3} aria-hidden /> : null}
            {badge.label}
          </span>
        </span>
      </EventCover>
    </a>
  );
}
