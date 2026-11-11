import { randomUUID } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { safetyLimiterKey, storyPublishLimiter } from '@rede-social/core/server/safety/limits';
import {
  STORY_EXPIRY_HOURS,
  STORY_MAX_PAGE_SIZE,
  type StoryPage,
  type StorySummary,
} from '@rede-social/module-stories/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  HOSTS,
  notificationJobsOf,
  runNotificationJobs,
  SEED_PASSWORD,
  signInAs,
  withCommunitiesEnabled,
  withSocialEnabled,
  withStoriesEnabled,
} from './setup';

/**
 * 10-07 (D-704, D-711, D-714, D-715, D-717, D-718; MSTORY-01/02/05/07/09) against the live local stack
 * and the real seed: a member of a `social` tenant publishes a 24-hour story that only the audience gate
 * can show, that appears in none of Início's reads, that nobody is told about, and that the author or a
 * moderator can delete.
 *
 * `10 tracer` is ONE member story, ONE organization story, the stamp, the org-only strip, the
 * notification guard and the zero-notification proof. `10 history` and `10 delete` arrive with the
 * later task of the plan and share these fixtures.
 *
 * Fixtures: rede-lab has `social` ON in the seed, `stories`, `communities` and `notifications` OFF; the
 * suite turns the three it needs on and puts them back. Every story this file writes carries `PREFIX`
 * (or sits on an asset this file made), so the sweep is exact. Test ORDER inside a describe is
 * load-bearing (declaration order).
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const PREFIX = 'Teste 10-07 ';
const tokens = { helena: '', marcos: '', labAdmin: '' };
const userIds = { helena: '', marcos: '', labAdmin: '' };
let labTenantId = '';
let restoreSocial: () => Promise<void> = async () => {};
let restoreCommunities: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
let restoreNotifications: () => Promise<void> = async () => {};
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

const post = (path: string, token: string, body: unknown) =>
  request(path, token, { method: 'POST', body: JSON.stringify(body) });

const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;

/** `notifications` is OFF on rede-lab in the seed; the zero-notification proof needs the module on. */
async function enableNotifications(): Promise<() => Promise<void>> {
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${labTenantId}::uuid and module_key = 'notifications'`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${labTenantId}::uuid, 'notifications', true)
    on conflict (tenant_id, module_key) do update set enabled = true, updated_at = now()`;
  moduleFlags.invalidate(labTenantId);
  return async () => {
    if (previous) {
      await adminSql`
        update public.tenant_modules set enabled = ${previous.enabled}
         where tenant_id = ${labTenantId}::uuid and module_key = 'notifications'`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = 'notifications'`;
    }
    moduleFlags.invalidate(labTenantId);
  };
}

async function userOf(email: string): Promise<string> {
  const [row] = await adminSql<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.user_id;
}

/** A `purpose: 'story'` asset of rede-lab owned by `ownerId`, in the state the caller asked for. */
async function makeAsset(
  ownerId: string,
  opts: { kind?: 'image' | 'video'; status?: string; bytes?: number } = {},
): Promise<string> {
  const id = randomUUID();
  createdAssets.push(id);
  const video = opts.kind === 'video';
  await adminSql`
    insert into public.media_assets
      (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
    values (${id}::uuid, ${labTenantId}::uuid, ${ownerId}::uuid, ${opts.kind ?? 'image'}, 'story',
            ${opts.status ?? 'ready'}, ${video ? 'fake' : 'supabase'},
            ${video ? 'video/mp4' : 'image/webp'}, ${opts.bytes ?? 1024},
            ${video ? '{}' : '{640,1080}'}::int[])`;
  return id;
}

const publish = (token: string, body: Record<string, unknown>) => post('/v1/stories', token, body);

async function storyRow(id: string) {
  const [row] = await adminSql<
    {
      visibility: string;
      author_user_id: string;
      caption: string;
      deleted_at: string | null;
      lifetime_hours: number;
    }[]
  >`select visibility, author_user_id, caption, deleted_at,
           extract(epoch from (expires_at - published_at)) / 3600 as lifetime_hours
      from public.stories where id = ${id}::uuid`;
  return row;
}

/** Every active story of the Início strip for `token`, walked to the end. */
async function strip(token: string): Promise<StorySummary[]> {
  const seen: StorySummary[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 30; guard++) {
    const query: string = cursor
      ? `?limit=${STORY_MAX_PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=${STORY_MAX_PAGE_SIZE}`;
    const res: Response = await request(`/v1/stories${query}`, token);
    expect(res.status, `GET /v1/stories${query}`).toBe(200);
    const body = (await res.json()) as StoryPage;
    seen.push(...body.items);
    cursor = body.nextCursor;
    if (cursor === null) break;
  }
  return seen;
}

async function mine(token: string): Promise<StorySummary[]> {
  const res = await request(`/v1/stories/mine?limit=${STORY_MAX_PAGE_SIZE}`, token);
  expect(res.status, 'GET /v1/stories/mine').toBe(200);
  return ((await res.json()) as StoryPage).items;
}

/** A story row written by hand (the lanes the HTTP route cannot stage: same second, expired). */
async function insertStory(opts: {
  author: string;
  visibility: 'tenant' | 'followers';
  caption: string;
  publishedAt?: string;
  expiresAt?: string;
}): Promise<string> {
  const asset = await makeAsset(opts.author);
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.stories
      (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility,
       published_at, expires_at)
    values (${labTenantId}::uuid, ${opts.author}::uuid, ${asset}::uuid, 'image', ${opts.caption},
            ${opts.visibility},
            coalesce(${opts.publishedAt ?? null}::timestamptz, now()),
            coalesce(${opts.expiresAt ?? null}::timestamptz, now() + interval '24 hours'))
    returning id`;
  return row?.id ?? '';
}

async function sweep(): Promise<void> {
  const ids = await adminSql<{ id: string }[]>`
    select id from public.stories
     where caption like ${`${PREFIX}%`}
        or media_asset_id = any (${createdAssets}::uuid[])`;
  const storyIds = ids.map((row) => row.id);
  if (storyIds.length > 0) {
    await adminSql`delete from public.notifications where subject_id = any (${storyIds}::uuid[])`;
    await adminSql`delete from public.moderation_log where subject_id = any (${storyIds}::uuid[])`;
    await adminSql`delete from public.stories where id = any (${storyIds}::uuid[])`;
  }
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any (${createdAssets}::uuid[])`;
  }
  // A story another suite's assertion would count must never outlive this file.
  await adminSql`delete from public.stories where caption like ${`${PREFIX}%`}`;
}

async function closeWaitingJobs(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name = 'notifications.fanout' and state = 'created'
       and data->>'tenantId' = ${labTenantId}`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  restoreSocial = await withSocialEnabled('lab');
  restoreCommunities = await withCommunitiesEnabled('lab');
  restoreStories = await withStoriesEnabled('lab');
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.marcos = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
  userIds.marcos = await userOf('marcos.vinicius@rede-lab.local');
  userIds.labAdmin = await userOf('admin@rede-lab.local');
  const [lab] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  restoreNotifications = await enableNotifications();
  await sweep();
});

// Every case publishes as Helena or Marcos; the per-process ceiling (A6) must not leak between cases.
beforeEach(() => {
  storyPublishLimiter.reset();
});

afterAll(async () => {
  await sweep();
  await closeWaitingJobs();
  await restoreNotifications();
  await restoreStories();
  await restoreCommunities();
  await restoreSocial();
  await adminSql.end();
  await sqlClient.end();
});

describe('10 tracer', () => {
  const made: { member?: StorySummary; org?: StorySummary } = {};

  it('1. MSTORY-01 / D-714: Helena publishes a photo story with a caption: 201, stored followers, her id, a 24 hour window', async () => {
    const asset = await makeAsset(userIds.helena);
    const res = await publish(tokens.helena, {
      mediaAssetId: asset,
      mediaKind: 'image',
      caption: `${PREFIX}minha corrida`,
    });
    expect(res.status).toBe(201);
    made.member = (await res.json()) as StorySummary;
    const row = await storyRow(made.member.id);
    expect(row?.visibility).toBe('followers');
    expect(row?.author_user_id).toBe(userIds.helena);
    expect(row?.caption).toBe(`${PREFIX}minha corrida`);
    expect(Number(row?.lifetime_hours)).toBeCloseTo(STORY_EXPIRY_HOURS, 3);
  });

  it('2. the lab admin publishes an organization story: stored tenant (the positive control of the stamp)', async () => {
    await closeWaitingJobs();
    const asset = await makeAsset(userIds.labAdmin);
    const res = await publish(tokens.labAdmin, {
      mediaAssetId: asset,
      mediaKind: 'image',
      caption: `${PREFIX}do tenant`,
    });
    expect(res.status).toBe(201);
    made.org = (await res.json()) as StorySummary;
    expect((await storyRow(made.org.id))?.visibility).toBe('tenant');
  });

  it('3. MSTORY-02 / D-704: Início’s strip holds the admin’s story and NOT Helena’s, for a member who could otherwise read it', async () => {
    const ids = (await strip(tokens.marcos)).map((item) => item.id);
    expect(ids).toContain(made.org?.id);
    expect(ids).not.toContain(made.member?.id);
    // The admin lane (which reads every story under RLS) gets the same strip: the literal, not the lane.
    const adminIds = (await strip(tokens.labAdmin)).map((item) => item.id);
    expect(adminIds).toContain(made.org?.id);
    expect(adminIds).not.toContain(made.member?.id);
    // The author herself does not see it on Início either (her own list is /mine).
    const helenaIds = (await strip(tokens.helena)).map((item) => item.id);
    expect(helenaIds).toContain(made.org?.id);
    expect(helenaIds).not.toContain(made.member?.id);
  });

  it('4. the stamp never comes from the body: visibility and any unknown key answer 400, nothing is stored', async () => {
    const before = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.stories where author_user_id = ${userIds.helena}::uuid`;
    for (const extra of [
      { visibility: 'tenant' },
      { visibility: 'followers' },
      { authorUserId: userIds.marcos },
      { communityId: randomUUID() },
    ]) {
      const asset = await makeAsset(userIds.helena);
      const res = await publish(tokens.helena, {
        mediaAssetId: asset,
        mediaKind: 'image',
        caption: `${PREFIX}forjada`,
        ...extra,
      });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    const after = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.stories where author_user_id = ${userIds.helena}::uuid`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it('5. MSTORY-05 / PR-4: nobody is told of Helena’s story (no row, no job), while the admin’s keeps its broadcast', async () => {
    const memberId = made.member?.id ?? '';
    const orgId = made.org?.id ?? '';
    const jobs = (await notificationJobsOf(labTenantId)).filter((job) => {
      const payload = job.data.payload as { storyId?: string } | undefined;
      return payload?.storyId === memberId || payload?.storyId === orgId;
    });
    const jobStories = jobs.map((job) => (job.data.payload as { storyId: string }).storyId);
    // Positive control first: the organization story DID enqueue its fan-out.
    expect(jobStories).toContain(orgId);
    expect(jobStories).not.toContain(memberId);

    await runNotificationJobs(labTenantId);
    const rows = await adminSql<{ subject_id: string }[]>`
      select subject_id::text as subject_id from public.notifications
       where tenant_id = ${labTenantId}::uuid and subject_id = any (${[memberId, orgId]}::uuid[])`;
    expect(rows.filter((row) => row.subject_id === orgId).length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.subject_id === memberId)).toHaveLength(0);
  });

  it('6. GET /v1/stories/mine: Helena lists her own story (expired ones too), the admin lists only organization stories', async () => {
    const expired = await insertStory({
      author: userIds.helena,
      visibility: 'followers',
      caption: `${PREFIX}ontem`,
      publishedAt: new Date(Date.now() - 30 * 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
    });
    const helena = await mine(tokens.helena);
    const helenaIds = helena.map((item) => item.id);
    expect(helenaIds).toContain(made.member?.id);
    expect(helenaIds).toContain(expired);
    expect(helenaIds).not.toContain(made.org?.id);
    expect(helena.find((item) => item.id === expired)?.isActive).toBe(false);

    const admin = await mine(tokens.labAdmin);
    const adminIds = admin.map((item) => item.id);
    expect(adminIds).toContain(made.org?.id);
    expect(adminIds).not.toContain(made.member?.id);
    expect(adminIds).not.toContain(expired);

    // Marcos holds the publish key too, so the door is open, but it lists HIS stories: none.
    const marcos = (await mine(tokens.marcos)).map((item) => item.id);
    expect(marcos).not.toContain(made.member?.id);
    expect(marcos).not.toContain(made.org?.id);
  });

  it('7. D-718 / EP-41: with social off and a WARM flags cache the SQL gate closes the window: 403, never 500; after the window the permission is gone: 403', async () => {
    // Warm the cache (the permission set includes the member key while social is on).
    const warm = await request('/v1/stories/mine', tokens.helena);
    expect(warm.status).toBe(200);
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    try {
      const asset = await makeAsset(userIds.helena);
      const body = { mediaAssetId: asset, mediaKind: 'image', caption: `${PREFIX}sem social` };
      const stale = await publish(tokens.helena, body);
      expect(stale.status).toBe(403);
      expect((await errorOf(stale)).code).toBe('FORBIDDEN');

      moduleFlags.invalidate(labTenantId);
      const fresh = await publish(tokens.helena, body);
      expect(fresh.status).toBe(403);
      const [stored] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.stories where caption = ${`${PREFIX}sem social`}`;
      expect(stored?.n).toBe(0);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
    }
    // The admin's own publishing was never gated by social.
    const asset = await makeAsset(userIds.labAdmin);
    const res = await publish(tokens.labAdmin, {
      mediaAssetId: asset,
      mediaKind: 'image',
      caption: `${PREFIX}admin segue`,
    });
    expect(res.status).toBe(201);
  });

  it('8. A6: the 31st publish attempt in the hour is 429 (every attempt counts, a refused one included)', async () => {
    const key = safetyLimiterKey({ tenantId: labTenantId, userId: userIds.marcos });
    for (let attempt = 0; attempt < 29; attempt += 1) storyPublishLimiter.consume(key);
    const asset = await makeAsset(userIds.marcos);
    const thirtieth = await publish(tokens.marcos, {
      mediaAssetId: asset,
      mediaKind: 'image',
      caption: `${PREFIX}trinta`,
    });
    expect(thirtieth.status).toBe(201);
    const thirtyFirst = await publish(tokens.marcos, {
      mediaAssetId: asset,
      mediaKind: 'image',
      caption: `${PREFIX}trinta e um`,
    });
    expect(thirtyFirst.status).toBe(429);
    expect((await errorOf(thirtyFirst)).code).toBe('RATE_LIMITED');
  });

  it('9. a member naming a destination answers 403 before any lookup (the highlight owner branch is plan 09)', async () => {
    const asset = await makeAsset(userIds.helena);
    for (const destination of [
      { newHighlight: { communityId: null, title: `${PREFIX}destaque` } },
      { highlightId: randomUUID() },
    ]) {
      const res = await publish(tokens.helena, {
        mediaAssetId: asset,
        mediaKind: 'image',
        caption: `${PREFIX}destino`,
        ...destination,
      });
      expect(res.status, JSON.stringify(destination)).toBe(403);
    }
    const [stored] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.stories where caption = ${`${PREFIX}destino`}`;
    expect(stored?.n).toBe(0);
  });

  it('10. EP-57: a member story and an organization story created in the same second list so that Início holds only the organization one, in either insert order', async () => {
    const at = new Date(Date.now() - 2_000).toISOString();
    const until = new Date(Date.now() + 23 * 3_600_000).toISOString();
    const orders: Array<Array<'followers' | 'tenant'>> = [
      ['followers', 'tenant'],
      ['tenant', 'followers'],
    ];
    for (const order of orders) {
      const ids: Record<string, string> = {};
      for (const visibility of order) {
        ids[visibility] = await insertStory({
          author: visibility === 'tenant' ? userIds.labAdmin : userIds.helena,
          visibility,
          caption: `${PREFIX}mesmo segundo ${order.join('-')}`,
          publishedAt: at,
          expiresAt: until,
        });
      }
      const listed = (await strip(tokens.marcos)).map((item) => item.id);
      expect(listed, order.join('-')).toContain(ids.tenant);
      expect(listed, order.join('-')).not.toContain(ids.followers);
    }
  });

  it('11. EP-59: the strip keeps its order (expires_at desc, id desc) with member stories in the table', async () => {
    const listed = (await strip(tokens.marcos)).map((item) => item.id);
    const expected = await adminSql<{ id: string }[]>`
      select s.id from public.stories s
        join public.media_assets a on a.id = s.media_asset_id
       where s.tenant_id = ${labTenantId}::uuid and s.deleted_at is null and s.expires_at > now()
         and a.status = 'ready' and s.visibility = 'tenant'
       order by s.expires_at desc, s.id desc`;
    expect(listed).toEqual(expected.map((row) => row.id));
  });

  it('12. EP-58: with member stories and NO organization story the strip is an empty page, not an error', async () => {
    await adminSql`
      update public.stories set deleted_at = now()
       where tenant_id = ${labTenantId}::uuid and visibility = 'tenant' and deleted_at is null`;
    try {
      const res = await request('/v1/stories?limit=20', tokens.marcos);
      expect(res.status).toBe(200);
      const body = (await res.json()) as StoryPage;
      expect(body.items).toEqual([]);
      expect(body.nextCursor).toBeNull();
      // The positive control: member stories do exist in the table for this tenant.
      const [members] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.stories
         where tenant_id = ${labTenantId}::uuid and visibility = 'followers' and deleted_at is null`;
      expect(members?.n).toBeGreaterThan(0);
    } finally {
      // The repair is a plain UPDATE back to NULL (the stories.test.ts case 5 precedent): the seed holds
      // no soft-deleted organization story, so every row restored here was live a moment ago.
      await adminSql`
        update public.stories set deleted_at = null
         where tenant_id = ${labTenantId}::uuid and visibility = 'tenant' and deleted_at is not null`;
    }
  });

  it('13. D-704: an Início highlight holding an organization story and a member story shows only the organization one (count, items), for members and for the curator', async () => {
    const org = await insertStory({
      author: userIds.labAdmin,
      visibility: 'tenant',
      caption: `${PREFIX}destaque org`,
    });
    const member = await insertStory({
      author: userIds.helena,
      visibility: 'followers',
      caption: `${PREFIX}destaque membro`,
    });
    const [highlight] = await adminSql<{ id: string }[]>`
      insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
      values (${labTenantId}::uuid, null, ${`${PREFIX}destaque`}, 9000, ${userIds.labAdmin}::uuid)
      returning id`;
    const highlightId = highlight?.id ?? '';
    try {
      for (const story of [org, member]) {
        await adminSql`
          insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
          values (${labTenantId}::uuid, ${highlightId}::uuid, ${story}::uuid, ${userIds.labAdmin}::uuid)`;
      }
      for (const token of [tokens.marcos, tokens.labAdmin]) {
        const detail = await request(`/v1/stories/highlights/${highlightId}`, token);
        expect(detail.status).toBe(200);
        const body = (await detail.json()) as {
          highlight: { itemCount: number };
          items: StorySummary[];
        };
        expect(body.items.map((item) => item.id)).toEqual([org]);
        expect(body.highlight.itemCount).toBe(1);
      }
      const row = await request('/v1/stories/highlights?scope=all', tokens.labAdmin);
      const list = (await row.json()) as { items: { id: string; itemCount: number }[] };
      expect(list.items.find((item) => item.id === highlightId)?.itemCount).toBe(1);
    } finally {
      await adminSql`delete from public.story_highlights where id = ${highlightId}::uuid`;
    }
  });
});
