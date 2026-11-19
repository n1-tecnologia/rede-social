import { sqlClient } from '@rede-social/core/db';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import {
  communityCreateLimiter,
  storyPublishLimiter,
} from '@rede-social/core/server/safety/limits';
import type { CommunitySummary } from '@rede-social/module-communities/contracts';
import { archiveReportedCommunityInTx } from '@rede-social/module-communities/server';
import type { StorySummary } from '@rede-social/module-stories/contracts';
import {
  type ReportedRemoval,
  removeReportedStoryCommentInTx,
  removeReportedStoryInTx,
} from '@rede-social/module-stories/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  HOSTS,
  SEED_PASSWORD,
  signInAs,
  withCommunitiesEnabled,
  withSocialEnabled,
  withStoriesEnabled,
} from './setup';

/**
 * 11-05 (D-732, MODER-04; T-11-11, T-11-20) against the live local stack and the real seed: the three
 * in-transaction removers a report's resolution calls with the caller's `tx` — the member story, the story
 * comment and the member community. Each is opened here in a `withTenantTx` of its own, exactly as the kernel's
 * resolution does, then `afterCommit` is run by hand after the commit.
 *
 * The moderation log is APPEND-ONLY, so nothing here deletes a log row: every assertion is scoped by the id
 * of the item the test created. Fixtures carry `PREFIX` and are swept in `beforeAll` and `afterAll`.
 */

const PREFIX = 'Teste 11-05 rem ';
const tokens = { helena: '', marcos: '', labAdmin: '' };
const userIds = { helena: '', marcos: '', labAdmin: '', labSupport: '' };
let labTenantId = '';
let restoreSocial: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
let restoreCommunities: () => Promise<void> = async () => {};

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

/** A fresh request context for one user, the way a route would hand it to the kernel (an empty event list). */
const ctxFor = (
  userId: string,
  role: RequestContext['role'],
  tenantId: string = labTenantId,
): RequestContext => ({ userId, tenantId, role, requestId: 'report-removers-test', events: [] });
const adminCtx = () => ctxFor(userIds.labAdmin, 'admin_tenant');
const supportCtx = () => ctxFor(userIds.labSupport, 'support_tenant');

type LogRow = {
  action: string;
  actor_user_id: string;
  target_user_id: string;
  subject_type: string | null;
  excerpt: string | null;
};
const logRowsFor = (subjectId: string) =>
  adminSql<LogRow[]>`
    select action, actor_user_id::text, target_user_id::text, subject_type, excerpt
      from public.moderation_log
     where tenant_id = ${labTenantId}::uuid and subject_id = ${subjectId}::uuid
     order by created_at, id`;

/** Runs a remover in its own committed transaction, then its `afterCommit`; returns the outcome and the events. */
async function resolveWith<A extends unknown[]>(
  ctx: RequestContext,
  remover: (tx: Tx, ctx: RequestContext, ...args: A) => Promise<ReportedRemoval>,
  ...args: A
) {
  const result = await withTenantTx(ctx, (tx) => remover(tx, ctx, ...args));
  const eventsBefore = ctx.events.map((event) => event.name);
  result.afterCommit();
  return {
    outcome: result.outcome,
    eventsBeforeCommitHook: eventsBefore,
    events: ctx.events.map((event) => event.name),
  };
}

const createdAssets: string[] = [];

async function sweep(): Promise<void> {
  await adminSql`delete from public.feed_posts where community_id in (select id from public.communities where name like ${`${PREFIX}%`})`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.stories where caption like ${`${PREFIX}%`}`;
  for (const id of createdAssets.splice(0)) {
    await adminSql`delete from public.stories where media_asset_id = ${id}::uuid`;
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
  }
}

/** A story published through the real route, on an asset the caller owns. */
const publishStory = async (
  token: string,
  ownerId: string,
  caption: string,
): Promise<StorySummary> => {
  const [asset] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
    values (${labTenantId}::uuid, ${ownerId}::uuid, 'image', 'story', 'ready', 'supabase',
            'image/webp', 1024, '{640,1080}'::int[])
    returning id`;
  const assetId = asset?.id ?? '';
  createdAssets.push(assetId);
  const res = await request('/v1/stories', token, {
    method: 'POST',
    body: JSON.stringify({ mediaAssetId: assetId, mediaKind: 'image', caption }),
  });
  expect(res.status, `POST /v1/stories ${caption}`).toBe(201);
  return (await res.json()) as StorySummary;
};

