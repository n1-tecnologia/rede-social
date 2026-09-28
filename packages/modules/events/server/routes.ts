import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  attendancePageSchema,
  attendanceQuerySchema,
  attendanceSummarySchema,
  checkinCodeSchema,
  checkinResultSchema,
  checkinSchema,
  EVENT_ISSUE_SET,
  enterResultSchema,
  eventDetailSchema,
  eventEditSchema,
  eventInputSchema,
  eventPageSchema,
  eventQuerySchema,
  eventStatusUpdateSchema,
  eventSummarySchema,
  nextEventSchema,
  rsvpResultSchema,
  rsvpSchema,
} from '../contracts/index';
import {
  checkInEvent,
  createEvent,
  enterEvent,
  getAttendanceSummary,
  getEvent,
  getEventForEdit,
  getNextEvent,
  listAttendance,
  listEvents,
  regenerateCheckinCode,
  rsvpEvent,
  setEventStatus,
  updateEvent,
} from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/events', eventsRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order: `requireAuth` (401) -> `requireModule('events')` (404 when the tenant
 * does not have events — never 403, so a member cannot tell "not allowed" from "not here") ->
 * `requirePermission` on the create, edit-read, replace, status, RSVP, check-in, enter, attendance
 * and code-regeneration routes (403). The write guard is a PERMISSION, never a role
 * comparison: granting creation to another role later is a manifest line, not a route edit.
 */

/**
 * The refusals `eventInputSchema`'s refinement raises, lifted to `details.event`. The refinement
 * carries the MACHINE code as its issue `message`, so the web switches on the same closed vocabulary
 * the service uses when it refuses the same shape.
 */
const events = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const event = result.error.issues
        .map((issue) => issue.message)
        .find((message) => EVENT_ISSUE_SET.has(message));
      if (event) throw new ApiError(400, 'VALIDATION_FAILED', { event });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

events.use('*', requireAuth, requireModule('events'));

/** The list carries NO permission middleware: every member of the tenant lists (EVENT-02). */
const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: eventQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of the tenant's events. `period=upcoming` (the default) is every event that has not ENDED yet, so one in progress is included, soonest start first; `period=past` is every ended event, most recently ended first. Cancelled events stay in both lists with `status: 'cancelled'` (D-201). `nextCursor` is non-null exactly when another event exists; it is OPAQUE, belongs to the period it was issued for, and must be passed back untouched. No item carries a meeting URL or a check-in code.",
      content: { 'application/json': { schema: eventPageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: an unknown `period`. The filter is the closed enum `upcoming` | `past`, exact and case-sensitive.',
    },
  },
});

