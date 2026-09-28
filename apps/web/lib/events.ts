import {
  type AttendanceList,
  type AttendancePage,
  type AttendanceSummary,
  attendancePageSchema,
  attendanceSummarySchema,
  type CheckinCode,
  type CheckinResult,
  checkinCodeSchema,
  checkinResultSchema,
  type EnterResult,
  EVENT_PAGE_SIZE,
  type EventDetail,
  type EventEdit,
  type EventInput,
  type EventPage,
  type EventPeriod,
  type EventStatus,
  type EventSummary,
  enterResultSchema,
  eventDetailSchema,
  eventEditSchema,
  eventPageSchema,
  eventSummarySchema,
  nextEventSchema,
  type RsvpAnswer,
  type RsvpResult,
  rsvpResultSchema,
} from '@rede-social/module-events/contracts';
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
 * `GET /v1/events/next` (06-08, D-202): the Início card's ONE event, or `null` — for "nothing coming"
 * AND for every failure. The home slot must never be the reason `/inicio` shows an error card (the
 * stories-strip rule, UI E09/error), so this read swallows everything: a refusal, a 5xx, a transport
 * error or a body that fails the contract all log `events.next_failed` with their SHAPE only (a
 * status and a code, never a title) and answer `null`, and it never navigates. A session problem is
 * the page's own bootstrap to handle.
 */
export async function loadNextEvent(): Promise<EventSummary | null> {
  try {
    const res = await apiFetch('/v1/events/next');
    if (!res.ok) {
      const error = await apiError(res);
      console.error('events.next_failed', { status: res.status, code: error.code });
      return null;
    }
    const parsed = nextEventSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.error('events.next_failed', { status: res.status, code: 'INVALID_BODY' });
      return null;
    }
    return parsed.data.event;
  } catch (error) {
    console.error('events.next_failed', { error: String(error) });
    return null;
  }
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

/**
 * `POST /v1/events/{eventId}/check-in { code }` (06-05, EVENT-04 in person): the member types the
 * code the organiser reads aloud. The comparison, the window, the walk-in rule and the guess bound all
 * run inside Postgres (`app.events_check_in`), so this call never pre-checks anything. A refusal is
 * thrown as an `ApiClientError` carrying `details.event` (`wrong_code`, `too_many_attempts`,
 * `checkin_not_open`, `checkin_closed`, `cancelled` on a 409; nothing on the bare 404), which
 * `checkInEventAction` maps to a code. The answer never carries the code (T-06-31).
 */
export async function checkIn(eventId: string, code: string): Promise<CheckinResult> {
  const res = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}/check-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw await apiError(res);
  return checkinResultSchema.parse(await res.json());
}

/* ── 06-06: the online `Entrar` (EVENT-04 online, D-207, D-210, D-218) ──────────────────────── */

