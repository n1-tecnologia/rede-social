import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ReportCreated } from '@rede-social/contracts/moderation';
import { sqlClient } from '@rede-social/core/db';
import { subscribe } from '@rede-social/core/server/events/bus';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { reportLimiter } from '@rede-social/core/server/safety/limits';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { caseKit, removeThrowaways, SEED_THREAD } from './chat-case-fixtures';
import { readyVoiceAsset, removeVoiceRows } from './chat-voice-fixtures';
import {
  directMember,
  readMessages,
  removeDirectRows,
  resetDirectLimiters,
  sendDirect,
  setModule,
  withDirectModules,
} from './direct-fixtures';
import {
  adminSql,
  api,
  HOSTS,
  SEED_PASSWORD,
  signInAs,
  withCommunitiesEnabled,
  withSocialEnabled,
  withStoreEnabled,
  withStoriesEnabled,
} from './setup';

/**
 * Phase 11 plan 14 (MODER-05; D-616, D-729, D-730, D-731; T-11-01, T-11-09, T-11-12, T-11-28): the API half of
 * reporting four more subjects (a story, a comment on a story, a community and one direct message), against the live
 * local stack.
 *
 * `report filing tracer` files each subject through `POST /v1/reports` as the reporter, reads the administrator's
 * queue and asserts the `report.created` event (ids only). Every miss, whatever its cause, is ONE bare 404 with an
 * identical body, so the route is no existence oracle. `report queue projection`, `report social off`, `report
 * concurrency` and `report tenant isolation` follow in this file.
 *
 * FIXTURES. Stories, story comments and communities live on rede-lab (`social` ON in the seed, `stories` and
 * `communities` turned on for the span); messages live on rede-demo between two throwaway members (`social` and `chat`
 * turned on for the span). Every row carries `PREFIX` or an id this file made, so the sweep is exact, and the seeded
 * rows are never touched. Seed follows used: Alvaro follows Helena, Helena follows Marcos; nobody else follows anyone.
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };

const PREFIX = 'Teste 11-14 ';
const tokens = {
  helena: '',
  marcos: '',
  alvaro: '',
  labAdmin: '',
  demoAdmin: '',
  demoMember: '',
  demoSupport: '',
};
const userIds = { helena: '', marcos: '', alvaro: '', labAdmin: '', demoMember: '' };
let labTenantId = '';
let restoreSocialLab: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
let restoreCommunities: () => Promise<void> = async () => {};
let restoreDirect: () => Promise<void> = async () => {};
let restoreDemoStories: () => Promise<void> = async () => {};
let restoreDemoCommunities: () => Promise<void> = async () => {};
let demoTenantId = '';
let demoAdminId = '';

const createdReports: string[] = [];
const createdAssets: string[] = [];
const createdCommunities: string[] = [];
const createdStories: string[] = [];
const createdComments: string[] = [];
const events: ReportCreated[] = [];
const voiceOwners: string[] = [];
let unsubscribe: () => void = () => {};

const request = (path: string, token: string, init: RequestInit = {}, host: string = HOSTS.lab) =>
  api.request(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      'x-tenant-host': host,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;

/** The refusal without its per-request id, so two answers compare byte for byte. */
async function sansRequestId(res: Response): Promise<string> {
  const { requestId: _requestId, ...error } = (await errorOf(res)) as Envelope['error'] & {
    requestId?: string;
  };
  return JSON.stringify(error);
}

type Subject =
  | 'feed_post'
  | 'post_comment'
  | 'story'
  | 'story_comment'
  | 'community'
  | 'direct_message';

/** Files a report as `token` and remembers the row for the sweep. */
async function fileReport(
  token: string,
  subjectType: Subject,
  subjectId: string,
  options: { reason?: string; note?: string; host?: string } = {},
): Promise<Response> {
  const res = await request(
    '/v1/reports',
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        subjectType,
        subjectId,
        reason: options.reason ?? 'spam',
        ...(options.note === undefined ? {} : { note: options.note }),
      }),
    },
    options.host ?? HOSTS.lab,
  );
  if (res.status === 201) createdReports.push(((await res.clone().json()) as { id: string }).id);
  return res;
}

type QueueItem = {
  id: string;
  createdAt: string;
  status: string;
  subjectType: string;
  subjectId: string;
  reason: string;
  note: string | null;
  excerpt: string;
  contentAvailable: boolean;
  reporter: { displayName: string | null };
  author: { displayName: string | null; isMember: boolean };
  community?: { name: string; description: string };
  voice?: { mediaId: string; durationSeconds: number; gone: boolean };
  ref?: { postId?: string; storyId?: string };
};
type QueuePage = { items: QueueItem[]; nextCursor: string | null };

async function queue(token: string, query = '', host: string = HOSTS.lab): Promise<QueuePage> {
  const res = await request(`/v1/admin/reports${query}`, token, {}, host);
  expect(res.status, `GET /v1/admin/reports${query}`).toBe(200);
  return (await res.json()) as QueuePage;
}

async function queueItem(
  token: string,
  reportId: string,
  host: string = HOSTS.lab,
): Promise<QueueItem | undefined> {
  return (await queue(token, '?estado=todas&limit=50', host)).items.find((r) => r.id === reportId);
}

