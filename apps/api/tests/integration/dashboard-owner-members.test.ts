import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  type EngagementBandId,
  membersPayloadSchema,
  type OwnerMembersReady,
  type OwnerOverviewReady,
  ownerMembersAnswerSchema,
  ownerOverviewAnswerSchema,
} from '@rede-social/module-dashboard/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dashboardDay,
  insertAttendanceAt,
  insertCommentAt,
  insertFixtureEvent,
  insertFixturePost,
  insertFixtureProduct,
  insertLikeAt,
  insertMembershipAt,
  insertPaidOrderAt,
  rebuildDashboard,
  removeDashboardFixtures,
  removeFixtureProduct,
  tenantIdOf,
} from './dashboard-fixture';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  SEED_PASSWORD,
  signInAs,
  withPaymentsGate,
} from './setup';

/**
 * Phase 08.7 — the owner's Membros numbers (08.7-02, D-465, D-460, D-462, UI-D-484, UI-D-486,
 * UI-D-487, INSIGHT-07, INSIGHT-08, INSIGHT-18): crafted members whose every action is dated at an
 * explicit tenant-local instant (R-Pitfall 13), a build for the tenant-local yesterday through the
 * real job body, then `GET /v1/dashboard/owner/members` and the overview's engaged keys.
 *
 * The seed's own members keep whatever band their (undated) rows give them, so the band counts are
 * asserted as a DIFFERENCE against a build made before the fixture existed, and each crafted
 * member's band is read from its own member row; the API answer is compared with the stored payload.
 */

const PREFIX = `dash87m-${Date.now()}`;
const PATH = '/v1/dashboard/owner/members';
const OVERVIEW = '/v1/dashboard/owner/overview';
const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labAdmin: '' };
const tenants = { demo: '', lab: '' };
let productId = '';

type Envelope = { error: { code: string } };

