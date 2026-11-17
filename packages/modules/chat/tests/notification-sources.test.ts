import type { Tx } from '@rede-social/core/db/tenant-tx';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { CHAT_NOTIFICATION_KINDS } from '../contracts/index';
import {
  CHAT_PUSH_BODY_MAX,
  caseAssignedPushCopy,
  caseNewPushCopy,
  caseReopenedPushCopy,
  caseResolvedPushCopy,
  memberMessagePushCopy,
  supportReplyPushCopy,
} from '../server/notification-copy';
import {
  CHAT_PUSH_TTL_SECONDS,
  chatNotificationSources,
  conversationTag,
} from '../server/notifications';

/**
 * The chat notification sources (07-08, D-228, D-235; 12.4-09, D-808, D-809, D-841), pinned with a fake `tx` that
 * answers each statement in order and records the SQL it was given. The SQL itself is proved end to end by
 * `chat-cases-notices.test.ts` and `chat.test.ts`.
 */

const T = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const C = '1d000000-0000-4000-8000-000000000001';
const M = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const OWNER = STAFF;
const TAG = '1d000000000040008000000000000001';

type MessageRow = {
  kind: string;
  member_user_id: string | null;
  member_name: string | null;
  body: string;
  author_side: 'member' | 'staff';
  author_user_id: string;
  case_number: number | null;
  owner_user_id: string | null;
  owner_live: boolean;
  reopened: boolean;
};

type FakeTx = Tx & { calls: number; statements: string[] };

const dialect = new PgDialect();

function fakeTx(...answers: unknown[][]): FakeTx {
  const queue = [...answers];
  const tx = {
    calls: 0,
    statements: [] as string[],
    execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
      tx.calls += 1;
      tx.statements.push(dialect.sqlToQuery(query).sql);
      return queue.shift() ?? [];
    },
  };
  return tx as unknown as FakeTx;
}

const source = <E extends string>(event: E) => {
  const found = chatNotificationSources.find((s) => s.event === event);
  if (!found) throw new Error(`chat declares no ${event} source`);
  return found;
};
const messageSource = source('chat.message_sent');
const resolvedSource = source('chat.case_resolved');
const assignedSource = source('chat.case_assigned');

const payload = (authorSide: 'member' | 'staff', authorUserId: string, seq = 2) => ({
  tenantId: T,
  conversationId: C,
  messageId: M,
  seq,
  authorUserId,
  authorSide,
});

const row = (over: Partial<MessageRow>): MessageRow => ({
  kind: 'support',
  member_user_id: MEMBER,
  member_name: 'Membro Rede Demo',
  body: 'Oi! Como posso ajudar?',
  author_side: 'staff',
  author_user_id: STAFF,
  case_number: 7,
  owner_user_id: null,
  owner_live: false,
  reopened: false,
  ...over,
});

const memberRow = (over: Partial<MessageRow> = {}): MessageRow =>
  row({ author_side: 'member', author_user_id: MEMBER, body: 'Quero trocar meu e-mail.', ...over });

const meta = { sinkAt: '2026-09-30T12:00:00.000000Z' };

const graphemes = (text: string): number =>
  [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text)].length;