async function userOf(email: string): Promise<string> {
  const [row] = await adminSql<{ user_id: string }[]>`
    select m.user_id::text as user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.user_id;
}

/** A `purpose: 'story'` asset of rede-lab owned by `ownerId`. */
async function makeAsset(ownerId: string, tenantId: string = labTenantId): Promise<string> {
  const id = randomUUID();
  createdAssets.push(id);
  await adminSql`
    insert into public.media_assets
      (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
    values (${id}::uuid, ${tenantId}::uuid, ${ownerId}::uuid, 'image', 'story', 'ready', 'supabase',
            'image/webp', 1024, '{640,1080}'::int[])`;
  return id;
}

/** A story written by hand: the caption carries PREFIX unless the case wants it empty. */
async function insertStory(
  author: string,
  options: { visibility?: 'tenant' | 'followers'; caption?: string; tenantId?: string } = {},
): Promise<string> {
  const tenantId = options.tenantId ?? labTenantId;
  const asset = await makeAsset(author, tenantId);
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
    values (${tenantId}::uuid, ${author}::uuid, ${asset}::uuid, 'image',
            ${options.caption ?? `${PREFIX}legenda`}, ${options.visibility ?? 'tenant'})
    returning id::text as id`;
  const id = row?.id ?? '';
  createdStories.push(id);
  return id;
}

async function insertStoryComment(
  storyId: string,
  author: string,
  body: string,
  tenantId: string = labTenantId,
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_comments (tenant_id, story_id, author_user_id, body)
    values (${tenantId}::uuid, ${storyId}::uuid, ${author}::uuid, ${body})
    returning id::text as id`;
  const id = row?.id ?? '';
  createdComments.push(id);
  return id;
}

async function insertCommunity(
  creator: string,
  options: {
    name: string;
    description?: string;
    kind?: 'member' | 'organization';
    tenantId?: string;
  },
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.communities (tenant_id, created_by_user_id, name, slug, description, kind, position)
    values (${options.tenantId ?? labTenantId}::uuid, ${creator}::uuid, ${options.name}, ${`t1114-${randomUUID().slice(0, 8)}`},
            ${options.description ?? ''}, ${options.kind ?? 'member'},
            ${(options.kind ?? 'member') === 'member' ? 1000000 : 0})
    returning id::text as id`;
  const id = row?.id ?? '';
  createdCommunities.push(id);
  return id;
}

const reportCount = async (reporter: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.content_reports where reporter_user_id = ${reporter}::uuid`;
  return row?.n ?? 0;
};

async function sweep(): Promise<void> {
  for (const [follower, followee] of createdFollows.splice(0)) {
    await adminSql`
      delete from public.social_follows
       where follower_user_id = ${follower}::uuid and followee_user_id = ${followee}::uuid`;
  }
  if (createdReports.length > 0) {
    await adminSql`delete from public.content_reports where id = any(${createdReports}::uuid[])`;
    createdReports.length = 0;
  }
  if (createdComments.length > 0) {
    await adminSql`delete from public.feed_comments where id = any(${createdComments}::uuid[])`;
    createdComments.length = 0;
  }
  await adminSql`delete from public.feed_comments where story_id = any(${createdStories}::uuid[])`;
  if (createdStories.length > 0) {
    await adminSql`delete from public.content_reports where subject_id = any(${createdStories}::uuid[])`;
    await adminSql`delete from public.stories where id = any(${createdStories}::uuid[])`;
    createdStories.length = 0;
  }
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
    createdAssets.length = 0;
  }
  if (createdCommunities.length > 0) {
    await adminSql`delete from public.content_reports where subject_id = any(${createdCommunities}::uuid[])`;
    await adminSql`delete from public.store_product_communities where community_id = any(${createdCommunities}::uuid[])`;
    await adminSql`delete from public.communities where id = any(${createdCommunities}::uuid[])`;
    createdCommunities.length = 0;
  }
  await adminSql`delete from public.store_products where name like ${`${PREFIX}%`}`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  restoreSocialLab = await withSocialEnabled('lab');
  restoreStories = await withStoriesEnabled('lab');
  restoreCommunities = await withCommunitiesEnabled('lab');
  restoreDirect = await withDirectModules('demo');
  restoreDemoStories = await withStoriesEnabled('demo');
  restoreDemoCommunities = await withCommunitiesEnabled('demo');
  const kit = await caseKit();
  tokens.demoAdmin = kit.tokens.demoAdmin;
  tokens.demoMember = kit.tokens.demoMember;
  userIds.demoMember = kit.ids.demoMember;
  labTenantId = kit.ids.lab;
  demoTenantId = kit.ids.demo;
  demoAdminId = kit.ids.demoAdmin;
  tokens.demoSupport = kit.tokens.demoSupport;
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.marcos = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
  tokens.alvaro = await signInAs('alvaro.pinheiro@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
  userIds.marcos = await userOf('marcos.vinicius@rede-lab.local');
  userIds.alvaro = await userOf('alvaro.pinheiro@rede-lab.local');
  userIds.labAdmin = await userOf('admin@rede-lab.local');
  await sweep();
  unsubscribe = subscribe('report.created', async (payload) => {
    events.push(payload);
  });
  resetDirectLimiters();
});

beforeEach(() => {
  reportLimiter.reset();
  events.length = 0;
});

afterAll(async () => {
  unsubscribe();
  await sweep();
  await removeVoiceRows(voiceOwners);
  await removeDirectRows();
  await removeThrowaways();
  await restoreDirect();
  await restoreDemoCommunities();
  await restoreDemoStories();
  await restoreCommunities();
  await restoreStories();
  await restoreSocialLab();
  resetDirectLimiters();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('report filing tracer', () => {
  it('1. the path: a member reports a story and the administrator queue lists it; the event carries ids only', async () => {
    const storyId = await insertStory(userIds.marcos, { caption: `${PREFIX}legenda do tracer` });

    const filed = await fileReport(tokens.helena, 'story', storyId, { reason: 'spam' });
    expect(filed.status).toBe(201);
    const body = (await filed.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['id']);
    const reportId = body.id as string;

    const item = await queueItem(tokens.labAdmin, reportId);
    expect(item, 'the report is in the administrator queue').toBeDefined();
    expect(item).toMatchObject({
      subjectType: 'story',
      subjectId: storyId,
      excerpt: `${PREFIX}legenda do tracer`,
      contentAvailable: true,
      status: 'open',
      author: { isMember: true },
    });
    expect(item?.reporter.displayName).not.toBeNull();
    expect(item?.author.displayName).not.toBeNull();

    // The event fired once, after the commit, with the four ids and nothing else (T-11-12).
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      tenantId: labTenantId,
      reportId,
      reporterUserId: userIds.helena,
      authorUserId: userIds.marcos,
    });
    expect(JSON.stringify(events[0])).not.toContain('legenda');
  });

  it('2. the other subjects: a story comment, a community and a text message file and list with their copy', async () => {
    const storyId = await insertStory(userIds.helena);
    const commentId = await insertStoryComment(
      storyId,
      userIds.marcos,
      `${PREFIX}comentario de story`,
    );
    const commentReport = await fileReport(tokens.helena, 'story_comment', commentId);
    expect(commentReport.status).toBe(201);
    const commentItem = await queueItem(
      tokens.labAdmin,
      ((await commentReport.json()) as { id: string }).id,
    );
    expect(commentItem).toMatchObject({
      subjectType: 'story_comment',
      subjectId: commentId,
      excerpt: `${PREFIX}comentario de story`,
      contentAvailable: true,
    });

    // A member-created community and an organization community both file (AD-1).
    const memberCommunity = await insertCommunity(userIds.marcos, {
      name: `${PREFIX}Clube`,
      description: 'Leitura de domingo',
    });
    const orgCommunity = await insertCommunity(userIds.labAdmin, {
      name: `${PREFIX}Organizacao`,
      kind: 'organization',
    });
    const memberReport = await fileReport(tokens.helena, 'community', memberCommunity);
    expect(memberReport.status).toBe(201);
    const orgReport = await fileReport(tokens.helena, 'community', orgCommunity);
    expect(orgReport.status).toBe(201);
    expect(
      (await queueItem(tokens.labAdmin, ((await memberReport.json()) as { id: string }).id))
        ?.excerpt,
    ).toBe(`${PREFIX}Clube\nLeitura de domingo`);
    expect(
      (await queueItem(tokens.labAdmin, ((await orgReport.json()) as { id: string }).id))?.excerpt,
    ).toBe(`${PREFIX}Organizacao`);

    // A text message between two demo members: the receiver reports it; the demo administrator reads the copy.
    const a = await directMember('f2a');
    const b = await directMember('f2b');
    const sent = await sendDirect(a, b.membershipId, 'texto que sera denunciado');
    expect(sent.status).toBe(201);
    const messageId = ((await sent.json()) as { message: { id: string } }).message.id;
    const messageReport = await fileReport(b.token, 'direct_message', messageId, {
      host: HOSTS.demo,
    });
    expect(messageReport.status).toBe(201);
    const messageItem = await queueItem(
      tokens.demoAdmin,
      ((await messageReport.json()) as { id: string }).id,
      HOSTS.demo,
    );
    expect(messageItem).toMatchObject({
      subjectType: 'direct_message',
      subjectId: messageId,
      excerpt: 'texto que sera denunciado',
      contentAvailable: true,
    });
  });

  it('3. readable-first: every miss is the same bare 404, stores nothing and emits nothing', async () => {
    // A followers-only story of Marcos: Helena follows him (positive control), Alvaro does not.
    const followersStory = await insertStory(userIds.marcos, { visibility: 'followers' });
    // A community locked for a member without the product that unlocks it (the store gates it).
    const lockedCommunity = await insertCommunity(userIds.labAdmin, {
      name: `${PREFIX}Trancada`,
      kind: 'organization',
    });
    const [product] = await adminSql<{ id: string }[]>`
      insert into public.store_products (tenant_id, created_by_user_id, name, price_cents)
      values (${labTenantId}::uuid, ${userIds.labAdmin}::uuid, ${`${PREFIX}Produto`}, 1000)
      returning id::text as id`;
    await adminSql`
      insert into public.store_product_communities (tenant_id, product_id, community_id)
      values (${labTenantId}::uuid, ${product?.id ?? ''}::uuid, ${lockedCommunity}::uuid)`;
    const restoreStore = await withStoreEnabled('lab');
    try {
      // The pair of two demo members, a third demo member, the support thread and another tenant's reporter.
      const a = await directMember('f3a');
      const b = await directMember('f3b');
      const c = await directMember('f3c');
      const sent = await sendDirect(a, b.membershipId, 'so entre dois');
      const pairMessage = ((await sent.json()) as { message: { id: string } }).message.id;
      const supportMessage = SEED_THREAD.messages[1][0];

      const before = await Promise.all(
        [userIds.alvaro, userIds.helena, c.userId, userIds.demoMember].map(reportCount),
      );
      const misses: [string, Response][] = [
        ['followers story, not followed', await fileReport(tokens.alvaro, 'story', followersStory)],
        [
          'community locked for the reporter',
          await fileReport(tokens.alvaro, 'community', lockedCommunity),
        ],
        [
          'message of another pair',
          await fileReport(c.token, 'direct_message', pairMessage, { host: HOSTS.demo }),
        ],
        [
          'message of the support thread',
          await fileReport(tokens.demoMember, 'direct_message', supportMessage, {
            host: HOSTS.demo,
          }),
        ],
        [
          'a demo message from the lab',
          await fileReport(tokens.alvaro, 'direct_message', pairMessage),
        ],
        ['an unknown id', await fileReport(tokens.alvaro, 'story', randomUUID())],
      ];
      const bodies = new Set<string>();
      for (const [label, res] of misses) {
        expect(res.status, label).toBe(404);
        bodies.add(await sansRequestId(res));
      }
      expect(bodies.size, 'every miss answers the same body').toBe(1);
      expect((JSON.parse([...bodies][0] ?? '{}') as { code: string }).code).toBe('NOT_FOUND');
      const after = await Promise.all(
        [userIds.alvaro, userIds.helena, c.userId, userIds.demoMember].map(reportCount),
      );
      expect(after, 'nothing was stored').toEqual(before);
      expect(events, 'nothing was emitted').toEqual([]);

      // Positive controls beside each negative: the same items file for someone who can read them.
      expect((await fileReport(tokens.helena, 'story', followersStory)).status).toBe(201);
      await adminSql`
        insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id, status)
        values (${labTenantId}::uuid, ${userIds.alvaro}::uuid, ${product?.id ?? ''}::uuid, 'grant',
                ${userIds.labAdmin}::uuid, 'active')`;
      try {
        expect((await fileReport(tokens.alvaro, 'community', lockedCommunity)).status).toBe(201);
      } finally {
        await adminSql`delete from public.store_entitlements where product_id = ${product?.id ?? ''}::uuid`;
      }
      expect(
        (await fileReport(b.token, 'direct_message', pairMessage, { host: HOSTS.demo })).status,
      ).toBe(201);
    } finally {
      await restoreStore();
    }
  });

  it('4. unchanged: own content is 403, a repeat is 409, a post and a comment still file, an unknown type is 400', async () => {
    const own = await insertStory(userIds.marcos);
    const ownRes = await fileReport(tokens.marcos, 'story', own);
    expect(ownRes.status).toBe(403);
    expect((await errorOf(ownRes)).code).toBe('CANNOT_REPORT_OWN');

    const first = await fileReport(tokens.helena, 'story', own);
    expect(first.status).toBe(201);
    const again = await fileReport(tokens.helena, 'story', own);
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('ALREADY_REPORTED');

    const [post] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, caption, author_user_id)
      values (${labTenantId}::uuid, ${`${PREFIX}post`}, ${userIds.marcos}::uuid) returning id::text as id`;
    const postId = post?.id ?? '';
    try {
      expect((await fileReport(tokens.helena, 'feed_post', postId)).status).toBe(201);
      const [comment] = await adminSql<{ id: string }[]>`
        insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
        values (${labTenantId}::uuid, ${postId}::uuid, ${userIds.marcos}::uuid, ${`${PREFIX}comentario`})
        returning id::text as id`;
      expect((await fileReport(tokens.helena, 'post_comment', comment?.id ?? '')).status).toBe(201);
    } finally {
      await adminSql`delete from public.content_reports where subject_id = ${postId}::uuid`;
      await adminSql`delete from public.feed_comments where post_id = ${postId}::uuid`;
      await adminSql`delete from public.feed_posts where id = ${postId}::uuid`;
    }

    const unknown = await request('/v1/reports', tokens.helena, {
      method: 'POST',
      body: JSON.stringify({ subjectType: 'chat', subjectId: randomUUID(), reason: 'spam' }),
    });
    expect(unknown.status).toBe(400);
    expect((await errorOf(unknown)).code).toBe('VALIDATION_FAILED');
  });
});

