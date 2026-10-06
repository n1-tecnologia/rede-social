import { MediaImage } from '@rede-social/core/ui';
import { EVENT_PERMISSIONS } from '@rede-social/module-events/contracts';
import { EventHero, EventInfoGrid } from '@rede-social/module-events/ui';
import { Card, EmptyState, PageHeader, SectionTitle, StatusPill } from '@rede-social/ui';
import {
  Award,
  CalendarPlus,
  CalendarX2,
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Download,
  Pencil,
  Shirt,
  Ticket,
  Users,
} from 'lucide-react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { hasEventExtras } from '@/lib/event-extras';
import { loadEvent, loadEventPhotos } from '@/lib/events';
import { googleCalendarHref } from '@/lib/events-calendar';
import { type EventDetailView, eventActionState, eventDetailView } from '@/lib/events-view';
import { primaryHostOrigin } from '@/lib/tenant-host';
import { EventActions } from './EventActions';
import { EventDescription } from './EventDescription';
import { EventLocationMap } from './EventLocationMap';
import { EventPhotos } from './EventPhotos';
import { EventRefresh } from './EventRefresh';
import { EventSchedule } from './EventSchedule';
import { ReactivateEventControl } from './ReactivateEventControl';
import { RegistrationCard } from './RegistrationCard';

/**
 * `/eventos/[eventId]` (EVENT-02, UI-D-204), in the REINE prototype's shape since 2026-10-06 ("ao
 * acessar um evento deve ter a mesma visualização"). Front only: the API is untouched.
 *
 * Order, the prototype's:
 *  1. the sticky back header with the state pill ("Inscrito" green, "Participou", "Presente",
 *     "Cancelado");
 *  2. ONE hero `Card`: the 16/10 cover (the category in the button colour, "Faltam N dias · {date}",
 *     the title in the tenant's title font, `{venue} · {cidade}, {UF}`), then the body: the banner
 *     (cancelled or checked in), "Inscrição confirmada" for a member who is going (its ticket code,
 *     payment and invoice are EXAMPLES, tagged), "Você participou deste evento" once a check-in is
 *     over, the description, the info grid (Traje as its fourth cell when the organiser gave one) and
 *     the gold action zone (`EventActions`);
 *  3. "Como chegar" (in person): the Google Maps embed, its category filters and the list
 *     (`EventLocationMap`);
 *  4. for a member who is going: "Programação" (EXAMPLE, tagged) and "Bom saber" (the organiser's
 *     "Informações úteis", the form's step 2, stored in the description: `lib/event-extras.ts`);
 *  5. "Fotos do evento": the strip of an event that is over (members), the managed gallery
 *     (managers, `EventPhotos`);
 *  6. kept from before: the calendar pair (UI-D-210) and the manager's doors (UI-D-211).
 *
 * **Every string is built on the server** by `eventDetailView` in the TENANT's timezone from ONE
 * request instant (UI-D-203). **Members see a count, never who** (D-206). **Every miss is ONE
 * screen** (D-23): `notFound()` for an unknown, foreign or malformed id; a transport failure is the
 * retry screen below.
 */
