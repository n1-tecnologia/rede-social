import { EVENT_PERMISSIONS } from '@rede-social/module-events/contracts';
import { EventHero, EventInfoGrid } from '@rede-social/module-events/ui';
import { Card, EmptyState, PageHeader, SectionTitle, StatusPill } from '@rede-social/ui';
import {
  CalendarPlus,
  CalendarX2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Download,
  Navigation,
  Pencil,
  Users,
} from 'lucide-react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadEvent } from '@/lib/events';
import { googleCalendarHref } from '@/lib/events-calendar';
import { type EventDetailView, eventActionState, eventDetailView } from '@/lib/events-view';
import { primaryHostOrigin } from '@/lib/tenant-host';
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
 * (in person), then the action zone (`EventActions`: the RSVP pair of sketch 006; in person in
 * P1/P2, the "Fazer check-in" link to `/eventos/{id}/check-in`, 06-05; online, the plain `Entrar`
 * anchor to `/eventos/{id}/entrar`, 06-06 — no render of this page records anything, D-218). Dropped [proto]
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
 * and a `Card` of link rows, each gated on its own composed PERMISSION (never a role): "Participantes"
 * on `events.attendance.read` (06-07), with the sub-line "{n} confirmados · {m} presentes" built from
 * the SAME detail read's two count strings (UI E07: server-rendered with the page), then "Editar
 * evento" on `events.event.manage`. The section renders when the viewer holds either. No permission,
 * no section. In the
 * cancelled banner, the same permission plus "before the start" (from THIS request's instant) adds the
 * outline "Reativar evento". Cancel itself lives only at the bottom of the edit form.
 *
 * **06-08 — the calendar pair (UI-D-210, D-211, EVENT-06).** After the action zone, in P0-P2 for
 * EVERY member whatever their answer and never when cancelled or ended: "Adicionar à agenda", then
 * two outline anchors — "Google Agenda" (the template link built HERE, on the server, opened in a
 * new context) and "Arquivo .ics" (`download`, the same-origin `agenda.ics` route). Neither carries
 * the meeting URL: an online event's calendar location is the app's own `/entrar` (D-207).
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
  const canReadAttendance = bootstrap.permissions.includes(EVENT_PERMISSIONS.attendanceRead);
  const canReactivate = canManage && view.cancelled && nowMs < Date.parse(result.event.startsAt);
  const googleHref = view.calendar
    ? googleCalendarHref(result.event, { origin: await exportOrigin() })
    : null;

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
              {/* The action zone (UI-D-207): the RSVP rows; in person in P1/P2 the brand "Fazer
                  check-in" link to /check-in (06-05); online, the `Entrar` anchor to /entrar with its
                  hints (06-06, UI-D-209). The zone never receives the meeting URL (D-207). */}
              <EventActions {...eventActionState(result.event, view)} />
              {googleHref !== null ? (
                <CalendarPair
                  label={t('calendar.label')}
                  googleLabel={t('calendar.google')}
                  googleHref={googleHref}
                  icsLabel={t('calendar.ics')}
                  icsHref={`/eventos/${encodeURIComponent(result.event.id)}/agenda.ics`}
                />
              ) : null}
            </div>
          </Card>
        </div>
        {canManage || canReadAttendance ? (
          <section aria-labelledby="event-manage-title" data-event-manage>
            <SectionTitle id="event-manage-title" className="mt-6 mb-2 px-4">
              {t('manage.title')}
            </SectionTitle>
            <Card className="mx-4">
              {canReadAttendance ? (
                <a
                  href={`/eventos/${encodeURIComponent(result.event.id)}/participantes`}
                  data-event-manage-participants
                  className="flex min-h-14 items-center gap-3 px-4 py-2 text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
                >
                  <Users aria-hidden size={20} className="shrink-0 text-text-secondary" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-bold">{t('manage.participants')}</span>
                    <span
                      data-event-manage-participants-sub
                      className="truncate text-xs font-normal tabular-nums text-text-tertiary"
                    >
                      {t('manage.participantsSub', {
                        confirmed: t('count.confirmed', { count: result.event.confirmedCount }),
                        present: t('count.present', { count: result.event.presentCount }),
                      })}
                    </span>
                  </span>
                  <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
                </a>
              ) : null}
              {canManage ? (
                <a
                  href={`/eventos/${encodeURIComponent(result.event.id)}/editar`}
                  data-event-manage-edit
                  className={`flex min-h-14 items-center gap-3 px-4 text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset${canReadAttendance ? ' border-t border-divider' : ''}`}
                >
                  <Pencil aria-hidden size={20} className="shrink-0 text-text-secondary" />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    {t('manage.edit')}
                  </span>
                  <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
                </a>
              ) : null}
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

/**
 * The origin a calendar entry links back to: the tenant's verified primary host (the share-link
 * origin), or — on the local and generic shells, which have none — this request's own host, the same
 * fallback the `agenda.ics` route takes from its request URL.
 */
async function exportOrigin(): Promise<string> {
  const primary = await primaryHostOrigin();
  if (primary) return primary;
  const h = await headers();
  const host = h.get('host') ?? 'localhost';
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

/** `Button md outline`, as classes on a half-width anchor of the calendar pair. */
const CALENDAR_ANCHOR =
  'inline-flex h-11 w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * The calendar pair (UI-D-210): a 12/700 uppercase tertiary label, then two outline anchors. Both are
 * plain anchors with no in-page state (UI E06/loading): Google opens in a new tab, the `.ics` is a
 * browser download.
 *
 * **Stacked below `sm`, side by side from it (06-08 deviation, the 06-02 drawing's finding).** Two
 * `Button outline md` at half width do NOT fit a phone: measured in Chromium on this page, the half-
 * width anchor is 157px at 390 and 122px at 320, and "Google Agenda" (icon 16 + gap 8 + 14/700 label
 * inside `px-5`) wraps onto two lines at both widths ("Arquivo .ics" also wraps at 320). Full width,
 * each label sits on one line at 320; from `sm` (the 680px column) the half width is ~280px and the
 * pair sits side by side as UI-D-210 draws it. Existing breakpoint and scale only: no new token or
 * size. The `events agenda` e2e asserts one-line labels at 390 and 320 and the side-by-side row at
 * 700.
 */
function CalendarPair({
  label,
  googleLabel,
  googleHref,
  icsLabel,
  icsHref,
}: {
  label: string;
  googleLabel: string;
  googleHref: string;
  icsLabel: string;
  icsHref: string;
}) {
  return (
    <div data-testid="event-calendar">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-tertiary">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <a
          href={googleHref}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="event-calendar-google"
          className={CALENDAR_ANCHOR}
        >
          <CalendarPlus size={16} aria-hidden className="shrink-0" />
          {googleLabel}
        </a>
        <a href={icsHref} download data-testid="event-calendar-ics" className={CALENDAR_ANCHOR}>
          <Download size={16} aria-hidden className="shrink-0" />
          {icsLabel}
        </a>
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
