import { randomUUID } from 'node:crypto';
import { avatarUrlFor, memberProfileSchema } from '@rede-social/contracts/profiles';
import { sqlClient } from '@rede-social/core/db';
import {
  highlightDetailSchema,
  highlightListSchema,
  STORY_MAX_PAGE_SIZE,
  type StorySummary,
  storyPageSchema,
  storySummarySchema,
} from '@rede-social/module-stories/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * `authorAvatarUrl` on every story projection (2026-10-03, the client's item #2b: the author's photo
 * in the tenant circle) — the API half, end to end against the live local stack and the real seed.
 *
 * The tenant circle on Início now wears the face of whoever published the newest live story, and the
 * viewer heads each tenant story with its author's photo. The payload carries that photo as the
 * profile's own projection (`avatarUrlFor`, the stable `/v1/media/{assetId}/w128` path), read through
 * two LEFT joins in the SAME statement as the story (`storyProjection`). What is proved here:
 *
 *  1. **No photo is `null`, never a missing key and never a guess** — on every read.
 *  2. **The photo rides every surface the strip and the viewer read** — the strip, the story by id,
 *     the admin history and a highlight's items — and it is byte-identical to what the author's own
 *     profile answers (`GET /v1/members/{id}`): a story never shows more of a member than their
 *     profile does.
 *  3. **The profile's lifecycle rule holds**: a BLOCKED, INVITED or REMOVED author projects no photo,
 *     exactly where `GET /v1/members/{id}` answers its bare 404 — with the positive control first.
 *  4. **Cross-tenant safe**: a profile that lives in ANOTHER tenant never rides a story, even when the
 *     story's `author_user_id` names that very user (an impossible state in V1, forged here by hand,
 *     so the join's tenant pin and the lane's RLS are both what stands between the two tenants).
 *
 * What it does NOT re-prove: the statement count. The two joins live INSIDE the projection, so the
 * strip stays ONE statement, and `feed-query-budget.test.ts` already pins that with a ceiling and a
 * floor on this very read.
 *
 * Everything this file writes is its own and is removed again: throwaway users and memberships (by
 * e-mail prefix), story rows (by caption prefix), media assets (by id). The SEEDED demo admin's
 * profile photo is borrowed for case 2 and put back exactly as it was found, in a `finally`.
 */

const tokens = { demoMember: '', demoAdmin: '' };
const tenantIds = { demo: '', lab: '' };
const seeded = { adminUserId: '', adminMembershipId: '' };

/** Every row this file wrote, for the sweep. */
const createdAssets: string[] = [];
const createdStories: string[] = [];
const createdUsers: string[] = [];

/** The caption and e-mail prefixes of this file's own rows, so a crashed run is swept next time. */
const CAPTION_PREFIX = 'Story foto do autor';
const EMAIL_PREFIX = 'stories-author-photo-';

const read = (path: string, token: string, host = HOSTS.demo) =>
  api.request(path, { headers: { authorization: `Bearer ${token}`, 'x-tenant-host': host } });

/** `GET /v1/stories` — the strip's page, parsed with the SAME strict schema the web parses it with. */
async function strip(token = tokens.demoMember) {
  const res = await read(`/v1/stories?limit=${STORY_MAX_PAGE_SIZE}`, token);
  expect(res.status, 'GET /v1/stories').toBe(200);
  return storyPageSchema.parse(await res.json());
}

/** `GET /v1/stories/{id}`, parsed strictly. Fails loudly on a non-200. */
async function story(id: string, token = tokens.demoMember): Promise<StorySummary> {
  const res = await read(`/v1/stories/${id}`, token);
  expect(res.status, `GET /v1/stories/${id}`).toBe(200);
  return storySummarySchema.parse(await res.json());
}

