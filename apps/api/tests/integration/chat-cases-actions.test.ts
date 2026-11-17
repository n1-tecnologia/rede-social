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

describe('case actions', () => {
  it('take: support takes an open case, the owner is the caller and nothing is emitted (CASE-05, D-841)', async () => {
    const { tokens, ids } = await caseKit();
    const { id } = await openCase('take');
    const before = emitted();
    const taken = await caseOf(
      await act(tokens.demoSupport, id, 'take', { expectedState: 'open' }),
    );
    expect(taken.state).toBe('in_progress');
    expect(taken.ownerUserId).toBe(ids.demoSupport);
    expect(taken.ownerIsViewer).toBe(true);
    expect(taken.actions).not.toContain('take');
    expect((await eventsOf(id)).map((e) => e.kind)).toEqual(['opened', 'taken']);
    expect(emitted()).toEqual(before);
  });

  it('take-over: another person without expectedOwnerId is case_stale, with it the take succeeds (D-842)', async () => {
    const { tokens, ids } = await caseKit();
    const { id } = await openCase('takeover');
    await caseOf(await act(tokens.demoSupport, id, 'take', { expectedState: 'open' }));
    const eventsBefore = (await eventsOf(id)).length;

    const refused = await refusal(
      await act(tokens.demoAdmin, id, 'take', { expectedState: 'in_progress' }),
    );
    expect([refused.status, refused.chat]).toEqual([409, 'case_stale']);
    expect((await rowOf(id)).owner).toBe(ids.demoSupport);
    expect((await eventsOf(id)).length).toBe(eventsBefore);

    const taken = await caseOf(
      await act(tokens.demoAdmin, id, 'take', {
        expectedState: 'in_progress',
        expectedOwnerId: ids.demoSupport,
      }),
    );
    expect(taken.ownerUserId).toBe(ids.demoAdmin);
    expect(taken.state).toBe('in_progress');
  });

  it('assign: admin hands a case to a live staff member and one ids-only chat.case_assigned is emitted; support gets 403 and nothing is written (D-806, T-12.4-35)', async () => {
    const { tokens, ids } = await caseKit();
    const { id } = await openCase('assign');
    const before = emitted();

    const forbidden = await refusal(
      await act(tokens.demoSupport, id, 'assign', {
        expectedState: 'open',
        assigneeUserId: ids.demoSupport,
      }),
    );
    expect([forbidden.status, forbidden.code]).toEqual([403, 'FORBIDDEN']);
    expect((await rowOf(id)).state).toBe('open');
    expect((await eventsOf(id)).map((e) => e.kind)).toEqual(['opened']);
    expect(emitted()).toEqual(before);

    const assigned = await caseOf(
      await act(tokens.demoAdmin, id, 'assign', {
        expectedState: 'open',
        assigneeUserId: ids.demoSupport,
      }),
    );
    expect(assigned.state).toBe('in_progress');
    expect(assigned.ownerUserId).toBe(ids.demoSupport);
    expect(emitted()).toEqual([before[0], before[1] + 1]);
    const event = assignedEvents[assignedEvents.length - 1] as ChatCaseAssigned;
    expect(Object.keys(event).sort()).toEqual([
      'actorUserId',
      'assigneeUserId',
      'conversationId',
      'tenantId',
    ]);
    expect(event).toEqual({
      tenantId: ids.demo,
      conversationId: id,
      assigneeUserId: ids.demoSupport,
      actorUserId: ids.demoAdmin,
    });
  });

  it('assign: a member, a blocked staff member, another tenant’s staff and the current owner are assignee_invalid (CS005)', async () => {
    const { tokens, ids } = await caseKit();
    const { id } = await openCase('assign-invalid');
    const blocked = await throwawayMember('assign-blocked', 'support_tenant');
    await adminSql`
      update public.memberships set blocked_at = now(), status = 'blocked'
       where tenant_id = ${ids.demo}::uuid and user_id = ${blocked.id}::uuid`;
    const [labAdmin] = await adminSql<{ id: string }[]>`
      select id::text as id from auth.users where email = 'admin@rede-lab.local'`;
    const before = emitted();
    const eventsBefore = (await eventsOf(id)).length;

    for (const target of [ids.demoMember, blocked.id, labAdmin?.id ?? '']) {
      const refused = await refusal(
        await act(tokens.demoAdmin, id, 'assign', {
          expectedState: 'open',
          assigneeUserId: target,
        }),
      );
      expect([refused.status, refused.code, refused.chat]).toEqual([
        400,
        'VALIDATION_FAILED',
        'assignee_invalid',
      ]);
    }
    expect((await rowOf(id)).state).toBe('open');

    // The current owner is not a valid target either.
    await caseOf(
      await act(tokens.demoAdmin, id, 'assign', {
        expectedState: 'open',
        assigneeUserId: ids.demoSupport,
      }),
    );
    const again = await refusal(
      await act(tokens.demoAdmin, id, 'assign', {
        expectedState: 'in_progress',
        assigneeUserId: ids.demoSupport,
      }),
    );
    expect([again.status, again.chat]).toEqual([400, 'assignee_invalid']);
    expect((await eventsOf(id)).length).toBe(eventsBefore + 1);
    expect(emitted()).toEqual([before[0], before[1] + 1]);
  });

  it('close: from open, in_progress and resolved, silent, and the team position moves to the last message (D-841, EP-026)', async () => {
    const { tokens } = await caseKit();
    const before = emitted();

    const open = await openCase('close-open');
    const closedOpen = await caseOf(
      await act(tokens.demoAdmin, open.id, 'close', { expectedState: 'open' }),
    );
    expect(closedOpen.state).toBe('closed');
    expect(closedOpen.closedAt).not.toBeNull();
    expect(closedOpen.resolvedAt).toBeNull();
    expect(closedOpen.actions).toEqual([]);
    const row = await rowOf(open.id);
    expect(row.staff_last_read_seq).toBe(row.last_seq);

    const progress = await openCase('close-progress');
    await caseOf(await act(tokens.demoSupport, progress.id, 'take', { expectedState: 'open' }));
    const closedProgress = await caseOf(
      await act(tokens.demoSupport, progress.id, 'close', { expectedState: 'in_progress' }),
    );
    expect(closedProgress.state).toBe('closed');

    const resolved = await openCase('close-resolved');
    await caseOf(await act(tokens.demoSupport, resolved.id, 'resolve', { expectedState: 'open' }));
    const closed = await caseOf(
      await act(tokens.demoSupport, resolved.id, 'close', { expectedState: 'resolved' }),
    );
    expect(closed.state).toBe('closed');
    expect(closed.resolvedAt).toBeNull();
    // Only the resolve of the third case emitted anything.
    expect(emitted()).toEqual([before[0] + 1, before[1]]);
  });

  it('reopen: only a resolved case reopens, the owner is cleared, silent; open, in_progress and closed are transition_not_allowed (D-805)', async () => {
    const { tokens } = await caseKit();
    const { id } = await openCase('reopen');
    await caseOf(await act(tokens.demoSupport, id, 'take', { expectedState: 'open' }));
    await caseOf(await act(tokens.demoSupport, id, 'resolve', { expectedState: 'in_progress' }));
    const before = emitted();

    const reopened = await caseOf(
      await act(tokens.demoAdmin, id, 'reopen', { expectedState: 'resolved' }),
    );
    expect(reopened.state).toBe('open');
    expect(reopened.ownerUserId).toBeNull();
    expect(reopened.resolvedAt).toBeNull();
    expect(emitted()).toEqual(before);

    const fromOpen = await refusal(
      await act(tokens.demoAdmin, id, 'reopen', { expectedState: 'open' }),
    );
    expect([fromOpen.status, fromOpen.chat]).toEqual([409, 'transition_not_allowed']);

    await caseOf(await act(tokens.demoSupport, id, 'take', { expectedState: 'open' }));
    const fromProgress = await refusal(
      await act(tokens.demoAdmin, id, 'reopen', { expectedState: 'in_progress' }),
    );
    expect([fromProgress.status, fromProgress.chat]).toEqual([409, 'transition_not_allowed']);

    await caseOf(await act(tokens.demoSupport, id, 'close', { expectedState: 'in_progress' }));
    const fromClosed = await refusal(
      await act(tokens.demoAdmin, id, 'reopen', { expectedState: 'closed' }),
    );
    expect([fromClosed.status, fromClosed.chat]).toEqual([409, 'transition_not_allowed']);
    expect((await rowOf(id)).state).toBe('closed');
  });

  it('any staff, whoever owns it: resolve and close by a non-owner succeed (D-842)', async () => {
    const { tokens, ids } = await caseKit();
    const second = await throwawayMember('non-owner', 'support_tenant');

    const a = await openCase('nonowner-resolve');
    await caseOf(await act(tokens.demoSupport, a.id, 'take', { expectedState: 'open' }));
    const resolved = await caseOf(
      await act(second.token, a.id, 'resolve', { expectedState: 'in_progress' }),
    );
    expect(resolved.state).toBe('resolved');
    expect(resolved.ownerUserId).toBe(ids.demoSupport);

    const b = await openCase('nonowner-close');
    await caseOf(await act(tokens.demoSupport, b.id, 'take', { expectedState: 'open' }));
    const closed = await caseOf(
      await act(second.token, b.id, 'close', { expectedState: 'in_progress' }),
    );
    expect(closed.state).toBe('closed');
  });

  it('a member never runs a case action, and a body with a forged key is a plain validation error (T-12.4-36)', async () => {
    const { tokens } = await caseKit();
    const { id, member } = await openCase('member-forbidden');
    for (const action of ['take', 'resolve', 'close', 'reopen', 'assign']) {
      const refused = await refusal(await act(member.token, id, action, { expectedState: 'open' }));
      expect([refused.status, refused.code]).toEqual([403, 'FORBIDDEN']);
    }
    const forged = await refusal(
      await act(tokens.demoSupport, id, 'resolve', { expectedState: 'open', state: 'closed' }),
    );
    expect([forged.status, forged.code]).toEqual([400, 'VALIDATION_FAILED']);
    const badState = await refusal(
      await act(tokens.demoSupport, id, 'resolve', { expectedState: 'archived' }),
    );
    expect(badState.status).toBe(400);
    expect((await rowOf(id)).state).toBe('open');
  });
});

