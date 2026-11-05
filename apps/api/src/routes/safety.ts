import { createRoute, z } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@rede-social/contracts';
import {
  blockBodySchema,
  blockChangeAnswerSchema,
  blockListAnswerSchema,
  blockListQuerySchema,
  reportCreateAnswerSchema,
  reportCreateBodySchema,
} from '@rede-social/contracts/moderation';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import {
  blockLimiter,
  blockMember,
  createReport,
  listBlocks,
  reportLimiter,
  safetyLimiterKey,
  unblockMember,
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

/* ── /v1/blocks (NATIVE-33) ───────────────────────────────────────────────────────────────────────── */

const blocks = createOpenApiApp();
blocks.use('*', requireAuth);

const listBlocksRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: blockListQuerySchema },
  responses: {
    200: {
      description:
        "The members the CALLER blocked, newest first (`created_at desc`, then the blocked user id), with their name and avatar read live (`displayName: null` for a departed member). Only the caller's own blocks are ever listed; nobody else, the blocked member included, can read that a block exists. `cursor` is OPAQUE (a tampered one answers page 1); `nextCursor` is non-null exactly when another row exists. `limit` clamps to 1..50",
      content: { 'application/json': { schema: blockListAnswerSchema } },
    },
    400: envelope('VALIDATION_FAILED — an unknown query key'),
  },
});

const blockRoute = createRoute({
  method: 'post',
  path: '/',
  request: {
    body: { content: { 'application/json': { schema: blockBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The member is blocked for the caller: `changed` is true when this call created the block and false for the idempotent repeat. Nobody is told; the blocked member sees nothing different',
      content: { 'application/json': { schema: blockChangeAnswerSchema } },
    },
    400: envelope(
      'CANNOT_BLOCK — ONE body for a staff account, a person of another tenant, an unknown, blocked or removed member and oneself; VALIDATION_FAILED — a malformed id or an unknown key',
    ),
    429: envelope('RATE_LIMITED — more than 60 blocks in an hour'),
  },
});

const unblockRoute = createRoute({
  method: 'delete',
  path: '/{userId}',
  request: { params: z.object({ userId: z.uuid() }) },
  responses: {
    200: {
      description:
        "The caller's block of that member is lifted: `changed` is true when a block was removed and false when there was none (a repeat is the same 200). Only the caller's own block can be lifted",
      content: { 'application/json': { schema: blockChangeAnswerSchema } },
    },
    400: envelope('VALIDATION_FAILED — a malformed user id'),
  },
});

export const blockRoutes = blocks
  .openapi(listBlocksRoute, async (c) => {
    const page = await listBlocks(c.get('ctx'), c.req.valid('query'));
    c.header('Cache-Control', 'no-store');
    return c.json(page, 200);
  })
  .openapi(blockRoute, async (c) => {
    const ctx = c.get('ctx');
    const { userId } = c.req.valid('json');
    if (!blockLimiter.consume(safetyLimiterKey(ctx))) throw new ApiError(429, 'RATE_LIMITED');
    const done = await blockMember(ctx, userId);
    c.header('Cache-Control', 'no-store');
    return c.json(done, 200);
  })
  .openapi(unblockRoute, async (c) => {
    const { userId } = c.req.valid('param');
    const done = await unblockMember(c.get('ctx'), userId);
    c.header('Cache-Control', 'no-store');
    return c.json(done, 200);
  });
