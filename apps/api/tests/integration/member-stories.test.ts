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
const tokens = { helena: '', marcos: '', alvaro: '', labAdmin: '', support: '', plain: '' };
const userIds = { helena: '', marcos: '', alvaro: '', labAdmin: '' };
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
  tokens.alvaro = await signInAs('alvaro.pinheiro@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.support = await signInAs('support@rede-lab.local', SEED_PASSWORD);
  tokens.plain = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
  userIds.marcos = await userOf('marcos.vinicius@rede-lab.local');
  userIds.alvaro = await userOf('alvaro.pinheiro@rede-lab.local');
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

describe('10 delete', () => {
  const removeStory = (token: string, id: string) =>
    request(`/v1/stories/${id}`, token, { method: 'DELETE' });

  const publishAs = async (
    token: string,
    ownerId: string,
    caption: string,
  ): Promise<StorySummary> => {
    const asset = await makeAsset(ownerId);
    const res = await publish(token, { mediaAssetId: asset, mediaKind: 'image', caption });
    expect(res.status, `publish ${caption}`).toBe(201);
    return (await res.json()) as StorySummary;
  };

  const logCount = async (storyId: string): Promise<number> => {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.moderation_log where subject_id = ${storyId}::uuid`;
    return row?.n ?? 0;
  };

  it('1. D-711: the author deletes their own story (204, no log row), it leaves GET /mine, and a second delete is the bare 404', async () => {
    const story = await publishAs(tokens.helena, userIds.helena, `${PREFIX}apagar`);
    expect((await mine(tokens.helena)).map((item) => item.id)).toContain(story.id);
    const res = await removeStory(tokens.helena, story.id);
    expect(res.status).toBe(204);
    expect((await storyRow(story.id))?.deleted_at).not.toBeNull();
    expect(await logCount(story.id)).toBe(0);
    expect((await mine(tokens.helena)).map((item) => item.id)).not.toContain(story.id);
    const second = await removeStory(tokens.helena, story.id);
    expect(second.status).toBe(404);
    expect((await errorOf(second)).details).toBeUndefined();
  });

  it('2. T-10-25: another member touching Helena’s story is 403 when the row is visible to them (a follower) and the bare 404 when it is not; nothing is deleted', async () => {
    const story = await publishAs(tokens.helena, userIds.helena, `${PREFIX}alheia`);
    // Alvaro follows Helena (seed): the audience gate shows him the row, so the refusal is a 403.
    const follower = await removeStory(tokens.alvaro, story.id);
    expect(follower.status).toBe(403);
    expect((await errorOf(follower)).code).toBe('FORBIDDEN');
    // Marcos does not: the lane cannot read the story, so it is the bare 404 (no existence oracle).
    const stranger = await removeStory(tokens.marcos, story.id);
    expect(stranger.status).toBe(404);
    expect((await errorOf(stranger)).details).toBeUndefined();
    expect((await storyRow(story.id))?.deleted_at).toBeNull();
    expect(await logCount(story.id)).toBe(0);
  });

  it('3. a member touching an ORGANIZATION story is 403, and the admin deleting it writes no row (unchanged)', async () => {
    const org = await publishAs(tokens.labAdmin, userIds.labAdmin, `${PREFIX}org apagar`);
    const refused = await removeStory(tokens.helena, org.id);
    expect(refused.status).toBe(403);
    expect((await storyRow(org.id))?.deleted_at).toBeNull();
    expect((await removeStory(tokens.labAdmin, org.id)).status).toBe(204);
    expect(await logCount(org.id)).toBe(0);
  });

  it('4. a story id of another tenant is the bare 404', async () => {
    const [foreign] = await adminSql<{ id: string }[]>`
      select id from public.stories where tenant_id <> ${labTenantId}::uuid limit 1`;
    expect(foreign?.id).toBeTruthy();
    const res = await removeStory(tokens.labAdmin, foreign?.id ?? '');
    expect(res.status).toBe(404);
    expect((await errorOf(res)).details).toBeUndefined();
    const [still] = await adminSql<{ deleted_at: string | null }[]>`
      select deleted_at::text from public.stories where id = ${foreign?.id ?? ''}::uuid`;
    expect(still?.deleted_at).toBeNull();
  });

  it('5. T-10-29 / A7: a follower reading Helena’s story finds no user id of hers (uuid scan) and the three safe author fields; Helena reads her own authorUserId', async () => {
    const story = await publishAs(tokens.helena, userIds.helena, `${PREFIX}autoria`);
    const asFollower = await request(`/v1/stories/${story.id}`, tokens.alvaro);
    expect(asFollower.status).toBe(200);
    const text = await asFollower.text();
    expect(text).not.toContain(userIds.helena);
    const wire = JSON.parse(text) as StorySummary;
    expect(wire.authorUserId).toBeNull();
    expect(Object.keys(wire.author ?? {}).sort()).toEqual([
      'avatarUrl',
      'displayName',
      'membershipId',
    ]);
    const [membership] = await adminSql<{ id: string }[]>`
      select id from public.memberships
       where tenant_id = ${labTenantId}::uuid and user_id = ${userIds.helena}::uuid`;
    expect(wire.author?.membershipId).toBe(membership?.id);
    expect(wire.author?.displayName.length).toBeGreaterThan(0);

    const own = (await (
      await request(`/v1/stories/${story.id}`, tokens.helena)
    ).json()) as StorySummary;
    expect(own.authorUserId).toBe(userIds.helena);

    // The moderator and every list read send no foreign user id either; an organization story names no person.
    const org = await publishAs(tokens.labAdmin, userIds.labAdmin, `${PREFIX}autoria org`);
    const stripText = await (
      await request(`/v1/stories?limit=${STORY_MAX_PAGE_SIZE}`, tokens.alvaro)
    ).text();
    expect(stripText).toContain(org.id);
    expect(stripText).not.toContain(userIds.labAdmin);
    expect(stripText).not.toContain(userIds.helena);
    const orgWire = JSON.parse(
      await (await request(`/v1/stories/${org.id}`, tokens.alvaro)).text(),
    ) as StorySummary;
    expect(orgWire.authorUserId).toBeNull();
    expect(orgWire.author).toBeNull();
  });
});

/**
 * 10-08 (D-714, D-717, D-705, D-718; MSTORY-03/04/08): the Explorar story row's API. Alvaro follows Helena
 * (seed), Helena follows Marcos, Marcos follows nobody; the lab admin holds `moderation.manage`; `support@`
 * is a real `support_tenant` session. Stories are written by hand so every case controls its audience and
 * its clock. The describe sweeps its own residue first (the earlier describes leave their stories behind).
 */
type AuthorItem = {
  membershipId: string;
  displayName: string;
  avatarUrl: string | null;
  storyCount: number;
  latestPublishedAt: string;
  hasUnseen: boolean;
  isSelf: boolean;
};
type AuthorsPage = { items: AuthorItem[]; nextCursor: string | null };

const membershipOf = async (userId: string): Promise<string> => {
  const [row] = await adminSql<{ id: string }[]>`
    select id from public.memberships
     where tenant_id = ${labTenantId}::uuid and user_id = ${userId}::uuid`;
  return row?.id ?? '';
};
const authorsRead = (token: string, query = '') => request(`/v1/stories/authors${query}`, token);
const groupRead = (token: string, membershipId: string) =>
  request(`/v1/stories/authors/${membershipId}`, token);
const authorsOf = async (token: string, query = ''): Promise<AuthorsPage> => {
  const res = await authorsRead(token, query);
  expect(res.status, `GET /v1/stories/authors${query}`).toBe(200);
  return (await res.json()) as AuthorsPage;
};

describe('10 authors', () => {
  const memberships = { helena: '', marcos: '', alvaro: '' };
  const made: { helenaOld?: string; helenaNew?: string; marcos?: string; org?: string } = {};

  beforeAll(async () => {
    await sweep();
    memberships.helena = await membershipOf(userIds.helena);
    memberships.marcos = await membershipOf(userIds.marcos);
    memberships.alvaro = await membershipOf(userIds.alvaro);
  });

  it('1. MSTORY-03 / D-714 tracer: Alvaro (follows Helena) reads Helena’s circle and not Marcos’s, with exactly the seven keys; no own item without a live story', async () => {
    made.helenaOld = await insertStory({
      author: userIds.helena,
      visibility: 'followers',
      caption: `${PREFIX}helena antiga`,
      publishedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    });
    made.helenaNew = await insertStory({
      author: userIds.helena,
      visibility: 'followers',
      caption: `${PREFIX}helena nova`,
      publishedAt: new Date(Date.now() - 1 * 3_600_000).toISOString(),
    });
    made.marcos = await insertStory({
      author: userIds.marcos,
      visibility: 'followers',
      caption: `${PREFIX}marcos`,
    });
    made.org = await insertStory({
      author: userIds.labAdmin,
      visibility: 'tenant',
      caption: `${PREFIX}org`,
    });
    const page = await authorsOf(tokens.alvaro);
    expect(page.nextCursor).toBeNull();
    const ids = page.items.map((item) => item.membershipId);
    expect(ids).toContain(memberships.helena);
    expect(ids).not.toContain(memberships.marcos);
    expect(ids).not.toContain(memberships.alvaro);
    const helena = page.items.find((item) => item.membershipId === memberships.helena);
    expect(Object.keys(helena ?? {}).sort()).toEqual([
      'avatarUrl',
      'displayName',
      'hasUnseen',
      'isSelf',
      'latestPublishedAt',
      'membershipId',
      'storyCount',
    ]);
    expect(helena?.storyCount).toBe(2);
    expect(helena?.hasUnseen).toBe(true);
    expect(helena?.isSelf).toBe(false);
    expect(helena?.displayName.length).toBeGreaterThan(0);
    // The organization story is in neither read: no circle for the admin, no user id on the wire.
    expect(ids).not.toContain(await membershipOf(userIds.labAdmin));
    expect(JSON.stringify(page)).not.toContain(userIds.helena);
  });

  it('2. D-714: the group read returns Helena’s live stories oldest first through the story projection (viewerSeen included)', async () => {
    const res = await groupRead(tokens.alvaro, memberships.helena);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: StorySummary[] };
    expect(body.items.map((item) => item.id)).toEqual([made.helenaOld, made.helenaNew]);
    expect(body.items.every((item) => item.viewerSeen === false)).toBe(true);
    expect(body.items.every((item) => item.authorUserId === null)).toBe(true);
    expect(body.items[0]?.author?.membershipId).toBe(memberships.helena);
  });

  it('3. T-10-30: Marcos (not a follower) gets the bare 404 on the group read, on the story id, and on a like and a comment; Alvaro’s like and comment succeed', async () => {
    for (const [label, res] of [
      ['group', await groupRead(tokens.marcos, memberships.helena)],
      ['story id', await request(`/v1/stories/${made.helenaNew}`, tokens.marcos)],
      [
        'like',
        await request(`/v1/stories/${made.helenaNew}/likes`, tokens.marcos, { method: 'POST' }),
      ],
      ['comments list', await request(`/v1/stories/${made.helenaNew}/comments`, tokens.marcos)],
      [
        'comment',
        await post(`/v1/stories/${made.helenaNew}/comments`, tokens.marcos, { body: 'oi' }),
      ],
    ] as const) {
      expect(res.status, label).toBe(404);
      expect((await errorOf(res)).details, label).toBeUndefined();
    }
    // Positive controls: the follower reads, likes and comments on the same story.
    expect((await request(`/v1/stories/${made.helenaNew}`, tokens.alvaro)).status).toBe(200);
    const liked = await request(`/v1/stories/${made.helenaNew}/likes`, tokens.alvaro, {
      method: 'POST',
    });
    expect(liked.status).toBe(200);
    const commented = await post(`/v1/stories/${made.helenaNew}/comments`, tokens.alvaro, {
      body: `${PREFIX}comentario`,
    });
    expect(commented.status).toBe(201);
    expect((await request(`/v1/stories/${made.helenaNew}/comments`, tokens.alvaro)).status).toBe(
      200,
    );
  });

  it('4. the moderator without a follow reads Helena’s group (the moderator branch); a real support session gets 403 on both routes', async () => {
    const res = await groupRead(tokens.labAdmin, memberships.helena);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: StorySummary[] }).items).toHaveLength(2);
    for (const [label, refused] of [
      ['authors', await authorsRead(tokens.support)],
      ['group', await groupRead(tokens.support, memberships.helena)],
    ] as const) {
      expect(refused.status, label).toBe(403);
      expect((await errorOf(refused)).code, label).toBe('FORBIDDEN');
    }
  });

  it('5. EP-61: a member with no followee and no story gets 200 { items: [], nextCursor: null } (and an own item only with a live story)', async () => {
    // `member@` follows nobody and has no story of their own.
    expect(await authorsOf(tokens.plain)).toEqual({ items: [], nextCursor: null });
    // Positive control: Marcos follows nobody either, but his own live story gives him his own circle only.
    const own = await authorsOf(tokens.marcos);
    expect(own.items.map((item) => [item.membershipId, item.isSelf])).toEqual([
      [memberships.marcos, true],
    ]);
  });

  it('6. D-718: with social off both routes answer 404 MODULE_DISABLED (before any read), and they come back with social on', async () => {
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(labTenantId);
    try {
      for (const [label, res] of [
        ['authors', await authorsRead(tokens.alvaro)],
        ['group', await groupRead(tokens.alvaro, memberships.helena)],
        ['authors (moderator)', await authorsRead(tokens.labAdmin)],
        ['group (moderator)', await groupRead(tokens.labAdmin, memberships.helena)],
      ] as const) {
        expect(res.status, label).toBe(404);
        expect((await errorOf(res)).code, label).toBe('MODULE_DISABLED');
      }
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
    }
    expect((await authorsRead(tokens.alvaro)).status).toBe(200);
  });

  it('7. a malformed membership id is the bare 404 (the param schema), and an unknown or another tenant’s id is the same 404', async () => {
    for (const id of ['abc', randomUUID()]) {
      const res = await groupRead(tokens.alvaro, id);
      expect(res.status, id).toBe(404);
      expect((await errorOf(res)).details, id).toBeUndefined();
    }
  });
});
