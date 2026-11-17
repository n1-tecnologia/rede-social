import { readFileSync } from 'node:fs';
import {
  CASE_ACTIVE_STATES,
  type ConversationDetail,
  type MyCasesPage,
  myCasesPageSchema,
  myCasesQuerySchema,
  type SendResult,
  type SupportThread,
} from '@rede-social/module-chat/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  caseKit,
  highestNumber,
  post,
  removeThrowaways,
  request,
  SEED_THREAD,
  sweepCases,
  throwawayMember,
} from './chat-case-fixtures';
import { adminSql } from './setup';

/**
 * The support case, end to end against the live local stack (Phase 12.4, plan 01).
 *
 * `case tracer` (CASE-01, CASE-02, D-836, D-837): a member's FIRST message goes through the shipped
 * route and the shipped service with the API code UNCHANGED, and the database turns the new support
 * conversation into a numbered, born-open case with one `opened` event. The number is read through the
 * admin lane as an integer and asserted RELATIVE to the tenant's highest number, because the counter is
 * never reset (numbers keep rising across files and runs).
 *
 * `case activation` (plan 02, CASE-03, CASE-21, D-801, D-802, D-814): after the activation migration a
 * member whose case was closed gets the NEXT numbered case on the next message, and no support
 * conversation is left without a state. (The pre-activation proof of plan 01, a conversation with all
 * case columns null still taking messages, is retired: the validated support-state constraint now
 * refuses such a row, and pgTAP 235 section 5 keeps proving the trigger branch.)
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

beforeAll(async () => {
  await caseKit();
  await sweepCases();
});

afterAll(async () => {
  await sweepCases();
  await removeThrowaways();
});

describe('case tracer', () => {
  it('a first member message becomes a numbered open case with its opened event', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const member = await throwawayMember('tracer');

    const sent = await post('/v1/chat/support/messages', member.token, {
      body: 'Preciso de ajuda',
    });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    // The shipped keys stay; the optional `case` is added by plan 06.
    expect(Object.keys(result).sort()).toEqual(['case', 'conversationId', 'message']);

    const [row] = await adminSql<
      {
        case_number: number;
        state: string;
        priority: string;
        category: string;
        owner: string | null;
      }[]
    >`
      select case_number, state, priority, category, owner_user_id::text as owner
        from public.chat_conversations
       where id = ${result.conversationId}::uuid`;
    expect(row?.case_number).toBe(base + 1);
    expect(Number.isInteger(row?.case_number)).toBe(true);
    expect(row?.state).toBe('open');
    expect(row?.priority).toBe('normal');
    expect(row?.category).toBe('other');
    expect(row?.owner).toBeNull();

    const events = await adminSql<
      { kind: string; actor: string | null; to_state: string | null }[]
    >`
      select kind, actor_user_id::text as actor, to_state
        from public.chat_case_events
       where conversation_id = ${result.conversationId}::uuid
       order by created_at, id`;
    expect(events).toEqual([{ kind: 'opened', actor: member.id, to_state: 'open' }]);
  });
});

describe('case first message', () => {
  const conversationRows = (memberId: string) =>
    adminSql<{ id: string }[]>`
      select id::text as id from public.chat_conversations
       where kind = 'support' and created_by_user_id = ${memberId}::uuid`;

  it('tracer: a first message with a category and a subject opens a case the thread read returns (D-812, D-811, D-839, CASE-10, CASE-15)', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const member = await throwawayMember('first-fields');

    const sent = await post('/v1/chat/support/messages', member.token, {
      body: 'Fui cobrado duas vezes no cartão',
      category: 'payment',
      subject: 'Cobrança duplicada',
    });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    // The shipped keys stay and the optional `case` is added.
    expect(Object.keys(result).sort()).toEqual(['case', 'conversationId', 'message']);
    expect(result.case).toEqual({
      id: result.conversationId,
      number: base + 1,
      state: 'open',
      opened: true,
      reopened: false,
    });

    const read = await request('/v1/chat/support', member.token);
    expect(read.status).toBe(200);
    const thread = (await read.json()) as SupportThread;
    expect(thread.conversation?.id).toBe(result.conversationId);
    expect(thread.hasAnyCase).toBe(true);
    expect(thread.case).toMatchObject({
      id: result.conversationId,
      number: base + 1,
      state: 'open',
      subject: 'Cobrança duplicada',
      subjectLabel: 'Cobrança duplicada',
      category: 'payment',
    });
    expect(thread.case).not.toHaveProperty('priority');
    expect(thread.case).not.toHaveProperty('ownerUserId');

    // A second message from the same member lands in the same case and ignores the new fields.
    const again = await post('/v1/chat/support/messages', member.token, {
      body: 'Mais uma informação',
      category: 'account',
      subject: 'Outro assunto',
    });
    expect(again.status).toBe(201);
    const second = (await again.json()) as SendResult;
    expect(second.conversationId).toBe(result.conversationId);
    expect(second.case).toMatchObject({ number: base + 1, opened: false, reopened: false });
    const [stored] = await adminSql<
      { category: string; subject: string | null; priority: string }[]
    >`
      select category, subject, priority from public.chat_conversations
       where id = ${result.conversationId}::uuid`;
    expect(stored).toEqual({
      category: 'payment',
      subject: 'Cobrança duplicada',
      priority: 'normal',
    });
  });

  it('a body carrying priority, state or owner is a 400 and writes no conversation (D-812, T-12.4-25)', async () => {
    const member = await throwawayMember('forged');
    for (const forged of [{ priority: 'high' }, { state: 'closed' }, { owner: member.id }]) {
      const refused = await post('/v1/chat/support/messages', member.token, {
        body: 'Quero prioridade',
        category: 'payment',
        ...forged,
      });
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(await conversationRows(member.id)).toEqual([]);
  });
});

describe('case member reads', () => {
  const closeAsAdmin = (conversationId: string) => adminSql`
      update public.chat_conversations
         set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
       where id = ${conversationId}::uuid`;

  const send = async (token: string, body: Record<string, unknown>) => {
    const sent = await post('/v1/chat/support/messages', token, body);
    expect(sent.status).toBe(201);
    return (await sent.json()) as SendResult;
  };

  /** A member with two closed cases (A then B) and an active one (C), the first closed one answered by staff. */
  async function memberWithThreeCases(label: string) {
    const { tokens } = await caseKit();
    const member = await throwawayMember(label);
    const a = await send(member.token, { body: 'Primeiro assunto', subject: 'Check-in travado' });
    const reply = await post(
      `/v1/chat/conversations/${a.conversationId}/messages`,
      tokens.demoSupport,
      {
        body: 'Já resolvemos o seu check-in',
      },
    );
    expect(reply.status).toBe(201);
    await closeAsAdmin(a.conversationId);
    const b = await send(member.token, { body: 'Segundo chamado sem assunto digitado' });
    await closeAsAdmin(b.conversationId);
    const c = await send(member.token, { body: 'Terceiro', category: 'events', subject: 'Evento' });
    return { member, a, b, c };
  }

  const myCases = async (token: string, query = '') => {
    const res = await request(`/v1/chat/support/cases${query}`, token);
    expect(res.status).toBe(200);
    return (await res.json()) as MyCasesPage;
  };

  it('answers the active case, the closed ones newest first, the total and the last message of each (D-803)', async () => {
    const { member, a, b, c } = await memberWithThreeCases('mycases');
    const page = await myCases(member.token);
    // The strict schema: a staff fact in a card would not parse.
    expect(myCasesPageSchema.parse(page)).toEqual(page);
    expect(page.current?.id).toBe(c.conversationId);
    expect(page.current).toMatchObject({
      state: 'open',
      category: 'events',
      subjectLabel: 'Evento',
    });
    expect(page.items.map((card) => card.id)).toEqual([b.conversationId, a.conversationId]);
    expect(page.total).toBe(2);
    expect(page.nextCursor).toBeNull();
    // The label of a case with no typed subject is the start of its first message.
    expect(page.items[0]).toMatchObject({
      subject: null,
      subjectLabel: 'Segundo chamado sem assunto digitado',
      state: 'closed',
    });
    expect(page.items[1]?.lastMessage).toEqual({
      side: 'staff',
      preview: 'Já resolvemos o seu check-in',
    });
    expect(page.items[0]?.lastMessage).toEqual({
      side: 'member',
      preview: 'Segundo chamado sem assunto digitado',
    });
    for (const card of [page.current, ...page.items]) {
      expect(card).not.toHaveProperty('priority');
      expect(card).not.toHaveProperty('ownerUserId');
    }
  });

  it('a limit=1 keyset walk visits each closed case once, and a tampered cursor degrades to page 1 (EP-048, T-12.4-29)', async () => {
    const { member, a, b } = await memberWithThreeCases('keyset');
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let step = 0; step < 5; step += 1) {
      const query: string = cursor ? `?limit=1&cursor=${encodeURIComponent(cursor)}` : '?limit=1';
      const page: MyCasesPage = await myCases(member.token, query);
      seen.push(...page.items.map((card) => card.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    // The union of the pages equals the closed set, newest first, with no repeat.
    expect(seen).toEqual([b.conversationId, a.conversationId]);
    expect(new Set(seen).size).toBe(seen.length);

    const first = await myCases(member.token, '?limit=1');
    const forge = (n: string) =>
      Buffer.from(JSON.stringify({ v: 1, n, id: a.conversationId })).toString('base64url');
    for (const tampered of [
      'not-a-cursor',
      forge('1; drop table chat_conversations'),
      forge('99999999999999999999'),
      forge('-3'),
      forge('1.5'),
    ]) {
      const degraded = await myCases(
        member.token,
        `?limit=1&cursor=${encodeURIComponent(tampered)}`,
      );
      expect(degraded.items.map((card) => card.id)).toEqual(first.items.map((card) => card.id));
    }
  });

  it('GET /conversations/{id} answers the member case for the active and for a closed own case, and one bare 404 for anything else (D-804, CASE-14)', async () => {
    const { member, a, c } = await memberWithThreeCases('detail');
    const detail = async (id: string, token: string) =>
      request(`/v1/chat/conversations/${id}`, token);

    const active = (await (
      await detail(c.conversationId, member.token)
    ).json()) as ConversationDetail;
    expect(active).toMatchObject({
      viewer: 'member',
      case: { id: c.conversationId, state: 'open' },
    });
    const closedRes = await detail(a.conversationId, member.token);
    expect(closedRes.status).toBe(200);
    const closed = (await closedRes.json()) as ConversationDetail;
    expect(closed).toMatchObject({
      viewer: 'member',
      case: { id: a.conversationId, state: 'closed', subject: 'Check-in travado' },
    });
    expect(closed).not.toHaveProperty('case.priority');

    const stranger = await throwawayMember('detail-stranger');
    const refusals = [
      await detail(a.conversationId, stranger.token),
      await detail('00000000-0000-4000-8000-0000000000aa', member.token),
    ];
    expect(refusals.map((res) => res.status)).toEqual([404, 404]);
    // Indistinguishable apart from the per-request id.
    const bodies = (await Promise.all(refusals.map((res) => res.json()))) as {
      error: Record<string, unknown>;
    }[];
    const bare = (body: { error: Record<string, unknown> }) => {
      const { requestId: _requestId, ...rest } = body.error;
      return rest;
    };
    expect(bare(bodies[0] as never)).toEqual(bare(bodies[1] as never));
    expect(bare(bodies[0] as never).code).toBe('NOT_FOUND');
    expect(JSON.stringify(bodies[0])).not.toContain(a.conversationId);
  });

  it('a staff lane is refused on the member route (D-223)', async () => {
    const { tokens } = await caseKit();
    expect((await request('/v1/chat/support/cases', tokens.demoSupport)).status).toBe(403);
  });
});