/** A media asset row of the named tenant, written directly — the fixture shape `stories.test.ts` uses. */
async function insertAsset(opts: {
  tenantId: string;
  ownerUserId: string;
  purpose: 'avatar' | 'story';
}): Promise<string> {
  const id = randomUUID();
  createdAssets.push(id);
  await adminSql`
    insert into public.media_assets
      (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths,
       ready_at)
    values (${id}::uuid, ${opts.tenantId}::uuid, ${opts.ownerUserId}::uuid, 'image', ${opts.purpose},
            'ready', 'supabase', 'image/webp', 1024,
            ${opts.purpose === 'avatar' ? '{128,320}' : '{640,1080}'}::int[], now())`;
  return id;
}

/** An ACTIVE, ready image story in `tenantId` authored by `authorUserId` — inserted, not published. */
async function insertStory(tenantId: string, authorUserId: string): Promise<string> {
  const assetId = await insertAsset({ tenantId, ownerUserId: authorUserId, purpose: 'story' });
  const id = randomUUID();
  createdStories.push(id);
  await adminSql`
    insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption)
    values (${id}::uuid, ${tenantId}::uuid, ${authorUserId}::uuid, ${assetId}::uuid, 'image',
            ${`${CAPTION_PREFIX} ${id}`})`;
  return id;
}

/**
 * A throwaway identity with ONE membership, in the tenant named — through GoTrue's admin API (so
 * `public.users` is mirrored by its trigger) and a direct membership insert, the `members.test.ts`
 * shape. Its `member_profiles` row comes from the `member_profiles_from_membership` trigger, and its
 * photo is a fresh `avatar` asset pointed at by that row.
 */
async function throwawayAuthor(
  tenantId: string,
  local: string,
): Promise<{ userId: string; membershipId: string; photo: string }> {
  const email = `${EMAIL_PREFIX}${local}-${Date.now()}@rede-demo.local`;
  const { data, error } = await authAdmin().createUser({
    email,
    password: `Segredo-${randomUUID()}`,
    email_confirm: true,
    user_metadata: { name: `Autor ${local}` },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = data.user.id;
  createdUsers.push(userId);

  const [membership] = await adminSql<{ id: string }[]>`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantId}::uuid, ${userId}::uuid, 'member', 'active')
    returning id`;
  if (!membership) throw new Error('membership insert failed');

  const avatar = await insertAsset({ tenantId, ownerUserId: userId, purpose: 'avatar' });
  await adminSql`
    update public.member_profiles set avatar_asset_id = ${avatar}::uuid, updated_at = now()
     where membership_id = ${membership.id}::uuid`;
  return { userId, membershipId: membership.id, photo: `/v1/media/${avatar}/w128` };
}

/** Removes everything this file wrote: stories, then assets, then the throwaway identities. */
async function sweep(): Promise<void> {
  await adminSql`delete from public.stories where caption like ${`${CAPTION_PREFIX}%`}`;
  if (createdStories.length > 0) {
    await adminSql`delete from public.stories where id = any(${createdStories}::uuid[])`;
  }
  const stale = await adminSql<{ id: string }[]>`
    select id from public.users where email like ${`${EMAIL_PREFIX}%`}`;
  const userIds = [...new Set([...createdUsers, ...stale.map((row) => row.id)])];
  if (userIds.length > 0) {
    await adminSql`delete from public.stories where author_user_id = any(${userIds}::uuid[])`;
    await adminSql`delete from public.media_assets where owner_user_id = any(${userIds}::uuid[])`;
  }
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
  }
  for (const userId of userIds) await authAdmin().deleteUser(userId);
  createdStories.length = 0;
  createdAssets.length = 0;
  createdUsers.length = 0;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);

  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of tenants) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
  }

  const [admin] = await adminSql<{ user_id: string; membership_id: string }[]>`
    select m.user_id, m.id as membership_id
      from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = 'admin@rede-demo.local'`;
  if (!admin) throw new Error('the seeded demo admin is missing');
  seeded.adminUserId = admin.user_id;
  seeded.adminMembershipId = admin.membership_id;

  await sweep();
});

