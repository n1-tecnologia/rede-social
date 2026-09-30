import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  CHAT_ISSUE_SET,
  conversationDetailSchema,
  inboxPageSchema,
  inboxQuerySchema,
  messagePageSchema,
  messageQuerySchema,
  readInputSchema,
  sendMessageInputSchema,
  sendResultSchema,
  supportThreadSchema,
} from '../contracts/index';
import {
  getConversation,
  getSupportThread,
  listInbox,
  listMessages,
  markConversationRead,
  replyToConversation,
  sendSupportMessage,
} from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/chat', chatRoutes)` and cannot forget a guard.
 *
 * `requireAuth` (401) -> `requireModule('chat')` (404 `MODULE_DISABLED` when the tenant does not have
 * chat, never 403) -> a PERMISSION per route, never a role comparison (D-223):
 *  - the member's own thread (`GET /support`, `POST /support/messages`) requires
 *    `chat.support.contact`, which only members hold, so staff of either role are never offered a
 *    support conversation of their own (403);
 *  - answering (`POST /conversations/{id}/messages`) and the inbox (`GET /inbox`) require
 *    `chat.support`, which the chat manifest grants to both staff roles, so disabling chat revokes it;
 *  - the catch-up read (`GET /conversations/{id}/messages`), the detail (`GET /conversations/{id}`)
 *    and the read mark (`POST /conversations/{id}/read`) carry no route permission: they serve the
 *    thread's member AND staff, and the service branches on `chat.support` (the staff read moves the
 *    team's shared position only for a holder of it) while the participant/staff-aware policies plus
 *    the service's predicates decide who may touch the thread at all.
 *
 * Machine codes live under `details.chat` (the closed `CHAT_ISSUES` vocabulary).
 */
const chat = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const code = result.error.issues
        .map((issue) => issue.message)
        .find((message) => CHAT_ISSUE_SET.has(message));
      if (code) throw new ApiError(400, 'VALIDATION_FAILED', { chat: code });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

chat.use('*', requireAuth, requireModule('chat'));

/** The path parameter: a malformed id is a 400 before any read, never a 500 at the `::uuid` cast. */
const conversationParamSchema = z.object({ conversationId: z.uuid() });

const bodyRequest = {
  body: {
    required: true,
    content: { 'application/json': { schema: sendMessageInputSchema } },
  },
} as const;

const bodyRefusal = {
  description:
    '`VALIDATION_FAILED` with `details.chat`: `body_required` when the body is empty or only whitespace (spaces, tabs, line breaks) and `body_too_long` above 2,000 code points after trim. An unknown key is a plain `VALIDATION_FAILED`. Nothing is written.',
};

const supportThreadRoute = createRoute({
  method: 'get',
  path: '/support',
  middleware: [requirePermission('chat.support.contact')] as const,
  responses: {
    200: {
      description:
        "D-220: the CALLER's own support thread, read-only. Before their first message there is no conversation and the answer is `{ conversation: null, messages: [], hasOlder: false }`; opening the thread never creates one. Otherwise: the member's read position and the latest page of messages, oldest first.",
      content: { 'application/json': { schema: supportThreadSchema } },
    },
    403: { description: '`FORBIDDEN` for staff: the team answers from the inbox (D-223).' },
  },
});

const supportSendRoute = createRoute({
  method: 'post',
  path: '/support/messages',
  middleware: [requirePermission('chat.support.contact')] as const,
  request: bodyRequest,
  responses: {
    201: {
      description:
        "CHAT-02: the member writes to the team. The first message creates the member's one support conversation (D-220, D-221) in the same transaction; the database assigns the next gapless `seq` and publishes ids-only signals on the conversation and the support inbox.",
      content: { 'application/json': { schema: sendResultSchema } },
    },
    400: bodyRefusal,
    403: { description: '`FORBIDDEN` for staff: they never own a support conversation.' },
  },
});

const messagesRoute = createRoute({
  method: 'get',
  path: '/conversations/{conversationId}/messages',
  request: { params: conversationParamSchema, query: messageQuerySchema },
  responses: {
    200: {
      description:
        'CHAT-04 / D-240: `afterSeq=N` answers every message with `seq > N` (ascending, the catch-up after a missed signal), `beforeSeq=N` the page before `N` and no cursor the latest page, both ascending. `hasMore` says whether another page exists in that direction. A staff row carries only the agent’s first name.',
      content: { 'application/json': { schema: messagePageSchema } },
    },
    400: {
      description: '`VALIDATION_FAILED`: a malformed id, or both `afterSeq` and `beforeSeq`.',
    },
    404: {
      description:
        'One bare `NOT_FOUND` for an unknown conversation, another tenant’s, or another member’s: indistinguishable on purpose (D-23).',
    },
  },
});

