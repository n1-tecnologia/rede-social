import { randomUUID } from 'node:crypto';
import { blockLimiter } from '@rede-social/core/server/safety/limits';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { caseKit, removeThrowaways, request } from './chat-case-fixtures';
import {
  blockUser,
  type DirectMember,
  directMember,
  removeDirectRows,
  requestOn,
  sharedDirectIdentity,
  unblockUser,
  withDirectModules,
} from './direct-fixtures';
import { adminSql } from './setup';

/**
 * Phase 11 plan 27 (CHAT-07, MODER-04; D-616, D-722, D-733; T-11-34, T-11-06, T-11-01, T-11-03, T-11-07): block and
 * unblock a member by MEMBERSHIP id, the API against the live local stack.
 *
 * FIXTURES. Throwaway members of the demo tenant (a block through the API clears a follow, so no seeded member is
 * touched), `social` switched on for the span and put back, every row swept before the users. The cross-tenant case
 * uses shared identities that sit in the demo AND the lab tenant. Test ORDER is load-bearing (`fileParallelism:
 * false`, declaration order).
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const SHARED_PREFIX = 'blkmem';

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

afterEach(() => {
  blockLimiter.reset();
});

const blockBy = (token: string, membershipId: string) =>
  request(`/v1/blocks/members/${membershipId}`, token, { method: 'POST' });
const unblockBy = (token: string, membershipId: string) =>
  request(`/v1/blocks/members/${membershipId}`, token, { method: 'DELETE' });
const follow = (from: { token: string }, membershipId: string) =>
  request(`/v1/social/follows/${membershipId}`, from.token, { method: 'PUT' });
const listBlocks = async (token: string) =>
  ((await (await request('/v1/blocks', token)).json()) as { items: { userId: string }[] }).items;

/** The text of an answer with the per-request id taken out, so two refusals compare byte for byte. */
const bodyText = async (res: Response): Promise<string> =>
  (await res.text()).replace(/"requestId":"[^"]*"/g, '"requestId":"-"');

async function followRows(a: string, b: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.social_follows
     where (follower_user_id = ${a}::uuid and followee_user_id = ${b}::uuid)
        or (follower_user_id = ${b}::uuid and followee_user_id = ${a}::uuid)`;
  return row?.n ?? -1;
}

async function blockRows(blocker: string, blocked: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.member_blocks
     where blocker_user_id = ${blocker}::uuid and blocked_user_id = ${blocked}::uuid`;
  return row?.n ?? -1;
}

