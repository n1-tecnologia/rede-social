import { EVENT_PERMISSIONS, type EventTicketAdmin } from '@rede-social/module-events/contracts';
import { PAYMENTS_PERMISSIONS } from '@rede-social/module-payments/contracts';
import { notFound } from 'next/navigation';
import { EventForm } from '@/app/(app)/eventos/EventForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { eventFormTicket } from '@/lib/event-ticket';
import { loadEvent, loadEventForEdit } from '@/lib/events';
import { tenantZoneLabel } from '@/lib/events-view';
import { loadTicketIntegration } from '@/lib/payments';

/**
 * `/eventos/[eventId]/editar` (EVENT-01, D-214, UI-D-212) — the edit half of the SAME form.
 *
 * **Permission first, then the manage-only read.** Without `events.event.manage` (the composed
 * permission, never a role) this is the events not-found screen (UI E07/error), and the edit read is
 * never requested. The read (`GET /v1/events/{id}/edit`) returns the stored instants converted back to
 * the TENANT's wall clock by the database, plus the admin-only meeting URL, so the form arrives filled
 * on first paint and the web converts no timezone (UI E10/populated).
 *
 * **Every miss is one screen**, and so is a read FAILURE: a form pre-filled with blanks would save
 * blanks over an event that is fine.
 *
 * **The bottom row's flags come from ONE request instant** (planning decision 4, UI-D-14):
 * `canCancel` (active and before the end), `canReactivate` (cancelled and before the start) and
 * `cancelledLocked` (cancelled and started). The client form reads no clock; the API re-decides both
 * transitions anyway (`409 event_ended` / `reactivate_started`).
 *
 * **The "Ingresso" section's facts** (Phase 10.1-11, UI-D-742, D-748): the edit read's `ticket` object
 * (the stored pair, `soldCount`, `gatewayOpen`, `gatewayName`, admin-only: an API that predates it, or a
 * caller who is not the admin, sends none and the form then draws no section and sends no price key),
 * the Pagamentos flag and permission off the bootstrap, the overview's connection for an event with no
 * product, and the confirmed count of the member-facing read for the "already confirmed" note.
 */
export default async function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(EVENT_PERMISSIONS.manage)) notFound();

  const result = await loadEventForEdit(eventId);
  if (result.status !== 'ok') notFound();
  const event = result.event;

  const moduleOn = bootstrap.modules.some((module) => module.key === 'payments');
  const canManagePayments = bootstrap.permissions.includes(PAYMENTS_PERMISSIONS.manage);
  const ticket =
    event.ticket === undefined
      ? undefined
      : await ticketFacts(event.id, event.ticket, moduleOn, canManagePayments);

  const nowMs = Date.now();
  const started = nowMs >= Date.parse(event.startsAt);
  const ended = nowMs >= Date.parse(event.endsAt);
  const cancelled = event.status === 'cancelled';

  return (
    <EventForm
      mode="edit"
      eventId={event.id}
      initial={{
        title: event.title,
        description: event.description,
        coverAssetId: event.coverAssetId,
        coverVariantWidths: event.coverVariantWidths,
        // 12.3-08: an API that predates the poster sends none: the form then sends `null`.
        posterAssetId: event.posterAssetId ?? null,
        posterVariantWidths: event.posterVariantWidths ?? [],
        category: event.category ?? '',
        capacity: event.capacity,
        format: event.format,
        venueName: event.venueName ?? '',
        address: event.address ?? '',
        meetingUrl: event.meetingUrl ?? '',
        start: event.start,
        end: event.end,
        // An API that predates the column sends none: the form then reads the legacy text schedule.
        schedule: event.schedule ?? [],
        ticketPriceCents: event.ticketPriceCents ?? null,
      }}
      tenantName={bootstrap.tenant.displayName}
      zoneLabel={tenantZoneLabel(bootstrap.tenant.timezone)}
      canCancel={!cancelled && !ended}
      canReactivate={cancelled && !started}
      cancelledLocked={cancelled && started}
      ticket={ticket}
    />
  );
}

/**
 * The section's server facts. The overview is asked only for an event with no product (a linked one
 * carries its own `gatewayOpen` and `gatewayName`) and only while the module is on and the viewer holds
 * `payments.manage`; the confirmed count reads the member-facing detail, and an unreadable one is "no
 * confirmed presences" (the D-748 note is a courtesy, never a reason to fail the page).
 */
async function ticketFacts(
  eventId: string,
  stored: EventTicketAdmin | null,
  moduleOn: boolean,
  canManagePayments: boolean,
) {
  const [integration, detail] = await Promise.all([
    loadTicketIntegration(stored === null && moduleOn && canManagePayments),
    loadEvent(eventId),
  ]);
  return eventFormTicket({
    moduleOn,
    canManagePayments,
    integration,
    edit: {
      ticket: stored,
      confirmedCount: detail.status === 'ok' ? detail.event.confirmedCount : 0,
    },
  });
}
