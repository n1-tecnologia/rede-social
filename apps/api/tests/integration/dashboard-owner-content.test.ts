import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  type ContentItemAnswer,
  type OwnerContentReady,
  ownerContentAnswerSchema,
} from '@rede-social/module-dashboard/contracts';
import { runSnapshotBuild } from '@rede-social/module-dashboard/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dashboardDay,
  insertCommentAt,
  insertLikeAt,
  insertMembershipAt,
  insertPostAt,
  insertReplyAt,
  insertStoryAt,
  insertStoryViewAt,
  rebuildDashboard,
  removeDashboardFixtures,
  tenantIdOf,
} from './dashboard-fixture';
import { adminSql, api, createSharedIdentity, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Phase 08.7 — the owner's Conteúdo on real data (08.7-06, D-455, D-458, D-462, UI-D-473, UI-D-484,
 * UI-D-488, INSIGHT-10, INSIGHT-14, EP-27..EP-31, EP-44..EP-49): crafted rede-demo publications of
 * every kind, each like and comment dated at an explicit tenant-local instant, one build through the
 * real job body, then the area. The seed's own posts sit in the same window, so every assertion
 * names a crafted item by id. The slot and empty cases build rede-lab for OLD days (D-60, D-120),
 * whose windows hold only crafted posts.
 */

const PREFIX = `dash87c-${Date.now()}`;
const LINKS = 'https://painel.example/dash87c';
const CONTENT = '/v1/dashboard/owner/content';

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labAdmin: '' };
const tenants = { demo: '', lab: '' };
const users = { author: '', labAuthor: '', a: '', b: '', c: '' };
const items = {
  video: '',
  photo: '',
  carousel: '',
  text: '',
  link: '',
  story: '',
  edgeIn: '',
  edgeOut: '',
  tieA: '',
  tieB: '',
};

