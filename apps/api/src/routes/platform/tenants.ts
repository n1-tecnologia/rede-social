import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  apiErrorEnvelopeSchema,
  createTenantBodySchema,
  inviteParamsSchema,
  type PlatformTenantDetail,
  type PlatformTenants,
  platformTenantDetailSchema,
  platformTenantsQuerySchema,
  platformTenantsSchema,
  setModuleBodySchema,
  setTenantStatusBodySchema,
  type TenantInvitesList,
  TOGGLEABLE_MODULES,
  tenantInviteSchema,
  tenantInvitesListSchema,
  updateTenantBodySchema,
} from '@rede-social/contracts';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { listTenantInvites, resendInvite } from '@rede-social/core/server/platform/invites';
import { setModuleEnabled } from '@rede-social/core/server/platform/modules';
import type { PlatformEnv } from '@rede-social/core/server/platform/require-super-admin';
import {
  createTenant,
  getTenantDetail,
  listPlatformTenants,
  setTenantStatus,
  updateTenant,
} from '@rede-social/core/server/platform/tenants';
import { platformDefaultHook } from '../../http/openapi';

/**
 * `/v1/platform/tenants*` — ROLE-03/04/05 provisioning (D-19, D-29..D-32). Mounted by
 * `routes/platform/index.ts`, whose `requireSuperAdmin()` guards every handler here; this file
 * never opens the admin lane itself (Biome confines `withAdminTx` to the kernel platform lane).
 *
 * Every answer is `Cache-Control: no-store` and every mutation logs `platform.<area>.<verb>` with
 * `{ userId, requestId, tenantId }` (T-02-18; the audit table is Phase 8). Mutations answer the
 * fresh strict detail, so the panel never has to guess what changed.
 */
const tenants = new OpenAPIHono<PlatformEnv>({ defaultHook: platformDefaultHook });

const idParams = z.object({ id: z.uuid() });
/**
 * The toggle's key vocabulary is EVERY toggleable key (`TOGGLEABLE_MODULES`, 08.2-05), `store`
 * included: the panel lists them all. Which keys a NEW tenant starts with is a different question,
 * answered by `REAL_TENANT_DEFAULT_MODULES` at creation (without `store`, STORE-01).
 */
const moduleParams = z.object({ id: z.uuid(), key: z.enum(TOGGLEABLE_MODULES) });

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});
const detailResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: platformTenantDetailSchema } },
});
const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true as const },
});

