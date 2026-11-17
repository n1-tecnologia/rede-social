import {
  type CaseHistory,
  type ConversationDetail,
  caseHistorySchema,
  type InboxPage,
  type InboxRow,
  type SendResult,
  type StaffRoster,
  staffCaseSchema,
  staffRosterSchema,
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
import { adminSql } from './setup';

/**
 * The team's side of the support-case read API, end to end against the live local stack (Phase 12.4, plan 07):
 * the inbox with its tabs and filters, the case facts and the list of legal actions, the history with the member's
 * earlier cases and the staff roster (CASE-12, CASE-16, CASE-23; D-805, D-806, D-809, D-842, D-843).
 *
 * The tenant counter is never touched: every number assertion is RELATIVE to `highestNumber`. Test ORDER is
 * load-bearing (`fileParallelism: false`, declaration order).
 */

beforeAll(async () => {
  await caseKit();
  await sweepCases();
});

afterAll(async () => {
  await sweepCases();
  await removeThrowaways();
});

/** The shipped keys of an inbox row, plus the optional `case`. */
const INBOX_ROW_KEYS = [
  'awaiting',
  'case',
  'conversationId',
  'lastMessage',
  'lastMessageAt',
  'member',
];

async function inbox(token: string, query = ''): Promise<InboxPage> {
  const res = await request(`/v1/chat/inbox${query}`, token);
  expect(res.status).toBe(200);
  return (await res.json()) as InboxPage;
}

async function send(token: string, body: Record<string, unknown>): Promise<SendResult> {
  const res = await post('/v1/chat/support/messages', token, body);
  expect(res.status).toBe(201);
  return (await res.json()) as SendResult;
}

const closeAsAdmin = (conversationId: string) => adminSql`
  update public.chat_conversations
     set state = 'closed', closed_at = now(), resolved_at = null, staff_last_read_seq = last_seq
   where id = ${conversationId}::uuid`;

describe('case staff inbox', () => {
  it('tracer: staff reads the default inbox with the case facts, and a closed case leaves the default tab (D-805, CASE-16)', async () => {
    const { tokens, ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const member = await throwawayMember('staff-inbox');
    const sent = await send(member.token, {
      body: 'Fui cobrado duas vezes no cartão',
      category: 'payment',
      subject: 'Cobrança duplicada',
    });

    const page = await inbox(tokens.demoSupport, '?limit=50');
    const row = page.items.find((item) => item.conversationId === sent.conversationId);
    expect(row).toBeDefined();
    // The shipped keys stay; the case is the one optional key added to the row.
    expect(Object.keys(row as InboxRow).sort()).toEqual(INBOX_ROW_KEYS);
    expect(row?.case).toEqual({
      number: base + 1,
      state: 'open',
      subjectLabel: 'Cobrança duplicada',
      category: 'payment',
      priority: 'normal',
      ownerName: null,
      ownerIsViewer: false,
    });
    expect(row?.awaiting).toBe(true);

    // The admin lane closes it: the default tab (open and in progress) no longer lists it, `tab=closed` does.
    await closeAsAdmin(sent.conversationId);
    const afterOpen = await inbox(tokens.demoSupport, '?limit=50');
    expect(afterOpen.items.some((item) => item.conversationId === sent.conversationId)).toBe(false);
    const closed = await inbox(tokens.demoSupport, '?tab=closed&limit=50');
    const closedRow = closed.items.find((item) => item.conversationId === sent.conversationId);
    expect(closedRow?.case?.state).toBe('closed');
    expect(closedRow?.awaiting).toBe(false);
    const resolved = await inbox(tokens.demoSupport, '?tab=resolved&limit=50');
    expect(resolved.items.some((item) => item.conversationId === sent.conversationId)).toBe(false);
  });
});

/** Every inbox row, walked with the returned cursors at `limit`. */
async function walk(token: string, query: string, limit = 50): Promise<InboxRow[]> {
  const rows: InboxRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 200; page += 1) {
    const qs = new URLSearchParams(query);
    qs.set('limit', String(limit));
    if (cursor) qs.set('cursor', cursor);
    const result = await inbox(token, `?${qs.toString()}`);
    rows.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) return rows;
  }
  throw new Error('inbox walk did not end');
}

const idsOf = (rows: readonly InboxRow[], mine: ReadonlySet<string>) =>
  rows.map((row) => row.conversationId).filter((id) => mine.has(id));

