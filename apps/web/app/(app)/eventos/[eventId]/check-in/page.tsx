import { EventTicket } from '@rede-social/module-events/ui';
import { EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert, Ticket } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadEvent } from '@/lib/events';
import { eventTicketView } from '@/lib/events-view';
import { CheckinForm } from './CheckinForm';
import { CheckinState } from './CheckinState';

/**
 * `/eventos/[eventId]/check-in` (EVENT-04 in person, UI-D-208, sketch 006 surface 3) — the
 * prototype's boarding pass, ported, with the typed venue code as its main content.
 *
 * A ROUTE, not a sheet: the detail's "Fazer check-in" (and 06-08's Início card) reach it with one
 * `<a>`, and it survives the back gesture.
 *
 * **In person only.** An online event is checked in by `Entrar` (06-06, D-210), so its `/check-in`
 * is the events not-found screen, exactly like an unknown id, another tenant's event or a malformed
 * id (D-23): `loadEvent`'s single `not-found`, then `notFound()`, outside any try/catch.
 *
 * **ONE request instant** decides the bottom section (`eventTicketView`): done, cancelled, closed,
 * not open yet (with "…, às 18:00" or "…, em {date}, às 18:00"), or the code form. It only decides
 * what to DRAW: whether a check-in lands is `app.events_check_in`'s call, and a race (the window
 * closes or the event is cancelled while the member types) comes back as the form's inline refusal,
 * then a refresh swaps in the state. Every string is built on the server in the TENANT's timezone.
 *
 * **Presence is never recorded by rendering** (the plan's prohibition): this page only reads. The
 * one write is the form's submit, with the code the organiser announced.
 */
export default async function CheckinPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const [t, bootstrap, result] = await Promise.all([
    getTranslations('events'),
    requireBootstrap(),
    loadEvent(eventId),
  ]);

  if (result.status === 'not-found') notFound();
  if (result.status === 'ok' && result.event.format !== 'in_person') notFound();

  const detailHref = `/eventos/${encodeURIComponent(eventId)}`;

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
              href={`${detailHref}/check-in`}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
            >
              {t('errors.retry')}
            </a>
          }
        />
      </div>
    );
  }

  // ONE clock read for the whole page.
  const view = eventTicketView(result.event, {
    tz: bootstrap.tenant.timezone,
    nowMs: Date.now(),
    t,
  });

  return (
    <div className="mx-auto w-full max-w-[680px] pb-6">
      <PageHeader backHref={detailHref} backLabel={t('checkin.back')} title={t('checkin.title')} />
      <div className="pt-2">
        <EventTicket
          title={view.title}
          overline={view.overline}
          place={view.place}
          coverAssetId={view.coverAssetId}
          coverVariantWidths={view.coverVariantWidths}
          coverAlt={view.coverAlt}
          cells={view.cells}
        >
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
      </div>
    </div>
  );
}
