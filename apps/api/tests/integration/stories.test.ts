import { randomUUID } from 'node:crypto';
import { MEDIA_LIMITS } from '@tria/contracts/media';
import { sqlClient } from '@tria/core/db';
import { subscribe } from '@tria/core/server/events/bus';
import { mediaProviderEventJob } from '@tria/core/server/media/video/event-job';
import type { VideoProviderEvent } from '@tria/core/server/media/video/types';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
import {
  STORY_EXPIRY_HOURS,
  STORY_MAX_CAPTION,
  STORY_MAX_PAGE_SIZE,
  type StoryComment,
  type StoryCommented,
  type StoryCommentPage,
  type StoryLiked,
  type StoryLikeResult,
  type StoryPage,
  type StoryPublished,
  type StorySummary,
} from '@tria/module-stories/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * `@tria/module-stories` end to end against the live local stack and the real seed (05-05).
 *
 * Seven things are proved here that nothing else in the repo can prove:
 *  - **STORY-03 is a READ PREDICATE.** The seeded expired story is absent from `GET /v1/stories`,
 *    present in `GET /v1/stories/mine`, and STILL RESOLVES BY ID. pgTAP proves the row survives;
 *    this proves the three HTTP surfaces disagree about it in exactly the right way.
 *  - **R-P8: readiness gates the strip, not the row.** The seeded story whose asset is `processing`
 *    is absent from the strip and present in the admin's own list, with its `mediaStatus` intact.
 *  - **Pitfall 5: the ~60 s cap is enforced AFTER ingest.** A story is published on a `processing`
 *    video, the worker then measures a too-long duration and flips the asset to
 *    `rejected`/`duration_too_long`, and the story stays out of the strip PERMANENTLY while the
 *    admin's own list still shows it with the reason. Driven through the real provider-event job.
 *  - **T-05-25: the write is a PERMISSION.** A member is refused 403 on publish and on delete.
 *  - **T-05-26: another tenant's asset is a BARE 404** with no `details` key, byte-identical to the
 *    one an unknown id produces — asserted with its positive control in the same test.
 *  - **T-05-31: `limit` is clamped SERVER-side**, in both directions, and a hostile cursor degrades
 *    to page 1 rather than reaching SQL or raising.
 *  - **MOD-04/UI-D-25: the module flag governs the routes**, in BOTH directions, with no migration.
 *
 * Test ORDER is load-bearing and the config supports it (`fileParallelism: false`, and Vitest runs a
 * file's tests in declaration order): every READ assertion that depends on the seeded five runs
 * before the first publish, and both hooks sweep this file's own rows by caption prefix so a crashed
 * run cannot poison the next one.
 */

type Envelope = {
  error: { code: string; message?: string; details?: Record<string, unknown>; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', labAdmin: '' };
const tenantIds = { demo: '', lab: '' };

/** Every story and asset THIS FILE created; swept by caption prefix as well, in case of a crash. */
const created: string[] = [];
const createdAssets: string[] = [];
const events: StoryPublished[] = [];
/** STORY-05: every like/unlike event this file's requests produced, with the name that raised it. */
const likeEvents: { name: 'story.liked' | 'story.unliked'; payload: StoryLiked }[] = [];
const unsubscribes: (() => void)[] = [];
let unsubscribe: () => void = () => {};

/** The prefix every story this file writes carries, so the sweep can be exact. */
const TEST_CAPTION_PREFIX = 'Story de teste';

/** What `scripts/seed.ts` writes for BOTH tenants (05-05). */
const SEEDED_TOTAL = 5;
const SEEDED_ACTIVE = 3;
const SEEDED_EXPIRED_CAPTION = 'Publicado ontem, ja fora da regua.';
const SEEDED_PROCESSING_CAPTION = 'Video ainda processando.';

const STORY_MAX_DURATION_S = MEDIA_LIMITS.video.story?.maxDurationSeconds ?? 60;

const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

const envelope = async (res: Response) => (await res.json()) as Envelope;

/** One page, parsed. Fails loudly on a non-200 so a broken page never reads as an empty one. */
async function page(
  token: string,
  path = '/v1/stories',
  query = '',
  host = HOSTS.demo,
): Promise<StoryPage> {
  const res = await request(`${path}${query}`, token, { headers: { 'x-tenant-host': host } });
  expect(res.status, `GET ${path}${query}`).toBe(200);
  return (await res.json()) as StoryPage;
}

/** Walk every page with the returned cursors; returns the concatenation in the server's order. */
async function walk(token: string, path: string, limit: number): Promise<StorySummary[]> {
  const seen: StorySummary[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 30; guard++) {
    const query = cursor
      ? `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=${limit}`;
    const body = await page(token, path, query);
    seen.push(...body.items);
    cursor = body.nextCursor;
    if (cursor === null) break;
  }
  expect(cursor, 'the walk terminated').toBeNull();
  return seen;
}

/** A `purpose: 'story'` asset of the named tenant, in the state the caller asked for. */
async function makeAsset(opts: {
  tenantId: string;
  email: string;
  kind?: 'image' | 'video';
  purpose?: string;
  status?: string;
  providerAssetId?: string;
}): Promise<string> {
  const id = randomUUID();
  createdAssets.push(id);
  await adminSql`
    insert into public.media_assets
      (id, tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, mime, bytes,
       variant_widths)
    select ${id}::uuid, ${opts.tenantId}::uuid, m.user_id,
           ${opts.kind ?? 'image'}, ${opts.purpose ?? 'story'}, ${opts.status ?? 'ready'},
           ${opts.kind === 'video' ? 'fake' : 'supabase'},
           ${opts.providerAssetId ?? null},
           ${opts.kind === 'video' ? 'video/mp4' : 'image/webp'}, 1024,
           ${opts.kind === 'video' ? '{}' : '{640,1080}'}::int[]
      from public.memberships m
      join public.users u on u.id = m.user_id
     where m.tenant_id = ${opts.tenantId}::uuid and u.email = ${opts.email}
     limit 1`;
  return id;
}

/** `POST /v1/stories` with the given body. */
function publish(token: string, body: Record<string, unknown>, host = HOSTS.demo) {
  return request('/v1/stories', token, {
    method: 'POST',
    headers: { 'x-tenant-host': host },
    body: JSON.stringify(body),
  });
}

/** The NORMALISED provider event the worker consumes — what `verifyWebhook` would have produced. */
function readyEvent(opts: {
  assetId: string;
  providerAssetId: string;
  durationSeconds: number;
}): VideoProviderEvent {
  return {
    id: `evt-story-${opts.assetId}`,
    kind: 'ready',
    rawType: 'video.asset.ready',
    assetId: opts.assetId,
    providerAssetId: opts.providerAssetId,
    playbackId: `pb-${opts.assetId}`,
    durationSeconds: opts.durationSeconds,
    aspectRatio: '9:16',
    failureReason: null,
  };
}

async function assetStatus(assetId: string) {
  const rows = await adminSql<{ status: string; failure_reason: string | null }[]>`
    select status, failure_reason from public.media_assets where id = ${assetId}::uuid`;
  return rows[0];
}

/** Removes everything this file wrote — by id AND by caption prefix, so a crash cannot leak rows. */
async function sweep(): Promise<void> {
  await adminSql`delete from public.stories where caption like ${`${TEST_CAPTION_PREFIX}%`}`;
  if (created.length > 0) {
    await adminSql`delete from public.stories where id = any(${created}::uuid[])`;
  }
  if (createdAssets.length > 0) {
    await adminSql`delete from public.stories where media_asset_id = any(${createdAssets}::uuid[])`;
    await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
  }
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  tokens.demoAdmin = await signInAs('admin@tria-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@tria-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@tria-lab.local', SEED_PASSWORD);

  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  for (const row of rows) {
    if (row.slug === 'tria-demo') tenantIds.demo = row.id;
    if (row.slug === 'tria-lab') tenantIds.lab = row.id;
  }

  // The lab tenant ships with `stories` DISABLED (scripts/seed.ts gives it feed + events only).
  // The cross-tenant cases below need the module ON there, so turn it on here and restore it in
  // afterAll — the flag's own behaviour is proved by its own test, which flips it both ways.
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantIds.lab}::uuid, 'stories', true)
    on conflict (tenant_id, module_key) do update set enabled = true`;
  moduleFlags.invalidate(tenantIds.lab);

  await sweep();
  unsubscribe = subscribe('story.published', async (payload) => {
    events.push(payload);
  });
  unsubscribes.push(
    subscribe('story.liked', async (payload) => {
      likeEvents.push({ name: 'story.liked', payload });
    }),
    subscribe('story.unliked', async (payload) => {
      likeEvents.push({ name: 'story.unliked', payload });
    }),
  );
});

afterAll(async () => {
  unsubscribe();
  for (const off of unsubscribes) off();
  await sweep();
  await adminSql`
    delete from public.tenant_modules
     where tenant_id = ${tenantIds.lab}::uuid and module_key = 'stories'`;
  moduleFlags.invalidate(tenantIds.lab);
  await adminSql.end();
  await sqlClient.end();
});

describe('GET /v1/stories — the strip is three predicates (STORY-03, D-78, R-P8)', () => {
  it('1. the seed is the fixture: only the ACTIVE, ready, live stories, newest window first', async () => {
    const body = await page(tokens.demoMember, '/v1/stories', `?limit=${STORY_MAX_PAGE_SIZE}`);

    expect(body.items).toHaveLength(SEEDED_ACTIVE);
    expect(body.nextCursor).toBeNull();
    // Newest first, and `isActive` is the SERVER's own evaluation under the statement's clock.
    expect(body.items.every((item) => item.isActive)).toBe(true);
    expect(body.items.every((item) => item.mediaStatus === 'ready')).toBe(true);
    const windows = body.items.map((item) => Date.parse(item.expiresAt));
    expect([...windows].sort((a, b) => b - a)).toEqual(windows);
    // D-78: one item per story, never one per publisher — with V1's single publisher, grouping
    // would collapse this to exactly one row forever.
    expect(new Set(body.items.map((item) => item.id)).size).toBe(SEEDED_ACTIVE);
    expect(new Set(body.items.map((item) => item.authorUserId)).size).toBe(1);
  });

  it('2. every window is exactly 24 h wide, and the summary carries the ladder the circle needs', async () => {
    const body = await page(tokens.demoMember);
    for (const item of body.items) {
      expect(Date.parse(item.expiresAt) - Date.parse(item.publishedAt)).toBe(
        STORY_EXPIRY_HOURS * 3_600_000,
      );
    }
    const image = body.items.find((item) => item.mediaKind === 'image');
    expect(image?.mediaVariantWidths.length).toBeGreaterThan(0);
  });

  it('3. the EXPIRED story is absent from the strip, present in the history, and resolves by id', async () => {
    const strip = await page(tokens.demoMember, '/v1/stories', `?limit=${STORY_MAX_PAGE_SIZE}`);
    expect(strip.items.map((item) => item.caption)).not.toContain(SEEDED_EXPIRED_CAPTION);

    const mine = await page(tokens.demoAdmin, '/v1/stories/mine', `?limit=${STORY_MAX_PAGE_SIZE}`);
    const expired = mine.items.find((item) => item.caption === SEEDED_EXPIRED_CAPTION);
    expect(expired, 'the expired story is in the admin history').toBeDefined();
    expect(expired?.isActive).toBe(false);

    // STORY-03's whole claim, at the HTTP surface: hidden, never deleted.
    const byId = await request(`/v1/stories/${expired?.id}`, tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(byId.status).toBe(200);
    expect(((await byId.json()) as StorySummary).isActive).toBe(false);
  });

  it('4. a story on a NON-READY asset is absent from the strip and present in the history (R-P8)', async () => {
    const strip = await page(tokens.demoMember, '/v1/stories', `?limit=${STORY_MAX_PAGE_SIZE}`);
    expect(strip.items.map((item) => item.caption)).not.toContain(SEEDED_PROCESSING_CAPTION);

    const mine = await page(tokens.demoAdmin, '/v1/stories/mine', `?limit=${STORY_MAX_PAGE_SIZE}`);
    const processing = mine.items.find((item) => item.caption === SEEDED_PROCESSING_CAPTION);
    expect(processing?.mediaStatus).toBe('processing');
    // It is ACTIVE — it simply cannot be shown. The two facts are independent, which is why the
    // strip needs both predicates and the history needs neither.
    expect(processing?.isActive).toBe(true);
    expect(mine.items).toHaveLength(SEEDED_TOTAL);
  });

  it('5. a tenant with nothing live answers an empty list and a null cursor — never a 404', async () => {
    // Proved on the LAB tenant so the demo seed three other tests read is never touched, and with
    // a try/finally so a failed assertion cannot leave the fixture soft-deleted: the repair is a
    // plain UPDATE back to NULL, which `pnpm db:seed` could NOT perform (every insert is
    // `on conflict do nothing`, so a mutated row stays mutated until `pnpm db:reset`).
    await adminSql`
      update public.stories set deleted_at = now() where tenant_id = ${tenantIds.lab}::uuid`;
    try {
      const body = await page(tokens.labAdmin, '/v1/stories', '', HOSTS.lab);
      expect(body.items).toEqual([]);
      expect(body.nextCursor).toBeNull();
    } finally {
      await adminSql`
        update public.stories set deleted_at = null where tenant_id = ${tenantIds.lab}::uuid`;
    }
    // The positive control, after the repair: the lab's own three are back.
    const restored = await page(tokens.labAdmin, '/v1/stories', '', HOSTS.lab);
    expect(restored.items).toHaveLength(SEEDED_ACTIVE);
  });

  it('6. ?limit=2 pages the active stories exactly once each, and the walk terminates', async () => {
    const seen = await walk(tokens.demoMember, '/v1/stories', 2);
    expect(seen).toHaveLength(SEEDED_ACTIVE);
    expect(new Set(seen.map((item) => item.id)).size).toBe(SEEDED_ACTIVE);
  });

  it('7. limit is CLAMPED server-side in both directions — no client value can widen the page', async () => {
    const zero = await page(tokens.demoMember, '/v1/stories', '?limit=0');
    expect(zero.items).toHaveLength(1);
    const huge = await page(tokens.demoMember, '/v1/stories', '?limit=100000');
    expect(huge.items.length).toBeLessThanOrEqual(STORY_MAX_PAGE_SIZE);
    const nonsense = await page(tokens.demoMember, '/v1/stories', '?limit=abc');
    expect(nonsense.items).toHaveLength(SEEDED_ACTIVE);
  });

  it('8. a tampered or foreign cursor degrades to page 1 rather than 500 (T-05-31)', async () => {
    for (const cursor of ['nonsense', 'eyJuIjoxfQ', '%%%', 'a'.repeat(400)]) {
      const body = await page(
        tokens.demoMember,
        '/v1/stories',
        `?cursor=${encodeURIComponent(cursor)}`,
      );
      expect(body.items).toHaveLength(SEEDED_ACTIVE);
    }
  });

  it('9. a demo session never reads a lab story by id — and the lab still can', async () => {
    const labStories = await adminSql<{ id: string }[]>`
      select id from public.stories where tenant_id = ${tenantIds.lab}::uuid limit 1`;
    const labId = labStories[0]?.id;
    expect(labId).toBeDefined();

    const refused = await request(`/v1/stories/${labId}`, tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(refused.status).toBe(404);
    const body = await envelope(refused);
    expect(body.error.code).toBe('NOT_FOUND');
    // D-23 / T-05-30: one BARE code. A details key would be an existence oracle over uuids.
    expect(body.error.details).toBeUndefined();

    // The positive control in the same test: the row is there and its own tenant reads it.
    const allowed = await request(`/v1/stories/${labId}`, tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(allowed.status).toBe(200);
  });
});

describe('POST /v1/stories — a permission, an asset and a window nobody chooses (STORY-01)', () => {
  it('10. a member is refused 403; an admin publishes 201 and the story heads the strip', async () => {
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@tria-demo.local' });

    const refused = await publish(tokens.demoMember, {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} recusado`,
    });
    expect(refused.status).toBe(403);

    const before = events.length;
    const accepted = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} aceito`,
    });
    expect(accepted.status).toBe(201);
    const story = (await accepted.json()) as StorySummary;
    created.push(story.id);

    // The window comes from the COLUMN DEFAULT — nothing in the request could have set it.
    expect(Date.parse(story.expiresAt) - Date.parse(story.publishedAt)).toBe(
      STORY_EXPIRY_HOURS * 3_600_000,
    );
    expect(story.isActive).toBe(true);
    expect(story.likeCount).toBe(0);
    expect(story.viewerLiked).toBe(false);

    const strip = await page(tokens.demoMember, '/v1/stories', `?limit=${STORY_MAX_PAGE_SIZE}`);
    expect(strip.items[0]?.id).toBe(story.id);

    // Exactly one event, after commit, ids and flags only (T-05-29).
    expect(events).toHaveLength(before + 1);
    expect(Object.keys(events[events.length - 1] ?? {}).sort()).toEqual([
      'authorUserId',
      'expiresAt',
      'mediaKind',
      'storyId',
      'tenantId',
    ]);
  });

  it('11. another tenant’s asset is a bare 404; an unknown id answers identically', async () => {
    const labAsset = await makeAsset({ tenantId: tenantIds.lab, email: 'admin@tria-lab.local' });

    const foreign = await publish(tokens.demoAdmin, {
      mediaAssetId: labAsset,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} estrangeiro`,
    });
    expect(foreign.status).toBe(404);
    const foreignBody = await envelope(foreign);
    expect(foreignBody.error.details).toBeUndefined();

    const unknown = await publish(tokens.demoAdmin, {
      mediaAssetId: randomUUID(),
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} desconhecido`,
    });
    expect(unknown.status).toBe(404);
    expect((await envelope(unknown)).error.code).toBe(foreignBody.error.code);
  });

  it('12. an asset whose purpose is not `story` is 400 VALIDATION_FAILED, and no row is written', async () => {
    const postAsset = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@tria-demo.local',
      purpose: 'post',
    });
    const res = await publish(tokens.demoAdmin, {
      mediaAssetId: postAsset,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} proposito errado`,
    });
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.story).toBe('media_invalid');

    const rows = await adminSql<{ count: number }[]>`
      select count(*)::int as count from public.stories
       where media_asset_id = ${postAsset}::uuid`;
    expect(rows[0]?.count).toBe(0);
  });

  it('13. no media at all, and a caption one code unit over the cap, are both refused 400', async () => {
    const empty = await publish(tokens.demoAdmin, { mediaKind: 'image', caption: '' });
    expect(empty.status).toBe(400);
    expect((await envelope(empty)).error.details?.story).toBe('media_required');

    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@tria-demo.local' });
    const overCap = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption: 'a'.repeat(STORY_MAX_CAPTION + 1),
    });
    expect(overCap.status).toBe(400);
    expect((await envelope(overCap)).error.code).toBe('VALIDATION_FAILED');

    // The positive control: exactly AT the cap is accepted, so the refusal is the boundary and not
    // the field.
    const atCap = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX}${'a'.repeat(STORY_MAX_CAPTION - TEST_CAPTION_PREFIX.length)}`,
    });
    expect(atCap.status).toBe(201);
    created.push(((await atCap.json()) as StorySummary).id);
  });

  it('14. publishing on a PROCESSING video succeeds: the row exists, the strip does not show it', async () => {
    const assetId = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@tria-demo.local',
      kind: 'video',
      status: 'processing',
      providerAssetId: `prov-${randomUUID()}`,
    });
    const res = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'video',
      caption: `${TEST_CAPTION_PREFIX} transcodificando`,
    });
    expect(res.status).toBe(201);
    const story = (await res.json()) as StorySummary;
    created.push(story.id);
    expect(story.mediaStatus).toBe('processing');
    // D-53's precedent: the 24 h window starts at PUBLISH, not at `ready`.
    expect(story.isActive).toBe(true);

    const strip = await page(tokens.demoMember, '/v1/stories', `?limit=${STORY_MAX_PAGE_SIZE}`);
    expect(strip.items.map((item) => item.id)).not.toContain(story.id);

    const mine = await page(tokens.demoAdmin, '/v1/stories/mine', `?limit=${STORY_MAX_PAGE_SIZE}`);
    expect(mine.items.map((item) => item.id)).toContain(story.id);
  });

  it('15. …and when the worker REFUSES it for duration, it stays out of the strip with its reason', async () => {
    const providerAssetId = `prov-${randomUUID()}`;
    const assetId = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@tria-demo.local',
      kind: 'video',
      status: 'processing',
      providerAssetId,
    });
    const res = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'video',
      caption: `${TEST_CAPTION_PREFIX} longo demais`,
    });
    expect(res.status).toBe(201);
    const story = (await res.json()) as StorySummary;
    created.push(story.id);

    // Pitfall 5: the provider enforces NO duration at ingest, so the cap is only measurable once the
    // asset is ready. This is the REAL worker job, not a hand-written update.
    await mediaProviderEventJob.handler(
      readyEvent({ assetId, providerAssetId, durationSeconds: STORY_MAX_DURATION_S + 1 }),
    );

    const asset = await assetStatus(assetId);
    expect(asset?.status).toBe('rejected');
    expect(asset?.failure_reason).toBe('duration_too_long');

    // The story is never shown and is never silently gone: absent from the strip, present in the
    // admin's own list with the machine code the `media` catalog has copy for.
    const strip = await page(tokens.demoMember, '/v1/stories', `?limit=${STORY_MAX_PAGE_SIZE}`);
    expect(strip.items.map((item) => item.id)).not.toContain(story.id);

    const mine = await page(tokens.demoAdmin, '/v1/stories/mine', `?limit=${STORY_MAX_PAGE_SIZE}`);
    const refused = mine.items.find((item) => item.id === story.id);
    expect(refused?.mediaStatus).toBe('rejected');
    expect(refused?.mediaFailureReason).toBe('duration_too_long');
  });

  it('16. a duration EXACTLY at the cap is accepted, and the story enters the strip', async () => {
    const providerAssetId = `prov-${randomUUID()}`;
    const assetId = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@tria-demo.local',
      kind: 'video',
      status: 'processing',
      providerAssetId,
    });
    const res = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'video',
      caption: `${TEST_CAPTION_PREFIX} no limite`,
    });
    const story = (await res.json()) as StorySummary;
    created.push(story.id);

    await mediaProviderEventJob.handler(
      readyEvent({ assetId, providerAssetId, durationSeconds: STORY_MAX_DURATION_S }),
    );
    expect((await assetStatus(assetId))?.status).toBe('ready');

    const strip = await page(tokens.demoMember, '/v1/stories', `?limit=${STORY_MAX_PAGE_SIZE}`);
    expect(strip.items.map((item) => item.id)).toContain(story.id);
  });
});

describe('GET /v1/stories/mine and DELETE — the manage permission (D-84, T-05-25)', () => {
  it('17. a member is refused 403 on the history and on the delete', async () => {
    const history = await request('/v1/stories/mine', tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(history.status).toBe(403);

    const target = created[0];
    const removal = await request(`/v1/stories/${target}`, tokens.demoMember, {
      method: 'DELETE',
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(removal.status).toBe(403);
  });

  it('18. an admin SOFT-deletes: the row survives, the strip drops it, a second delete is 404', async () => {
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@tria-demo.local' });
    const res = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} para excluir`,
    });
    const story = (await res.json()) as StorySummary;
    created.push(story.id);

    const removal = await request(`/v1/stories/${story.id}`, tokens.demoAdmin, {
      method: 'DELETE',
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(removal.status).toBe(204);

    // SOFT: the row is still there, so the likes and comments members left on it survive and
    // Phase 8 moderation can still read it.
    const rows = await adminSql<{ deleted_at: string | null }[]>`
      select deleted_at from public.stories where id = ${story.id}::uuid`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted_at).not.toBeNull();

    const strip = await page(tokens.demoMember, '/v1/stories', `?limit=${STORY_MAX_PAGE_SIZE}`);
    expect(strip.items.map((item) => item.id)).not.toContain(story.id);

    // A repeat delete is the same bare 404 an unknown id answers — never a 204 that pretends.
    const again = await request(`/v1/stories/${story.id}`, tokens.demoAdmin, {
      method: 'DELETE',
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(again.status).toBe(404);
  });

  it('19. the history is the SAME order as the strip, with the range simply dropped', async () => {
    const mine = await walk(tokens.demoAdmin, '/v1/stories/mine', 3);
    const windows = mine.map((item) => Date.parse(item.expiresAt));
    expect([...windows].sort((a, b) => b - a)).toEqual(windows);
    // Every soft-deleted row is absent from BOTH reads (Pitfall 9: the predicate is in the query,
    // not in the policy).
    const deleted = await adminSql<{ id: string }[]>`
      select id from public.stories
       where tenant_id = ${tenantIds.demo}::uuid and deleted_at is not null`;
    const removedIds = new Set(deleted.map((row) => row.id));
    expect(mine.some((item) => removedIds.has(item.id))).toBe(false);
  });
});

