import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  apiErrorEnvelopeSchema,
  attachDomainBodySchema,
  tenantDomainParamsSchema,
  tenantDomainSchema,
  tenantDomainsListSchema,
} from '@tria/contracts';
import { ApiError } from '@tria/core/server/http/api-error';
import {
  attachDomain,
  checkDomain,
  listTenantDomains,
  removeDomain,
  restartDomainVerification,
  setPrimaryDomain,
} from '@tria/core/server/platform/domains';
import type { PlatformEnv } from '@tria/core/server/platform/require-super-admin';
import { platformDefaultHook } from '../../http/openapi';

/**
 * `/v1/platform/tenants/{id}/domains*` — TENANT-07 custom domains (D-34/D-35/D-36). Mounted by
 * `routes/platform/index.ts`, whose `requireSuperAdmin()` guards every handler here (ROLE-03); the
 * service scopes every row by `tenant_id AND id`, so a domain id of another tenant is a plain 404.
 *
 * Every answer is `Cache-Control: no-store` and every handler logs `platform.domains.<verb>` with
 * `{ userId, requestId, tenantId, domainId?, host? }` (T-02-50; the audit table is Phase 8).
 */
const domains = new OpenAPIHono<PlatformEnv>({ defaultHook: platformDefaultHook });

const idParams = z.object({ id: z.uuid() });

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});
const domainResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: tenantDomainSchema } },
});
const listResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: tenantDomainsListSchema } },
});

const listRoute = createRoute({
  method: 'get',
  path: '/tenants/{id}/domains',
  request: { params: idParams },
  responses: {
    200: listResponse(
      'Every host of the tenant (primary first, then by creation) and the VERIFIED primary host or null',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

const attachRoute = createRoute({
  method: 'post',
  path: '/tenants/{id}/domains',
  request: {
    params: idParams,
    body: { content: { 'application/json': { schema: attachDomainBodySchema } }, required: true },
  },
  responses: {
    201: domainResponse(
      'The host registered at the provider and stored pending, with the DNS records to create and a ~7-day verification deadline; primary when it is the tenant’s first host',
    ),
    200: domainResponse(
      'The same tenant re-attached a host it already owns — the existing row, no provider call',
    ),
    400: envelope(
      'VALIDATION_FAILED — invalid host, { host: "platform_host" } (the platform domain), { host: "not_registrable" } or { host: "invalid_domain" } (provider)',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
    409: envelope(
      'DOMAIN_IN_USE — the host belongs to another tenant or another provider project (never named)',
    ),
  },
});

const verifyRoute = createRoute({
  method: 'post',
  path: '/tenants/{id}/domains/{domainId}/verify',
  request: { params: tenantDomainParamsSchema },
  responses: {
    200: domainResponse(
      '"Verificar agora": the row after one provider check — verified (side effects ran once), still pending (poller re-armed) or already verified (unchanged; allow-list + invites re-run idempotently)',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such domain for this tenant'),
    409: envelope('DOMAIN_STATE_INVALID { reason: "expired" } — restart the verification first'),
  },
});

const restartRoute = createRoute({
  method: 'post',
  path: '/tenants/{id}/domains/{domainId}/restart',
  request: { params: tenantDomainParamsSchema },
  responses: {
    200: domainResponse(
      '"Reiniciar verificação": an expired host back to pending with a fresh ~7-day deadline, the poller re-armed and one check already run',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such domain for this tenant'),
    409: envelope('DOMAIN_STATE_INVALID { reason: "not_expired" } — only an expired host restarts'),
  },
});

const primaryRoute = createRoute({
  method: 'post',
  path: '/tenants/{id}/domains/{domainId}/primary',
  request: { params: tenantDomainParamsSchema },
  responses: {
    200: listResponse(
      'The tenant’s hosts after the switch (primary first); the former primary keeps resolving as an alias that 308s to the new one (D-35)',
    ),
    403: envelope('Not a platform admin'),
    404: envelope('No such domain for this tenant'),
    409: envelope(
      'DOMAIN_STATE_INVALID { reason: "not_verified" } — only a verified host can be primary',
    ),
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/tenants/{id}/domains/{domainId}',
  request: { params: tenantDomainParamsSchema },
  responses: {
    204: {
      description:
        'Detached at the provider, allow-list entry removed, row deleted, host cache invalidated',
    },
    403: envelope('Not a platform admin'),
    404: envelope('No such domain for this tenant'),
    409: envelope(
      'DOMAIN_STATE_INVALID { reason: "primary_with_aliases" } — promote another host before removing the primary',
    ),
  },
});

export const domainsRoutes = domains
  .openapi(listRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');

    const body = await listTenantDomains(id);

    c.get('logger').info(
      {
        event: 'platform.domains.list',
        userId,
        requestId,
        tenantId: id,
        count: body.domains.length,
      },
      'platform read',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  })
  .openapi(attachRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const { domain, created } = await attachDomain(id, body, { userId, logger: c.get('logger') });

    c.get('logger').info(
      {
        event: 'platform.domains.attach',
        userId,
        requestId,
        tenantId: id,
        domainId: domain.id,
        host: domain.host,
        created,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return created ? c.json(domain, 201) : c.json(domain, 200);
  })
  .openapi(verifyRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id, domainId } = c.req.valid('param');

    const result = await checkDomain(
      domainId,
      { userId, logger: c.get('logger') },
      { source: 'manual', tenantId: id },
    );
    if (result.outcome === 'gone' || !result.domain) throw new ApiError(404, 'NOT_FOUND');
    if (result.outcome === 'expired') {
      throw new ApiError(409, 'DOMAIN_STATE_INVALID', { reason: 'expired' });
    }

    c.get('logger').info(
      {
        event: 'platform.domains.verify',
        userId,
        requestId,
        tenantId: id,
        domainId,
        host: result.domain.host,
        outcome: result.outcome,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(result.domain, 200);
  })
  .openapi(restartRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id, domainId } = c.req.valid('param');

    const domain = await restartDomainVerification(id, domainId, {
      userId,
      logger: c.get('logger'),
    });

    c.get('logger').info(
      {
        event: 'platform.domains.restart',
        userId,
        requestId,
        tenantId: id,
        domainId,
        host: domain.host,
        outcome: domain.verificationStatus,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(domain, 200);
  })
  .openapi(primaryRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id, domainId } = c.req.valid('param');

    const list = await setPrimaryDomain(id, domainId, { userId, logger: c.get('logger') });

    c.get('logger').info(
      {
        event: 'platform.domains.set_primary',
        userId,
        requestId,
        tenantId: id,
        domainId,
        host: list.primaryHost,
      },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(list, 200);
  })
  .openapi(deleteRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id, domainId } = c.req.valid('param');

    await removeDomain(id, domainId, { userId, logger: c.get('logger') });

    c.get('logger').info(
      { event: 'platform.domains.remove', userId, requestId, tenantId: id, domainId },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.body(null, 204);
  });
