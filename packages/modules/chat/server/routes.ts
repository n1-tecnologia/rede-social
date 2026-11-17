import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  CHAT_ISSUE_SET,
  caseActionInputSchema,
  caseAssignInputSchema,
  caseEditInputSchema,
  caseHistorySchema,
  caseResultSchema,
  conversationDetailSchema,
  inboxPageSchema,
  inboxQuerySchema,
  messagePageSchema,
  messageQuerySchema,
  myCasesPageSchema,
  myCasesQuerySchema,
  readInputSchema,
  sendMessageInputSchema,
  sendResultSchema,
  staffRosterSchema,
  supportSendInputSchema,
  supportThreadSchema,
} from '../contracts/index';
import { getCaseHistory, getMyCases, getStaffRoster, runCaseAction, runCaseEdit } from './cases';
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

/** The member's first message may carry the category and the subject of the case it opens (D-811, D-812). */
const supportBodyRequest = {
  body: {
    required: true,
    content: { 'application/json': { schema: supportSendInputSchema } },
  },
} as const;

const bodyRefusal = {
  description:
    '`VALIDATION_FAILED` with `details.chat`: `body_required` when the body is empty or only whitespace (spaces, tabs, line breaks), `body_too_long` above 2,000 code points after trim and `subject_too_long` above 80 code points on the member route. An unknown key (a priority, a state, an owner) is a plain `VALIDATION_FAILED`. Nothing is written.',
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
  request: supportBodyRequest,
  responses: {
    201: {
      description:
        "CHAT-02: the member writes to the team. The first message creates the member's support case (D-220, D-802) in the same transaction, with the optional `category` and `subject` applied ONLY by that statement and ignored when the message goes to an existing active case (D-812); the priority is born normal and unreachable. The answer adds `case` with `opened` (this message created it) and `reopened` (it moved a resolved case back to open), never both. The database assigns the next gapless `seq` and publishes ids-only signals on the conversation and the support inbox.",
      content: { 'application/json': { schema: sendResultSchema } },
    },
    400: bodyRefusal,
    403: { description: '`FORBIDDEN` for staff: they never own a support conversation.' },
  },
});

const myCasesRoute = createRoute({
  method: 'get',
  path: '/support/cases',
  middleware: [requirePermission('chat.support.contact')] as const,
  request: { query: myCasesQuerySchema },
  responses: {
    200: {
      description:
        "D-803, CASE-14: the CALLER's own cases only. `current` is the active case (null when none), `items` the closed ones newest first (`case_number desc`), 20 per page by keyset, `total` the count of closed cases. A GET: nothing is created. A member sees no priority, owner or staff id (UI-D-835) and no route looks a case up by its number (D-804).",
      content: { 'application/json': { schema: myCasesPageSchema } },
    },
    403: { description: '`FORBIDDEN` for staff: the team works from the inbox (D-223).' },
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
        "D-224: `viewer: 'staff'` answers the member behind the thread (membership id, display name, avatar, state `active` | `blocked` | `removed`), the team's shared read position and the staff `case` with the `actions[]` this viewer may take (D-842); `viewer: 'member'` answers the member's own position and, for ANY case of theirs (a closed one reads read-only), the member-shaped `case` (D-803, UI-D-835).",
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
        "CHAT-03, CASE-16: the support cases of the tenant, latest activity first (`last_message_at desc, id desc`, a thread with no message first), with the member, a one-line preview of the latest message, its side and the team author's first name, the instant, `awaiting` and the case facts (number, state, label, category, priority, the owner's name). `tab` is `open` (open plus in progress, the default), `resolved` or `closed`; `owner` is `me`, `none` or a user id; `priority` is `low`, `normal` or `high`; `awaiting` keeps the cases whose last message is the member's and unread by the team (open tab only). A bad value of any key degrades to its default. `nextCursor` is opaque; `limit` clamps.",
      content: { 'application/json': { schema: inboxPageSchema } },
    },
    403: { description: '`FORBIDDEN` without `chat.support`.' },
  },
});

