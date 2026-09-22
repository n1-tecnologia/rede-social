import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { flushEventsAfterHandler } from '@tria/core/server/events/bus';
import { ApiError, errorEnvelope } from '@tria/core/server/http/api-error';
import { exampleRoutes } from '@tria/module-example/server';
import { logger } from './http/logger';
import { requestIdMiddleware } from './http/request-id';
import { healthRoutes } from './routes/health';
import { hookRoutes } from './routes/hooks';
import { meRoutes } from './routes/me';
import { mediaRoutes } from './routes/media';
import { membersRoutes } from './routes/members';
import { platformRoutes } from './routes/platform';
import { publicRoutes } from './routes/public';
import { muxWebhookRoutes } from './routes/webhooks/mux';

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
// `/v1/hooks` is called by GoTrue (server-to-server), carries no auth middleware and authenticates
// each call by its standard-webhooks signature (D-37, routes/hooks.ts).
// `/v1/platform` carries `requireSuperAdmin()` (applied inside the route group) and deliberately NOT
// `requireAuth`: a super_admin has no membership, so requireAuth would 403 NO_MEMBERSHIP first (ROLE-01).
const routes = app
  .route('/v1/health', healthRoutes)
  .route('/v1/public', publicRoutes)
  .route('/v1/hooks', hookRoutes)
  // `/v1/webhooks` is called by the video provider (server-to-server), carries no auth middleware
  // and authenticates each call by the provider's own HMAC signature over the RAW body (MEDIA-03,
  // R-03, routes/webhooks/mux.ts) — the same posture as `/v1/hooks`.
  .route('/v1/webhooks', muxWebhookRoutes)
  .route('/v1/me', meRoutes)
  // `/v1/media` is the tenant-lane media broker (03-01): it carries its own `requireAuth`, so
  // `ctx.tenantId` (the membership of record) is the ONLY source of a Storage key prefix.
  .route('/v1/media', mediaRoutes)
  // `/v1/members` is the tenant-lane member directory (03-03): it carries its own `requireAuth`, so
  // the community whose members are listed is always the membership of record, never a path or query
  // value, and the RLS select policy makes another community's rows invisible rather than refused.
  .route('/v1/members', membersRoutes)
  .route('/v1/platform', platformRoutes)
  // The module carries its own `requireAuth` + `requireModule('example')` + `requireRole` chain
  // (packages/modules/example/server/routes.ts), so the mount cannot forget a guard.
  .route('/v1/example', exampleRoutes);

export type AppType = typeof routes;
export { app };
export default app;