describe('case edit', () => {
  it('PATCH changes category, priority and subject with one edited event per field, then a null subject blanks it (CASE-10, D-812)', async () => {
    const { tokens } = await caseKit();
    const { id } = await openCase('edit', { category: 'payment', subject: 'Cobrança' });
    const before = emitted();

    const edited = await caseOf(
      await edit(tokens.demoSupport, id, {
        expectedState: 'open',
        category: 'events',
        priority: 'high',
        subject: '  Ingresso do evento  ',
      }),
    );
    expect(edited.category).toBe('events');
    expect(edited.priority).toBe('high');
    expect(edited.subject).toBe('Ingresso do evento');
    expect(edited.state).toBe('open');
    const fields = (await eventsOf(id)).filter((e) => e.kind === 'edited').map((e) => e.field);
    expect(fields.sort()).toEqual(['category', 'priority', 'subject']);

    const blanked = await caseOf(
      await edit(tokens.demoSupport, id, { expectedState: 'open', subject: null }),
    );
    expect(blanked.subject).toBeNull();
    expect((await rowOf(id)).subject).toBeNull();
    expect((await eventsOf(id)).filter((e) => e.kind === 'edited')).toHaveLength(4);
    expect(emitted()).toEqual(before);
  });

  it('mass assignment: state, owner keys and no field are 400 and write nothing; a member and a stale state are refused (T-12.4-36)', async () => {
    const { tokens, ids } = await caseKit();
    const { id, member } = await openCase('edit-mass');
    const row = await rowOf(id);
    const events = (await eventsOf(id)).length;

    for (const forged of [
      { state: 'closed' },
      { ownerUserId: ids.demoSupport },
      { owner: ids.demoSupport },
      { number: 1 },
      { caseNumber: 1 },
      { resolvedAt: '2026-01-01T00:00:00.000Z' },
    ]) {
      const refused = await refusal(
        await edit(tokens.demoAdmin, id, { expectedState: 'open', priority: 'high', ...forged }),
      );
      expect([refused.status, refused.code]).toEqual([400, 'VALIDATION_FAILED']);
    }
    const nothing = await refusal(await edit(tokens.demoAdmin, id, { expectedState: 'open' }));
    expect([nothing.status, nothing.code, nothing.chat]).toEqual([
      400,
      'VALIDATION_FAILED',
      'case_nothing_to_edit',
    ]);
    expect(await rowOf(id)).toEqual(row);
    expect((await eventsOf(id)).length).toBe(events);

    const asMember = await refusal(
      await edit(member.token, id, { expectedState: 'open', priority: 'high' }),
    );
    expect([asMember.status, asMember.code]).toEqual([403, 'FORBIDDEN']);
    const stale = await refusal(
      await edit(tokens.demoAdmin, id, { expectedState: 'in_progress', priority: 'high' }),
    );
    expect([stale.status, stale.chat]).toEqual([409, 'case_stale']);
    expect(await rowOf(id)).toEqual(row);
  });

  it('a closed case cannot be edited, and an 81-code-point subject is subject_too_long while 80 emoji pass (D-811)', async () => {
    const { tokens } = await caseKit();
    const long = await openCase('edit-long');
    const tooLong = await refusal(
      await edit(tokens.demoAdmin, long.id, { expectedState: 'open', subject: 'a'.repeat(81) }),
    );
    expect([tooLong.status, tooLong.code, tooLong.chat]).toEqual([
      400,
      'VALIDATION_FAILED',
      'subject_too_long',
    ]);
    const emoji = await caseOf(
      await edit(tokens.demoAdmin, long.id, { expectedState: 'open', subject: '😀'.repeat(80) }),
    );
    expect([...(emoji.subject ?? '')]).toHaveLength(80);

    await caseOf(await act(tokens.demoAdmin, long.id, 'close', { expectedState: 'open' }));
    const closed = await refusal(
      await edit(tokens.demoAdmin, long.id, { expectedState: 'closed', priority: 'low' }),
    );
    expect([closed.status, closed.chat]).toEqual([409, 'transition_not_allowed']);
  });
});

