import { EventTicket } from '@rede-social/module-events/ui';
import { EmptyState } from '@rede-social/ui';
import { ChevronRight, CircleAlert, QrCode, Ticket } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ExampleTag } from '@/components/events/ExampleTag';
import { PseudoQr } from '@/components/events/PseudoQr';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadEvent, loadEventSections } from '@/lib/events';
import { eventPhase, eventTicketView, exampleTicketCode } from '@/lib/events-view';
import { CheckinForm } from '../[eventId]/check-in/CheckinForm';
import { CheckinState } from '../[eventId]/check-in/CheckinState';

/**
 * `/eventos/check-in` (2026-10-06, the REINE prototype's "Check-in" screen of the events menu): the
 * ticket of the member's NEXT in-person event, the one they are going to (or already at), and the
 * REAL check-in of `/eventos/{id}/check-in` inside it: the member types the code the organisers
 * give at the venue. Above the form, the prototype's ticket QR and code: the system issues no
 * tickets, so both are EXAMPLES and wear the tag. No event to go to: the prototype's empty screen.
 */
export default async function NextCheckinPage() {
  const [t, bootstrap, sections] = await Promise.all([
    getTranslations('events'),
    requireBootstrap(),
    loadEventSections(),
  ]);

  const header = (subtitle: string) => (
    <div className="px-4 pt-4 pb-3">
      <h1 data-brand-title className="text-2xl font-bold text-text">
        {t('reine.checkinPage.title')}
      </h1>
      <p className="mt-0.5 text-sm text-text-secondary">{subtitle}</p>
    </div>
  );

  if (!sections) {
    return (
      <div className="mx-auto w-full max-w-[680px] pb-6">
        {header(t('reine.checkinPage.subtitle'))}
        <div className="px-4">
          <EmptyState
            variant="card"
            icon={CircleAlert}
            title={t('errors.title')}
            body={t('errors.generic')}
            action={
              <a
                href="/eventos/check-in"
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
  const next = sections.upcoming
    .filter(
      (event) =>
        event.format === 'in_person' &&
        event.status !== 'cancelled' &&
        (event.viewerStatus === 'going' || event.viewerCheckedInAt !== null) &&
        eventPhase(event.startsAt, event.endsAt, nowMs) !== 'P3',
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  const result = next ? await loadEvent(next.id) : null;

  if (!next || !result || result.status !== 'ok') {
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col pb-6">
        {header(t('reine.checkinPage.emptySubtitle'))}
        <div
          data-testid="checkin-empty"
          className="flex flex-col items-center px-8 py-12 text-center"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-bg-tertiary text-text-tertiary">
            <QrCode aria-hidden size={36} />
          </div>
          <h2 className="mt-5 text-lg font-bold text-text">{t('reine.checkinPage.emptyTitle')}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
            {t('reine.checkinPage.emptyBody')}
          </p>
          <a
            href="/eventos"
            className="mt-6 inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-button bg-(image:--button-image) px-6 text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) active:opacity-80"
          >
            {t('reine.checkinPage.seeEvents')}
            <ChevronRight aria-hidden size={16} />
          </a>
        </div>
      </div>
    );
  }

  const view = eventTicketView(result.event, {
    tz: bootstrap.tenant.timezone,
    nowMs,
    t,
  });
  const detailHref = `/eventos/${encodeURIComponent(view.id)}`;
  const code = exampleTicketCode(view.id, bootstrap.user.id, bootstrap.tenant.displayName);

  return (
    <div className="mx-auto w-full max-w-[680px] pb-6">
      {header(t('reine.checkinPage.subtitle'))}
      <EventTicket
        title={view.title}
        overline={view.overline}
        place={view.place}
        coverAssetId={view.coverAssetId}
        coverVariantWidths={view.coverVariantWidths}
        coverAlt={view.coverAlt}
        cells={view.cells}
      >
        <div data-testid="checkin-example-ticket" className="flex flex-col items-center pt-2 pb-5">
          <div className="rounded-2xl border border-border bg-white p-3 text-black shadow-sm">
            <PseudoQr code={code} />
          </div>
          <p className="mt-4 font-mono text-sm font-semibold tracking-[0.35em] text-text">{code}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-tertiary">
            {t('reine.ticket.codeLabel')}
            <ExampleTag label={t('reine.example')} />
          </p>
        </div>
        {view.section.kind === 'open' || view.section.kind === 'done' ? (
          <CheckinForm
            eventId={view.id}
            detailHref={detailHref}
            doneLine={view.section.kind === 'done' ? view.section.doneLine : null}
          />
        ) : (
          <CheckinState section={view.section} />
        )}
      </EventTicket>
      <p className="flex items-center justify-center gap-2 px-4 pt-4 text-center text-xs text-text-tertiary">
        <Ticket size={16} aria-hidden className="shrink-0" />
        {t('checkin.tip')}
      </p>
      <p className="pt-2 text-center">
        <a href={detailHref} className="text-xs font-semibold text-brand active:opacity-70">
          {t('reine.checkinPage.openEvent')}
        </a>
      </p>
    </div>
  );
}
