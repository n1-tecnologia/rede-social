'use server';

import {
  ATTENDANCE_LISTS,
  type AttendanceList,
  attendanceQuerySchema,
  type CheckinOutcome,
  checkinSchema,
  EVENT_ISSUE_SET,
  EVENT_PERIODS,
  type EventIssue,
  type EventPeriod,
  eventInputSchema,
  eventQuerySchema,
  type RsvpAnswer,
  rsvpSchema,
} from '@rede-social/module-events/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import {
  checkIn,
  createEvent,
  getAttendance,
  getEvents,
  loadEvent,
  putRsvp,
  regenerateCode,
  setEventStatus,
  updateEvent,
} from '@/lib/events';
import {
  type AttendeeView,
  attendeeView,
  checkedInLine,
  EVENT_ID_RE,
  type EventPosterView,
  eventPosterView,
} from '@/lib/events-view';

/**
 * The `/eventos` list's two actions (EVENT-02), the detail's RSVP action (EVENT-03), the ticket's
 * check-in action (EVENT-04, 06-05) and the admin's four write actions (EVENT-01, 06-04), below, in
 * the `comunidades/actions.ts` conventions: the SAME Zod the API validates with runs BEFORE the
 * request (a server action is a public endpoint), a 401/403 becomes a navigation OUTSIDE the
 * try/catch (Next 16: `redirect()` throws), and a refusal is answered with a catalog KEY rather than
 * pt-BR copy.
 *
 * Both return FINISHED poster views: every string is formatted here, on the server, in the tenant's
 * timezone from ONE `Date.now()` per action, so the client list never formats an instant and never
 * reads the clock in render (UI-D-203).
 *
 * The period is threaded through both actions (05.1 Pitfall 9): a pull or a scroll on Passados pages
 * the past keyset and never swaps the upcoming list in.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type EventsPageResult =
  | { ok: true; items: EventPosterView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/** Only the two closed values; anything else is refused before a request is built. */
const isPeriod = (value: unknown): value is EventPeriod =>
  typeof value === 'string' && (EVENT_PERIODS as readonly string[]).includes(value);

async function eventsPage(period: EventPeriod, cursor?: string): Promise<EventsPageResult> {
  const query = eventQuerySchema.safeParse({ period, cursor });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let loaded: Awaited<ReturnType<typeof getEvents>> | null = null;
  let tz = '';
  try {
    const [bootstrap, page] = await Promise.all([
      getBootstrap(),
      getEvents({ period: query.data.period, cursor: query.data.cursor, limit: query.data.limit }),
    ]);
    tz = bootstrap.tenant.timezone;
    loaded = page;
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('events.page_failed', { period, error: String(error) });
  }

  if (refusal) redirect(refusal);
  if (!loaded) return { ok: false, code: 'generic' };

  const t = await getTranslations('events');
  // ONE clock read per action: every relative label on the page comes from the same instant.
  const nowMs = Date.now();
  return {
    ok: true,
    items: loaded.items.map((event) => eventPosterView(event, { tz, nowMs, t })),
    nextCursor: loaded.nextCursor,
  };
}

/** One more page of the given period. The cursor is OPAQUE and forwarded untouched. */
export async function loadMoreEventsAction(
  period: EventPeriod,
  cursor: string,
): Promise<EventsPageResult> {
  if (!isPeriod(period)) return { ok: false, code: 'generic' };
  return eventsPage(period, cursor);
}

/** Page 1 of the given period again — what `PullToRefresh` calls. */
export async function refreshEventsAction(period: EventPeriod): Promise<EventsPageResult> {
  if (!isPeriod(period)) return { ok: false, code: 'generic' };
  return eventsPage(period);
}

/* ── EVENT-03: the member's answer (06-03) ─────────────────────────────────────────────────────── */

