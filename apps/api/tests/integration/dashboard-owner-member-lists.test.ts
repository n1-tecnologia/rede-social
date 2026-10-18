import { randomUUID } from 'node:crypto';
import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { encodeCursor } from '@rede-social/core/server/paging';
import {
  type OwnerBandListReady,
  type OwnerMemberDetailReady,
  type OwnerMembersReady,
  ownerBandListAnswerSchema,
  ownerMemberDetailAnswerSchema,
  ownerMembersAnswerSchema,
} from '@rede-social/module-dashboard/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertAttendanceAt,
  insertFixtureEvent,
  insertFixturePost,
  insertFixtureProduct,
  insertLikeAt,
  insertMembershipAt,
  insertPaidOrderAt,
  insertSupportMessageAt,
  insertSupportThreadAt,
  moveFixtureEvent,
  rebuildDashboard,
  removeDashboardFixtures,
  removeFixtureProduct,
  removeSupportThreads,
  tenantIdOf,
} from './dashboard-fixture';
import { adminSql, api, createSharedIdentity, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Phase 08.7 — the named lists behind Membros (08.7-04, D-462, D-461, D-460, INSIGHT-06,
 * INSIGHT-09, EP-17, EP-21..EP-26): crafted rede-demo members whose every action is dated at an
 * explicit tenant-local instant, one build through the real job body, then the band lists in three
 * scopes and the member detail. The event scope is fully crafted (only fixture members answered the
 * fixture event), so its pages are asserted row by row; the base and community scopes are compared
 * with the stored band counts of the same build.
 */

const PREFIX = `dash87l-${Date.now()}`;
const BANDS = '/v1/dashboard/owner/members/bands';
const MEMBERS = '/v1/dashboard/owner/members';
/** A seed community of rede-demo that is active and linked to no product (its base is everyone). */
const DEMO_COMMUNITY = '0d000000-0000-4000-8000-0000000000c3';
/** The same seed community of rede-lab: a foreign scope id for the rede-demo admin. */
const LAB_COMMUNITY = '0e000000-0000-4000-8000-0000000000c3';
/** EP-24: accents, an emoji and exactly 60 characters, stored and sent unchanged. */
const LONG_NAME = Array.from(`Zoë Ângela 🎉 Conceição ${'ã'.repeat(60)}`)
  .slice(0, 60)
  .join('');

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labAdmin: '' };
const tenants = { demo: '', lab: '' };
const crafted = { a: '', b: '', c: '', buyer: '', communal: '', quiet: '' };
const users = { buyer: '', author: '' };
let productId = '';
/** A second product: one live order per member and product (`store_orders_live_uq`). */
let secondProductId = '';
let soonEventId = '';
let openEventId = '';
let missedEventId = '';

type Envelope = { error: { code: string; message: string; requestId: string } };

