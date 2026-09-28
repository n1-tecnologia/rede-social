'use client';

import { chipBase, cn } from '@rede-social/ui';
import { CalendarX2, Check, MapPin, Video } from 'lucide-react';
import { EventCover } from './EventCover';

/**
 * The list poster (UI-D-200, UI-D-201, UI-D-202), ported from the prototype's `EventPoster` onto
 * `EventCover geometry="poster"`.
 *
 * Presentational and props-only: it fetches nothing, formats no date, resolves no URL and **ships no
 * words** (PWA-03). The host passes `href`, every label and the already-formatted strings; relative
 * labels are computed on the server from the request instant, so nothing here reads a clock. A plain
 * `<a>`, never `next/link`: a module must not depend on the framework (MOD-02).
 *
 * **The pill (top-left)** carries a state or a RELATIVE date; the absolute date always sits in the
 * overline, so the card states each fact once (UI-D-201). It is `whitespace-nowrap` alone in its row,
 * so it never wraps into the image. The over-media ground is `bg-black/60 backdrop-blur-sm` for every
 * kind in this plan: `Cancelado` is NOT `bg-danger`, because white on the danger red is 3.8:1, below AA
 * for 12px text (UI-D-202). 06-03 adds the viewer's two states: `going` ("Você vai") on the brand
 * fill `bg-brand text-on-brand` (the per-tenant on-colour, never white), and `present` ("Presente") on
 * the same over-media ground with a leading `Check` 12. The host resolves which one applies
 * (`Cancelado` → `Presente` → `Você vai` → relative date).
 *
 * **The meta line** (06-03, UI-D-201) is the count, 12/700 `tabular-nums`: "N confirmados" while
 * upcoming, "N presentes" once past, and ABSENT when the host passes none (a cancelled event). Its
 * absence leaves no gap: the 4/5 box never reflows either way.
 *
 * **Truncation is CSS only** (`truncate`, `line-clamp-2`): no `.slice()` of any string here, so a
 * multi-byte grapheme is never split and the 4/5 box never reflows.
 */
export type EventPosterPillKind = 'cancelled' | 'relative' | 'going' | 'present';

export interface EventPosterPill {
  kind: EventPosterPillKind;
  label: string;
}

export interface EventPosterProps {
  /** Built by the HOST (`/eventos/{id}`), never assembled inside the module. */
  href: string;
  /** The whole card's accessible name, composed by the host ("{title}, {when}"). */
  ariaLabel: string;
  title: string;
  /** The when-line: "{date} · {time}", "{start} a {end}", or "Acontecendo agora · até {time}". */
  overline: string;
  /** `true` while the event runs: the overline reads in full white instead of white/75. */
  overlineLive?: boolean;
  /** The venue name, or the host's "Online". */
  place: string;
  placeKind: 'venue' | 'online';
  pill: EventPosterPill;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  coverAlt: string;
  /** The count line ("3 confirmados"), or undefined for none (a cancelled event). */
  meta?: string;
  /** A cancelled event's photo is desaturated (UI-D-202). */
  grayscale?: boolean;
  /** The first two posters of a list load eagerly. */
  eager?: boolean;
}

/** The pill's over-media ground, shared by every kind except `going`. */
const PILL_GROUND = 'bg-black/60 backdrop-blur-sm text-white';

/** `going` is the member's own confirmed answer: the tenant's brand fill and its on-colour. */
const PILL_GOING = 'bg-brand text-on-brand';

export function EventPoster({
  href,
  ariaLabel,
  title,
  overline,
  overlineLive = false,
  place,
  placeKind,
  pill,
  coverAssetId,
  coverVariantWidths,
  coverAlt,
  meta,
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
    <div className="absolute right-3 bottom-3 left-3">
      <p
        data-testid="event-poster-overline"
        className={cn(
          'truncate text-xs font-bold uppercase tracking-wider',
          onPhoto
            ? overlineLive
              ? 'text-white'
              : 'text-white/75'
            : overlineLive
              ? ''
              : 'opacity-75',
        )}
      >
        {overline}
      </p>
      <h3
        data-testid="event-poster-title"
        className={cn(
          'mt-1 line-clamp-2 text-base font-bold leading-tight',
          onPhoto && 'text-white',
        )}
      >
        {title}
      </h3>
      <p
        data-testid="event-poster-place"
        className={cn(
          'mt-1 flex min-w-0 items-center gap-1 text-xs font-normal',
          onPhoto ? 'text-white/75' : 'opacity-75',
        )}
      >
        <PlaceIcon size={12} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">{place}</span>
      </p>
      {meta ? (
        <p
          data-testid="event-poster-meta"
          className={cn('mt-1 text-xs font-bold tabular-nums', onPhoto && 'text-white')}
        >
          {meta}
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
            data-kind={pill.kind}
            className={cn(chipBase, pill.kind === 'going' ? PILL_GOING : PILL_GROUND)}
          >
            {pill.kind === 'cancelled' ? <CalendarX2 size={12} aria-hidden /> : null}
            {pill.kind === 'present' ? <Check size={12} strokeWidth={3} aria-hidden /> : null}
            {pill.label}
          </span>
        </span>
      </EventCover>
    </a>
  );
}
