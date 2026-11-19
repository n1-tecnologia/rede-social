import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseKit, removeThrowaways, request } from './chat-case-fixtures';
import {
  blockUser,
  countersOf,
  type DirectMember,
  directDetail,
  directList,
  directMember,
  directRowsOf,
  directWith,
  readMessages,
  removeDirectRows,
  resetDirectLimiters,
  sendDirect,
  setModule,
  unblockUser,
  withDirectModules,
} from './direct-fixtures';
import { adminSql } from './setup';

/**
 * Phase 11 plan 10 (CHAT-07; D-721, D-722, D-723; T-11-03, T-11-25): the composer as one finished enum, the neutral
 * refusal and the evidence the blocker keeps, through the API against the live local stack.
 *
 * FIXTURES. Throwaway members of the demo tenant, `social` and `chat` switched on for the span, rows swept before the
 * users. Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type Other = {
  membershipId: string | null;
  displayName: string | null;
  avatarAssetId: string | null;
  removed: boolean;
};
type Detail = {
  conversationId: string;
  other: Other;
  composer: string;
  canBlock: boolean;
  lastSeq: number;
  lastReadSeq: number;
};
type SendBody = { conversationId: string; message: { seq: number } };

let restoreModules: () => Promise<void> = async () => {};

beforeAll(async () => {
  await caseKit();
  restoreModules = await withDirectModules('demo');
  resetDirectLimiters();
});

afterAll(async () => {
  await removeDirectRows();
  await removeThrowaways();
  await restoreModules();
  resetDirectLimiters();
});

const adminMember = async (action: 'block' | 'unblock', membershipId: string) => {
  const { tokens } = await caseKit();
  return request(`/v1/admin/members/${membershipId}/${action}`, tokens.demoAdmin, {
    method: 'POST',
    body: JSON.stringify({}),
  });
};

async function detailOf(from: DirectMember, conversationId: string): Promise<Detail> {
  const res = await directDetail(from, conversationId);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return (await res.json()) as Detail;
}

async function pairOf(label: string): Promise<{
  a: DirectMember;
  b: DirectMember;
  conversationId: string;
}> {
  const a = await directMember(`${label}a`, { displayName: `Alma ${label}` });
  const b = await directMember(`${label}b`, { displayName: `Bruno ${label}` });
  const sent = await sendDirect(a, b.membershipId, 'Primeira');
  expect(sent.status).toBe(201);
  const body = (await sent.json()) as SendBody;
  expect((await sendDirect(b, a.membershipId, 'Segunda')).status).toBe(201);
  return { a, b, conversationId: body.conversationId };
}

async function bodiesOf(from: DirectMember, conversationId: string): Promise<string[]> {
  const res = await readMessages(from, conversationId);
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: { body: string }[] }).items.map((item) => item.body);
}

/** The text of an answer with the two block-derived values taken out: the composer word and `canBlock`. */
const withoutBlockDerived = (value: unknown): string =>
  JSON.stringify(value, (key, inner) =>
    key === 'composer' || key === 'canBlock' ? undefined : inner,
  );

const BLOCK_WORDS = /block|bloque|banid|motivo|reason|denunci/i;

