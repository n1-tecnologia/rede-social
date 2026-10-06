import { Card, SectionTitle, StatusPill } from '@rede-social/ui';
import { ChevronRight, MapPin, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { EventCover } from './EventCover';

/**
 * The Início "Próximo evento" card (UI-D-214, D-202, sketch 006 surface 5, approved 2026-09-27).
 *
 * **Not mounted since 2026-10-03:** a product decision replaced it with a red dot on the Eventos
 * tab (`eventsTabDot` in `apps/web/lib/registry.tsx`), so the web registers no renderer for the
 * manifest's Início slot and the next event is no longer drawn on Início. The card stays here, the
 * module's widget, for a host that mounts it again (with a web composer like the removed
 * `nextEventCardView`, recoverable from git); the notes below describe it as it was mounted.
 *
 * A `section` with the micro heading, then a `Card` whose TOP ROW is ONE `<a>` to the detail
 * (`flex gap-3 p-3 items-center`, the host's `href` and `aria-label` "Ver o evento {title}"):
 *  - the `thumb` cover (64×80, `rounded-lg`, the brand gradient without a cover, no overlay text,
 *    `alt=""` because the title sits next to it);
 *  - a `min-w-0 flex-1` column: the overline (12/700 uppercase tertiary), the title (16/700
 *    `line-clamp-2`), the place line (12/400 tertiary `truncate`, `MapPin` / `Video` 12) and the meta
 *    row (12/400 tertiary: the count, then an optional soft `StatusPill`);
 *  - `ChevronRight` 18 tertiary, `shrink-0`.
 *
 * **The CTA is a SLOT, rendered as a SIBLING below the row** (`px-3 pb-3`), never inside the row's
 * anchor: two tap targets, no nested links. The HOST passes the exact anchor (the brand "Fazer
 * check-in" link or the plain `Entrar` anchor), so this module holds no route, no clock and no words
 * (MOD-02, PWA-03): every string, the href and the check-in mode are decided on the server by the
 * web tier.
 *
 * **No inset of its own: the HOST insets it.** `/inicio`'s column has no side gutter on a phone (the
 * stories band and the posts run edge to edge, the REINE timeline of 2026-10-02), so the web tier
 * wraps this slot in `px-4 md:px-0` (`lib/registry.tsx`); the heading and the card carry no
 * horizontal margin here, and a host that renders it full-bleed must add that gutter itself.
 */
export interface NextEventCardProps {
  /** The section's micro heading ("Próximo evento"). */
  heading: string;
  /** Built by the HOST (`/eventos/{id}`), never assembled inside the module. */
  href: string;
  /** The row's accessible name, composed by the host ("Ver o evento {title}"). */
  ariaLabel: string;
  title: string;
  /** The Início when-line: "Hoje · 19:00", "Amanhã · 19:00", "{date} · {time}", "Acontecendo agora". */
  overline: string;
  /** The venue name, or the host's "Online". */
  place: string;
  placeKind: 'venue' | 'online';
  /** The count line ("3 confirmados"). */
  meta: string;
  /** The viewer's state pill ("Você vai" brand, "Presente" success), or null for none. */
  pill: { tone: 'brand' | 'success'; label: string } | null;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  /** Check-in mode (P1/P2): the host's anchor, rendered below the row. Absent otherwise. */
  cta?: ReactNode;
}

export function NextEventCard({
  heading,
  href,
  ariaLabel,
  title,
  overline,
  place,
  placeKind,
  meta,
  pill,
  coverAssetId,
  coverVariantWidths,
  cta,
}: NextEventCardProps) {
  const PlaceIcon = placeKind === 'online' ? Video : MapPin;
  return (
    <section aria-labelledby="next-event-heading" data-testid="next-event">
      <SectionTitle id="next-event-heading" className="mb-2">
        {heading}
      </SectionTitle>
      <Card>
        <a
          href={href}
          aria-label={ariaLabel}
          data-testid="next-event-row"
          className="flex items-center gap-3 p-3 text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
        >
          <EventCover
            geometry="thumb"
            coverAssetId={coverAssetId}
            coverVariantWidths={coverVariantWidths}
            coverAlt=""
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              data-testid="next-event-overline"
              className="truncate text-xs font-bold uppercase tracking-wider text-text-tertiary"
            >
              {overline}
            </span>
            <span
              data-testid="next-event-title"
              className="mt-1 line-clamp-2 text-base font-bold leading-tight text-text"
            >
              {title}
            </span>
            <span
              data-testid="next-event-place"
              className="mt-1 flex min-w-0 items-center gap-1 text-xs font-normal text-text-tertiary"
            >
              <PlaceIcon size={12} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate">{place}</span>
            </span>
            <span
              data-testid="next-event-meta"
              className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs font-normal tabular-nums text-text-tertiary"
            >
              <span>{meta}</span>
              {pill ? (
                <StatusPill data-testid="next-event-pill" tone={pill.tone}>
                  {pill.label}
                </StatusPill>
              ) : null}
            </span>
          </span>
          <ChevronRight size={18} aria-hidden className="shrink-0 text-text-tertiary" />
        </a>
        {cta ? (
          <div data-testid="next-event-cta" className="px-3 pb-3">
            {cta}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