const storyDeletedAt = async (id: string) => {
  const [row] = await adminSql<{ deleted_at: string | null }[]>`
    select deleted_at::text from public.stories where id = ${id}::uuid`;
  return row?.deleted_at ?? null;
};

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  restoreSocial = await withSocialEnabled('lab');
  restoreStories = await withStoriesEnabled('lab');
  restoreCommunities = await withCommunitiesEnabled('lab');
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.marcos = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
  userIds.marcos = await userOf('marcos.vinicius@rede-lab.local');
  userIds.labAdmin = await userOf('admin@rede-lab.local');
  userIds.labSupport = await userOf('support@rede-lab.local');
  const [lab] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  await sweep();
});

beforeEach(() => {
  storyPublishLimiter.reset();
  communityCreateLimiter.reset();
});

afterAll(async () => {
  await sweep();
  await restoreCommunities();
  await restoreStories();
  await restoreSocial();
  await adminSql.end();
  await sqlClient.end();
});

describe('story remover tracer', () => {
  beforeEach(async () => {
    await sweep();
  });

  it('1. a member story is removed inside the caller’s transaction with ONE story_removed row, and the event waits for afterCommit', async () => {
    const story = await publishStory(tokens.helena, userIds.helena, `${PREFIX}história`);
    const done = await resolveWith(adminCtx(), removeReportedStoryInTx, story.id, {
      canManage: true,
      canModerate: true,
    });
    expect(done.outcome).toBe('removed');
    expect(await storyDeletedAt(story.id)).not.toBeNull();
    // Nothing was announced inside the transaction; the hook announces once.
    expect(done.eventsBeforeCommitHook).toEqual([]);
    expect(done.events).toEqual(['story.deleted']);
    const rows = await logRowsFor(story.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'story_removed',
      subject_type: 'story',
      actor_user_id: userIds.labAdmin,
      target_user_id: userIds.helena,
    });
  });

  it('2. idempotent: the second call is already_gone, writes no second row and its afterCommit is a no-op', async () => {
    const story = await publishStory(tokens.helena, userIds.helena, `${PREFIX}repetida`);
    const flags = { canManage: true, canModerate: true };
    expect((await resolveWith(adminCtx(), removeReportedStoryInTx, story.id, flags)).outcome).toBe(
      'removed',
    );
    const again = await resolveWith(adminCtx(), removeReportedStoryInTx, story.id, flags);
    expect(again.outcome).toBe('already_gone');
    expect(again.events).toEqual([]);
    expect(await logRowsFor(story.id)).toHaveLength(1);
  });

  it('3. refusals: an organization story met by moderation.manage alone is not_removable and unchanged; an unknown id and another tenant’s story are already_gone', async () => {
    const org = await publishStory(tokens.labAdmin, userIds.labAdmin, `${PREFIX}da organização`);
    const refused = await resolveWith(supportCtx(), removeReportedStoryInTx, org.id, {
      canManage: false,
      canModerate: true,
    });
    expect(refused.outcome).toBe('not_removable');
    expect(refused.events).toEqual([]);
    expect(await storyDeletedAt(org.id)).toBeNull();
    expect(await logRowsFor(org.id)).toHaveLength(0);

    const unknown = await resolveWith(
      adminCtx(),
      removeReportedStoryInTx,
      '00000000-0000-4000-8000-000000000b05',
      { canManage: true, canModerate: true },
    );
    expect(unknown.outcome).toBe('already_gone');

    // A story that lives in the OTHER tenant, named from this tenant's lane.
    const [demo] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-demo'`;
    const demoAdmin = await userOf('admin@rede-demo.local');
    const [asset] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
      values (${demo?.id ?? ''}::uuid, ${demoAdmin}::uuid, 'image', 'story', 'ready', 'supabase',
              'image/webp', 1024, '{640,1080}'::int[])
      returning id`;
    createdAssets.push(asset?.id ?? '');
    const [foreign] = await adminSql<{ id: string }[]>`
      insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
      values (${demo?.id ?? ''}::uuid, ${demoAdmin}::uuid, ${asset?.id ?? ''}::uuid, 'image',
              ${`${PREFIX}de outro tenant`}, 'tenant')
      returning id`;
    const across = await resolveWith(adminCtx(), removeReportedStoryInTx, foreign?.id ?? '', {
      canManage: true,
      canModerate: true,
    });
    expect(across.outcome).toBe('already_gone');
    expect(await storyDeletedAt(foreign?.id ?? '')).toBeNull();
  });
});

describe('story comment remover', () => {
  beforeEach(async () => {
    await sweep();
  });

  /** An organization story every member can read, and one comment written by `token` on it. */
  async function commentFixture(token: string, label: string) {
    const story = await publishStory(tokens.labAdmin, userIds.labAdmin, `${PREFIX}${label}`);
    const res = await request(`/v1/stories/${story.id}/comments`, token, {
      method: 'POST',
      body: JSON.stringify({ body: `${PREFIX}comentário ${label}` }),
    });
    expect(res.status, 'POST story comment').toBe(201);
    const comment = (await res.json()) as { id: string };
    return { storyId: story.id, commentId: comment.id };
  }

  const commentDeletedAt = async (id: string) => {
    const [row] = await adminSql<{ deleted_at: string | null }[]>`
      select deleted_at::text from public.feed_comments where id = ${id}::uuid`;
    return row?.deleted_at ?? null;
  };

  it('1. a moderator’s removal writes ONE comment_removed row of subject story_comment naming the author; the event waits for afterCommit', async () => {
    const { commentId } = await commentFixture(tokens.helena, 'um');
    const done = await resolveWith(adminCtx(), removeReportedStoryCommentInTx, commentId, {
      canModerate: true,
    });
    expect(done.outcome).toBe('removed');
    expect(await commentDeletedAt(commentId)).not.toBeNull();
    expect(done.eventsBeforeCommitHook).toEqual([]);
    expect(done.events).toEqual(['story.comment_deleted']);
    const rows = await logRowsFor(commentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'comment_removed',
      subject_type: 'story_comment',
      actor_user_id: userIds.labAdmin,
      target_user_id: userIds.helena,
    });
  });

  it('2. idempotent: a repeat is already_gone with no second row and no event; an unknown id is already_gone', async () => {
    const { commentId } = await commentFixture(tokens.helena, 'dois');
    const flags = { canModerate: true };
    expect(
      (await resolveWith(adminCtx(), removeReportedStoryCommentInTx, commentId, flags)).outcome,
    ).toBe('removed');
    const again = await resolveWith(adminCtx(), removeReportedStoryCommentInTx, commentId, flags);
    expect(again.outcome).toBe('already_gone');
    expect(again.events).toEqual([]);
    expect(await logRowsFor(commentId)).toHaveLength(1);

    const unknown = await resolveWith(
      adminCtx(),
      removeReportedStoryCommentInTx,
      '00000000-0000-4000-8000-000000000b06',
      flags,
    );
    expect(unknown.outcome).toBe('already_gone');
  });

  it('3. adjacency: the author removing their own comment writes no row; without canModerate another member’s comment is not_removable and stays', async () => {
    const own = await commentFixture(tokens.helena, 'própria');
    const byAuthor = await resolveWith(
      ctxFor(userIds.helena, 'member'),
      removeReportedStoryCommentInTx,
      own.commentId,
      { canModerate: false },
    );
    expect(byAuthor.outcome).toBe('removed');
    expect(await logRowsFor(own.commentId)).toHaveLength(0);

    const other = await commentFixture(tokens.helena, 'de outra pessoa');
    const refused = await resolveWith(
      ctxFor(userIds.marcos, 'member'),
      removeReportedStoryCommentInTx,
      other.commentId,
      { canModerate: false },
    );
    expect(refused.outcome).toBe('not_removable');
    expect(refused.events).toEqual([]);
    expect(await commentDeletedAt(other.commentId)).toBeNull();
    expect(await logRowsFor(other.commentId)).toHaveLength(0);
  });

  it('4. a comment of a feed POST is not a story comment: already_gone, and nothing is touched', async () => {
    const [post] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
      values (${labTenantId}::uuid, ${userIds.labAdmin}::uuid, ${`${PREFIX}post`}, 'tenant')
      returning id`;
    const [comment] = await adminSql<{ id: string }[]>`
      insert into public.feed_comments (tenant_id, author_user_id, post_id, body)
      values (${labTenantId}::uuid, ${userIds.helena}::uuid, ${post?.id ?? ''}::uuid, ${`${PREFIX}c`})
      returning id`;
    try {
      const done = await resolveWith(
        adminCtx(),
        removeReportedStoryCommentInTx,
        comment?.id ?? '',
        {
          canModerate: true,
        },
      );
      expect(done.outcome).toBe('already_gone');
      expect(await commentDeletedAt(comment?.id ?? '')).toBeNull();
    } finally {
      await adminSql`delete from public.feed_comments where post_id = ${post?.id ?? ''}::uuid`;
      await adminSql`delete from public.feed_posts where id = ${post?.id ?? ''}::uuid`;
    }
  });
});