/** `enterEvent`'s answer: the gate's result, the ONE not-found, a bootstrap refusal, or a failure. */
export type EnterEventResult =
  | { status: 'ok'; result: EnterResult }
  | { status: 'not-found' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `POST /v1/events/{eventId}/enter` (06-06): the API half of `Entrar`. The gate, the window and the
 * online check-in all run inside Postgres (`app.events_enter`); this call pre-checks nothing.
 *
 * The answer is an API-to-BFF contract (`enterResultSchema`): ONLY the `/entrar` route handler calls
 * this, on the server, and turns a passing outcome into a 303. The meeting URL is never logged here
 * and never handed to a page (D-207, T-06-35). A 404 or 400 is the ONE `not-found` (D-23); a refusal
 * `bootstrapRedirectPath` knows (401, blocked, host mismatch…) is returned as a path for the route
 * handler to redirect to, because a route handler answers with a `Response` rather than `redirect()`.
 */
export async function enterEvent(eventId: string): Promise<EnterEventResult> {
  try {
    const res = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}/enter`, {
      method: 'POST',
    });
    if (res.ok) {
      const parsed = enterResultSchema.safeParse(await res.json());
      if (parsed.success) return { status: 'ok', result: parsed.data };
      // The body is deliberately NOT logged: a malformed passing answer may still carry the URL.
      console.error('events.enter_failed', { status: res.status, code: 'INVALID_BODY' });
      return { status: 'error' };
    }
    if (res.status === 404 || res.status === 400) return { status: 'not-found' };
    const error = await apiError(res);
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    console.error('events.enter_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('events.enter_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/* ── EVENT-01's admin half (06-04): create, the edit read, replace, cancel / reactivate ────────── */

/**
 * `POST /v1/events`. The body is the admin's WALL CLOCK (`{ date, time }` pairs in the tenant's
 * zone); the API converts it inside the insert, so nothing here touches a timezone. A refusal is
 * thrown as an `ApiClientError` carrying `details.event`, which `createEventAction` maps to a key.
 */
export async function createEvent(input: EventInput): Promise<EventSummary> {
  const res = await apiFetch('/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiError(res);
  return eventSummarySchema.parse(await res.json());
}

/** `loadEventForEdit`'s answer, the `loadEvent` union over the edit shape. */
export type EventEditResult =
  | { status: 'ok'; event: EventEdit }
  | { status: 'not-found' }
  | { status: 'error' };

/**
 * `GET /v1/events/{eventId}/edit` (manage only): the event with its instants converted back to the
 * TENANT's wall clock by the database, plus the admin-only meeting URL. The web never converts a
 * timezone. A 404, a 400 (not a uuid) and a 403 (no manage permission: the route already checked it,
 * so this only happens on a race with a role change) collapse into `not-found`, the one screen.
 */
export async function loadEventForEdit(eventId: string): Promise<EventEditResult> {
  let path: string | null = null;
  let result: EventEditResult = { status: 'error' };
  try {
    const res = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}/edit`);
    if (res.ok) {
      result = { status: 'ok', event: eventEditSchema.parse(await res.json()) };
    } else if (res.status === 404 || res.status === 400) {
      result = { status: 'not-found' };
    } else {
      const error = await apiError(res);
      path = bootstrapRedirectPath(error);
      if (!path && res.status === 403) result = { status: 'not-found' };
      if (!path && res.status !== 403) {
        console.error('events.edit_read_failed', { status: res.status, code: error.code });
      }
    }
  } catch (error) {
    console.error('events.edit_read_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return result;
}

/**
 * `PUT /v1/events/{eventId}`: the whole-event replacement (D-214) with the create's own body. The
 * answer is the member-facing summary, which has no URL key.
 */
export async function updateEvent(eventId: string, input: EventInput): Promise<EventSummary> {
  const res = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiError(res);
  return eventSummarySchema.parse(await res.json());
}

/**
 * `PATCH /v1/events/{eventId} { status }`: cancel (`cancelled`) or reactivate (`active`). The API
 * decides WHEN (`409 event_ended` / `reactivate_started`); this call never consults the clock.
 */
export async function setEventStatus(eventId: string, status: EventStatus): Promise<EventSummary> {
  const res = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw await apiError(res);
  return eventSummarySchema.parse(await res.json());
}

/* ── EVENT-05: the organiser's Participantes (06-07) ─────────────────────────────────────────────── */

/** The query the page and its actions send; `cursor` is OPAQUE and forwarded verbatim. */
export type AttendanceQueryInput = { list: AttendanceList; cursor?: string; limit?: number };

/**
 * `GET /v1/events/{eventId}/attendance` (admin only, `events.attendance.read`). `list` is always sent
 * explicitly (the API's closed enum; the web translates its own pt-BR `?lista=`). Throws an
 * `ApiClientError` on any refusal, for the actions to map.
 */
export async function getAttendance(
  eventId: string,
  query: AttendanceQueryInput,
): Promise<AttendancePage> {
  const search = new URLSearchParams();
  search.set('list', query.list);
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? EVENT_PAGE_SIZE));
  const res = await apiFetch(
    `/v1/events/${encodeURIComponent(eventId)}/attendance?${search.toString()}`,
  );
  if (!res.ok) throw await apiError(res);
  return attendancePageSchema.parse(await res.json());
}

/**
 * Page 1 of one chip for the RSC page, or `null` when the API could not answer (the list then renders
 * its own first-load error while the code card still shows). A bootstrap refusal becomes a navigation
 * OUTSIDE the try/catch (`redirect()` throws in Next 16).
 */
export async function loadAttendance(
  eventId: string,
  list: AttendanceList,
): Promise<AttendancePage | null> {
  let path: string | null = null;
  let page: AttendancePage | null = null;
  try {
    page = await getAttendance(eventId, { list });
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    // Shape only: a member's name never reaches a log line.
    if (!path) console.error('events.attendance_failed', { list, error: String(error) });
  }

  if (path) redirect(path);
  return page;
}

/** `loadAttendanceSummary`'s answer: the counts and the code, the ONE not-found, or a failure. */
export type AttendanceSummaryResult =
  | { status: 'ok'; summary: AttendanceSummary }
  | { status: 'not-found' }
  | { status: 'error' };

/**
 * `GET /v1/events/{eventId}/attendance/summary` (admin only): the chip counts and the door code in
 * one read. A 404 (unknown, another tenant's, removed), a 400 (not a uuid) and a 403 (the permission
 * vanished between the bootstrap and this read) collapse into `not-found`, the one screen (D-23).
 * The code is never logged.
 */
export async function loadAttendanceSummary(eventId: string): Promise<AttendanceSummaryResult> {
  let path: string | null = null;
  let result: AttendanceSummaryResult = { status: 'error' };
  try {
    const res = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}/attendance/summary`);
    if (res.ok) {
      result = { status: 'ok', summary: attendanceSummarySchema.parse(await res.json()) };
    } else if (res.status === 404 || res.status === 400) {
      result = { status: 'not-found' };
    } else {
      const error = await apiError(res);
      path = bootstrapRedirectPath(error);
      if (!path && res.status === 403) result = { status: 'not-found' };
      if (!path && res.status !== 403) {
        console.error('events.attendance_summary_failed', { status: res.status, code: error.code });
      }
    }
  } catch (error) {
    console.error('events.attendance_summary_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return result;
}

/**
 * `POST /v1/events/{eventId}/checkin-code` (manage only, D-217): replaces the door code. A POST from a
 * server action only, never a GET a prefetch could follow. Throws an `ApiClientError` on refusal.
 */
export async function regenerateCode(eventId: string): Promise<CheckinCode> {
  const res = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}/checkin-code`, {
    method: 'POST',
  });
  if (!res.ok) throw await apiError(res);
  return checkinCodeSchema.parse(await res.json());
}
