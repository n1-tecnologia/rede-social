import { randomUUID } from 'node:crypto';
import type { ReportCreated } from '@rede-social/contracts/moderation';
import { sqlClient } from '@rede-social/core/db';
import { subscribe } from '@rede-social/core/server/events/bus';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { reportLimiter } from '@rede-social/core/server/safety/limits';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { caseKit, removeThrowaways, SEED_THREAD } from './chat-case-fixtures';
import {
  directMember,
  removeDirectRows,
  resetDirectLimiters,
  sendDirect,
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
const tokens = { helena: '', marcos: '', alvaro: '', labAdmin: '', demoAdmin: '', demoMember: '' };
const userIds = { helena: '', marcos: '', alvaro: '', labAdmin: '', demoMember: '' };
let labTenantId = '';
let restoreSocialLab: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
let restoreCommunities: () => Promise<void> = async () => {};
let restoreDirect: () => Promise<void> = async () => {};

const createdReports: string[] = [];
const createdAssets: string[] = [];
const createdCommunities: string[] = [];
const createdStories: string[] = [];
const createdComments: string[] = [];
const events: ReportCreated[] = [];
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
async function makeAsset(ownerId: string): Promise<string> {
  const id = randomUUID();
  createdAssets.push(id);
  await adminSql`
    insert into public.media_assets
      (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
    values (${id}::uuid, ${labTenantId}::uuid, ${ownerId}::uuid, 'image', 'story', 'ready', 'supabase',
            'image/webp', 1024, '{640,1080}'::int[])`;
  return id;
}

/** A story written by hand: the caption carries PREFIX unless the case wants it empty. */
async function insertStory(
  author: string,
  options: { visibility?: 'tenant' | 'followers'; caption?: string } = {},
): Promise<string> {
  const asset = await makeAsset(author);
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
    values (${labTenantId}::uuid, ${author}::uuid, ${asset}::uuid, 'image',
            ${options.caption ?? `${PREFIX}legenda`}, ${options.visibility ?? 'tenant'})
    returning id::text as id`;
  const id = row?.id ?? '';
  createdStories.push(id);
  return id;
}

async function insertStoryComment(storyId: string, author: string, body: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_comments (tenant_id, story_id, author_user_id, body)
    values (${labTenantId}::uuid, ${storyId}::uuid, ${author}::uuid, ${body})
    returning id::text as id`;
  const id = row?.id ?? '';
  createdComments.push(id);
  return id;
}

async function insertCommunity(
  creator: string,
  options: { name: string; description?: string; kind?: 'member' | 'organization' },
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.communities (tenant_id, created_by_user_id, name, slug, description, kind, position)
    values (${labTenantId}::uuid, ${creator}::uuid, ${options.name}, ${`t1114-${randomUUID().slice(0, 8)}`},
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
  const kit = await caseKit();
  tokens.demoAdmin = kit.tokens.demoAdmin;
  tokens.demoMember = kit.tokens.demoMember;
  userIds.demoMember = kit.ids.demoMember;
  labTenantId = kit.ids.lab;
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
  await removeDirectRows();
  await removeThrowaways();
  await restoreDirect();
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
