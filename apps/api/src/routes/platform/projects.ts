import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  apiErrorEnvelopeSchema,
  type DatabaseOverview,
  databaseOverviewSchema,
  type PrecheckAnswer,
  precheckAnswerSchema,
  precheckBodySchema,
  replaceCredentialsAnswerSchema,
  replaceCredentialsBodySchema,
} from '@rede-social/contracts';
import { ApiError } from '@rede-social/core/server/http/api-error';
import type { PlatformEnv } from '@rede-social/core/server/platform/require-super-admin';
import { listSteps, resumeBootstrap } from '@rede-social/core/server/projects/bootstrap';
import { replaceCredentials } from '@rede-social/core/server/projects/credentials';
import { checkProject } from '@rede-social/core/server/projects/health';
import { getDatabaseOverview, projectOfTenant } from '@rede-social/core/server/projects/overview';
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
        'The read-only pre-check of a project ref: `{ ok: true, manualAccess }` or `{ ok: false, reason }` with reason invalid, not_found, not_empty, in_use, paused or unchecked, plus token_invalid, token_forbidden, token_account_wide and token_expiry_invalid for a customer token. A check that could not run is an answer (`unchecked`), not an error',
      content: { 'application/json': { schema: precheckAnswerSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED — a body that is not { projectRef } or { projectRef, owner: customer, token, tokenExpiresAt? }',
    ),
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

const verifyRoute = createRoute({
  method: 'post',
  path: '/tenants/{id}/database/verify',
  request: { params: idParams },
  responses: {
    200: overviewResponse(
      'One read-only health check of the tenant’s project (the Domínios tab’s "Verificar agora" precedent), then the fresh overview',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
    409: envelope('CONFLICT — the project is still being prepared; there is nothing to check yet'),
  },
});

const resumeRoute = createRoute({
  method: 'post',
  path: '/tenants/{id}/database/bootstrap/resume',
  request: { params: idParams },
  responses: {
    200: overviewResponse(
      '"Tentar de novo": the failed step is queued again and every finished step is kept; the overview as it stands',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
    409: envelope('CONFLICT — no bootstrap step has failed, so there is nothing to resume'),
  },
});

const credentialsRoute = createRoute({
  method: 'put',
  path: '/tenants/{id}/database/credentials',
  request: {
    params: idParams,
    body: {
      content: { 'application/json': { schema: replaceCredentialsBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        'The supplied values worked against the project and were sealed; nothing is ever returned. The registry holds the new values from the next request on',
      content: { 'application/json': { schema: replaceCredentialsAnswerSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED — an empty body, or { access: "invalid" } when a supplied value does not work against the project (nothing was changed)',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
    409: envelope(
      'CONFLICT — the tenant lives in the central project, whose credentials are the environment’s',
    ),
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
    const { projectRef, owner, token, tokenExpiresAt } = c.req.valid('json');

    // 09.4-09 (D-566): a customer body adds the token (write-only, used once by the pre-check and never
    // returned or logged). A platform body is exactly what it was.
    const result =
      owner === 'customer'
        ? await precheckProject(projectRef, {
            owner,
            ...(token === undefined ? {} : { token }),
            ...(tokenExpiresAt === undefined || tokenExpiresAt.trim() === ''
              ? {}
              : { tokenExpiresAt: tokenExpiresAt.trim() }),
          })
        : await precheckProject(projectRef);
    // Built EXPLICITLY from the closed fields, so nothing internal the kernel returns can reach the response.
    const answer: PrecheckAnswer = result.ok
      ? { ok: true, manualAccess: result.manualAccess }
      : { ok: false, reason: result.reason };

    c.get('logger').info(
      {
        event: 'platform.projects.precheck',
        userId,
        requestId,
        owner: owner ?? 'platform',
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
  })
  .openapi(verifyRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');

    const project = await projectOfTenant(id);
    if (!project) throw new ApiError(404, 'NOT_FOUND');
    if (project.state !== 'ready') throw new ApiError(409, 'CONFLICT');
    const result = await checkProject(project.id);
    const overview = await overviewOr404(id);

    c.get('logger').info(
      {
        event: 'platform.projects.verify',
        userId,
        requestId,
        tenantId: id,
        projectId: project.id,
        status: result?.status ?? 'unknown',
        changed: result?.changed ?? false,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(overview, 200);
  })
  .openapi(resumeRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');

    const project = await projectOfTenant(id);
    if (!project) throw new ApiError(404, 'NOT_FOUND');
    const failed = (await listSteps(project.id)).find((row) => row.status === 'failed');
    if (!failed) throw new ApiError(409, 'CONFLICT');
    await resumeBootstrap(project.id);
    const overview = await overviewOr404(id);

    c.get('logger').info(
      {
        event: 'platform.projects.resume',
        userId,
        requestId,
        tenantId: id,
        projectId: project.id,
        step: failed.step,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(overview, 200);
  })
  .openapi(credentialsRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    // The values go straight to the kernel, which validates them against the project, seals them and forgets
    // them. They are never logged, never echoed and never kept in this scope past the call.
    await replaceCredentials(id, body, { userId, logger: c.get('logger') });

    c.get('logger').info(
      { event: 'platform.projects.credentials', userId, requestId, tenantId: id },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true as const }, 200);
  });