describe('case reply', () => {
  it('a staff reply to a closed case is 409 case_closed and writes nothing (CASE-07, UI-D-828)', async () => {
    const { tokens } = await caseKit();
    const { id } = await openCase('reply-closed');
    await caseOf(await act(tokens.demoAdmin, id, 'close', { expectedState: 'open' }));
    const messages = await countMessages(id);
    const events = (await eventsOf(id)).length;
    const refused = await refusal(await reply(tokens.demoSupport, id));
    expect([refused.status, refused.code, refused.chat]).toEqual([409, 'CONFLICT', 'case_closed']);
    expect(await countMessages(id)).toBe(messages);
    expect((await eventsOf(id)).length).toBe(events);
    expect((await rowOf(id)).state).toBe('closed');
  });

  it('a blocked or removed member wins over closed: member_blocked and member_removed (CASE-07)', async () => {
    const { tokens, ids } = await caseKit();
    const blocked = await openCase('reply-blocked');
    await caseOf(await act(tokens.demoAdmin, blocked.id, 'close', { expectedState: 'open' }));
    await adminSql`
      update public.memberships set blocked_at = now(), status = 'blocked'
       where tenant_id = ${ids.demo}::uuid and user_id = ${blocked.member.id}::uuid`;
    const b = await refusal(await reply(tokens.demoSupport, blocked.id));
    expect([b.status, b.chat]).toEqual([409, 'member_blocked']);

    const removed = await openCase('reply-removed');
    await caseOf(await act(tokens.demoAdmin, removed.id, 'close', { expectedState: 'open' }));
    await adminSql`
      update public.memberships set deleted_at = now()
       where tenant_id = ${ids.demo}::uuid and user_id = ${removed.member.id}::uuid`;
    const r = await refusal(await reply(tokens.demoSupport, removed.id));
    expect([r.status, r.chat]).toEqual([409, 'member_removed']);
  });

  it('a reply on an unowned open case takes it and the answer keeps its shape (plan 02)', async () => {
    const { tokens, ids } = await caseKit();
    const { id } = await openCase('reply-take');
    const res = await reply(tokens.demoSupport, id);
    expect(res.status).toBe(201);
    const body = (await res.json()) as SendResult;
    expect(Object.keys(body).sort()).toEqual(['conversationId', 'message']);
    const row = await rowOf(id);
    expect([row.state, row.owner]).toEqual(['in_progress', ids.demoSupport]);
  });
});

