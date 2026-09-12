import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { HTTPException } from 'hono/http-exception';
import { logger } from './http/logger';
import { requestIdMiddleware } from './http/request-id';
import { healthRoutes } from './routes/health';

const app = new OpenAPIHono<AppEnv>();

app.use(requestIdMiddleware());
app.use(logger());

/** Stable envelope every client switches on: `{ error: { code, message, details?, requestId } }`. */
app.onError((err, c) => {
  const requestId = c.get('requestId');
  if (err instanceof HTTPException) {
    return c.json({ error: { code: 'HTTP_ERROR', message: err.message, requestId } }, err.status);
  }
  c.get('logger').error({ err, requestId }, 'unhandled');
  return c.json({ error: { code: 'INTERNAL', message: 'Erro interno', requestId } }, 500);
});

app.doc('/v1/openapi.json', {
  openapi: '3.0.0',
  info: { title: 'TRIA Rede Social API', version: '1' },
});

// Keep the chained `.route()` style: `AppType` must carry every mounted route for `hc<AppType>()`.
const routes = app.route('/v1/health', healthRoutes);

export type AppType = typeof routes;
export { app };
export default app;
