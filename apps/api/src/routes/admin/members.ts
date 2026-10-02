import { createRoute, z } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@rede-social/contracts';
import {
  adminMemberListQuerySchema,
  adminMemberPageSchema,
  adminMemberSchema,
  KERNEL_PERMISSIONS,
  memberAccessBodySchema,
} from '@rede-social/contracts/moderation';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  getMemberForAdmin,
  listMembersForAdmin,
} from '@rede-social/core/server/tenancy/admin-members';
import { blockMembership, unblockMembership } from '@rede-social/core/server/tenancy/member-admin';
import { createOpenApiApp } from '../../http/openapi';

/**
 * `/v1/admin/members/*` (ADMIN-02, MODER-02, D-330..D-333, D-340, UI-D-271..274) — the Membros
 * screen: every membership of the tenant, and block / unblock with an optional internal reason.
 *
 * TENANT OF RECORD ONLY: `requireAuth` makes `ctx.tenantId` the caller's membership, and the kernel
 * services carry `tenant_id = ctx.tenantId` on every statement of their admin-lane transaction
 * (T-08-19). A membership id of another tenant is the bare 404, never a 403 that would confirm it
 * exists. A session on another tenant's host is 403 `TENANT_HOST_MISMATCH` before any of this runs.
 *
 * PERMISSIONS, NEVER ROLES (D-338): the list and the single read need `members.manage` OR
 * `moderation.manage` (unblocking lives here, so a moderator must be able to find a blocked member);
 * block and unblock need `moderation.manage`. Support and member get 403 `FORBIDDEN`. The rows carry
 * the e-mail, which is why nobody else may read them (ADMIN-02 privacy prohibition, T-08-23).
 *
 * The D-332 guards live in the kernel, not here: `409 CONFLICT { member: 'self' | 'last_admin' |
 * 'not_active' }`. The reason (D-331) is accepted here, written only to `moderation_log.reason`, and
 * appears in no response of this router. Logs carry ids only. Every answer is `no-store`.
 */
const members = createOpenApiApp();
members.use('*', requireAuth);

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

const memberParams = z.object({ membershipId: z.uuid() });

const readGuard = requirePermission(
  KERNEL_PERMISSIONS.membersManage,
  KERNEL_PERMISSIONS.moderationManage,
);
const writeGuard = requirePermission(KERNEL_PERMISSIONS.moderationManage);

const listRoute = createRoute({
  method: 'get',
  path: '/',
  middleware: [readGuard] as const,
  request: { query: adminMemberListQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of EVERY membership of this tenant (members, staff, blocked and invited; the caller's own row included, `isViewer: true`), ordered by the accent- and case-insensitive display name (the e-mail when there is none), then the e-mail, then the membership id. `q` matches the name or the e-mail (`%`, `_` and `\\` are literal); an empty `q` is no filter. `status` narrows to `active`, `blocked` (a `blocked_at`-only legacy row counts) or `invited`. `cursor` is OPAQUE (a tampered one answers page 1); `nextCursor` is non-null exactly when another row exists. `limit` clamps to 1..50",
      content: { 'application/json': { schema: adminMemberPageSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED — an unknown `status`, a `q` over 80 characters or an unknown key',
    ),
    403: envelope(
      'FORBIDDEN — the caller holds neither `members.manage` nor `moderation.manage` in this tenant',
    ),
  },
});

const readRoute = createRoute({
  method: 'get',
  path: '/{membershipId}',
  middleware: [readGuard] as const,
  request: { params: memberParams },
  responses: {
    200: {
      description: 'One membership of this tenant, in the list row shape (the member sheet)',
      content: { 'application/json': { schema: adminMemberSchema } },
    },
    403: envelope('FORBIDDEN — neither `members.manage` nor `moderation.manage`'),
    404: envelope(
      'NOT_FOUND — unknown, another tenant’s or removed: ONE bare body with no details',
    ),
  },
});

const accessRoute = (action: 'block' | 'unblock') =>
  createRoute({
    method: 'post',
    path: `/{membershipId}/${action}`,
    middleware: [writeGuard] as const,
    request: {
      params: memberParams,
      body: { content: { 'application/json': { schema: memberAccessBodySchema } } },
    },
    responses: {
      200: {
        description:
          action === 'block'
            ? 'The membership after the block: `status: "blocked"`. Idempotent: an already-blocked membership answers its current state and writes no second log row. The member’s next request answers 403 `MEMBERSHIP_BLOCKED`. Content is untouched (D-330); the optional `reason` is stored only in the moderation log (D-331)'
            : 'The membership after the unblock: `status: "active"`. Idempotent: an already-active membership answers its current state and writes no log row',
        content: { 'application/json': { schema: adminMemberSchema } },
      },
      400: envelope('VALIDATION_FAILED — a reason over 500 characters or an unknown body key'),
      403: envelope('FORBIDDEN — the caller does not hold `moderation.manage`'),
      404: envelope('NOT_FOUND — unknown, another tenant’s or removed: ONE bare body'),
      409: envelope(
        action === 'block'
          ? '`CONFLICT` with `details.member`: `self` (your own membership), `last_admin` (the tenant’s only active admin) or `not_active` (an invite not yet accepted)'
          : '`CONFLICT` with `details.member`: `self` or `not_active`',
      ),
    },
  });

export const adminMembersRoutes = members
  .openapi(listRoute, async (c) => {
    const page = await listMembersForAdmin(c.get('ctx'), c.req.valid('query'));
    c.header('Cache-Control', 'no-store');
    return c.json(page, 200);
  })
  .openapi(readRoute, async (c) => {
    const { membershipId } = c.req.valid('param');
    const member = await getMemberForAdmin(c.get('ctx'), membershipId);
    c.header('Cache-Control', 'no-store');
    return c.json(member, 200);
  })
  .openapi(accessRoute('block'), async (c) => {
    const { membershipId } = c.req.valid('param');
    const member = await blockMembership(c.get('ctx'), membershipId, c.req.valid('json'));
    c.get('logger')?.info({ event: 'admin.members.block', membershipId }, 'member block requested');
    c.header('Cache-Control', 'no-store');
    return c.json(member, 200);
  })
  .openapi(accessRoute('unblock'), async (c) => {
    const { membershipId } = c.req.valid('param');
    const member = await unblockMembership(c.get('ctx'), membershipId, c.req.valid('json'));
    c.get('logger')?.info(
      { event: 'admin.members.unblock', membershipId },
      'member unblock requested',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(member, 200);
  });
