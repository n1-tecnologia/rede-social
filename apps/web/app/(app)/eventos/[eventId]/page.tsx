import { EVENT_PERMISSIONS } from '@tria/module-events/contracts';
import { EventHero, EventInfoGrid } from '@tria/module-events/ui';
import { Card, EmptyState, PageHeader, SectionTitle, StatusPill } from '@tria/ui';
import {
  CalendarX2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Navigation,
  Pencil,
} from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadEvent } from '@/lib/events';
import { type EventDetailView, eventActionState, eventDetailView } from '@/lib/events-view';
import { EventActions } from './EventActions';
import { EventDescription } from './EventDescription';
import { EventRefresh } from './EventRefresh';
import { ReactivateEventControl } from './ReactivateEventControl';

/**
 * `/eventos/[eventId]` (EVENT-02, UI-D-204) — the event's detail page, reached from its poster.
 *
 * The prototype's page, ported: the sticky back header with a trailing state pill ("Você vai" brand,
 * "Presente" success, "Cancelado" danger), then ONE hero `Card`: the 16/10 cover with its overlay,
 * and a body in UI-D-204 order — banner (cancelled or checked in), description, info grid, location
 * (in person), then the action zone (`EventActions`: the RSVP pair of sketch 006 and, in person in
 * P1/P2, the "Fazer check-in" link to `/eventos/{id}/check-in`, 06-05). Dropped [proto]
 * extras: spots, payment and certificate banners, the embedded map (D-203), `MyEventDetails`, the
 * photos rail.
 *
 * **Every string is built on the server** by `eventDetailView` in the TENANT's timezone from ONE
 * request instant (UI-D-203): no client render reads the clock, and a device in Manaus reads the
 * tenant's wall clock.
 *
 * **Members see a count, never who** (D-206): the API payload carries only the viewer's own state and
 * the two counts, and this page prints only those.
 *
 * **Every miss is ONE screen** (D-23): an unknown id, another tenant's event and a malformed id all
 * arrive as `loadEvent`'s single `not-found`, and `notFound()` renders `not-found.tsx`. A transport or
 * 5xx failure is the DIFFERENT retry screen below. `notFound()` throws, so it sits outside any
 * try/catch.
 *
 * **The location is a link, never an embed** (D-203, T-06-18): an `<a>` to the universal maps search
 * URL, opened by the member's tap in a new context. No iframe, no static map, no SDK.
 *
 * **06-04 — the manager's doors (UI-D-211).** Below the hero card, `SectionTitle` "Gerenciar evento"
 * and a `Card` of link rows, each gated on its own composed PERMISSION (never a role): "Editar evento"
 * on `events.event.manage` (06-07 adds "Participantes" above it). No permission, no section. In the
 * cancelled banner, the same permission plus "before the start" (from THIS request's instant) adds the
 * outline "Reativar evento". Cancel itself lives only at the bottom of the edit form.
 */