describe('community remover', () => {
  beforeEach(async () => {
    await sweep();
  });

  const create = async (token: string, name: string, description = ''): Promise<string> => {
    const res = await request('/v1/communities', token, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    expect(res.status, `POST /v1/communities ${name}`).toBe(201);
    return ((await res.json()) as CommunitySummary).id;
  };
  const statusOf = async (id: string) => {
    const [row] = await adminSql<{ status: string }[]>`
      select status from public.communities where id = ${id}::uuid`;
    return row?.status;
  };

  it('1. a moderator archiving a MEMBER community writes ONE community_archived row naming the creator and the name; it leaves the active list and still opens read-only', async () => {
    const id = await create(tokens.helena, `${PREFIX}Corrida`, 'descrição que não vai ao log');
    const done = await resolveWith(adminCtx(), archiveReportedCommunityInTx, id, {
      canManage: true,
    });
    expect(done.outcome).toBe('removed');
    expect(await statusOf(id)).toBe('archived');
    expect(done.eventsBeforeCommitHook).toEqual([]);
    expect(done.events).toEqual(['community.archived']);
    const rows = await logRowsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'community_archived',
      subject_type: 'community',
      actor_user_id: userIds.labAdmin,
      target_user_id: userIds.helena,
      excerpt: `${PREFIX}Corrida`,
    });

    const active = await request('/v1/communities?limit=100', tokens.helena);
    const items = ((await active.json()) as { items: { id: string }[] }).items;
    expect(items.map((item) => item.id)).not.toContain(id);
    const opened = await request(`/v1/communities/${id}`, tokens.helena);
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as CommunitySummary).status).toBe('archived');
  });

  it('2. idempotent: archiving again, or an unknown id, is already_gone with no second row and no event', async () => {
    const id = await create(tokens.helena, `${PREFIX}repetida`);
    const flags = { canManage: true };
    expect((await resolveWith(adminCtx(), archiveReportedCommunityInTx, id, flags)).outcome).toBe(
      'removed',
    );
    const again = await resolveWith(adminCtx(), archiveReportedCommunityInTx, id, flags);
    expect(again.outcome).toBe('already_gone');
    expect(again.events).toEqual([]);
    expect(await logRowsFor(id)).toHaveLength(1);

    const unknown = await resolveWith(
      adminCtx(),
      archiveReportedCommunityInTx,
      '00000000-0000-4000-8000-000000000b07',
      flags,
    );
    expect(unknown.outcome).toBe('already_gone');
  });

  it('3. adjacency: the creator archiving their own community and a moderator archiving an organization community write NO row', async () => {
    const own = await create(tokens.helena, `${PREFIX}própria`);
    const byCreator = await resolveWith(
      ctxFor(userIds.helena, 'member'),
      archiveReportedCommunityInTx,
      own,
      { canManage: false },
    );
    expect(byCreator.outcome).toBe('removed');
    expect(await statusOf(own)).toBe('archived');
    expect(await logRowsFor(own)).toHaveLength(0);

    const org = await create(tokens.labAdmin, `${PREFIX}da organização`);
    const byModerator = await resolveWith(adminCtx(), archiveReportedCommunityInTx, org, {
      canManage: true,
    });
    expect(byModerator.outcome).toBe('removed');
    expect(await statusOf(org)).toBe('archived');
    expect(await logRowsFor(org)).toHaveLength(0);
  });

  it('4. refusal: a caller without communities.community.manage who is not the creator gets not_removable and nothing changes', async () => {
    const id = await create(tokens.helena, `${PREFIX}alheia`);
    const refused = await resolveWith(
      ctxFor(userIds.marcos, 'member'),
      archiveReportedCommunityInTx,
      id,
      { canManage: false },
    );
    expect(refused.outcome).toBe('not_removable');
    expect(refused.events).toEqual([]);
    expect(await statusOf(id)).toBe('active');
    expect(await logRowsFor(id)).toHaveLength(0);
  });

  it('5. empty: a community with no description archives without error and logs the name only; another tenant’s community is already_gone', async () => {
    const id = await create(tokens.helena, `${PREFIX}sem descrição`);
    const done = await resolveWith(adminCtx(), archiveReportedCommunityInTx, id, {
      canManage: true,
    });
    expect(done.outcome).toBe('removed');
    expect((await logRowsFor(id))[0]?.excerpt).toBe(`${PREFIX}sem descrição`);

    const [demo] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-demo'`;
    const demoAdmin = await userOf('admin@rede-demo.local');
    const [foreign] = await adminSql<{ id: string }[]>`
      insert into public.communities (tenant_id, created_by_user_id, name, slug, kind)
      values (${demo?.id ?? ''}::uuid, ${demoAdmin}::uuid, ${`${PREFIX}de outro tenant`},
              ${`teste-11-05-rem-${Date.now()}`}, 'organization')
      returning id`;
    const across = await resolveWith(adminCtx(), archiveReportedCommunityInTx, foreign?.id ?? '', {
      canManage: true,
    });
    expect(across.outcome).toBe('already_gone');
    expect(await statusOf(foreign?.id ?? '')).toBe('active');
  });
});
