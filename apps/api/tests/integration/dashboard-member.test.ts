import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  type MemberActivityAnswer,
  memberActivityAnswerSchema,
} from '@rede-social/module-dashboard/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertAttendanceAt,
  insertCommentAt,
  insertFixtureEvent,
  insertFixturePost,
  insertLikeAt,
  insertMembershipAt,
  insertStoryViewAt,
  moveFixtureEvent,
  rebuildDashboard,
  removeDashboardFixtures,
  tenantIdOf,
} from './dashboard-fixture';
import { adminSql, api, createSharedIdentity, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Phase 08.7 — the member's own "Sua atividade" (08.7-03, D-455, D-458, D-463, UI-D-475, UI-D-485,
 * INSIGHT-01..05, INSIGHT-16): crafted members whose every action is dated at an explicit
 * tenant-local instant of D-k (R-Pitfall 13), a build for the tenant-local yesterday through the
 * real job body, then `GET /v1/dashboard/activity` in each member's own session. The route takes no
 * parameter: it reads the caller's own member row (RLS `user_id = app.user_id()`), member role only.
 */

const PREFIX = `dash87a-${Date.now()}`;
const PATH = '/v1/dashboard/activity';
const tokens = { demoAdmin: '', demoSupport: '' };
const tenants = { demo: '' };

type Envelope = { error: { code: string } };
type Ready = Extract<MemberActivityAnswer, { state: 'ready' }>;

