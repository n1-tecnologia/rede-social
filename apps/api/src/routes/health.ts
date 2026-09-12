import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { db } from '@tria/core/db';
import type { AppEnv } from '@tria/core/server/auth/context';
import { sql } from 'drizzle-orm';
import { env } from '../env';

const healthResponse = z.object({
  ok: z.boolean(),
  service: z.string(),
  role: z.string(),
  db: z.boolean().optional(),
});

const healthFailure = z.object({
  ok: z.literal(false),
  service: z.string(),
  role: z.string(),
  db: z.literal(false),
});

const healthQuery = z.object({
  deep: z
    .string()
    .optional()
    .openapi({ param: { name: 'deep', in: 'query' }, example: '1' }),
});

/**
 * `GET /v1/health` — no DB access by default: Docker/Cloud Run probes must not depend on database
 * credentials (the image smoke boots with `DATABASE_URL` pointing at a closed port).
 *
 * `GET /v1/health?deep=1` additionally runs `select 1` on the `api_user` client. It is the only
 * query in the codebase that does not go through `withTenantTx`/`withAdminTx`, and it is allowed to:
 * it reads no table (so `api_user`'s NOINHERIT lack of privileges is irrelevant) and switches no
 * role, so nothing leaks onto the pooled connection. `keepalive-staging.yml` calls it twice a week
 * so the Supabase Free-plan inactivity timer never pauses staging (RESEARCH §Pitfall 4, A9).
 */
export const healthRoutes = new OpenAPIHono<AppEnv>().openapi(
  createRoute({
    method: 'get',
    path: '/',
    request: { query: healthQuery },
    responses: {
      200: {
        description: 'Service is up (and the database answered when `deep=1`)',
        content: { 'application/json': { schema: healthResponse } },
      },
      500: {
        description: 'Deep check failed: the database is unreachable',
        content: { 'application/json': { schema: healthFailure } },
      },
    },
  }),
  async (c) => {
    const base = { ok: true as const, service: 'api', role: env.ROLE };
    if (c.req.query('deep') !== '1') return c.json(base, 200);

    try {
      await db.execute(sql`select 1`);
    } catch (err) {
      c.get('logger')?.error({ err }, 'deep health check failed');
      return c.json(
        { ok: false as const, service: 'api', role: env.ROLE, db: false as const },
        500,
      );
    }
    return c.json({ ...base, db: true }, 200);
  },
);