/**
 * What an RSVP write can answer. Every refusal is a catalog-mapped CODE, never pt-BR copy: the three
 * the database decides (D-204, via the guard trigger and the API's `details.event`) and `failed` for
 * everything else, a bare 404 included (the event vanished or was never the caller's, D-23).
 */
export type RsvpActionResult =
  | { ok: true; status: RsvpAnswer }
  | { ok: false; error: 'rsvp_closed' | 'cancelled' | 'attendance_locked' | 'failed' };

const RSVP_REFUSALS = new Set(['rsvp_closed', 'cancelled', 'attendance_locked']);

/**
 * `PUT /v1/events/{id}/rsvp` for the detail page's `SegmentedControl` (D-205, UI-D-206), in the
 * `comunidades/actions.ts` conventions:
 *
 *  1. **The SAME Zod the API validates with runs first** (`rsvpSchema`): a server action is a public
 *     endpoint, so a crafted answer (`checked_in`, say) is refused before any request is built. The
 *     member lane could not write it anyway (the self-only RLS policies, T-06-11).
 *  2. **The clock is never consulted here.** Whether the answer is still allowed is the database's
 *     call for every writer (the guard trigger, D-204); a late tap comes back as `rsvp_closed`.
 *  3. **`redirect()` sits OUTSIDE the try/catch** (Next 16: it throws), for the bootstrap refusals.
 *
 * On success the list is revalidated so a poster's count line is fresh on the way back; the island
 * refreshes the detail itself.
 */