const request = (path: string, token: string | undefined, host: string) =>
  api.request(path, {
    headers: {
      [TENANT_HOST_HEADER]: host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

async function answerOf(token: string, path = PATH): Promise<MemberActivityAnswer> {
  const res = await request(path, token, HOSTS.demo);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return memberActivityAnswerSchema.parse(await res.json());
}

async function readyOf(token: string, path = PATH): Promise<Ready> {
  const answer = await answerOf(token, path);
  if (answer.state !== 'ready') throw new Error('expected a ready activity answer');
  return answer;
}

/** Turns `key` OFF for rede-demo; the returned function restores it. */
async function withModuleDisabled(key: 'communities' | 'events') {
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
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
});

afterAll(async () => {
  await removeDashboardFixtures(PREFIX);
  await adminSql.end();
});

describe('08.7 activity', () => {
  const members = { main: '', edges: '', quiet: '' };
  const ids = { main: '', quiet: '' };
  let community = { id: '', name: '' };

  it('crafted members: likes, comments, story views and attendance dated at tenant-local instants', async () => {
    const author = await createSharedIdentity({
      prefix: `${PREFIX}-author`,
      memberships: [{ host: 'demo', role: 'support_tenant' }],
    });
    const [seedCommunity] = await adminSql<{ id: string; name: string }[]>`
      select id::text as id, name from public.communities
       where tenant_id = ${tenants.demo}::uuid and status = 'active' and deleted_at is null
       order by position, id
       limit 1`;
    if (!seedCommunity) throw new Error('rede-demo has no active community — run pnpm db:seed');
    community = seedCommunity;
    const posts: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      posts.push(await insertFixturePost({ tenantId: tenants.demo, authorUserId: author.userId }));
    }
    const communityPost = await insertFixturePost({
      tenantId: tenants.demo,
      authorUserId: author.userId,
      communityId: community.id,
    });
    const member = (name: string) =>
      insertMembershipAt({ prefix: `${PREFIX}-${name}`, host: 'demo', daysAgo: 100, localTime: '10:00' });

    // The behavior case: 3 likes in D-6..D (one on a community post) and 1 in D-13..D-7, 2 live
    // comments in D-6..D, 2 story views in D-6..D and 1 in D-13..D-7, an RSVP "vou" then a
    // check-in on an event of D-10 and a walk-in on an event of D-3.
    const main = await member('main');
    ids.main = main.userId;
    for (const [i, k] of [0, 2, 9].entries()) {
      await insertLikeAt({ tenantId: tenants.demo, userId: main.userId, postId: posts[i] ?? '', k });
    }
    await insertLikeAt({ tenantId: tenants.demo, userId: main.userId, postId: communityPost, k: 4 });
    for (const k of [1, 5]) {
      await insertCommentAt({ tenantId: tenants.demo, userId: main.userId, postId: posts[0] ?? '', k });
    }
    for (const k of [0, 6, 8]) {
      await insertStoryViewAt({ tenantId: tenants.demo, userId: main.userId, k });
    }
    const rsvpEvent = await insertFixtureEvent({
      tenantId: tenants.demo,
      authorUserId: author.userId,
      open: true,
      code: 'A2C7',
    });
    await insertAttendanceAt({
      tenantId: tenants.demo,
      userId: main.userId,
      eventId: rsvpEvent,
      status: 'checked_in',
      k: 10,
    });
    await moveFixtureEvent({ tenantId: tenants.demo, eventId: rsvpEvent, k: 10 });
    const walkInEvent = await insertFixtureEvent({
      tenantId: tenants.demo,
      authorUserId: author.userId,
      open: true,
      code: 'A2C8',
    });
    await insertAttendanceAt({
      tenantId: tenants.demo,
      userId: main.userId,
      eventId: walkInEvent,
      status: 'walk_in',
      k: 3,
    });
    await moveFixtureEvent({ tenantId: tenants.demo, eventId: walkInEvent, k: 3 });
    members.main = await signInAs(main.email, SEED_PASSWORD);

    // EP-01: 23:59 of D and 00:00 of D-6 count, 23:59 of D-7 is previous, a like today counts nowhere.
    const edges = await member('edges');
    const edgeLikes: [number, string][] = [
      [0, '23:59'],
      [6, '00:00'],
      [7, '23:59'],
      [-1, '00:01'],
    ];
    for (const [i, [k, localTime]] of edgeLikes.entries()) {
      await insertLikeAt({
        tenantId: tenants.demo,
        userId: edges.userId,
        postId: posts[i] ?? '',
        k,
        localTime,
      });
    }
    members.edges = await signInAs(edges.email, SEED_PASSWORD);

    // EP-02: a member with no action in 14 days.
    const quiet = await member('quiet');
    ids.quiet = quiet.userId;
    members.quiet = await signInAs(quiet.email, SEED_PASSWORD);

    expect(await rebuildDashboard(tenants.demo)).toBe('built');
  });

  it('the behavior case: likes 3/1, comments 2/0, stories seen 2, attendance 2 of 2, Em breve everywhere else', async () => {
    const answer = await readyOf(members.main);
    expect(answer.likes).toEqual({ count: 3, previous: 1 });
    expect(answer.comments).toEqual({ count: 2, previous: 0 });
    expect(answer.seen.stories).toBe(2);
    expect(answer.attendance).toEqual({ attended: 2, events: 2 });
    // D-455: every unmeasured metric is `{ measured: false, reason }`, never a number.
    expect(answer.saves).toEqual({ measured: false, reason: 'needs_saves' });
    expect(answer.shares).toEqual({ measured: false, reason: 'needs_shares' });
    expect(answer.usage).toEqual({ measured: false, reason: 'needs_usage_sessions' });
    expect(answer.seen.posts).toEqual({ measured: false, reason: 'needs_post_views' });
    expect(answer.seen.videos).toEqual({ measured: false, reason: 'needs_video_playback' });
    expect(answer.weekStreak).toBeGreaterThanOrEqual(1);
  });

  it('UI-D-475 / EP-07: Onde você mais participa — the tenant-wide feed as a null row, the community with its live name', async () => {
    const answer = await readyOf(members.main);
    expect(answer.byCommunity).toEqual([
      // 2 likes and 2 comments on tenant-wide posts in D-6..D (the D-9 like is outside the window).
      { communityId: null, name: null, interactions: 4 },
      { communityId: community.id, name: community.name, interactions: 1 },
    ]);
  });

  it('EP-01: the Window7 edges in tenant time', async () => {
    const answer = await readyOf(members.edges);
    expect(answer.likes).toEqual({ count: 2, previous: 1 });
  });

  it('EP-02: a member with no action answers real zeros, never Em breve', async () => {
    const answer = await readyOf(members.quiet);
    expect(answer.likes).toEqual({ count: 0, previous: 0 });
    expect(answer.comments).toEqual({ count: 0, previous: 0 });
    expect(answer.seen.stories).toBe(0);
    expect(answer.byCommunity).toEqual([]);
    expect(answer.attendance).toEqual({ attended: 0, events: 0 });
    expect(answer.weekStreak).toBe(0);
  });

  it('T-08.7-09: a ?userId= of another member is ignored — the answer is the caller’s own', async () => {
    const own = await readyOf(members.quiet);
    const probed = await readyOf(members.quiet, `${PATH}?userId=${ids.main}`);
    expect(probed).toEqual(own);
    expect(JSON.stringify(probed)).not.toContain(ids.main);
  });

  it('T-08.7-10: admin_tenant and support_tenant are refused (403 FORBIDDEN); anonymous is 401', async () => {
    for (const token of [tokens.demoAdmin, tokens.demoSupport]) {
      const res = await request(PATH, token, HOSTS.demo);
      expect(res.status).toBe(403);
      expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
    }
    expect((await request(PATH, undefined, HOSTS.demo)).status).toBe(401);
  });

  it('INSIGHT-16: a member who joined after the build answers preparing', async () => {
    const fresh = await insertMembershipAt({
      prefix: `${PREFIX}-fresh`,
      host: 'demo',
      daysAgo: 0,
      localTime: '00:00',
    });
    const token = await signInAs(fresh.email, SEED_PASSWORD);
    expect(await answerOf(token)).toEqual({ state: 'preparing' });
  });

  it('INSIGHT-16: a member row with a null or invalid activity answers preparing', async () => {
    const restore = await adminSql<{ activity: unknown }[]>`
      select activity from public.dashboard_member_snapshots
       where tenant_id = ${tenants.demo}::uuid and user_id = ${ids.quiet}::uuid`;
    try {
      await adminSql`
        update public.dashboard_member_snapshots set activity = null
         where tenant_id = ${tenants.demo}::uuid and user_id = ${ids.quiet}::uuid`;
      expect(await answerOf(members.quiet)).toEqual({ state: 'preparing' });
      await adminSql`
        update public.dashboard_member_snapshots set activity = '{"likes": 3}'::jsonb
         where tenant_id = ${tenants.demo}::uuid and user_id = ${ids.quiet}::uuid`;
      expect(await answerOf(members.quiet)).toEqual({ state: 'preparing' });
    } finally {
      await adminSql`
        update public.dashboard_member_snapshots
           set activity = ${adminSql.json(restore[0]?.activity as never)}
         where tenant_id = ${tenants.demo}::uuid and user_id = ${ids.quiet}::uuid`;
    }
  });

  it('D-460: with communities off the answer omits byCommunity; with events off it omits attendance', async () => {
    const restoreCommunities = await withModuleDisabled('communities');
    try {
      const answer = await readyOf(members.main);
      expect(answer).not.toHaveProperty('byCommunity');
      expect(answer.attendance).toEqual({ attended: 2, events: 2 });
    } finally {
      await restoreCommunities();
    }
    const restoreEvents = await withModuleDisabled('events');
    try {
      const answer = await readyOf(members.main);
      expect(answer).not.toHaveProperty('attendance');
      expect(answer.byCommunity).toHaveLength(2);
    } finally {
      await restoreEvents();
    }
  });
});