const request = (path: string, token: string | undefined, host: string) =>
  api.request(path, {
    headers: {
      [TENANT_HOST_HEADER]: host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

async function readyMembers(token: string, host: string): Promise<OwnerMembersReady> {
  const res = await request(PATH, token, host);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = ownerMembersAnswerSchema.parse(await res.json());
  if (body.state !== 'ready') throw new Error('expected a ready members answer');
  return body;
}

/** The stored `payload.members` of `tenantId`'s snapshot of its tenant-local yesterday. */
async function storedMembers(tenantId: string) {
  const day = await dashboardDay(tenantId);
  const [row] = await adminSql<{ members: unknown }[]>`
    select payload -> 'members' as members from public.dashboard_snapshots
     where tenant_id = ${tenantId}::uuid and snapshot_day = ${day}::date`;
  return membersPayloadSchema.parse(row?.members);
}

async function memberRow(membershipId: string) {
  const [row] = await adminSql<
    { band: EngagementBandId; band_d30: EngagementBandId | null; active_days_30: number }[]
  >`
    select band, band_d30, active_days_30 from public.dashboard_member_snapshots
     where membership_id = ${membershipId}::uuid`;
  return row;
}

/** Turns `key` OFF for the seed tenant behind `host`; the returned function restores it. */
async function withModuleDisabled(host: keyof typeof HOSTS, key: 'communities' | 'events') {
  const tenantId = host === 'demo' ? tenants.demo : tenants.lab;
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenantId}::uuid and module_key = ${key}`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantId}::uuid, ${key}, false)
    on conflict (tenant_id, module_key) do update set enabled = false, updated_at = now()`;
  moduleFlags.invalidate(tenantId);
  return async () => {
    if (previous) {
      await adminSql`
        update public.tenant_modules set enabled = ${previous.enabled}, updated_at = now()
         where tenant_id = ${tenantId}::uuid and module_key = ${key}`;
    } else {
      await adminSql`
        delete from public.tenant_modules where tenant_id = ${tenantId}::uuid and module_key = ${key}`;
    }
    moduleFlags.invalidate(tenantId);
  };
}

const flowMap = (flows: OwnerMembersReady['movement']['flows']) =>
  new Map(flows.map((flow) => [`${flow.from}>${flow.to}`, flow.members]));

beforeAll(async () => {
  await removeDashboardFixtures(PREFIX.replace(/-\d+$/, ''));
  tenants.demo = await tenantIdOf('rede-demo');
  tenants.lab = await tenantIdOf('rede-lab');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
});

afterAll(async () => {
  await removeDashboardFixtures(PREFIX);
  if (productId) await removeFixtureProduct(productId);
  await adminSql.end();
});

describe('08.7 members', () => {
  const crafted = {
    superfan: '',
    engaged: '',
    occasional: '',
    atRisk: '',
    inactive: '',
    fresh: '',
  };
  let eventId = '';
  let before: OwnerMembersReady;
  let after: OwnerMembersReady;

  it('a build with no fixture yet is the baseline; member and support sessions are refused (D-462)', async () => {
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    before = await readyMembers(tokens.demoAdmin, HOSTS.demo);

    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const res = await request(PATH, token, HOSTS.demo);
      expect(res.status).toBe(403);
      expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
    }
    expect((await request(PATH, undefined, HOSTS.demo)).status).toBe(401);
  });

  it('six crafted members land in exactly the expected bands, and the counts move by one each', async () => {
    const author = await createSharedIdentity({
      prefix: `${PREFIX}-author`,
      memberships: [{ host: 'demo', role: 'support_tenant' }],
    });
    const posts: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      posts.push(await insertFixturePost({ tenantId: tenants.demo, authorUserId: author.userId }));
    }
    eventId = await insertFixtureEvent({
      tenantId: tenants.demo,
      authorUserId: author.userId,
      open: false,
      code: 'Q7MZ',
    });
    productId = await insertFixtureProduct(tenants.demo);

    const member = async (name: string, daysAgo = 100) =>
      insertMembershipAt({
        prefix: `${PREFIX}-${name}`,
        host: 'demo',
        daysAgo,
        localTime: '10:00',
      });

    // Superfan: 12 active days (D..D-11) and 3 comments, plus a removed and a self-deleted comment
    // that count nowhere (UI-D-484).
    const superfan = await member('superfan');
    crafted.superfan = superfan.membershipId;
    for (let k = 0; k < 12; k += 1) {
      await insertLikeAt({
        tenantId: tenants.demo,
        userId: superfan.userId,
        postId: posts[k] ?? '',
        k,
      });
    }
    for (const k of [0, 1, 2]) {
      await insertCommentAt({
        tenantId: tenants.demo,
        userId: superfan.userId,
        postId: posts[0] ?? '',
        k,
      });
    }
    await insertCommentAt({
      tenantId: tenants.demo,
      userId: superfan.userId,
      postId: posts[0] ?? '',
      k: 20,
      deletedBy: author.userId,
    });
    await insertCommentAt({
      tenantId: tenants.demo,
      userId: superfan.userId,
      postId: posts[0] ?? '',
      k: 21,
      deletedBy: superfan.userId,
    });

    // Engaged: 4 active days. Occasional: one RSVP "vou" on D-2. At risk: one like on D-35.
    const engaged = await member('engaged');
    crafted.engaged = engaged.membershipId;
    for (let k = 0; k < 4; k += 1) {
      await insertLikeAt({
        tenantId: tenants.demo,
        userId: engaged.userId,
        postId: posts[k] ?? '',
        k,
      });
    }
    const occasional = await member('occasional');
    crafted.occasional = occasional.membershipId;
    await insertAttendanceAt({
      tenantId: tenants.demo,
      userId: occasional.userId,
      eventId,
      status: 'going',
      k: 2,
    });
    const atRisk = await member('atrisk');
    crafted.atRisk = atRisk.membershipId;
    await insertLikeAt({
      tenantId: tenants.demo,
      userId: atRisk.userId,
      postId: posts[0] ?? '',
      k: 35,
    });

    // Inactive: no action at all. New: joined 5 days ago, one paid order on D-3 (activated).
    crafted.inactive = (await member('inactive')).membershipId;
    const fresh = await member('fresh', 5);
    crafted.fresh = fresh.membershipId;
    await insertPaidOrderAt({ tenantId: tenants.demo, userId: fresh.userId, productId, k: 3 });

    // Staff likes on the same posts change no member's numbers (UI-D-484).
    for (let k = 0; k < 12; k += 1) {
      await insertLikeAt({
        tenantId: tenants.demo,
        userId: author.userId,
        postId: posts[k] ?? '',
        k,
      });
    }

    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    after = await readyMembers(tokens.demoAdmin, HOSTS.demo);

    expect((await memberRow(crafted.superfan))?.band).toBe('superfan');
    expect((await memberRow(crafted.superfan))?.active_days_30).toBe(12);
    expect((await memberRow(crafted.engaged))?.band).toBe('engaged');
    expect((await memberRow(crafted.occasional))?.band).toBe('occasional');
    expect((await memberRow(crafted.atRisk))?.band).toBe('at_risk');
    expect((await memberRow(crafted.inactive))?.band).toBe('inactive');
    expect((await memberRow(crafted.fresh))?.band).toBe('new');
    // Staff get no member row at all.
    const [staffRows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.dashboard_member_snapshots where user_id = ${author.userId}::uuid`;
    expect(staffRows?.n).toBe(0);

    // UI-D-486: exact counts, one more in each band (the seed members did not move between builds).
    for (const band of [
      'new',
      'superfan',
      'engaged',
      'occasional',
      'at_risk',
      'inactive',
    ] as const) {
      expect(after.engagement.counts[band]).toBe(before.engagement.counts[band] + 1);
    }
    expect(after.engagement.newActivated).toBe(before.engagement.newActivated + 1);
    expect(after.growth.joined).toBe(before.growth.joined + 1);
  });

  it('UI-D-487: movement against D-30 — three up from inactive, one down to em risco, the new member in neither', async () => {
    expect(after.movement.up).toBe(before.movement.up + 3);
    expect(after.movement.down).toBe(before.movement.down + 1);
    const was = flowMap(before.movement.flows);
    const now = flowMap(after.movement.flows);
    for (const [pair, plus] of [
      ['inactive>superfan', 1],
      ['inactive>engaged', 1],
      ['inactive>occasional', 1],
      ['occasional>at_risk', 1],
    ] as const) {
      expect(now.get(pair) ?? 0).toBe((was.get(pair) ?? 0) + plus);
    }
    // Flows are most first.
    const counts = after.movement.flows.map((flow) => flow.members);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('D-465: growth.left and growth.balance are not measured, never a number', () => {
    expect(after.growth.left).toEqual({ measured: false, reason: 'needs_member_exit' });
    expect(after.growth.balance).toEqual({ measured: false, reason: 'needs_member_exit' });
    expect(after.growth.weeklyJoined).toHaveLength(12);
  });

  it('the API answer carries the stored numbers, and the overview reads the same bands', async () => {
    const stored = await storedMembers(tenants.demo);
    expect(after.engagement).toEqual(stored.engagement);
    expect(after.movement).toEqual(stored.movement);
    expect(after.cohorts).toEqual(stored.cohorts);
    expect(after.atRiskWithPush).toBe(stored.atRiskWithPush);
    expect(after.growth.joined).toBe(stored.growth.joined);

    const res = await request(OVERVIEW, tokens.demoAdmin, HOSTS.demo);
    const overview = ownerOverviewAnswerSchema.parse(await res.json());
    if (overview.state !== 'ready') throw new Error('expected a ready overview');
    expect(overview.engagement).toEqual(after.engagement);
    expect(overview.previousEngagement).toEqual(stored.previousEngagement);
    expect(overview.actions30).toBe(stored.actions30);
    expect(overview.activeMembers30).toBe(stored.activeMembers30);
    expect(overview.weeklyInteracting).toEqual(stored.weeklyInteracting);
    // growth.joined is the overview's newMembers (planning: one Window30 definition).
    expect(overview.members.newMembers).toBe(after.growth.joined);
  });

  it('with communities and events on, both scopes are present with live labels; the RSVP sits in the fixture event', () => {
    expect(after.communityEngagement).toBeDefined();
    for (const entry of after.communityEngagement ?? []) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.exclusive).toBe('boolean');
    }
    const event = after.eventEngagement?.find((entry) => entry.id === eventId);
    expect(event?.title).toBe('Encontro');
    expect(event?.bands.counts).toEqual({
      new: 0,
      superfan: 0,
      engaged: 0,
      occasional: 1,
      at_risk: 0,
      inactive: 0,
    });
  });

  it('D-460: with communities turned off the answer has no communityEngagement (restored after)', async () => {
    const restore = await withModuleDisabled('demo', 'communities');
    try {
      const off = await readyMembers(tokens.demoAdmin, HOSTS.demo);
      expect('communityEngagement' in off).toBe(false);
      expect(off.eventEngagement).toBeDefined();
    } finally {
      await restore();
    }
    const on = await readyMembers(tokens.demoAdmin, HOSTS.demo);
    expect(on.communityEngagement).toBeDefined();
  });

  it('a snapshot without its members key answers preparing, on the members read and the overview', async () => {
    const day = await dashboardDay(tenants.demo);
    await adminSql`
      update public.dashboard_snapshots set payload = payload - 'members'
       where tenant_id = ${tenants.demo}::uuid and snapshot_day = ${day}::date`;
    for (const path of [PATH, OVERVIEW]) {
      const res = await request(path, tokens.demoAdmin, HOSTS.demo);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ state: 'preparing' });
    }
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
  });

  it('EP-59 (INSIGHT-18): a shared identity’s 13 likes in rede-lab make no active day in its rede-demo row', async () => {
    const labAuthor = await createSharedIdentity({
      prefix: `${PREFIX}-labauthor`,
      memberships: [{ host: 'lab', role: 'support_tenant' }],
    });
    const shared = await createSharedIdentity({
      prefix: `${PREFIX}-shared`,
      memberships: [
        { host: 'demo', role: 'member' },
        { host: 'lab', role: 'member' },
      ],
    });
    await adminSql`
      update public.memberships set joined_at = now() - interval '100 days'
       where user_id = ${shared.userId}::uuid`;
    for (let k = 0; k < 13; k += 1) {
      const post = await insertFixturePost({
        tenantId: tenants.lab,
        authorUserId: labAuthor.userId,
      });
      await insertLikeAt({ tenantId: tenants.lab, userId: shared.userId, postId: post, k });
    }
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    expect(await rebuildDashboard(tenants.lab)).toBe('built');
    const rows = await adminSql<{ slug: string; active_days_30: number }[]>`
      select t.slug, s.active_days_30 from public.dashboard_member_snapshots s
        join public.tenants t on t.id = s.tenant_id
       where s.user_id = ${shared.userId}::uuid order by t.slug`;
    expect(rows).toEqual([
      { slug: 'rede-demo', active_days_30: 0 },
      { slug: 'rede-lab', active_days_30: 13 },
    ]);
  });
});

/**
 * 09.1-11 (PAY-16, D-498, P29, P34): a member whose subscription is not active drops out of the owner
 * dashboard's active-member population at the NEXT build, and returns with the next one. rede-lab, a
 * `payments` row with the gate on, three throwaway members (A released, B and C with no access row)
 * who each like on five recent days. The seed members of rede-lab have no access row either, so every
 * expectation is a DIFFERENCE against the build made before the gate existed, computed from that
 * build's own member rows and the live cut set, never a hard-coded count.
 */
describe('09.1 dashboard population', () => {
  const GATE = `${PREFIX}-gate`;
  const crafted = { a: '', b: '', c: '' };
  const people: Record<'a' | 'b' | 'c', { membershipId: string; userId: string; email: string }> = {
    a: { membershipId: '', userId: '', email: '' },
    b: { membershipId: '', userId: '', email: '' },
    c: { membershipId: '', userId: '', email: '' },
  };

  type Rows = { user_id: string; band: EngagementBandId; active_days_30: number }[];
  type State = {
    members: OwnerMembersReady;
    overview: OwnerOverviewReady;
    rows: Rows;
    others: unknown;
    stored: unknown;
  };

  async function readyOverview(token: string, host: string): Promise<OwnerOverviewReady> {
    const res = await request(OVERVIEW, token, host);
    expect(res.status).toBe(200);
    const body = ownerOverviewAnswerSchema.parse(await res.json());
    if (body.state !== 'ready') throw new Error('expected a ready overview');
    return body;
  }

  async function state(): Promise<State> {
    const day = await dashboardDay(tenants.lab);
    const [other] = await adminSql<{ others: unknown; stored: unknown }[]>`
      select payload - 'members' - 'overview' as others,
             jsonb_build_object('members', payload -> 'members', 'overview', payload -> 'overview') as stored
        from public.dashboard_snapshots
       where tenant_id = ${tenants.lab}::uuid and snapshot_day = ${day}::date`;
    return {
      members: await readyMembers(tokens.labAdmin, HOSTS.lab),
      overview: await readyOverview(tokens.labAdmin, HOSTS.lab),
      rows: await adminSql<Rows>`
        select user_id::text, band, active_days_30 from public.dashboard_member_snapshots
         where tenant_id = ${tenants.lab}::uuid order by user_id`,
      others: other?.others,
      stored: other?.stored,
    };
  }

  const hasRow = (s: State, userId: string) => s.rows.some((row) => row.user_id === userId);

  async function cutUserIds(): Promise<Set<string>> {
    const rows = await adminSql<{ id: string }[]>`
      select unnest(app.access_cut_user_ids(${tenants.lab}::uuid))::text as id`;
    return new Set(rows.map((row) => row.id));
  }

  /** Active member-role memberships of rede-lab in the cut set that joined inside the stated bound. */
  async function cutActiveJoined(bound: 'before-end' | 'window30'): Promise<number> {
    const day = await dashboardDay(tenants.lab);
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n
        from public.memberships m
        join public.tenants t on t.id = m.tenant_id
       where m.tenant_id = ${tenants.lab}::uuid
         and m.role = 'member' and m.status = 'active' and m.blocked_at is null and m.deleted_at is null
         and m.joined_at < ((${day}::date + 1)::timestamp at time zone t.timezone)
         and (${bound} = 'before-end'
              or m.joined_at >= ((${day}::date - 29)::timestamp at time zone t.timezone))
         and m.user_id = any (app.access_cut_user_ids(${tenants.lab}::uuid))`;
    return row?.n ?? 0;
  }

  const grant = (email: string) =>
    adminSql`
      insert into public.access_grants (tenant_id, email, source, status)
      values (${tenants.lab}::uuid, ${email}, 'manual', 'active')
      on conflict do nothing`;
  const ungrant = (email: string) =>
    adminSql`
      delete from public.access_grants where tenant_id = ${tenants.lab}::uuid and email = ${email}`;

  let baseline: State;

  beforeAll(async () => {
    await adminSql`delete from public.access_grants where email like ${`${GATE}-%`}`;
    const author = await createSharedIdentity({
      prefix: `${GATE}-author`,
      memberships: [{ host: 'lab', role: 'support_tenant' }],
    });
    const posts: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      posts.push(await insertFixturePost({ tenantId: tenants.lab, authorUserId: author.userId }));
    }
    for (const key of ['a', 'b', 'c'] as const) {
      const made = await insertMembershipAt({
        prefix: `${GATE}-${key}`,
        host: 'lab',
        daysAgo: 100,
        localTime: '10:00',
      });
      people[key] = { membershipId: made.membershipId, userId: made.userId, email: made.email };
      crafted[key] = made.membershipId;
      for (let k = 0; k < 5; k += 1) {
        await insertLikeAt({
          tenantId: tenants.lab,
          userId: made.userId,
          postId: posts[k] ?? '',
          k,
        });
      }
    }
    expect(await rebuildDashboard(tenants.lab)).toBe('built');
    baseline = await state();
  });

  afterAll(async () => {
    await adminSql`delete from public.access_grants where email like ${`${GATE}-%`}`;
  });

  it('with the gate off the three crafted members are active members, and the tenant has a baseline', () => {
    for (const key of ['a', 'b', 'c'] as const) {
      expect(hasRow(baseline, people[key].userId), key).toBe(true);
    }
    expect(baseline.members.engagement.counts).toEqual(baseline.overview.engagement.counts);
  });

  it('gate on: B and C leave every active-member figure by exactly the cut members, A stays, the other areas do not move', async () => {
    await withPaymentsGate(tenants.lab, async () => {
      await grant(people.a.email);
      const cut = await cutUserIds();
      expect(cut.has(people.b.userId)).toBe(true);
      expect(cut.has(people.c.userId)).toBe(true);
      expect(cut.has(people.a.userId)).toBe(false);

      expect(await rebuildDashboard(tenants.lab)).toBe('built');
      const after = await state();

      expect(hasRow(after, people.a.userId)).toBe(true);
      expect(hasRow(after, people.b.userId)).toBe(false);
      expect(hasRow(after, people.c.userId)).toBe(false);

      const gone = baseline.rows.filter((row) => cut.has(row.user_id));
      expect(gone.length).toBeGreaterThanOrEqual(2);
      expect(after.rows.map((row) => row.user_id).sort()).toEqual(
        baseline.rows
          .filter((row) => !cut.has(row.user_id))
          .map((row) => row.user_id)
          .sort(),
      );

      // The exact figures: the baseline minus the cut members, never more.
      expect(after.overview.activeMembers30).toBe(
        baseline.overview.activeMembers30 - gone.filter((row) => row.active_days_30 > 0).length,
      );
      for (const band of Object.keys(baseline.members.engagement.counts) as EngagementBandId[]) {
        expect(after.members.engagement.counts[band], band).toBe(
          baseline.members.engagement.counts[band] - gone.filter((row) => row.band === band).length,
        );
      }
      expect(after.members.growth.joined).toBe(
        baseline.members.growth.joined - (await cutActiveJoined('window30')),
      );
      expect(after.overview.members.count).toBe(
        baseline.overview.members.count - (await cutActiveJoined('before-end')),
      );
      expect(after.overview.members.newMembers).toBe(after.members.growth.joined);
      expect(after.overview.members.previous).toBe(baseline.overview.members.previous);

      // Content and money are not members: every other area is what it was.
      expect(after.others).toEqual(baseline.others);
    });
  });

  it('a return brings the member back at the next build, a cut after the build stays in that build (P29), a rebuild is stable (P34)', async () => {
    await withPaymentsGate(tenants.lab, async () => {
      await grant(people.a.email);
      expect(await rebuildDashboard(tenants.lab)).toBe('built');
      const cutBuild = await state();

      // C returns; nothing moves until the next build.
      await grant(people.c.email);
      const unchanged = await state();
      expect(hasRow(unchanged, people.c.userId)).toBe(false);
      expect(unchanged.overview.members.count).toBe(cutBuild.overview.members.count);

      expect(await rebuildDashboard(tenants.lab)).toBe('built');
      const returned = await state();
      expect(hasRow(returned, people.c.userId)).toBe(true);
      expect(returned.overview.members.count).toBe(cutBuild.overview.members.count + 1);
      expect(returned.overview.activeMembers30).toBe(cutBuild.overview.activeMembers30 + 1);
      expect(returned.members.growth.joined).toBe(cutBuild.members.growth.joined);

      // A is cut AFTER this build: the build keeps counting A until the next one.
      await ungrant(people.a.email);
      const stale = await state();
      expect(hasRow(stale, people.a.userId)).toBe(true);
      expect(stale.overview.members.count).toBe(returned.overview.members.count);

      expect(await rebuildDashboard(tenants.lab)).toBe('built');
      const next = await state();
      expect(hasRow(next, people.a.userId)).toBe(false);
      expect(next.overview.members.count).toBe(returned.overview.members.count - 1);

      // Rebuilding the same day again yields the same figures.
      expect(await rebuildDashboard(tenants.lab)).toBe('built');
      const again = await state();
      expect(again.stored).toEqual(next.stored);
      expect(again.rows).toEqual(next.rows);
    });
  });

  it('P31: a tenant whose every member is cut reports zero active members, answers 200 and divides by nothing', async () => {
    const saved = await adminSql<
      {
        email: string;
        source: string;
        status: string;
        provider: string | null;
        external_ref: string | null;
      }[]
    >`
      select email, source, status, provider, external_ref from public.access_grants
       where tenant_id = ${tenants.lab}::uuid`;
    await adminSql`delete from public.access_grants where tenant_id = ${tenants.lab}::uuid`;
    try {
      await withPaymentsGate(tenants.lab, async () => {
        expect(await rebuildDashboard(tenants.lab)).toBe('built');
        const all = await state();
        expect(all.rows).toEqual([]);
        expect(all.overview.members.count).toBe(0);
        expect(all.overview.members.newMembers).toBe(0);
        expect(all.overview.activeMembers30).toBe(0);
        expect(all.members.growth.joined).toBe(0);
        expect(Object.values(all.members.engagement.counts).every((n) => n === 0)).toBe(true);
        expect(all.members.engagement.newActivated).toBe(0);
        expect(all.members.movement.up).toBe(0);
        expect(all.members.movement.down).toBe(0);
      });
    } finally {
      for (const row of saved) {
        await adminSql`
          insert into public.access_grants (tenant_id, email, source, status, provider, external_ref)
          values (${tenants.lab}::uuid, ${row.email}, ${row.source}, ${row.status}, ${row.provider},
                  ${row.external_ref})
          on conflict do nothing`;
      }
    }
  });

  it('with the gate off again every crafted member is counted, as at the baseline', async () => {
    expect(await rebuildDashboard(tenants.lab)).toBe('built');
    const off = await state();
    for (const key of ['a', 'b', 'c'] as const) {
      expect(hasRow(off, people[key].userId), key).toBe(true);
    }
    expect(off.overview.members.count).toBe(baseline.overview.members.count);
    expect(off.overview.activeMembers30).toBe(baseline.overview.activeMembers30);
    expect(off.members.engagement).toEqual(baseline.members.engagement);
  });
});
