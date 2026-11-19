import { sqlClient } from '@rede-social/core/db';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import {
  communityCreateLimiter,
  storyPublishLimiter,
} from '@rede-social/core/server/safety/limits';
import type { StorySummary } from '@rede-social/module-stories/contracts';
import { type ReportedRemoval, removeReportedStoryInTx } from '@rede-social/module-stories/server';
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
 * 11-05 (D-732, MODER-04; T-11-11, T-11-20) against the live local stack and the real seed: the three
 * in-transaction removers a report's resolution calls with the caller's `tx` — the member story, the story
 * comment and the member community. Each is opened here in a `withTenantTx` of its own, exactly as the kernel's
 * resolution does, then `afterCommit` is run by hand after the commit.
 *
 * The moderation log is APPEND-ONLY, so nothing here deletes a log row: every assertion is scoped by the id
 * of the item the test created. Fixtures carry `PREFIX` and are swept in `beforeAll` and `afterAll`.
 */

const PREFIX = 'Teste 11-05 rem ';
const tokens = { helena: '', labAdmin: '' };
const userIds = { helena: '', marcos: '', labAdmin: '', labSupport: '' };
let labTenantId = '';
let restoreSocial: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};

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
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
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
