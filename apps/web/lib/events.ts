import {
  EVENT_PAGE_SIZE,
  type EventDetail,
  type EventPage,
  type EventPeriod,
  eventDetailSchema,
  eventPageSchema,
  type RsvpAnswer,
  type RsvpResult,
  rsvpResultSchema,
} from '@tria/module-events/contracts';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The ONE events fetch implementation (the `getCommunities` rule, D-58). The `/eventos` RSC page and
 * its load-more and refresh actions all read THIS, so the page and its pagination can never disagree
 * about the page size, the period or the tenant the request is scoped to.
 *
 * The browser never talks to Supabase for event data: every read goes through `apiFetch` to the Hono
 * API, which re-verifies the token and re-reads the membership row on every request.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code — every caller's refusal handling is the same.
  }
  return new ApiClientError(res.status, code, details);
}

/** The query the page and its actions send; `cursor` is OPAQUE and forwarded verbatim. */
export type EventQueryInput = { period: EventPeriod; cursor?: string; limit?: number };

/**
 * `GET /v1/events` (EVENT-02). `period` is always sent explicitly (the API's closed enum); `limit`
 * defaults to `EVENT_PAGE_SIZE` and the API clamps it anyway. The cursor is passed through untouched.
 */
export async function getEvents(query: EventQueryInput): Promise<EventPage> {
  const search = new URLSearchParams();
  search.set('period', query.period);
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? EVENT_PAGE_SIZE));

  const res = await apiFetch(`/v1/events?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return eventPageSchema.parse(await res.json());
}

/**
 * One page of events, or `null` when the API could not answer — the list then renders its own error
 * state rather than taking the whole tab down. A refusal `bootstrapRedirectPath` knows (401, blocked,
 * suspended, host mismatch, no membership) becomes a navigation, performed OUTSIDE the try/catch:
 * `redirect()` throws in Next 16 and a catch would swallow it.
 */
export async function loadEvents(query: EventQueryInput): Promise<EventPage | null> {
  let path: string | null = null;
  let page: EventPage | null = null;
  try {
    page = await getEvents(query);
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    // Shape only: a title is member-facing content and never reaches a log line.
    if (!path) console.error('events.list_failed', { period: query.period, error: String(error) });
  }

  if (path) redirect(path);
  return page;
}

/** `loadEvent`'s answer: the event, the ONE not-found (D-23), or "we could not reach the server". */
export type EventResult =
  | { status: 'ok'; event: EventDetail }
  | { status: 'not-found' }
  | { status: 'error' };

/**
 * `GET /v1/events/{eventId}` (EVENT-02), the `loadCommunity` shape. The API answers ONE bare 404 for
 * an unknown, another tenant's or a removed event, and a 400 for an id that is not a uuid: both
 * collapse into `not-found`, so the page renders one screen for all of them. A transport or 5xx
 * failure is `error`, a different screen. A refusal `bootstrapRedirectPath` knows becomes a
 * navigation OUTSIDE the try/catch (`redirect()` throws in Next 16).
 */
export async function loadEvent(eventId: string): Promise<EventResult> {
  let path: string | null = null;
  let result: EventResult = { status: 'error' };
  try {
    const res = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}`);
    if (res.ok) {
      result = { status: 'ok', event: eventDetailSchema.parse(await res.json()) };
    } else if (res.status === 404 || res.status === 400) {
      result = { status: 'not-found' };
    } else {
      const error = await apiError(res);
      path = bootstrapRedirectPath(error);
      if (!path) console.error('events.read_failed', { status: res.status, code: error.code });
    }
  } catch (error) {
    console.error('events.read_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return result;
}

/**
 * `PUT /v1/events/{eventId}/rsvp` (EVENT-03): the member's `Vou` / `Não vou`. The API writes ONE row
 * per member per event and the database's guard trigger is the only authority on whether the answer
 * is still allowed (D-204), so this call never pre-checks the clock. A refusal is thrown as an
 * `ApiClientError` carrying the envelope's `details` (`{ event: 'rsvp_closed' | 'cancelled' |
 * 'attendance_locked' }` on a 409, nothing on the bare 404), which `rsvpEventAction` maps to a
 * catalog key.
 */
export async function putRsvp(eventId: string, answer: RsvpAnswer): Promise<RsvpResult> {
  const res = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}/rsvp`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) throw await apiError(res);
  return rsvpResultSchema.parse(await res.json());
}