/** The voice cases need the real ffmpeg (the derive job normalizes the take); they skip with a message without it. */
const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;
if (!HAS_FFMPEG)
  console.warn('reports-new-subjects: ffmpeg is missing, the recording cases are skipped');

/** Every key name found anywhere in a JSON value. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysOf(v, into);
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      into.add(key);
      keysOf(v, into);
    }
  }
  return into;
}

const original = (assetId: string, token: string, host: string = HOSTS.demo) =>
  request(`/v1/media/${assetId}/original`, token, {}, host);

describe('report queue projection', () => {
  it('1. each subject lists with its own live predicate: a story, a story comment or a community removed after the report reads unavailable, a message never', async () => {
    const storyId = await insertStory(userIds.marcos);
    const commentStory = await insertStory(userIds.helena);
    const commentId = await insertStoryComment(
      commentStory,
      userIds.marcos,
      `${PREFIX}comentario vivo`,
    );
    const communityId = await insertCommunity(userIds.marcos, { name: `${PREFIX}Viva` });
    const ids: Record<string, string> = {};
    for (const [label, type, subject] of [
      ['story', 'story', storyId],
      ['comment', 'story_comment', commentId],
      ['community', 'community', communityId],
    ] as const) {
      const res = await fileReport(tokens.helena, type, subject);
      expect(res.status, label).toBe(201);
      ids[label] = ((await res.json()) as { id: string }).id;
    }
    for (const label of Object.keys(ids)) {
      expect((await queueItem(tokens.labAdmin, ids[label] ?? ''))?.contentAvailable, label).toBe(
        true,
      );
    }

    await adminSql`update public.stories set deleted_at = now() where id = ${storyId}::uuid`;
    await adminSql`update public.feed_comments set deleted_at = now() where id = ${commentId}::uuid`;
    await adminSql`update public.communities set deleted_at = now() where id = ${communityId}::uuid`;
    for (const label of Object.keys(ids)) {
      const item = await queueItem(tokens.labAdmin, ids[label] ?? '');
      expect(item?.contentAvailable, `${label} after the removal`).toBe(false);
      // The snapshot still reads: the queue never goes blank.
      expect(item?.excerpt.length, `${label} excerpt`).toBeGreaterThan(0);
    }

    // A message is the copy itself: it reads available even when its message row is soft-deleted afterwards.
    const a = await directMember('p1a');
    const b = await directMember('p1b');
    const sent = await sendDirect(a, b.membershipId, 'copia da mensagem');
    const messageId = ((await sent.json()) as { message: { id: string } }).message.id;
    const filed = await fileReport(b.token, 'direct_message', messageId, { host: HOSTS.demo });
    const reportId = ((await filed.json()) as { id: string }).id;
    await adminSql`update public.chat_messages set deleted_at = now() where id = ${messageId}::uuid`;
    expect((await queueItem(tokens.demoAdmin, reportId, HOSTS.demo))?.contentAvailable).toBe(true);
  });

  it('2. a community lists name and description split at the first line break; a name alone gives an empty description; empty copies list empty', async () => {
    const withDescription = await insertCommunity(userIds.marcos, {
      name: `${PREFIX}Nome`,
      description: 'Primeira linha\nSegunda linha',
    });
    const nameOnly = await insertCommunity(userIds.marcos, { name: `${PREFIX}So nome` });
    const noCaption = await insertStory(userIds.marcos, { caption: '' });
    const first = await fileReport(tokens.helena, 'community', withDescription);
    const second = await fileReport(tokens.helena, 'community', nameOnly);
    const third = await fileReport(tokens.helena, 'story', noCaption);
    const [one, two, three] = await Promise.all(
      [first, second, third].map(async (res) => {
        expect(res.status).toBe(201);
        return queueItem(tokens.labAdmin, ((await res.json()) as { id: string }).id);
      }),
    );
    expect(one?.community).toEqual({
      name: `${PREFIX}Nome`,
      description: 'Primeira linha\nSegunda linha',
    });
    expect(two?.community).toEqual({ name: `${PREFIX}So nome`, description: '' });
    expect(three?.excerpt).toBe('');
    expect(three?.note).toBeNull();
    expect(three?.community).toBeUndefined();
    expect(three?.voice).toBeUndefined();
  });

  it('3. every item carries the reference its own href needs: post, post comment, story, story comment', async () => {
    const [post] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, caption, author_user_id)
      values (${labTenantId}::uuid, ${`${PREFIX}post de ref`}, ${userIds.marcos}::uuid) returning id::text as id`;
    const postId = post?.id ?? '';
    const [comment] = await adminSql<{ id: string }[]>`
      insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
      values (${labTenantId}::uuid, ${postId}::uuid, ${userIds.marcos}::uuid, ${`${PREFIX}comentario de ref`})
      returning id::text as id`;
    const storyId = await insertStory(userIds.marcos);
    const storyCommentId = await insertStoryComment(
      storyId,
      userIds.marcos,
      `${PREFIX}comentario de story ref`,
    );
    try {
      const out: Record<string, QueueItem | undefined> = {};
      for (const [label, type, subject] of [
        ['post', 'feed_post', postId],
        ['comment', 'post_comment', comment?.id ?? ''],
        ['story', 'story', storyId],
        ['storyComment', 'story_comment', storyCommentId],
      ] as const) {
        const res = await fileReport(tokens.helena, type, subject);
        expect(res.status, label).toBe(201);
        out[label] = await queueItem(tokens.labAdmin, ((await res.json()) as { id: string }).id);
      }
      expect(out.post?.ref).toEqual({ postId });
      expect(out.comment?.ref).toEqual({ postId });
      expect(out.story?.ref).toEqual({ storyId });
      expect(out.storyComment?.ref).toEqual({ storyId });
    } finally {
      await adminSql`delete from public.content_reports where subject_id = any(${[postId, comment?.id ?? '']}::uuid[])`;
      await adminSql`delete from public.feed_comments where post_id = ${postId}::uuid`;
      await adminSql`delete from public.feed_posts where id = ${postId}::uuid`;
    }
  });

  it.skipIf(!HAS_FFMPEG)(
    '4. a reported recording lists with its asset and length; the administrator hears it only through its report; a retired asset reads gone; the answer names no conversation',
    async () => {
      const a = await directMember('p4a');
      const b = await directMember('p4b');
      const c = await directMember('p4c');
      voiceOwners.push(a.userId);
      const opening = await sendDirect(a, b.membershipId, 'abrindo a conversa');
      const { conversationId } = (await opening.json()) as { conversationId: string };
      const assetId = await readyVoiceAsset(a.token, 'voice-2s.webm', HOSTS.demo);
      const [voice] = await adminSql<{ id: string }[]>`
        insert into public.chat_messages
          (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
        select ${(await caseKit()).ids.demo}::uuid, ${conversationId}::uuid, ${a.userId}::uuid, 'member', null,
               ${assetId}::uuid, 2
        returning id::text as id`;
      const messageId = voice?.id ?? '';

      // BEFORE the report the administrator cannot hear the recording: the same bare 404 as any unknown id.
      const before = await original(assetId, tokens.demoAdmin);
      expect(before.status).toBe(404);

      const filed = await fileReport(b.token, 'direct_message', messageId, { host: HOSTS.demo });
      expect(filed.status).toBe(201);
      const reportId = ((await filed.json()) as { id: string }).id;

      const page = await queue(tokens.demoAdmin, '?estado=todas&limit=50', HOSTS.demo);
      const item = page.items.find((row) => row.id === reportId);
      expect(item).toMatchObject({
        subjectType: 'direct_message',
        excerpt: '',
        contentAvailable: true,
        voice: { mediaId: assetId, durationSeconds: 2, gone: false },
      });

      // The whole answer of a message report names no conversation, counterpart or neighbouring message.
      const names = [...keysOf(item)].join(' ').toLowerCase();
      expect(names).not.toMatch(/conversation|counterpart|participant|neighbour|thread/);
      expect(JSON.stringify(item)).not.toContain(conversationId);
      expect(JSON.stringify(item)).not.toContain(b.userId);

      // AFTER the report: the administrator is redirected to the signed bytes; a third member of the tenant and the
      // other tenant's user still get the bare 404.
      expect((await original(assetId, tokens.demoAdmin)).status).toBe(302);
      expect((await original(assetId, c.token)).status).toBe(404);
      expect((await original(assetId, tokens.alvaro, HOSTS.lab)).status).toBe(404);

      // The administrator reads no chat row: the conversation is not theirs to open.
      const history = await readMessages({ token: tokens.demoAdmin }, conversationId);
      expect(history.status).toBe(404);

      // Once the asset is retired the report says so and the link is the bare 404 for everyone.
      await adminSql`update public.media_assets set deleted_at = now() where id = ${assetId}::uuid`;
      const gone = (await queueItem(tokens.demoAdmin, reportId, HOSTS.demo))?.voice;
      expect(gone).toEqual({ mediaId: assetId, durationSeconds: 2, gone: true });
      expect((await original(assetId, tokens.demoAdmin)).status).toBe(404);
    },
    60_000,
  );

  it('5. the queue keeps (created_at desc, id desc): a page boundary inside a tie of identical instants neither repeats nor skips a row', async () => {
    const storyId = await insertStory(userIds.marcos);
    const commentId = await insertStoryComment(storyId, userIds.marcos, `${PREFIX}empate`);
    const communityId = await insertCommunity(userIds.marcos, { name: `${PREFIX}Empate` });
    const mine: string[] = [];
    for (const [type, subject] of [
      ['story', storyId],
      ['story_comment', commentId],
      ['community', communityId],
    ] as const) {
      const res = await fileReport(tokens.helena, type, subject);
      expect(res.status).toBe(201);
      mine.push(((await res.json()) as { id: string }).id);
    }
    await adminSql`
      update public.content_reports set created_at = now() + interval '1 hour'
       where id = any(${mine}::uuid[])`;

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 200; guard++) {
      const next: string = cursor
        ? `?estado=todas&limit=1&cursor=${encodeURIComponent(cursor)}`
        : '?estado=todas&limit=1';
      const got = await queue(tokens.labAdmin, next);
      expect(got.items.length).toBeLessThanOrEqual(1);
      seen.push(...got.items.map((row) => row.id));
      cursor = got.nextCursor;
      if (cursor === null) break;
    }
    expect(new Set(seen).size, 'no row repeats').toBe(seen.length);
    for (const id of mine)
      expect(
        seen.filter((x) => x === id),
        id,
      ).toHaveLength(1);
    const positions = mine.map((id) => seen.indexOf(id)).sort((x, y) => x - y);
    expect(positions[2], 'the three tied rows are adjacent').toBe((positions[0] ?? 0) + 2);
    expect(
      seen.slice(positions[0], (positions[0] ?? 0) + 3),
      'ties break on id descending',
    ).toEqual([...mine].sort().reverse());
  });
});

describe('report social off', () => {
  it('1. with social off a story, a story comment, a community, a post and a comment still file and list for whatever the reporter can read; a followers story and a message are the bare 404', async () => {
    const tenantStory = await insertStory(userIds.marcos);
    const followersStory = await insertStory(userIds.marcos, { visibility: 'followers' });
    const commentId = await insertStoryComment(
      tenantStory,
      userIds.marcos,
      `${PREFIX}comentario sem social`,
    );
    const communityId = await insertCommunity(userIds.marcos, { name: `${PREFIX}Sem social` });
    const [post] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, caption, author_user_id)
      values (${labTenantId}::uuid, ${`${PREFIX}post sem social`}, ${userIds.marcos}::uuid) returning id::text as id`;
    const postId = post?.id ?? '';
    const [postComment] = await adminSql<{ id: string }[]>`
      insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
      values (${labTenantId}::uuid, ${postId}::uuid, ${userIds.marcos}::uuid, ${`${PREFIX}comentario do post`})
      returning id::text as id`;
    const a = await directMember('o1a');
    const b = await directMember('o1b');
    const sent = await sendDirect(a, b.membershipId, 'mensagem com social');
    const messageId = ((await sent.json()) as { message: { id: string } }).message.id;

    const restoreLab = await setModule('lab', 'social', false);
    const restoreDemo = await setModule('demo', 'social', false);
    try {
      for (const [label, type, subject] of [
        ['story', 'story', tenantStory],
        ['story comment', 'story_comment', commentId],
        ['community', 'community', communityId],
        ['post', 'feed_post', postId],
        ['post comment', 'post_comment', postComment?.id ?? ''],
      ] as const) {
        const res = await fileReport(tokens.helena, type, subject);
        expect(res.status, `${label} with social off`).toBe(201);
        const item = await queueItem(tokens.labAdmin, ((await res.json()) as { id: string }).id);
        expect(item?.subjectType, label).toBe(type);
        expect(item?.contentAvailable, label).toBe(true);
      }
      // What the lane cannot read any more is the bare 404: the followers audience needs social, and so does a pair.
      const followers = await fileReport(tokens.helena, 'story', followersStory);
      expect(followers.status).toBe(404);
      const message = await fileReport(b.token, 'direct_message', messageId, { host: HOSTS.demo });
      expect(message.status).toBe(404);
      expect(await sansRequestId(message)).toBe(await sansRequestId(followers));
    } finally {
      await restoreDemo();
      await restoreLab();
      await adminSql`delete from public.content_reports where subject_id = ${postId}::uuid or subject_id = ${postComment?.id ?? ''}::uuid`;
      await adminSql`delete from public.feed_comments where post_id = ${postId}::uuid`;
      await adminSql`delete from public.feed_posts where id = ${postId}::uuid`;
    }
    // The positive control beside the message negative: with social back on the same report files.
    reportLimiter.reset();
    expect(
      (await fileReport(b.token, 'direct_message', messageId, { host: HOSTS.demo })).status,
    ).toBe(201);
    expect((await fileReport(tokens.helena, 'story', followersStory)).status).toBe(201);
  });
});

describe('report concurrency', () => {
  it('ten parallel reports of one item by one reporter leave one row, nine 409 and one report.created', async () => {
    const storyId = await insertStory(userIds.marcos);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => fileReport(tokens.helena, 'story', storyId)),
    );
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    for (const res of results.filter((r) => r.status === 409)) {
      expect((await errorOf(res)).code).toBe('ALREADY_REPORTED');
    }
    const [rows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.content_reports
       where reporter_user_id = ${userIds.helena}::uuid and subject_id = ${storyId}::uuid`;
    expect(rows?.n).toBe(1);
    expect(events.filter((event) => event.reporterUserId === userIds.helena)).toHaveLength(1);
  });
});

describe('report tenant isolation', () => {
  it("1. a report of tenant A's story, comment, community or message from tenant B is the bare 404 and stores nothing, beside its positive control; each queue lists only its own tenant", async () => {
    const storyId = await insertStory(userIds.marcos);
    const commentId = await insertStoryComment(
      storyId,
      userIds.marcos,
      `${PREFIX}comentario isolado`,
    );
    const communityId = await insertCommunity(userIds.marcos, { name: `${PREFIX}Isolada` });
    const a = await directMember('i1a');
    const b = await directMember('i1b');
    const sent = await sendDirect(a, b.membershipId, 'mensagem do demo');
    const messageId = ((await sent.json()) as { message: { id: string } }).message.id;

    const demoBefore = await reportCount(userIds.demoMember);
    const labBefore = await reportCount(userIds.alvaro);
    const bodies = new Set<string>();
    for (const [type, subject] of [
      ['story', storyId],
      ['story_comment', commentId],
      ['community', communityId],
    ] as const) {
      const res = await fileReport(tokens.demoMember, type, subject, { host: HOSTS.demo });
      expect(res.status, `demo reporting the lab ${type}`).toBe(404);
      bodies.add(await sansRequestId(res));
    }
    const crossMessage = await fileReport(tokens.alvaro, 'direct_message', messageId, {
      host: HOSTS.lab,
    });
    expect(crossMessage.status).toBe(404);
    bodies.add(await sansRequestId(crossMessage));
    expect(bodies.size, 'one bare body for every cross-tenant miss').toBe(1);
    expect(await reportCount(userIds.demoMember)).toBe(demoBefore);
    expect(await reportCount(userIds.alvaro)).toBe(labBefore);

    // Positive controls: each tenant's own reporter files the same items.
    const labReport = await fileReport(tokens.helena, 'story', storyId);
    expect(labReport.status).toBe(201);
    const demoReport = await fileReport(b.token, 'direct_message', messageId, { host: HOSTS.demo });
    expect(demoReport.status).toBe(201);
    const labReportId = ((await labReport.json()) as { id: string }).id;
    const demoReportId = ((await demoReport.json()) as { id: string }).id;

    const labQueue = await queue(tokens.labAdmin, '?estado=todas&limit=50');
    const demoQueue = await queue(tokens.demoAdmin, '?estado=todas&limit=50', HOSTS.demo);
    expect(labQueue.items.map((row) => row.id)).toContain(labReportId);
    expect(labQueue.items.map((row) => row.id)).not.toContain(demoReportId);
    expect(demoQueue.items.map((row) => row.id)).toContain(demoReportId);
    expect(demoQueue.items.map((row) => row.id)).not.toContain(labReportId);
  });
});

/* ── Phase 11 plan 16 (MODER-04; D-616, D-732; T-11-01, T-11-11, T-11-12, T-11-20, T-11-30): the resolve ───────────
 *
 * The administrator's resolution of a report of each subject, through `POST /v1/admin/reports/{id}/resolve`. These
 * cases run on rede-demo (stories, communities, social and chat turned on for the span): the reporter, the author and
 * the second administrator are THROWAWAY members, so a block never touches a seeded person. `moderation_log` is
 * APPEND-ONLY, so no row is ever deleted and every assertion is scoped by the id of the item (or the blocked user) this
 * file made. Rows the cases create carry PREFIX or an id kept in the sweep arrays.
 */

