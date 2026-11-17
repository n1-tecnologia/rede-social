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

/* ── Task 3: isolation and the edge items ────────────────────────────────────────────────────── */

const ACTION_ROUTES = ['take', 'resolve', 'close', 'reopen', 'assign'] as const;

type LabLanes = { admin: string; support: string; member: string };

/** rede-lab has `chat` OFF in the seed: it is turned on for the call and restored in `finally`. */
async function withLabChat<T>(fn: (lab: LabLanes) => Promise<T>): Promise<T> {
  const { ids } = await caseKit();
  const [flag] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${ids.lab}::uuid and module_key = 'chat'`;
  try {
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${ids.lab}::uuid, 'chat', true)
      on conflict (tenant_id, module_key) do update set enabled = true`;
    moduleFlags.invalidate(ids.lab);
    return await fn({
      admin: await signInAs('admin@rede-lab.local', SEED_PASSWORD),
      support: await signInAs('support@rede-lab.local', SEED_PASSWORD),
      member: await signInAs('member@rede-lab.local', SEED_PASSWORD),
    });
  } finally {
    if (flag) {
      await adminSql`
        update public.tenant_modules set enabled = ${flag.enabled}
         where tenant_id = ${ids.lab}::uuid and module_key = 'chat'`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${ids.lab}::uuid and module_key = 'chat'`;
    }
    moduleFlags.invalidate(ids.lab);
  }
}

const onLab = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { 'x-tenant-host': HOSTS.lab },
});

/** One of the case routes, on the lab host, with the body that fits it. */
function labRequest(route: string, token: string, id: string, assignee: string) {
  const path = `/v1/chat/conversations/${id}`;
  switch (route) {
    case 'PATCH':
      return request(
        `${path}/case`,
        token,
        onLab({
          method: 'PATCH',
          body: JSON.stringify({ expectedState: 'open', priority: 'high' }),
        }),
      );
    case 'history':
      return request(`${path}/case/history`, token, onLab());
    case 'assign':
      return request(
        `${path}/case/assign`,
        token,
        onLab({
          method: 'POST',
          body: JSON.stringify({ expectedState: 'open', assigneeUserId: assignee }),
        }),
      );
    default:
      return request(
        `${path}/case/${route}`,
        token,
        onLab({ method: 'POST', body: JSON.stringify({ expectedState: 'open' }) }),
      );
  }
}

describe('case isolation', () => {
  it("EP-074 boundary: tenant B's staff on tenant A's VALID case id gets the same bare 404 as a random uuid on every case route, and nothing is written or emitted (T-12.4-37)", async () => {
    const { tokens, ids } = await caseKit();
    const { id } = await openCase('ep074');
    const row = await rowOf(id);
    const events = await countEvents(ids.demo);
    const before = emitted();
    await withLabChat(async (lab) => {
      const routes = [...ACTION_ROUTES, 'PATCH', 'history'];
      for (const token of [lab.admin, lab.support]) {
        for (const route of routes) {
          // The support lane is refused at the route permission for assign (403): the oracle is asked of admin there.
          if (route === 'assign' && token === lab.support) continue;
          const foreign = await shape(await labRequest(route, token, id, ids.demoSupport));
          const unknown = await shape(
            await labRequest(route, token, crypto.randomUUID(), ids.demoSupport),
          );
          expect(foreign, route).toEqual(unknown);
          expect(foreign.status, route).toBe(404);
          expect(foreign.body, route).toEqual({
            error: { code: 'NOT_FOUND', message: expect.any(String) },
          });
        }
      }
    });
    // Nothing was written, nothing emitted, and tenant A's own staff still acts on the same id (positive control).
    expect(await rowOf(id)).toEqual(row);
    expect(await countEvents(ids.demo)).toBe(events);
    expect(emitted()).toEqual(before);
    const own = await caseOf(await act(tokens.demoSupport, id, 'take', { expectedState: 'open' }));
    expect(own.state).toBe('in_progress');
  });

  it('EP-075 adjacency: each tenant numbers its own cases, an action on one never touches the other, and no route takes a number (D-804)', async () => {
    const { tokens, ids } = await caseKit();
    await withLabChat(async (lab) => {
      const demoBase = await highestNumber(ids.demo);
      const labBase = await highestNumber(ids.lab);
      const numberOf = async (conversationId: string) => {
        const [row] = await adminSql<{ n: number }[]>`
          select case_number::int as n from public.chat_conversations
           where id = ${conversationId}::uuid`;
        return row?.n ?? 0;
      };
      const labCase = async () => {
        const res = await request(
          '/v1/chat/support/messages',
          lab.member,
          onLab({ method: 'POST', body: JSON.stringify({ body: 'Oi, laboratório.' }) }),
        );
        expect(res.status).toBe(201);
        return ((await res.json()) as SendResult).conversationId;
      };
      // Interleaved: demo, lab, demo, lab. Each tenant's numbers advance by exactly one per case of its own, whatever
      // the other tenant did in between, and each is above that tenant's own highest at the start (the counter is
      // never reset, so after a sweep it can sit above the highest remaining number: never a literal 1).
      const demoA = await openCase('ep075-a');
      const labA = await labCase();
      const demoB = await openCase('ep075-b');
      // The lab member has one active case at a time: the lab team closes the first before the member writes again.
      expect((await labRequest('close', lab.admin, labA, ids.demoSupport)).status).toBe(200);
      const labB = await labCase();
      const [nDemoA, nLabA, nDemoB, nLabB] = await Promise.all([
        numberOf(demoA.id),
        numberOf(labA),
        numberOf(demoB.id),
        numberOf(labB),
      ]);
      expect(nDemoA).toBeGreaterThan(demoBase);
      expect(nLabA).toBeGreaterThan(labBase);
      expect(nDemoB).toBe(nDemoA + 1);
      expect(nLabB).toBe(nLabA + 1);
      const demo = demoB;
      const labId = labB;
      const demoRow = { n: nDemoB };

      // An action on tenant A's case never changes tenant B's row.
      const labBefore = await rowOf(labId);
      await caseOf(await act(tokens.demoAdmin, demo.id, 'resolve', { expectedState: 'open' }));
      expect(await rowOf(labId)).toEqual(labBefore);

      // No route accepts a number: it is an unknown key.
      const withNumber = await refusal(
        await act(tokens.demoAdmin, demo.id, 'reopen', {
          expectedState: 'resolved',
          number: demoRow?.n,
        }),
      );
      expect([withNumber.status, withNumber.code]).toEqual([400, 'VALIDATION_FAILED']);
    });
  });

  it('EP-076 empty: in a tenant with no case every action on a random uuid is the bare 404, an empty PATCH is the validation error before any lookup, and the roster answers', async () => {
    const { ids } = await caseKit();
    await adminSql`delete from public.chat_conversations where tenant_id = ${ids.lab}::uuid`;
    await withLabChat(async (lab) => {
      const none = crypto.randomUUID();
      for (const route of [...ACTION_ROUTES, 'PATCH', 'history']) {
        const out = await shape(await labRequest(route, lab.admin, none, ids.demoSupport));
        expect(out.status, route).toBe(404);
        expect(out.body, route).toEqual({
          error: { code: 'NOT_FOUND', message: expect.any(String) },
        });
      }
      const empty = await refusal(
        await request(
          `/v1/chat/conversations/${none}/case`,
          lab.admin,
          onLab({ method: 'PATCH', body: JSON.stringify({ expectedState: 'open' }) }),
        ),
      );
      expect([empty.status, empty.chat]).toEqual([400, 'case_nothing_to_edit']);
      const roster = await request('/v1/chat/staff', lab.admin, onLab());
      expect(roster.status).toBe(200);
    });
  });

  it('EP-077 ordering: a refused cross-tenant or stale action writes no event row and publishes no signal (T-12.4-40)', async () => {
    const { tokens, ids } = await caseKit();
    const { id } = await openCase('ep077');
    await caseOf(await act(tokens.demoSupport, id, 'take', { expectedState: 'open' }));
    const events = await countEvents(ids.demo);
    const signals = await countSignals();
    const before = emitted();

    await withLabChat(async (lab) => {
      for (const route of ['resolve', 'close', 'take', 'PATCH']) {
        expect((await labRequest(route, lab.admin, id, ids.demoSupport)).status).toBe(404);
      }
    });
    // Stale: the case is in_progress, the caller expects open.
    for (const route of ['resolve', 'close', 'take']) {
      expect((await act(tokens.demoAdmin, id, route, { expectedState: 'open' })).status).toBe(409);
    }
    expect(
      (await edit(tokens.demoAdmin, id, { expectedState: 'open', priority: 'high' })).status,
    ).toBe(409);
    // A refused transition (reopen of an in-progress case) and a refused assignee leave no trace either.
    expect(
      (await act(tokens.demoAdmin, id, 'reopen', { expectedState: 'in_progress' })).status,
    ).toBe(409);
    expect(
      (
        await act(tokens.demoAdmin, id, 'assign', {
          expectedState: 'in_progress',
          assigneeUserId: ids.demoMember,
        })
      ).status,
    ).toBe(400);

    expect(await countEvents(ids.demo)).toBe(events);
    expect(await countSignals()).toBe(signals);
    expect(emitted()).toEqual(before);
  });

  it('EP-078 precision: every code of the closed mapping is produced through the API, one to one (CASE-24)', async () => {
    const { tokens, ids } = await caseKit();
    const { id, member } = await openCase('ep078');

    // CS001: an unknown id is the bare 404, never a 403.
    const cs001 = await refusal(
      await act(tokens.demoAdmin, crypto.randomUUID(), 'resolve', { expectedState: 'open' }),
    );
    expect([cs001.status, cs001.code, cs001.details]).toEqual([404, 'NOT_FOUND', undefined]);

    // CS002 and CS003 are distinguishable by details.chat.
    await caseOf(await act(tokens.demoSupport, id, 'take', { expectedState: 'open' }));
    const cs002 = await refusal(
      await act(tokens.demoAdmin, id, 'resolve', { expectedState: 'open' }),
    );
    const cs003 = await refusal(
      await act(tokens.demoAdmin, id, 'reopen', { expectedState: 'in_progress' }),
    );
    expect([cs002.status, cs002.chat]).toEqual([409, 'case_stale']);
    expect([cs003.status, cs003.chat]).toEqual([409, 'transition_not_allowed']);
    expect(cs002.chat).not.toBe(cs003.chat);

    // CS005: a member is no assignee.
    const cs005 = await refusal(
      await act(tokens.demoAdmin, id, 'assign', {
        expectedState: 'in_progress',
        assigneeUserId: ids.demoMember,
      }),
    );
    expect([cs005.status, cs005.chat]).toEqual([400, 'assignee_invalid']);

    // 42501 is never a 404: a member on a case route is a 403 FORBIDDEN, and a staff member demoted after sign-in is
    // refused the same way (the permission is composed from the live membership, with the definer behind it).
    const memberRefused = await refusal(
      await act(member.token, id, 'resolve', { expectedState: 'in_progress' }),
    );
    expect([memberRefused.status, memberRefused.code]).toEqual([403, 'FORBIDDEN']);
    const demoted = await throwawayMember('ep078-demoted', 'support_tenant');
    await adminSql`
      update public.memberships set "role" = 'member'
       where tenant_id = ${ids.demo}::uuid and user_id = ${demoted.id}::uuid`;
    const demotedRefused = await refusal(
      await act(demoted.token, id, 'resolve', { expectedState: 'in_progress' }),
    );
    expect([demotedRefused.status, demotedRefused.code]).toEqual([403, 'FORBIDDEN']);

    // CS004: a staff reply to a closed case.
    await caseOf(await act(tokens.demoAdmin, id, 'close', { expectedState: 'in_progress' }));
    const cs004 = await refusal(await reply(tokens.demoSupport, id));
    expect([cs004.status, cs004.chat]).toEqual([409, 'case_closed']);
  });
});
