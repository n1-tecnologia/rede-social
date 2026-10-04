import { EVENT_PERMISSIONS } from '@rede-social/module-events/contracts';
import { notFound } from 'next/navigation';
import { EventForm } from '@/app/(app)/eventos/EventForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadEventForEdit } from '@/lib/events';
import { tenantZoneLabel } from '@/lib/events-view';

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
 */
export default async function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(EVENT_PERMISSIONS.manage)) notFound();

  const result = await loadEventForEdit(eventId);
  if (result.status !== 'ok') notFound();
  const event = result.event;

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
        category: event.category ?? '',
        capacity: event.capacity,
        format: event.format,
        venueName: event.venueName ?? '',
        address: event.address ?? '',
        meetingUrl: event.meetingUrl ?? '',
        start: event.start,
        end: event.end,
      }}
      tenantName={bootstrap.tenant.displayName}
      zoneLabel={tenantZoneLabel(bootstrap.tenant.timezone)}
      canCancel={!cancelled && !ended}
      canReactivate={cancelled && !started}
      cancelledLocked={cancelled && started}
    />
  );
}