type ResolveBody = { id?: string; status?: string; error?: { code: string; details?: unknown } };

const resolve = (
  token: string,
  reportId: string,
  resolution: 'dismiss' | 'remove_content' | 'block_author',
  host: string = HOSTS.demo,
  reason?: string,
) =>
  request(
    `/v1/admin/reports/${reportId}/resolve`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ resolution, ...(reason === undefined ? {} : { reason }) }),
    },
    host,
  );

const reportStatus = async (reportId: string): Promise<string | undefined> => {
  const [row] = await adminSql<{ status: string }[]>`
    select status from public.content_reports where id = ${reportId}::uuid`;
  return row?.status;
};

type LogRow = {
  action: string;
  actor_user_id: string;
  target_user_id: string;
  subject_type: string | null;
  subject_id: string | null;
};

/** The log rows ABOUT one item (a removal or an archive). */
const logRowsOfSubject = (subjectId: string) =>
  adminSql<LogRow[]>`
    select action, actor_user_id::text, target_user_id::text, subject_type, subject_id::text
      from public.moderation_log
     where subject_id = ${subjectId}::uuid
     order by created_at, id`;

/** The block rows of one member (the target of a `member_blocked` row is the blocked user). */
const blockRowsOf = (userId: string) =>
  adminSql<LogRow[]>`
    select action, actor_user_id::text, target_user_id::text, subject_type, subject_id::text
      from public.moderation_log
     where target_user_id = ${userId}::uuid and action = 'member_blocked'
     order by created_at, id`;