async function labMembershipId(email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select m.id::text as id from public.memberships m
      join public.users u on u.id = m.user_id
      join public.tenants t on t.id = m.tenant_id
     where t.slug = 'rede-lab' and u.email = ${email}`;
  if (!row) throw new Error(`${email} is not a member of rede-lab`);
  return row.id;
}

/** Every kind of miss the one refusal body must cover, each built from fixtures this file owns. */
async function missTargets(caller: DirectMember): Promise<Record<string, string>> {
  const staff = await directMember(`bm-staff-${randomUUID().slice(0, 6)}`, {
    role: 'support_tenant',
  });
  const admin = await directMember(`bm-adm-${randomUUID().slice(0, 6)}`, { role: 'admin_tenant' });
  const removed = await directMember(`bm-rem-${randomUUID().slice(0, 6)}`);
  await adminSql`update public.memberships set deleted_at = now() where id = ${removed.membershipId}::uuid`;
  const adminBlocked = await directMember(`bm-ab-${randomUUID().slice(0, 6)}`);
  await adminSql`
    update public.memberships set blocked_at = now()
     where id = ${adminBlocked.membershipId}::uuid`;
  return {
    staff: staff.membershipId,
    admin: admin.membershipId,
    self: caller.membershipId,
    removed: removed.membershipId,
    'blocked by the administrator': adminBlocked.membershipId,
    'another tenant': await labMembershipId('member@rede-lab.local'),
    unknown: randomUUID(),
  };
}

describe('block by membership tracer', () => {
  it('1. a member blocks and unblocks another by membership id, the follows go with the block, a repeat is changed false and the blocked member sees no block', async () => {
    const a = await directMember('bm1a');
    const b = await directMember('bm1b');
    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect((await follow(b, a.membershipId)).status).toBe(200);
    expect(await followRows(a.userId, b.userId)).toBe(2);

    const first = await blockBy(a.token, b.membershipId);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const firstText = await first.text();
    expect(JSON.parse(firstText)).toEqual({ changed: true });
    expect(firstText).not.toContain(b.userId);
    expect(await followRows(a.userId, b.userId)).toBe(0);
    expect(await blockRows(a.userId, b.userId)).toBe(1);

    const again = await blockBy(a.token, b.membershipId);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ changed: false });

    // The blocker's own list is the shipped one (its `userId` is the caller's own block); the blocked sees none.
    expect((await listBlocks(a.token)).map((row) => row.userId)).toEqual([b.userId]);
    expect(await listBlocks(b.token)).toEqual([]);

    const lifted = await unblockBy(a.token, b.membershipId);
    expect(lifted.status).toBe(200);
    expect(lifted.headers.get('cache-control')).toBe('no-store');
    const liftedText = await lifted.text();
    expect(JSON.parse(liftedText)).toEqual({ changed: true });
    expect(liftedText).not.toContain(b.userId);
    const liftedAgain = await unblockBy(a.token, b.membershipId);
    expect(liftedAgain.status).toBe(200);
    expect(await liftedAgain.json()).toEqual({ changed: false });
    expect(await blockRows(a.userId, b.userId)).toBe(0);
    // The unblock restores nothing (D-724).
    expect(await followRows(a.userId, b.userId)).toBe(0);
    expect(await listBlocks(a.token)).toEqual([]);
  });

  it('1b. a member with no follow and no conversation blocks (changed true, then false) and an unblock of a member never blocked is changed false, never an error', async () => {
    const a = await directMember('bm1ba');
    const b = await directMember('bm1bb');
    const never = await unblockBy(a.token, b.membershipId);
    expect(never.status).toBe(200);
    expect(await never.json()).toEqual({ changed: false });
    expect(await followRows(a.userId, b.userId)).toBe(0);

    expect(await (await blockBy(a.token, b.membershipId)).json()).toEqual({ changed: true });
    expect(await (await blockBy(a.token, b.membershipId)).json()).toEqual({ changed: false });
  });

  it('2. a staff target, oneself, another tenant, an unknown id and a removed member all answer the byte-identical CANNOT_BLOCK of the user-id route, and a malformed id is VALIDATION_FAILED', async () => {
    const a = await directMember('bm2a');
    const staff = await directMember('bm2s', { role: 'support_tenant' });
    // The reference: what the shipped user-id route answers for a staff target.
    const reference = await blockUser(a.token, staff.userId);
    expect(reference.status).toBe(400);
    const referenceText = await bodyText(reference);
    expect((JSON.parse(referenceText) as Envelope).error.code).toBe('CANNOT_BLOCK');

    for (const [label, membershipId] of Object.entries(await missTargets(a))) {
      const res = await blockBy(a.token, membershipId);
      expect(res.status, label).toBe(400);
      expect(await bodyText(res), label).toBe(referenceText);
    }

    const malformed = await blockBy(a.token, 'not-a-uuid');
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    const malformedLift = await unblockBy(a.token, 'not-a-uuid');
    expect(malformedLift.status).toBe(400);
    expect(((await malformedLift.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    expect(await listBlocks(a.token)).toEqual([]);
  });

  it('3. a member removed since can still be unblocked by the membership id, and the shipped list row of a departed member still unblocks by user id', async () => {
    const a = await directMember('bm3a');
    const b = await directMember('bm3b');
    const c = await directMember('bm3c');
    expect((await blockBy(a.token, b.membershipId)).status).toBe(200);
    expect((await blockBy(a.token, c.membershipId)).status).toBe(200);
    for (const gone of [b, c]) {
      await adminSql`update public.memberships set deleted_at = now() where id = ${gone.membershipId}::uuid`;
    }
    // A removed member cannot be blocked again, but the block that exists can be lifted.
    expect((await blockBy(a.token, b.membershipId)).status).toBe(400);

    const lifted = await unblockBy(a.token, b.membershipId);
    expect(lifted.status).toBe(200);
    expect(await lifted.json()).toEqual({ changed: true });
    expect(await blockRows(a.userId, b.userId)).toBe(0);

    const listed = (await (await request('/v1/blocks', a.token)).json()) as {
      items: { userId: string; displayName: string | null }[];
    };
    expect(listed.items).toEqual([
      expect.objectContaining({ userId: c.userId, displayName: null }),
    ]);
    const byUser = await unblockUser(a.token, c.userId);
    expect(byUser.status).toBe(200);
    expect(await byUser.json()).toEqual({ changed: true });
  });

  it('4. the shared 60 an hour limiter counts block and unblock attempts of the new routes and answers 429 RATE_LIMITED', async () => {
    const a = await directMember('bm4a');
    const b = await directMember('bm4b');
    const statuses: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const res =
        i % 2 === 0
          ? await blockBy(a.token, b.membershipId)
          : await unblockBy(a.token, b.membershipId);
      statuses.push(res.status);
    }
    expect(statuses.every((status) => status === 200)).toBe(true);
    const blockedOut = await blockBy(a.token, b.membershipId);
    expect(blockedOut.status).toBe(429);
    expect(((await blockedOut.json()) as Envelope).error.code).toBe('RATE_LIMITED');
    const liftedOut = await unblockBy(a.token, b.membershipId);
    expect(liftedOut.status).toBe(429);
    expect(((await liftedOut.json()) as Envelope).error.code).toBe('RATE_LIMITED');
    // The attempt counter is the member's; another member is unaffected and the reset (afterEach) clears it.
    const other = await directMember('bm4c');
    expect((await blockBy(other.token, b.membershipId)).status).toBe(200);
  });
});

describe('refusal matrix', () => {
  it('every miss, block and unblock side, carries the same full envelope as the shipped staff-target refusal (status, code, message)', async () => {
    const a = await directMember('bmrm-a');
    const staff = await directMember('bmrm-s', { role: 'support_tenant' });
    const reference = await bodyText(await blockUser(a.token, staff.userId));
    const parsed = JSON.parse(reference) as Envelope;
    expect(parsed.error.code).toBe('CANNOT_BLOCK');
    expect(parsed.error.details).toBeUndefined();

    const seen = new Map<string, string>();
    for (const [label, membershipId] of Object.entries(await missTargets(a))) {
      const res = await blockBy(a.token, membershipId);
      const text = await bodyText(res);
      expect(res.status, label).toBe(400);
      expect(text, label).toBe(reference);
      seen.set(label, text);
    }
    expect(new Set(seen.values()).size).toBe(1);
    expect(seen.size).toBe(7);
    // Nothing was written by any of the misses.
    const [rows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.member_blocks where blocker_user_id = ${a.userId}::uuid`;
    expect(rows?.n).toBe(0);
  });

  it('an unblock of any id that holds no block of the caller (unknown, staff, another tenant, oneself) is the 200 changed false, never a different body', async () => {
    const a = await directMember('bmrm-ua');
    const answers = new Set<string>();
    for (const [label, membershipId] of Object.entries(await missTargets(a))) {
      const res = await unblockBy(a.token, membershipId);
      expect(res.status, label).toBe(200);
      answers.add(await bodyText(res));
    }
    expect([...answers]).toEqual(['{"changed":false}']);
  });
});