describe('composer states', () => {
  it('1. open for a normal pair on both sides, with the other member, the positions and `canBlock`', async () => {
    const { a, b, conversationId } = await pairOf('c1');
    const forA = await detailOf(a, conversationId);
    const forB = await detailOf(b, conversationId);
    expect(Object.keys(forA).sort()).toEqual([
      'canBlock',
      'composer',
      'conversationId',
      'lastReadSeq',
      'lastSeq',
      'other',
    ]);
    expect(forA).toEqual({
      conversationId,
      other: {
        membershipId: b.membershipId,
        displayName: b.displayName,
        avatarAssetId: null,
        removed: false,
      },
      composer: 'open',
      canBlock: true,
      lastSeq: 2,
      lastReadSeq: 1,
    });
    expect(forB).toMatchObject({
      other: { membershipId: a.membershipId, displayName: a.displayName },
      composer: 'open',
      canBlock: true,
      lastSeq: 2,
      lastReadSeq: 2,
    });
  });

  it('2. after A blocks B: B reads `closed`, A reads `blocker`, both keep the whole history and the same key sets', async () => {
    const { a, b, conversationId } = await pairOf('c2');
    const open = await detailOf(a, conversationId);
    expect((await blockUser(a.token, b.userId)).ok).toBe(true);

    const forB = await detailOf(b, conversationId);
    const forA = await detailOf(a, conversationId);
    expect(forB.composer).toBe('closed');
    expect(forB.canBlock).toBe(true);
    expect(forA.composer).toBe('blocker');
    expect(forA.canBlock).toBe(false);
    // The only block-derived facts are the composer word and `canBlock`: the key sets are the same on both sides and equal
    // to the key set of an open pair, and so are the keys of `other`.
    expect(Object.keys(forB).sort()).toEqual(Object.keys(open).sort());
    expect(Object.keys(forA).sort()).toEqual(Object.keys(open).sort());
    expect(Object.keys(forB.other).sort()).toEqual(Object.keys(open.other).sort());
    // D-723: both sides read the whole history and both still list the row.
    expect(await bodiesOf(a, conversationId)).toEqual(['Primeira', 'Segunda']);
    expect(await bodiesOf(b, conversationId)).toEqual(['Primeira', 'Segunda']);
    for (const side of [a, b]) {
      const list = (await (await directList(side)).json()) as {
        rows: { conversationId: string }[];
      };
      expect(list.rows.map((row) => row.conversationId)).toContain(conversationId);
    }
    // The `with` read agrees with the detail on the composer word.
    expect(
      ((await (await directWith(b, a.membershipId)).json()) as { composer: string }).composer,
    ).toBe('closed');

    // Unblocking returns `open` to both and nothing else changes.
    expect((await unblockUser(a.token, b.userId)).ok).toBe(true);
    const backA = await detailOf(a, conversationId);
    const backB = await detailOf(b, conversationId);
    expect(backA).toEqual(open);
    expect(backB.composer).toBe('open');
    expect(backB.canBlock).toBe(true);
  });

  it('3. a mutual block reads `blocker` for both, and an anonymised member is `removed`, which wins over `blocker`', async () => {
    const { a, b, conversationId } = await pairOf('c3');
    expect((await blockUser(a.token, b.userId)).ok).toBe(true);
    expect((await blockUser(b.token, a.userId)).ok).toBe(true);
    expect((await detailOf(a, conversationId)).composer).toBe('blocker');
    expect((await detailOf(b, conversationId)).composer).toBe('blocker');

    await adminSql`
      update public.memberships
         set deleted_at = now(), anonymised_at = now(),
             deletion_requested_at = now() - interval '31 days', deletion_due_at = now() - interval '1 day'
       where id = ${b.membershipId}::uuid`;
    const forA = await detailOf(a, conversationId);
    expect(forA.composer).toBe('removed');
    expect(forA.canBlock).toBe(false);
    expect(forA.other).toEqual({
      membershipId: null,
      displayName: null,
      avatarAssetId: null,
      removed: true,
    });
    // The history is read-only evidence and stays whole.
    expect(await bodiesOf(a, conversationId)).toEqual(['Primeira', 'Segunda']);
  });

  it('4. D-721: the administrator blocking B hides the conversation from A in the detail and the messages (bare 404), and unblocking returns both', async () => {
    const { a, b, conversationId } = await pairOf('c4');
    const unknown = await directDetail(a, crypto.randomUUID());
    expect(unknown.status).toBe(404);
    const unknownText = JSON.stringify(
      Object.fromEntries(
        Object.entries(((await unknown.json()) as Envelope).error).filter(
          ([key]) => key !== 'requestId',
        ),
      ),
    );

    expect((await adminMember('block', b.membershipId)).status).toBe(200);
    try {
      const detail = await directDetail(a, conversationId);
      expect(detail.status).toBe(404);
      const error = ((await detail.json()) as Envelope).error as Record<string, unknown>;
      expect(Object.hasOwn(error, 'details')).toBe(false);
      const { requestId: _ignored, ...rest } = error;
      expect(JSON.stringify(rest)).toBe(unknownText);
      expect((await readMessages(a, conversationId)).status).toBe(404);
    } finally {
      expect((await adminMember('unblock', b.membershipId)).status).toBe(200);
    }
    expect((await detailOf(a, conversationId)).composer).toBe('open');
    expect(await bodiesOf(a, conversationId)).toEqual(['Primeira', 'Segunda']);
  });

  it('5. the detail refuses a support case, a malformed id and a stranger with the bare 404 or a 400', async () => {
    const { a, conversationId } = await pairOf('c5');
    const stranger = await directMember('c5s');
    expect((await directDetail(stranger, conversationId)).status).toBe(404);
    expect((await directDetail(a, 'not-a-uuid')).status).toBe(400);
    const support = await request('/v1/chat/support/messages', a.token, {
      method: 'POST',
      body: JSON.stringify({ body: 'Preciso de ajuda' }),
    });
    expect(support.status).toBe(201);
    const supportId = ((await support.json()) as { conversationId: string }).conversationId;
    expect((await directDetail(a, supportId)).status).toBe(404);
  });
});

