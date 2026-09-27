import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { requireModule } from '@tria/core/server/modules/require-module';
import { requirePermission } from '@tria/core/server/rbac/permissions';
import {
  EVENT_ISSUE_SET,
  eventDetailSchema,
  eventEditSchema,
  eventInputSchema,
  eventPageSchema,
  eventQuerySchema,
  eventStatusUpdateSchema,
  eventSummarySchema,
  rsvpResultSchema,
  rsvpSchema,
} from '../contracts/index';
import {
  createEvent,
  getEvent,
  getEventForEdit,
  listEvents,
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
 * `requirePermission` on the create, edit-read, replace and status routes (403). The write guard is a PERMISSION, never a role
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

export const eventsRoutes = events
  .openapi(listRoute, async (c) =>
    c.json(await listEvents(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(createEventRoute, async (c) =>
    c.json(await createEvent(c.get('ctx'), c.req.valid('json')), 201),
  )
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
  );