const membershipStatusOf = async (userId: string): Promise<string | undefined> => {
  const [row] = await adminSql<{ status: string }[]>`
    select status from public.memberships
     where tenant_id = ${demoTenantId}::uuid and user_id = ${userId}::uuid`;
  return row?.status;
};

const deletedAtOf = async (table: 'stories' | 'feed_comments' | 'communities', id: string) => {
  const rows =
    table === 'stories'
      ? await adminSql<
          { at: string | null }[]
        >`select deleted_at::text as at from public.stories where id = ${id}::uuid`
      : table === 'feed_comments'
        ? await adminSql<
            { at: string | null }[]
          >`select deleted_at::text as at from public.feed_comments where id = ${id}::uuid`
        : await adminSql<
            { at: string | null }[]
          >`select deleted_at::text as at from public.communities where id = ${id}::uuid`;
  return rows[0]?.at;
};

const communityStatusOf = async (id: string): Promise<string | undefined> => {
  const [row] = await adminSql<{ status: string }[]>`
    select status from public.communities where id = ${id}::uuid`;
  return row?.status;
};

/** Files a report on rede-demo as `reporter` and returns its id. */
async function fileDemo(
  reporter: { token: string },
  type: Subject,
  subjectId: string,
): Promise<string> {
  const res = await fileReport(reporter.token, type, subjectId, { host: HOSTS.demo });
  expect(res.status, `file ${type}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Follows kept for the sweep: [follower, followee] of the demo tenant. */
const createdFollows: [string, string][] = [];

async function follow(followerId: string, followeeId: string): Promise<void> {
  await adminSql`
    insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
    values (${demoTenantId}::uuid, ${followerId}::uuid, ${followeeId}::uuid)
    on conflict do nothing`;
  createdFollows.push([followerId, followeeId]);
}

/**
 * A demo story written by `authorId`, filed on by `reporter`; returns both ids. A MEMBER story is a `followers` story
 * (the moderation path logs only those, D-711), so the reporter follows the author first; `visibility: 'tenant'`
 * makes an ORGANIZATION story, which any member reads.
 */
async function reportedStory(
  authorId: string,
  reporter: { token: string; userId?: string; id?: string },
  options: { caption?: string; visibility?: 'tenant' | 'followers' } = {},
) {
  const visibility = options.visibility ?? 'followers';
  const reporterId = reporter.userId ?? reporter.id;
  if (visibility === 'followers' && reporterId) await follow(reporterId, authorId);
  const storyId = await insertStory(authorId, {
    tenantId: demoTenantId,
    caption: options.caption ?? `${PREFIX}resolve`,
    visibility,
  });
  return { storyId, reportId: await fileDemo(reporter, 'story', storyId) };
}

describe('report resolve tracer', () => {
  it('1. the path: the administrator removes a reported story; the report, the story and ONE log row move together', async () => {
    const author = await directMember('r1a');
    const reporter = await directMember('r1r');
    const { storyId, reportId } = await reportedStory(author.userId, reporter);
    expect(await logRowsOfSubject(storyId)).toHaveLength(0);

    const res = await resolve(tokens.demoAdmin, reportId, 'remove_content');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ id: reportId, status: 'content_removed' });

    expect(await reportStatus(reportId)).toBe('content_removed');
    expect(await deletedAtOf('stories', storyId)).not.toBeNull();
    const rows = await logRowsOfSubject(storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'story_removed',
      subject_type: 'story',
      target_user_id: author.userId,
      actor_user_id: demoAdminId,
    });

    // The story no longer lists, for anyone (the author, the reporter or another member).
    for (const who of [author, reporter]) {
      const one = await request(`/v1/stories/${storyId}`, who.token, {}, HOSTS.demo);
      expect(one.status, 'the removed story is the bare 404').toBe(404);
      const page = (await (await request('/v1/stories', who.token, {}, HOSTS.demo)).json()) as {
        items: { id: string }[];
      };
      expect(page.items.map((item) => item.id)).not.toContain(storyId);
    }
    // Nobody is told (T-11-12): no notification names the story.
    const told = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where user_id = any(${[author.userId, reporter.userId]}::uuid[]) and created_at > now() - interval '1 minute'`;
    expect(told[0]?.n).toBe(0);
  });

  it('2. the shipped subjects are unchanged: a reported member post and its comment are removed through the feed with their rows', async () => {
    const author = await directMember('r2a');
    const reporter = await directMember('r2r');
    // A MEMBER post is a followers post: the one a moderator may take down.
    await follow(reporter.userId, author.userId);
    const [post] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, caption, author_user_id, visibility)
      values (${demoTenantId}::uuid, ${`${PREFIX}post r2`}, ${author.userId}::uuid, 'followers')
      returning id::text as id`;
    const postId = post?.id ?? '';
    const [comment] = await adminSql<{ id: string }[]>`
      insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
      values (${demoTenantId}::uuid, ${postId}::uuid, ${author.userId}::uuid, ${`${PREFIX}comentario r2`})
      returning id::text as id`;
    const commentId = comment?.id ?? '';
    try {
      const postReport = await fileDemo(reporter, 'feed_post', postId);
      const commentReport = await fileDemo(reporter, 'post_comment', commentId);

      expect((await resolve(tokens.demoAdmin, commentReport, 'remove_content')).status).toBe(200);
      expect((await resolve(tokens.demoAdmin, postReport, 'remove_content')).status).toBe(200);

      expect((await logRowsOfSubject(commentId)).map((row) => row.action)).toEqual([
        'comment_removed',
      ]);
      expect((await logRowsOfSubject(postId)).map((row) => row.action)).toEqual(['post_removed']);
    } finally {
      await adminSql`delete from public.content_reports where subject_id = any(${[postId, commentId]}::uuid[])`;
      await adminSql`delete from public.feed_comments where post_id = ${postId}::uuid`;
      await adminSql`delete from public.feed_posts where id = ${postId}::uuid`;
    }
  });

  it('3. permissions: a member and a support_tenant are 403 on the resolve and change nothing', async () => {
    const author = await directMember('r3a');
    const reporter = await directMember('r3r');
    const { storyId, reportId } = await reportedStory(author.userId, reporter);

    for (const token of [reporter.token, tokens.demoSupport]) {
      const res = await resolve(token, reportId, 'remove_content');
      expect(res.status).toBe(403);
      expect(((await res.json()) as ResolveBody).error?.code).toBe('FORBIDDEN');
    }
    expect(await reportStatus(reportId)).toBe('open');
    expect(await deletedAtOf('stories', storyId)).toBeNull();
    expect(await logRowsOfSubject(storyId)).toHaveLength(0);
  });
});