describe('STORY-05 (first half) — the story like toggle is idempotent and counted by the database', () => {
  /**
   * Every case below runs against THIS FILE'S OWN stories, never the seeded ones. A test that liked
   * a seeded row would leave the shared fixture one like heavier than `pnpm db:seed` wrote it, and
   * `on conflict (id) do nothing` cannot repair a MUTATED row — the next run of any spec that reads
   * a seeded count would then measure whichever ran first. `feed_likes_story_fk` is
   * `on delete cascade`, so `sweep()` removing the story removes its likes with it.
   */
  let storyId = '';
  let expiredStoryId = '';

  const like = (token: string, id: string, host = HOSTS.demo) =>
    request(`/v1/stories/${id}/likes`, token, {
      method: 'POST',
      headers: { 'x-tenant-host': host },
    });

  const unlike = (token: string, id: string, host = HOSTS.demo) =>
    request(`/v1/stories/${id}/likes`, token, {
      method: 'DELETE',
      headers: { 'x-tenant-host': host },
    });

  /** `count(*)` of the live like rows for a story — what `like_count` must always equal. */
  async function likeRows(id: string): Promise<number> {
    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes where story_id = ${id}::uuid`;
    return rows[0]?.n ?? 0;
  }

  async function storedCount(id: string): Promise<number> {
    const rows = await adminSql<{ like_count: number }[]>`
      select like_count from public.stories where id = ${id}::uuid`;
    return rows[0]?.like_count ?? -1;
  }

  beforeAll(async () => {
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@tria-demo.local' });
    const res = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} — curtidas`,
    });
    expect(res.status).toBe(201);
    storyId = ((await res.json()) as StorySummary).id;
    created.push(storyId);

    // An EXPIRED story of this file's own, written directly: a story cannot be published expired
    // (the window is a column default), and the seeded expired row must stay untouched.
    const expiredAsset = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@tria-demo.local',
    });
    expiredStoryId = randomUUID();
    created.push(expiredStoryId);
    await adminSql`
      insert into public.stories
        (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at)
      select ${expiredStoryId}::uuid, ${tenantIds.demo}::uuid, m.user_id, ${expiredAsset}::uuid,
             'image', ${`${TEST_CAPTION_PREFIX} — expirada`},
             now() - interval '30 hours', now() - interval '6 hours'
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@tria-demo.local'
       limit 1`;
  });

  it('22. a member likes a story once: 200, liked true, and the AUTHORITATIVE count is 1', async () => {
    const res = await like(tokens.demoMember, storyId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StoryLikeResult;
    expect(body).toEqual({ liked: true, likeCount: 1 });

    // The count came from the ROW, which only the trigger writes — not from anything the service
    // incremented. Proving that here is what makes the pgTAP reconciliation a second opinion.
    expect(await storedCount(storyId)).toBe(1);
    expect(await likeRows(storyId)).toBe(1);
  });

  it('23. a REPEAT like is a no-op: the same 200 body, no second row, and NEVER a 409', async () => {
    const res = await like(tokens.demoMember, storyId);
    expect(res.status).toBe(200);
    expect((await res.json()) as StoryLikeResult).toEqual({ liked: true, likeCount: 1 });
    // `feed_likes_story_uq` is the arbiter. A 409 here would surface as an error toast on a tap the
    // member has every right to repeat.
    expect(await likeRows(storyId)).toBe(1);
  });

  it('24. a SECOND member lifts it to 2, and each member sees their own viewerLiked', async () => {
    const res = await like(tokens.demoAdmin, storyId);
    expect(res.status).toBe(200);
    expect((await res.json()) as StoryLikeResult).toEqual({ liked: true, likeCount: 2 });

    const asMember = await page(tokens.demoMember, '/v1/stories', `?limit=${STORY_MAX_PAGE_SIZE}`);
    const mine = asMember.items.find((item) => item.id === storyId);
    expect(mine?.likeCount).toBe(2);
    expect(mine?.viewerLiked).toBe(true);
  });

  it('25. an unlike decrements once and a REPEAT unlike is a successful no-op', async () => {
    const first = await unlike(tokens.demoMember, storyId);
    expect(first.status).toBe(200);
    expect((await first.json()) as StoryLikeResult).toEqual({ liked: false, likeCount: 1 });

    const second = await unlike(tokens.demoMember, storyId);
    expect(second.status).toBe(200);
    expect((await second.json()) as StoryLikeResult).toEqual({ liked: false, likeCount: 1 });
    expect(await likeRows(storyId)).toBe(1);
  });

  it('26. `stories.like_count` equals count(*) of its like rows after the whole mixed sequence', async () => {
    // The reconciliation at the HTTP layer, over the sequence tests 22-25 actually performed. There
    // is no `greatest(0, …)` clamp in the trigger, so drift shows up here rather than being hidden.
    expect(await storedCount(storyId)).toBe(await likeRows(storyId));
  });

  it('27. liking an EXPIRED story succeeds — expiry gates the strip, never the interaction (A-4)', async () => {
    const res = await like(tokens.demoMember, expiredStoryId);
    expect(res.status).toBe(200);
    expect((await res.json()) as StoryLikeResult).toEqual({ liked: true, likeCount: 1 });

    // …and it is still absent from the strip, which is the point: one predicate, in one place.
    const strip = await page(tokens.demoMember, '/v1/stories', `?limit=${STORY_MAX_PAGE_SIZE}`);
    expect(strip.items.some((item) => item.id === expiredStoryId)).toBe(false);
  });

  it('28. another tenant’s story and a removed one are the SAME bare 404, with no details', async () => {
    const labStories = await adminSql<{ id: string }[]>`
      select id from public.stories
       where tenant_id = ${tenantIds.lab}::uuid and deleted_at is null limit 1`;
    const labStoryId = labStories[0]?.id;
    expect(labStoryId, 'the lab tenant has a seeded story to probe with').toBeTruthy();

    const foreign = await like(tokens.demoMember, labStoryId as string);
    expect(foreign.status).toBe(404);
    const foreignBody = await envelope(foreign);
    expect(foreignBody.error.code).toBe('NOT_FOUND');
    // T-05-35: no `details` key at all. A per-cause code over an enumerable uuid space is an
    // existence oracle, and the removed case below must be byte-identical to this one.
    expect(foreignBody.error).not.toHaveProperty('details');

    const removedId = randomUUID();
    created.push(removedId);
    const removedAsset = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@tria-demo.local',
    });
    await adminSql`
      insert into public.stories
        (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, deleted_at)
      select ${removedId}::uuid, ${tenantIds.demo}::uuid, m.user_id, ${removedAsset}::uuid,
             'image', ${`${TEST_CAPTION_PREFIX} — removida`}, now()
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@tria-demo.local'
       limit 1`;

    const removed = await like(tokens.demoMember, removedId);
    expect(removed.status).toBe(404);
    const removedBody = await envelope(removed);
    expect(removedBody.error.code).toBe(foreignBody.error.code);
    expect(removedBody.error).not.toHaveProperty('details');

    // Positive control in the same test: the very same call on a story this tenant CAN see works,
    // so the two 404s above are about visibility and not about a broken route.
    const control = await like(tokens.demoMember, storyId);
    expect(control.status).toBe(200);
    await unlike(tokens.demoMember, storyId);
  });

  it('29. the events carry the story AUTHOR and no caption, and an empty unlike emits nothing', async () => {
    likeEvents.length = 0;

    await like(tokens.demoAdmin, expiredStoryId);
    await new Promise((resolve) => setImmediate(resolve));
    const liked = likeEvents.find((entry) => entry.name === 'story.liked');
    expect(liked, 'the like emitted story.liked').toBeTruthy();
    // Phase 7 builds a notification row straight from this payload; without the author id every
    // subscriber would have to re-read the story it is being told about.
    expect(Object.keys(liked?.payload ?? {}).sort()).toEqual([
      'actorUserId',
      'storyAuthorUserId',
      'storyId',
      'tenantId',
    ]);
    expect(liked?.payload.storyId).toBe(expiredStoryId);

    likeEvents.length = 0;
    // `storyId` currently carries ONE like, and it is the admin's — the member's was removed at 25
    // and the control at 28 put it back and took it away again. So this delete removes nothing: a
    // successful 200 with the count unmoved, and NO event, because nothing happened. An event that
    // counts transitions must not report one that did not occur.
    const res = await unlike(tokens.demoMember, storyId);
    expect(res.status).toBe(200);
    expect((await res.json()) as StoryLikeResult).toEqual({ liked: false, likeCount: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(likeEvents).toHaveLength(0);
  });

  it('30. the like routes carry NO permission: a plain member reaches both halves', async () => {
    // Posting is a permission; INTERACTING is not (FEED-04's rule, restated). A 403 here would mean
    // only admins could like their own broadcasts.
    const liked = await like(tokens.demoMember, storyId);
    expect(liked.status).toBe(200);
    const unliked = await unlike(tokens.demoMember, storyId);
    expect(unliked.status).toBe(200);
  });
});