export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const [t, bootstrap, result, photos] = await Promise.all([
    getTranslations('events'),
    requireBootstrap(),
    loadEvent(eventId),
    loadEventPhotos(eventId),
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
  const view = eventDetailView(result.event, {
    tz: bootstrap.tenant.timezone,
    nowMs,
    t,
    viewerId: bootstrap.user.id,
    tenantName: bootstrap.tenant.displayName,
  });
  const canManage = bootstrap.permissions.includes(EVENT_PERMISSIONS.manage);
  const canReadAttendance = bootstrap.permissions.includes(EVENT_PERMISSIONS.attendanceRead);
  const canReactivate = canManage && view.cancelled && nowMs < Date.parse(result.event.startsAt);
  const googleHref = view.calendar
    ? googleCalendarHref(result.event, { origin: await exportOrigin() })
    : null;
  const inForIt = view.registration !== null || view.schedule !== null;
  const photoItems = photos?.items ?? [];

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
              className="mr-2 shrink-0 uppercase"
            >
              {view.headerPill.label}
            </StatusPill>
          ) : undefined
        }
      />
      <EventRefresh>
        <div className="flex flex-col gap-6">
          <div className="px-4 pt-4">
            <Card>
              <EventHero
                title={view.title}
                overline={view.hero.overline}
                category={view.hero.category}
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
                {view.registration ? (
                  <RegistrationCard
                    title={t('reine.registration.title')}
                    line={t('reine.registration.line', { code: view.registration.ticketCode })}
                    invoiceLabel={t('reine.registration.invoice')}
                    invoiceNote={t('reine.registration.invoiceNote')}
                    exampleLabel={t('reine.example')}
                  />
                ) : null}
                {view.participation ? (
                  <div
                    data-testid="event-participation"
                    className="flex items-center gap-2.5 rounded-xl border border-brand/25 bg-brand/10 px-3 py-2.5"
                  >
                    <Award aria-hidden size={20} className="shrink-0 text-brand" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold leading-tight text-text">
                        {t('reine.participated.title')}
                      </p>
                      <p className="text-xs text-text-tertiary">{view.participation.line}</p>
                    </div>
                  </div>
                ) : null}
                {view.description.length > 0 ? (
                  <EventDescription
                    text={view.description}
                    moreLabel={t('detail.more')}
                    lessLabel={t('detail.less')}
                  />
                ) : null}
                <EventInfoGrid layout="grid" cells={view.info} ariaLiveIndex={view.countIndex} />
                {/* The gold action zone (REINE): register, the ticket, `Entrar` online, the
                    certificate. It never receives the meeting URL (D-207). */}
                <EventActions
                  {...eventActionState(result.event, view)}
                  certificate={Boolean(view.extras?.certificate)}
                />
              </div>
            </Card>
          </div>

          {view.map ? <EventLocationMap map={view.map} /> : null}

          {inForIt && view.schedule ? (
            <EventSchedule
              days={view.schedule}
              labels={{
                title: t('reine.schedule.title'),
                daysLabel: t('reine.schedule.daysLabel'),
                note: t('reine.schedule.note'),
                example: t('reine.example'),
              }}
            />
          ) : null}

          {inForIt && hasEventExtras(view.extras) ? <GoodToKnow view={view} t={t} /> : null}

          {canManage ? (
            <EventPhotos
              eventId={result.event.id}
              eventTitle={view.title}
              canManage={canManage}
              initialItems={photoItems}
              initialCursor={photos?.nextCursor ?? null}
              initialError={photos === null}
            />
          ) : view.past && photoItems.length > 0 ? (
            <section data-testid="event-photos-strip" aria-labelledby="event-photos-title">
              <div className="mb-3 flex items-center justify-between px-4">
                <h2
                  id="event-photos-title"
                  className="text-sm font-bold uppercase tracking-wider text-brand"
                >
                  {t('reine.photos.title')}
                </h2>
                <a
                  href={`/eventos/fotos?evento=${encodeURIComponent(result.event.id)}`}
                  className="flex items-center gap-0.5 text-xs font-semibold text-brand active:opacity-70"
                >
                  {t('reine.photos.gallery')}
                  <ChevronRight aria-hidden size={14} />
                </a>
              </div>
              <div className="flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {photoItems.map((photo, index) => (
                  <a
                    key={photo.id}
                    href={`/eventos/fotos?evento=${encodeURIComponent(result.event.id)}`}
                    aria-label={t('photos.open', { index: index + 1, total: photoItems.length })}
                    className="w-28 shrink-0 overflow-hidden rounded-xl active:opacity-80"
                  >
                    <MediaImage
                      assetId={photo.mediaAssetId}
                      widths={photo.variantWidths}
                      alt=""
                      sizes="112px"
                      ratio="aspect-square"
                      className="w-full"
                    />
                  </a>
                ))}
                <a
                  href={`/eventos/fotos?evento=${encodeURIComponent(result.event.id)}`}
                  className="flex aspect-square w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-bg-secondary text-brand active:opacity-80"
                >
                  <Camera aria-hidden size={20} />
                  <span className="text-[11px] font-semibold">{t('reine.photos.all')}</span>
                </a>
              </div>
            </section>
          ) : null}

          {googleHref !== null ? (
            <div className="px-4">
              <CalendarPair
                label={t('calendar.label')}
                googleLabel={t('calendar.google')}
                googleHref={googleHref}
                icsLabel={t('calendar.ics')}
                icsHref={`/eventos/${encodeURIComponent(result.event.id)}/agenda.ics`}
              />
            </div>
          ) : null}

          {canManage || canReadAttendance ? (
            <section aria-labelledby="event-manage-title" data-event-manage>
              <SectionTitle id="event-manage-title" className="mb-2 px-4">
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
        </div>
      </EventRefresh>
    </div>
  );
}

/**
 * REINE's "Bom saber": the organiser's "Informações úteis" (the form's step 2). Real values, never
 * examples: the dress code, what the ticket includes (chips), what to bring, the certificate.
 */
function GoodToKnow({
  view,
  t,
}: {
  view: EventDetailView;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const extras = view.extras;
  if (!extras) return null;
  return (
    <section data-testid="event-good-to-know" aria-labelledby="event-good-title" className="px-4">
      <h2
        id="event-good-title"
        className="mb-3 text-sm font-bold uppercase tracking-wider text-brand"
      >
        {t('reine.goodToKnow.title')}
      </h2>
      <Card className="flex flex-col gap-4 p-4">
        {extras.dressCode ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-text-secondary">
              <Shirt aria-hidden size={13} className="text-brand" />
              {t('reine.goodToKnow.dressCode')}
            </p>
            <p className="text-sm leading-relaxed text-text">{extras.dressCode}</p>
          </div>
        ) : null}
        {extras.included.length > 0 ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-text-secondary">
              <Ticket aria-hidden size={13} className="text-brand" />
              {t('reine.goodToKnow.included')}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {extras.included.map((item) => (
                <li
                  key={item}
                  className="inline-flex items-center gap-1 rounded-full bg-bg-input px-2.5 py-1 text-xs font-medium text-text-secondary"
                >
                  <Check aria-hidden size={11} className="text-brand" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {extras.bring.length > 0 ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-text-secondary">
              <CircleCheck aria-hidden size={13} className="text-brand" />
              {t('reine.goodToKnow.bring')}
            </p>
            <ul className="flex flex-col gap-1">
              {extras.bring.map((item) => (
                <li key={item} className="text-sm text-text">
                  · {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {extras.certificate ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-text-secondary">
              <Award aria-hidden size={13} className="text-brand" />
              {t('reine.goodToKnow.certificate')}
            </p>
            <p className="text-sm text-text">
              {extras.certificate.hours
                ? t('reine.goodToKnow.certificateHours', { hours: extras.certificate.hours })
                : t('reine.goodToKnow.certificateYes')}
            </p>
          </div>
        ) : null}
      </Card>
    </section>
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
