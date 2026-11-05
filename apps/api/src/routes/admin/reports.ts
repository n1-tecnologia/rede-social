import { createRoute, z } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@rede-social/contracts';
import {
  KERNEL_PERMISSIONS,
  reportListAnswerSchema,
  reportListQuerySchema,
  reportResolveAnswerSchema,
  reportResolveBodySchema,
} from '@rede-social/contracts/moderation';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import { listReports, resolveReport } from '@rede-social/core/server/safety/index';
import { removeReportedContentInTx } from '@rede-social/module-feed/server';
import { createOpenApiApp } from '../../http/openapi';

/**
 * `/v1/admin/reports` (Phase 13, plan 14, D-616; NATIVE-31; UI-D-637, UI-D-638) — the tenant admin's queue of
 * reported posts and comments, and the resolution of each.
 *
 * TENANT LANE, PERMISSION NEVER ROLE (D-338): `requireAuth` makes `ctx.tenantId` the membership of record, and every
 * route needs `moderation.manage` exactly as the moderation log does (a member or a `support_tenant` is 403
 * `FORBIDDEN`, and a later grant needs no code change). A report of another tenant is invisible to the select policy
 * and unknown to the resolve definer (the bare 404).
 *
 * The resolution removes content or blocks a person ONLY here, through the shipped paths in one transaction (T-13-33).
 * The post and comment removal is the feed module's own function, handed to the kernel because the kernel never
 * imports a module (MOD-02). Nothing here notifies the author or the reporter. Every answer is `no-store`.
 */
const reports = createOpenApiApp();
reports.use('*', requireAuth);

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

const guard = requirePermission(KERNEL_PERMISSIONS.moderationManage);

const listRoute = createRoute({
  method: 'get',
  path: '/',
  middleware: [guard] as const,
  request: { query: reportListQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of this tenant's reports, newest first (`created_at desc, id desc`), narrowed by `estado` (`abertas` default, `resolvidas`, `todas`). Names are read live (`displayName: null` for a departed member); `contentAvailable` says whether the reported item is still live; `author.isMember` says whether the block-author row may be offered. `cursor` is OPAQUE (a tampered one answers page 1); `nextCursor` is non-null exactly when another row exists. `limit` clamps to 1..50",
      content: { 'application/json': { schema: reportListAnswerSchema } },
    },
    400: envelope('VALIDATION_FAILED — an unknown `estado` or an unknown query key'),
    403: envelope('FORBIDDEN — the caller does not hold `moderation.manage` in this tenant'),
  },
});

const resolveRoute = createRoute({
  method: 'post',
  path: '/{id}/resolve',
  middleware: [guard] as const,
  request: {
    params: z.object({ id: z.uuid() }),
    body: { content: { 'application/json': { schema: reportResolveBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The report after the resolution: `dismiss` -> `dismissed`; `remove_content` -> `content_removed` (the post or comment is removed through the moderation path, its log row written in the same transaction; an item already removed is not removed twice); `block_author` -> `author_blocked` (the author member is blocked through the admin block, `member_blocked` logged in the same transaction). Nobody is notified',
      content: { 'application/json': { schema: reportResolveAnswerSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED — an unknown `resolution`, a reason over 500 characters or an unknown key',
    ),
    403: envelope('FORBIDDEN — the caller does not hold `moderation.manage`'),
    404: envelope('NOT_FOUND — unknown or another tenant’s report: ONE bare body'),
    409: envelope(
      'REPORT_ALREADY_RESOLVED — another admin resolved it first; CONFLICT with `details.report` (`not_removable`, `author_not_member`, `author_unavailable`) or `details.member` (the Phase 8 block refusals)',
    ),
  },
});

export const adminReportsRoutes = reports
  .openapi(listRoute, async (c) => {
    const page = await listReports(c.get('ctx'), c.req.valid('query'));
    c.header('Cache-Control', 'no-store');
    return c.json(page, 200);
  })
  .openapi(resolveRoute, async (c) => {
    const { id } = c.req.valid('param');
    const done = await resolveReport(c.get('ctx'), id, c.req.valid('json'), {
      removeContent: removeReportedContentInTx,
    });
    c.header('Cache-Control', 'no-store');
    return c.json(done, 200);
  });
