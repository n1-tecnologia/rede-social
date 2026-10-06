import type { EventSummary } from '@rede-social/module-events/contracts';
import { EventCover } from '@rede-social/module-events/ui';
import { Card, EmptyState } from '@rede-social/ui';
import { CalendarDays, Camera, CircleAlert, Clock, MapPin, QrCode, Ticket } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ExampleTag } from '@/components/events/ExampleTag';
import { requireBootstrap } from '@/lib/bootstrap';
import { splitEventDescription } from '@/lib/event-extras';
import { loadEvent, loadEventSections } from '@/lib/events';
import {
  eventCountdown,
  eventDateLabel,
  eventHours,
  eventPhase,
  eventPlaceLine,
  exampleTicketCode,
  formatHours,
} from '@/lib/events-view';
import { CertificateButton } from './CertificateButton';

/** How many past events the page reads in detail (for their certificate): the most recent ones. */
const PARTICIPATED_DETAILS = 10;

/**
 * `/eventos/meus` (2026-10-06, the REINE prototype's "Meus eventos" of the events menu): the three
 * numbers (events taken part in, hours of content, certificates), "Inscrito" (the events to come the
 * member is going to, each with its check-in) and "Participados" (the events they checked in to).
 *
 * Real: the events, the answers, the check-ins, the hours (`eventHours`) and whether an event has a
 * certificate (the organiser's "Informações úteis", read from each event's description). EXAMPLES,
 * tagged: the ticket code and the certificate file, which the system does not issue.
 */
