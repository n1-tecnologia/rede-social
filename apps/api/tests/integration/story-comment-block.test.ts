import { sqlClient } from '@rede-social/core/db';
import { storyPublishLimiter } from '@rede-social/core/server/safety/limits';
import type { StorySummary } from '@rede-social/module-stories/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  HOSTS,
  SEED_PASSWORD,
  signInAs,
  withSocialEnabled,
  withStoriesEnabled,
} from './setup';

/**
 * 11-05 (CHAT-07, D-725, planner assumption A-11-SC; T-11-03) against the live local stack and the real seed:
 * "Bloquear {nome}" on a story comment has the effect the product promises (NATIVE-33). The blocker's own list of
 * a story's comments (`GET /v1/stories/{id}/comments`) drops the blocked member's comment; nobody else's view
 * changes: the blocked member, a third member and a moderator keep reading all three comments, and a block the
 * same pair holds in ANOTHER tenant changes nothing here. The filter is a predicate of the page statement, so a
 * page is never short and the cursor keeps paging.
 *
 * Roles: A (alvaro) is the blocker, B (marcos) the blocked member, C (helena) the third member; the lab
 * administrator is the moderator and the author of the organization story every member can read. Fixtures carry
 * `PREFIX`; the block rows the suite writes are deleted at the end.
 */

const PREFIX = 'Teste 11-05 sc ';
const tokens = { a: '', b: '', c: '', admin: '' };
const userIds = { a: '', b: '', c: '', admin: '' };
let labTenantId = '';
let demoTenantId = '';
let restoreSocial: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
const createdAssets: string[] = [];

const request = (path: string, token: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': HOSTS.lab,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

async function userOf(email: string): Promise<string> {
  const [row] = await adminSql<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.user_id;
}

type CommentPage = { items: { id: string; body: string }[]; nextCursor: string | null };

const commentsOf = async (token: string, storyId: string, query = ''): Promise<CommentPage> => {
  const res = await request(`/v1/stories/${storyId}/comments${query}`, token);
  expect(res.status, `GET comments${query}`).toBe(200);
  return (await res.json()) as CommentPage;
};
const bodiesOf = async (token: string, storyId: string): Promise<string[]> =>
  (await commentsOf(token, storyId)).items.map((item) => item.body);

async function sweep(): Promise<void> {
  await adminSql`delete from public.stories where caption like ${`${PREFIX}%`}`;
  for (const id of createdAssets.splice(0)) {
    await adminSql`delete from public.stories where media_asset_id = ${id}::uuid`;
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
  }
  await adminSql`
    delete from public.member_blocks
     where blocker_user_id = any(${[userIds.a, userIds.c]}::uuid[])
       and blocked_user_id = any(${[userIds.b, userIds.a]}::uuid[])`;
}

/** An organization story every member can read, published by the lab administrator through the real route. */
async function publishOrgStory(label: string): Promise<string> {
  const [asset] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
    values (${labTenantId}::uuid, ${userIds.admin}::uuid, 'image', 'story', 'ready', 'supabase',
            'image/webp', 1024, '{640,1080}'::int[])
    returning id`;
  createdAssets.push(asset?.id ?? '');
  const res = await request('/v1/stories', tokens.admin, {
    method: 'POST',
    body: JSON.stringify({
      mediaAssetId: asset?.id,
      mediaKind: 'image',
      caption: `${PREFIX}${label}`,
    }),
  });
  expect(res.status, 'POST /v1/stories').toBe(201);
  return ((await res.json()) as StorySummary).id;
}

const comment = async (token: string, storyId: string, body: string) => {
  const res = await request(`/v1/stories/${storyId}/comments`, token, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  expect(res.status, `POST comment ${body}`).toBe(201);
};

const block = (token: string, userId: string) =>
  request('/v1/blocks', token, { method: 'POST', body: JSON.stringify({ userId }) });
const unblock = (token: string, userId: string) =>
  request(`/v1/blocks/${userId}`, token, { method: 'DELETE' });

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  restoreSocial = await withSocialEnabled('lab');
  restoreStories = await withStoriesEnabled('lab');
  tokens.a = await signInAs('alvaro.pinheiro@rede-lab.local', SEED_PASSWORD);
  tokens.b = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
  tokens.c = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.admin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  userIds.a = await userOf('alvaro.pinheiro@rede-lab.local');
  userIds.b = await userOf('marcos.vinicius@rede-lab.local');
  userIds.c = await userOf('helena.kuster@rede-lab.local');
  userIds.admin = await userOf('admin@rede-lab.local');
  const [lab] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-lab'`;
  const [demo] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-demo'`;
  labTenantId = lab?.id ?? '';
  demoTenantId = demo?.id ?? '';
  await sweep();
});