const request = (path: string, token: string | undefined, host: string) =>
  api.request(path, {
    headers: {
      [TENANT_HOST_HEADER]: host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

async function bandPage(query: string, token = tokens.demoAdmin): Promise<OwnerBandListReady> {
  const res = await request(`${BANDS}/${query}`, token, HOSTS.demo);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = ownerBandListAnswerSchema.parse(await res.json());
  if (body.state !== 'ready') throw new Error('expected a ready band list');
  return body;
}

async function detailOf(membershipId: string): Promise<OwnerMemberDetailReady> {
  const res = await request(`${MEMBERS}/${membershipId}`, tokens.demoAdmin, HOSTS.demo);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = ownerMemberDetailAnswerSchema.parse(await res.json());
  if (body.state !== 'ready') throw new Error('expected a ready member detail');
  return body;
}

async function membersAnswer(): Promise<OwnerMembersReady> {
  const res = await request(MEMBERS, tokens.demoAdmin, HOSTS.demo);
  const body = ownerMembersAnswerSchema.parse(await res.json());
  if (body.state !== 'ready') throw new Error('expected a ready members answer');
  return body;
}

/** Every page of a band list, `limit` rows at a time. */
async function walk(query: string, limit: number): Promise<OwnerBandListReady[]> {
  const pages: OwnerBandListReady[] = [];
  let cursor: string | null = null;
  do {
    const sep = query.includes('?') ? '&' : '?';
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const page = await bandPage(`${query}${sep}limit=${limit}${suffix}`);
    pages.push(page);
    cursor = page.nextCursor;
    if (pages.length > 200) throw new Error('the band list does not end');
  } while (cursor);
  return pages;
}

/** The bare 404 of EP-17: exactly `{ error: { code, message, requestId } }`, no `details`. */
async function expectBare404(res: Response, code = 'NOT_FOUND') {
  expect(res.status).toBe(404);
  const body = (await res.json()) as Envelope;
  expect(Object.keys(body)).toEqual(['error']);
  expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'requestId']);
  expect(body.error.code).toBe(code);
  return body;
}

/** Turns `key` OFF for rede-demo; the returned function restores the previous state. */
async function withDemoModuleOff(key: 'communities' | 'events' | 'store' | 'chat') {
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenants.demo}::uuid and module_key = ${key}`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenants.demo}::uuid, ${key}, false)
    on conflict (tenant_id, module_key) do update set enabled = false, updated_at = now()`;
  moduleFlags.invalidate(tenants.demo);
  return async () => {
    if (previous) {
      await adminSql`
        update public.tenant_modules set enabled = ${previous.enabled}, updated_at = now()
         where tenant_id = ${tenants.demo}::uuid and module_key = ${key}`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenants.demo}::uuid and module_key = ${key}`;
    }
    moduleFlags.invalidate(tenants.demo);
  };
}

beforeAll(async () => {
  await removeDashboardFixtures(PREFIX.replace(/-\d+$/, ''));
  tenants.demo = await tenantIdOf('rede-demo');
  tenants.lab = await tenantIdOf('rede-lab');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);

  const author = await createSharedIdentity({
    prefix: `${PREFIX}-author`,
    memberships: [{ host: 'demo', role: 'support_tenant' }],
  });
  users.author = author.userId;
  const communityPost = await insertFixturePost({
    tenantId: tenants.demo,
    authorUserId: author.userId,
    communityId: DEMO_COMMUNITY,
  });
  soonEventId = await insertFixtureEvent({
    tenantId: tenants.demo,
    authorUserId: author.userId,
    open: false,
    code: 'K4ST',
  });
  openEventId = await insertFixtureEvent({
    tenantId: tenants.demo,
    authorUserId: author.userId,
    open: true,
    code: 'K4SU',
  });
  missedEventId = await insertFixtureEvent({
    tenantId: tenants.demo,
    authorUserId: author.userId,
    open: false,
    code: 'K4SV',
  });
  productId = await insertFixtureProduct(tenants.demo);
  secondProductId = await insertFixtureProduct(tenants.demo);

  const member = (name: string) =>
    insertMembershipAt({
      prefix: `${PREFIX}-${name}`,
      host: 'demo',
      daysAgo: 100,
      localTime: '10:00',
    });

  // The event scope's three "occasional" members: a and b answered "vou" at the SAME instant (noon
  // of D-2), c a day later — EP-22's tie, split by membership id.
  const a = await member('a');
  const b = await member('b');
  const c = await member('c');
  crafted.a = a.membershipId;
  crafted.b = b.membershipId;
  crafted.c = c.membershipId;
  for (const [who, k] of [
    [a, 2],
    [b, 2],
    [c, 1],
  ] as const) {
    await insertAttendanceAt({
      tenantId: tenants.demo,
      userId: who.userId,
      eventId: soonEventId,
      status: 'going',
      k,
    });
  }
  await adminSql`
    update public.member_profiles set display_name = ${LONG_NAME}
     where membership_id = ${a.membershipId}::uuid`;

  // The buyer (engaged): a paid order on D-40 (primary) and on D-3 (secondary), a check-in on D-5
  // (its RSVP on D-6), "vou" on the soon event (D-4) and on an event moved to D-10 (missed, D-12),
  // and two support turns: answered after 30 minutes on D-3, unanswered on D-2.
  const buyer = await member('buyer');
  crafted.buyer = buyer.membershipId;
  users.buyer = buyer.userId;
  await insertPaidOrderAt({ tenantId: tenants.demo, userId: buyer.userId, productId, k: 40 });
  await insertPaidOrderAt({
    tenantId: tenants.demo,
    userId: buyer.userId,
    productId: secondProductId,
    k: 3,
  });
  await insertAttendanceAt({
    tenantId: tenants.demo,
    userId: buyer.userId,
    eventId: openEventId,
    status: 'checked_in',
    k: 5,
  });
  await insertAttendanceAt({
    tenantId: tenants.demo,
    userId: buyer.userId,
    eventId: soonEventId,
    status: 'going',
    k: 4,
  });
  await insertAttendanceAt({
    tenantId: tenants.demo,
    userId: buyer.userId,
    eventId: missedEventId,
    status: 'going',
    k: 12,
  });
  await moveFixtureEvent({ tenantId: tenants.demo, eventId: missedEventId, k: 10 });
  const thread = await insertSupportThreadAt({
    tenantId: tenants.demo,
    memberUserId: buyer.userId,
  });
  for (const [side, k, localTime] of [
    ['member', 3, '10:00'],
    ['member', 3, '10:05'],
    ['staff', 3, '10:30'],
    ['member', 2, '09:00'],
  ] as const) {
    await insertSupportMessageAt({
      tenantId: tenants.demo,
      conversationId: thread,
      authorUserId: side === 'staff' ? author.userId : buyer.userId,
      side,
      k,
      localTime,
    });
  }

  // One like on a post of the community on D-1: occasional in the base AND in that community.
  const communal = await member('communal');
  crafted.communal = communal.membershipId;
  await insertLikeAt({
    tenantId: tenants.demo,
    userId: communal.userId,
    postId: communityPost,
    k: 1,
  });

  // No action at all (EP-23): inactive, with zeros and empty lists.
  crafted.quiet = (await member('quiet')).membershipId;

  expect(await rebuildDashboard(tenants.demo)).toBe('built');
});

afterAll(async () => {
  await removeSupportThreads([users.buyer].filter(Boolean));
  await removeDashboardFixtures(PREFIX);
  if (productId) await removeFixtureProduct(productId);
  if (secondProductId) await removeFixtureProduct(secondProductId);
  await adminSql.end();
});

describe('08.7 member lists', () => {
  it('D-462: member and support sessions are 403 on the band list and the detail; no session is 401', async () => {
    for (const path of [`${BANDS}/occasional`, `${MEMBERS}/${crafted.buyer}`]) {
      for (const token of [tokens.demoMember, tokens.demoSupport]) {
        const res = await request(path, token, HOSTS.demo);
        expect(res.status).toBe(403);
        expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
      }
      expect((await request(path, undefined, HOSTS.demo)).status).toBe(401);
    }
  });

  it('EP-22 / EP-25: the 3-member event band pages one row at a time, tie split by membership id, no repeat', async () => {
    const pages = await walk(`occasional?scope=event&scopeId=${soonEventId}`, 1);
    expect(pages).toHaveLength(3);
    const ids = pages.flatMap((page) => page.rows.map((row) => row.membershipId));
    const [tieFirst, tieSecond] = [crafted.a, crafted.b].sort().reverse();
    expect(ids).toEqual([crafted.c, tieFirst, tieSecond]);
    for (const page of pages) expect(page.total).toBe(3);
    expect(pages[2]?.nextCursor).toBeNull();
    const [one, two] = pages.map((page) => page.rows[0]?.lastActiveAt);
    expect(one && two && one > two).toBe(true);
    expect(pages[1]?.rows[0]?.lastActiveAt).toBe(pages[2]?.rows[0]?.lastActiveAt);
  });

  it('EP-21: limit=3 on a band of exactly 3 ends with nextCursor null; limit=0 reads 1; limit=500 reads all', async () => {
    const query = `occasional?scope=event&scopeId=${soonEventId}`;
    const exact = await bandPage(`${query}&limit=3`);
    expect(exact.rows).toHaveLength(3);
    expect(exact.nextCursor).toBeNull();
    const zero = await bandPage(`${query}&limit=0`);
    expect(zero.rows).toHaveLength(1);
    expect(zero.nextCursor).not.toBeNull();
    const many = await bandPage(`${query}&limit=500`);
    expect(many.rows).toHaveLength(3);
    expect(many.nextCursor).toBeNull();
    // The default page is 10.
    expect((await bandPage(query)).rows).toHaveLength(3);
  });

  it('EP-26: totals are the stored band counts of the same build, and every page adds up to them', async () => {
    const members = await membersAnswer();
    const event = members.eventEngagement?.find((entry) => entry.id === soonEventId);
    expect(event?.bands.counts.occasional).toBe(3);
    expect(event?.bands.counts.engaged).toBe(1);
    const engaged = await bandPage(`engaged?scope=event&scopeId=${soonEventId}`);
    expect(engaged.total).toBe(1);
    expect(engaged.rows.map((row) => row.membershipId)).toEqual([crafted.buyer]);

    for (const band of ['occasional', 'inactive', 'engaged'] as const) {
      const pages = await walk(band, 7);
      const rows = pages.flatMap((page) => page.rows);
      expect(pages[0]?.total).toBe(members.engagement.counts[band]);
      expect(rows).toHaveLength(members.engagement.counts[band]);
      expect(new Set(rows.map((row) => row.membershipId)).size).toBe(rows.length);
      // EP-25: last_active_at desc nulls last across pages.
      const keys = rows.map((row) => row.lastActiveAt ?? '');
      expect([...keys].sort().reverse()).toEqual(keys);
    }
    const occasional = (await walk('occasional', 50)).flatMap((page) => page.rows);
    for (const id of [crafted.a, crafted.b, crafted.c, crafted.communal]) {
      expect(occasional.some((row) => row.membershipId === id)).toBe(true);
    }
  });

  it('EP-23: a band with no member answers total 0, no rows, no cursor', async () => {
    const empty = await bandPage(`superfan?scope=event&scopeId=${soonEventId}`);
    expect(empty).toMatchObject({ total: 0, rows: [], nextCursor: null });
  });

  it('the community scope reads community_bands, its total is the stored count, the row names its top community', async () => {
    const members = await membersAnswer();
    const stored = members.communityEngagement?.find((entry) => entry.id === DEMO_COMMUNITY);
    const pages = await walk(`occasional?scope=community&scopeId=${DEMO_COMMUNITY}`, 50);
    const rows = pages.flatMap((page) => page.rows);
    expect(pages[0]?.total).toBe(stored?.bands.counts.occasional);
    expect(rows).toHaveLength(stored?.bands.counts.occasional ?? -1);
    const communal = rows.find((row) => row.membershipId === crafted.communal);
    expect(communal?.topCommunity?.id).toBe(DEMO_COMMUNITY);
    expect(typeof communal?.topCommunity?.name).toBe('string');
    expect(communal?.dailyMinutes).toEqual({ measured: false, reason: 'needs_usage_sessions' });
  });

  it('D-460: scope=community with communities off and scope=event with events off are 404 MODULE_DISABLED', async () => {
    let restore = await withDemoModuleOff('communities');
    try {
      const res = await request(
        `${BANDS}/occasional?scope=community&scopeId=${DEMO_COMMUNITY}`,
        tokens.demoAdmin,
        HOSTS.demo,
      );
      await expectBare404(res, 'MODULE_DISABLED');
      // The base list stays, and nobody's top community is named.
      const base = (await walk('occasional', 50)).flatMap((page) => page.rows);
      expect(base.every((row) => row.topCommunity === null)).toBe(true);
    } finally {
      await restore();
    }
    restore = await withDemoModuleOff('events');
    try {
      const res = await request(
        `${BANDS}/occasional?scope=event&scopeId=${soonEventId}`,
        tokens.demoAdmin,
        HOSTS.demo,
      );
      await expectBare404(res, 'MODULE_DISABLED');
    } finally {
      await restore();
    }
  });

  it('a foreign, unknown or absent scopeId is the bare 404; a bad band or scopeId is 400', async () => {
    for (const query of [
      `occasional?scope=community&scopeId=${LAB_COMMUNITY}`,
      `occasional?scope=community&scopeId=${randomUUID()}`,
      `occasional?scope=event&scopeId=${randomUUID()}`,
      'occasional?scope=event',
    ]) {
      await expectBare404(await request(`${BANDS}/${query}`, tokens.demoAdmin, HOSTS.demo));
    }
    for (const query of [
      'superfans',
      'occasional?scope=everyone',
      'occasional?scope=event&scopeId=x',
    ]) {
      const res = await request(`${BANDS}/${query}`, tokens.demoAdmin, HOSTS.demo);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('EP-24: a name is sent exactly as stored; a tampered or non-instant cursor reads page 1', async () => {
    const query = `occasional?scope=event&scopeId=${soonEventId}&limit=2`;
    const first = await bandPage(query);
    const rows = (await bandPage(`occasional?scope=event&scopeId=${soonEventId}`)).rows;
    expect(rows.find((row) => row.membershipId === crafted.a)?.displayName).toBe(LONG_NAME);
    for (const cursor of [
      'not-a-cursor',
      (first.nextCursor ?? '').slice(0, 12),
      Buffer.from(JSON.stringify({ v: 1, n: '2026-10-01T00:00:00Z', id: 'nope' })).toString(
        'base64url',
      ),
      encodeCursor({ n: 'abc', id: crafted.a }),
      encodeCursor({ n: '2026-02-30T10:00:00Z', id: crafted.a }),
    ]) {
      const page = await bandPage(`${query}&cursor=${encodeURIComponent(cursor)}`);
      expect(page.rows).toEqual(first.rows);
    }
  });

  it('the detail: band history, the member row’s numbers, live events, purchases and support counts', async () => {
    const detail = await detailOf(crafted.buyer);
    expect(detail.member).toMatchObject({ membershipId: crafted.buyer, band: 'engaged' });
    expect(detail.bandHistory.map((point) => point.band)).toEqual([
      'inactive',
      'occasional',
      'engaged',
    ]);
    expect(detail.bandHistory[2]?.month).toBe(detail.snapshot.day.slice(0, 7));
    expect(detail.last30).toEqual({
      activeDays: 5,
      likes: 0,
      comments: 0,
      checkIns: 1,
      orders: 1,
      strongActions: 2,
      dailyMinutes: { measured: false, reason: 'needs_usage_sessions' },
      postsSeen: { measured: false, reason: 'needs_post_views' },
    });
    expect(detail.weeklyActiveDays).toHaveLength(12);

    // Purchases: the first paid order is primary, the second secondary; expiresAt never a date.
    expect(detail.purchases?.map((purchase) => purchase.kind)).toEqual(['primary', 'secondary']);
    expect(detail.purchases?.map((purchase) => purchase.productId)).toEqual([
      productId,
      secondProductId,
    ]);
    for (const purchase of detail.purchases ?? []) {
      expect(purchase).toMatchObject({
        productName: 'Produto do painel',
        cents: 1990,
        expiresAt: { measured: false, reason: 'needs_access_expiry' },
      });
    }

    // Events, oldest first: missed (false), checked in (true), still to come (null).
    expect(detail.events?.map((event) => [event.eventId, event.attended])).toEqual([
      [missedEventId, false],
      [openEventId, true],
      [soonEventId, null],
    ]);

    // Support: two member turns in the 8 weeks, the latest on D-2, one answered after 30 minutes.
    expect(detail.support).toEqual({ conversations: 2, lastDaysAgo: 2, medianResponseMinutes: 30 });
    expect(JSON.stringify(detail)).not.toContain('Mensagem do teste');

    // Communities on: no post interaction yet, so no community and no top community.
    expect(detail.communities).toEqual([]);
    expect(detail.topCommunity).toBeNull();
    expect(detail.postTypes).toEqual([]);
    // The last counted action is the order of D-3.
    expect(detail.suggestion).toEqual({ kind: 'engaged', days: 3 });
  });

  it('D-460 on the detail: with store off purchases is absent, with chat off support, with events off events', async () => {
    for (const [key, part] of [
      ['store', 'purchases'],
      ['chat', 'support'],
      ['events', 'events'],
      ['communities', 'communities'],
    ] as const) {
      const restore = await withDemoModuleOff(key);
      try {
        const detail = await detailOf(crafted.buyer);
        expect(part in detail).toBe(false);
        if (key === 'communities') expect('topCommunity' in detail).toBe(false);
      } finally {
        await restore();
      }
    }
  });

  it('EP-23: a member with no action reads zeros and empty lists, never Em breve for a number', async () => {
    const detail = await detailOf(crafted.quiet);
    expect(detail.member.band).toBe('inactive');
    expect(detail.member.lastActiveAt).toBeNull();
    expect(detail.last30).toMatchObject({
      activeDays: 0,
      likes: 0,
      comments: 0,
      checkIns: 0,
      orders: 0,
      strongActions: 0,
    });
    expect(detail.events).toEqual([]);
    expect(detail.purchases).toEqual([]);
    expect(detail.support).toEqual({
      conversations: 0,
      lastDaysAgo: null,
      medianResponseMinutes: null,
    });
    expect(detail.suggestion).toEqual({ kind: 'inactive', days: 99 });
  });

  it('EP-17: a rede-lab admin on a rede-demo membership and a rede-demo admin on a random uuid get the same bare 404', async () => {
    const foreign = await expectBare404(
      await request(`${MEMBERS}/${crafted.buyer}`, tokens.labAdmin, HOSTS.lab),
    );
    const unknown = await expectBare404(
      await request(`${MEMBERS}/${randomUUID()}`, tokens.demoAdmin, HOSTS.demo),
    );
    expect(foreign.error.message).toBe(unknown.error.message);
    // A staff membership is never answered as a member.
    const [staff] = await adminSql<{ id: string }[]>`
      select m.id::text as id from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenants.demo}::uuid and u.email = 'support@rede-demo.local'`;
    await expectBare404(await request(`${MEMBERS}/${staff?.id}`, tokens.demoAdmin, HOSTS.demo));
    const bad = await request(`${MEMBERS}/not-a-uuid`, tokens.demoAdmin, HOSTS.demo);
    expect(bad.status).toBe(400);
    // The name of the member detail EP-24 asked about is unchanged here too.
    expect((await detailOf(crafted.a)).member.displayName).toBe(LONG_NAME);
  });
});