describe('neutral refusal', () => {
  it('6. B’s send into a closed pair is 409 `direct_closed`, stored nowhere, with no name and no block word; A’s own send while blocking is the same answer; the unblock reopens', async () => {
    const { a, b, conversationId } = await pairOf('n1');
    expect((await blockUser(a.token, b.userId)).ok).toBe(true);
    const before = (await directRowsOf(a.userId, b.userId))[0]?.messages;

    const fromB = await sendDirect(b, a.membershipId, 'Posso falar?');
    const fromA = await sendDirect(a, b.membershipId, 'Eu bloqueei, mas escrevo');
    for (const [label, res] of [
      ['blocked member', fromB],
      ['blocker', fromA],
    ] as const) {
      expect(res.status, label).toBe(409);
    }
    const textB = await fromB.text();
    const textA = await fromA.text();
    for (const text of [textB, textA]) {
      const body = JSON.parse(text) as Envelope;
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.details).toEqual({ chat: 'direct_closed' });
      expect(text).not.toContain(a.displayName);
      expect(text).not.toContain(b.displayName);
      expect(text).not.toContain(a.userId);
      expect(text).not.toContain(b.userId);
      expect(text).not.toMatch(BLOCK_WORDS);
    }
    const strip = (text: string) => {
      const { requestId: _ignored, ...error } = (JSON.parse(text) as Envelope).error as Record<
        string,
        unknown
      >;
      return JSON.stringify(error);
    };
    expect(strip(textB)).toBe(strip(textA));
    // Nothing was stored by either refusal.
    expect((await directRowsOf(a.userId, b.userId))[0]?.messages).toBe(before);
    expect(await bodiesOf(a, conversationId)).toEqual(['Primeira', 'Segunda']);

    // Unblocked: `open` again for both, and the next send works.
    expect((await unblockUser(a.token, b.userId)).ok).toBe(true);
    expect((await detailOf(b, conversationId)).composer).toBe('open');
    const next = await sendDirect(b, a.membershipId, 'Agora sim');
    expect(next.status).toBe(201);
    expect(((await next.json()) as SendBody).message.seq).toBe(3);
  });
});