async function nameOf(userId: string): Promise<string> {
  const { ids } = await caseKit();
  const [row] = await adminSql<{ name: string }[]>`
    select mp.display_name as name
      from public.memberships ms
      join public.member_profiles mp on mp.membership_id = ms.id
     where ms.tenant_id = ${ids.demo}::uuid and ms.user_id = ${userId}::uuid`;
  return row?.name ?? '';
}

/** The admin lane moves a case the way the definer will (plan 08): the coherence CHECK still applies. */
const setCase = (
  conversationId: string,
  patch: { state: 'in_progress' | 'resolved'; owner?: string | null; priority?: string },
) =>
  patch.state === 'in_progress'
    ? adminSql`
        update public.chat_conversations
           set state = 'in_progress', owner_user_id = ${patch.owner ?? null}::uuid,
               priority = coalesce(${patch.priority ?? null}::text, priority)
         where id = ${conversationId}::uuid`
    : adminSql`
        update public.chat_conversations
           set state = 'resolved', resolved_at = now(), staff_last_read_seq = last_seq,
               owner_user_id = ${patch.owner ?? null}::uuid,
               priority = coalesce(${patch.priority ?? null}::text, priority)
         where id = ${conversationId}::uuid`;

const get = async <T>(path: string, token: string): Promise<{ status: number; body: T }> => {
  const res = await request(path, token);
  return { status: res.status, body: (await res.json()) as T };
};

