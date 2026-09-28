import { readFileSync } from 'node:fs';
import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  FEED_VIDEO_COMMUNITIES_CAP,
  type FeedPage,
  type FeedPost,
  type VideoCommunities,
} from '@rede-social/module-feed/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * 05.3-01 — the phase's API tracer (REELS-01, REELS-03, D-121), against the live local stack.
 *
 * Reels has no route of its own. What a member reaches is:
 *  - **a `reels` entry in `GET /v1/me/bootstrap`** (the tab, order 30, the media chrome), composed by
 *    the registry from the tenant's `reels` flag AND its `feed` flag (`effectiveKeys`, D-121);
 *  - **feed's own list, narrowed by `?media=video`** to the posts whose video asset is `ready`. The
 *    narrowing is ONE fragment appended to the SAME predicate Início uses (D-73), so this list can
 *    never show a post Início would not show the same member — and a still-transcoding video, which
 *    Início does list (D-53's `processando` card), is absent here.
 *
 * Fixtures are created through the real `POST /v1/feed/posts` as the demo admin; video rows are
 * written directly with the `fake` provider (the `feed-media.test.ts` posture — video ingest is
 * 03-06's subject). Everything created is swept in `afterAll`, plus a crash sweep on the caption
 * prefix so an aborted earlier run cannot leak rows into the pinned seed counts.
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

type BootstrapBody = {
  modules: { key: string; nav?: Record<string, unknown>; home?: unknown }[];
};

const DEMO_ADMIN = 'admin@rede-demo.local';
const DEMO_MEMBER = 'member@rede-demo.local';
const LAB_ADMIN = 'admin@rede-lab.local';
const LAB_MEMBER = 'member@rede-lab.local';
/** Every caption AND every community name this file writes starts with it (the crash sweep's key). */
const CAPTION_PREFIX = 'Teste reels ';

type Tenant = 'demo' | 'lab';

const tokens = { demoAdmin: '', demoMember: '', labAdmin: '', labMember: '' };
const tenantIds: Record<Tenant, string> = { demo: '', lab: '' };
const ADMIN_EMAIL: Record<Tenant, string> = { demo: DEMO_ADMIN, lab: LAB_ADMIN };

const createdPostIds: string[] = [];
const createdAssetIds: string[] = [];
const createdCommunityIds: string[] = [];

function authed(token: string, tenant: Tenant = 'demo'): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-tenant-host': HOSTS[tenant],
  };
}

const get = (path: string, token: string, tenant: Tenant = 'demo') =>
  api.request(path, { headers: authed(token, tenant) });

/** A 201 create as the tenant's admin, registered for cleanup. */
async function created(body: unknown, tenant: Tenant = 'demo'): Promise<FeedPost> {
  const res = await api.request('/v1/feed/posts', {
    method: 'POST',
    headers: authed(tenant === 'demo' ? tokens.demoAdmin : tokens.labAdmin, tenant),
    body: JSON.stringify(body),
  });
  expect(res.status, `POST /v1/feed/posts -> ${res.status}`).toBe(201);
  const item = (await res.json()) as FeedPost;
  createdPostIds.push(item.id);
  return item;
}

/**
 * A portrait video row in a known state, owned by the tenant's admin (`fake` provider, 03-06 seam).
 */