const replyRoute = createRoute({
  method: 'post',
  path: '/conversations/{conversationId}/messages',
  middleware: [requirePermission('chat.support')] as const,
  request: { params: conversationParamSchema, ...bodyRequest },
  responses: {
    201: {
      description:
        'D-225: any staff member replies to any support conversation; nothing is assigned. The reply also marks the thread read for the whole team.',
      content: { 'application/json': { schema: sendResultSchema } },
    },
    400: bodyRefusal,
    403: { description: '`FORBIDDEN` without `chat.support`.' },
    404: { description: 'A bare `NOT_FOUND` for an unknown, foreign or non-support conversation.' },
    409: {
      description:
        '`CONFLICT` with `details.chat`: `member_blocked` when the member is blocked, `member_removed` when they left the tenant. The thread stays readable.',
    },
  },
});

const detailRoute = createRoute({
  method: 'get',
  path: '/conversations/{conversationId}',
  request: { params: conversationParamSchema },
  responses: {
    200: {
      description:
        "D-224: `viewer: 'staff'` answers the member behind the thread (membership id, display name, avatar, state `active` | `blocked` | `removed`) and the team's shared read position; `viewer: 'member'` answers the member's own position.",
      content: { 'application/json': { schema: conversationDetailSchema } },
    },
    404: { description: 'A bare `NOT_FOUND` for anyone who may not read the thread.' },
  },
});

const readRoute = createRoute({
  method: 'post',
  path: '/conversations/{conversationId}/read',
  request: {
    params: conversationParamSchema,
    body: { required: true, content: { 'application/json': { schema: readInputSchema } } },
  },
  responses: {
    204: {
      description:
        "The caller has seen the thread up to `seq`. Staff move the TEAM's shared position (one read clears 'awaiting' for every staff member, D-225); the member moves their own (clearing the dot, D-237). A position only moves forward and never past the latest message.",
    },
    400: { description: '`VALIDATION_FAILED`: `seq` missing or not a non-negative integer.' },
    404: { description: 'A bare `NOT_FOUND` for anyone who may not read the thread.' },
  },
});

const inboxRoute = createRoute({
  method: 'get',
  path: '/inbox',
  middleware: [requirePermission('chat.support')] as const,
  request: { query: inboxQuerySchema },
  responses: {
    200: {
      description:
        "CHAT-03: every support conversation of the tenant, latest activity first (`last_message_at desc, id desc`), with the member, a one-line preview of the latest message, its side and the team author's first name, the instant and `awaiting`. No open/resolved sections (D-221). `nextCursor` is opaque; `limit` clamps.",
      content: { 'application/json': { schema: inboxPageSchema } },
    },
    403: { description: '`FORBIDDEN` without `chat.support`.' },
  },
});

/** A 204 that no cache may keep: read positions are the caller's own state. */
const noContent = () =>
  new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export const chatRoutes = chat
  .openapi(supportThreadRoute, async (c) => c.json(await getSupportThread(c.get('ctx')), 200))
  .openapi(supportSendRoute, async (c) =>
    c.json(await sendSupportMessage(c.get('ctx'), c.req.valid('json').body), 201),
  )
  .openapi(messagesRoute, async (c) =>
    c.json(
      await listMessages(c.get('ctx'), c.req.valid('param').conversationId, c.req.valid('query')),
      200,
    ),
  )
  .openapi(replyRoute, async (c) =>
    c.json(
      await replyToConversation(
        c.get('ctx'),
        c.req.valid('param').conversationId,
        c.req.valid('json').body,
      ),
      201,
    ),
  )
  .openapi(detailRoute, async (c) =>
    c.json(await getConversation(c.get('ctx'), c.req.valid('param').conversationId), 200),
  )
  .openapi(readRoute, async (c) => {
    await markConversationRead(
      c.get('ctx'),
      c.req.valid('param').conversationId,
      c.req.valid('json').seq,
    );
    return noContent();
  })
  .openapi(inboxRoute, async (c) =>
    c.json(await listInbox(c.get('ctx'), c.req.valid('query')), 200),
  );
