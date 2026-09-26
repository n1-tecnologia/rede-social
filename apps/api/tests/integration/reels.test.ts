import { sqlClient } from '@tria/core/db';
import type { FeedPage, FeedPost } from '@tria/module-feed/contracts';
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

const DEMO_ADMIN = 'admin@tria-demo.local';
const DEMO_MEMBER = 'member@tria-demo.local';
const CAPTION_PREFIX = 'Teste reels ';

const tokens = { demoAdmin: '', demoMember: '' };
let demoTenantId = '';

const createdPostIds: string[] = [];
const createdAssetIds: string[] = [];

function authed(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-tenant-host': HOSTS.demo,
  };
}

const get = (path: string, token: string) => api.request(path, { headers: authed(token) });

/** A 201 create as the demo admin, registered for cleanup. */
async function created(body: unknown): Promise<FeedPost> {
  const res = await api.request('/v1/feed/posts', {
    method: 'POST',
    headers: authed(tokens.demoAdmin),
    body: JSON.stringify(body),
  });
  expect(res.status, `POST /v1/feed/posts -> ${res.status}`).toBe(201);
  const item = (await res.json()) as FeedPost;
  createdPostIds.push(item.id);
  return item;
}

/** A portrait video row in a known state, owned by the demo admin (`fake` provider, 03-06 seam). */
async function videoAsset(status: 'processing' | 'ready'): Promise<string> {
  const rows = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, width, height, duration_seconds, aspect_ratio, filename, ready_at)
    select ${demoTenantId}::uuid, u.id, 'video', 'post', ${status}, 'fake',
           ${`fake-${crypto.randomUUID()}`},
           ${status === 'ready' ? `pb-${crypto.randomUUID()}` : null},
           'video/mp4', 1048576, 1080, 1920, 15, '9:16', 'reel.mp4',
           ${status === 'ready' ? new Date().toISOString() : null}::timestamptz
      from public.users u where u.email = ${DEMO_ADMIN}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error('could not seed a video asset for the demo admin');
  createdAssetIds.push(id);
  return id;
}

/** Crash sweep: rows an aborted earlier run left behind, found by the caption prefix. */
async function sweepLeftovers() {
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
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  [tokens.demoAdmin, tokens.demoMember] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(DEMO_MEMBER, SEED_PASSWORD),
  ]);
  const [row] = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = 'tria-demo'`;
  if (!row) throw new Error('the demo tenant is not seeded');
  demoTenantId = row.id;
  await sweepLeftovers();
});

afterAll(async () => {
  if (createdPostIds.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${createdPostIds}::uuid[])`;
  }
  if (createdAssetIds.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssetIds}::uuid[])`;
  }
  await sweepLeftovers();
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