async function videoAsset(
  status: 'processing' | 'ready',
  tenant: Tenant = 'demo',
): Promise<string> {
  const rows = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, width, height, duration_seconds, aspect_ratio, filename, ready_at)
    select ${tenantIds[tenant]}::uuid, u.id, 'video', 'post', ${status}, 'fake',
           ${`fake-${crypto.randomUUID()}`},
           ${status === 'ready' ? `pb-${crypto.randomUUID()}` : null},
           'video/mp4', 1048576, 1080, 1920, 15, '9:16', 'reel.mp4',
           ${status === 'ready' ? new Date().toISOString() : null}::timestamptz
      from public.users u where u.email = ${ADMIN_EMAIL[tenant]}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not seed a video asset for the ${tenant} admin`);
  createdAssetIds.push(id);
  return id;
}

/**
 * A FRESH community, created through the real `POST /v1/communities` as the tenant's admin (never a
 * seeded one: deleting a test post recomputes the container's `last_activity_at`, and the seeded
 * communities' activity order is pinned by communities.test).
 */
async function community(label: string, tenant: Tenant = 'demo'): Promise<{ id: string }> {
  const res = await api.request('/v1/communities', {
    method: 'POST',
    headers: authed(tenant === 'demo' ? tokens.demoAdmin : tokens.labAdmin, tenant),
    body: JSON.stringify({ name: `${CAPTION_PREFIX}${label}` }),
  });
  expect(res.status, `POST /v1/communities -> ${res.status}`).toBe(201);
  const body = (await res.json()) as { id: string };
  createdCommunityIds.push(body.id);
  return body;
}

/** Archive through the community's own route (a `status` write, COMM-01). */
async function archive(communityId: string): Promise<void> {
  const res = await api.request(`/v1/communities/${communityId}`, {
    method: 'PATCH',
    headers: authed(tokens.demoAdmin),
    body: JSON.stringify({ status: 'archived' }),
  });
  expect(res.status, `PATCH /v1/communities/${communityId} -> ${res.status}`).toBe(200);
}

/**
 * Flip a tenant's `communities` flag the way communities.test does, cache included. An UPSERT: the
 * lab's row may be absent rather than disabled (communities.test deletes it in its `afterAll`), and
 * an absent row is "off" just as a disabled one is.
 */
async function setCommunities(tenant: Tenant, enabled: boolean): Promise<void> {
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantIds[tenant]}::uuid, 'communities', ${enabled})
    on conflict (tenant_id, module_key) do update set enabled = ${enabled}`;
  moduleFlags.invalidate(tenantIds[tenant]);
}

/** The lab's `communities` row as this file found it: `null` when absent, else its `enabled`. */
let labCommunitiesAtStart: boolean | null = null;

/** Put the lab's `communities` row back EXACTLY as found (absent stays absent), cache included. */
async function restoreLabCommunities(): Promise<void> {
  if (labCommunitiesAtStart === null) {
    await adminSql`
      delete from public.tenant_modules
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'communities'`;
    moduleFlags.invalidate(tenantIds.lab);
  } else {
    await setCommunities('lab', labCommunitiesAtStart);
  }
}

/** The lanes read as a member of the tenant, asserting the 200. */
async function lanes(token: string, tenant: Tenant = 'demo'): Promise<VideoCommunities> {
  const res = await get('/v1/feed/video-communities', token, tenant);
  expect(res.status, `GET /v1/feed/video-communities -> ${res.status}`).toBe(200);
  return (await res.json()) as VideoCommunities;
}

/** Walk a feed list to its end (bounded), in the server's own order. */
async function walk(query: string, token: string, tenant: Tenant = 'demo'): Promise<FeedPost[]> {
  const seen: FeedPost[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 500; guard += 1) {
    const sep = query.includes('?') ? '&' : '?';
    const path: string = cursor ? `${query}${sep}cursor=${encodeURIComponent(cursor)}` : query;
    const res = await get(path, token, tenant);
    expect(res.status, `GET ${path} -> ${res.status}`).toBe(200);
    const body = (await res.json()) as FeedPage;
    seen.push(...body.items);
    cursor = body.nextCursor;
    if (cursor === null) return seen;
  }
  throw new Error(`walk(${query}) did not reach the end in 500 pages`);
}

/** Início's items whose video is `ready` — the set Reels must equal (D-73/D-74, REELS-03). */
function readyVideosOf(items: FeedPost[]): string[] {
  return items
    .filter(
      (item) =>
        item.mediaKind === 'video' &&
        item.media.some((m) => m.kind === 'video' && m.status === 'ready'),
    )
    .map((item) => item.id);
}