export default async function MyEventsPage() {
  const [t, bootstrap, sections] = await Promise.all([
    getTranslations('events'),
    requireBootstrap(),
    loadEventSections(),
  ]);
  const tz = bootstrap.tenant.timezone;

  const head = (
    <div className="px-4 pt-4 pb-3">
      <h1 data-brand-title className="text-2xl font-bold text-text">
        {t('reine.mine.title')}
      </h1>
      <p className="mt-0.5 text-sm text-text-secondary">{t('reine.mine.subtitle')}</p>
    </div>
  );

  if (!sections) {
    return (
      <div className="mx-auto w-full max-w-[680px] pb-6">
        {head}
        <div className="px-4">
          <EmptyState
            variant="card"
            icon={CircleAlert}
            title={t('errors.title')}
            body={t('errors.generic')}
            action={
              <a
                href="/eventos/meus"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
              >
                {t('errors.retry')}
              </a>
            }
          />
        </div>
      </div>
    );
  }

  const nowMs = Date.now();
  const all = new Map<string, EventSummary>();
  for (const event of [...sections.upcoming, ...sections.past]) all.set(event.id, event);
  const events = [...all.values()];

  const registered = events
    .filter(
      (event) =>
        event.status !== 'cancelled' &&
        event.viewerStatus === 'going' &&
        eventPhase(event.startsAt, event.endsAt, nowMs) !== 'P3',
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const participated = events
    .filter(
      (event) =>
        event.viewerCheckedInAt !== null &&
        eventPhase(event.startsAt, event.endsAt, nowMs) === 'P3',
    )
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  // Whether each event taken part in has a certificate: its description's step-2 block.
  const details = await Promise.all(
    participated.slice(0, PARTICIPATED_DETAILS).map((event) => loadEvent(event.id)),
  );
  const certificateOf = new Map<string, boolean>();
  for (const result of details) {
    if (result.status !== 'ok') continue;
    certificateOf.set(
      result.event.id,
      splitEventDescription(result.event.description).extras?.certificate != null,
    );
  }

  const hours = participated.reduce((sum, event) => sum + eventHours(event, tz), 0);
  const certificates = [...certificateOf.values()].filter(Boolean).length;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col pb-6">
      {head}

      <div className="mb-6 px-4">
        <Card className="grid grid-cols-3 divide-x divide-border">
          <Stat value={String(participated.length)} label={t('reine.mine.stats.events')} />
          <Stat value={`${formatHours(hours)}h`} label={t('reine.mine.stats.hours')} />
          <Stat value={String(certificates)} label={t('reine.mine.stats.certificates')} />
        </Card>
      </div>

      <section aria-labelledby="mine-registered" className="mb-6">
        <h2
          id="mine-registered"
          className="mb-3 px-4 text-sm font-bold uppercase tracking-wider text-brand"
        >
          {t('reine.mine.registered')}
        </h2>
        <div className="flex flex-col gap-3 px-4">
          {registered.length > 0 ? (
            registered.map((event) => (
              <Card key={event.id} data-testid="mine-registered-card" className="overflow-hidden">
                <a
                  href={`/eventos/${encodeURIComponent(event.id)}`}
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
                >
                  <EventCover
                    geometry="ticket"
                    coverAssetId={event.coverAssetId}
                    coverVariantWidths={event.coverVariantWidths}
                    coverAlt={t('cover.alt', { title: event.title })}
                    overlay={
                      <CardOverlay
                        onPhoto
                        date={eventDateLabel(event, tz, nowMs, t)}
                        title={event.title}
                        place={eventPlaceLine(event, t)}
                      />
                    }
                    fallbackOverlay={
                      <CardOverlay
                        date={eventDateLabel(event, tz, nowMs, t)}
                        title={event.title}
                        place={eventPlaceLine(event, t)}
                      />
                    }
                  >
                    {event.category ? (
                      <span className="absolute top-3 left-3 max-w-[60%] truncate rounded-full bg-button bg-(image:--button-image) px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-on-button">
                        {event.category}
                      </span>
                    ) : null}
                    <span className="absolute top-3 right-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-black">
                      {eventCountdown(event, tz, nowMs, t)}
                    </span>
                  </EventCover>
                </a>
                <div className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
                      <Clock aria-hidden size={13} />
                      {t('reine.mine.contentHours', { hours: formatHours(eventHours(event, tz)) })}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                      {t('reine.mine.code', {
                        code: exampleTicketCode(
                          event.id,
                          bootstrap.user.id,
                          bootstrap.tenant.displayName,
                        ),
                      })}
                      <ExampleTag label={t('reine.example')} />
                    </span>
                  </div>
                  {event.format === 'in_person' ? (
                    <a
                      href={`/eventos/${encodeURIComponent(event.id)}/check-in`}
                      className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) active:opacity-80"
                    >
                      <QrCode aria-hidden size={16} />
                      {t('reine.mine.checkin')}
                    </a>
                  ) : null}
                </div>
              </Card>
            ))
          ) : (
            <Empty
              icon={<Ticket aria-hidden size={22} />}
              title={t('reine.mine.emptyRegisteredTitle')}
              body={t('reine.mine.emptyRegisteredBody')}
              cta={{ href: '/eventos', label: t('reine.mine.explore') }}
            />
          )}
        </div>
      </section>

      <section aria-labelledby="mine-participated">
        <h2
          id="mine-participated"
          className="mb-3 px-4 text-sm font-bold uppercase tracking-wider text-brand"
        >
          {t('reine.mine.participated')}
        </h2>
        <div className="flex flex-col gap-3 px-4">
          {participated.length > 0 ? (
            participated.map((event) => (
              <Card key={event.id} data-testid="mine-participated-card">
                <a
                  href={`/eventos/${encodeURIComponent(event.id)}`}
                  className="flex items-center gap-3 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
                >
                  <EventCover
                    geometry="thumb"
                    coverAssetId={event.coverAssetId}
                    coverVariantWidths={event.coverVariantWidths}
                    coverAlt=""
                  />
                  <span className="min-w-0 flex-1">
                    {event.category ? (
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-brand">
                        {event.category}
                      </span>
                    ) : null}
                    <span className="mt-0.5 line-clamp-2 block text-sm font-bold leading-snug text-text">
                      {event.title}
                    </span>
                    <span className="mt-1 flex items-center gap-3 text-xs text-text-tertiary">
                      <span className="flex items-center gap-1">
                        <CalendarDays aria-hidden size={11} />
                        {eventDateLabel(event, tz, nowMs, t)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock aria-hidden size={11} />
                        {`${formatHours(eventHours(event, tz))}h`}
                      </span>
                    </span>
                  </span>
                </a>
                <div className="flex items-center gap-2 px-3 pb-3">
                  {certificateOf.get(event.id) ? (
                    <CertificateButton
                      label={t('reine.mine.certificate')}
                      note={t('reine.mine.certificateNote')}
                      exampleLabel={t('reine.example')}
                    />
                  ) : null}
                  <a
                    href={`/eventos/fotos?evento=${encodeURIComponent(event.id)}`}
                    className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-bg-input text-xs font-semibold text-text transition-opacity active:opacity-80"
                  >
                    <Camera aria-hidden size={14} />
                    {t('reine.mine.photos')}
                  </a>
                </div>
              </Card>
            ))
          ) : (
            <Empty
              icon={<CalendarDays aria-hidden size={22} />}
              title={t('reine.mine.emptyParticipatedTitle')}
              body={t('reine.mine.emptyParticipatedBody')}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 py-4 text-center">
      <span className="text-2xl font-extrabold leading-none text-brand tabular-nums">{value}</span>
      <span className="mt-1.5 text-[10px] font-bold uppercase leading-tight tracking-wider text-text-tertiary">
        {label}
      </span>
    </div>
  );
}

function CardOverlay({
  date,
  title,
  place,
  onPhoto = false,
}: {
  date: string;
  title: string;
  place: string;
  onPhoto?: boolean;
}) {
  // White over the photo's veil; over the gradient, the brand ink the cover sets.
  return (
    <div className={`absolute right-4 bottom-3 left-4${onPhoto ? ' text-white' : ''}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">{date}</p>
      <p className="mt-0.5 line-clamp-2 text-base font-bold leading-snug">{title}</p>
      <p className="mt-1 flex items-center gap-1 text-xs opacity-85">
        <MapPin aria-hidden size={12} className="shrink-0" />
        <span className="min-w-0 truncate">{place}</span>
      </p>
    </div>
  );
}

function Empty({
  icon,
  title,
  body,
  cta,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-8 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg-input text-brand">
        {icon}
      </span>
      <p className="text-sm font-bold text-text">{title}</p>
      <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-text-secondary">{body}</p>
      {cta ? (
        <a
          href={cta.href}
          className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-button bg-(image:--button-image) px-5 text-xs font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover)"
        >
          {cta.label}
        </a>
      ) : null}
    </Card>
  );
}