describe('chat notification sources', () => {
  it('listens to the message, the resolved case and the assigned case, in that order', () => {
    expect(chatNotificationSources.map((s) => s.event)).toEqual([
      'chat.message_sent',
      'chat.case_resolved',
      'chat.case_assigned',
    ]);
  });

  it('the tag and topic are the conversation id without hyphens: exactly 32 hex characters', () => {
    expect(conversationTag(C)).toBe(TAG);
    expect(conversationTag(C)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('a STAFF message is ONE push-only intent to the member, titled for the team, url /suporte', async () => {
    const tx = fakeTx([row({})]);
    const intents = await messageSource.resolve(tx, payload('staff', STAFF), meta);
    expect(tx.calls).toBe(1);
    expect(intents).toEqual([
      {
        kind: CHAT_NOTIFICATION_KINDS.supportReply,
        audience: { type: 'users', userIds: [MEMBER] },
        excludeUserIds: [STAFF],
        dedupeKey: `chat.support_reply:${M}`,
        subject: { type: 'conversation', id: C },
        object: null,
        actorUserId: STAFF,
        facts: {},
        channels: ['push'],
        push: {
          title: 'team',
          body: 'Oi! Como posso ajudar?',
          url: '/suporte',
          tag: TAG,
          topic: TAG,
          ttlSeconds: CHAT_PUSH_TTL_SECONDS,
          urgency: 'high',
          renotify: true,
        },
      },
    ]);
    expect(CHAT_PUSH_TTL_SECONDS).toBe(259_200);
  });

  it('new: the first message of a case (seq = 1) is chat.case_new to every live staff member, push only', async () => {
    const tx = fakeTx([memberRow()], [{ user_id: ADMIN }, { user_id: STAFF }]);
    const intents = await messageSource.resolve(tx, payload('member', MEMBER, 1), meta);
    expect(tx.calls).toBe(2);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      kind: 'chat.case_new',
      audience: { type: 'users', userIds: [ADMIN, STAFF] },
      excludeUserIds: [MEMBER],
      dedupeKey: `chat.case_new:${M}`,
      subject: { type: 'conversation', id: C },
      facts: {},
      channels: ['push'],
      push: {
        title: 'tenant',
        body: 'Novo chamado #7 de Membro Rede Demo: Quero trocar meu e-mail.',
        url: `/suporte/${C}`,
        tag: TAG,
        topic: TAG,
        urgency: 'high',
        renotify: true,
      },
    });
    // Never a bell row (D-228, D-809): push is the ONLY channel of a team notice.
    expect(intents[0]?.channels).not.toContain('in_app');
  });

  it('reopened: a message that carries a reopened history row is chat.case_reopened to every live staff member', async () => {
    const tx = fakeTx(
      [memberRow({ reopened: true, owner_user_id: null })],
      [{ user_id: ADMIN }, { user_id: STAFF }],
    );
    const intents = await messageSource.resolve(tx, payload('member', MEMBER, 5), meta);
    expect(intents[0]).toMatchObject({
      kind: 'chat.case_reopened',
      audience: { type: 'users', userIds: [ADMIN, STAFF] },
      dedupeKey: `chat.case_reopened:${M}`,
      channels: ['push'],
      push: { body: 'O chamado #7 de Membro Rede Demo foi reaberto: Quero trocar meu e-mail.' },
    });
    // The history probe is part of the one tenant-pinned read.
    expect(tx.statements[0]).toContain('chat_case_events');
    expect(tx.statements[0]).toContain("'reopened'");
  });

  it('owner only: a member message on a case whose owner is live staff pushes that owner alone (EP-062, EP-063)', async () => {
    const tx = fakeTx([memberRow({ owner_user_id: OWNER, owner_live: true })]);
    const intents = await messageSource.resolve(tx, payload('member', MEMBER, 4), meta);
    expect(tx.calls).toBe(1);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      kind: 'chat.member_message',
      audience: { type: 'users', userIds: [OWNER] },
      dedupeKey: `chat.member_message:${M}`,
      push: {
        body: 'Nova mensagem de Membro Rede Demo no chamado #7: Quero trocar meu e-mail.',
        url: `/suporte/${C}`,
      },
    });
  });

  it('no live owner: an owner who is no longer live staff sends the push to every live staff member', async () => {
    const tx = fakeTx(
      [memberRow({ owner_user_id: OWNER, owner_live: false })],
      [{ user_id: ADMIN }, { user_id: STAFF }],
    );
    const intents = await messageSource.resolve(tx, payload('member', MEMBER, 4), meta);
    expect(intents[0]).toMatchObject({
      kind: 'chat.member_message',
      audience: { type: 'users', userIds: [ADMIN, STAFF] },
    });
  });

  it('no owner: a case nobody owns pushes every live staff member', async () => {
    const tx = fakeTx([memberRow({ owner_user_id: null })], [{ user_id: ADMIN }]);
    const intents = await messageSource.resolve(tx, payload('member', MEMBER, 3), meta);
    expect(intents[0]).toMatchObject({
      kind: 'chat.member_message',
      audience: { type: 'users', userIds: [ADMIN] },
    });
  });

  it('no staff: with no live staff member the message yields no intent, for every case kind (EP-063)', async () => {
    for (const seq of [1, 3]) {
      const tx = fakeTx([memberRow()], []);
      expect(await messageSource.resolve(tx, payload('member', MEMBER, seq), meta)).toEqual([]);
    }
    const reopened = fakeTx([memberRow({ reopened: true })], []);
    expect(await messageSource.resolve(reopened, payload('member', MEMBER, 5), meta)).toEqual([]);
    // Only the author is "staff" (a staff member writing through the member side): still nobody to tell.
    const onlyAuthor = fakeTx([memberRow()], [{ user_id: MEMBER }]);
    expect(await messageSource.resolve(onlyAuthor, payload('member', MEMBER, 3), meta)).toEqual([]);
  });

  it('the audience query is tenant-pinned and sorted by user id (EP-065)', async () => {
    const tx = fakeTx([memberRow()], [{ user_id: ADMIN }]);
    await messageSource.resolve(tx, payload('member', MEMBER, 1), meta);
    const audience = tx.statements[1] ?? '';
    expect(audience).toContain('ms.tenant_id =');
    expect(audience).toContain('order by ms.user_id');
    expect(audience).toContain("'admin_tenant', 'support_tenant'");
    const message = tx.statements[0] ?? '';
    expect(message).toContain('m.tenant_id =');
    expect(message).toContain('om.tenant_id = c.tenant_id');
  });

  it('a team notice dedupes on the message id (EP-065)', async () => {
    const first = await messageSource.resolve(
      fakeTx([memberRow()], [{ user_id: ADMIN }]),
      payload('member', MEMBER, 1),
      meta,
    );
    const other = await messageSource.resolve(
      fakeTx([memberRow()], [{ user_id: ADMIN }]),
      { ...payload('member', MEMBER, 1), messageId: '55555555-5555-4555-8555-555555555555' },
      meta,
    );
    expect(first[0]?.dedupeKey).toBe(`chat.case_new:${M}`);
    expect(other[0]?.dedupeKey).toBe('chat.case_new:55555555-5555-4555-8555-555555555555');
  });

  it('a legacy thread with no case number keeps the shipped sentence, never "#null"', async () => {
    const tx = fakeTx([memberRow({ case_number: null })], [{ user_id: ADMIN }]);
    const intents = await messageSource.resolve(tx, payload('member', MEMBER, 1), meta);
    expect(intents[0]?.push?.body).toBe(
      'Nova mensagem de Membro Rede Demo: Quero trocar meu e-mail.',
    );
  });

  it('a non-support conversation, a missing message or a thread without a member yield []', async () => {
    expect(
      await messageSource.resolve(fakeTx([row({ kind: 'direct' })]), payload('staff', STAFF), meta),
    ).toEqual([]);
    expect(await messageSource.resolve(fakeTx([]), payload('staff', STAFF), meta)).toEqual([]);
    expect(
      await messageSource.resolve(
        fakeTx([row({ member_user_id: null })]),
        payload('staff', STAFF),
        meta,
      ),
    ).toEqual([]);
  });

  it('assigned: one push-only intent to the assignee, never the actor, with the sink instant in the dedupe key', async () => {
    const tx = fakeTx([{ case_number: 12, member_name: 'Íris Muñoz' }]);
    const intents = await assignedSource.resolve(
      tx,
      { tenantId: T, conversationId: C, assigneeUserId: STAFF, actorUserId: ADMIN },
      meta,
    );
    expect(intents).toEqual([
      {
        kind: 'chat.case_assigned',
        audience: { type: 'users', userIds: [STAFF] },
        excludeUserIds: [ADMIN],
        dedupeKey: `chat.case_assigned:${C}:${STAFF}:${meta.sinkAt}`,
        subject: { type: 'conversation', id: C },
        object: null,
        actorUserId: ADMIN,
        facts: {},
        channels: ['push'],
        push: {
          title: 'tenant',
          body: 'O chamado #12 de Íris Muñoz foi atribuído a você.',
          url: `/suporte/${C}`,
          tag: TAG,
          topic: TAG,
          ttlSeconds: CHAT_PUSH_TTL_SECONDS,
          urgency: 'high',
          renotify: true,
        },
      },
    ]);
    expect(tx.statements[0]).toContain('c.tenant_id =');
  });

  it('self-assignment: an admin who assigns a case to themselves notifies nobody and reads nothing (EP-062)', async () => {
    const tx = fakeTx([{ case_number: 12, member_name: 'Íris Muñoz' }]);
    expect(
      await assignedSource.resolve(
        tx,
        { tenantId: T, conversationId: C, assigneeUserId: ADMIN, actorUserId: ADMIN },
        meta,
      ),
    ).toEqual([]);
    expect(tx.calls).toBe(0);
    // A second assignment of the same case is a new notice (another sink instant).
    const again = await assignedSource.resolve(
      fakeTx([{ case_number: 12, member_name: null }]),
      { tenantId: T, conversationId: C, assigneeUserId: STAFF, actorUserId: ADMIN },
      { sinkAt: '2026-09-30T12:05:00.000000Z' },
    );
    expect(again[0]?.dedupeKey).toBe(
      `chat.case_assigned:${C}:${STAFF}:2026-09-30T12:05:00.000000Z`,
    );
    expect(again[0]?.push?.body).toBe('O chamado #12 de um membro foi atribuído a você.');
  });

  it('assigned with a case that has no number or no row yields nothing', async () => {
    const event = { tenantId: T, conversationId: C, assigneeUserId: STAFF, actorUserId: ADMIN };
    expect(await assignedSource.resolve(fakeTx([]), event, meta)).toEqual([]);
    expect(
      await assignedSource.resolve(fakeTx([{ case_number: null, member_name: 'X' }]), event, meta),
    ).toEqual([]);
  });

  it('resolved: one in-app plus push intent for the member, ids-only facts, a fixed sentence (D-808, T-12.4-41)', async () => {
    const resolvedAt = '2026-09-30T12:00:00.123456Z';
    const tx = fakeTx([{ member_user_id: MEMBER, case_number: 9 }]);
    const intents = await resolvedSource.resolve(
      tx,
      { tenantId: T, conversationId: C, resolvedAt },
      meta,
    );
    expect(intents).toEqual([
      {
        kind: 'chat.case_resolved',
        audience: { type: 'users', userIds: [MEMBER] },
        excludeUserIds: [],
        dedupeKey: `chat.case_resolved:${C}:${resolvedAt}`,
        subject: { type: 'conversation', id: C },
        object: null,
        actorUserId: null,
        facts: { caseId: C, number: 9 },
        channels: ['in_app', 'push'],
        push: {
          title: 'team',
          body: 'Seu chamado #9 foi resolvido.',
          url: `/suporte/${C}`,
          tag: TAG,
          topic: TAG,
          ttlSeconds: CHAT_PUSH_TTL_SECONDS,
          urgency: 'high',
          renotify: true,
        },
      },
    ]);
  });

  it('resolved: the instant is compared in SQL as timestamptz, the case must be resolved and tenant-pinned (EP-061)', async () => {
    const resolvedAt = '2026-09-30T12:00:00.123456Z';
    const tx = fakeTx([]);
    expect(
      await resolvedSource.resolve(tx, { tenantId: T, conversationId: C, resolvedAt }, meta),
    ).toEqual([]);
    const text = tx.statements[0] ?? '';
    expect(text).toContain('c.resolved_at = $');
    expect(text).toContain('::timestamptz');
    expect(text).toContain("c.state = 'resolved'");
    expect(text).toContain('c.tenant_id =');
  });

  it('closing, reopening, taking and editing notify the member of nothing: no source listens to them', () => {
    expect(chatNotificationSources.map((s) => s.event)).not.toContain('chat.case_closed');
    expect(chatNotificationSources.map((s) => s.event)).not.toContain('chat.case_reopened');
  });
});

