import { EVENT_PERMISSIONS } from '@rede-social/module-events/contracts';
import { PAYMENTS_PERMISSIONS } from '@rede-social/module-payments/contracts';
import { notFound } from 'next/navigation';
import { EventForm } from '@/app/(app)/eventos/EventForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { eventFormTicket } from '@/lib/event-ticket';
import { tenantZoneLabel } from '@/lib/events-view';
import { loadTicketIntegration } from '@/lib/payments';

/**
 * `/eventos/novo` (EVENT-01, UI-D-212) — the create half of the shared event form.
 *
 * **Authorisation is the composed PERMISSION, never a role** (T-06-19): `events.event.manage` read off
 * the bootstrap, the identical value the API's `requirePermission` evaluates. Without it this is the
 * events not-found screen (UI E01/error): a member hand-typing the URL learns nothing about an editor.
 * The API refuses a crafted write independently, which is what makes this UX, not the boundary.
 *
 * The route reads the session per request, which keeps it out of the static route list; `notFound()`
 * throws, so it sits outside any catch. The zone helper is computed HERE, on the server, from the
 * tenant's timezone, and passed down as a string (UI-D-14).
 *
 * **The "Ingresso" section's facts** (Phase 10.1-11, UI-D-742): the Pagamentos module flag and
 * `payments.manage` off the bootstrap, and the overview's gateway name and connection, read only while
 * the module is on AND the viewer holds the permission (the route's own guard). Anything unreadable is
 * the safe reading: not connected, the catalog's neutral gateway word.
 */
export default async function NewEventPage() {
  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(EVENT_PERMISSIONS.manage)) notFound();

  const moduleOn = bootstrap.modules.some((module) => module.key === 'payments');
  const canManagePayments = bootstrap.permissions.includes(PAYMENTS_PERMISSIONS.manage);
  const integration = await loadTicketIntegration(moduleOn && canManagePayments);

  return (
    <EventForm
      mode="create"
      tenantName={bootstrap.tenant.displayName}
      zoneLabel={tenantZoneLabel(bootstrap.tenant.timezone)}
      ticket={eventFormTicket({ moduleOn, canManagePayments, integration })}
    />
  );
}