describe('case races', () => {
  it('two staff taking the same open case: exactly one 200 and one case_stale (EP-038, T-12.4-38)', async () => {
    const { tokens } = await caseKit();
    const { id } = await openCase('race-take');
    const results = await Promise.all([
      act(tokens.demoSupport, id, 'take', { expectedState: 'open' }),
      act(tokens.demoAdmin, id, 'take', { expectedState: 'open' }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const loser = results.find((res) => res.status === 409) as Response;
    expect((await refusal(loser)).chat).toBe('case_stale');
    expect((await eventsOf(id)).filter((e) => e.kind === 'taken')).toHaveLength(1);
  });

  it('a close racing a resolve gives one winner and one 409 (T-12.4-38)', async () => {
    const { tokens } = await caseKit();
    const { id } = await openCase('race-close');
    await caseOf(await act(tokens.demoSupport, id, 'take', { expectedState: 'open' }));
    const before = resolvedEvents.length;
    const results = await Promise.all([
      act(tokens.demoSupport, id, 'resolve', { expectedState: 'in_progress' }),
      act(tokens.demoAdmin, id, 'close', { expectedState: 'in_progress' }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const loser = results.find((res) => res.status === 409) as Response;
    expect((await refusal(loser)).chat).toBe('case_stale');
    const final = (await rowOf(id)).state;
    expect(['resolved', 'closed']).toContain(final);
    // The resolve event exists only when the resolve won.
    expect(resolvedEvents.length).toBe(before + (final === 'resolved' ? 1 : 0));
  });

  it('a member message racing a staff close never fails and never leaves two active cases (plan 02)', async () => {
    const { tokens } = await caseKit();
    const { id, member } = await openCase('race-member');
    const [closed, sent] = await Promise.all([
      act(tokens.demoAdmin, id, 'close', { expectedState: 'open' }),
      post('/v1/chat/support/messages', member.token, { body: 'Mais uma coisa' }),
    ]);
    // The member's message never changes the state, so the close wins; it can only be stale if a trigger moved the state.
    expect([200, 409]).toContain(closed.status);
    expect(sent.status).toBe(201);
    const landed = ((await sent.json()) as SendResult).conversationId;
    const active = await adminSql<{ id: string }[]>`
      select id::text as id from public.chat_conversations
       where created_by_user_id = ${member.id}::uuid and kind = 'support'
         and state in ('open', 'in_progress', 'resolved')`;
    expect(active.length).toBeLessThanOrEqual(1);
    if (closed.status === 200 && landed !== id) {
      // The message arrived after the close: it opened a new case.
      expect((await rowOf(id)).state).toBe('closed');
      expect(active.map((row) => row.id)).toEqual([landed]);
    }
  });

  it('a staff reply racing a close never deadlocks or fails with a server error (EP-038)', async () => {
    const { tokens } = await caseKit();
    const { id } = await openCase('race-reply');
    const [closed, replied] = await Promise.all([
      act(tokens.demoAdmin, id, 'close', { expectedState: 'open' }),
      reply(tokens.demoSupport, id),
    ]);
    expect([200, 409]).toContain(closed.status);
    expect([201, 409]).toContain(replied.status);
    // Either the reply landed first (it took the case, so the close was stale) or the close won and the reply was refused.
    if (closed.status === 200) expect(replied.status).toBe(409);
    else expect(replied.status).toBe(201);
  });
});
