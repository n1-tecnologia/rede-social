'use client';

import {
  BedDouble,
  Car,
  Coffee,
  ExternalLink,
  House,
  type LucideIcon,
  MapPin,
  Pill,
  UtensilsCrossed,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { EventMapView } from '@/lib/events-view';

type FilterId = 'local' | 'hoteis' | 'cafeterias' | 'restaurantes' | 'farmacias' | 'estacionamento';

const FILTERS: ReadonlyArray<{ id: FilterId; icon: LucideIcon }> = [
  { id: 'local', icon: MapPin },
  { id: 'hoteis', icon: BedDouble },
  { id: 'cafeterias', icon: Coffee },
  { id: 'restaurantes', icon: UtensilsCrossed },
  { id: 'farmacias', icon: Pill },
  { id: 'estacionamento', icon: Car },
];

/** The separator before a place or an address: a glyph, not copy (never translated). */
const DOT = '· ';

const search = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

const CARD =
  'flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-opacity active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

/**
 * REINE's "Como chegar" (2026-10-06, `EventLocation` + `EventMap` of the prototype): the keyless
 * Google Maps embed (`output=embed`, no API key), the category filters right under it, the address
 * line, and the list for the chosen category.
 *
 * Each filter swaps the embed's search, so the pins are Google's own; the first filter is the venue
 * itself (its address alone centres the pin on it). The list has no curated places (the system has
 * none), so it is REINE's own uncurated branch: one card that opens the category's full search on
 * Google Maps, and for stays, the Airbnb search of the neighbourhood. Nothing here is invented.
 *
 * This reverses D-203 ("a link, never an embed") at the product owner's request: the embed is a
 * Google page inside ours, loaded only when the section scrolls in (`loading="lazy"`).
 */
export function EventLocationMap({ map }: { map: EventMapView }) {
  const t = useTranslations('events');
  const [active, setActive] = useState<FilterId>('local');

  const term = active === 'local' ? null : t(`reine.location.terms.${active}`);
  const query = term ? t('reine.location.nearQuery', { term, place: map.query }) : map.query;
  const zoom = term ? 16 : 15;
  const src = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=${zoom}&hl=pt-BR&output=embed`;
  // "Local do evento" lists the default recommendation: where to stay.
  const category: Exclude<FilterId, 'local'> = active === 'local' ? 'hoteis' : active;
  const CategoryIcon = FILTERS.find((filter) => filter.id === category)?.icon ?? BedDouble;
  const categoryLabel = t(`reine.location.filters.${category}`).toLowerCase();

  return (
    <section data-testid="event-location" aria-labelledby="event-location-title" className="px-4">
      <h2
        id="event-location-title"
        className="mb-3 text-sm font-bold uppercase tracking-wider text-brand"
      >
        {t('reine.location.title')}
      </h2>

      <div className="overflow-hidden rounded-xl border border-border">
        <iframe
          key={active}
          src={src}
          data-testid="event-map"
          className="block h-64 w-full border-0"
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          title={
            term
              ? t('reine.location.nearTitle', { category: t(`reine.location.filters.${active}`) })
              : t('reine.location.mapTitle', { venue: map.venue || map.addressLine })
          }
        />
      </div>

      <fieldset className="-mx-1 mt-2 flex min-w-0 gap-2 overflow-x-auto border-0 px-1 py-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <legend className="sr-only">{t('reine.location.filtersLabel')}</legend>
        {FILTERS.map((filter) => {
          const on = filter.id === active;
          return (
            <button
              key={filter.id}
              type="button"
              aria-pressed={on}
              onClick={() => setActive(filter.id)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                on ? 'bg-brand text-on-brand' : 'bg-bg-input text-text-secondary'
              }`}
            >
              <filter.icon aria-hidden size={13} />
              {t(`reine.location.filters.${filter.id}`)}
            </button>
          );
        })}
      </fieldset>

      <a
        href={search(query)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="event-maps-link"
        className="mt-2.5 flex items-start gap-1.5 px-1 text-xs text-text-secondary transition-opacity active:opacity-70"
      >
        <MapPin aria-hidden size={13} className="mt-0.5 shrink-0 text-brand" />
        <span className="min-w-0 flex-1">
          {term ? (
            <>
              <span className="font-semibold text-text">
                {t('reine.location.seeOnMaps', { category: categoryLabel })}
              </span>{' '}
              {DOT}
              {t('reine.location.near', { place: map.venue || map.addressLine })}
            </>
          ) : (
            <>
              {map.venue ? (
                <span className="font-semibold text-text">
                  {map.venue} {DOT}
                </span>
              ) : null}
              {map.addressLine}
            </>
          )}
        </span>
        <ExternalLink aria-hidden size={13} className="mt-0.5 shrink-0 text-text-tertiary" />
      </a>

      <p className="mt-5 mb-2 text-xs font-bold uppercase tracking-wider text-text-tertiary">
        {t(`reine.location.lists.${category}`)}
      </p>
      <div className="flex flex-col gap-2">
        <a
          href={search(
            t('reine.location.nearQuery', {
              term: t(`reine.location.terms.${category}`),
              place: map.query,
            }),
          )}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="event-nearby"
          className={CARD}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <CategoryIcon aria-hidden size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-text">
              {t('reine.location.googleTitle', { category: categoryLabel })}
            </span>
            <span className="mt-0.5 block text-xs text-text-tertiary">
              {t('reine.location.googleBody', { venue: map.venue || map.areaLabel })}
            </span>
          </span>
          <ExternalLink aria-hidden size={15} className="shrink-0 text-text-tertiary" />
        </a>
        {category === 'hoteis' ? (
          <a
            href={`https://www.airbnb.com.br/s/${encodeURIComponent(map.areaQuery)}/homes`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="event-airbnb"
            className={CARD}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
              <House aria-hidden size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-text">
                {t('reine.location.airbnbTitle', { area: map.areaLabel })}
              </span>
              <span className="mt-0.5 block text-xs text-text-tertiary">
                {t('reine.location.airbnbBody')}
              </span>
            </span>
            <ExternalLink aria-hidden size={15} className="shrink-0 text-text-tertiary" />
          </a>
        ) : null}
      </div>
    </section>
  );
}
