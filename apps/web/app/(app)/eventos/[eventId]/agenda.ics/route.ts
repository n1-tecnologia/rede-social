import { loadEvent } from '@/lib/events';
import { buildIcs } from '@/lib/events-calendar';
import { EVENT_ID_RE } from '@/lib/events-view';
import { primaryHostOrigin } from '@/lib/tenant-host';

/**
 * `GET /eventos/{eventId}/agenda.ics` (EVENT-06, D-211, UI-D-210): the event as an RFC 5545 file, the
 * "Arquivo .ics" half of the detail page's calendar pair (a same-origin `<a download>`).
 *
 * **A pure read (T-06-52).** The handler reads the event through the MEMBER LANE (`loadEvent`, the
 * detail page's own read: `GET /v1/events/{id}`, tenant-scoped by the API) and serialises it. It
 * writes nothing, calls no write endpoint and never redirects off-site, so a download, a repeat, a
 * prefetch or a framework fetch can never count a check-in: only following `/entrar` does (D-211).
 * That is why this handler carries no prefetch 204 (the 06-06 rule is for side-effecting or
 * externally-redirecting handlers); the three-parallel-downloads e2e pins "attendance unchanged".
 *
 * **Never the meeting URL (D-207, T-06-51).** The member-lane payload has no URL key; an online
 * event's LOCATION is `{origin}/eventos/{id}/entrar`, so the calendar entry goes through the gate.
 *
 * **Origin and UID host.** `origin` is the tenant's verified primary host (`primaryHostOrigin()`, the
 * share-link origin), falling back to the request's own origin on the local and generic shells;
 * `UID` is `{eventId}@{host of that origin}`.
 *
 * **Every miss is ONE 404** (D-23): a malformed id never reaches the API, and an unknown, removed or
 * another tenant's event is `loadEvent`'s single `not-found`. A transport failure is a 502; the
 * browser shows its own download error (UI E06/error). A bootstrap refusal (no session, blocked…)
 * is `loadEvent`'s own `redirect()` to the matching screen.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = 'private, no-store';

function miss(status: 404 | 502): Response {
  return new Response(null, { status, headers: { 'Cache-Control': NO_STORE } });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const { eventId } = await params;
  if (!EVENT_ID_RE.test(eventId)) return miss(404);

  const result = await loadEvent(eventId.toLowerCase());
  if (result.status === 'not-found') return miss(404);
  if (result.status === 'error') return miss(502);

  const origin = (await primaryHostOrigin()) ?? new URL(request.url).origin;
  const body = buildIcs(result.event, {
    origin,
    host: new URL(origin).host,
    nowMs: Date.now(),
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="evento.ics"',
      'Cache-Control': NO_STORE,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
