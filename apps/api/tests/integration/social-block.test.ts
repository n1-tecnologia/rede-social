import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseKit, removeThrowaways, request } from './chat-case-fixtures';
import {
  blockUser,
  directMember,
  removeDirectRows,
  requestOn,
  setModule,
  sharedDirectIdentity,
  unblockUser,
  withDirectModules,
} from './direct-fixtures';
import { adminSql } from './setup';

/**
 * Phase 11 plan 11 (CHAT-07; D-722, D-724, D-725; T-11-03, T-11-01): what a member block changes in the follow graph
 * through the API, against the live local stack.
 *
 * FIXTURES. Throwaway members of the demo tenant (the seeded members carry follows other suites read: a block through the
 * API clears a follow, so none of them is touched), `social` switched on for the span and put back, every row swept
 * before the users. The cross-tenant case uses two shared identities that sit in the demo AND the lab tenant (lab has
 * `social` on in the seed). Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type Social = {
  membershipId: string;
  followerCount: number;
  followingCount: number;
  viewerFollows: boolean;
  self: boolean;
  canFollow?: boolean;
  canMessage?: boolean;
  blockedByViewer?: boolean;
};
type StateItem = {
  membershipId: string;
  following: boolean;
  canFollow?: boolean;
  canMessage?: boolean;
  blockedByViewer?: boolean;
};

const SHARED_PREFIX = 'socblk';

let restoreModules: () => Promise<void> = async () => {};

beforeAll(async () => {
  await caseKit();
  await removeDirectRows([SHARED_PREFIX]);
  restoreModules = await withDirectModules('demo', ['social']);
});

afterAll(async () => {
  await removeDirectRows([SHARED_PREFIX]);
  await removeThrowaways();
  await restoreModules();
});

const follow = (from: { token: string }, membershipId: string) =>
  request(`/v1/social/follows/${membershipId}`, from.token, { method: 'PUT' });
const unfollow = (from: { token: string }, membershipId: string) =>
  request(`/v1/social/follows/${membershipId}`, from.token, { method: 'DELETE' });
const profileOf = (from: { token: string }, membershipId: string) =>
  request(`/v1/social/members/${membershipId}`, from.token);
const stateOf = (from: { token: string }, membershipIds: string[]) =>
  request('/v1/social/follows/state', from.token, {
    method: 'POST',
    body: JSON.stringify({ membershipIds }),
  });

async function socialOf(from: { token: string }, membershipId: string): Promise<Social> {
  const res = await profileOf(from, membershipId);
  expect(res.status).toBe(200);
  return (await res.json()) as Social;
}

async function followRows(a: string, b: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.social_follows
     where (follower_user_id = ${a}::uuid and followee_user_id = ${b}::uuid)
        or (follower_user_id = ${b}::uuid and followee_user_id = ${a}::uuid)`;
  return row?.n ?? -1;
}

/** The text of an answer with the per-request id taken out, so two refusals compare byte for byte. */
const bodyText = async (res: Response): Promise<string> =>
  (await res.text()).replace(/"requestId":"[^"]*"/g, '"requestId":"-"');