afterAll(async () => {
  await sweep();
  await adminSql.end();
  await sqlClient.end();
});

/**
 * Borrows the SEEDED demo admin's profile photo for one case — the seed author of every demo story —
 * and always puts back exactly what was there. `pnpm db:seed` could not repair it (every insert is
 * `on conflict do nothing`), so the restore is this file's job, in a `finally`.
 */
async function withAdminPhoto(photo: string | null, run: () => Promise<void>): Promise<void> {
  const [before] = await adminSql<{ avatar_asset_id: string | null }[]>`
    select avatar_asset_id from public.member_profiles
     where membership_id = ${seeded.adminMembershipId}::uuid`;
  if (!before) throw new Error('the seeded demo admin has no profile row');
  try {
    await adminSql`
      update public.member_profiles set avatar_asset_id = ${photo}::uuid
       where membership_id = ${seeded.adminMembershipId}::uuid`;
    await run();
  } finally {
    await adminSql`
      update public.member_profiles set avatar_asset_id = ${before.avatar_asset_id}::uuid
       where membership_id = ${seeded.adminMembershipId}::uuid`;
  }
}

describe('authorAvatarUrl — the author’s photo on every story projection (#2b)', () => {
  it('1. an author with NO photo projects `authorAvatarUrl: null` — a present key, never a guess', async () => {
    await withAdminPhoto(null, async () => {
      const page = await strip();
      const byAdmin = page.items.filter((item) => item.authorUserId === seeded.adminUserId);
      expect(byAdmin.length, 'the seed has live demo stories by the admin').toBeGreaterThan(0);
      for (const item of byAdmin) expect(item.authorAvatarUrl).toBeNull();

      // On the wire the key is THERE, explicitly null — not omitted and left to the default.
      const res = await read(`/v1/stories/${byAdmin[0]?.id}`, tokens.demoMember);
      const raw = (await res.json()) as Record<string, unknown>;
      expect(Object.hasOwn(raw, 'authorAvatarUrl')).toBe(true);
      expect(raw.authorAvatarUrl).toBeNull();
    });
  });

  it('2. the photo rides the strip, the story read, the history and a highlight — identical to the author’s own profile', async () => {
    const photoAsset = await insertAsset({
      tenantId: tenantIds.demo,
      ownerUserId: seeded.adminUserId,
      purpose: 'avatar',
    });
    const expected = avatarUrlFor(photoAsset);
    expect(expected).toBe(`/v1/media/${photoAsset}/w128`);

    await withAdminPhoto(photoAsset, async () => {
      // What the admin's PROFILE shows a member — the ceiling of what a story may show.
      const profileRes = await read(`/v1/members/${seeded.adminMembershipId}`, tokens.demoMember);
      expect(profileRes.status).toBe(200);
      const profile = memberProfileSchema.parse(await profileRes.json());
      expect(profile.avatarUrl).toBe(expected);

      // The strip (a member's read): every live story by the admin wears that same photo.
      const page = await strip();
      const byAdmin = page.items.filter((item) => item.authorUserId === seeded.adminUserId);
      expect(byAdmin.length).toBeGreaterThan(0);
      for (const item of byAdmin) expect(item.authorAvatarUrl).toBe(profile.avatarUrl);

      // The deep link's read (`GET /v1/stories/{id}`).
      const first = byAdmin[0] as StorySummary;
      expect((await story(first.id)).authorAvatarUrl).toBe(expected);

      // The admin's own history (`GET /v1/stories/mine`) — expired and processing stories included.
      const mineRes = await read(`/v1/stories/mine?limit=${STORY_MAX_PAGE_SIZE}`, tokens.demoAdmin);
      expect(mineRes.status).toBe(200);
      const mine = storyPageSchema.parse(await mineRes.json());
      const mineByAdmin = mine.items.filter((item) => item.authorUserId === seeded.adminUserId);
      expect(mineByAdmin.length).toBeGreaterThan(0);
      for (const item of mineByAdmin) expect(item.authorAvatarUrl).toBe(expected);

      // A highlight's items (the viewer's lazy group read) carry it too.
      const listRes = await read('/v1/stories/highlights', tokens.demoMember);
      expect(listRes.status).toBe(200);
      const playable = highlightListSchema
        .parse(await listRes.json())
        .items.find((highlight) => highlight.itemCount > 0);
      expect(playable, 'the seed has a non-empty Início highlight').toBeDefined();
      const detailRes = await read(`/v1/stories/highlights/${playable?.id}`, tokens.demoMember);
      expect(detailRes.status).toBe(200);
      const detail = highlightDetailSchema.parse(await detailRes.json());
      const detailByAdmin = detail.items.filter((item) => item.authorUserId === seeded.adminUserId);
      expect(detailByAdmin.length).toBeGreaterThan(0);
      for (const item of detailByAdmin) expect(item.authorAvatarUrl).toBe(expected);
    });

    // Put back: with the seed's own photo (none) the projection is null again.
    const after = await strip();
    for (const item of after.items.filter((i) => i.authorUserId === seeded.adminUserId)) {
      expect(item.authorAvatarUrl).not.toBe(expected);
    }
  });

  it('3. a BLOCKED, INVITED or REMOVED author projects no photo — where their profile answers 404', async () => {
    const author = await throwawayAuthor(tenantIds.demo, 'ciclo');
    const storyId = await insertStory(tenantIds.demo, author.userId);
    const profileStatus = async () =>
      (await read(`/v1/members/${author.membershipId}`, tokens.demoMember)).status;

    // POSITIVE CONTROL: an active member's photo rides their story, on the strip and by id.
    expect(await profileStatus()).toBe(200);
    expect((await story(storyId)).authorAvatarUrl).toBe(author.photo);
    const live = (await strip()).items.find((item) => item.id === storyId);
    expect(live?.authorAvatarUrl).toBe(author.photo);

    for (const status of ['blocked', 'invited'] as const) {
      await adminSql`
        update public.memberships set status = ${status} where id = ${author.membershipId}::uuid`;
      expect(await profileStatus(), `the ${status} profile is a 404`).toBe(404);
      // The story itself stays (it is the tenant's), but it no longer shows the member's face.
      expect((await story(storyId)).authorAvatarUrl, `${status}: no photo`).toBeNull();
    }

    await adminSql`
      update public.memberships set status = 'active', deleted_at = now()
       where id = ${author.membershipId}::uuid`;
    expect(await profileStatus(), 'the removed profile is a 404').toBe(404);
    expect((await story(storyId)).authorAvatarUrl, 'removed: no photo').toBeNull();
    const stripped = (await strip()).items.find((item) => item.id === storyId);
    expect(stripped?.authorAvatarUrl).toBeNull();
  });

  it('4. a profile that lives in ANOTHER tenant never rides a story — even one naming that user as its author', async () => {
    // A LAB member with a LAB photo, named as the author of a DEMO story (forged by hand: in V1 a
    // user has one tenant and the API stamps the caller, so the API cannot write this row itself).
    const foreign = await throwawayAuthor(tenantIds.lab, 'fora');
    const storyId = await insertStory(tenantIds.demo, foreign.userId);

    const read1 = await story(storyId);
    expect(read1.authorUserId).toBe(foreign.userId);
    expect(read1.authorAvatarUrl).toBeNull();
    const onStrip = (await strip()).items.find((item) => item.id === storyId);
    expect(onStrip, 'the forged story is live on the demo strip').toBeDefined();
    expect(onStrip?.authorAvatarUrl).toBeNull();
    // Nowhere on the demo strip does the lab photo appear, on any story.
    expect((await strip()).items.some((item) => item.authorAvatarUrl === foreign.photo)).toBe(
      false,
    );
  });
});