const historyRoute = createRoute({
  method: 'get',
  path: '/conversations/{conversationId}/case/history',
  middleware: [requirePermission('chat.support')] as const,
  request: { params: conversationParamSchema },
  responses: {
    200: {
      description:
        "D-810, CASE-12: the events of one case oldest first by `(created_at, id)` with the actor's and the target's display name (absent for someone who left the tenant), then up to five earlier cases of the same member, newest first, and `hasMoreEarlier`. Staff only; a GET that writes nothing and marks nothing read.",
      content: { 'application/json': { schema: caseHistorySchema } },
    },
    403: { description: '`FORBIDDEN` without `chat.support`: a member never reads the history.' },
    404: {
      description:
        'A bare `NOT_FOUND` for an unknown conversation, a non-support one or another tenant’s.',
    },
  },
});

const staffRoute = createRoute({
  method: 'get',
  path: '/staff',
  middleware: [requirePermission('chat.support')] as const,
  responses: {
    200: {
      description:
        'D-806: the live team of the tenant (active, unblocked, undeleted members with a staff role), names only, sorted by name then id. The one list behind the owner filter and the assign sheet.',
      content: { 'application/json': { schema: staffRosterSchema } },
    },
    403: { description: '`FORBIDDEN` without `chat.support`: a member never reads the roster.' },
  },
});

/* ── Phase 12.4, plan 08: the team's write API (D-845, CASE-05, CASE-10, CASE-24) ─────────────────── */

/**
 * Every case route calls a security definer and the DATABASE decides (D-845): no route computes a transition, writes a
 * state, an owner or a priority, or accepts a case number. The refusals come from one mapper, `mapCaseError`.
 */
const caseActionRequest = {
  params: conversationParamSchema,
  body: { required: true, content: { 'application/json': { schema: caseActionInputSchema } } },
} as const;

const caseAssignRequest = {
  params: conversationParamSchema,
  body: { required: true, content: { 'application/json': { schema: caseAssignInputSchema } } },
} as const;

const caseEditRequest = {
  params: conversationParamSchema,
  body: { required: true, content: { 'application/json': { schema: caseEditInputSchema } } },
} as const;

const caseActionResponses = {
  400: {
    description:
      '`VALIDATION_FAILED`: a malformed id, a key outside `expectedState` and `expectedOwnerId` (a forged state or owner) or an `expectedState` outside the four states. Nothing is written.',
  },
  403: {
    description: '`FORBIDDEN` without the route permission or without a live staff membership.',
  },
  404: {
    description:
      'One bare `NOT_FOUND` for an unknown case, another tenant’s and a non-support conversation: identical on purpose, so no route is an existence oracle.',
  },
  409: {
    description:
      '`CONFLICT` with `details.chat`: `case_stale` when the case is no longer in the state (or with the owner) the caller saw, `transition_not_allowed` when the action does not apply to that state. Nothing is written and nothing is emitted.',
  },
} as const;

const caseOk = (description: string) =>
  ({
    description,
    content: { 'application/json': { schema: caseResultSchema } },
  }) as const;

const takeRoute = createRoute({
  method: 'post',
  path: '/conversations/{conversationId}/case/take',
  middleware: [requirePermission('chat.support')] as const,
  request: caseActionRequest,
  responses: {
    200: caseOk(
      'D-805, D-842: the caller takes an open case, or takes over an in-progress case of another person when `expectedOwnerId` names the owner they saw. Answers the fresh case with its `actions[]`. Nothing is emitted.',
    ),
    ...caseActionResponses,
  },
});

const resolveRoute = createRoute({
  method: 'post',
  path: '/conversations/{conversationId}/case/resolve',
  middleware: [requirePermission('chat.support')] as const,
  request: caseActionRequest,
  responses: {
    200: caseOk(
      'D-805, D-842: any staff member resolves an open or in-progress case, whoever owns it. Answers the fresh case and emits the ids-only `chat.case_resolved` after the commit (the member’s resolved notice, D-808).',
    ),
    ...caseActionResponses,
  },
});

const closeRoute = createRoute({
  method: 'post',
  path: '/conversations/{conversationId}/case/close',
  middleware: [requirePermission('chat.support')] as const,
  request: caseActionRequest,
  responses: {
    200: caseOk(
      'D-805, D-841: any staff member closes an open, in-progress or resolved case. Silent: nothing is emitted and the member is told nothing.',
    ),
    ...caseActionResponses,
  },
});