describe('STORY-05 (second half) — the comment surface, and the two refusals the DATABASE owns', () => {
  /**
   * The assertions that matter here are the two REFUSALS, and they are asserted BY MACHINE CODE
   * rather than by status. A 400 alone would pass if the service had grown an application-level
   * `if (parentId) throw` — which is precisely the implementation this plan exists to replace,
   * because it would keep this suite green while the constraint was missing. The code is the
   * service's TRANSLATION of a SQLSTATE Postgres raised on a named constraint; pgTAP proves the
   * constraint, and these prove the translation reaches a caller.
   *
   * Each refusal ships its POSITIVE CONTROL against a POST in the same block: the Phase 4 reply and
   * the Phase 4 comment like still work, so a rewrite that had broken commenting outright could not
   * pass this file.
   *
   * Everything runs against THIS FILE'S OWN story and its own post, never the seeded rows — the
   * `on conflict (id) do nothing` seed cannot repair a mutated fixture (the 05-06 lesson).
   */
  let storyId = '';
  let expiredStoryId = '';
  let postId = '';
  let postCommentId = '';
  const commentEvents: StoryCommented[] = [];

  const listComments = (token: string, id: string, query = '', host = HOSTS.demo) =>
    request(`/v1/stories/${id}/comments${query}`, token, { headers: { 'x-tenant-host': host } });

  const createComment = (
    token: string,
    id: string,
    body: Record<string, unknown>,
    host = HOSTS.demo,
  ) =>
    request(`/v1/stories/${id}/comments`, token, {
      method: 'POST',
      headers: { 'x-tenant-host': host },
      body: JSON.stringify(body),
    });

  async function storedCommentCount(id: string): Promise<number> {
    const rows = await adminSql<{ comment_count: number }[]>`
      select comment_count from public.stories where id = ${id}::uuid`;
    return rows[0]?.comment_count ?? -1;
  }

  async function liveCommentRows(id: string): Promise<number> {
    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_comments
       where story_id = ${id}::uuid and deleted_at is null`;
    return rows[0]?.n ?? -1;
  }

  beforeAll(async () => {
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@tria-demo.local' });
    const res = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} — comentarios`,
    });
    expect(res.status).toBe(201);
    storyId = ((await res.json()) as StorySummary).id;
    created.push(storyId);

    // An EXPIRED story of this file's own: commenting on one must still work (A-4), because 05-08
    // pins expired stories to communities and an affordance that 400d there would be a second copy
    // of the 24 h window.
    const expiredAsset = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@tria-demo.local',
    });
    expiredStoryId = randomUUID();
    created.push(expiredStoryId);
    await adminSql`
      insert into public.stories
        (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at)
      select ${expiredStoryId}::uuid, ${tenantIds.demo}::uuid, m.user_id, ${expiredAsset}::uuid,
             'image', ${`${TEST_CAPTION_PREFIX} — expirada comentada`},
             now() - interval '30 hours', now() - interval '6 hours'
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@tria-demo.local'
       limit 1`;

    // The POSITIVE CONTROLS' target: a tenant-wide post of this file's own (no community, so no
    // community counter moves) with one ROOT comment on it.
    postId = randomUUID();
    postCommentId = randomUUID();
    await adminSql`
      insert into public.feed_posts (id, tenant_id, author_user_id, caption)
      select ${postId}::uuid, ${tenantIds.demo}::uuid, m.user_id, ${`${TEST_CAPTION_PREFIX} — post de controle`}
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@tria-demo.local'
       limit 1`;
    await adminSql`
      insert into public.feed_comments
        (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
      select ${postCommentId}::uuid, ${tenantIds.demo}::uuid, ${postId}::uuid, m.user_id,
             'raiz de controle', 0, null, null, null
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@tria-demo.local'
       limit 1`;

    unsubscribes.push(
      subscribe('story.commented', async (payload) => {
        commentEvents.push(payload);
      }),
    );
  });

  afterAll(async () => {
    // The post cascades its comments and their likes; the stories are swept by `created`.
    await adminSql`delete from public.feed_posts where id = ${postId}::uuid`;
  });

  it('31. a member comments on a story: 201, the row comes back, and the COUNT moves to 1', async () => {
    const res = await createComment(tokens.demoMember, storyId, { body: 'Primeiro comentario.' });
    expect(res.status).toBe(201);

    const created = (await res.json()) as StoryComment;
    expect(created.body).toBe('Primeiro comentario.');
    expect(created.authorRemoved).toBe(false);
    expect(created.canDelete).toBe(true);
    // The flat shape: four fields a story comment has no concept of are ABSENT from the wire.
    expect(created).not.toHaveProperty('likeCount');
    expect(created).not.toHaveProperty('replyCount');

    expect(await storedCommentCount(storyId)).toBe(1);
  });

  it('32. the list runs OLDEST first and pages FORWARD, never repeating and never skipping', async () => {
    for (const body of ['Segundo comentario.', 'Terceiro comentario.']) {
      expect((await createComment(tokens.demoMember, storyId, { body })).status).toBe(201);
    }

    const first = await listComments(tokens.demoMember, storyId, '?limit=2');
    expect(first.status).toBe(200);
    const page1 = (await first.json()) as StoryCommentPage;
    expect(page1.items.map((c) => c.body)).toEqual(['Primeiro comentario.', 'Segundo comentario.']);
    expect(page1.nextCursor).not.toBeNull();

    const second = await listComments(
      tokens.demoMember,
      storyId,
      `?limit=2&cursor=${encodeURIComponent(page1.nextCursor ?? '')}`,
    );
    const page2 = (await second.json()) as StoryCommentPage;
    // Page 2 CONTINUES forward: the third row, and no repeat of either row on page 1.
    expect(page2.items.map((c) => c.body)).toEqual(['Terceiro comentario.']);
    expect(page2.nextCursor).toBeNull();

    const ids = [...page1.items, ...page2.items].map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('33. a REPLY to a story comment is refused BY MACHINE CODE — the database raised it', async () => {
    const page = (await (
      await listComments(tokens.demoMember, storyId, '?limit=1')
    ).json()) as StoryCommentPage;
    const parentId = page.items[0]?.id ?? '';

    const res = await createComment(tokens.demoMember, storyId, {
      body: 'Tentando responder.',
      parentId,
    });
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    // The CODE, not the status: a 400 alone would also be produced by an application pre-check,
    // which is exactly the implementation this plan removed.
    expect(body.error.details?.comment).toBe('story_comment_no_reply');

    // …and nothing was written: the count is still three.
    expect(await storedCommentCount(storyId)).toBe(3);
  });

  it('34. POSITIVE CONTROL: a reply to a POST comment still succeeds, unchanged by the rewrite', async () => {
    const res = await request(`/v1/feed/posts/${postId}/comments`, tokens.demoMember, {
      method: 'POST',
      headers: { 'x-tenant-host': HOSTS.demo },
      body: JSON.stringify({ body: 'Resposta legitima.', parentId: postCommentId }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { isReply: boolean }).isReply).toBe(true);
  });

  it('35. a LIKE on a story comment is refused BY MACHINE CODE, on the feed’s own like route', async () => {
    const page = (await (
      await listComments(tokens.demoMember, storyId, '?limit=1')
    ).json()) as StoryCommentPage;
    const commentId = page.items[0]?.id ?? '';

    const res = await request(`/v1/feed/comments/${commentId}/like`, tokens.demoMember, {
      method: 'POST',
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.like).toBe('story_comment_not_likeable');

    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes where comment_id = ${commentId}::uuid`;
    expect(rows[0]?.n).toBe(0);
  });

  it('36. POSITIVE CONTROL: a like on a POST comment still succeeds', async () => {
    const res = await request(`/v1/feed/comments/${postCommentId}/like`, tokens.demoMember, {
      method: 'POST',
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { liked: boolean }).liked).toBe(true);
  });

  it('37. commenting on an EXPIRED story succeeds — expiry gates the strip, never the interaction', async () => {
    const res = await createComment(tokens.demoMember, expiredStoryId, { body: 'Ainda aqui.' });
    expect(res.status).toBe(201);
    expect(await storedCommentCount(expiredStoryId)).toBe(1);
  });

  it('38. DELETE soft-deletes the member’s OWN comment and moves the count exactly ONCE', async () => {
    const page = (await (
      await listComments(tokens.demoMember, storyId, '?limit=1')
    ).json()) as StoryCommentPage;
    const commentId = page.items[0]?.id ?? '';

    const first = await request(`/v1/stories/${storyId}/comments/${commentId}`, tokens.demoMember, {
      method: 'DELETE',
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(first.status).toBe(204);
    expect(await storedCommentCount(storyId)).toBe(2);

    // The ROW survives for Phase 8 moderation; only `deleted_at` moved.
    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_comments where id = ${commentId}::uuid`;
    expect(rows[0]?.n).toBe(1);

    // A second delete matches nothing: one bare 404, and the count does NOT move again.
    const second = await request(
      `/v1/stories/${storyId}/comments/${commentId}`,
      tokens.demoMember,
      {
        method: 'DELETE',
        headers: { 'x-tenant-host': HOSTS.demo },
      },
    );
    expect(second.status).toBe(404);
    expect(await storedCommentCount(storyId)).toBe(2);
  });

  it('39. someone else’s comment, another tenant’s story and an unknown id are ONE bare 404', async () => {
    const page = (await (
      await listComments(tokens.demoMember, storyId, '?limit=1')
    ).json()) as StoryCommentPage;
    const someoneElses = page.items[0]?.id ?? '';

    // The admin wrote nothing here, so this comment is not theirs to remove.
    const notMine = await request(
      `/v1/stories/${storyId}/comments/${someoneElses}`,
      tokens.demoAdmin,
      { method: 'DELETE', headers: { 'x-tenant-host': HOSTS.demo } },
    );
    expect(notMine.status).toBe(404);
    // ONE read of the body: it is a stream, and the bare-404 claim is about BOTH halves of the
    // same envelope — the code, and the absence of any `details` a prober could read.
    const miss = await envelope(notMine);
    expect(miss.error.code).toBe('NOT_FOUND');
    expect(miss.error.details).toBeUndefined();

    // Another tenant's story: the list and the create take the SAME branch.
    const foreignList = await listComments(tokens.labAdmin, storyId, '', HOSTS.lab);
    expect(foreignList.status).toBe(404);
    const foreignCreate = await createComment(
      tokens.labAdmin,
      storyId,
      { body: 'De outro tenant.' },
      HOSTS.lab,
    );
    expect(foreignCreate.status).toBe(404);

    const unknown = await listComments(tokens.demoMember, randomUUID());
    expect(unknown.status).toBe(404);
  });

  it('40. the comment routes carry NO permission — a plain member lists, creates and deletes', async () => {
    const res = await createComment(tokens.demoMember, storyId, { body: 'Sem permissao.' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as StoryComment;

    expect((await listComments(tokens.demoMember, storyId)).status).toBe(200);
    const removed = await request(`/v1/stories/${storyId}/comments/${id}`, tokens.demoMember, {
      method: 'DELETE',
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(removed.status).toBe(204);
  });

  it('41. `story.commented` carries the story AUTHOR and NO body, and the count reconciles', async () => {
    expect(commentEvents.length).toBeGreaterThan(0);
    const event = commentEvents[0];
    expect(event?.storyId).toBe(storyId);
    expect(event?.storyAuthorUserId).toBeTruthy();
    expect(event?.storyAuthorUserId).not.toBe(event?.actorUserId);
    // Ids and flags only — a comment body must never enter an event payload (T-05-43).
    expect(JSON.stringify(event)).not.toContain('Primeiro comentario');
    expect(Object.keys(event ?? {}).sort()).toEqual([
      'actorUserId',
      'commentId',
      'storyAuthorUserId',
      'storyId',
      'tenantId',
    ]);

    expect(await storedCommentCount(storyId)).toBe(await liveCommentRows(storyId));
    expect(await storedCommentCount(expiredStoryId)).toBe(await liveCommentRows(expiredStoryId));
  });
});

describe('MOD-04 / UI-D-25 — the module flag governs the routes in both directions', () => {
  it('20. with stories OFF every route 404s and the bootstrap carries neither slot nor permission', async () => {
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${tenantIds.demo}::uuid and module_key = 'stories'`;
    moduleFlags.invalidate(tenantIds.demo);

    for (const path of ['/v1/stories', '/v1/stories/mine']) {
      const res = await request(path, tokens.demoAdmin, {
        headers: { 'x-tenant-host': HOSTS.demo },
      });
      expect(res.status, path).toBe(404);
    }

    const bootstrap = await request('/v1/me/bootstrap', tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    const body = (await bootstrap.json()) as {
      modules: { key: string; home?: unknown }[];
      permissions: string[];
    };
    expect(body.modules.map((m) => m.key)).not.toContain('stories');
    expect(body.permissions).not.toContain('stories.story.publish');
  });

  it('21. …and turning it back ON restores both, with no migration and no route edit', async () => {
    await adminSql`
      update public.tenant_modules set enabled = true
       where tenant_id = ${tenantIds.demo}::uuid and module_key = 'stories'`;
    moduleFlags.invalidate(tenantIds.demo);

    const res = await request('/v1/stories', tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);

    const bootstrap = await request('/v1/me/bootstrap', tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    const body = (await bootstrap.json()) as {
      modules: { key: string; home?: { order: number }[] }[];
      permissions: string[];
    };
    const entry = body.modules.find((m) => m.key === 'stories');
    // UI-D-25: the order-5 home slot, and NO nav entry — the publish door is the strip's own
    // circle (D-80), not a fourth tab.
    expect(entry?.home).toEqual([{ order: 5 }]);
    expect(entry).not.toHaveProperty('nav');
    expect(body.permissions).toContain('stories.story.publish');
    expect(body.permissions).toContain('stories.story.manage');
  });
});
