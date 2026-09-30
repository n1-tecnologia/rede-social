import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { notificationPageSchema, notificationQuerySchema } from '../contracts/index';
import { listNotifications, markAllRead, markAllSeen, markRead } from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/notifications', notificationsRoutes)` and cannot forget a guard.
 *
 * `requireAuth` (401) -> `requireModule('notifications')` (404 `MODULE_DISABLED` when the tenant
 * does not have notifications). There is no permission: every member reads and marks ONLY their own
 * rows, which `notifications_owner_select` / `…_update` enforce in the database.
 */
const notifications = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

notifications.use('*', requireAuth, requireModule('notifications'));

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: notificationQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of the CALLER's own notifications. `section=unread` (the default) is every row not yet read, `section=read` every read row, each newest first (`created_at desc, id desc`). `nextCursor` is non-null exactly when another row exists; it is OPAQUE, belongs to the section it was issued for, and must be passed back untouched. A row carries facts, never a sentence, and its actor is read live.",
      content: { 'application/json': { schema: notificationPageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: an unknown `section`. The section is the closed enum `unread` | `read`, exact and case-sensitive. `limit` never errors (it clamps) and a bad cursor degrades to page 1.',
    },
  },
});

/** A 204 that no cache may keep: the marks are the caller's own state, never shareable. */
const noContent = () =>
  new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

const seenRoute = createRoute({
  method: 'post',
  path: '/seen',
  responses: {
    204: {
      description:
        "D-230: stamps `seen_at` on every row the caller has not seen, which zeroes the bell's count, and leaves `read_at` untouched (seen and read never merge). When anything changed, one ids-only signal is published on the caller's own user topic so their other tabs refetch. Nothing to change is a silent 204.",
    },
  },
});

/** The path parameter: a malformed id is a 400 before any read, never a 500 at the `::uuid` cast. */
const notificationParamSchema = z.object({ notificationId: z.uuid() });

const readRoute = createRoute({
  method: 'post',
  path: '/{notificationId}/read',
  request: { params: notificationParamSchema },
  responses: {
    204: {
      description:
        "The caller's row is read, and seen when it was not (a read row is always seen). Re-reading a read row keeps its first `read_at`. Signals the caller's own topic on a real change.",
    },
    404: {
      description:
        'One bare `NOT_FOUND` with no details for an unknown id, another tenant’s, or another member’s: indistinguishable on purpose (D-23).',
    },
  },
});

const readAllRoute = createRoute({
  method: 'post',
  path: '/read-all',
  responses: {
    204: {
      description:
        "Every unread row of the caller becomes read (and seen when it was not). Signals the caller's own topic when anything changed; nothing to change is a silent 204.",
    },
  },
});

export const notificationsRoutes = notifications
  .openapi(listRoute, async (c) =>
    c.json(await listNotifications(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(seenRoute, async (c) => {
    await markAllSeen(c.get('ctx'));
    return noContent();
  })
  .openapi(readAllRoute, async (c) => {
    await markAllRead(c.get('ctx'));
    return noContent();
  })
  .openapi(readRoute, async (c) => {
    await markRead(c.get('ctx'), c.req.valid('param').notificationId);
    return noContent();
  });
