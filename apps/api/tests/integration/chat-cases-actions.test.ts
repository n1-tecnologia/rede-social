import { subscribe } from '@rede-social/core/server/events/bus';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  type CaseResult,
  type ChatCaseAssigned,
  type ChatCaseResolved,
  caseResultSchema,
  type SendResult,
} from '@rede-social/module-chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  caseKit,
  highestNumber,
  post,
  removeThrowaways,
  request,
  sweepCases,
  throwawayMember,
} from './chat-case-fixtures';
import { adminSql, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * The team's write API of the support case, end to end against the live local stack (Phase 12.4, plan 08): the five
 * action routes and the edit route call the two definers of plan 03, and the database decides every transition
 * (CASE-05, CASE-07, CASE-08, CASE-09, CASE-10, CASE-19, CASE-23, CASE-24; D-805, D-806, D-808, D-841, D-842, D-845).
 *
 * The tenant counter is never touched: every number assertion is RELATIVE. Test ORDER is load-bearing
 * (`fileParallelism: false`, declaration order). Races use `Promise.all` and never a sleep.
 */

const resolvedEvents: ChatCaseResolved[] = [];
const assignedEvents: ChatCaseAssigned[] = [];
let stopResolved: () => void = () => undefined;
let stopAssigned: () => void = () => undefined;

beforeAll(async () => {
  await caseKit();
  await sweepCases();
  stopResolved = subscribe('chat.case_resolved', async (payload) => {
    resolvedEvents.push(payload);
  });
  stopAssigned = subscribe('chat.case_assigned', async (payload) => {
    assignedEvents.push(payload);
  });
});

afterAll(async () => {
  stopResolved();
  stopAssigned();
  await sweepCases();
  await removeThrowaways();
});

async function send(token: string, body: Record<string, unknown>): Promise<SendResult> {
  const res = await post('/v1/chat/support/messages', token, body);
  expect(res.status).toBe(201);
  return (await res.json()) as SendResult;
}

const reply = (token: string, conversationId: string, body = 'Resposta da equipe') =>
  post(`/v1/chat/conversations/${conversationId}/messages`, token, { body });

/** `POST .../case/<action>` as the given lane. */
const act = (token: string, conversationId: string, action: string, body: unknown) =>
  post(`/v1/chat/conversations/${conversationId}/case/${action}`, token, body);

const edit = (token: string, conversationId: string, body: unknown) =>
  request(`/v1/chat/conversations/${conversationId}/case`, token, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

async function caseOf(res: Response): Promise<CaseResult['case']> {
  expect(res.status).toBe(200);
  return caseResultSchema.parse(await res.json()).case;
}

type Refusal = { status: number; code: string; chat: string | undefined; details: unknown };

async function refusal(res: Response): Promise<Refusal> {
  const body = (await res.json()) as {
    error: { code: string; details?: { chat?: string } };
  };
  return {
    status: res.status,
    code: body.error.code,
    chat: body.error.details?.chat,
    details: body.error.details,
  };
}

/** The answer of a refused request without its per-request id, to compare two refusals byte for byte. */
async function shape(res: Response): Promise<{ status: number; body: unknown }> {
  const body = (await res.json()) as { error: Record<string, unknown> };
  const { requestId: _requestId, ...error } = body.error;
  return { status: res.status, body: { error } };
}

/** A fresh case: a throwaway member writes its first message. */
async function openCase(label: string, extra: Record<string, unknown> = {}) {
  const member = await throwawayMember(label);
  const sent = await send(member.token, { body: `Preciso de ajuda (${label})`, ...extra });
  return { member, id: sent.conversationId };
}

type DbCase = {
  state: string;
  owner: string | null;
  priority: string | null;
  category: string | null;
  subject: string | null;
  last_seq: number;
  staff_last_read_seq: number;
  resolved_at: string | null;
  closed_at: string | null;
};

async function rowOf(id: string): Promise<DbCase> {
  const [row] = await adminSql<DbCase[]>`
    select state, owner_user_id::text as owner, priority, category, subject,
           last_seq::int as last_seq, staff_last_read_seq::int as staff_last_read_seq,
           resolved_at::text as resolved_at, closed_at::text as closed_at
      from public.chat_conversations where id = ${id}::uuid`;
  if (!row) throw new Error(`no case ${id}`);
  return row;
}

async function eventsOf(id: string) {
  return adminSql<
    { kind: string; from_state: string | null; to_state: string | null; field: string | null }[]
  >`
    select kind, from_state, to_state, field
      from public.chat_case_events
     where conversation_id = ${id}::uuid
     order by created_at, id`;
}

async function countEvents(tenantId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.chat_case_events where tenant_id = ${tenantId}::uuid`;
  return row?.n ?? 0;
}

async function countSignals(): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from realtime.messages`;
  return row?.n ?? 0;
}

async function countMessages(id: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.chat_messages where conversation_id = ${id}::uuid`;
  return row?.n ?? 0;
}

/** Both domain-event spies at once: [resolved, assigned]. */
const emitted = () => [resolvedEvents.length, assignedEvents.length] as const;

describe('case resolve', () => {
  it('tracer: staff resolves an in_progress case through the API, one ids-only event, and a stale repeat is refused silently (D-845, D-808, CASE-05, CASE-09)', async () => {
    const { tokens, ids } = await caseKit();
    const { id } = await openCase('resolve-tracer');
    // A staff reply on an unowned open case takes it (plan 02).
    expect((await reply(tokens.demoSupport, id)).status).toBe(201);
    const before = resolvedEvents.length;

    const res = await act(tokens.demoSupport, id, 'resolve', { expectedState: 'in_progress' });
    const resolved = await caseOf(res);
    expect(resolved.state).toBe('resolved');
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.ownerUserId).toBe(ids.demoSupport);
    expect(resolved.actions).toContain('reopen');
    expect(resolved.actions).toContain('close');
    expect(resolved.actions).not.toContain('resolve');

    // Exactly one event, ids and an instant only, emitted after the commit.
    expect(resolvedEvents.length).toBe(before + 1);
    const event = resolvedEvents[resolvedEvents.length - 1] as ChatCaseResolved;
    expect(Object.keys(event).sort()).toEqual(['conversationId', 'resolvedAt', 'tenantId']);
    expect(event.conversationId).toBe(id);
    expect(event.tenantId).toBe(ids.demo);
    expect(event.resolvedAt).toBe(resolved.resolvedAt);

    // The same request with the old expected state: stale, and nothing is emitted.
    const stale = await refusal(
      await act(tokens.demoSupport, id, 'resolve', { expectedState: 'in_progress' }),
    );
    expect([stale.status, stale.code, stale.chat]).toEqual([409, 'CONFLICT', 'case_stale']);
    expect(resolvedEvents.length).toBe(before + 1);

    // The stale refusal wrote nothing: the case still reads as resolved, with the same instant.
    const detail = await request(`/v1/chat/conversations/${id}`, tokens.demoSupport);
    expect(detail.status).toBe(200);
    const read = (await detail.json()) as { case?: { state: string; resolvedAt: string | null } };
    expect(read.case?.state).toBe('resolved');
    expect(read.case?.resolvedAt).toBe(resolved.resolvedAt);
  });
});
