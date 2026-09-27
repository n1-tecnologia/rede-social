import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { requireModule } from '@tria/core/server/modules/require-module';
import { requirePermission } from '@tria/core/server/rbac/permissions';
import {
  EVENT_ISSUE_SET,
  eventInputSchema,
  eventPageSchema,
  eventQuerySchema,
  eventSummarySchema,
} from '../contracts/index';
import { createEvent, listEvents } from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/events', eventsRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order: `requireAuth` (401) -> `requireModule('events')` (404 when the tenant
 * does not have events — never 403, so a member cannot tell "not allowed" from "not here") ->
 * `requirePermission` on the write route only (403). The write guard is a PERMISSION, never a role
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

export const eventsRoutes = events
  .openapi(listRoute, async (c) =>
    c.json(await listEvents(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(createEventRoute, async (c) =>
    c.json(await createEvent(c.get('ctx'), c.req.valid('json')), 201),
  );