describe('case isolation and edges', () => {
  const send = (token: string, body: Record<string, unknown>) =>
    post('/v1/chat/support/messages', token, body);
  const storedOf = async (conversationId: string) => {
    const [row] = await adminSql<{ category: string; subject: string | null }[]>`
      select category, subject from public.chat_conversations where id = ${conversationId}::uuid`;
    return row;
  };
  const countFor = async (memberId: string) => {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_conversations
       where kind = 'support' and created_by_user_id = ${memberId}::uuid`;
    return row?.n ?? 0;
  };

  it('EP-028 adjacency: a subject of exactly 80 code points is stored, 81 is subject_too_long and writes no conversation', async () => {
    const ok = await throwawayMember('subject-80');
    const accepted = await send(ok.token, { body: 'Oi', subject: 'a'.repeat(80) });
    expect(accepted.status).toBe(201);
    const result = (await accepted.json()) as SendResult;
    expect((await storedOf(result.conversationId))?.subject).toBe('a'.repeat(80));

    const over = await throwawayMember('subject-81');
    const refused = await send(over.token, { body: 'Oi', subject: 'a'.repeat(81) });
    expect(refused.status).toBe(400);
    const envelope = (await refused.json()) as { error: { code: string; details: unknown } };
    expect(envelope.error.code).toBe('VALIDATION_FAILED');
    expect(envelope.error.details).toEqual({ chat: 'subject_too_long' });
    expect(await countFor(over.id)).toBe(0);
  });

  it('EP-029 empty: a blank subject stores null, an absent category stores other, and the shipped { body } alone still answers a case', async () => {
    for (const subject of ['', '   \n\t ']) {
      const member = await throwawayMember('subject-blank');
      const sent = await send(member.token, { body: 'Oi', subject });
      expect(sent.status).toBe(201);
      const result = (await sent.json()) as SendResult;
      expect(await storedOf(result.conversationId)).toEqual({ category: 'other', subject: null });
    }
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const bare = await throwawayMember('body-only');
    const sent = await send(bare.token, { body: 'Só o corpo' });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    expect(result.case).toMatchObject({ number: base + 1, opened: true, reopened: false });
  });

  it('EP-030 encoding: the subject counts code points (80 emoji pass, 81 do not, the CHECK agrees), is not normalised and a line break is stored as sent', async () => {
    const emoji = await throwawayMember('subject-emoji');
    const accepted = await send(emoji.token, { body: 'Oi', subject: '😀'.repeat(80) });
    expect(accepted.status).toBe(201);
    const over = await throwawayMember('subject-emoji-81');
    const refused = await send(over.token, { body: 'Oi', subject: '😀'.repeat(81) });
    expect(refused.status).toBe(400);
    // The database CHECK counts the same code points as the schema.
    const { ids } = await caseKit();
    await expect(
      adminSql`
        insert into public.chat_conversations (tenant_id, kind, created_by_user_id, subject)
        values (${ids.demo}::uuid, 'support', ${over.id}::uuid, ${'😀'.repeat(81)})`,
    ).rejects.toMatchObject({ constraint_name: 'chat_conversations_subject_chk' });

    // No Unicode normalisation: a decomposed "e" + combining acute is stored byte for byte.
    const decomposed = 'Café';
    const raw = await throwawayMember('subject-nfd');
    const nfd = await send(raw.token, { body: 'Oi', subject: decomposed });
    const nfdResult = (await nfd.json()) as SendResult;
    expect((await storedOf(nfdResult.conversationId))?.subject).toBe(decomposed);
    expect((await storedOf(nfdResult.conversationId))?.subject).not.toBe(
      decomposed.normalize('NFC'),
    );

    // A line break inside the subject is stored as sent and shown as one line by the label rule.
    const broken = await throwawayMember('subject-break');
    const lines = await send(broken.token, { body: 'Oi', subject: 'Linha um\nlinha dois' });
    const linesResult = (await lines.json()) as SendResult;
    expect((await storedOf(linesResult.conversationId))?.subject).toBe('Linha um\nlinha dois');
    const thread = (await (
      await request('/v1/chat/support', broken.token)
    ).json()) as SupportThread;
    expect(thread.case?.subjectLabel).toBe('Linha um linha dois');
  });

  it('EP-031 ordering: two first messages racing from two devices create one case with the winner whole, never a per-field mix', async () => {
    const member = await throwawayMember('race-fields');
    const [one, two] = await Promise.all([
      send(member.token, { body: 'Do aparelho um', category: 'payment', subject: 'Alfa' }),
      send(member.token, { body: 'Do aparelho dois', category: 'events', subject: 'Beta' }),
    ]);
    expect([one.status, two.status]).toEqual([201, 201]);
    const results = [(await one.json()) as SendResult, (await two.json()) as SendResult];
    expect(results[0]?.conversationId).toBe(results[1]?.conversationId);
    expect(results.map((result) => result.case?.opened).sort()).toEqual([false, true]);
    expect(await countFor(member.id)).toBe(1);
    const stored = await storedOf(results[0]?.conversationId ?? '');
    expect([
      { category: 'payment', subject: 'Alfa' },
      { category: 'events', subject: 'Beta' },
    ]).toContainEqual(stored);
  });

  it('EP-032 empty: a case with no subject and no message has an empty label, and a whitespace-only-collapsed first message is that text', async () => {
    const { ids } = await caseKit();
    const lone = await throwawayMember('label-empty');
    const [created] = await adminSql<{ id: string }[]>`
      insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
      values (${ids.demo}::uuid, 'support', ${lone.id}::uuid) returning id::text as id`;
    await adminSql`
      insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
      values (${created?.id ?? ''}::uuid, ${ids.demo}::uuid, ${lone.id}::uuid, 'member')`;
    const detail = (await (
      await request(`/v1/chat/conversations/${created?.id}`, lone.token)
    ).json()) as ConversationDetail;
    expect(detail).toMatchObject({ viewer: 'member', case: { subject: null, subjectLabel: '' } });

    const spaced = await throwawayMember('label-spaced');
    await send(spaced.token, { body: 'Texto   com\n\n  espaços\tvários' });
    const thread = (await (
      await request('/v1/chat/support', spaced.token)
    ).json()) as SupportThread;
    expect(thread.case?.subjectLabel).toBe('Texto com espaços vários');
  });

  it('EP-033 encoding: the label cut counts graphemes, never splits a ZWJ sequence, never exceeds 80, adds the ellipsis only when it cut and the typed subject is never cut', async () => {
    const family = '👨‍👩‍👧‍👦';
    const graphemes = (text: string) =>
      [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text)].length;
    const labelOf = async (token: string) =>
      ((await (await request('/v1/chat/support', token)).json()) as SupportThread).case
        ?.subjectLabel ?? '';

    const cut = await throwawayMember('label-cut');
    await send(cut.token, { body: `${'a'.repeat(78)}${family}${'b'.repeat(40)}` });
    const label = await labelOf(cut.token);
    expect(graphemes(label)).toBeLessThanOrEqual(80);
    expect(label.endsWith('…')).toBe(true);
    expect(label).toContain(family);

    const words = await throwawayMember('label-words');
    await send(words.token, { body: Array.from({ length: 60 }, () => 'palavra').join(' ') });
    const wordsLabel = await labelOf(words.token);
    expect(graphemes(wordsLabel)).toBeLessThanOrEqual(80);
    expect(wordsLabel.endsWith('…')).toBe(true);
    expect(wordsLabel.replace(/…$/, '')).toMatch(/palavra$/);

    const exact = await throwawayMember('label-exact');
    await send(exact.token, { body: 'x'.repeat(80) });
    expect(await labelOf(exact.token)).toBe('x'.repeat(80));

    const typed = await throwawayMember('label-typed');
    // 73 + 7 code points of the family sequence = exactly 80 code points, 74 graphemes.
    const typedSent = await send(typed.token, {
      body: 'Outro texto',
      subject: `${'y'.repeat(73)}${family}`,
    });
    expect(typedSent.status).toBe(201);
    expect(await labelOf(typed.token)).toBe(`${'y'.repeat(73)}${family}`);
  });

  it('EP-044 boundary: 2000 code points send and 2001 is body_too_long, the number is an integer of at least 1 and the page size clamps', async () => {
    const member = await throwawayMember('boundary');
    const ok = await send(member.token, { body: '😀'.repeat(2000) });
    expect(ok.status).toBe(201);
    const result = (await ok.json()) as SendResult;
    expect(Number.isInteger(result.case?.number)).toBe(true);
    expect(result.case?.number ?? 0).toBeGreaterThanOrEqual(1);
    const over = await send(member.token, { body: '😀'.repeat(2001) });
    expect(over.status).toBe(400);
    expect(((await over.json()) as { error: { details: unknown } }).error.details).toEqual({
      chat: 'body_too_long',
    });
    // The page size: 20 by default, `limit=1` and `limit=50` stand, anything beyond clamps.
    expect(myCasesQuerySchema.parse({}).limit).toBe(20);
    expect(myCasesQuerySchema.parse({ limit: '1' }).limit).toBe(1);
    expect(myCasesQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(myCasesQuerySchema.parse({ limit: '500' }).limit).toBe(50);
    expect(myCasesQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(myCasesQuerySchema.parse({ limit: 'abc' }).limit).toBe(20);
  });

  it('EP-045 adjacency: a plain message, the message that opened a case and the message that reopened a resolved one are mutually exclusive', async () => {
    const member = await throwawayMember('outcomes');
    const outcome = (result: SendResult) => [result.case?.opened, result.case?.reopened];
    const first = (await (await send(member.token, { body: 'Abrindo' })).json()) as SendResult;
    expect(outcome(first)).toEqual([true, false]);
    const plain = (await (await send(member.token, { body: 'Mais um' })).json()) as SendResult;
    expect(outcome(plain)).toEqual([false, false]);
    expect(plain.case?.state).toBe('open');
    await adminSql`
      update public.chat_conversations
         set state = 'resolved', resolved_at = now()
       where id = ${first.conversationId}::uuid`;
    const reopened = (await (await send(member.token, { body: 'Voltei' })).json()) as SendResult;
    expect(outcome(reopened)).toEqual([false, true]);
    expect(reopened.case).toMatchObject({ id: first.conversationId, state: 'open' });
  });

  it('EP-046 empty: a member with no case reads null, an empty list and the GETs write nothing', async () => {
    const { ids } = await caseKit();
    const member = await throwawayMember('no-case');
    const countAll = async () => {
      const [row] = await adminSql<{ conversations: number; participants: number }[]>`
        select (select count(*)::int from public.chat_conversations where tenant_id = ${ids.demo}::uuid) as conversations,
               (select count(*)::int from public.chat_participants where tenant_id = ${ids.demo}::uuid) as participants`;
      return row;
    };
    const before = await countAll();
    const thread = await request('/v1/chat/support', member.token);
    expect(await thread.json()).toEqual({
      conversation: null,
      messages: [],
      hasOlder: false,
      case: null,
      hasAnyCase: false,
    });
    const cases = await request('/v1/chat/support/cases', member.token);
    expect(await cases.json()).toEqual({ current: null, items: [], total: 0, nextCursor: null });
    expect(await countAll()).toEqual(before);
  });

  it('EP-049 precision: openedAt carries microseconds, numbers are plain integers and the cursor number is a string of digits', async () => {
    const { tokens } = await caseKit();
    const member = await throwawayMember('precision');
    const opened: SendResult[] = [];
    for (const body of ['Primeiro', 'Segundo']) {
      const result = (await (await send(member.token, { body })).json()) as SendResult;
      opened.push(result);
      await adminSql`
        update public.chat_conversations
           set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
         where id = ${result.conversationId}::uuid`;
    }
    await send(member.token, { body: 'Ativo' });
    const page = (await (
      await request('/v1/chat/support/cases?limit=1', member.token)
    ).json()) as MyCasesPage;
    expect(page.items).toHaveLength(1);
    const card = page.items[0];
    expect(card?.openedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(Number.isInteger(card?.number)).toBe(true);
    const decoded = JSON.parse(
      Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8'),
    ) as {
      n: unknown;
      id: string;
    };
    expect(typeof decoded.n).toBe('string');
    expect(decoded.n).toMatch(/^[1-9]\d*$/);
    expect(decoded.n).toBe(String(card?.number));
    expect(decoded.id).toBe(card?.id);
    // The staff lane never reads it (EP-043 flagged assumption: the matrix of this describe and `case member reads`
    // is the acceptance of CASE-14; a reviewer should confirm no edge category is missing).
    expect((await request('/v1/chat/support/cases', tokens.demoAdmin)).status).toBe(403);
  });
});

describe('case numbering', () => {
  it('two members opening in two committed transactions get consecutive numbers (EP-006)', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const first = await throwawayMember('number-a');
    const second = await throwawayMember('number-b');

    const a = await post('/v1/chat/support/messages', first.token, { body: 'Primeiro' });
    const b = await post('/v1/chat/support/messages', second.token, { body: 'Segundo' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const [one, two] = [(await a.json()) as SendResult, (await b.json()) as SendResult];

    const rows = await adminSql<{ id: string; case_number: number }[]>`
      select id::text as id, case_number
        from public.chat_conversations
       where id in (${one.conversationId}::uuid, ${two.conversationId}::uuid)`;
    const numberOf = (id: string) => rows.find((r) => r.id === id)?.case_number;
    expect(numberOf(one.conversationId)).toBe(base + 1);
    expect(numberOf(two.conversationId)).toBe(base + 2);
  });
});

describe('case activation', () => {
  it('after a case is closed the next member message opens the next numbered case', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const member = await throwawayMember('activation');

    const first = await post('/v1/chat/support/messages', member.token, {
      body: 'Primeiro chamado',
    });
    expect(first.status).toBe(201);
    const one = (await first.json()) as SendResult;

    // The admin lane closes it (the staff action arrives with plan 05; this is the same row change).
    await adminSql`
      update public.chat_conversations
         set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
       where id = ${one.conversationId}::uuid`;

    const second = await post('/v1/chat/support/messages', member.token, { body: 'Outro assunto' });
    expect(second.status).toBe(201);
    const two = (await second.json()) as SendResult;
    expect(two.conversationId).not.toBe(one.conversationId);
    expect(two.message.seq).toBe(1);

    const rows = await adminSql<{ id: string; case_number: number; state: string }[]>`
      select id::text as id, case_number, state
        from public.chat_conversations
       where tenant_id = ${ids.demo}::uuid and created_by_user_id = ${member.id}::uuid
       order by case_number`;
    expect(rows.map((r) => [r.id, r.case_number, r.state])).toEqual([
      [one.conversationId, base + 1, 'closed'],
      [two.conversationId, base + 2, 'open'],
    ]);
    const [opened] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_case_events
       where conversation_id in (${one.conversationId}::uuid, ${two.conversationId}::uuid)
         and kind = 'opened'`;
    expect(opened?.n).toBe(2);

    const thread = await request('/v1/chat/support', member.token);
    expect(thread.status).toBe(200);
    expect(((await thread.json()) as SupportThread).conversation?.id).toBe(two.conversationId);
  });

  it('the member send repeats the index predicate to the letter (EP-012, EP-013)', async () => {
    const [index] = await adminSql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
       where schemaname = 'public' and indexname = 'chat_conversations_one_active_case_per_member'`;
    const listed = /ARRAY\[([^\]]+)\]/.exec(index?.indexdef ?? '')?.[1] ?? '';
    const states = [...listed.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    // Exact lowercase literals, in the contract's order: no folding, no trimming (EP-012).
    expect(states).toEqual([...CASE_ACTIVE_STATES]);
    expect(index?.indexdef).toContain("kind = 'support'");

    // The service spells the list ONCE, from the same constant, and nowhere as a second literal (EP-013).
    const source = readFileSync(
      new URL('../../../../packages/modules/chat/server/service.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/where kind = 'support' and state in \(\$\{ACTIVE_CASE_STATES\}\)/);
    expect(source).toContain('CASE_ACTIVE_STATES.map');
    // The whole active list is never typed out a second time. The inbox's "open" tab (plan 07) spells
    // the two-state list `('open','in_progress')` on purpose, to repeat the predicate of
    // `chat_conversations_open_inbox_idx`; that is a different list and is allowed.
    expect(source).not.toMatch(/'open'\s*,\s*'in_progress'\s*,\s*'resolved'/);
  });

  it('the same body sent twice writes two messages in ONE case: messages are not deduplicated (EP-014)', async () => {
    const { ids } = await caseKit();
    const member = await throwawayMember('twice');
    const first = await post('/v1/chat/support/messages', member.token, { body: 'Igual' });
    const second = await post('/v1/chat/support/messages', member.token, { body: 'Igual' });
    expect([first.status, second.status]).toEqual([201, 201]);
    const [a, b] = [(await first.json()) as SendResult, (await second.json()) as SendResult];
    expect(b.conversationId).toBe(a.conversationId);
    expect([a.message.seq, b.message.seq]).toEqual([1, 2]);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_conversations
       where tenant_id = ${ids.demo}::uuid and kind = 'support' and created_by_user_id = ${member.id}::uuid`;
    expect(count?.n).toBe(1);
  });

  it('no support conversation has a null state after the activation', async () => {
    const [nulls] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_conversations
       where kind = 'support' and state is null`;
    expect(nulls?.n).toBe(0);
    const [seed] = await adminSql<{ state: string | null; case_number: number | null }[]>`
      select state, case_number from public.chat_conversations
       where id = ${SEED_THREAD.id}::uuid`;
    expect(seed?.state).not.toBeNull();
    expect(seed?.case_number).not.toBeNull();
  });
});

describe('case transitions', () => {
  /** A throwaway member with a first message sent: their case, still open. */
  async function openedCase(label: string) {
    const member = await throwawayMember(label);
    const sent = await post('/v1/chat/support/messages', member.token, {
      body: 'Preciso de ajuda',
    });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    return { member, conversationId: result.conversationId };
  }

  const stateOf = async (conversationId: string) => {
    const [row] = await adminSql<
      { state: string; owner: string | null; resolved: boolean; closed: boolean }[]
    >`
      select state, owner_user_id::text as owner,
             resolved_at is not null as resolved, closed_at is not null as closed
        from public.chat_conversations where id = ${conversationId}::uuid`;
    return row;
  };
  const eventsOf = (conversationId: string) => adminSql<
    { kind: string; actor: string | null; message_id: string | null }[]
  >`
      select kind, actor_user_id::text as actor, message_id::text as message_id
        from public.chat_case_events
       where conversation_id = ${conversationId}::uuid and kind <> 'opened'
       order by created_at, id`;
  const resolveAsAdmin = (conversationId: string, owner: string | null) => adminSql`
      update public.chat_conversations
         set state = 'resolved', resolved_at = now(), owner_user_id = ${owner}::uuid
       where id = ${conversationId}::uuid`;

  it('a member reply on a resolved case reopens it, a body of one emoji is enough (D-805, EP-022)', async () => {
    const { ids } = await caseKit();
    const { member, conversationId } = await openedCase('reopen');
    await resolveAsAdmin(conversationId, ids.demoSupport);

    const sent = await post('/v1/chat/support/messages', member.token, { body: '😀' });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    expect(result.conversationId).toBe(conversationId);

    expect(await stateOf(conversationId)).toEqual({
      state: 'open',
      owner: null,
      resolved: false,
      closed: false,
    });
    expect(await eventsOf(conversationId)).toEqual([
      { kind: 'reopened', actor: member.id, message_id: result.message.id },
    ]);
  });

  it('a staff reply on an unowned open case takes it for the author (D-806)', async () => {
    const { ids, tokens } = await caseKit();
    const { conversationId } = await openedCase('take');

    const reply = await post(
      `/v1/chat/conversations/${conversationId}/messages`,
      tokens.demoSupport,
      {
        body: 'Vou cuidar disso',
      },
    );
    expect(reply.status).toBe(201);
    const result = (await reply.json()) as SendResult;

    expect(await stateOf(conversationId)).toEqual({
      state: 'in_progress',
      owner: ids.demoSupport,
      resolved: false,
      closed: false,
    });
    expect(await eventsOf(conversationId)).toEqual([
      { kind: 'taken', actor: ids.demoSupport, message_id: result.message.id },
    ]);

    // A second reply by someone else changes nothing (any staff member may answer, whoever owns it).
    const other = await post(
      `/v1/chat/conversations/${conversationId}/messages`,
      tokens.demoAdmin,
      {
        body: 'Complemento da administração',
      },
    );
    expect(other.status).toBe(201);
    expect((await stateOf(conversationId))?.owner).toBe(ids.demoSupport);
    expect(await eventsOf(conversationId)).toHaveLength(1);
  });

  it('a whitespace-only or oversized body on a resolved case is refused before any transition (EP-021)', async () => {
    const { ids } = await caseKit();
    const { member, conversationId } = await openedCase('refusal');
    await resolveAsAdmin(conversationId, ids.demoSupport);

    const blank = await post('/v1/chat/support/messages', member.token, { body: '  \n\t ' });
    expect(blank.status).toBe(400);
    expect(((await blank.json()) as { error: { details: unknown } }).error.details).toEqual({
      chat: 'body_required',
    });
    const long = await post('/v1/chat/support/messages', member.token, {
      body: '😀'.repeat(2001),
    });
    expect(long.status).toBe(400);

    expect((await stateOf(conversationId))?.state).toBe('resolved');
    expect(await eventsOf(conversationId)).toEqual([]);
  });

  it('a staff reply on a closed case is refused and writes nothing (D-845, T-12.4-06)', async () => {
    const { tokens } = await caseKit();
    const { conversationId } = await openedCase('closed');
    await adminSql`
      update public.chat_conversations
         set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
       where id = ${conversationId}::uuid`;
    const [before] = await adminSql<{ n: number; last_seq: number }[]>`
      select (select count(*)::int from public.chat_messages where conversation_id = c.id) as n,
             c.last_seq::int as last_seq
        from public.chat_conversations c where c.id = ${conversationId}::uuid`;

    const reply = await post(
      `/v1/chat/conversations/${conversationId}/messages`,
      tokens.demoSupport,
      {
        body: 'Resposta tardia',
      },
    );
    // The route maps CS004 in plan 08; here it is only required to be a refusal that wrote nothing.
    expect(reply.status).toBeGreaterThanOrEqual(400);

    const [after] = await adminSql<{ n: number; last_seq: number }[]>`
      select (select count(*)::int from public.chat_messages where conversation_id = c.id) as n,
             c.last_seq::int as last_seq
        from public.chat_conversations c where c.id = ${conversationId}::uuid`;
    expect(after).toEqual(before);
    expect((await stateOf(conversationId))?.state).toBe('closed');
    expect(await eventsOf(conversationId)).toEqual([]);
  });
});

describe('case concurrency', () => {
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, index) => from + index);

  const sendTwenty = (token: string) =>
    Promise.all(
      range(1, 20).map((n) => post('/v1/chat/support/messages', token, { body: `Mensagem ${n}` })),
    );

  const casesOf = (memberId: string, tenantId: string) =>
    adminSql<{ id: string; case_number: number; state: string; last_seq: number }[]>`
      select id::text as id, case_number, state, last_seq::int as last_seq
        from public.chat_conversations
       where tenant_id = ${tenantId}::uuid and kind = 'support'
         and created_by_user_id = ${memberId}::uuid
       order by case_number`;

  it('20 simultaneous first messages make ONE case with seqs 1..20, and after it is closed 20 more make exactly ONE next case (D-802, EP-015)', async () => {
    const { ids } = await caseKit();
    const member = await throwawayMember('twenty');

    const first = await sendTwenty(member.token);
    expect(first.map((res) => res.status)).toEqual(Array(20).fill(201));
    const firstBodies = (await Promise.all(first.map((res) => res.json()))) as SendResult[];
    const firstCases = await casesOf(member.id, ids.demo);
    expect(firstCases).toHaveLength(1);
    const one = firstCases[0];
    expect(new Set(firstBodies.map((body) => body.conversationId))).toEqual(new Set([one?.id]));
    expect(firstBodies.map((body) => body.message.seq).sort((a, b) => a - b)).toEqual(range(1, 20));
    expect(one?.last_seq).toBe(20);

    await adminSql`
      update public.chat_conversations
         set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
       where id = ${one?.id ?? ''}::uuid`;

    const second = await sendTwenty(member.token);
    expect(second.map((res) => res.status)).toEqual(Array(20).fill(201));
    const secondBodies = (await Promise.all(second.map((res) => res.json()))) as SendResult[];
    const cases = await casesOf(member.id, ids.demo);
    expect(cases).toHaveLength(2);
    const next = cases[1];
    // One higher than the FIRST case's number, never a literal: the counter is never reset.
    expect(next?.case_number).toBe((one?.case_number ?? 0) + 1);
    expect(new Set(secondBodies.map((body) => body.conversationId))).toEqual(new Set([next?.id]));
    expect(secondBodies.map((body) => body.message.seq).sort((a, b) => a - b)).toEqual(
      range(1, 20),
    );
    expect(cases.map((c) => c.state)).toEqual(['closed', 'open']);
  });

  it('20 different members of one tenant opening together get 20 distinct consecutive numbers (EP-009)', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const members: { id: string; token: string }[] = [];
    for (const n of range(1, 20)) members.push(await throwawayMember(`fan-${n}`));

    const results = await Promise.all(
      members.map((member) =>
        post('/v1/chat/support/messages', member.token, { body: 'Abrindo um chamado' }),
      ),
    );
    expect(results.map((res) => res.status)).toEqual(Array(20).fill(201));

    const rows = await adminSql<{ case_number: number }[]>`
      select case_number from public.chat_conversations
       where tenant_id = ${ids.demo}::uuid and kind = 'support'
         and created_by_user_id in ${adminSql(members.map((member) => member.id))}
       order by case_number`;
    expect(rows.map((row) => row.case_number)).toEqual(range(base + 1, base + 20));
  });

  it('a member message racing a staff close lands in a NEW case and never in the closed one (D-801, T-12.4-06)', async () => {
    const { ids } = await caseKit();
    const member = await throwawayMember('race');
    const sent = await post('/v1/chat/support/messages', member.token, { body: 'Primeira' });
    expect(sent.status).toBe(201);
    const one = (await sent.json()) as SendResult;

    // A SECOND connection plays the staff close: it takes the conversation row lock and holds it.
    const closer = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
      prepare: false,
      max: 1,
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const closing = closer.begin(async (tx) => {
      await tx`
        update public.chat_conversations
           set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
         where id = ${one.conversationId}::uuid`;
      locked();
      await held;
    });

    try {
      await lockTaken;
      const racing = post('/v1/chat/support/messages', member.token, {
        body: 'Chegou na hora do fechamento',
      });
      // No sleep: poll the lock table until the member's insert is queued behind the close, then let it commit.
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const [waiting] = await adminSql<{ n: number }[]>`
          select count(*)::int as n from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock'`;
        if ((waiting?.n ?? 0) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release();
      await closing;
      const answer = await racing;
      expect(answer.status).toBe(201);
      const two = (await answer.json()) as SendResult;
      expect(two.conversationId).not.toBe(one.conversationId);
      expect(two.message.seq).toBe(1);

      const cases = await casesOf(member.id, ids.demo);
      expect(cases.map((c) => [c.id, c.state, c.last_seq])).toEqual([
        [one.conversationId, 'closed', 1],
        [two.conversationId, 'open', 1],
      ]);
      expect(cases[1]?.case_number).toBe((cases[0]?.case_number ?? 0) + 1);
    } finally {
      release();
      await closing.catch(() => undefined);
      await closer.end();
    }
  });
});