describe('tenant', () => {
  it('a membership id of another tenant is the same 400 and blocks nobody, and a shared identity blocks only in the request tenant (T-11-01)', async () => {
    const a = await sharedDirectIdentity(`${SHARED_PREFIX}-a`);
    const b = await sharedDirectIdentity(`${SHARED_PREFIX}-b`);
    const onLab = (path: string, token: string, init?: RequestInit) =>
      requestOn('lab', path, token, init);

    // Both tenants hold a follow of the same pair before the block (the positive control).
    expect((await follow({ token: a.demo.token }, b.demo.membershipId)).status).toBe(200);
    expect(
      (await onLab(`/v1/social/follows/${b.lab.membershipId}`, a.lab.token, { method: 'PUT' }))
        .status,
    ).toBe(200);

    const reference = await bodyText(await blockUser(a.demo.token, randomUUID()));

    // Tenant A's session naming tenant B's membership id of the SAME person: refused as an unknown one.
    const crossing = await blockBy(a.demo.token, b.lab.membershipId);
    expect(crossing.status).toBe(400);
    expect(await bodyText(crossing)).toBe(reference);
    // The mirror: the lab session naming the demo membership id.
    const mirror = await onLab(`/v1/blocks/members/${b.demo.membershipId}`, a.lab.token, {
      method: 'POST',
    });
    expect(mirror.status).toBe(400);
    expect(await bodyText(mirror)).toBe(reference);
    expect(await blockRows(a.userId, b.userId)).toBe(0);

    // Inside the demo tenant the block works and leaves the lab follow alone.
    const done = await blockBy(a.demo.token, b.demo.membershipId);
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ changed: true });
    const rows = await adminSql<{ slug: string }[]>`
      select t.slug from public.member_blocks mb join public.tenants t on t.id = mb.tenant_id
       where mb.blocker_user_id = ${a.userId}::uuid and mb.blocked_user_id = ${b.userId}::uuid`;
    expect(rows.map((row) => row.slug)).toEqual(['rede-demo']);
    const [lab] = await adminSql<{ n: number }[]>`
      select count(*)::int as n
        from public.social_follows f join public.tenants t on t.id = f.tenant_id
       where t.slug = 'rede-lab'
         and f.follower_user_id = ${a.userId}::uuid and f.followee_user_id = ${b.userId}::uuid`;
    expect(lab?.n).toBe(1);

    // Positive control on the lab side: the lab block writes the lab row only, and a lab unblock lifts only it.
    const labDone = await onLab(`/v1/blocks/members/${b.lab.membershipId}`, a.lab.token, {
      method: 'POST',
    });
    expect(labDone.status).toBe(200);
    expect(await labDone.json()).toEqual({ changed: true });
    expect(await blockRows(a.userId, b.userId)).toBe(2);
    const labLift = await onLab(`/v1/blocks/members/${b.lab.membershipId}`, a.lab.token, {
      method: 'DELETE',
    });
    expect(await labLift.json()).toEqual({ changed: true });
    expect(await blockRows(a.userId, b.userId)).toBe(1);
    // The demo block is still there, and the demo membership id on the lab lane lifts nothing.
    const wrongLane = await onLab(`/v1/blocks/members/${b.demo.membershipId}`, a.lab.token, {
      method: 'DELETE',
    });
    expect(await wrongLane.json()).toEqual({ changed: false });
    expect(await blockRows(a.userId, b.userId)).toBe(1);
  });
});