describe('case staff filters', () => {
  it('owner me, none and a uuid, and priority narrow the page without changing its order (D-805, CASE-16)', async () => {
    const { tokens, ids } = await caseKit();
    const a = await throwawayMember('flt-a');
    const b = await throwawayMember('flt-b');
    const c = await throwawayMember('flt-c');
    const sa = await send(a.token, { body: 'Sem dono' });
    const sb = await send(b.token, { body: 'Do suporte' });
    const sc = await send(c.token, { body: 'Do admin' });
    await setCase(sb.conversationId, { state: 'in_progress', owner: ids.demoSupport });
    await setCase(sc.conversationId, {
      state: 'in_progress',
      owner: ids.demoAdmin,
      priority: 'high',
    });
    const mine = new Set([sa.conversationId, sb.conversationId, sc.conversationId]);
    const all = await walk(tokens.demoSupport, '');
    const allMine = idsOf(all, mine);
    expect(new Set(allMine)).toEqual(mine);

    // owner=me: each lane sees only its own cases, and `ownerIsViewer` follows the lane.
    const supportMine = await walk(tokens.demoSupport, 'owner=me');
    expect(idsOf(supportMine, mine)).toEqual([sb.conversationId]);
    expect(supportMine.every((row) => row.case?.ownerIsViewer === true)).toBe(true);
    expect(supportMine[0]?.case?.ownerName).toBe(await nameOf(ids.demoSupport));
    const adminMine = await walk(tokens.demoAdmin, 'owner=me');
    expect(idsOf(adminMine, mine)).toEqual([sc.conversationId]);
    // The same case read by the OTHER lane names the owner and is not the viewer's.
    const seenByAdmin = (await walk(tokens.demoAdmin, '')).find(
      (row) => row.conversationId === sb.conversationId,
    );
    expect(seenByAdmin?.case?.ownerIsViewer).toBe(false);
    expect(seenByAdmin?.case?.ownerName).toBe(await nameOf(ids.demoSupport));

    // owner=none, owner=<uuid>.
    expect(idsOf(await walk(tokens.demoSupport, 'owner=none'), mine)).toEqual([sa.conversationId]);
    expect(idsOf(await walk(tokens.demoAdmin, `owner=${ids.demoSupport}`), mine)).toEqual([
      sb.conversationId,
    ]);

    // priority.
    expect(idsOf(await walk(tokens.demoSupport, 'priority=high'), mine)).toEqual([
      sc.conversationId,
    ]);
    expect(idsOf(await walk(tokens.demoSupport, 'priority=low'), mine)).toEqual([]);
    expect(idsOf(await walk(tokens.demoSupport, 'priority=normal'), mine)).toEqual([
      ...allMine.filter((id) => id !== sc.conversationId),
    ]);

    // The filters never change the order: a filtered page is the unfiltered order restricted to its rows.
    const order = (rows: readonly InboxRow[]) => rows.map((row) => row.conversationId);
    const pick = new Set(order(supportMine));
    expect(order(supportMine)).toEqual(order(all).filter((id) => pick.has(id)));
  });

  it('awaiting equals the staff badge with no other filter, is a subset under an owner filter and is ignored off the open tab (D-809, UI-D-823)', async () => {
    const { tokens, ids } = await caseKit();
    const a = await throwawayMember('awt-a');
    const b = await throwawayMember('awt-b');
    const sa = await send(a.token, { body: 'Aguardando' });
    const sb = await send(b.token, { body: 'Já lido' });
    // The team reads B up to its last message: B is no longer awaiting.
    const read = await request(
      `/v1/chat/conversations/${sb.conversationId}/read`,
      tokens.demoSupport,
      {
        method: 'POST',
        body: JSON.stringify({ seq: sb.message.seq }),
      },
    );
    expect(read.status).toBe(204);
    await setCase(sa.conversationId, { state: 'in_progress', owner: ids.demoAdmin });

    const awaiting = await walk(tokens.demoSupport, 'awaiting=1');
    const counters = await get<{ unreadConversations: number }>(
      '/v1/me/counters',
      tokens.demoSupport,
    );
    expect(counters.status).toBe(200);
    expect(awaiting.length).toBe(counters.body.unreadConversations);
    expect(awaiting.every((row) => row.awaiting)).toBe(true);
    expect(awaiting.map((row) => row.conversationId)).toContain(sa.conversationId);
    expect(awaiting.map((row) => row.conversationId)).not.toContain(sb.conversationId);
    // `true` and `1` spell the same toggle; anything else degrades to off.
    expect((await walk(tokens.demoSupport, 'awaiting=true')).length).toBe(awaiting.length);
    expect((await walk(tokens.demoSupport, 'awaiting=yes')).length).toBeGreaterThan(
      awaiting.length,
    );

    // Under an owner filter it is a strict subset (the support lane owns nothing awaiting).
    const withOwner = await walk(tokens.demoSupport, 'awaiting=1&owner=me');
    expect(withOwner.length).toBeLessThan(awaiting.length);
    const adminOwned = await walk(tokens.demoSupport, `awaiting=1&owner=${ids.demoAdmin}`);
    expect(adminOwned.map((row) => row.conversationId)).toContain(sa.conversationId);

    // Off the open tab the toggle is ignored: a resolved case that is NOT awaiting is still listed.
    await setCase(sb.conversationId, { state: 'resolved' });
    const resolvedPlain = await walk(tokens.demoSupport, 'tab=resolved');
    const resolvedAwaiting = await walk(tokens.demoSupport, 'tab=resolved&awaiting=1');
    expect(resolvedPlain.map((row) => row.conversationId)).toContain(sb.conversationId);
    expect(resolvedAwaiting.map((row) => row.conversationId)).toEqual(
      resolvedPlain.map((row) => row.conversationId),
    );
    // A closed case never counts, and the open tab no longer lists it.
    await closeAsAdmin(sb.conversationId);
    const closedAwaiting = await walk(tokens.demoSupport, 'tab=closed&awaiting=1');
    expect(closedAwaiting.map((row) => row.conversationId)).toContain(sb.conversationId);
    expect(closedAwaiting.every((row) => row.awaiting === false)).toBe(true);
    expect(
      (await walk(tokens.demoSupport, 'awaiting=1')).map((row) => row.conversationId),
    ).not.toContain(sb.conversationId);
  });
});