const request = (path: string, token: string | undefined, host: string) =>
  api.request(path, {
    headers: {
      [TENANT_HOST_HEADER]: host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

async function contentOf(token = tokens.demoAdmin, host = HOSTS.demo): Promise<OwnerContentReady> {
  const res = await request(CONTENT, token, host);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = ownerContentAnswerSchema.parse(await res.json());
  if (body.state !== 'ready') throw new Error('expected a ready content answer');
  return body;
}

function itemOf(answer: OwnerContentReady, id: string): ContentItemAnswer {
  const item = answer.items.find((row) => row.id === id);
  if (!item) throw new Error(`no item ${id} in the answer`);
  return item;
}

/** Turns `key` OFF for rede-demo; the returned function restores the previous state. */
async function withDemoModuleOff(key: 'feed' | 'stories') {
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

/** `day` (an ISO date) minus `k` days. */
function dayMinus(day: string, k: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - k);
  return at.toISOString().slice(0, 10);
}

/** The ISO weekday (1 = Monday … 7 = Sunday) of an ISO date. */
function isoWeekday(day: string): number {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Rebuilds rede-lab for the explicit OLD day `day` (its newest snapshot afterwards). */
async function buildLabFor(day: string): Promise<void> {
  await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.lab}::uuid`;
  expect(await runSnapshotBuild({ tenantId: tenants.lab, day })).toBe('built');
}

beforeAll(async () => {
  await removeDashboardFixtures(PREFIX.replace(/-\d+$/, ''), LINKS);
  tenants.demo = await tenantIdOf('rede-demo');
  tenants.lab = await tenantIdOf('rede-lab');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);

  // The author is staff (support_tenant): its likes and replies are the staff the panel excludes.
  const author = await createSharedIdentity({
    prefix: `${PREFIX}-author`,
    memberships: [{ host: 'demo', role: 'support_tenant' }],
  });
  users.author = author.userId;
  const labAuthor = await createSharedIdentity({
    prefix: `${PREFIX}-labauthor`,
    memberships: [{ host: 'lab', role: 'support_tenant' }],
  });
  users.labAuthor = labAuthor.userId;
  for (const name of ['a', 'b', 'c'] as const) {
    const member = await insertMembershipAt({
      prefix: `${PREFIX}-${name}`,
      host: 'demo',
      daysAgo: 100,
      localTime: '10:00',
    });
    users[name] = member.userId;
  }

  const post = (kind: Parameters<typeof insertPostAt>[0]['kind'], k: number, localTime: string) =>
    insertPostAt({
      tenantId: tenants.demo,
      authorUserId: users.author,
      kind,
      k,
      localTime,
      linkPrefix: LINKS,
      caption: `Publicação ${kind} do painel`,
    });
  items.video = await post('video', 3, '10:00');
  items.photo = await post('photo', 4, '09:00');
  items.carousel = await post('carousel', 5, '09:00');
  items.text = await post('text', 2, '12:00');
  items.link = await post('link', 6, '09:00');
  items.story = await insertStoryAt({
    tenantId: tenants.demo,
    authorUserId: users.author,
    k: 2,
    localTime: '20:00',
  });
  // EP-27: 00:00 of D-29 is in the window, 23:59 of D-30 is not.
  items.edgeIn = await post('text', 29, '00:00');
  items.edgeOut = await post('text', 30, '23:59');
  // EP-30: two posts at the very same instant are ordered by id desc.
  const [tie] = await adminSql<{ at: string }[]>`
    select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
      from public.feed_posts where id = ${items.photo}::uuid`;
  const tieAt = new Date(new Date(tie?.at ?? '').getTime() + 3 * 3600_000).toISOString();
  items.tieA = await insertPostAt({
    tenantId: tenants.demo,
    authorUserId: users.author,
    k: 0,
    at: tieAt,
  });
  items.tieB = await insertPostAt({
    tenantId: tenants.demo,
    authorUserId: users.author,
    k: 0,
    at: tieAt,
  });

  // The video: a +1h and b +7h member likes; the staff author's like counts nowhere (UI-D-484).
  await insertLikeAt({
    tenantId: tenants.demo,
    userId: users.a,
    postId: items.video,
    k: 3,
    localTime: '11:00',
  });
  await insertLikeAt({
    tenantId: tenants.demo,
    userId: users.b,
    postId: items.video,
    k: 3,
    localTime: '17:00',
  });
  await insertLikeAt({
    tenantId: tenants.demo,
    userId: users.author,
    postId: items.video,
    k: 3,
    localTime: '10:30',
  });
  // The text post's thread: a's root answered by staff 30 minutes later; b's root unanswered.
  const answered = await insertCommentAt({
    tenantId: tenants.demo,
    userId: users.a,
    postId: items.text,
    k: 2,
    localTime: '13:00',
  });
  await insertReplyAt({
    tenantId: tenants.demo,
    userId: users.author,
    postId: items.text,
    parentId: answered,
    k: 2,
    localTime: '13:30',
  });
  await insertCommentAt({
    tenantId: tenants.demo,
    userId: users.b,
    postId: items.text,
    k: 1,
    localTime: '09:00',
  });
  // The story: a and b view it, the staff author views it too; c likes it, a comments on it.
  for (const userId of [users.a, users.b, users.author]) {
    await insertStoryViewAt({
      tenantId: tenants.demo,
      userId,
      k: 2,
      localTime: '21:00',
      storyId: items.story,
    });
  }
  await insertLikeAt({
    tenantId: tenants.demo,
    userId: users.c,
    storyId: items.story,
    k: 2,
    localTime: '22:00',
  });
  await insertCommentAt({
    tenantId: tenants.demo,
    userId: users.a,
    storyId: items.story,
    k: 2,
    localTime: '22:30',
  });

  expect(await rebuildDashboard(tenants.demo)).toBe('built');
});

afterAll(async () => {
  await removeDashboardFixtures(PREFIX.replace(/-\d+$/, ''), LINKS);
});

describe('08.7 content', () => {
  it('INSIGHT-10: names the kind of each crafted publication', async () => {
    const answer = await contentOf();
    expect(itemOf(answer, items.video).kind).toBe('video');
    expect(itemOf(answer, items.photo).kind).toBe('photo');
    expect(itemOf(answer, items.carousel).kind).toBe('carousel');
    expect(itemOf(answer, items.text).kind).toBe('text');
    expect(itemOf(answer, items.link).kind).toBe('link');
    expect(itemOf(answer, items.story).kind).toBe('story');
    expect(answer.kinds).toEqual(['video', 'photo', 'carousel', 'text', 'link', 'story']);
  });

  it('joins the live labels: excerpt, cover, size, length and image count', async () => {
    const answer = await contentOf();
    const video = itemOf(answer, items.video);
    expect(video.excerpt).toBe('Publicação video do painel');
    expect(video.coverAssetId).not.toBeNull();
    expect(video.media).toEqual({ width: 1080, height: 1920 });
    expect(video.durationSeconds).toBe(42);
    expect(itemOf(answer, items.carousel).cards).toBe(3);
    expect(itemOf(answer, items.photo).cards).toBe(1);
    expect(itemOf(answer, items.text).media).toBeNull();
    expect(itemOf(answer, items.link).coverAssetId).toBeNull();
  });

  it('UI-D-484: counts member likes and comments only (the staff like and replies count nowhere)', async () => {
    const answer = await contentOf();
    const video = itemOf(answer, items.video);
    expect(video.likes).toBe(2);
    const text = itemOf(answer, items.text);
    expect(text.comments).toBe(2);
    if (text.kind === 'story') throw new Error('the text post is a post');
    expect(text.commentMeta).toMatchObject({
      answered: 1,
      unanswered: 1,
      firstReplyMedianMinutes: 30,
    });
    expect(text.commentMeta.oldestUnansweredHours).toBeGreaterThanOrEqual(24);
  });

  it('D-455 / D-458: a post is not measured beyond likes and comments; a story has measured views', async () => {
    const answer = await contentOf();
    const video = itemOf(answer, items.video);
    expect(video.views).toEqual({ measured: false, reason: 'needs_post_views' });
    expect(video.reach).toEqual({ measured: false, reason: 'needs_post_views' });
    expect(video.saves).toEqual({ measured: false, reason: 'needs_saves' });
    expect(video.shares).toEqual({ measured: false, reason: 'needs_shares' });
    const story = itemOf(answer, items.story);
    expect(story.views).toEqual({ measured: true, value: 2 });
    expect(story.reach).toEqual({ measured: true, value: 2 });
    expect(story.saves).toBeNull();
    expect(story.likes).toBe(1);
    expect(story.comments).toBe(1);
    expect('commentMeta' in story).toBe(false);
    expect(answer.kpis?.rate).toEqual({ measured: false, reason: 'needs_post_views' });
    expect(answer.kindMetrics.video).toEqual({ measured: false, reason: 'needs_video_playback' });
    expect(answer.kindMetrics.story).toEqual({ measured: false, reason: 'needs_story_taps' });
  });

  it('D-462 / PR-5: the area answer carries no association, reach split or viewer', async () => {
    const res = await request(CONTENT, tokens.demoAdmin, HOSTS.demo);
    const raw = await res.text();
    for (const key of ['reactivated', 'rsvps', 'orders', 'vitrine', 'reachByBand', 'velocity48h']) {
      expect(raw).not.toContain(`"${key}"`);
    }
    for (const viewer of [users.a, users.b]) expect(raw).not.toContain(viewer);
  });

  it('EP-27: a post at local 00:00 of D-29 is in the window, one at 23:59 of D-30 is not', async () => {
    const answer = await contentOf();
    expect(answer.items.some((item) => item.id === items.edgeIn)).toBe(true);
    expect(answer.items.some((item) => item.id === items.edgeOut)).toBe(false);
  });

  it('EP-30: items are createdAt desc, then id desc on a tie', async () => {
    const answer = await contentOf();
    const order = answer.items.map((item) => `${item.createdAt}|${item.id}`);
    expect(order).toEqual([...order].sort().reverse());
    const ids = answer.items.map((item) => item.id);
    const [first, second] = [items.tieA, items.tieB].sort().reverse();
    expect(ids.indexOf(first ?? '')).toBe(ids.indexOf(second ?? '') - 1);
  });

  it('EP-29: a tenant with no publication in the window answers empty, every kind and cell 0', async () => {
    const day = await dashboardDay(tenants.lab);
    await buildLabFor(dayMinus(day, 120));
    const answer = await contentOf(tokens.labAdmin, HOSTS.lab);
    expect(answer.items).toEqual([]);
    expect(answer.kinds).not.toContain('story');
    expect(answer.byKind.every((row) => row.items === 0 && row.likes === 0)).toBe(true);
    expect(answer.heatmap).toHaveLength(28);
    expect(answer.heatmap?.every((cell) => cell.posts === 0 && cell.interactions === 0)).toBe(true);
    expect(answer.weeklyPerPost?.posts).toEqual(Array.from({ length: 12 }, () => 0));
    expect(answer.kpis?.posts).toEqual({ current: 0, previous: 0 });
  });

  it('EP-28: 05:59 → 0h–6h, 06:00 → 6h–12h, Sunday 23:59 and 23:30 (02:30Z) → Sunday 18h–24h', async () => {
    const today = await dashboardDay(tenants.lab);
    const labDay = dayMinus(today, 60);
    // Build days are relative to the tenant-local yesterday: D-k for k = 60 + j lands j days before labDay.
    const kOf = (weekday: number) => {
      for (let j = 1; j <= 7; j += 1) {
        if (isoWeekday(dayMinus(labDay, j)) === weekday) return 60 + j;
      }
      throw new Error(`no weekday ${weekday}`);
    };
    const labPost = (k: number, localTime: string) =>
      insertPostAt({ tenantId: tenants.lab, authorUserId: users.labAuthor, k, localTime });
    await labPost(kOf(3), '05:59');
    await labPost(kOf(3), '06:00');
    await labPost(kOf(7), '23:59');
    await labPost(kOf(7), '23:30');
    await buildLabFor(labDay);
    const answer = await contentOf(tokens.labAdmin, HOSTS.lab);
    const cell = (weekday: string, fromHour: number) =>
      answer.heatmap?.find((row) => row.weekday === weekday && row.fromHour === fromHour)?.posts;
    expect(cell('wed', 0)).toBe(1);
    expect(cell('wed', 6)).toBe(1);
    expect(cell('sun', 18)).toBe(2);
    expect(cell('mon', 0)).toBe(0);
    expect(answer.heatmap?.reduce((sum, row) => sum + row.posts, 0)).toBe(4);
    expect(answer.kpis?.posts.current).toBe(4);
    expect(answer.byCommunity).toBeUndefined();
  });

  it('UI-D-473: with stories off the stories are absent; with feed off only stories remain', async () => {
    const restoreStories = await withDemoModuleOff('stories');
    try {
      const answer = await contentOf();
      expect(answer.items.some((item) => item.kind === 'story')).toBe(false);
      expect(answer.kinds).not.toContain('story');
      expect(answer.kindMetrics.story).toBeUndefined();
      expect(answer.kpis).toBeDefined();
    } finally {
      await restoreStories();
    }
    const restoreFeed = await withDemoModuleOff('feed');
    try {
      const answer = await contentOf();
      expect(answer.items.every((item) => item.kind === 'story')).toBe(true);
      expect(answer.items.some((item) => item.id === items.story)).toBe(true);
      expect(answer.kinds).toEqual(['story']);
      expect(answer.kpis).toBeUndefined();
      expect(answer.heatmap).toBeUndefined();
    } finally {
      await restoreFeed();
    }
  });

  it('UI-D-473: with feed AND stories off the area is 404 MODULE_DISABLED', async () => {
    const restoreStories = await withDemoModuleOff('stories');
    const restoreFeed = await withDemoModuleOff('feed');
    try {
      const res = await request(CONTENT, tokens.demoAdmin, HOSTS.demo);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'MODULE_DISABLED',
      );
    } finally {
      await restoreFeed();
      await restoreStories();
    }
  });

  it('D-462: only admin_tenant reads Conteúdo (member and support 403, anonymous 401)', async () => {
    expect((await request(CONTENT, tokens.demoMember, HOSTS.demo)).status).toBe(403);
    expect((await request(CONTENT, tokens.demoSupport, HOSTS.demo)).status).toBe(403);
    expect((await request(CONTENT, undefined, HOSTS.demo)).status).toBe(401);
  });
});