export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const [t, bootstrap, result] = await Promise.all([
    getTranslations('events'),
    requireBootstrap(),
    loadEvent(eventId),
  ]);

  if (result.status === 'not-found') notFound();

  if (result.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-4">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={t('errors.title')}
          body={t('errors.generic')}
          action={
            <a
              href={`/eventos/${encodeURIComponent(eventId)}`}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
            >
              {t('errors.retry')}
            </a>
          }
        />
      </div>
    );
  }

  // ONE clock read for the whole page: every relative label comes from the same instant.
  const nowMs = Date.now();
  const view = eventDetailView(result.event, { tz: bootstrap.tenant.timezone, nowMs, t });
  const canManage = bootstrap.permissions.includes(EVENT_PERMISSIONS.manage);
  const canReactivate = canManage && view.cancelled && nowMs < Date.parse(result.event.startsAt);

  return (
    <div className="mx-auto w-full max-w-[680px] pb-6">
      <PageHeader
        backHref="/eventos"
        backLabel={t('detail.back')}
        title={view.title}
        trailing={
          view.headerPill ? (
            <StatusPill
              data-testid="event-header-pill"
              tone={view.headerPill.tone}
              className="mr-2 shrink-0"
            >
              {view.headerPill.label}
            </StatusPill>
          ) : undefined
        }
      />
      <EventRefresh>
        <div className="px-4 pt-4">
          <Card>
            <EventHero
              title={view.title}
              overline={view.hero.overline}
              place={view.hero.place}
              placeKind={view.hero.placeKind}
              coverAssetId={view.hero.coverAssetId}
              coverVariantWidths={view.hero.coverVariantWidths}
              coverAlt={view.hero.coverAlt}
            />
            <div className="flex flex-col gap-4 p-4">
              {view.banner ? (
                <EventBanner
                  banner={view.banner}
                  action={
                    canReactivate ? <ReactivateEventControl eventId={result.event.id} /> : null
                  }
                />
              ) : null}
              {view.description.length > 0 ? (
                <EventDescription
                  text={view.description}
                  moreLabel={t('detail.more')}
                  lessLabel={t('detail.less')}
                />
              ) : null}
              <EventInfoGrid layout="grid" cells={view.info} ariaLiveIndex={view.countIndex} />
              {view.location ? <EventLocation location={view.location} /> : null}
              {/* The action zone (UI-D-207): the RSVP rows and, in person in P1/P2, the brand
                  "Fazer check-in" link to /check-in (06-05); 06-06 adds `Entrar`. */}
              <EventActions {...eventActionState(result.event, view)} />
            </div>
          </Card>
        </div>
        {canManage ? (
          <section aria-labelledby="event-manage-title" data-event-manage>
            <SectionTitle id="event-manage-title" className="mt-6 mb-2 px-4">
              {t('manage.title')}
            </SectionTitle>
            <Card className="mx-4">
              <a
                href={`/eventos/${encodeURIComponent(result.event.id)}/editar`}
                data-event-manage-edit
                className="flex min-h-14 items-center gap-3 px-4 text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
              >
                <Pencil aria-hidden size={20} className="shrink-0 text-text-secondary" />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">
                  {t('manage.edit')}
                </span>
                <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
              </a>
            </Card>
          </section>
        ) : null}
      </EventRefresh>
    </div>
  );
}

/**
 * The banner at the top of the card body: cancelled (danger, UI-D-202) or checked in (UI-D-207). The
 * `action` slot carries the manager's "Reativar evento" on a cancelled event before its start.
 */
function EventBanner({
  banner,
  action,
}: {
  banner: NonNullable<EventDetailView['banner']>;
  action?: ReactNode;
}) {
  const cancelled = banner.kind === 'cancelled';
  const Icon = cancelled ? CalendarX2 : CircleCheck;
  return (
    <div
      data-testid="event-banner"
      data-kind={banner.kind}
      className={
        cancelled
          ? 'flex gap-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-3'
          : 'flex gap-3 rounded-xl border border-success/30 bg-success/10 px-3 py-3'
      }
    >
      <Icon
        size={20}
        aria-hidden
        className={cancelled ? 'shrink-0 text-danger' : 'shrink-0 text-success'}
      />
      <div className="min-w-0">
        <p className="text-sm font-bold text-text">{banner.title}</p>
        <p
          className={
            cancelled
              ? 'break-words text-xs text-text-secondary'
              : 'break-words text-xs text-text-tertiary'
          }
        >
          {banner.body}
        </p>
        {action ? <div className="mt-3 flex">{action}</div> : null}
      </div>
    </div>
  );
}

/** The in-person location block (UI-D-205): venue, address, and the outbound maps link. */
function EventLocation({ location }: { location: NonNullable<EventDetailView['location']> }) {
  return (
    <div data-testid="event-location" className="flex flex-col gap-3">
      <div className="min-w-0">
        <p className="break-words text-sm font-bold text-text">{location.venue}</p>
        <p className="whitespace-pre-line break-words text-sm text-text-secondary">
          {location.address}
        </p>
      </div>
      <a
        href={location.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={location.ariaLabel}
        data-testid="event-maps-link"
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <Navigation size={16} aria-hidden className="shrink-0" />
        {location.label}
      </a>
    </div>
  );
}