describe('block does not leak', () => {
  it('7. T-11-03: the serialised list, detail and `with` answers of both sides carry no block word and no foreign name, and the sides differ only in the composer word and `canBlock`', async () => {
    const { a, b, conversationId } = await pairOf('k1');
    expect((await blockUser(a.token, b.userId)).ok).toBe(true);

    const answers = new Map<string, { a: unknown; b: unknown }>();
    answers.set('list', {
      a: await (await directList(a)).json(),
      b: await (await directList(b)).json(),
    });
    answers.set('detail', {
      a: await (await directDetail(a, conversationId)).json(),
      b: await (await directDetail(b, conversationId)).json(),
    });
    answers.set('with', {
      a: await (await directWith(a, b.membershipId)).json(),
      b: await (await directWith(b, a.membershipId)).json(),
    });
    for (const [label, sides] of answers) {
      for (const [side, other, viewer] of [
        ['a', b, a],
        ['b', a, b],
      ] as const) {
        const answer = sides[side];
        const text = withoutBlockDerived(answer);
        expect(text, `${label} ${side}`).not.toMatch(BLOCK_WORDS);
        // The other member's name is the only member name on the screen; the viewer's own never comes back.
        expect(text, `${label} ${side}`).toContain(other.displayName);
        expect(text, `${label} ${side}`).not.toContain(viewer.displayName);
        expect(text, `${label} ${side}`).not.toContain(viewer.userId);
        expect(text, `${label} ${side}`).not.toContain(other.userId);
      }
      // Same key sets on both sides of the block.
      expect(Object.keys(sides.a as object).sort(), label).toEqual(
        Object.keys(sides.b as object).sort(),
      );
    }
    // The detail and `with` differ between the two sides in the composer word (and `canBlock` on the detail), and the
    // key sets of the rest are identical (positions apart, which are the viewer's own).
    const detail = answers.get('detail') as { a: Detail; b: Detail };
    const withAnswers = answers.get('with') as {
      a: { composer: string };
      b: { composer: string };
    };
    expect([detail.a.composer, detail.b.composer]).toEqual(['blocker', 'closed']);
    expect([withAnswers.a.composer, withAnswers.b.composer]).toEqual(['blocker', 'closed']);
    expect(Object.keys(detail.a.other).sort()).toEqual(Object.keys(detail.b.other).sort());
    // The list row of a blocked pair is the row of an open one: no composer, no flag.
    const list = answers.get('list') as {
      a: { rows: Record<string, unknown>[] };
      b: { rows: Record<string, unknown>[] };
    };
    expect(Object.keys(list.a.rows[0] ?? {}).sort()).toEqual(
      Object.keys(list.b.rows[0] ?? {}).sort(),
    );
    expect(Object.keys(list.a.rows[0] ?? {})).not.toContain('composer');
    // The list of a viewer with no conversation still answers the same shape.
    const lonely = await directMember('k1l');
    const empty = (await (await directList(lonely)).json()) as Record<string, unknown>;
    expect(empty.rows).toEqual([]);
    expect(empty.support).toEqual({ lastPreview: null, unread: false });
    expect(empty.nextCursor).toBeNull();
  });
});

/** The three reads that must agree in every state: the bubble, the Conversas list and the message history. */
async function threeReads(
  viewer: DirectMember,
  conversationId: string,
): Promise<{ counter: number; listed: boolean; messages: number }> {
  const counter = (await countersOf(viewer)).unreadConversations;
  const listRes = await directList(viewer);
  const listed =
    listRes.status === 200 &&
    ((await listRes.json()) as { rows: { conversationId: string }[] }).rows.some(
      (row) => row.conversationId === conversationId,
    );
  return { counter, listed, messages: (await readMessages(viewer, conversationId)).status };
}

