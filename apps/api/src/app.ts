import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { flushEventsAfterHandler } from '@tria/core/server/events/bus';
import { ApiError, errorEnvelope } from '@tria/core/server/http/api-error';
import { exampleRoutes } from '@tria/module-example/server';
import { logger } from './http/logger';
import { requestIdMiddleware } from './http/request-id';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { platformRoutes } from './routes/platform';
import { publicRoutes } from './routes/public';

const app = new OpenAPIHono<AppEnv>();

app.use(requestIdMiddleware());
app.use(logger());
// Domain events emitted by a handler are delivered AFTER it returns, i.e. after its transaction
// committed — and dropped when the handler threw (`c.error`), since then nothing committed.
// Mounted here so every route group gets it without remembering to.
app.use(flushEventsAfterHandler);

/** Stable envelope every client switches on: `{ error: { code, message, details?, requestId } }`. */
app.onError((err, c) => {
  const requestId = c.get('requestId');
  const { body, status } = errorEnvelope(err, requestId);
  if (!(err instanceof ApiError) || status >= 500) {
    c.get('logger').error({ err, requestId, code: body.error.code }, 'unhandled');
  }
  return c.json(body, status);
});

app.doc('/v1/openapi.json', {
  openapi: '3.0.0',
  info: { title: 'TRIA Rede Social API', version: '1' },
});

// Keep the chained `.route()` style: `AppType` must carry every mounted route for `hc<AppType>()`.
// `/v1/public` is mounted BEFORE `/v1/me` and carries no auth middleware (D-20 public host lookup).
// `/v1/platform` carries `requireSuperAdmin()` (applied inside the route group) and deliberately NOT
// `requireAuth`: a super_admin has no membership, so requireAuth would 403 NO_MEMBERSHIP first (ROLE-01).
const routes = app
  .route('/v1/health', healthRoutes)
  .route('/v1/public', publicRoutes)
  .route('/v1/me', meRoutes)
  .route('/v1/platform', platformRoutes)
  // The module carries its own `requireAuth` + `requireModule('example')` + `requireRole` chain
  // (packages/modules/example/server/routes.ts), so the mount cannot forget a guard.
  .route('/v1/example', exampleRoutes);

export type AppType = typeof routes;
export { app };
export default app;