const createEventRoute = createRoute({
  method: 'post',
  path: '/',
  // The literal, not `EVENT_PERMISSIONS.manage`: this string is the one thing a reviewer greps for
  // when asking "what guards creating an event?", and an indirection here hides a change (T-06-02).
  middleware: [requirePermission('events.event.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: eventInputSchema } }, required: true },
  },
  responses: {
    201: {
      description:
        "The created event, in the shape the list returns. Start and end are wall-clock pairs in the TENANT's timezone and are converted to UTC by the database. Two identical bodies create two events with distinct ids, and neither answers 409.",
      content: { 'application/json': { schema: eventSummarySchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.event` carrying one machine code: `name_required`, `end_before_start`, `location_required`, `url_required`, `url_invalid` or `cover_invalid`.',
    },
    403: {
      description: 'The caller does not hold `events.event.manage` in this tenant',
    },
    404: {
      description:
        'The cover asset id is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

/**
 * `GET /next` (06-08, D-202): the Início card's read. NO permission middleware: every member of the
 * tenant sees what is coming. Registered BEFORE `/{eventId}`, so `next` is never read as an id.
 */
const nextRoute = createRoute({
  method: 'get',
  path: '/next',
  responses: {
    200: {
      description:
        "The tenant's soonest ACTIVE event that has not ended (one in progress included), soonest start first, with the caller's own state and the two counts, or `{ event: null }` when there is none. Cancelled events are skipped. No meeting URL and no check-in code.",
      content: { 'application/json': { schema: nextEventSchema } },
    },
  },
});

/** The path parameter: a malformed id is a 400 before any read, never a 500 at the `::uuid` cast. */
const eventParamSchema = z.object({ eventId: z.uuid() });

/** The detail carries NO permission middleware: every member of the tenant reads an event (EVENT-02). */
const detailRoute = createRoute({
  method: 'get',
  path: '/{eventId}',
  request: { params: eventParamSchema },
  responses: {
    200: {
      description:
        "One event of the caller's tenant: the list item plus `description`, `address` (null online) and `viewerRespondedAt`. It carries the caller's OWN attendance (`viewerStatus`, `viewerCheckedInAt`, `viewerRespondedAt`) and two counts (`confirmedCount` = going + checked_in, `presentCount` = checked_in + walk_in), and never another member's id, name or avatar (D-206). No meeting URL and no check-in code.",
      content: { 'application/json': { schema: eventDetailSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid.' },
    404: {
      description:
        'The event is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const rsvpRoute = createRoute({
  method: 'put',
  path: '/{eventId}/rsvp',
  // The literal, for the same reason as the create route (T-06-12): V1 grants it to every role, so no
  // member is refused, but granting or revoking it later is a manifest line, not a route edit.
  middleware: [requirePermission('events.attendance.respond')] as const,
  request: {
    params: eventParamSchema,
    body: { content: { 'application/json': { schema: rsvpSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        "The caller's attendance status after the call. `going` and `not_going` change freely until `starts_at`; the same answer twice answers 200 both times, writes nothing and emits nothing.",
      content: { 'application/json': { schema: rsvpResultSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: the id is not a uuid, or `answer` is not `going` | `not_going`.',
    },
    403: {
      description: 'The caller does not hold `events.attendance.respond` in this tenant',
    },
    404: {
      description:
        'The event is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.event`, decided by the DATABASE for every writer (D-204): `rsvp_closed` (the event has started), `cancelled` (the event is cancelled, D-201) or `attendance_locked` (the caller has already checked in).',
    },
  },
});

/**
 * The edit read (06-04). The literal manage guard, like every admin route here (T-06-19): this is
 * the ONE route that returns the meeting URL, and only to the manager (T-06-20).
 */
const editReadRoute = createRoute({
  method: 'get',
  path: '/{eventId}/edit',
  middleware: [requirePermission('events.event.manage')] as const,
  request: { params: eventParamSchema },
  responses: {
    200: {
      description:
        "The event as the edit form needs it: `start` / `end` are the stored instants converted back to the TENANT's wall clock by the database, `startsAt` / `endsAt` the UTC instants, and `meetingUrl` the admin-only link (null for an in-person event).",
      content: { 'application/json': { schema: eventEditSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid.' },
    403: { description: 'The caller does not hold `events.event.manage` in this tenant' },
    404: {
      description:
        'The event is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const updateEventRoute = createRoute({
  method: 'put',
  path: '/{eventId}',
  middleware: [requirePermission('events.event.manage')] as const,
  request: {
    params: eventParamSchema,
    body: { content: { 'application/json': { schema: eventInputSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The event after a WHOLE-EVENT replacement (D-214), in the shape the list returns (no URL). Every field is editable after members answered, and their answers and check-ins are kept. A format switch moves the location and the link together. A body equal to the stored event writes nothing and emits nothing.',
      content: { 'application/json': { schema: eventSummarySchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.event`: `name_required`, `end_before_start`, `location_required`, `url_required`, `url_invalid` or `cover_invalid`.',
    },
    403: { description: 'The caller does not hold `events.event.manage` in this tenant' },
    404: {
      description:
        'The event, or a NEW cover asset id, is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const statusRoute = createRoute({
  method: 'patch',
  path: '/{eventId}',
  middleware: [requirePermission('events.event.manage')] as const,
  request: {
    params: eventParamSchema,
    body: { content: { 'application/json': { schema: eventStatusUpdateSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The event after the status write. `cancelled` cancels an active event that has not ended; `active` reactivates a cancelled event that has not started. Asking for the status the event already has writes nothing and emits nothing. There is no delete (D-214).',
      content: { 'application/json': { schema: eventSummarySchema } },
    },
    400: {
      description: '`VALIDATION_FAILED`: the id is not a uuid, or the body is not `{ status }`.',
    },
    403: { description: 'The caller does not hold `events.event.manage` in this tenant' },
    404: {
      description:
        'The event is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.event`: `event_ended` (a finished event cannot be cancelled) or `reactivate_started` (a cancelled event cannot be reactivated once it has started).',
    },
  },
});

/**
 * The in-person check-in (06-05, EVENT-04, D-208). The literal permission, like the RSVP route
 * (T-06-12): every role answers and checks in in V1. The comparison, the window, the walk-in rule and
 * the guess bound all run inside Postgres (`app.events_check_in`); this route only carries the code
 * in and the outcome out, and no response ever carries the code (T-06-31).
 */
const checkInRoute = createRoute({
  method: 'post',
  path: '/{eventId}/check-in',
  middleware: [requirePermission('events.attendance.respond')] as const,
  request: {
    params: eventParamSchema,
    body: { content: { 'application/json': { schema: checkinSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The caller is present. `outcome` is `checked_in` (after a `Vou`), `walk_in` (no answer, or `Não vou`, D-216) or `already` (they were present before; `checkedInAt` is the ORIGINAL instant, and no guess was spent). The window is fixed (D-209): from `starts_at - 1 hour` to `ends_at`, once per event.',
      content: { 'application/json': { schema: checkinResultSchema } },
    },
    400: {
      description: '`VALIDATION_FAILED`: the id is not a uuid, or `code` is empty or too long.',
    },
    403: {
      description: 'The caller does not hold `events.attendance.respond` in this tenant',
    },
    404: {
      description:
        'The event is unknown, another tenant’s, removed, or ONLINE (an online event is checked in by `Entrar`). One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.event`: `wrong_code` (counted), `too_many_attempts` (5 wrong codes within 15 minutes; answered even with the right code), `checkin_not_open` (before `starts_at - 1 hour`), `checkin_closed` (from `ends_at` on) or `cancelled`.',
    },
  },
});

/**
 * The online `Entrar` (06-06, EVENT-04 online, D-207, D-210, D-218). The literal permission, like the
 * RSVP and check-in routes: every role enters in V1. It is a POST because it has a side effect (the
 * online check-in inside the window); the web's GET `/eventos/{id}/entrar` route handler is its only
 * caller, and it turns the answer into a 303. The gate, the window and the write all run inside
 * Postgres (`app.events_enter`), and the URL is in the body ONLY for `forward`, `recorded` and
 * `already` (T-06-35).
 */
const enterRoute = createRoute({
  method: 'post',
  path: '/{eventId}/enter',
  middleware: [requirePermission('events.attendance.respond')] as const,
  request: { params: eventParamSchema },
  responses: {
    200: {
      description:
        "The gate's answer at this instant. `forward` (before the window, after a `Vou`: let through, nothing recorded), `recorded` (inside the window: the online check-in was recorded, `checked_in` after a `Vou` or `walk_in` otherwise, D-216), `already` (inside the window, present already: let through again) carry the https `meetingUrl`. `confirm_first` (before the window without a `Vou`), `ended` (from `ends_at` on) and `cancelled` carry `meetingUrl: null`. An API-to-BFF answer: no member page ever renders the URL (D-207).",
      content: { 'application/json': { schema: enterResultSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid.' },
    403: {
      description: 'The caller does not hold `events.attendance.respond` in this tenant',
    },
    404: {
      description:
        'The event is unknown, another tenant’s, removed, or IN PERSON (an in-person event is checked in by its venue code). One bare code, no details (D-23).',
    },
  },
});

/**
 * The organiser's attendance list (06-07, EVENT-05, D-215). The literal `events.attendance.read`
 * (T-06-44): granted to `admin_tenant` only in V1, so a member is 403 before any read. Widening it to
 * `support_tenant` is one manifest line plus one `ALTER POLICY` on `event_secrets_staff_all` (the
 * open pilot question).
 */
const attendanceRoute = createRoute({
  method: 'get',
  path: '/{eventId}/attendance',
  middleware: [requirePermission('events.attendance.read')] as const,
  request: { params: eventParamSchema, query: attendanceQuerySchema },
  responses: {
    200: {
      description:
        'One keyset page of one attendance chip. `list=confirmed` (the default) is every `going` answer (Vou, not yet checked in), newest answer first; `list=present` is every check-in (`checked_in` and `walk_in`, with `walkIn: true` on a walk-in), newest check-in first; `list=not_going` is every `Não vou`, newest first. Ties on the instant are broken by the row id, descending. A row is a name, a photo and a status: no email, no role, no link. A member who has left has `removed: true` and a null name, and still counts. An empty chip, and a cursor past the end, answer `{ items: [], nextCursor: null }`.',
      content: { 'application/json': { schema: attendancePageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: the id is not a uuid, or `list` is not exactly `confirmed` | `present` | `not_going`.',
    },
    403: { description: 'The caller does not hold `events.attendance.read` in this tenant' },
    404: {
      description:
        'The event is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

/** The chip counts and the door code in one read (06-07, D-208). The same literal guard. */
const attendanceSummaryRoute = createRoute({
  method: 'get',
  path: '/{eventId}/attendance/summary',
  middleware: [requirePermission('events.attendance.read')] as const,
  request: { params: eventParamSchema },
  responses: {
    200: {
      description:
        "The event's attendance counts and its venue code. `pendingConfirmedCount` is `going` only (the Confirmados chip); `confirmedCount` is `going + checked_in` (the member-facing number, D-219); `presentCount` is `checked_in + walk_in`; `notGoingCount` is `not_going`. `checkinCode` is the in-person event's code (null online), readable by the tenant admin only.",
      content: { 'application/json': { schema: attendanceSummarySchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid.' },
    403: { description: 'The caller does not hold `events.attendance.read` in this tenant' },
    404: {
      description:
        'The event is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

/**
 * Code regeneration (06-07, D-217). A WRITE, so the literal manage guard (T-06-45), and a POST, never
 * a GET: nothing a prefetch or a crawler follows may rotate the code.
 */
const regenerateCodeRoute = createRoute({
  method: 'post',
  path: '/{eventId}/checkin-code',
  middleware: [requirePermission('events.event.manage')] as const,
  request: { params: eventParamSchema },
  responses: {
    200: {
      description:
        'The fresh venue code, always different from the one it replaces. The old code answers `wrong_code` from now on, and every existing check-in is kept.',
      content: { 'application/json': { schema: checkinCodeSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid.' },
    403: { description: 'The caller does not hold `events.event.manage` in this tenant' },
    404: {
      description:
        'The event is unknown, another tenant’s, removed, or ONLINE (an online event has no door code). One bare code, no details (D-23).',
    },
  },
});

export const eventsRoutes = events
  .openapi(listRoute, async (c) =>
    c.json(await listEvents(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(createEventRoute, async (c) =>
    c.json(await createEvent(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(nextRoute, async (c) => c.json(await getNextEvent(c.get('ctx')), 200))
  .openapi(detailRoute, async (c) =>
    c.json(await getEvent(c.get('ctx'), c.req.valid('param').eventId), 200),
  )
  .openapi(rsvpRoute, async (c) =>
    c.json(await rsvpEvent(c.get('ctx'), c.req.valid('param').eventId, c.req.valid('json')), 200),
  )
  .openapi(editReadRoute, async (c) =>
    c.json(await getEventForEdit(c.get('ctx'), c.req.valid('param').eventId), 200),
  )
  .openapi(updateEventRoute, async (c) =>
    c.json(await updateEvent(c.get('ctx'), c.req.valid('param').eventId, c.req.valid('json')), 200),
  )
  .openapi(statusRoute, async (c) =>
    c.json(
      await setEventStatus(c.get('ctx'), c.req.valid('param').eventId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(checkInRoute, async (c) =>
    c.json(
      await checkInEvent(c.get('ctx'), c.req.valid('param').eventId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(enterRoute, async (c) =>
    c.json(await enterEvent(c.get('ctx'), c.req.valid('param').eventId), 200),
  )
  .openapi(attendanceSummaryRoute, async (c) =>
    c.json(await getAttendanceSummary(c.get('ctx'), c.req.valid('param').eventId), 200),
  )
  .openapi(attendanceRoute, async (c) =>
    c.json(
      await listAttendance(c.get('ctx'), c.req.valid('param').eventId, c.req.valid('query')),
      200,
    ),
  )
  .openapi(regenerateCodeRoute, async (c) =>
    c.json(await regenerateCheckinCode(c.get('ctx'), c.req.valid('param').eventId), 200),
  );