/** Crash sweep: rows an aborted earlier run left behind, found by the caption prefix. */
async function sweepLeftovers() {
  // Posts first: `feed_posts.community_id` has no cascade, so a community goes only once its posts
  // are gone. Every post this file writes carries the caption prefix.
  const leftovers = await adminSql<{ id: string; asset_id: string | null }[]>`
    select p.id, m.media_asset_id as asset_id
      from public.feed_posts p
      left join public.feed_post_media m on m.post_id = p.id
     where p.caption like ${`${CAPTION_PREFIX}%`}`;
  const postIds = [...new Set(leftovers.map((row) => row.id))];
  const assetIds = leftovers.map((row) => row.asset_id).filter((id): id is string => id !== null);
  if (postIds.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${postIds}::uuid[])`;
  }
  if (assetIds.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${assetIds}::uuid[])`;
  }
  await adminSql`delete from public.communities where name like ${`${CAPTION_PREFIX}%`}`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  [tokens.demoAdmin, tokens.demoMember, tokens.labAdmin, tokens.labMember] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(DEMO_MEMBER, SEED_PASSWORD),
    signInAs(LAB_ADMIN, SEED_PASSWORD),
    signInAs(LAB_MEMBER, SEED_PASSWORD),
  ]);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  tenantIds.demo = rows.find((row) => row.slug === 'rede-demo')?.id ?? '';
  tenantIds.lab = rows.find((row) => row.slug === 'rede-lab')?.id ?? '';
  if (!tenantIds.demo || !tenantIds.lab) throw new Error('the seed tenants are not seeded');
  const [labRow] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenantIds.lab}::uuid and module_key = 'communities'`;
  labCommunitiesAtStart = labRow ? labRow.enabled : null;
  // Every lab case below assumes the seeded posture: communities OFF.
  expect(labCommunitiesAtStart ?? false, 'the lab tenant must start with communities off').toBe(
    false,
  );
  await sweepLeftovers();
});

afterAll(async () => {
  if (createdPostIds.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${createdPostIds}::uuid[])`;
  }
  if (createdAssetIds.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssetIds}::uuid[])`;
  }
  if (createdCommunityIds.length > 0) {
    await adminSql`delete from public.communities where id = any(${createdCommunityIds}::uuid[])`;
  }
  await sweepLeftovers();
  // Every case that flips the lab's `communities` flag restores it in a `finally`; this is the last
  // line of defence against a crash between the flip and the restore.
  await restoreLabCommunities();
  await adminSql.end();
  await sqlClient.end();
});

describe('05.3 — Reels at the API (REELS-01, REELS-03, D-121)', () => {
  it('05.3-1: the member bootstrap lists reels right after communities, with the tab nav and no home', async () => {
    const res = await get('/v1/me/bootstrap', tokens.demoMember);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BootstrapBody;
    const keys = body.modules.map((m) => m.key);
    expect(keys.indexOf('reels'), keys.join(',')).toBe(keys.indexOf('communities') + 1);

    const reels = body.modules.find((m) => m.key === 'reels');
    expect(reels?.nav).toEqual({
      placement: 'tab',
      label: 'Reels',
      icon: 'film',
      href: '/reels',
      order: 30,
      chrome: 'media',
    });
    expect(reels).not.toHaveProperty('home');
  });

  it('05.3-2: ?media=video lists only ready video posts, newest first; Início still lists the processing one', async () => {
    const ready = await created({
      caption: `${CAPTION_PREFIX}pronto`,
      videoAssetId: await videoAsset('ready'),
    });
    const processing = await created({
      caption: `${CAPTION_PREFIX}processando`,
      videoAssetId: await videoAsset('processing'),
    });
    const textOnly = await created({ caption: `${CAPTION_PREFIX}so texto` });

    const res = await get('/v1/feed?media=video&limit=25', tokens.demoMember);
    expect(res.status).toBe(200);
    const page = (await res.json()) as FeedPage;
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(ready.id);
    expect(ids).not.toContain(processing.id);
    expect(ids).not.toContain(textOnly.id);

    for (const item of page.items) {
      expect(item.mediaKind).toBe('video');
      const video = item.media.find((m) => m.kind === 'video');
      expect(video?.status, item.id).toBe('ready');
    }

    // Strictly descending `(createdAt, id)`: the ordering expression Início uses, unchanged.
    for (let i = 1; i < page.items.length; i += 1) {
      const prev = page.items[i - 1] as FeedPost;
      const next = page.items[i] as FeedPost;
      const descending =
        prev.createdAt > next.createdAt || (prev.createdAt === next.createdAt && prev.id > next.id);
      expect(descending, `${prev.id} before ${next.id}`).toBe(true);
    }

    // Positive control: Início (no filter) still lists the post whose video is transcoding (D-53).
    const inicio = await get('/v1/feed?limit=25', tokens.demoMember);
    expect(inicio.status).toBe(200);
    const inicioIds = ((await inicio.json()) as FeedPage).items.map((item) => item.id);
    expect(inicioIds).toContain(processing.id);
    expect(inicioIds).toContain(ready.id);
  });

  it('05.3-3: an unknown media value is a 400; a foreign community with media=video is the same bare 404', async () => {
    const audio = await get('/v1/feed?media=audio', tokens.demoMember);
    expect(audio.status).toBe(400);
    expect(((await audio.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');

    const communityId = crypto.randomUUID();
    const withMedia = await get(
      `/v1/feed?media=video&communityId=${communityId}`,
      tokens.demoMember,
    );
    const without = await get(`/v1/feed?communityId=${communityId}`, tokens.demoMember);
    expect(withMedia.status).toBe(404);
    expect(without.status).toBe(404);

    const withBody = (await withMedia.json()) as Envelope;
    const withoutBody = (await without.json()) as Envelope;
    expect(withBody.error.code).toBe('NOT_FOUND');
    expect(Object.hasOwn(withBody.error, 'details')).toBe(false);
    // Byte-identical apart from the per-request id: `media` adds no oracle to the bare 404 (D-23).
    const strip = ({ error: { requestId: _id, ...rest } }: Envelope) => ({ error: rest });
    expect(JSON.stringify(strip(withBody))).toBe(JSON.stringify(strip(withoutBody)));
  });
});

/**
 * 05.3-02 — the lane row's data and the proof that Reels' lists are exactly Início's videos
 * (REELS-03, REELS-04, D-117, D-119, D-120).
 *
 * The lanes read (`GET /v1/feed/video-communities`) and the list (`?media=video`) share feed's ONE
 * `READY_VIDEO_POST` fragment, so "no lane is ever empty" (RESEARCH Pitfall 7) is a property of the
 * code — and case 05.3-5 still walks every lane to prove it rather than trusting it.
 *
 * Every community here is FRESH (`community()`), never a seeded one, and every row is swept by id and
 * by the `Teste reels ` prefix. The lab tenant's `communities` flag is OFF (seeded disabled, or its
 * row absent after communities.test); the cases that need it ON upsert it with
 * `moduleFlags.invalidate` and restore the row exactly as found in a `finally`, so the tenant is back
 * to its starting state whatever an assertion does.
 */
describe('05.3 — lanes and list equality (REELS-03, REELS-04, D-117, D-119)', () => {
  it('05.3-4: lanes are ordered by community activity (D-76): the newest video first, then a text post re-orders them', async () => {
    const x = await community('lane X');
    const y = await community('lane Y');
    await created({
      caption: `${CAPTION_PREFIX}video em X`,
      videoAssetId: await videoAsset('ready'),
      communityId: x.id,
    });
    await created({
      caption: `${CAPTION_PREFIX}video em Y`,
      videoAssetId: await videoAsset('ready'),
      communityId: y.id,
    });

    let ids = (await lanes(tokens.demoMember)).items.map((lane) => lane.id);
    expect(ids).toContain(x.id);
    expect(ids).toContain(y.id);
    expect(ids.indexOf(y.id), ids.join(',')).toBeLessThan(ids.indexOf(x.id));

    // D-76 is POST activity, whatever the post is: a text post into X moves X back above Y.
    await created({ caption: `${CAPTION_PREFIX}texto em X`, communityId: x.id });
    ids = (await lanes(tokens.demoMember)).items.map((lane) => lane.id);
    expect(ids.indexOf(x.id), ids.join(',')).toBeLessThan(ids.indexOf(y.id));

    // The item is the post label's shape, nothing more (D-117: a lane is a name and a route).
    const lane = (await lanes(tokens.demoMember)).items.find((item) => item.id === x.id);
    expect(Object.keys(lane ?? {}).sort()).toEqual(['id', 'name', 'slug']);
    expect(lane?.name).toBe(`${CAPTION_PREFIX}lane X`);
  });

  it('05.3-5: a processing-only community and an archived one are absent; every lane opens non-empty (Pitfall 7)', async () => {
    const z = await community('lane Z processando');
    await created({
      caption: `${CAPTION_PREFIX}video processando em Z`,
      videoAssetId: await videoAsset('processing'),
      communityId: z.id,
    });
    const w = await community('lane W arquivada');
    await created({
      caption: `${CAPTION_PREFIX}video pronto em W`,
      videoAssetId: await videoAsset('ready'),
      communityId: w.id,
    });
    // Positive control: before the archive, W IS a lane — so its absence below is the archive's doing.
    expect((await lanes(tokens.demoMember)).items.map((lane) => lane.id)).toContain(w.id);
    await archive(w.id);

    const body = await lanes(tokens.demoMember);
    const ids = body.items.map((lane) => lane.id);
    expect(ids).not.toContain(z.id);
    expect(ids).not.toContain(w.id);
    expect(ids.length).toBeGreaterThan(0);

    for (const lane of body.items) {
      const res = await get(
        `/v1/feed?media=video&communityId=${lane.id}&limit=1`,
        tokens.demoMember,
      );
      expect(res.status, lane.id).toBe(200);
      const page = (await res.json()) as FeedPage;
      expect(page.items.length, `lane ${lane.id} opened empty`).toBeGreaterThan(0);
    }
  });

  it('05.3-6: with the lab communities flag OFF the lanes are an honest empty list; ON, the lab lane and its video appear', async () => {
    const labId = tenantIds.lab;
    expect(labId).not.toBe('');
    try {
      await setCommunities('lab', true);
      const labCommunity = await community('lane lab', 'lab');
      const labVideo = await created(
        {
          caption: `${CAPTION_PREFIX}video na comunidade do lab`,
          videoAssetId: await videoAsset('ready', 'lab'),
          communityId: labCommunity.id,
        },
        'lab',
      );

      // OFF: 200 `{ items: [] }` (D-120), never 404, and the list carries no community post at all.
      await setCommunities('lab', false);
      const offRes = await get('/v1/feed/video-communities', tokens.labMember, 'lab');
      expect(offRes.status).toBe(200);
      expect(await offRes.json()).toEqual({ items: [] });
      const offList = await walk('/v1/feed?media=video&limit=25', tokens.labMember, 'lab');
      expect(offList.every((item) => item.communityId === null)).toBe(true);
      expect(offList.map((item) => item.id)).not.toContain(labVideo.id);

      // ON: the same rows, now listed — the flag hides, it never deletes (D-74).
      await setCommunities('lab', true);
      const onLanes = await lanes(tokens.labMember, 'lab');
      expect(onLanes.items.map((lane) => lane.id)).toContain(labCommunity.id);
      const onList = await walk('/v1/feed?media=video&limit=25', tokens.labMember, 'lab');
      expect(onList.map((item) => item.id)).toContain(labVideo.id);
    } finally {
      await restoreLabCommunities();
    }
  });

  it('05.3-7: ?media=video walked to the end equals Início’s ready videos walked to the end — communities on (demo) and off/on (lab)', async () => {
    // Fixtures that make each side non-vacuous: a ready video tenant-wide and inside a community,
    // plus a processing one that must be on NEITHER side.
    const demoCommunity = await community('igualdade demo');
    const demoWide = await created({
      caption: `${CAPTION_PREFIX}igualdade demo geral`,
      videoAssetId: await videoAsset('ready'),
    });
    const demoInCommunity = await created({
      caption: `${CAPTION_PREFIX}igualdade demo comunidade`,
      videoAssetId: await videoAsset('ready'),
      communityId: demoCommunity.id,
    });
    const demoProcessing = await created({
      caption: `${CAPTION_PREFIX}igualdade demo processando`,
      videoAssetId: await videoAsset('processing'),
    });

    const demoReels = (await walk('/v1/feed?media=video&limit=25', tokens.demoMember)).map(
      (item) => item.id,
    );
    const demoInicio = readyVideosOf(await walk('/v1/feed?limit=25', tokens.demoMember));
    expect(new Set(demoReels)).toEqual(new Set(demoInicio));
    expect(demoReels.length).toBe(new Set(demoReels).size);
    expect(demoReels).toEqual(expect.arrayContaining([demoWide.id, demoInCommunity.id]));
    expect(demoReels).not.toContain(demoProcessing.id);

    try {
      await setCommunities('lab', true);
      const labCommunity = await community('igualdade lab', 'lab');
      const labWide = await created(
        {
          caption: `${CAPTION_PREFIX}igualdade lab geral`,
          videoAssetId: await videoAsset('ready', 'lab'),
        },
        'lab',
      );
      const labInCommunity = await created(
        {
          caption: `${CAPTION_PREFIX}igualdade lab comunidade`,
          videoAssetId: await videoAsset('ready', 'lab'),
          communityId: labCommunity.id,
        },
        'lab',
      );

      for (const enabled of [false, true]) {
        await setCommunities('lab', enabled);
        const reels = (await walk('/v1/feed?media=video&limit=25', tokens.labMember, 'lab')).map(
          (item) => item.id,
        );
        const inicio = readyVideosOf(await walk('/v1/feed?limit=25', tokens.labMember, 'lab'));
        expect(new Set(reels), `communities ${enabled ? 'on' : 'off'}`).toEqual(new Set(inicio));
        expect(reels.length).toBe(new Set(reels).size);
        expect(reels).toContain(labWide.id);
        if (enabled) expect(reels).toContain(labInCommunity.id);
        else expect(reels).not.toContain(labInCommunity.id);
      }
    } finally {
      await restoreLabCommunities();
    }
  });

  it('05.3-8: two ready videos with an identical created_at each appear exactly once across a limit=1 boundary, larger id first; the order is stable', async () => {
    const a = await created({
      caption: `${CAPTION_PREFIX}empate A`,
      videoAssetId: await videoAsset('ready'),
    });
    const b = await created({
      caption: `${CAPTION_PREFIX}empate B`,
      videoAssetId: await videoAsset('ready'),
    });
    // Force the tie in the database (microsecond-identical), so only `id desc` can separate them.
    await adminSql`
      update public.feed_posts
         set created_at = (select created_at from public.feed_posts where id = ${a.id}::uuid)
       where id = ${b.id}::uuid`;

    const oneByOne = (await walk('/v1/feed?media=video&limit=1', tokens.demoMember)).map(
      (item) => item.id,
    );
    expect(oneByOne.filter((id) => id === a.id)).toHaveLength(1);
    expect(oneByOne.filter((id) => id === b.id)).toHaveLength(1);
    const [larger, smaller] = a.id > b.id ? [a.id, b.id] : [b.id, a.id];
    // Adjacent, larger id first: the `(created_at, id)` total order, across a page boundary.
    expect(oneByOne.indexOf(smaller)).toBe(oneByOne.indexOf(larger) + 1);
    expect(oneByOne.length).toBe(new Set(oneByOne).size);

    // Stable: two identical consecutive reads, and the one-by-one walk, agree on the sequence.
    const first = (await walk('/v1/feed?media=video&limit=25', tokens.demoMember)).map((i) => i.id);
    const second = (await walk('/v1/feed?media=video&limit=25', tokens.demoMember)).map(
      (i) => i.id,
    );
    expect(second).toEqual(first);
    expect(oneByOne).toEqual(first);
  });

  it('05.3-9: a community holding only a text post is an empty video list and no lane', async () => {
    const empty = await community('so texto');
    await created({ caption: `${CAPTION_PREFIX}texto na comunidade vazia`, communityId: empty.id });

    const res = await get(`/v1/feed?media=video&communityId=${empty.id}`, tokens.demoMember);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
    // Positive control: the community is real and reachable — its unfiltered page lists the post.
    const unfiltered = await get(`/v1/feed?communityId=${empty.id}`, tokens.demoMember);
    expect(((await unfiltered.json()) as FeedPage).items).toHaveLength(1);

    expect((await lanes(tokens.demoMember)).items.map((lane) => lane.id)).not.toContain(empty.id);
  });

  it('05.3-10: the lanes statement is capped at FEED_VIDEO_COMMUNITIES_CAP (50) and shares READY_VIDEO_POST', () => {
    expect(FEED_VIDEO_COMMUNITIES_CAP).toBe(50);
    const source = readFileSync(
      new URL('../../../../packages/modules/feed/server/service.ts', import.meta.url),
      'utf8',
    );
    const start = source.indexOf('export async function listVideoCommunities');
    expect(start, 'listVideoCommunities is not in the feed service').toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n}\n', start));
    expect(body).toMatch(/limit \$\{FEED_VIDEO_COMMUNITIES_CAP\}/);
    expect(body).toMatch(/\$\{READY_VIDEO_POST\}/);
  });
});
