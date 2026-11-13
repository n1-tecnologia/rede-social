'use client';

import { EventPoster } from '@rede-social/module-events/ui';
import { Button, Card, cn, EmptyState, PullToRefresh, Skeleton } from '@rede-social/ui';
import { CalendarDays, Plus, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useId, useState } from 'react';
import { eventListPoster } from '@/lib/cover-fallback';
import type { EventCardView, EventSectionsView } from '@/lib/events-view';
import { refreshEventSectionsAction } from './actions';

export interface EventsSectionsProps {
  /** The galleries the SERVER rendered, already formatted; `null` when it could not read them. */
  initial: EventSectionsView | null;
  /** The tenant's display name, in the "Outros eventos" empty state. */
  tenantName: string;
  /**
   * The composed `events.event.manage` permission (06-04): the "Outros eventos" empty state then
   * speaks to the manager and carries the "Criar evento" link (D-77).
   */
  canManage?: boolean;
  /** The manager's create control, built by the page, beside the first gallery's title. */
  createControl?: ReactNode;
}

/** A gallery's header: the prototype's section title (brand ink, capitals) and its line beneath. */
function GalleryHeader({
  id,
  title,
  subtitle,
  action,
}: {
  id?: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-4">
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-sm font-bold uppercase tracking-wider text-brand">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * The prototype's empty gallery: a card with the calendar disc, a title and one line (plus, for the
 * manager, the "Criar evento" link).
 */
function GalleryEmpty({
  testId,
  title,
  body,
  action,
}: {
  testId: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Card data-testid={testId} className="mx-4 flex flex-col items-center px-6 py-8 text-center">
      <span
        aria-hidden
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg-input text-brand"
      >
        <CalendarDays size={22} />
      </span>
      <p className="text-sm font-bold text-text">{title}</p>
      <p className="mt-1 max-w-[240px] text-xs text-text-secondary">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

/**
 * 2026-10-26 — a gallery on the page's whole width (the product owner: "o aproveitamento igual da
 * área de membros"). A phone keeps the row of 256px posters that scrolls sideways; from `md` the same
 * list is a grid that shows every poster, two columns and then three, four and five as the column
 * holds 672, 896 and 1152px. The container is the padded wrapper, so the steps follow the room the
 * rail leaves. `POSTER_CELL` is the slot on both; `SKELETON_ROW` keeps the skeleton to one row.
 */
const POSTERS_WRAP = '@container md:px-4';
const POSTERS =
  'flex gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 scrollbar-none md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 @2xl:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-5 lg:gap-4';
const POSTER_CELL = 'w-64 shrink-0 md:w-auto md:min-w-0';
const SKELETON_ROW = [
  ['p0', ''],
  ['p1', ''],
  ['p2', 'hidden @2xl:block'],
  ['p3', 'hidden @4xl:block'],
  ['p4', 'hidden @6xl:block'],
] as const;

/**
 * One gallery: its header, then the posters side by side in a row that scrolls sideways on a phone
 * and in a grid from `md` (a list, so assistive tech announces how many), or its empty card. The
 * first two posters load eagerly.
 */
function Gallery({
  section,
  title,
  subtitle,
  cards,
  empty,
  action,
}: {
  section: 'mine' | 'others';
  title: string;
  subtitle: string;
  cards: EventCardView[];
  empty: ReactNode;
  action?: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-events-section={section} className="mb-7">
      <GalleryHeader id={headingId} title={title} subtitle={subtitle} action={action} />
      {cards.length > 0 ? (
        <div className={POSTERS_WRAP}>
          <ul className={POSTERS}>
            {cards.map((card, index) => {
              // 12.3-08 (UI-D-693): the vertical poster, else the horizontal cover, else the gradient.
              const image = eventListPoster(card);
              return (
                <li key={card.id} className={POSTER_CELL}>
                  <EventPoster
                    href={card.href}
                    ariaLabel={card.ariaLabel}
                    title={card.title}
                    category={card.category}
                    place={card.place}
                    placeKind={card.placeKind}
                    badge={card.badge}
                    note={card.note}
                    tag={card.tag}
                    coverAssetId={image.assetId}
                    coverVariantWidths={image.widths}
                    coverAlt={card.coverAlt}
                    grayscale={card.grayscale}
                    eager={index < 2}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        empty
      )}
    </section>
  );
}

/**
 * The galleries' skeleton, shared with `loading.tsx`: the real headers (their words are fixed) and
 * two posters each, in the galleries' own geometry, so nothing moves when the cards swap in.
 */
export function EventsSkeleton({ headers }: { headers: { title: string; subtitle: string }[] }) {
  return (
    <div aria-busy data-testid="events-skeleton" className="flex flex-col pt-4 pb-6">
      {headers.map((header) => (
        <div key={header.title} className="mb-7">
          <GalleryHeader title={header.title} subtitle={header.subtitle} />
          <div className={POSTERS_WRAP}>
            <div className={cn(POSTERS, 'overflow-hidden')}>
              {SKELETON_ROW.map(([id, only]) => (
                <Skeleton
                  key={id}
                  variant="rect"
                  className={cn('aspect-[4/5] rounded-xl', POSTER_CELL, only)}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The `/eventos` body (2026-10-03, the REINE prototype): two galleries, "Meus eventos" (the events
 * the member is in, then the ones they took part in) and "Outros eventos" (the rest, the ones to come
 * first). It receives FINISHED card views from the server (the page and the refresh action): no
 * instant is formatted and no clock is read here (UI-D-203), and the order is the server's.
 *
 * States: the galleries (each with its own empty card), and an unreadable first load (the generic
 * error card with a retry). A pull refreshes both galleries at once; a failed refresh keeps what is
 * on screen.
 */
export function EventsSections({
  initial,
  tenantName,
  canManage = false,
  createControl,
}: EventsSectionsProps) {
  const t = useTranslations('events');
  const [sections, setSections] = useState(initial);

  // The SERVER sent other galleries (a navigation, not a refresh): re-seed rather than keep.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setSections(initial);
  }

  const refresh = useCallback(async () => {
    try {
      const next = await refreshEventSectionsAction();
      if (next.ok) setSections(next.sections);
    } catch (error) {
      console.error('events.refresh_failed', { error: String(error) });
    }
  }, []);

  let body: ReactNode;
  if (sections === null) {
    body = (
      <>
        {createControl ? <div className="flex justify-end px-4 pb-3">{createControl}</div> : null}
        <div className="px-4">
          <EmptyState
            variant="card"
            icon={TriangleAlert}
            title={t('errors.title')}
            body={t('errors.generic')}
            action={
              <Button variant="outline" onClick={() => void refresh()}>
                {t('errors.retry')}
              </Button>
            }
          />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <Gallery
          section="mine"
          title={t('sections.mine.title')}
          subtitle={t('sections.mine.subtitle')}
          cards={sections.mine}
          action={createControl}
          empty={
            <GalleryEmpty
              testId="events-empty-mine"
              title={t('sections.mine.emptyTitle')}
              body={t('sections.mine.emptyBody')}
            />
          }
        />
        <Gallery
          section="others"
          title={t('sections.others.title')}
          subtitle={t('sections.others.subtitle')}
          cards={sections.others}
          empty={
            <GalleryEmpty
              testId="events-empty-others"
              title={t('sections.others.emptyTitle')}
              body={
                canManage
                  ? t('sections.others.emptyBodyManager')
                  : t('sections.others.emptyBody', { tenant: tenantName })
              }
              action={
                canManage ? (
                  <a
                    href="/eventos/novo"
                    data-events-empty-create
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    <Plus aria-hidden size={16} />
                    {t('actions.create')}
                  </a>
                ) : undefined
              }
            />
          }
        />
      </>
    );
  }

  return (
    <PullToRefresh onRefresh={refresh}>
      <div className="flex flex-col pt-4 pb-6">{body}</div>
    </PullToRefresh>
  );
}