describe('chat push copy', () => {
  const long = `${'palavra '.repeat(30)}fim`;

  it('the preview is cut on a word to 100 graphemes, newlines as spaces, with … only when cut (EP-064)', () => {
    const reply = supportReplyPushCopy(long);
    expect(graphemes(reply)).toBeLessThanOrEqual(CHAT_PUSH_BODY_MAX);
    expect(reply.endsWith('…')).toBe(true);
    expect(reply).not.toContain('palavr…');
    expect(supportReplyPushCopy('Linha 1\n\nLinha 2')).toBe('Linha 1 Linha 2');
    expect(supportReplyPushCopy('Curta')).toBe('Curta');
  });

  it('every team body carries the number as #N, is cut on a word at 100 graphemes and ends in … only when cut', () => {
    const bodies = [
      memberMessagePushCopy('Íris Muñoz', 7, long),
      caseNewPushCopy(7, 'Íris Muñoz', long),
      caseReopenedPushCopy(7, 'Íris Muñoz', long),
    ];
    for (const body of bodies) {
      expect(graphemes(body)).toBeLessThanOrEqual(CHAT_PUSH_BODY_MAX);
      expect(body.endsWith('…')).toBe(true);
      expect(body).toContain('#7');
      expect(body).not.toContain('# 7');
    }
    expect(bodies[0]?.startsWith('Nova mensagem de Íris Muñoz no chamado #7: palavra')).toBe(true);
    expect(bodies[1]?.startsWith('Novo chamado #7 de Íris Muñoz: palavra')).toBe(true);
    expect(bodies[2]?.startsWith('O chamado #7 de Íris Muñoz foi reaberto: palavra')).toBe(true);
    // Short text is never given an ellipsis.
    expect(caseNewPushCopy(7, 'Íris', 'Oi')).toBe('Novo chamado #7 de Íris: Oi');
    expect(caseNewPushCopy(7, null, 'Oi\nlinha')).toBe('Novo chamado #7 de um membro: Oi linha');
    expect(memberMessagePushCopy(null, null, 'Oi')).toBe('Nova mensagem de um membro: Oi');
    expect(caseAssignedPushCopy(7, 'Íris')).toBe('O chamado #7 de Íris foi atribuído a você.');
    expect(caseResolvedPushCopy(7)).toBe('Seu chamado #7 foi resolvido.');
  });

  it('a ZWJ emoji at the boundary is never split (EP-064)', () => {
    const family = '👨‍👩‍👧‍👦';
    const body = supportReplyPushCopy(`${'a'.repeat(98)}${family}bb`);
    expect(graphemes(body)).toBeLessThanOrEqual(CHAT_PUSH_BODY_MAX);
    expect(body).toContain(family);
    expect(body.endsWith('…')).toBe(true);
    // One more grapheme of room is lost to the ellipsis: the emoji goes whole or not at all.
    const tight = supportReplyPushCopy(`${'a'.repeat(99)}${family}bb`);
    expect(tight).not.toContain('👨‍👩‍👧');
    expect(graphemes(tight)).toBeLessThanOrEqual(CHAT_PUSH_BODY_MAX);
  });
});
