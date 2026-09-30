import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { notificationPageSchema, notificationQuerySchema } from '../contracts/index';
import { listNotifications } from './service';

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

export const notificationsRoutes = notifications.openapi(listRoute, async (c) =>
  c.json(await listNotifications(c.get('ctx'), c.req.valid('query')), 200),
);