describe('hidden parity', () => {
  it('8. D-721, T-11-25: the administrator blocking B drops the counter, the row and the history together for A, and unblocking restores all three', async () => {
    const a = await directMember('h1a');
    const b = await directMember('h1b');
    const sent = (await (await sendDirect(b, a.membershipId, 'Olá, A')).json()) as SendBody;

    // Visible: the bubble counts the conversation, the list shows it, the history reads.
    expect(await threeReads(a, sent.conversationId)).toEqual({
      counter: 1,
      listed: true,
      messages: 200,
    });

    expect((await adminMember('block', b.membershipId)).status).toBe(200);
    try {
      expect(await threeReads(a, sent.conversationId)).toEqual({
        counter: 0,
        listed: false,
        messages: 404,
      });
      expect((await directDetail(a, sent.conversationId)).status).toBe(404);
    } finally {
      expect((await adminMember('unblock', b.membershipId)).status).toBe(200);
    }
    expect(await threeReads(a, sent.conversationId)).toEqual({
      counter: 1,
      listed: true,
      messages: 200,
    });
    expect((await detailOf(a, sent.conversationId)).composer).toBe('open');
  });

  it('9. a member block never hides the conversation: the counter, the row and the history stay for both sides, and the blocked member’s unread keeps counting', async () => {
    const a = await directMember('h2a');
    const b = await directMember('h2b');
    const sent = (await (await sendDirect(a, b.membershipId, 'Antes')).json()) as SendBody;
    expect((await blockUser(b.token, a.userId)).ok).toBe(true);
    // B blocked A: B still has the unread of what A wrote before; A still has the history and the row.
    expect(await threeReads(b, sent.conversationId)).toEqual({
      counter: 1,
      listed: true,
      messages: 200,
    });
    expect(await threeReads(a, sent.conversationId)).toEqual({
      counter: 0,
      listed: true,
      messages: 200,
    });
  });

  it('10. D-483: turning `social` off hides every direct read for both participants, and turning it on returns everything unchanged', async () => {
    const a = await directMember('h3a');
    const b = await directMember('h3b');
    const sent = (await (await sendDirect(a, b.membershipId, 'Oi, B')).json()) as SendBody;
    const visible = { counter: 1, listed: true, messages: 200 };
    expect(await threeReads(b, sent.conversationId)).toEqual(visible);

    const restoreSocial = await setModule('demo', 'social', false);
    try {
      for (const viewer of [a, b]) {
        const list = await directList(viewer);
        expect(list.status).toBe(404);
        expect(((await list.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
        const detail = await directDetail(viewer, sent.conversationId);
        expect(detail.status).toBe(404);
        expect(((await detail.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
        // The generic history read answers the bare 404 of an unreadable conversation, never a module word.
        const messages = await readMessages(viewer, sent.conversationId);
        expect(messages.status).toBe(404);
        expect(((await messages.json()) as Envelope).error.code).toBe('NOT_FOUND');
      }
      // The bubble falls back to the support dot: no direct permission, so no direct count.
      expect(await countersOf(b)).toMatchObject({
        unreadConversations: 0,
        conversationsBadge: 'dot',
      });
    } finally {
      await restoreSocial();
    }
    expect(await threeReads(b, sent.conversationId)).toEqual(visible);
    expect(await countersOf(b)).toMatchObject({ conversationsBadge: 'count' });
    expect((await detailOf(a, sent.conversationId)).composer).toBe('open');
  });

  it('11. D-725: the shipped surfaces carry no direct filter: the support thread and the support counter are those of a member with no direct conversation', async () => {
    const m = await directMember('h4m');
    const before = await countersOf(m);
    expect(before).toMatchObject({ unreadConversations: 0, conversationsBadge: 'count' });
    const thread = (await (await request('/v1/chat/support', m.token)).json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(thread).sort()).toEqual([
      'case',
      'conversation',
      'hasAnyCase',
      'hasOlder',
      'messages',
    ]);
    expect(thread.conversation).toBeNull();
  });
});

/**
 * Phase 11 plan 12 (CHAT-07; D-722, T-11-04): a send and a block serialise on the conversation row lock, proved with TWO
 * real connections and no wall-clock timing.
 *
 * The holder connection plays an in-flight send: a transaction that inserts a message of the pair (so the send guard took
 * the conversation row lock) and does not commit. The block goes through the API on its own pooled connection. The barrier
 * is `pg_blocking_pids`: the test proceeds only once Postgres itself says the block's backend waits on the holder's pid, so
 * a slow machine changes nothing. The whole describe is bounded by a timeout: a deadlock fails it, it never hangs.
 */
describe('send versus block', () => {
  const HOLDER_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

  /**
   * Resolves once `count` backends wait, directly or through one another, on `holderPid` (a lock wait the database
   * reports, not a sleep). A row lock queues the second waiter behind the first waiter's tuple lock, so the chain is
   * followed with a recursive walk of `pg_blocking_pids`.
   */
  async function waitUntilBlocked(holderPid: number, count: number): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const [row] = await adminSql<{ n: number }[]>`
        with recursive waiting(pid) as (
          select a.pid
            from pg_stat_activity a
           where a.datname = current_database()
             and ${holderPid}::int = any(pg_blocking_pids(a.pid))
          union
          select a.pid
            from pg_stat_activity a
            join waiting w on w.pid = any(pg_blocking_pids(a.pid))
           where a.datname = current_database()
        )
        select count(*)::int as n from waiting`;
      if ((row?.n ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`no backend ever waited behind ${holderPid}`);
  }

  /** An open transaction on its own connection that holds the conversation row lock until `release()`. */
  async function holdLockWith(work: (tx: postgres.TransactionSql) => Promise<void>) {
    const connection = postgres(HOLDER_URL, { prepare: false, max: 1 });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let taken: (pid: number) => void = () => undefined;
    const lockTaken = new Promise<number>((resolve) => {
      taken = resolve;
    });
    const running = connection.begin(async (tx) => {
      await work(tx);
      const [pid] = await tx<{ pid: number }[]>`select pg_backend_pid()::int as pid`;
      taken(pid?.pid ?? 0);
      await held;
    });
    running.catch(() => undefined);
    const holderPid = await lockTaken;
    // `work` ran inside the open transaction, so its row lock is held by this very backend.
    expect(holderPid).toBeGreaterThan(0);
    return {
      holderPid,
      commit: async () => {
        release();
        await running;
        await connection.end();
      },
      abort: async () => {
        release();
        await running.catch(() => undefined);
        await connection.end();
      },
    };
  }

  const followBoth = async (tenantId: string, a: DirectMember, b: DirectMember) => {
    await adminSql`
      insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
      values (${tenantId}::uuid, ${a.userId}::uuid, ${b.userId}::uuid),
             (${tenantId}::uuid, ${b.userId}::uuid, ${a.userId}::uuid)
      on conflict do nothing`;
  };
  const followsOf = async (a: DirectMember, b: DirectMember) => {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.social_follows
       where (follower_user_id = ${a.userId}::uuid and followee_user_id = ${b.userId}::uuid)
          or (follower_user_id = ${b.userId}::uuid and followee_user_id = ${a.userId}::uuid)`;
    return row?.n ?? 0;
  };
  const messagesOf = async (conversationId: string) => {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_messages where conversation_id = ${conversationId}::uuid`;
    return row?.n ?? 0;
  };
  const blocksOf = async (a: DirectMember, b: DirectMember) => {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.member_blocks
       where blocker_user_id = ${a.userId}::uuid and blocked_user_id = ${b.userId}::uuid`;
    return row?.n ?? 0;
  };

  it('12. CHAT-07, T-11-04: a send in flight holds the lock, the block WAITS for it, then applies; the next send of either side is `direct_closed`', async () => {
    const { ids } = await caseKit();
    const { a, b, conversationId } = await pairOf('sb1');
    await followBoth(ids.demo, a, b);
    expect(await messagesOf(conversationId)).toBe(2);

    // The in-flight send: a message of A in the pair, inserted and NOT committed.
    const holder = await holdLockWith(async (tx) => {
      await tx`
        insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
        values (${ids.demo}::uuid, ${conversationId}::uuid, ${a.userId}::uuid, 'member', 'Em voo')`;
    });
    try {
      let answeredAt = 0;
      const blocking = blockUser(a.token, b.userId).then((res) => {
        answeredAt = performance.now();
        return res;
      });
      // Postgres itself says the block's backend waits behind the holder; nothing is answered yet.
      await waitUntilBlocked(holder.holderPid, 1);
      expect(answeredAt).toBe(0);
      expect(await blocksOf(a, b)).toBe(0);
      expect(await followsOf(a, b)).toBe(2);

      const committedAt = performance.now();
      await holder.commit();
      const res = await blocking;
      expect(res.status).toBeLessThan(300);
      // The block answered only AFTER the held transaction committed.
      expect(answeredAt).toBeGreaterThanOrEqual(committedAt);
    } finally {
      await holder.abort();
    }

    // The in-flight message was accepted, the block exists, both follow rows are gone.
    expect(await messagesOf(conversationId)).toBe(3);
    expect(await blocksOf(a, b)).toBe(1);
    expect(await followsOf(a, b)).toBe(0);

    // The NEXT send of either side meets the block: one neutral word, nothing stored.
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const refused = await sendDirect(from, to.membershipId, 'Depois do bloqueio');
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as Envelope).error.details).toEqual({
        chat: 'direct_closed',
      });
    }
    expect(await messagesOf(conversationId)).toBe(3);
  }, 30_000);

  it('13. CHAT-07, T-11-04: the block commits first, then a send is `direct_closed` and no row of that send exists', async () => {
    const { a, b, conversationId } = await pairOf('sb2');
    expect((await blockUser(b.token, a.userId)).status).toBeLessThan(300);
    const before = await messagesOf(conversationId);
    const refused = await sendDirect(a, b.membershipId, 'Tarde demais');
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Envelope).error.details).toEqual({ chat: 'direct_closed' });
    expect(await messagesOf(conversationId)).toBe(before);
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_messages
       where conversation_id = ${conversationId}::uuid and body = 'Tarde demais'`;
    expect(row?.n).toBe(0);
  }, 30_000);

  it('14. CHAT-07, T-11-04: a send and a block queued behind the same lock never deadlock and never both win; every later send is refused', async () => {
    const { a, b, conversationId } = await pairOf('sb3');
    const holder = await holdLockWith(async (tx) => {
      await tx`
        select id from public.chat_conversations where id = ${conversationId}::uuid for update`;
    });
    let sent: Response | undefined;
    let blocked: Response | undefined;
    try {
      const sending = sendDirect(a, b.membershipId, 'Corrida').then((res) => {
        sent = res;
        return res;
      });
      const blocking = blockUser(b.token, a.userId).then((res) => {
        blocked = res;
        return res;
      });
      await waitUntilBlocked(holder.holderPid, 2);
      expect(sent).toBeUndefined();
      expect(blocked).toBeUndefined();
      await holder.commit();
      await Promise.all([sending, blocking]);
    } finally {
      await holder.abort();
    }
    expect(blocked?.status).toBeLessThan(300);
    expect(await blocksOf(b, a)).toBe(1);
    // Either order is lawful, but the message is stored exactly when its answer was 201, never after the block.
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_messages
       where conversation_id = ${conversationId}::uuid and body = 'Corrida'`;
    expect(row?.n).toBe(sent?.status === 201 ? 1 : 0);
    if (sent?.status !== 201) expect(sent?.status).toBe(409);
    // Whatever won, the pair is closed now for both sides.
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      expect((await sendDirect(from, to.membershipId, 'Fechado')).status).toBe(409);
    }
  }, 30_000);
});