beforeEach(() => {
  storyPublishLimiter.reset();
});

afterAll(async () => {
  await adminSql`
    delete from public.member_blocks
     where tenant_id = ${demoTenantId}::uuid and blocker_user_id = ${userIds.c}::uuid`;
  await sweep();
  await restoreStories();
  await restoreSocial();
  await adminSql.end();
  await sqlClient.end();
});

describe('the blocker’s story comments (CHAT-07, D-725, A-11-SC)', () => {
  it('1. A blocks B: A no longer reads B’s comment; B, C and the moderator read all three; unblocking brings it back', async () => {
    const story = await publishOrgStory('bloqueio');
    await comment(tokens.a, story, `${PREFIX}de A`);
    await comment(tokens.b, story, `${PREFIX}de B`);
    await comment(tokens.c, story, `${PREFIX}de C`);
    const all = [`${PREFIX}de A`, `${PREFIX}de B`, `${PREFIX}de C`];

    // Before the block everyone reads all three (the positive control of the whole file).
    for (const token of [tokens.a, tokens.b, tokens.c, tokens.admin]) {
      expect(await bodiesOf(token, story)).toEqual(all);
    }

    expect((await block(tokens.a, userIds.b)).status).toBeLessThan(300);
    expect(await bodiesOf(tokens.a, story)).toEqual([`${PREFIX}de A`, `${PREFIX}de C`]);
    // T-11-03: only the blocker's view moves; the blocked member, a third member and a moderator do not notice.
    for (const token of [tokens.b, tokens.c, tokens.admin]) {
      expect(await bodiesOf(token, story)).toEqual(all);
    }

    expect((await unblock(tokens.a, userIds.b)).status).toBeLessThan(300);
    expect(await bodiesOf(tokens.a, story)).toEqual(all);
  });

  it('2. the block is a predicate, not a post-filter: a limit-1 walk by the blocker returns A then C, each page full, and ends', async () => {
    const story = await publishOrgStory('paginação');
    await comment(tokens.a, story, `${PREFIX}p de A`);
    await comment(tokens.b, story, `${PREFIX}p de B`);
    await comment(tokens.c, story, `${PREFIX}p de C`);
    expect((await block(tokens.a, userIds.b)).status).toBeLessThan(300);

    const first = await commentsOf(tokens.a, story, '?limit=1');
    expect(first.items.map((item) => item.body)).toEqual([`${PREFIX}p de A`]);
    expect(first.nextCursor).not.toBeNull();
    const second = await commentsOf(
      tokens.a,
      story,
      `?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    );
    expect(second.items.map((item) => item.body)).toEqual([`${PREFIX}p de C`]);
    expect(second.nextCursor).toBeNull();
  });

  it('3. a block the same pair holds in ANOTHER tenant changes nothing here: C blocked B in the demo tenant and still reads B in the lab', async () => {
    const story = await publishOrgStory('outro tenant');
    await comment(tokens.b, story, `${PREFIX}t de B`);
    await adminSql`
      insert into public.member_blocks (tenant_id, blocker_user_id, blocked_user_id)
      values (${demoTenantId}::uuid, ${userIds.c}::uuid, ${userIds.b}::uuid)
      on conflict do nothing`;
    expect(await bodiesOf(tokens.c, story)).toEqual([`${PREFIX}t de B`]);
  });

  it('4. D-725: the block adds no other story filter: the story and the strip are as they were for the blocker', async () => {
    const story = await publishOrgStory('sem outros filtros');
    expect((await block(tokens.a, userIds.b)).status).toBeLessThan(300);
    const opened = await request(`/v1/stories/${story}`, tokens.a);
    expect(opened.status).toBe(200);
    const strip = await request('/v1/stories', tokens.a);
    expect(strip.status).toBe(200);
    expect(((await strip.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toContain(
      story,
    );
  });
});