describe('social block tracer', () => {
  it('1. after a block the follow is the plain 404 from both sides, identical to an unknown target, and works again after the unblock', async () => {
    const a = await directMember('sb1a');
    const b = await directMember('sb1b');
    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect((await follow(b, a.membershipId)).status).toBe(200);
    expect(await followRows(a.userId, b.userId)).toBe(2);

    expect((await blockUser(a.token, b.userId)).status).toBeLessThan(300);
    expect(await followRows(a.userId, b.userId)).toBe(0);

    const unknown = await follow(a, randomUUID());
    expect(unknown.status).toBe(404);
    const unknownText = await bodyText(unknown);
    const fromBlocker = await follow(a, b.membershipId);
    const fromBlocked = await follow(b, a.membershipId);
    expect(fromBlocker.status).toBe(404);
    expect(fromBlocked.status).toBe(404);
    expect(await bodyText(fromBlocker)).toBe(unknownText);
    expect(await bodyText(fromBlocked)).toBe(unknownText);
    expect((JSON.parse(unknownText) as Envelope).error.code).toBe('NOT_FOUND');
    expect((JSON.parse(unknownText) as Envelope).error.details).toBeUndefined();
    expect(await followRows(a.userId, b.userId)).toBe(0);

    expect((await unblockUser(a.token, b.userId)).status).toBeLessThan(300);
    // The unblock restores nothing, and a follow works again.
    expect(await followRows(a.userId, b.userId)).toBe(0);
    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect((await follow(b, a.membershipId)).status).toBe(200);
    expect(await followRows(a.userId, b.userId)).toBe(2);
  });

  it('2. the profile facts: a third member is offered both, the blocker sees blockedByViewer, the blocked member sees a pair that cannot interact', async () => {
    const a = await directMember('sb2a');
    const b = await directMember('sb2b');
    const c = await directMember('sb2c');
    const before = await socialOf(b, a.membershipId);
    expect(before).toMatchObject({ canFollow: true, canMessage: true, blockedByViewer: false });

    expect((await blockUser(a.token, b.userId)).status).toBeLessThan(300);

    const third = await socialOf(c, b.membershipId);
    expect(third).toMatchObject({ canFollow: true, canMessage: true, blockedByViewer: false });

    const asBlocker = await socialOf(a, b.membershipId);
    expect(asBlocker).toMatchObject({ canFollow: false, canMessage: false, blockedByViewer: true });

    const asBlocked = await socialOf(b, a.membershipId);
    expect(asBlocked).toMatchObject({
      canFollow: false,
      canMessage: false,
      blockedByViewer: false,
    });
    // The blocked member reads the same names and counts as before the block: nothing says "blocked me".
    expect(asBlocked.followerCount).toBe(before.followerCount);
    expect(asBlocked.followingCount).toBe(before.followingCount);
    expect(Object.keys(asBlocked).sort()).toEqual(Object.keys(third).sort());

    const own = await socialOf(a, a.membershipId);
    expect(own).toMatchObject({
      self: true,
      canFollow: false,
      canMessage: false,
      blockedByViewer: false,
    });
    // The old keys keep their meaning.
    expect(Object.keys(own).sort()).toEqual(
      [
        'blockedByViewer',
        'canFollow',
        'canMessage',
        'followerCount',
        'followingCount',
        'membershipId',
        'self',
        'viewerFollows',
      ].sort(),
    );
    expect(own.membershipId).toBe(a.membershipId);
  });

  it('3. the follow state carries the same facts per id, in input order, with following still correct', async () => {
    const { ids } = await caseKit();
    const a = await directMember('sb3a');
    const b = await directMember('sb3b');
    const c = await directMember('sb3c');
    const d = await directMember('sb3d');
    const [staff] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where tenant_id = ${ids.demo}::uuid and user_id = ${ids.demoAdmin}::uuid`;
    expect((await follow(a, c.membershipId)).status).toBe(200);
    expect((await follow(a, d.membershipId)).status).toBe(200);
    expect((await blockUser(a.token, b.userId)).status).toBeLessThan(300);
    // The block stays one-sided: b has done nothing, so b's own facts are the cannot-interact ones.
    const asked = [c.membershipId, b.membershipId, staff?.id ?? randomUUID(), a.membershipId];

    const res = await stateOf(a, asked);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: StateItem[] };
    expect(body.items.map((item) => item.membershipId)).toEqual(asked);
    expect(body.items[0]).toEqual({
      membershipId: c.membershipId,
      following: true,
      canFollow: true,
      canMessage: true,
      blockedByViewer: false,
    });
    expect(body.items[1]).toEqual({
      membershipId: b.membershipId,
      following: false,
      canFollow: false,
      canMessage: false,
      blockedByViewer: true,
    });
    for (const item of [body.items[2], body.items[3]]) {
      expect(item).toMatchObject({
        following: false,
        canFollow: false,
        canMessage: false,
        blockedByViewer: false,
      });
    }

    const asBlocked = (await (await stateOf(b, [a.membershipId, c.membershipId])).json()) as {
      items: StateItem[];
    };
    expect(asBlocked.items[0]).toEqual({
      membershipId: a.membershipId,
      following: false,
      canFollow: false,
      canMessage: false,
      blockedByViewer: false,
    });
    expect(asBlocked.items[1]).toMatchObject({ canFollow: true, canMessage: true });
  });

  it('4. unchanged: a staff target and a removed target are the bare 404, an unfollow still answers 200, social off is MODULE_DISABLED', async () => {
    const { ids } = await caseKit();
    const a = await directMember('sb4a');
    const gone = await directMember('sb4b');
    const [staff] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where tenant_id = ${ids.demo}::uuid and user_id = ${ids.demoAdmin}::uuid`;
    const unknownText = await bodyText(await follow(a, randomUUID()));

    const staffRes = await follow(a, staff?.id ?? randomUUID());
    expect(staffRes.status).toBe(404);
    expect(await bodyText(staffRes)).toBe(unknownText);

    expect((await follow(a, gone.membershipId)).status).toBe(200);
    await adminSql`
      update public.memberships set deleted_at = now() where id = ${gone.membershipId}::uuid`;
    const removed = await follow(a, gone.membershipId);
    expect(removed.status).toBe(404);
    expect(await bodyText(removed)).toBe(unknownText);
    // Unfollowing a removed target stays possible.
    const undone = await unfollow(a, gone.membershipId);
    expect(undone.status).toBe(200);
    expect(await followRows(a.userId, gone.userId)).toBe(0);

    const restoreOff = await setModule('demo', 'social', false);
    try {
      const off = await follow(a, gone.membershipId);
      expect(off.status).toBe(404);
      expect(((await off.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
    } finally {
      await restoreOff();
    }
  });
});

type ListPage = { items: { membershipId: string }[]; nextCursor: string | null };

const listOf = async (
  from: { token: string },
  side: 'followers' | 'following',
  query = '',
): Promise<ListPage> => {
  const res = await request(`/v1/social/me/${side}${query}`, from.token);
  expect(res.status).toBe(200);
  return (await res.json()) as ListPage;
};

describe('social block cross-checks (D-725)', () => {
  it('5. the two private lists never show a blocked pair and still page correctly', async () => {
    const a = await directMember('sb5a');
    const blocked = await directMember('sb5b');
    const others = [
      await directMember('sb5c'),
      await directMember('sb5d'),
      await directMember('sb5e'),
    ];
    // Everyone follows `a` and `a` follows everyone, `blocked` included, so both lists have four rows.
    for (const other of [blocked, ...others]) {
      expect((await follow(other, a.membershipId)).status).toBe(200);
      expect((await follow(a, other.membershipId)).status).toBe(200);
    }
    expect((await listOf(a, 'followers')).items).toHaveLength(4);
    expect((await listOf(a, 'following')).items).toHaveLength(4);

    expect((await blockUser(a.token, blocked.userId)).status).toBeLessThan(300);

    for (const side of ['followers', 'following'] as const) {
      const all = await listOf(a, side);
      expect(all.items.map((item) => item.membershipId).sort()).toEqual(
        others.map((other) => other.membershipId).sort(),
      );
      // Paging by one still walks every remaining row exactly once and never meets the blocked member.
      const walked: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const query: string = cursor ? `?limit=1&cursor=${encodeURIComponent(cursor)}` : '?limit=1';
        const next = await listOf(a, side, query);
        walked.push(...next.items.map((item) => item.membershipId));
        cursor = next.nextCursor;
        if (!cursor) break;
      }
      expect(walked.sort()).toEqual(others.map((other) => other.membershipId).sort());
      expect(walked).not.toContain(blocked.membershipId);
    }
    // The blocked member's own lists lose the blocker as well (the rows are gone, nothing hides them).
    expect((await listOf(blocked, 'followers')).items).toEqual([]);
    expect((await listOf(blocked, 'following')).items).toEqual([]);
  });

  it('6. an unfollow of a blocked or removed target still answers 200, and a profile count carries no deleted follow', async () => {
    const a = await directMember('sb6a');
    const b = await directMember('sb6b');
    const c = await directMember('sb6c');
    const watcher = await directMember('sb6w');
    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect((await follow(watcher, b.membershipId)).status).toBe(200);
    expect((await socialOf(watcher, b.membershipId)).followerCount).toBe(2);

    expect((await blockUser(a.token, b.userId)).status).toBeLessThan(300);
    // a's follow was deleted by the block: the count a third member reads drops from 2 to 1.
    expect((await socialOf(watcher, b.membershipId)).followerCount).toBe(1);
    expect((await socialOf(a, b.membershipId)).followerCount).toBe(1);

    // Unfollowing the blocked target, the blocker and a removed target all stay 200 with following false.
    for (const [caller, target] of [
      [a, b],
      [b, a],
    ] as const) {
      const res = await unfollow(caller, target.membershipId);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { following: boolean }).following).toBe(false);
    }
    expect((await follow(a, c.membershipId)).status).toBe(200);
    await adminSql`
      update public.memberships set deleted_at = now() where id = ${c.membershipId}::uuid`;
    const removed = await unfollow(a, c.membershipId);
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { following: boolean }).following).toBe(false);
    expect(await followRows(a.userId, c.userId)).toBe(0);
  });
});

