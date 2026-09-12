import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { env } from '../env';

const healthResponse = z.object({
  ok: z.boolean(),
  service: z.string(),
  role: z.string(),
});

/** `GET /v1/health` — no DB access: Docker/Cloud Run probes must not depend on database credentials. */
export const healthRoutes = new OpenAPIHono<AppEnv>().openapi(
  createRoute({
    method: 'get',
    path: '/',
    responses: {
      200: {
        description: 'Service is up',
        content: { 'application/json': { schema: healthResponse } },
      },
    },
  }),
  (c) => c.json({ ok: true, service: 'api', role: env.ROLE }, 200),
);
