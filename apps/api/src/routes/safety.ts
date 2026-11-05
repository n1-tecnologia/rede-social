import { createRoute } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@rede-social/contracts';
import {
  reportCreateAnswerSchema,
  reportCreateBodySchema,
} from '@rede-social/contracts/moderation';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import {
  createReport,
  reportLimiter,
  safetyLimiterKey,
} from '@rede-social/core/server/safety/index';
import { createOpenApiApp } from '../http/openapi';

/**
 * The member lane of reports and blocks (Phase 13, plan 14, D-616; NATIVE-31, NATIVE-33): `POST /v1/reports` and
 * the three `/v1/blocks` routes. Two groups, `reportRoutes` and `blockRoutes`, mounted at their own prefix so each
 * group's `requireAuth` covers only its own paths.
 *
 * TENANT LANE, EVERY ROLE. Each group carries `requireAuth`, so `ctx.tenantId` (the membership of record) and
 * `ctx.userId` are the only tenant and person any handler acts on: a subject or a user id of another tenant is the
 * same 404 / 400 as a missing one (the SQL definers pin both to the claims). No permission guards these routes:
 * reporting and blocking are for every signed-in member; WHO may be blocked (a `member`, never staff, AD-1) is a
 * rule of the SQL definer, not of a role comparison here.
 *
 * NOBODY IS TOLD, NOBODY IS NAMED (T-13-32): no answer carries the reporter's or the blocker's identity, nothing is
 * notified, and no event names a report or a block. Every answer is `no-store`.
 */
const reports = createOpenApiApp();
reports.use('*', requireAuth);

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  request: {
    body: { content: { 'application/json': { schema: reportCreateBodySchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The report was filed: its id only. The author is not told; the answer names no one. A note is trimmed, an empty one is stored as null',
      content: { 'application/json': { schema: reportCreateAnswerSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED — a missing or unknown `reason` or `subjectType` (a story comment, a community or a message is not reportable yet), a malformed id, a note over 500 characters or an unknown key',
    ),
    403: envelope(
      'CANNOT_REPORT_OWN — the caller wrote the content; FORBIDDEN — not a live member',
    ),
    404: envelope(
      'NOT_FOUND — ONE bare body for a missing, removed or another tenant’s post or comment',
    ),
    409: envelope('ALREADY_REPORTED — this member already reported this item'),
    429: envelope('RATE_LIMITED — more than 20 reports in an hour'),
  },
});

export const reportRoutes = reports.openapi(createRoute_, async (c) => {
  const ctx = c.get('ctx');
  const body = c.req.valid('json');
  if (!reportLimiter.consume(safetyLimiterKey(ctx))) throw new ApiError(429, 'RATE_LIMITED');
  const created = await createReport(ctx, body);
  c.header('Cache-Control', 'no-store');
  return c.json(created, 201);
});