export async function rsvpEventAction(
  eventId: string,
  answer: RsvpAnswer,
): Promise<RsvpActionResult> {
  const body = rsvpSchema.safeParse({ answer });
  if (!body.success || typeof eventId !== 'string' || eventId.length === 0) {
    return { ok: false, error: 'failed' };
  }

  let refusal: string | null = null;
  let result: RsvpActionResult = { ok: false, error: 'failed' };
  try {
    const written = await putRsvp(eventId, body.data.answer);
    result = { ok: true, status: body.data.answer };
    // The API answers the stored status; a going/not_going write can only store the answer sent.
    if (written.status !== body.data.answer) result = { ok: false, error: 'failed' };
  } catch (error) {
    if (error instanceof ApiClientError) {
      refusal = bootstrapRedirectPath(error);
      const code = (error.details as { event?: unknown } | undefined)?.event;
      if (!refusal && typeof code === 'string' && RSVP_REFUSALS.has(code)) {
        result = { ok: false, error: code as 'rsvp_closed' | 'cancelled' | 'attendance_locked' };
      }
    }
    // Shape only: never the event's title (member-facing content).
    if (!refusal && !result.ok && result.error === 'failed') {
      console.error('events.rsvp_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  if (result.ok) revalidatePath('/eventos');
  return result;
}

/* ── EVENT-04 in person: the venue code (06-05) ───────────────────────────────────────────────── */

/** The refusals the check-in route names (`409 { event }`), each mapped to a catalog key by the form. */
export type CheckinRefusal =
  | 'wrong_code'
  | 'too_many_attempts'
  | 'checkin_not_open'
  | 'checkin_closed'
  | 'cancelled';

/**
 * What a check-in can answer. `doneLine` is the finished "Realizado às 18:42" (or "… em {date}, às
 * …"), formatted HERE in the tenant's timezone, so the ticket's done state never formats an instant
 * on the client (UI-D-203). Every refusal is a CODE, never pt-BR copy; `failed` is everything else,
 * the bare 404 included (the event vanished or was never the caller's, D-23).
 */
export type CheckinActionResult =
  | { ok: true; outcome: CheckinOutcome; doneLine: string }
  | { ok: false; error: CheckinRefusal | 'failed' };

const CHECKIN_REFUSALS: ReadonlySet<string> = new Set<CheckinRefusal>([
  'wrong_code',
  'too_many_attempts',
  'checkin_not_open',
  'checkin_closed',
  'cancelled',
]);

/**
 * `POST /v1/events/{id}/check-in` for the ticket's code form (06-05, UI-D-208), in the
 * `rsvpEventAction` conventions:
 *
 *  1. **The SAME Zod the API validates with runs first** (`checkinSchema`): a server action is a
 *     public endpoint, so an empty or oversized code is refused before any request is built.
 *  2. **Nothing is decided here.** The comparison, the window, the walk-in rule and the guess bound
 *     are the database's (`app.events_check_in`); a wrong code comes back as `wrong_code` and is
 *     already COUNTED by then. Nothing is persisted on the device either (UI-D-208 drops the
 *     prototype's browser storage).
 *  3. **`redirect()` sits OUTSIDE the try/catch** (Next 16: it throws), for the bootstrap refusals.
 *
 * `already` is a success: the member is present, and the form shows the done state with the ORIGINAL
 * stamp. On success the list is revalidated so the poster's `Presente` pill is fresh on the way back.
 */
export async function checkInEventAction(
  eventId: string,
  code: string,
): Promise<CheckinActionResult> {
  const body = checkinSchema.safeParse({ code });
  if (!body.success || typeof eventId !== 'string' || eventId.length === 0) {
    return { ok: false, error: 'failed' };
  }

  let refusal: string | null = null;
  let result: CheckinActionResult = { ok: false, error: 'failed' };
  try {
    const [bootstrap, written] = await Promise.all([
      getBootstrap(),
      checkIn(eventId, body.data.code),
    ]);
    const t = await getTranslations('events');
    result = {
      ok: true,
      outcome: written.outcome,
      doneLine: checkedInLine(written.checkedInAt, bootstrap.tenant.timezone, Date.now(), t),
    };
  } catch (error) {
    if (error instanceof ApiClientError) {
      refusal = bootstrapRedirectPath(error);
      const issue = (error.details as { event?: unknown } | undefined)?.event;
      if (!refusal && typeof issue === 'string' && CHECKIN_REFUSALS.has(issue)) {
        result = { ok: false, error: issue as CheckinRefusal };
      }
    }
    // Shape only: never the code the member typed, and never the event's title.
    if (!refusal && !result.ok && result.error === 'failed') {
      console.error('events.checkin_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  if (result.ok) revalidatePath('/eventos');
  return result;
}

/* ── EVENT-01's admin half: create, edit, cancel and reactivate (06-04) ─────────────────────────── */

/**
 * What an event write can answer. Every refusal is a CODE the client maps to a catalog key, never
 * pt-BR copy: the API's closed `EventIssue` vocabulary plus the two transport-shaped outcomes a form
 * must be able to draw, the event vanished (`not_found`) and everything else (`generic`).
 */
export type EventWriteResult =
  | { ok: true; eventId: string }
  | { ok: false; code: EventIssue | 'not_found' | 'generic' };

/** The API's `details.event`, narrowed against the contract's OWN set (never a hand-written list). */
function asEventIssue(value: unknown): EventIssue | null {
  return typeof value === 'string' && EVENT_ISSUE_SET.has(value) ? (value as EventIssue) : null;
}

/** The shared refusal mapping for every write action below. */
function eventWriteRefusal(error: unknown): EventWriteResult {
  if (error instanceof ApiClientError) {
    if (error.status === 404) return { ok: false, code: 'not_found' };
    const issue = asEventIssue((error.details as { event?: unknown } | undefined)?.event);
    if (issue) return { ok: false, code: issue };
  }
  // Shape only: a title or a URL is never logged (Pitfall 12).
  console.error('events.write_failed', { error: String(error) });
  return { ok: false, code: 'generic' };
}

/**
 * Which of the TWO bare 404s this was (the communities 05-09 rule): the API answers ONE 404 for a
 * missing event and for a missing NEW cover, deliberately (D-23). On a create there is no event id
 * to have missed, so a 404 on a body carrying a cover is the cover. On an update the event is
 * re-read: still there means the 404 was the cover. The re-read is outside any catch, so its
 * `redirect()` on an expired session throws as it must.
 */
async function coverAwareRefusal(
  result: EventWriteResult,
  submittedCoverAssetId: string | null,
  eventId: string | null,
): Promise<EventWriteResult> {
  if (result.ok || result.code !== 'not_found' || submittedCoverAssetId === null) return result;
  if (eventId === null) return { ok: false, code: 'cover_invalid' };
  const event = await loadEvent(eventId);
  return event.status === 'ok' ? { ok: false, code: 'cover_invalid' } : result;
}

/** The first closed code a failed parse carries, the route `defaultHook`'s own lookup. */
function parseRefusal(issues: { message: string }[]): EventWriteResult {
  const issue = issues.map((problem) => asEventIssue(problem.message)).find(Boolean);
  return { ok: false, code: issue ?? 'generic' };
}

/**
 * `POST /v1/events` for the form (UI-D-212), in the three conventions of every write action here:
 * the SAME `eventInputSchema` the API validates with runs first (a server action is a public
 * endpoint); a refusal is a code, never copy; and `redirect()` sits OUTSIDE the try/catch (Next 16).
 * The FORM navigates on success, so the toast lands on the new event's page.
 */
export async function createEventAction(input: unknown): Promise<EventWriteResult> {
  const body = eventInputSchema.safeParse(input);
  if (!body.success) return parseRefusal(body.error.issues);

  let refusal: string | null = null;
  let result: EventWriteResult = { ok: false, code: 'generic' };
  try {
    const event = await createEvent(body.data);
    result = { ok: true, eventId: event.id };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) result = eventWriteRefusal(error);
  }

  if (refusal) redirect(refusal);
  result = await coverAwareRefusal(result, body.data.coverAssetId ?? null, null);
  if (result.ok) revalidatePath('/eventos');
  return result;
}

/** `PUT /v1/events/{id}`: the whole-event replacement, with the same schema and the same rules. */
export async function updateEventAction(
  eventId: string,
  input: unknown,
): Promise<EventWriteResult> {
  const body = eventInputSchema.safeParse(input);
  if (!body.success || typeof eventId !== 'string' || eventId.length === 0) {
    return body.success ? { ok: false, code: 'generic' } : parseRefusal(body.error.issues);
  }

  let refusal: string | null = null;
  let result: EventWriteResult = { ok: false, code: 'generic' };
  try {
    const event = await updateEvent(eventId, body.data);
    result = { ok: true, eventId: event.id };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) result = eventWriteRefusal(error);
  }

  if (refusal) redirect(refusal);
  result = await coverAwareRefusal(result, body.data.coverAssetId ?? null, eventId);
  if (result.ok) {
    revalidatePath('/eventos');
    revalidatePath(`/eventos/${eventId}`);
  }
  return result;
}

/** The status write shared by cancel and reactivate: one `PATCH`, one refusal mapping. */
async function statusAction(
  eventId: string,
  status: 'active' | 'cancelled',
): Promise<EventWriteResult> {
  if (typeof eventId !== 'string' || eventId.length === 0) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: EventWriteResult = { ok: false, code: 'generic' };
  try {
    const event = await setEventStatus(eventId, status);
    result = { ok: true, eventId: event.id };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) result = eventWriteRefusal(error);
  }

  if (refusal) redirect(refusal);
  if (result.ok) {
    revalidatePath('/eventos');
    revalidatePath(`/eventos/${eventId}`);
  }
  return result;
}

/** Cancel (D-214): refused by the API once the event has ended (`event_ended`). */
export async function cancelEventAction(eventId: string): Promise<EventWriteResult> {
  return statusAction(eventId, 'cancelled');
}

/** Reactivate (D-214): refused by the API once the event has started (`reactivate_started`). */
export async function reactivateEventAction(eventId: string): Promise<EventWriteResult> {
  return statusAction(eventId, 'active');
}

/* ── EVENT-05: the organiser's Participantes (06-07) ──────────────────────────────────────────── */

export type AttendancePageResult =
  | { ok: true; items: AttendeeView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/** Only the three closed values; anything else is refused before a request is built. */
const isAttendanceList = (value: unknown): value is AttendanceList =>
  typeof value === 'string' && (ATTENDANCE_LISTS as readonly string[]).includes(value);

/** A canonical event id, or nothing is sent (a server action is a public endpoint). */
const isEventId = (value: unknown): value is string =>
  typeof value === 'string' && EVENT_ID_RE.test(value);

/**
 * One page of one chip, as FINISHED rows (the `eventsPage` shape): the SAME Zod the API validates
 * with runs first, the list is threaded through (05.1 Pitfall 9: a pull on Presentes never swaps the
 * Confirmados list in), and a bootstrap refusal is a navigation OUTSIDE the try/catch. The API's
 * `events.attendance.read` guard is the authority: a member calling this action gets `generic`.
 */
async function attendancePage(
  eventId: string,
  list: AttendanceList,
  cursor?: string,
): Promise<AttendancePageResult> {
  const query = attendanceQuerySchema.safeParse({ list, cursor });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let loaded: Awaited<ReturnType<typeof getAttendance>> | null = null;
  let tz = '';
  try {
    const [bootstrap, page] = await Promise.all([
      getBootstrap(),
      getAttendance(eventId, {
        list: query.data.list,
        cursor: query.data.cursor,
        limit: query.data.limit,
      }),
    ]);
    tz = bootstrap.tenant.timezone;
    loaded = page;
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: a member's name never reaches a log line.
    if (!refusal) console.error('events.attendance_page_failed', { list, error: String(error) });
  }

  if (refusal) redirect(refusal);
  if (!loaded) return { ok: false, code: 'generic' };

  const t = await getTranslations('events');
  const nowMs = Date.now();
  return {
    ok: true,
    items: loaded.items.map((attendee) => attendeeView(attendee, list, { tz, nowMs, t })),
    nextCursor: loaded.nextCursor,
  };
}

/** One more page of the given chip. The cursor is OPAQUE and forwarded untouched. */
export async function loadMoreAttendanceAction(
  eventId: string,
  list: AttendanceList,
  cursor: string,
): Promise<AttendancePageResult> {
  if (!isEventId(eventId) || !isAttendanceList(list)) return { ok: false, code: 'generic' };
  return attendancePage(eventId, list, cursor);
}

/** Page 1 of the given chip again — what `PullToRefresh` calls. */
export async function refreshAttendanceAction(
  eventId: string,
  list: AttendanceList,
): Promise<AttendancePageResult> {
  if (!isEventId(eventId) || !isAttendanceList(list)) return { ok: false, code: 'generic' };
  return attendancePage(eventId, list);
}

export type RegenerateCodeResult = { ok: true } | { ok: false; code: 'not_found' | 'generic' };

/**
 * `POST /v1/events/{id}/checkin-code` (D-217) for "Gerar novo código": a server action, so a POST and
 * never a GET a prefetch or a crawler could follow (the 06-06 rule for side effects). The API's
 * literal `events.event.manage` guard is the authority. The fresh code is NOT returned to the client:
 * the control refreshes the page, whose RSC read shows it. Nothing here logs a code.
 */
export async function regenerateCheckinCodeAction(eventId: string): Promise<RegenerateCodeResult> {
  if (!isEventId(eventId)) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: RegenerateCodeResult = { ok: false, code: 'generic' };
  try {
    await regenerateCode(eventId);
    result = { ok: true };
  } catch (error) {
    if (error instanceof ApiClientError) {
      refusal = bootstrapRedirectPath(error);
      if (!refusal && error.status === 404) result = { ok: false, code: 'not_found' };
    }
    if (!refusal && !result.ok && result.code === 'generic') {
      console.error('events.regenerate_code_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  if (result.ok) revalidatePath(`/eventos/${eventId}/participantes`);
  return result;
}