describe('case staff detail', () => {
  const detailOf = async (token: string, id: string) => {
    const res = await get<ConversationDetail & { case?: unknown }>(
      `/v1/chat/conversations/${id}`,
      token,
    );
    expect(res.status).toBe(200);
    return res.body;
  };
  const actionsOf = async (token: string, id: string) => {
    const detail = await detailOf(token, id);
    expect(detail.viewer).toBe('staff');
    const parsed = staffCaseSchema.parse((detail as { case?: unknown }).case);
    return parsed.actions;
  };

  it('actions[] follow the state, the owner and the viewer permissions, never a role literal (D-842, D-806)', async () => {
    const { tokens, ids } = await caseKit();
    const member = await throwawayMember('detail-actions');
    const sent = await send(member.token, { body: 'Preciso de ajuda', subject: 'Acesso' });
    const id = sent.conversationId;

    // open: support never assigns; admin does.
    expect(await actionsOf(tokens.demoSupport, id)).toEqual(['take', 'resolve', 'close', 'edit']);
    expect(await actionsOf(tokens.demoAdmin, id)).toEqual([
      'take',
      'assign',
      'resolve',
      'close',
      'edit',
    ]);

    // in progress, owned by the support lane: the owner does not take its own case again.
    await setCase(id, { state: 'in_progress', owner: ids.demoSupport });
    expect(await actionsOf(tokens.demoSupport, id)).toEqual(['resolve', 'close', 'edit']);
    expect(await actionsOf(tokens.demoAdmin, id)).toEqual([
      'take',
      'assign',
      'resolve',
      'close',
      'edit',
    ]);
    const owned = staffCaseSchema.parse(
      ((await detailOf(tokens.demoAdmin, id)) as { case?: unknown }).case,
    );
    expect(owned).toMatchObject({
      state: 'in_progress',
      ownerUserId: ids.demoSupport,
      ownerName: await nameOf(ids.demoSupport),
      ownerIsViewer: false,
      subjectLabel: 'Acesso',
      priority: 'normal',
      resolvedAt: null,
      closedAt: null,
    });

    // in progress, owned by the admin: the support lane may take it over.
    await setCase(id, { state: 'in_progress', owner: ids.demoAdmin });
    expect(await actionsOf(tokens.demoSupport, id)).toEqual(['take', 'resolve', 'close', 'edit']);
    expect(await actionsOf(tokens.demoAdmin, id)).toEqual(['assign', 'resolve', 'close', 'edit']);

    // resolved: reopen is offered, assign and resolve are not.
    await setCase(id, { state: 'resolved', owner: ids.demoAdmin });
    expect(await actionsOf(tokens.demoSupport, id)).toEqual(['close', 'reopen', 'edit']);
    expect(await actionsOf(tokens.demoAdmin, id)).toEqual(['close', 'reopen', 'edit']);

    // closed: none of the mutating actions, for either lane.
    await closeAsAdmin(id);
    expect(await actionsOf(tokens.demoSupport, id)).toEqual([]);
    expect(await actionsOf(tokens.demoAdmin, id)).toEqual([]);
    const closed = staffCaseSchema.parse(
      ((await detailOf(tokens.demoAdmin, id)) as { case?: unknown }).case,
    );
    expect(closed.state).toBe('closed');
    expect(closed.closedAt).not.toBeNull();
    expect(closed.resolvedAt).toBeNull();

    // The member never receives the staff shape.
    const own = await detailOf(member.token, id);
    expect(own.viewer).toBe('member');
    expect(JSON.stringify(own)).not.toContain('actions');
    expect(JSON.stringify(own)).not.toContain('priority');
  });

  it('an owner who left the staff keeps the stored id and reads no name (D-843, T-12.4-34)', async () => {
    const { tokens } = await caseKit();
    const member = await throwawayMember('detail-gone');
    const gone = await throwawayMember('detail-owner', 'support_tenant');
    const sent = await send(member.token, { body: 'Quem me atende?' });
    await setCase(sent.conversationId, { state: 'in_progress', owner: gone.id });

    // While live the owner has a name.
    const live = staffCaseSchema.parse(
      ((await detailOf(tokens.demoAdmin, sent.conversationId)) as { case?: unknown }).case,
    );
    expect(live.ownerName).toBe(await nameOf(gone.id));

    for (const leave of [
      () =>
        adminSql`update public.memberships set "role" = 'member' where user_id = ${gone.id}::uuid`,
      () =>
        adminSql`update public.memberships set "role" = 'support_tenant', blocked_at = now(), status = 'blocked' where user_id = ${gone.id}::uuid`,
      () =>
        adminSql`update public.memberships set "role" = 'support_tenant', blocked_at = null, status = 'active', deleted_at = now() where user_id = ${gone.id}::uuid`,
    ]) {
      await leave();
      const detail = staffCaseSchema.parse(
        ((await detailOf(tokens.demoAdmin, sent.conversationId)) as { case?: unknown }).case,
      );
      expect(detail.ownerUserId).toBe(gone.id);
      expect(detail.ownerName).toBeNull();
      expect(detail.ownerIsViewer).toBe(false);
      // A take-over stays offered, so a colleague can pick the case up (no sweep releases it).
      expect(detail.actions).toContain('take');
      const row = (await walk(tokens.demoAdmin, '')).find(
        (r) => r.conversationId === sent.conversationId,
      );
      expect(row?.case?.ownerName).toBeNull();
      expect(row?.case?.state).toBe('in_progress');
    }
    // The owner left: no row of the roster carries the id.
    const roster = await get<StaffRoster>('/v1/chat/staff', tokens.demoAdmin);
    expect(roster.body.items.map((item) => item.userId)).not.toContain(gone.id);
  });
});