const reopenRoute = createRoute({
  method: 'post',
  path: '/conversations/{conversationId}/case/reopen',
  middleware: [requirePermission('chat.support')] as const,
  request: caseActionRequest,
  responses: {
    200: caseOk(
      'D-805, D-841: the team reopens a RESOLVED case (the owner is cleared). A closed case is never reopened. Silent: nothing is emitted.',
    ),
    ...caseActionResponses,
  },
});

const assignRoute = createRoute({
  method: 'post',
  path: '/conversations/{conversationId}/case/assign',
  middleware: [requirePermission('chat.support.assign')] as const,
  request: caseAssignRequest,
  responses: {
    200: caseOk(
      'D-806: a holder of `chat.support.assign` (`admin_tenant` only) hands an open or in-progress case to a live staff member who is not already its owner. Answers the fresh case and emits the ids-only `chat.case_assigned` after the commit (the assignee’s notice, D-809).',
    ),
    ...caseActionResponses,
    400: {
      description:
        '`VALIDATION_FAILED`: a malformed body, or `details.chat = assignee_invalid` when the target is not a live staff member of this tenant or is already the owner.',
    },
  },
});

const editRoute = createRoute({
  method: 'patch',
  path: '/conversations/{conversationId}/case',
  middleware: [requirePermission('chat.support')] as const,
  request: caseEditRequest,
  responses: {
    200: caseOk(
      'D-812, CASE-10: the team corrects the category, the subject (`null` blanks it) or the priority of a case that is not closed, one history row per changed field. Answers the fresh case. Nothing is emitted.',
    ),
    ...caseActionResponses,
    400: {
      description:
        '`VALIDATION_FAILED`: a key outside the four allowed (`state`, an owner, a number), `details.chat = case_nothing_to_edit` for a body with no field and `subject_too_long` above 80 code points. Nothing is written.',
    },
  },
});

/** A 204 that no cache may keep: read positions are the caller's own state. */
const noContent = () =>
  new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export const chatRoutes = chat
  .openapi(supportThreadRoute, async (c) => c.json(await getSupportThread(c.get('ctx')), 200))
  .openapi(supportSendRoute, async (c) =>
    c.json(await sendSupportMessage(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(myCasesRoute, async (c) =>
    c.json(await getMyCases(c.get('ctx'), c.req.valid('query')), 200),
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
  )
  .openapi(historyRoute, async (c) =>
    c.json(await getCaseHistory(c.get('ctx'), c.req.valid('param').conversationId), 200),
  )
  .openapi(staffRoute, async (c) => c.json(await getStaffRoster(c.get('ctx')), 200))
  .openapi(takeRoute, async (c) =>
    c.json(
      await runCaseAction(
        c.get('ctx'),
        c.req.valid('param').conversationId,
        'take',
        c.req.valid('json'),
      ),
      200,
    ),
  )
  .openapi(resolveRoute, async (c) =>
    c.json(
      await runCaseAction(
        c.get('ctx'),
        c.req.valid('param').conversationId,
        'resolve',
        c.req.valid('json'),
      ),
      200,
    ),
  )
  .openapi(closeRoute, async (c) =>
    c.json(
      await runCaseAction(
        c.get('ctx'),
        c.req.valid('param').conversationId,
        'close',
        c.req.valid('json'),
      ),
      200,
    ),
  )
  .openapi(reopenRoute, async (c) =>
    c.json(
      await runCaseAction(
        c.get('ctx'),
        c.req.valid('param').conversationId,
        'reopen',
        c.req.valid('json'),
      ),
      200,
    ),
  )
  .openapi(assignRoute, async (c) =>
    c.json(
      await runCaseAction(
        c.get('ctx'),
        c.req.valid('param').conversationId,
        'assign',
        c.req.valid('json'),
      ),
      200,
    ),
  )
  .openapi(editRoute, async (c) =>
    c.json(
      await runCaseEdit(c.get('ctx'), c.req.valid('param').conversationId, c.req.valid('json')),
      200,
    ),
  );
