import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  apiErrorEnvelopeSchema,
  type DatabaseOverview,
  databaseOverviewSchema,
  type PrecheckAnswer,
  precheckAnswerSchema,
  precheckBodySchema,
} from '@rede-social/contracts';
import { ApiError } from '@rede-social/core/server/http/api-error';
import type { PlatformEnv } from '@rede-social/core/server/platform/require-super-admin';
import { getDatabaseOverview } from '@rede-social/core/server/projects/overview';
import { precheckProject } from '@rede-social/core/server/projects/precheck';
import { platformDefaultHook } from '../../http/openapi';

/**
 * `/v1/platform/projects/*` and `/v1/platform/tenants/{id}/database*` (09.2-14, D-541..D-543, D-539): the panel's
 * view of a tenant's Supabase project. Mounted by `routes/platform/index.ts`, whose `requireSuperAdmin()` guards
 * every handler here (a tenant admin or a member never reaches one).
 *
 * Every answer is `Cache-Control: no-store` and is built from strict schemas that have no field able to carry a
 * credential (T-09.2-67); every log line is an event name with ids and reason codes, never a ref's secrets, a
 * URL or a value.
 */
const projectsRouter = new OpenAPIHono<PlatformEnv>({ defaultHook: platformDefaultHook });

const idParams = z.object({ id: z.uuid() });

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});
const overviewResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: databaseOverviewSchema } },
});

const precheckRoute = createRoute({
  method: 'post',
  path: '/projects/precheck',
  request: {
    body: { content: { 'application/json': { schema: precheckBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The read-only pre-check of a project ref: `{ ok: true, manualAccess }` or `{ ok: false, reason }` with reason invalid, not_found, not_empty, in_use, paused or unchecked. A check that could not run is an answer (`unchecked`), not an error',
      content: { 'application/json': { schema: precheckAnswerSchema } },
    },
    400: envelope('VALIDATION_FAILED — a body that is not { projectRef }'),
    403: envelope('Not a platform admin'),
  },
});

const overviewRoute = createRoute({
  method: 'get',
  path: '/tenants/{id}/database',
  request: { params: idParams },
  responses: {
    200: overviewResponse(
      'The Banco tab: the derived state, the bootstrap steps, schema applied of required, the last check and whether credentials are held (never their values)',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

export async function overviewOr404(tenantId: string): Promise<DatabaseOverview> {
  const overview = await getDatabaseOverview(tenantId);
  if (!overview) throw new ApiError(404, 'NOT_FOUND');
  return overview;
}

export const projectsRoutes = projectsRouter
  .openapi(precheckRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { projectRef } = c.req.valid('json');

    const answer: PrecheckAnswer = await precheckProject(projectRef);

    c.get('logger').info(
      {
        event: 'platform.projects.precheck',
        userId,
        requestId,
        ok: answer.ok,
        ...(answer.ok ? { manualAccess: answer.manualAccess } : { reason: answer.reason }),
      },
      'platform read',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(answer, 200);
  })
  .openapi(overviewRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');

    const overview = await overviewOr404(id);

    c.get('logger').info(
      {
        event: 'platform.projects.overview',
        userId,
        requestId,
        tenantId: id,
        state: overview.state,
      },
      'platform read',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(overview, 200);
  });