describe('silent', () => {
  it('a block and an unblock by membership id raise no notification, no job and no moderation row, and change nothing the blocked member reads of their own', async () => {
    const a = await directMember('bms-a');
    const b = await directMember('bms-b');
    const [{ now: since } = { now: new Date() }] = await adminSql<
      { now: Date }[]
    >`select now() as now`;
    const counts = async () => {
      const [row] = await adminSql<{ notifications: number; jobs: number; log: number }[]>`
        select (select count(*)::int from public.notifications where user_id in (${a.userId}::uuid, ${b.userId}::uuid)) as notifications,
               (select count(*)::int from pgboss.job where created_on >= ${since}) as jobs,
               (select count(*)::int from public.moderation_log where created_at >= ${since}) as log`;
      return row;
    };
    const before = await counts();
    const blockedOwnBefore = await (await request('/v1/blocks', b.token)).text();

    expect((await blockBy(a.token, b.membershipId)).status).toBe(200);
    expect((await unblockBy(a.token, b.membershipId)).status).toBe(200);
    expect((await blockBy(a.token, b.membershipId)).status).toBe(200);

    expect(await counts()).toEqual(before);
    expect(await (await request('/v1/blocks', b.token)).text()).toBe(blockedOwnBefore);
    expect((await request('/v1/me/bootstrap', b.token)).status).toBe(200);
    expect((await unblockBy(a.token, b.membershipId)).status).toBe(200);
  });
});
