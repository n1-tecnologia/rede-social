import { EVENT_PERMISSIONS } from '@tria/module-events/contracts';
import { notFound } from 'next/navigation';
import { EventForm } from '@/app/(app)/eventos/EventForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { tenantZoneLabel } from '@/lib/events-view';

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
 */
export default async function NewEventPage() {
  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(EVENT_PERMISSIONS.manage)) notFound();

  return (
    <EventForm
      mode="create"
      tenantName={bootstrap.tenant.displayName}
      zoneLabel={tenantZoneLabel(bootstrap.tenant.timezone)}
    />
  );
}