describe('case staff history', () => {
  /** A member with `earlier` closed cases and then a current open one. Returns every id, oldest first. */
  async function memberWithCases(label: string, earlier: number) {
    const member = await throwawayMember(label);
    const closedIds: string[] = [];
    for (let n = 0; n < earlier; n += 1) {
      const sent = await send(member.token, { body: `Assunto ${n + 1}`, subject: `Caso ${n + 1}` });
      await closeAsAdmin(sent.conversationId);
      closedIds.push(sent.conversationId);
    }
    const current = await send(member.token, { body: 'Assunto atual', subject: 'Atual' });
    return { member, closedIds, current: current.conversationId };
  }

  it('answers the events oldest first with names, and no name for an actor who left the tenant (D-810, CASE-12)', async () => {
    const { tokens, ids } = await caseKit();
    const { member, current } = await memberWithCases('hist-events', 0);
    const gone = await throwawayMember('hist-gone', 'support_tenant');
    const [openedAt] = await adminSql<{ at: Date }[]>`
      select created_at as at from public.chat_case_events where conversation_id = ${current}::uuid`;
    const t0 = (openedAt?.at ?? new Date()).getTime();
    const at = (ms: number) => new Date(t0 + ms);
    await adminSql`
      insert into public.chat_case_events
        (tenant_id, conversation_id, kind, actor_user_id, target_user_id, from_state, to_state, created_at)
      values
        (${ids.demo}::uuid, ${current}::uuid, 'taken', ${ids.demoSupport}::uuid, null, 'open', 'in_progress', ${at(1000)}),
        (${ids.demo}::uuid, ${current}::uuid, 'assigned', ${ids.demoAdmin}::uuid, ${ids.demoSupport}::uuid, 'in_progress', 'in_progress', ${at(2000)}),
        (${ids.demo}::uuid, ${current}::uuid, 'resolved', ${gone.id}::uuid, null, 'in_progress', 'resolved', ${at(3000)})`;
    await adminSql`
      insert into public.chat_case_events
        (tenant_id, conversation_id, kind, actor_user_id, field, from_value, to_value, created_at)
      values (${ids.demo}::uuid, ${current}::uuid, 'edited', ${ids.demoAdmin}::uuid, 'category', 'other', 'payment', ${at(4000)})`;
    await adminSql`
      update public.memberships set deleted_at = now() where user_id = ${gone.id}::uuid`;

    const res = await get<CaseHistory>(
      `/v1/chat/conversations/${current}/case/history`,
      tokens.demoSupport,
    );
    expect(res.status).toBe(200);
    const history = caseHistorySchema.parse(res.body);
    expect(history.events.map((event) => event.kind)).toEqual([
      'opened',
      'taken',
      'assigned',
      'resolved',
      'edited',
    ]);
    const [opened, taken, assigned, resolved, edited] = history.events;
    expect(opened).toMatchObject({ kind: 'opened', toState: 'open' });
    expect(opened?.actorName).toBe(`Pessoa hist-events`);
    expect(opened).not.toHaveProperty('from');
    expect(taken).toMatchObject({
      actorName: await nameOf(ids.demoSupport),
      fromState: 'open',
      toState: 'in_progress',
    });
    expect(assigned).toMatchObject({
      actorName: await nameOf(ids.demoAdmin),
      targetName: await nameOf(ids.demoSupport),
    });
    // The actor left the tenant: the key is absent, never an id.
    expect(resolved?.kind).toBe('resolved');
    expect(resolved).not.toHaveProperty('actorName');
    expect(JSON.stringify(history)).not.toContain(gone.id);
    expect(edited).toMatchObject({ field: 'category', from: 'other', to: 'payment' });
    // Staff only; a no-earlier-case history is empty, not absent.
    expect(history.earlierCases).toEqual([]);
    expect(history.hasMoreEarlier).toBe(false);
    // The member never reaches the route.
    const refused = await get<{ error: { code: string } }>(
      `/v1/chat/conversations/${current}/case/history`,
      member.token,
    );
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
  });

  it('lists at most five earlier cases of the same member, newest first, and probes a sixth (D-810)', async () => {
    const { tokens } = await caseKit();
    const seven = await memberWithCases('hist-seven', 7);
    const res = await get<CaseHistory>(
      `/v1/chat/conversations/${seven.current}/case/history`,
      tokens.demoSupport,
    );
    const history = caseHistorySchema.parse(res.body);
    expect(history.earlierCases).toHaveLength(5);
    expect(history.hasMoreEarlier).toBe(true);
    // Newest first: the five most recent closed cases, never the current one.
    expect(history.earlierCases.map((c) => c.id)).toEqual(seven.closedIds.slice(2).reverse());
    expect(history.earlierCases.map((c) => c.id)).not.toContain(seven.current);
    const numbers = history.earlierCases.map((c) => c.number);
    expect(numbers).toEqual([...numbers].sort((x, y) => y - x));
    expect(history.earlierCases[0]).toMatchObject({ state: 'closed', subjectLabel: 'Caso 7' });

    // Exactly five earlier cases: all five, and no sixth.
    const five = await memberWithCases('hist-five', 5);
    const exact = caseHistorySchema.parse(
      (
        await get<CaseHistory>(
          `/v1/chat/conversations/${five.current}/case/history`,
          tokens.demoSupport,
        )
      ).body,
    );
    expect(exact.earlierCases).toHaveLength(5);
    expect(exact.hasMoreEarlier).toBe(false);

    // A closed earlier case reads its own history; the first case of a member has no earlier ones.
    const own = caseHistorySchema.parse(
      (
        await get<CaseHistory>(
          `/v1/chat/conversations/${seven.closedIds[0]}/case/history`,
          tokens.demoSupport,
        )
      ).body,
    );
    expect(own.earlierCases).toEqual([]);
    expect(own.events.map((e) => e.kind)).toContain('opened');
  });

  it('answers a bare 404 for an unknown id or a conversation that is not a support case', async () => {
    const { tokens } = await caseKit();
    const unknown = await get<{ error: { code: string; details?: unknown } }>(
      '/v1/chat/conversations/0b140000-0000-4000-8000-0000000000ff/case/history',
      tokens.demoSupport,
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
    expect(unknown.body.error).not.toHaveProperty('details');
    const malformed = await get<unknown>(
      '/v1/chat/conversations/nope/case/history',
      tokens.demoSupport,
    );
    expect(malformed.status).toBe(400);
  });
});

describe('case staff roster', () => {
  it('lists the live staff of the tenant, names only, sorted by name then id (D-806)', async () => {
    const { tokens, ids } = await caseKit();
    const live = await throwawayMember('roster-live', 'support_tenant');
    const blocked = await throwawayMember('roster-blocked', 'support_tenant');
    const removed = await throwawayMember('roster-removed', 'support_tenant');
    const plain = await throwawayMember('roster-member');
    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now() where user_id = ${blocked.id}::uuid`;
    await adminSql`
      update public.memberships set deleted_at = now() where user_id = ${removed.id}::uuid`;

    for (const token of [tokens.demoSupport, tokens.demoAdmin]) {
      const res = await get<StaffRoster>('/v1/chat/staff', token);
      expect(res.status).toBe(200);
      const roster = staffRosterSchema.parse(res.body);
      const userIds = roster.items.map((item) => item.userId);
      expect(userIds).toEqual(expect.arrayContaining([ids.demoAdmin, ids.demoSupport, live.id]));
      for (const out of [blocked.id, removed.id, plain.id, ids.demoMember]) {
        expect(userIds).not.toContain(out);
      }
      // Names only: nothing but the id and the display name leaves.
      for (const item of roster.items) expect(Object.keys(item).sort()).toEqual(['name', 'userId']);
      expect(roster.items.find((item) => item.userId === live.id)?.name).toBe('Pessoa roster-live');
      // Exactly the live staff of the tenant, in the database's name-then-id order.
      const expected = await adminSql<{ id: string }[]>`
        select ms.user_id::text as id
          from public.memberships ms
          left join public.member_profiles mp on mp.membership_id = ms.id
         where ms.tenant_id = ${ids.demo}::uuid and ms.role in ('admin_tenant', 'support_tenant')
           and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
         order by coalesce(mp.display_name, '') asc, ms.user_id asc`;
      expect(userIds).toEqual(expected.map((row) => row.id));
    }
  });

  it('a member reads neither the roster nor a history (T-12.4-31) and an empty roster is a valid shape', async () => {
    const { tokens } = await caseKit();
    const res = await get<{ error: { code: string } }>('/v1/chat/staff', tokens.demoMember);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(staffRosterSchema.parse({ items: [] })).toEqual({ items: [] });
    expect(() => staffRosterSchema.parse({ items: [{ userId: 'x', name: 'y' }] })).toThrow();
  });
});

describe('case staff edges', () => {
  const order = (rows: readonly InboxRow[]) => rows.map((row) => row.conversationId);

  it('EP-050 adjacency: two cases at the same instant are ordered by id descending and a limit=1 walk visits both once in every tab', async () => {
    const { tokens } = await caseKit();
    const a = await throwawayMember('ep050-a');
    const b = await throwawayMember('ep050-b');
    const sa = await send(a.token, { body: 'Empate A' });
    const sb = await send(b.token, { body: 'Empate B' });
    const pair = [sa.conversationId, sb.conversationId];
    const expected = [...pair].sort().reverse();
    const tie = new Date('2026-11-01T12:00:00.123456Z');
    const tieAll = () => adminSql`
      update public.chat_conversations set last_message_at = ${tie}
       where id in (${sa.conversationId}::uuid, ${sb.conversationId}::uuid)`;
    const mine = new Set(pair);
    const check = async (tab: string) => {
      await tieAll();
      const stepped = await walk(tokens.demoSupport, `tab=${tab}`, 1);
      const seen = order(stepped);
      expect(new Set(seen).size, `${tab}: no row repeats`).toBe(seen.length);
      expect(
        seen.filter((id) => mine.has(id)),
        `${tab}: both visited, id descending`,
      ).toEqual(expected);
      // The same order as one big page.
      const whole = await walk(tokens.demoSupport, `tab=${tab}`, 50);
      expect(order(whole)).toEqual(seen);
    };
    await check('open');
    for (const id of pair) await setCase(id, { state: 'resolved' });
    await check('resolved');
    for (const id of pair) await closeAsAdmin(id);
    await check('closed');
  });

  it('EP-051 empty: a tab with no case, an owner with no case and an unknown owner answer an empty page; a malformed owner degrades to all owners', async () => {
    const { tokens, ids } = await caseKit();
    await sweepCases();
    const member = await throwawayMember('ep051');
    const sent = await send(member.token, { body: 'Só um caso' });
    const empty = { items: [], nextCursor: null };
    for (const tab of ['resolved', 'closed']) {
      expect(await inbox(tokens.demoSupport, `?tab=${tab}`)).toEqual(empty);
    }
    // An owner who owns nothing, and a well-formed uuid that names nobody.
    expect(await inbox(tokens.demoSupport, `?owner=${ids.demoAdmin}`)).toEqual(empty);
    expect(await inbox(tokens.demoSupport, `?owner=${crypto.randomUUID()}`)).toEqual(empty);
    // The admin owns nothing (the seeded thread was taken by the support lane when staff first answered it).
    expect(await inbox(tokens.demoAdmin, '?owner=me')).toEqual(empty);
    // A malformed owner is the same as no owner at all.
    const everyone = await inbox(tokens.demoSupport, '');
    expect(order(everyone.items)).toContain(sent.conversationId);
    for (const bad of ['not-a-uuid', '123', 'me%20', 'ME', '%00']) {
      expect(order((await inbox(tokens.demoSupport, `?owner=${bad}`)).items)).toEqual(
        order(everyone.items),
      );
    }
  });

  it('EP-052 encoding: tab, priority and owner compare exact lowercase literals, so Open and HIGH degrade to the default', async () => {
    const { tokens, ids } = await caseKit();
    const a = await throwawayMember('ep052-a');
    const b = await throwawayMember('ep052-b');
    const c = await throwawayMember('ep052-c');
    const sa = await send(a.token, { body: 'Normal' });
    const sb = await send(b.token, { body: 'Alta' });
    const sc = await send(c.token, { body: 'Fechado' });
    await setCase(sb.conversationId, {
      state: 'in_progress',
      owner: ids.demoSupport,
      priority: 'high',
    });
    await closeAsAdmin(sc.conversationId);
    const mine = new Set([sa.conversationId, sb.conversationId, sc.conversationId]);
    const only = async (query: string) =>
      idsOf((await walk(tokens.demoSupport, query)) as InboxRow[], mine);
    const open = await only('');
    expect(new Set(open)).toEqual(new Set([sa.conversationId, sb.conversationId]));
    for (const tab of ['Open', 'OPEN', ' open', 'open ', 'closed%20', 'CLOSED', 'Resolved']) {
      expect(await only(`tab=${tab}`), `tab=${tab} is the default tab`).toEqual(open);
    }
    expect(await only('tab=closed')).toEqual([sc.conversationId]);
    // `priority=HIGH` is not `high`: it degrades to no priority filter, so the normal case is still listed.
    for (const priority of ['HIGH', 'High', 'urgent', '']) {
      expect(await only(`priority=${priority}`), `priority=${priority}`).toEqual(open);
    }
    expect(await only('priority=high')).toEqual([sb.conversationId]);
    // `owner=ME` and `owner=NONE` are not the literals: no owner filter.
    for (const owner of ['ME', 'None', 'NONE']) {
      expect(await only(`owner=${owner}`), `owner=${owner}`).toEqual(open);
    }
    expect(await only('owner=me')).toEqual([sb.conversationId]);
    expect(await only('owner=none')).toEqual([sa.conversationId]);
  });

  it('EP-053 ordering: every tab sorts by latest activity, the filters never change the order and a case with no message sorts first and is walked past', async () => {
    const { tokens, ids } = await caseKit();
    const x = await throwawayMember('ep053-x');
    const y = await throwawayMember('ep053-y');
    const z = await throwawayMember('ep053-z');
    const empty = await throwawayMember('ep053-empty');
    const sx = await send(x.token, { body: 'Mais antigo' });
    const sy = await send(y.token, { body: 'Do meio' });
    const sz = await send(z.token, { body: 'Mais novo' });
    // A case that nobody wrote in yet: the admin lane creates it (the API creates a case with its first message).
    const [noMessage] = await adminSql<{ id: string }[]>`
      insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
      values (${ids.demo}::uuid, 'support', ${empty.id}::uuid)
      returning id::text as id`;
    const noMessageId = noMessage?.id ?? '';
    await adminSql`
      update public.chat_conversations set last_message_at = '2026-11-02T10:00:00Z' where id = ${sx.conversationId}::uuid`;
    await adminSql`
      update public.chat_conversations set last_message_at = '2026-11-02T11:00:00Z' where id = ${sy.conversationId}::uuid`;
    await adminSql`
      update public.chat_conversations set last_message_at = '2026-11-02T12:00:00Z' where id = ${sz.conversationId}::uuid`;
    await setCase(sy.conversationId, {
      state: 'in_progress',
      owner: ids.demoAdmin,
      priority: 'high',
    });
    const mine = new Set([sx.conversationId, sy.conversationId, sz.conversationId, noMessageId]);

    // The default tab: the case with no message first, then newest to oldest.
    const whole = await walk(tokens.demoSupport, '', 50);
    expect(idsOf(whole, mine)).toEqual([
      noMessageId,
      sz.conversationId,
      sy.conversationId,
      sx.conversationId,
    ]);
    const bare = whole.find((row) => row.conversationId === noMessageId);
    expect(bare).toMatchObject({ lastMessage: null, lastMessageAt: null, awaiting: false });
    // A limit=1 walk continues past it, each row once, in the very same order.
    const stepped = await walk(tokens.demoSupport, '', 1);
    expect(order(stepped)).toEqual(order(whole));
    expect(new Set(order(stepped)).size).toBe(stepped.length);

    // Filters restrict the page and never reorder it.
    for (const filter of ['owner=none', 'priority=normal', 'awaiting=1', 'owner=none&awaiting=1']) {
      const filtered = await walk(tokens.demoSupport, filter, 1);
      const keep = new Set(order(filtered));
      expect(order(filtered), filter).toEqual(order(whole).filter((id) => keep.has(id)));
    }

    // The resolved and closed tabs keep the same rule.
    for (const [tab, move] of [
      ['resolved', (id: string) => setCase(id, { state: 'resolved' })],
      ['closed', (id: string) => closeAsAdmin(id)],
    ] as const) {
      for (const id of [sx.conversationId, sz.conversationId, noMessageId]) await move(id);
      const tabWhole = await walk(tokens.demoSupport, `tab=${tab}`, 50);
      expect(idsOf(tabWhole, mine), tab).toEqual([
        noMessageId,
        sz.conversationId,
        sx.conversationId,
      ]);
      const tabStepped = await walk(tokens.demoSupport, `tab=${tab}`, 1);
      expect(order(tabStepped), tab).toEqual(order(tabWhole));
    }
  });
});