describe('social block cross-tenant', () => {
  it('a block in the demo tenant leaves the same two users follow in the lab tenant alone (T-11-01)', async () => {
    const a = await sharedDirectIdentity(`${SHARED_PREFIX}-a`);
    const b = await sharedDirectIdentity(`${SHARED_PREFIX}-b`);
    const onLab = (path: string, token: string, init?: RequestInit) =>
      requestOn('lab', path, token, init);

    // Both tenants accept a follow of the same pair before the block (the positive control).
    expect((await follow({ token: a.demo.token }, b.demo.membershipId)).status).toBe(200);
    expect(
      (await onLab(`/v1/social/follows/${b.lab.membershipId}`, a.lab.token, { method: 'PUT' }))
        .status,
    ).toBe(200);

    expect((await blockUser(a.demo.token, b.userId)).status).toBeLessThan(300);

    // Demo: the follow is gone and a new one is the plain 404.
    expect((await follow({ token: a.demo.token }, b.demo.membershipId)).status).toBe(404);
    // Lab: the follow stays and stays idempotent.
    const [lab] = await adminSql<{ n: number }[]>`
      select count(*)::int as n
        from public.social_follows f
        join public.tenants t on t.id = f.tenant_id
       where t.slug = 'rede-lab'
         and f.follower_user_id = ${a.userId}::uuid and f.followee_user_id = ${b.userId}::uuid`;
    expect(lab?.n).toBe(1);
    expect(
      (await onLab(`/v1/social/follows/${b.lab.membershipId}`, a.lab.token, { method: 'PUT' }))
        .status,
    ).toBe(200);
    // The lab facts are the unblocked ones.
    const labProfile = await onLab(`/v1/social/members/${b.lab.membershipId}`, a.lab.token);
    expect(labProfile.status).toBe(200);
    expect(await labProfile.json()).toMatchObject({
      canFollow: true,
      canMessage: true,
      blockedByViewer: false,
    });
  });
});
