import { createRoute } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@rede-social/contracts';
import {
  KERNEL_PERMISSIONS,
  moderationLogPageSchema,
  moderationLogQuerySchema,
} from '@rede-social/contracts/moderation';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { listModerationLog } from '@rede-social/core/server/moderation/read';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import { createOpenApiApp } from '../../http/openapi';

/**
 * `/v1/admin/moderation-log` (MODER-03, D-337, UI-D-277) — the tenant's moderation history, read only.
 *
 * TENANT LANE: `requireAuth` makes `ctx.tenantId` the membership of record and the read runs in
 * `withTenantTx`, so `moderation_log_tenant_select` hides every other tenant's rows. WHO may read it is
 * the PERMISSION `moderation.manage` (D-338), never a role: a member or a `support_tenant` gets 403
 * `FORBIDDEN`, and a later grant to support needs no code change (FEED-08, T-08-07).
 *
 * There is no write route here and there never will be: the log is written only by
 * `recordModerationAction(tx, …)` inside each moderator action's own transaction, and the table
 * refuses update, delete and truncate in every lane (`*_moderation_log_immutable.sql`).
 */
const moderation = createOpenApiApp();
moderation.use('*', requireAuth);

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

const listRoute = createRoute({
  method: 'get',
  path: '/',
  middleware: [requirePermission(KERNEL_PERMISSIONS.moderationManage)] as const,
  request: { query: moderationLogQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of this tenant's moderation log, newest first (`created_at desc, id desc`), optionally narrowed to one `action`. Names are read live (`displayName: null` for a departed member); `actor.isViewer` marks the caller's own actions. `cursor` is OPAQUE (a tampered one answers page 1); `nextCursor` is non-null exactly when another row exists. `limit` clamps to 1..50",
      content: { 'application/json': { schema: moderationLogPageSchema } },
    },
    400: envelope('VALIDATION_FAILED — an unknown `action` or an unknown query key'),
    403: envelope('FORBIDDEN — the caller does not hold `moderation.manage` in this tenant'),
  },
});

export const moderationLogRoutes = moderation.openapi(listRoute, async (c) => {
  const page = await listModerationLog(c.get('ctx'), c.req.valid('query'));
  c.header('Cache-Control', 'no-store');
  return c.json(page, 200);
});