const listRoute = createRoute({
  method: 'get',
  path: '/tenants',
  request: { query: platformTenantsQuerySchema },
  responses: {
    200: {
      description:
        'One page of tenants (slug order) with enabled modules and verified primary host; `q` matches name or slug, `cursor` is the previous nextCursor',
      content: { 'application/json': { schema: platformTenantsSchema } },
    },
    403: envelope('Not a platform admin, or a platform session on a tenant host (D-23)'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/tenants',
  request: jsonBody(createTenantBodySchema),
  responses: {
    201: detailResponse(
      'The provisioned tenant: branding with derived colors, one module row per key, the pending first-admin invite',
    ),
    400: envelope(
      'VALIDATION_FAILED — field issues, { slug: "taken" } for a duplicate slug, or { adminEmail: "in_use" } when the e-mail already has an identity on the platform',
    ),
    403: envelope('Not a platform admin'),
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/tenants/{id}',
  request: { params: idParams },
  responses: {
    200: detailResponse('Tenant, branding + contrast, modules, domains, invites, admins'),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/tenants/{id}',
  request: { params: idParams, ...jsonBody(updateTenantBodySchema) },
  responses: {
    200: detailResponse('The updated tenant (colors re-derived; the slug is immutable, D-31)'),
    400: envelope('VALIDATION_FAILED'),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

const statusRoute = createRoute({
  method: 'post',
  path: '/tenants/{id}/status',
  request: { params: idParams, ...jsonBody(setTenantStatusBodySchema) },
  responses: {
    200: detailResponse('The tenant after the status change (D-32)'),
    400: envelope('VALIDATION_FAILED'),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

const moduleRoute = createRoute({
  method: 'put',
  path: '/tenants/{id}/modules/{key}',
  request: { params: moduleParams, ...jsonBody(setModuleBodySchema) },
  responses: {
    200: detailResponse(
      'The tenant after the toggle; visible in its bootstrap and routes on the next request (ROLE-04, MOD-04)',
    ),
    400: envelope('VALIDATION_FAILED — `example` is not a toggleable key'),
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

/**
 * `GET /tenants/{id}/invites` and `POST /tenants/{id}/invites/{inviteId}/resend` (02-10, D-30):
 * the first-admin invite lifecycle from the Admins tab. The resend answer is the fresh invite row
 * (never a link or token — T-02-124); an invite that belongs to another tenant is a plain 404.
 */
const invitesListRoute = createRoute({
  method: 'get',
  path: '/tenants/{id}/invites',
  request: { params: idParams },
  responses: {
    200: {
      description: 'Every invite row of the tenant, oldest first',
      content: { 'application/json': { schema: tenantInvitesListSchema } },
    },
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant'),
  },
});

const inviteResendRoute = createRoute({
  method: 'post',
  path: '/tenants/{id}/invites/{inviteId}/resend',
  request: { params: inviteParamsSchema },
  responses: {
    200: {
      description:
        'The invite after the resend (status sent, fresh sentAt); pending invites go through the first send, sent/expired ones get a fresh token and a branded mail from the kernel transport',
      content: { 'application/json': { schema: tenantInviteSchema } },
    },
    403: envelope('Not a platform admin'),
    404: envelope('No such tenant or invite'),
    409: envelope(
      'INVITE_STATE_INVALID — { reason } is one of already_accepted (accepted, or the existing identity is already active here), no_verified_primary, not_invited (the existing identity is blocked or removed here) or email_in_use (the e-mail is a platform account, D-316); refused invites read expired with sentAt null. A member of another tenant is not refused (D-314)',
    ),
  },
});

async function detailOr404(id: string): Promise<PlatformTenantDetail> {
  const detail = await getTenantDetail(id);
  if (!detail) throw new ApiError(404, 'NOT_FOUND');
  return detail;
}

export const tenantsRoutes = tenants
  .openapi(listRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const query = c.req.valid('query');

    const page = await listPlatformTenants(query);
    const body: PlatformTenants = {
      tenants: page.rows.map((t) => ({
        id: t.id,
        slug: t.slug,
        displayName: t.displayName,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        enabledModules: t.enabledModules,
        primaryHost: t.primaryHost,
      })),
      nextCursor: page.nextCursor,
    };

    // Cross-tenant reads are audited from day one (T-06-05; the full audit log is Phase 8).
    c.get('logger').info(
      { event: 'platform.tenants.list', userId, requestId, count: body.tenants.length },
      'platform read',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  })
  .openapi(createRouteDef, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const body = c.req.valid('json');

    const { id } = await createTenant(body, { userId, logger: c.get('logger') });
    const detail = await detailOr404(id);

    c.get('logger').info(
      { event: 'platform.tenants.create', userId, requestId, tenantId: id, slug: body.slug },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(detail, 201);
  })
  .openapi(getRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');

    const detail = await detailOr404(id);

    c.get('logger').info(
      { event: 'platform.tenants.get', userId, requestId, tenantId: id },
      'platform read',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(detail, 200);
  })
  .openapi(patchRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    await updateTenant(id, body, { userId, logger: c.get('logger') });
    const detail = await detailOr404(id);

    c.get('logger').info(
      { event: 'platform.tenants.update', userId, requestId, tenantId: id },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(detail, 200);
  })
  .openapi(statusRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');

    await setTenantStatus(id, status, { userId, logger: c.get('logger') });
    const detail = await detailOr404(id);

    c.get('logger').info(
      { event: 'platform.tenants.status', userId, requestId, tenantId: id, status },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(detail, 200);
  })
  .openapi(moduleRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id, key } = c.req.valid('param');
    const { enabled } = c.req.valid('json');

    await setModuleEnabled(id, key, enabled, { userId, logger: c.get('logger') });
    const detail = await detailOr404(id);

    c.get('logger').info(
      { event: 'platform.modules.set', userId, requestId, tenantId: id, module: key, enabled },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(detail, 200);
  })
  .openapi(invitesListRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id } = c.req.valid('param');

    const body: TenantInvitesList = { invites: await listTenantInvites(id) };

    c.get('logger').info(
      { event: 'platform.invites.list', userId, requestId, tenantId: id },
      'platform read',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  })
  .openapi(inviteResendRoute, async (c) => {
    const { userId, requestId } = c.get('platformCtx');
    const { id, inviteId } = c.req.valid('param');

    const invite = await resendInvite(id, inviteId, { userId, logger: c.get('logger') });

    c.get('logger').info(
      { event: 'platform.invites.resend', userId, requestId, tenantId: id, inviteId },
      'platform write',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(invite, 200);
  });
