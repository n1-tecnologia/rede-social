import { randomUUID } from 'node:crypto';
import { MEDIA_LIMITS } from '@rede-social/contracts/media';
import { sqlClient } from '@rede-social/core/db';
import { subscribe } from '@rede-social/core/server/events/bus';
import { mediaProviderEventJob } from '@rede-social/core/server/media/video/event-job';
import type { VideoProviderEvent } from '@rede-social/core/server/media/video/types';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { setPermissionResolver } from '@rede-social/core/server/rbac/permissions';
import {
  type HighlightSummary,
  highlightDetailSchema,
  highlightListSchema,
  highlightMembershipResultSchema,
  highlightSummarySchema,
  STORY_EXPIRY_HOURS,
  STORY_HIGHLIGHT_MAX_ITEMS,
  STORY_HIGHLIGHT_MAX_PER_PLACE,
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
  storyHighlightIdsSchema,
} from '@rede-social/module-stories/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permissionsFor } from '../../src/modules/registry';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * `@rede-social/module-stories` end to end against the live local stack and the real seed (05-05).
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

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labAdmin: '' };
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

  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);

  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
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
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@rede-demo.local' });

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
    const labAsset = await makeAsset({ tenantId: tenantIds.lab, email: 'admin@rede-lab.local' });

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
      email: 'admin@rede-demo.local',
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

    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@rede-demo.local' });
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
      email: 'admin@rede-demo.local',
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
      email: 'admin@rede-demo.local',
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
      email: 'admin@rede-demo.local',
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
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@rede-demo.local' });
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
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@rede-demo.local' });
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
      email: 'admin@rede-demo.local',
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
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@rede-demo.local'
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
      email: 'admin@rede-demo.local',
    });
    await adminSql`
      insert into public.stories
        (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, deleted_at)
      select ${removedId}::uuid, ${tenantIds.demo}::uuid, m.user_id, ${removedAsset}::uuid,
             'image', ${`${TEST_CAPTION_PREFIX} — removida`}, now()
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@rede-demo.local'
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
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@rede-demo.local' });
    const res = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} — comentarios`,
    });
    expect(res.status).toBe(201);
    storyId = ((await res.json()) as StorySummary).id;
    created.push(storyId);

    // An EXPIRED story of this file's own: commenting on one must still work (A-4), because a
    // highlight keeps expired stories on Início and community pages, and an affordance that 400d
    // there would be a second copy of the 24 h window.
    const expiredAsset = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@rede-demo.local',
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
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@rede-demo.local'
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
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@rede-demo.local'
       limit 1`;
    await adminSql`
      insert into public.feed_comments
        (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
      select ${postCommentId}::uuid, ${tenantIds.demo}::uuid, ${postId}::uuid, m.user_id,
             'raiz de controle', 0, null, null, null
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@rede-demo.local'
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

    // Support wrote nothing here and holds no `moderation.manage`, so this comment is not theirs to
    // remove. (Since 08-03, D-336, an ADMIN may remove it — `moderation-comments.test.ts` 'story'.)
    const notMine = await request(
      `/v1/stories/${storyId}/comments/${someoneElses}`,
      tokens.demoSupport,
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

describe('05.1 Wave 0 — the integration worker never reaches the real video vendor', () => {
  // 05.1's born-attached publish (`communityId`, a community pin) retired with the pin model in
  // 05.2-11; its invariants live on in the `05.2 —` block below (see 05.2-11-SUMMARY's twin map).
  // This one guard was never about pins and stays.
  it('05.1-0. Wave 0: the integration worker never reaches the real video vendor (Pitfall 2)', () => {
    // `apps/api/vitest.config.ts` pins this as the LAST `test.env` entry, so neither a developer's
    // `.env.local` (`VIDEO_PROVIDER=mux`) nor an exported variable can override it.
    expect(process.env.VIDEO_PROVIDER).toBe('fake');
  });
});

describe('05.2 — highlights at the API (HIGHLIGHT-01/02, D-100..D-103)', () => {
  /**
   * THE PHASE'S TRACER at the HTTP tier: an admin creates a named Início highlight, keeps an EXPIRED
   * story in it, and a member reads the row and plays the story back while the strip refuses it.
   *
   * This block's OWN fixture: every highlight it creates has a title starting `Teste ` (≤ 15 units)
   * and is deleted in `afterAll` by id AND by that prefix, so a crashed run cannot leak one into the
   * seeded rows later plans read. Its stories carry `TEST_CAPTION_PREFIX`, so the file's sweep
   * removes them and their items go with them (`story_highlight_items` cascades on the story).
   */
  const createdHighlights: string[] = [];

  /** Every curation event this block's requests produced, by name — the transitions-only checks. */
  const curationEvents: { name: string; payload: Record<string, unknown> }[] = [];
  const curationOffs: (() => void)[] = [];
  const eventsNamed = (name: string) => curationEvents.filter((event) => event.name === name);

  const hlRequest = (
    token: string,
    path: string,
    init: RequestInit = {},
    host: string = HOSTS.demo,
  ) =>
    request(`/v1/stories/highlights${path}`, token, {
      ...init,
      headers: { 'x-tenant-host': host, ...((init.headers as Record<string, string>) ?? {}) },
    });

  const createHighlight = (token: string, body: Record<string, unknown>, host = HOSTS.demo) =>
    hlRequest(token, '', { method: 'POST', body: JSON.stringify(body) }, host);

  const addItem = (token: string, highlightId: string, storyId: string, host = HOSTS.demo) =>
    hlRequest(token, `/${highlightId}/stories/${storyId}`, { method: 'PUT' }, host);

  /** One place's row, parsed; fails loudly on a non-200 so a refusal never reads as an empty row. */
  async function row(token: string, query = ''): Promise<HighlightSummary[]> {
    const res = await hlRequest(token, query);
    expect(res.status, `GET /v1/stories/highlights${query}`).toBe(200);
    return highlightListSchema.parse(await res.json()).items;
  }

  /** A created highlight, parsed, and remembered for cleanup. */
  async function create(token: string, body: Record<string, unknown>): Promise<HighlightSummary> {
    const res = await createHighlight(token, body);
    expect(res.status, `POST /v1/stories/highlights ${JSON.stringify(body)}`).toBe(201);
    const summary = highlightSummarySchema.parse(await res.json());
    createdHighlights.push(summary.id);
    return summary;
  }

  /** A ready image story of the demo tenant, published through the API. */
  async function publishImage(label: string): Promise<{ storyId: string; assetId: string }> {
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@rede-demo.local' });
    const res = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} — ${label}`,
    });
    expect(res.status).toBe(201);
    const storyId = ((await res.json()) as StorySummary).id;
    created.push(storyId);
    return { storyId, assetId };
  }

  async function itemRows(highlightId: string, storyId: string): Promise<number> {
    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.story_highlight_items
       where highlight_id = ${highlightId}::uuid and story_id = ${storyId}::uuid`;
    return rows[0]?.n ?? 0;
  }

  /**
   * Communities this block creates. Removed in `afterAll`; `story_highlights_community_fk` cascades, so
   * any highlight placed in one goes with it.
   */
  const highlightCommunities: string[] = [];

  async function makeHighlightCommunity(
    name: string,
    opts: { status?: 'active' | 'archived'; removed?: boolean } = {},
  ): Promise<string> {
    const id = randomUUID();
    highlightCommunities.push(id);
    await adminSql`
      insert into public.communities (id, tenant_id, created_by_user_id, name, slug, status, deleted_at)
      select ${id}::uuid, ${tenantIds.demo}::uuid, m.user_id, ${name}, ${id}, ${opts.status ?? 'active'},
             case when ${opts.removed ?? false} then now() end
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@rede-demo.local'
       limit 1`;
    return id;
  }

  /** `requestId` identifies the CALL, not the row — strip it before comparing two refusals. */
  const withoutRequestId = (raw: string) => {
    const { requestId: _requestId, ...error } = (JSON.parse(raw) as Envelope).error;
    return JSON.stringify({ error });
  };

  afterAll(async () => {
    for (const off of curationOffs) off();
    if (createdHighlights.length > 0) {
      await adminSql`delete from public.story_highlights where id = any(${createdHighlights}::uuid[])`;
    }
    // Crash sweep: nothing seeded or migrated starts with `Teste `.
    await adminSql`delete from public.story_highlights where title like 'Teste %'`;
    if (highlightCommunities.length > 0) {
      await adminSql`delete from public.communities where id = any(${highlightCommunities}::uuid[])`;
    }
  });

  it('05.2-1 an admin keeps an EXPIRED story in an Início highlight and a member plays it from there', async () => {
    const before = await adminSql<{ max: number | null }[]>`
      select max(position)::int as max from public.story_highlights
       where tenant_id = ${tenantIds.demo}::uuid and community_id is null`;
    const expectedPosition = (before[0]?.max ?? -1) + 1;

    const highlight = await create(tokens.demoAdmin, { title: '  Teste Bastidor  ' });
    expect(highlight.communityId).toBeNull();
    expect(highlight.title).toBe('Teste Bastidor');
    expect(highlight.itemCount).toBe(0);
    // R-D-C: a new highlight lands at the END of its place's row.
    expect(highlight.position).toBe(expectedPosition);

    const { storyId, assetId } = await publishImage('destaque expirado');
    // Into the past: a story cannot be PUBLISHED expired (the window is a column default).
    await adminSql`
      update public.stories
         set published_at = now() - interval '30 hours', expires_at = now() - interval '6 hours'
       where id = ${storyId}::uuid`;

    const first = await addItem(tokens.demoAdmin, highlight.id, storyId);
    expect(first.status).toBe(200);
    const firstBody = highlightMembershipResultSchema.parse(await first.json());
    expect(firstBody).toEqual({ highlighted: true, highlightCount: 1 });

    // D-100's arbiter: a repeat add is a 200 with the identical body and no second row — never 409.
    const repeat = await addItem(tokens.demoAdmin, highlight.id, storyId);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual(firstBody);
    expect(await itemRows(highlight.id, storyId)).toBe(1);

    // The MEMBER's Início row lists it, with the image story as its automatic cover (R-D-D rule 3).
    const listed = (await row(tokens.demoMember)).find((item) => item.id === highlight.id);
    expect(listed?.itemCount).toBe(1);
    expect(listed?.coverAssetId).toBe(assetId);
    expect(listed?.coverChosen).toBe(false);

    // …and plays the story from it: the item row is the expiry override (STORY-04 re-delivered).
    const detailRes = await hlRequest(tokens.demoMember, `/${highlight.id}`);
    expect(detailRes.status).toBe(200);
    const detail = highlightDetailSchema.parse(await detailRes.json());
    const item = detail.items.find((story) => story.id === storyId);
    expect(item?.isActive).toBe(false);

    // The same story, the same instant, the STRIP: absent. The two reads disagree deliberately.
    const strip = await walk(tokens.demoMember, '/v1/stories', STORY_MAX_PAGE_SIZE);
    expect(strip.some((story) => story.id === storyId)).toBe(false);
  });

  it('05.2-2 an EMPTY highlight is kept for the curator and invisible to members (D-102)', async () => {
    const empty = await create(tokens.demoAdmin, { title: 'Teste Vazio' });

    expect((await row(tokens.demoMember)).some((item) => item.id === empty.id)).toBe(false);

    // A member asking for it by id gets the SAME bare 404 an unknown id gets — no details.
    const detail = await hlRequest(tokens.demoMember, `/${empty.id}`);
    expect(detail.status).toBe(404);
    expect((await envelope(detail)).error.details).toBeUndefined();

    // `scope=all` is the curator's read; a member cannot widen theirs with it.
    const widened = await hlRequest(tokens.demoMember, '?scope=all');
    expect(widened.status).toBe(403);

    const curated = (await row(tokens.demoAdmin, '?scope=all')).find(
      (item) => item.id === empty.id,
    );
    expect(curated?.itemCount).toBe(0);
    expect((await row(tokens.demoAdmin)).some((item) => item.id === empty.id)).toBe(false);
  });

  it('05.2-3 a highlight plays OLDEST first by publish time, never by when a story was added (D-103)', async () => {
    const highlight = await create(tokens.demoAdmin, { title: 'Teste Ordem' });
    const older = await publishImage('ordem mais antiga');
    const newer = await publishImage('ordem mais nova');
    await adminSql`
      update public.stories set published_at = now() - interval '2 minutes'
       where id = ${older.storyId}::uuid`;
    await adminSql`
      update public.stories set published_at = now() - interval '1 minute'
       where id = ${newer.storyId}::uuid`;

    // Added NEWEST first…
    expect((await addItem(tokens.demoAdmin, highlight.id, newer.storyId)).status).toBe(200);
    expect((await addItem(tokens.demoAdmin, highlight.id, older.storyId)).status).toBe(200);

    // …played OLDEST first.
    const res = await hlRequest(tokens.demoMember, `/${highlight.id}`);
    expect(res.status).toBe(200);
    const detail = highlightDetailSchema.parse(await res.json());
    expect(detail.items.map((story) => story.id)).toEqual([older.storyId, newer.storyId]);
  });

  it('05.2-4 every refusal is the closed vocabulary or ONE bare 404 — and an active community still creates', async () => {
    // Titles: the Zod contract's issue message IS the machine code, lifted to `details.highlight`.
    for (const title of ['', 'Teste de 16 unid']) {
      expect(title.length === 0 || title.length === 16).toBe(true);
      const res = await createHighlight(tokens.demoAdmin, { title });
      expect(res.status, JSON.stringify(title)).toBe(400);
      const body = await envelope(res);
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details).toEqual({ highlight: 'title_invalid' });
    }

    // T-05.2-01: curating is a PERMISSION. A member is refused on both writes, before any lookup.
    const target = await create(tokens.demoAdmin, { title: 'Teste Recusas' });
    const { storyId } = await publishImage('recusas');
    const memberCreate = await createHighlight(tokens.demoMember, { title: 'Teste Membro' });
    expect(memberCreate.status).toBe(403);
    const memberAdd = await addItem(tokens.demoMember, target.id, storyId);
    expect(memberAdd.status).toBe(403);
    expect(await itemRows(target.id, storyId)).toBe(0);

    // D-23: an unknown highlight, an unknown story and a REMOVED community are ONE answer — 404,
    // no `details`, and bodies equal once the per-call `requestId` is stripped.
    const removed = await makeHighlightCommunity('Destaque removida', { removed: true });
    const refusals = [
      await addItem(tokens.demoAdmin, randomUUID(), storyId),
      await addItem(tokens.demoAdmin, target.id, randomUUID()),
      await createHighlight(tokens.demoAdmin, { communityId: removed, title: 'Teste Removida' }),
    ];
    const texts: string[] = [];
    for (const res of refusals) {
      expect(res.status).toBe(404);
      const text = await res.text();
      const body = JSON.parse(text) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(Object.hasOwn(body.error, 'details')).toBe(false);
      texts.push(withoutRequestId(text));
    }
    expect(new Set(texts).size).toBe(1);
    const [removedRows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.story_highlights where community_id = ${removed}::uuid`;
    expect(removedRows?.n).toBe(0);

    // Positive control IN THE SAME TEST: an ACTIVE community of this tenant creates, so the 404
    // above is about the removed row, not a community branch that refuses everything.
    const active = await makeHighlightCommunity('Destaque ativa');
    const placed = await create(tokens.demoAdmin, { communityId: active, title: 'Teste Ativa' });
    expect(placed.communityId).toBe(active);
    expect(placed.position).toBe(0);
  });

  it('05.2-5 an ARCHIVED community refuses a new highlight with `archived` — and writes nothing', async () => {
    const archived = await makeHighlightCommunity('Destaque arquivada', { status: 'archived' });
    const res = await createHighlight(tokens.demoAdmin, {
      communityId: archived,
      title: 'Teste Arquivo',
    });
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual({ highlight: 'archived' });

    const [rows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.story_highlights where title = 'Teste Arquivo'`;
    expect(rows?.n).toBe(0);
  });

  it('05.2-6 D-100: one story sits in an Início highlight AND a community highlight', async () => {
    const community = await makeHighlightCommunity('Destaque dupla');
    const home = await create(tokens.demoAdmin, { title: 'Teste Casa' });
    const place = await create(tokens.demoAdmin, { communityId: community, title: 'Teste Lugar' });
    const { storyId } = await publishImage('duas casas');

    const first = await addItem(tokens.demoAdmin, home.id, storyId);
    expect(first.status).toBe(200);
    expect(highlightMembershipResultSchema.parse(await first.json())).toEqual({
      highlighted: true,
      highlightCount: 1,
    });

    const second = await addItem(tokens.demoAdmin, place.id, storyId);
    expect(second.status).toBe(200);
    expect(highlightMembershipResultSchema.parse(await second.json())).toEqual({
      highlighted: true,
      highlightCount: 2,
    });

    // Two rows, never merged — and BOTH reads list the story.
    expect(await itemRows(home.id, storyId)).toBe(1);
    expect(await itemRows(place.id, storyId)).toBe(1);
    for (const highlight of [home, place]) {
      const res = await hlRequest(tokens.demoMember, `/${highlight.id}`);
      expect(res.status).toBe(200);
      const detail = highlightDetailSchema.parse(await res.json());
      expect(detail.items.map((story) => story.id)).toContain(storyId);
    }
    const communityRow = await row(tokens.demoMember, `?communityId=${community}`);
    expect(communityRow.map((item) => item.id)).toEqual([place.id]);
  });

  it('05.2-7 the SEED is the fixture: Bastidores for members, Aulas for the curator, a community Destaques keeps the expired story', async () => {
    // Início, as a member: the seeded `Bastidores` (it holds live stories) and never `Aulas` (the
    // seeded EMPTY highlight, D-102).
    const memberHome = await row(tokens.demoMember);
    const memberTitles = memberHome.map((item) => item.title);
    expect(memberTitles).toContain('Bastidores');
    expect(memberTitles).not.toContain('Aulas');

    // Início, as the curator with `scope=all`: both, in POSITION order (R-D-C).
    const curatorHome = (await row(tokens.demoAdmin, '?scope=all')).filter((item) =>
      ['Bastidores', 'Aulas'].includes(item.title),
    );
    expect(curatorHome.map((item) => [item.title, item.position])).toEqual([
      ['Bastidores', 0],
      ['Aulas', 1],
    ]);
    expect(curatorHome.find((item) => item.title === 'Aulas')?.itemCount).toBe(0);

    // The seeded community carries `Destaques` — the state migration file 1's backfill produced for
    // Phase 5's seeded pins (the pin model retired in 05.2-11) — and its items include the seeded
    // EXPIRED story, playable.
    const [seeded] = await adminSql<{ community_id: string }[]>`
      select community_id::text from public.story_highlights
       where tenant_id = ${tenantIds.demo}::uuid and community_id is not null
         and title = 'Destaques'`;
    const destaquesCommunity = seeded?.community_id ?? '';
    expect(destaquesCommunity).not.toBe('');
    const communityRow = await row(tokens.demoMember, `?communityId=${destaquesCommunity}`);
    const destaques = communityRow.find((item) => item.title === 'Destaques');
    expect(destaques).toBeDefined();

    const res = await hlRequest(tokens.demoMember, `/${destaques?.id}`);
    expect(res.status).toBe(200);
    const detail = highlightDetailSchema.parse(await res.json());
    const expired = detail.items.find((story) => story.caption === SEEDED_EXPIRED_CAPTION);
    expect(expired).toBeDefined();
    expect(expired?.isActive).toBe(false);

    // …and exactly two stories, one expired and one active (the seed's contrast, D-79): a read
    // returning every story of the tenant could not satisfy this.
    expect(detail.items.map((story) => story.isActive).sort()).toEqual([false, true]);
  });
  /* ── 05.2-03: rename, re-cover, delete, remove (HIGHLIGHT-01/02, D-101, R-D-F, R-D-L) ─────────── */

  beforeAll(() => {
    for (const name of [
      'highlight.updated',
      'highlight.deleted',
      'highlight.reordered',
      'story.unhighlighted',
      // 05.2-08: the publish path's three, so one log carries their order.
      'story.published',
      'highlight.created',
      'story.highlighted',
    ] as const) {
      curationOffs.push(
        subscribe(name, async (payload) => {
          curationEvents.push({ name, payload: payload as unknown as Record<string, unknown> });
        }),
      );
    }
  });

  const patchHighlight = (token: string, highlightId: string, body: unknown) =>
    hlRequest(token, `/${highlightId}`, { method: 'PATCH', body: JSON.stringify(body) });

  const deleteHighlightReq = (token: string, highlightId: string) =>
    hlRequest(token, `/${highlightId}`, { method: 'DELETE' });

  const removeItem = (token: string, highlightId: string, storyId: string) =>
    hlRequest(token, `/${highlightId}/stories/${storyId}`, { method: 'DELETE' });

  /** The CURATOR's view of one highlight in its place's row (`scope=all` includes empty ones). */
  async function curated(highlightId: string, communityId?: string): Promise<HighlightSummary> {
    const query = communityId ? `?scope=all&communityId=${communityId}` : '?scope=all';
    const found = (await row(tokens.demoAdmin, query)).find((item) => item.id === highlightId);
    expect(found, `highlight ${highlightId} in the curator row`).toBeDefined();
    return found as HighlightSummary;
  }

  /** A ready VIDEO story of the demo tenant, published through the API. */
  async function publishVideo(label: string): Promise<{ storyId: string; assetId: string }> {
    const assetId = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@rede-demo.local',
      kind: 'video',
      providerAssetId: `fake-${randomUUID()}`,
    });
    const res = await publish(tokens.demoAdmin, {
      mediaAssetId: assetId,
      mediaKind: 'video',
      caption: `${TEST_CAPTION_PREFIX} — ${label}`,
    });
    expect(res.status).toBe(201);
    const storyId = ((await res.json()) as StorySummary).id;
    created.push(storyId);
    return { storyId, assetId };
  }

  /** The stored cover columns, read past the API — what the read-time rule is computed FROM. */
  async function storedCover(highlightId: string) {
    const [stored] = await adminSql<
      { cover_story_id: string | null; cover_asset_id: string | null }[]
    >`
      select cover_story_id::text, cover_asset_id::text from public.story_highlights
       where id = ${highlightId}::uuid`;
    return stored;
  }

  /** Every bare-404 body must be identical once the per-call `requestId` is stripped (D-23). */
  async function expectBare404s(responses: Response[]): Promise<void> {
    const texts: string[] = [];
    for (const res of responses) {
      expect(res.status).toBe(404);
      const text = await res.text();
      const body = JSON.parse(text) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(Object.hasOwn(body.error, 'details')).toBe(false);
      texts.push(withoutRequestId(text));
    }
    expect(new Set(texts).size).toBe(1);
  }

  it('05.2-8 rename: a PATCH title answers the new summary; empty is `title_invalid`, `{}` is VALIDATION_FAILED', async () => {
    const highlight = await create(tokens.demoAdmin, { title: 'Teste Renomear' });
    const before = eventsNamed('highlight.updated').length;

    const res = await patchHighlight(tokens.demoAdmin, highlight.id, {
      title: ' Teste Novo nome ',
    });
    expect(res.status).toBe(200);
    const summary = highlightSummarySchema.parse(await res.json());
    expect(summary.id).toBe(highlight.id);
    expect(summary.title).toBe('Teste Novo nome');
    expect(summary.position).toBe(highlight.position);
    expect(eventsNamed('highlight.updated')).toHaveLength(before + 1);
    expect(Object.keys(eventsNamed('highlight.updated').at(-1)?.payload ?? {}).sort()).toEqual([
      'actorUserId',
      'highlightId',
      'tenantId',
    ]);

    // The SAME title again: a 200 with the same summary, and no second announcement.
    const repeat = await patchHighlight(tokens.demoAdmin, highlight.id, {
      title: 'Teste Novo nome',
    });
    expect(repeat.status).toBe(200);
    expect(highlightSummarySchema.parse(await repeat.json()).title).toBe('Teste Novo nome');
    expect(eventsNamed('highlight.updated')).toHaveLength(before + 1);

    const empty = await patchHighlight(tokens.demoAdmin, highlight.id, { title: '   ' });
    expect(empty.status).toBe(400);
    expect((await envelope(empty)).error.details).toEqual({ highlight: 'title_invalid' });

    const nothing = await patchHighlight(tokens.demoAdmin, highlight.id, {});
    expect(nothing.status).toBe(400);
    const nothingBody = await envelope(nothing);
    expect(nothingBody.error.code).toBe('VALIDATION_FAILED');
    expect(nothingBody.error.details).not.toHaveProperty('highlight');

    // Refusals wrote nothing: the stored title is the renamed one.
    expect((await curated(highlight.id)).title).toBe('Teste Novo nome');
  });

  it('05.2-9 cover by story: image-only (D-101), a video or a foreign story is the bare 404, removing the chosen story clears it', async () => {
    const highlight = await create(tokens.demoAdmin, { title: 'Teste Capa' });
    const video = await publishVideo('capa em video');
    expect((await addItem(tokens.demoAdmin, highlight.id, video.storyId)).status).toBe(200);

    // The recorded image-only scope: an all-video highlight resolves NO automatic cover.
    const allVideo = await curated(highlight.id);
    expect(allVideo.itemCount).toBe(1);
    expect(allVideo.coverAssetId).toBeNull();
    expect(allVideo.coverChosen).toBe(false);

    const image = await publishImage('capa escolhida');
    expect((await addItem(tokens.demoAdmin, highlight.id, image.storyId)).status).toBe(200);

    const chosen = await patchHighlight(tokens.demoAdmin, highlight.id, {
      cover: { storyId: image.storyId },
    });
    expect(chosen.status).toBe(200);
    const chosenBody = highlightSummarySchema.parse(await chosen.json());
    expect(chosenBody.coverChosen).toBe(true);
    expect(chosenBody.coverStoryId).toBe(image.storyId);
    expect(chosenBody.coverAssetId).toBe(image.assetId);

    // A VIDEO item of this highlight, and an image story that is NOT in it: one bare 404 each.
    const outsider = await publishImage('capa de fora');
    await expectBare404s([
      await patchHighlight(tokens.demoAdmin, highlight.id, { cover: { storyId: video.storyId } }),
      await patchHighlight(tokens.demoAdmin, highlight.id, {
        cover: { storyId: outsider.storyId },
      }),
    ]);
    expect((await storedCover(highlight.id))?.cover_story_id).toBe(image.storyId);

    // Removing the chosen story clears the pointer IN THE SAME TRANSACTION (no stale resurrect).
    const removed = await removeItem(tokens.demoAdmin, highlight.id, image.storyId);
    expect(removed.status).toBe(200);
    expect(highlightMembershipResultSchema.parse(await removed.json())).toEqual({
      highlighted: false,
      highlightCount: 0,
    });
    const after = await curated(highlight.id);
    expect(after.coverChosen).toBe(false);
    expect(after.coverStoryId).toBeNull();
    expect((await storedCover(highlight.id))?.cover_story_id).toBeNull();
  });

  it('05.2-10 cover by upload: only a ready cover image of THIS tenant; every other asset is the same bare 404; the old asset survives', async () => {
    const highlight = await create(tokens.demoAdmin, { title: 'Teste Upload' });
    const cover = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@rede-demo.local',
      purpose: 'cover',
    });

    const set = await patchHighlight(tokens.demoAdmin, highlight.id, { cover: { assetId: cover } });
    expect(set.status).toBe(200);
    const setBody = highlightSummarySchema.parse(await set.json());
    expect(setBody.coverChosen).toBe(true);
    expect(setBody.coverAssetId).toBe(cover);
    expect(setBody.coverStoryId).toBeNull();

    // T-05.2-12: a story-purpose asset, a processing cover and ANOTHER tenant's cover — one answer.
    const storyPurpose = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@rede-demo.local',
    });
    const processing = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@rede-demo.local',
      purpose: 'cover',
      status: 'processing',
    });
    const foreign = await makeAsset({
      tenantId: tenantIds.lab,
      email: 'admin@rede-lab.local',
      purpose: 'cover',
    });
    await expectBare404s([
      await patchHighlight(tokens.demoAdmin, highlight.id, { cover: { assetId: storyPurpose } }),
      await patchHighlight(tokens.demoAdmin, highlight.id, { cover: { assetId: processing } }),
      await patchHighlight(tokens.demoAdmin, highlight.id, { cover: { assetId: foreign } }),
    ]);
    expect((await storedCover(highlight.id))?.cover_asset_id).toBe(cover);

    // Replacing the cover never retires the old asset.
    const replacement = await makeAsset({
      tenantId: tenantIds.demo,
      email: 'admin@rede-demo.local',
      purpose: 'cover',
    });
    const replaced = await patchHighlight(tokens.demoAdmin, highlight.id, {
      cover: { assetId: replacement },
    });
    expect(replaced.status).toBe(200);
    expect(highlightSummarySchema.parse(await replaced.json()).coverAssetId).toBe(replacement);
    const [old] = await adminSql<{ status: string; deleted_at: string | null }[]>`
      select status, deleted_at::text from public.media_assets where id = ${cover}::uuid`;
    expect(old).toEqual({ status: 'ready', deleted_at: null });

    // `null` returns the highlight to the automatic rule (no items here, so no cover at all).
    const cleared = await patchHighlight(tokens.demoAdmin, highlight.id, { cover: null });
    expect(cleared.status).toBe(200);
    const clearedBody = highlightSummarySchema.parse(await cleared.json());
    expect(clearedBody.coverChosen).toBe(false);
    expect(clearedBody.coverAssetId).toBeNull();
    expect(await storedCover(highlight.id)).toEqual({ cover_story_id: null, cover_asset_id: null });
  });

  it('05.2-11 delete: 204, the items go, the STORY and its likes survive (R-D-F); a second delete is the bare 404', async () => {
    const highlight = await create(tokens.demoAdmin, { title: 'Teste Apagar' });
    const { storyId } = await publishImage('apagar destaque');
    expect((await addItem(tokens.demoAdmin, highlight.id, storyId)).status).toBe(200);
    const liked = await request(`/v1/stories/${storyId}/likes`, tokens.demoMember, {
      method: 'POST',
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(liked.status).toBe(200);
    const deletedBefore = eventsNamed('highlight.deleted').length;

    const res = await deleteHighlightReq(tokens.demoAdmin, highlight.id);
    expect(res.status).toBe(204);
    expect(await itemRows(highlight.id, storyId)).toBe(0);
    expect(eventsNamed('highlight.deleted')).toHaveLength(deletedBefore + 1);
    expect(eventsNamed('highlight.deleted').at(-1)?.payload).toMatchObject({
      highlightId: highlight.id,
      communityId: null,
    });

    const [story] = await adminSql<{ deleted_at: string | null; like_count: number }[]>`
      select deleted_at::text, like_count from public.stories where id = ${storyId}::uuid`;
    expect(story).toEqual({ deleted_at: null, like_count: 1 });
    const [likes] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes where story_id = ${storyId}::uuid`;
    expect(likes?.n).toBe(1);

    // Idempotent-by-404 (the `deleteStory` rule): "already deleted" never confirms an id existed.
    const again = await deleteHighlightReq(tokens.demoAdmin, highlight.id);
    expect(again.status).toBe(404);
    expect((await envelope(again)).error.details).toBeUndefined();
    expect(eventsNamed('highlight.deleted')).toHaveLength(deletedBefore + 1);
  });

  it('05.2-12 an ARCHIVED community refuses rename and re-cover with `archived` but still allows take-downs', async () => {
    const community = await makeHighlightCommunity('Destaque arquivavel');
    const highlight = await create(tokens.demoAdmin, {
      communityId: community,
      title: 'Teste Arquivar',
    });
    const { storyId } = await publishImage('arquivar destaque');
    expect((await addItem(tokens.demoAdmin, highlight.id, storyId)).status).toBe(200);

    await adminSql`update public.communities set status = 'archived' where id = ${community}::uuid`;

    for (const body of [{ title: 'Teste Outro' }, { cover: { storyId } }]) {
      const res = await patchHighlight(tokens.demoAdmin, highlight.id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await envelope(res)).error.details).toEqual({ highlight: 'archived' });
    }
    expect((await storedCover(highlight.id))?.cover_story_id).toBeNull();

    const unhighlightedBefore = eventsNamed('story.unhighlighted').length;
    const removed = await removeItem(tokens.demoAdmin, highlight.id, storyId);
    expect(removed.status).toBe(200);
    expect(highlightMembershipResultSchema.parse(await removed.json())).toEqual({
      highlighted: false,
      highlightCount: 0,
    });
    expect(eventsNamed('story.unhighlighted')).toHaveLength(unhighlightedBefore + 1);

    // A repeat removal: the same 200 body, and no second announcement (transitions, not requests).
    const repeat = await removeItem(tokens.demoAdmin, highlight.id, storyId);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({ highlighted: false, highlightCount: 0 });
    expect(eventsNamed('story.unhighlighted')).toHaveLength(unhighlightedBefore + 1);

    // The highlight is KEPT with no stories (D-102) until the admin deletes it — which is allowed.
    expect(
      (await adminSql`select 1 from public.story_highlights where id = ${highlight.id}::uuid`)
        .length,
    ).toBe(1);
    expect((await deleteHighlightReq(tokens.demoAdmin, highlight.id)).status).toBe(204);
  });

  it('05.2-13 a member is refused 403 on PATCH, DELETE and remove — and nothing moves', async () => {
    const highlight = await create(tokens.demoAdmin, { title: 'Teste Proibido' });
    const { storyId } = await publishImage('membro proibido');
    expect((await addItem(tokens.demoAdmin, highlight.id, storyId)).status).toBe(200);

    for (const res of [
      await patchHighlight(tokens.demoMember, highlight.id, { title: 'Teste Membro' }),
      await deleteHighlightReq(tokens.demoMember, highlight.id),
      await removeItem(tokens.demoMember, highlight.id, storyId),
    ]) {
      expect(res.status).toBe(403);
    }

    expect(await itemRows(highlight.id, storyId)).toBe(1);
    expect((await curated(highlight.id)).title).toBe('Teste Proibido');
  });
  /* ── 05.2-03: reorder, the sheet's two reads, highlightCount, communities off (R-D-C, D-110) ──── */

  const reorder = (token: string, body: Record<string, unknown>) =>
    hlRequest(token, '/order', { method: 'PUT', body: JSON.stringify(body) });

  /** One place's curator row as `[id, position]` pairs, in the server's order. */
  async function positions(communityId?: string): Promise<[string, number][]> {
    const query = communityId ? `?scope=all&communityId=${communityId}` : '?scope=all';
    return (await row(tokens.demoAdmin, query)).map((item) => [item.id, item.position]);
  }

  it('05.2-14 reorder: the FULL permutation renumbers densely in one write; an equal order is inert; any other set is `order_stale`', async () => {
    // A fresh community place holds exactly A, B, C, so the dense positions are literally 0, 1, 2.
    const community = await makeHighlightCommunity('Destaque ordem');
    const a = await create(tokens.demoAdmin, { communityId: community, title: 'Teste A' });
    const b = await create(tokens.demoAdmin, { communityId: community, title: 'Teste B' });
    const c = await create(tokens.demoAdmin, { communityId: community, title: 'Teste C' });
    const before = eventsNamed('highlight.reordered').length;

    const res = await reorder(tokens.demoAdmin, {
      communityId: community,
      highlightIds: [c.id, a.id, b.id],
    });
    expect(res.status).toBe(200);
    const body = highlightListSchema.parse(await res.json());
    expect(body.items.map((item) => [item.id, item.position])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
    expect(eventsNamed('highlight.reordered')).toHaveLength(before + 1);
    const event = eventsNamed('highlight.reordered').at(-1)?.payload ?? {};
    expect(Object.keys(event).sort()).toEqual(['actorUserId', 'communityId', 'tenantId']);
    expect(event.communityId).toBe(community);

    // The SAME permutation again: 200, nothing moved, nothing announced.
    const again = await reorder(tokens.demoAdmin, {
      communityId: community,
      highlightIds: [c.id, a.id, b.id],
    });
    expect(again.status).toBe(200);
    expect(eventsNamed('highlight.reordered')).toHaveLength(before + 1);

    // Stale sets: missing, duplicated, and one naming the LAB tenant's seeded highlight. Each is the
    // one code, and none moves a position.
    const [lab] = await adminSql<{ id: string }[]>`
      select id::text from public.story_highlights
       where tenant_id = ${tenantIds.lab}::uuid limit 1`;
    expect(lab?.id ?? '').not.toBe('');
    const snapshot = await positions(community);
    for (const highlightIds of [
      [c.id, a.id],
      [c.id, a.id, b.id, b.id],
      [c.id, a.id, lab?.id],
    ]) {
      const stale = await reorder(tokens.demoAdmin, { communityId: community, highlightIds });
      expect(stale.status, JSON.stringify(highlightIds)).toBe(400);
      expect((await envelope(stale)).error.details).toEqual({ highlight: 'order_stale' });
    }
    expect(await positions(community)).toEqual(snapshot);
    expect(eventsNamed('highlight.reordered')).toHaveLength(before + 1);

    // Início is a place too: the full set with three new ones moved to the end. The seeded
    // `Bastidores` / `Aulas` keep positions 0 and 1 because they stay first in the permutation.
    const x = await create(tokens.demoAdmin, { title: 'Teste X' });
    const y = await create(tokens.demoAdmin, { title: 'Teste Y' });
    const z = await create(tokens.demoAdmin, { title: 'Teste Z' });
    const current = (await positions()).map(([id]) => id);
    const others = current.filter((id) => ![x.id, y.id, z.id].includes(id));
    const order = [...others, z.id, x.id, y.id];
    const home = await reorder(tokens.demoAdmin, { highlightIds: order });
    expect(home.status).toBe(200);
    const homeBody = highlightListSchema.parse(await home.json());
    expect(homeBody.items.map((item) => item.id)).toEqual(order);
    expect(homeBody.items.map((item) => item.position)).toEqual(order.map((_, index) => index));
    expect(
      homeBody.items
        .filter((item) => ['Bastidores', 'Aulas'].includes(item.title))
        .map((item) => [item.title, item.position]),
    ).toEqual([
      ['Bastidores', 0],
      ['Aulas', 1],
    ]);

    // A member cannot reorder.
    expect((await reorder(tokens.demoMember, { highlightIds: order })).status).toBe(403);
  });

  it('05.2-15 catalog: Início first, then each ACTIVE community in position order; never an archived one; manage-only', async () => {
    const active = await makeHighlightCommunity('Destaque catalogo');
    const inActive = await create(tokens.demoAdmin, {
      communityId: active,
      title: 'Teste Catalogo',
    });
    const archived = await makeHighlightCommunity('Destaque catalogo arq');
    const inArchived = await create(tokens.demoAdmin, {
      communityId: archived,
      title: 'Teste Arquivo C',
    });
    await adminSql`update public.communities set status = 'archived' where id = ${archived}::uuid`;

    const res = await hlRequest(tokens.demoAdmin, '/catalog');
    expect(res.status).toBe(200);
    const items = highlightListSchema.parse(await res.json()).items;
    const ids = items.map((item) => item.id);
    expect(ids).toContain(inActive.id);
    expect(ids).not.toContain(inArchived.id);
    // The curator's catalogue includes EMPTY highlights (the seeded `Aulas`).
    expect(items.some((item) => item.title === 'Aulas' && item.itemCount === 0)).toBe(true);

    // Início first, then `community_id, position, id` — a total order.
    const firstCommunity = items.findIndex((item) => item.communityId !== null);
    expect(firstCommunity).toBeGreaterThan(0);
    expect(items.slice(0, firstCommunity).every((item) => item.communityId === null)).toBe(true);
    expect(items.slice(firstCommunity).every((item) => item.communityId !== null)).toBe(true);
    const key = (item: HighlightSummary) =>
      [item.communityId ?? '', String(item.position).padStart(6, '0'), item.id].join('|');
    const communityKeys = items.slice(firstCommunity).map(key);
    expect(communityKeys).toEqual([...communityKeys].sort());
    const homePositions = items.slice(0, firstCommunity).map((item) => item.position);
    expect(homePositions).toEqual([...homePositions].sort((l, r) => l - r));

    expect((await hlRequest(tokens.demoMember, '/catalog')).status).toBe(403);
  });

  /** The story 05.2-16 puts in two highlights; 05.2-17 reads its count. */
  let twoHomes = '';

  it('05.2-16 memberships: a story in two highlights reads exactly those two ids; manage-only; an unknown story is the bare 404', async () => {
    const first = await create(tokens.demoAdmin, { title: 'Teste Dupla A' });
    const second = await create(tokens.demoAdmin, { title: 'Teste Dupla B' });
    const { storyId } = await publishImage('duas memberships');
    twoHomes = storyId;
    expect((await addItem(tokens.demoAdmin, first.id, storyId)).status).toBe(200);
    expect((await addItem(tokens.demoAdmin, second.id, storyId)).status).toBe(200);

    const read = (token: string, id: string) =>
      request(`/v1/stories/${id}/highlights`, token, { headers: { 'x-tenant-host': HOSTS.demo } });

    const res = await read(tokens.demoAdmin, storyId);
    expect(res.status).toBe(200);
    const body = storyHighlightIdsSchema.parse(await res.json());
    expect(body.highlightIds).toEqual([first.id, second.id]);

    expect((await read(tokens.demoMember, storyId)).status).toBe(403);
    const unknown = await read(tokens.demoAdmin, randomUUID());
    expect(unknown.status).toBe(404);
    expect((await envelope(unknown)).error.details).toBeUndefined();
  });

  it('05.2-17 highlightCount rides every story projection: the detail read and the admin history', async () => {
    expect(twoHomes).not.toBe('');
    const detail = await request(`/v1/stories/${twoHomes}`, tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as StorySummary).highlightCount).toBe(2);

    const mine = await walk(tokens.demoAdmin, '/v1/stories/mine', STORY_MAX_PAGE_SIZE);
    expect(mine.find((story) => story.id === twoHomes)?.highlightCount).toBe(2);
    // A story in no highlight reads 0, never null.
    expect(mine.every((story) => Number.isInteger(story.highlightCount))).toBe(true);
  });

  it('05.2-18 communities OFF: every community highlight route is the bare 404, Início keeps answering, and the rows come back intact', async () => {
    const community = await makeHighlightCommunity('Destaque desligada');
    const placed = await create(tokens.demoAdmin, {
      communityId: community,
      title: 'Teste Desliga',
    });
    const { storyId } = await publishImage('comunidade desligada');
    expect((await addItem(tokens.demoAdmin, placed.id, storyId)).status).toBe(200);

    const flipped = await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${tenantIds.demo}::uuid and module_key = 'communities'`;
    expect(flipped.count).toBe(1);
    moduleFlags.invalidate(tenantIds.demo);
    try {
      await expectBare404s([
        await hlRequest(tokens.demoMember, `?communityId=${community}`),
        await hlRequest(tokens.demoAdmin, `?scope=all&communityId=${community}`),
        await createHighlight(tokens.demoAdmin, { communityId: community, title: 'Teste Fora' }),
        await hlRequest(tokens.demoMember, `/${placed.id}`),
        await patchHighlight(tokens.demoAdmin, placed.id, { title: 'Teste Outro' }),
        await deleteHighlightReq(tokens.demoAdmin, placed.id),
        await removeItem(tokens.demoAdmin, placed.id, storyId),
        await addItem(tokens.demoAdmin, placed.id, storyId),
        await reorder(tokens.demoAdmin, { communityId: community, highlightIds: [placed.id] }),
      ]);

      // Início is untouched by the flag.
      expect((await hlRequest(tokens.demoMember, '')).status).toBe(200);
      const catalog = await hlRequest(tokens.demoAdmin, '/catalog');
      expect(catalog.status).toBe(200);
      const items = highlightListSchema.parse(await catalog.json()).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.communityId === null)).toBe(true);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${tenantIds.demo}::uuid and module_key = 'communities'`;
      moduleFlags.invalidate(tenantIds.demo);
    }

    // Back ON: the same highlight answers 200 with its rows intact — the flag never touched them.
    const back = await row(tokens.demoAdmin, `?scope=all&communityId=${community}`);
    expect(back.map((item) => [item.id, item.title, item.itemCount])).toEqual([
      [placed.id, 'Teste Desliga', 1],
    ]);
    expect(await itemRows(placed.id, storyId)).toBe(1);
  });

  /* ── 05.2-08: a story born INSIDE a highlight (D-111..D-115, D-99's one write carried) ────────── */

  /**
   * The publish path's events, in the ONE ordered log the block's hook fills, so a case can assert
   * the ORDER across names (`story.published`, then `highlight.created`, then `story.highlighted`).
   */
  const PUBLISH_EVENTS = new Set(['story.published', 'highlight.created', 'story.highlighted']);
  const publishEventsSince = (before: number) =>
    curationEvents.slice(before).filter((event) => PUBLISH_EVENTS.has(event.name));

  /** "No story row" is measured against THIS case's caption (unique per case), never the table. */
  async function captionCount(caption: string): Promise<number> {
    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.stories where caption = ${caption}`;
    return rows[0]?.n ?? 0;
  }

  /** The item row of one pair, with the columns the born ≡ added invariant compares. */
  async function itemRow(highlightId: string, storyId: string) {
    const rows = await adminSql<{ tenant_id: string; added_by_user_id: string }[]>`
      select tenant_id::text, added_by_user_id::text from public.story_highlight_items
       where highlight_id = ${highlightId}::uuid and story_id = ${storyId}::uuid`;
    return rows;
  }

  /** A publish into a destination, remembered for the sweep when it answers 201. */
  async function publishInto(
    label: string,
    destination: Record<string, unknown>,
    token = tokens.demoAdmin,
  ): Promise<{ res: Response; caption: string }> {
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@rede-demo.local' });
    const caption = `${TEST_CAPTION_PREFIX} — ${label} ${randomUUID()}`;
    const res = await publish(token, {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption,
      ...destination,
    });
    return { res, caption };
  }

  it('05.2-19 a story published with an Início `highlightId` is born inside it: 201, count 1, in the highlight AND the strip, published + highlighted', async () => {
    const highlight = await create(tokens.demoAdmin, { title: 'Teste Nasce' });

    const before = curationEvents.length;
    const { res } = await publishInto('nasce no destaque', { highlightId: highlight.id });
    expect(res.status).toBe(201);
    const story = (await res.json()) as StorySummary;
    created.push(story.id);
    expect(story.highlightCount).toBe(1);

    const detailRes = await hlRequest(tokens.demoMember, `/${highlight.id}`);
    expect(detailRes.status).toBe(200);
    const detail = highlightDetailSchema.parse(await detailRes.json());
    expect(detail.items.map((item) => item.id)).toContain(story.id);

    // D-111 / D-96: a story born in a highlight is in Início's tenant circle for its 24 h.
    const strip = await walk(tokens.demoMember, '/v1/stories', STORY_MAX_PAGE_SIZE);
    expect(strip.some((item) => item.id === story.id)).toBe(true);

    const log = publishEventsSince(before);
    expect(log.map((entry) => entry.name)).toEqual(['story.published', 'story.highlighted']);
    expect(Object.keys(log[0]?.payload ?? {}).sort()).toEqual([
      'authorUserId',
      'expiresAt',
      'mediaKind',
      'storyId',
      'tenantId',
    ]);
    expect(Object.keys(log[1]?.payload ?? {}).sort()).toEqual([
      'actorUserId',
      'highlightId',
      'storyId',
      'tenantId',
    ]);
    expect(log[1]?.payload).toMatchObject({ storyId: story.id, highlightId: highlight.id });
  });

  it('05.2-20 `newHighlight` creates the highlight at the END of its community row in the SAME write: published, created, highlighted', async () => {
    const community = await makeHighlightCommunity('Destaque inline');
    const existing = await create(tokens.demoAdmin, {
      communityId: community,
      title: 'Teste Antes',
    });

    const before = curationEvents.length;
    const { res } = await publishInto('destaque inline', {
      newHighlight: { communityId: community, title: '  Teste Inline  ' },
    });
    expect(res.status).toBe(201);
    const story = (await res.json()) as StorySummary;
    created.push(story.id);
    expect(story.highlightCount).toBe(1);

    const placeRow = await row(tokens.demoAdmin, `?scope=all&communityId=${community}`);
    expect(placeRow.map((item) => item.title)).toEqual(['Teste Antes', 'Teste Inline']);
    const inline = placeRow[1] as HighlightSummary;
    createdHighlights.push(inline.id);
    expect(inline.position).toBeGreaterThan(existing.position);
    expect(inline.itemCount).toBe(1);
    expect(await itemRows(inline.id, story.id)).toBe(1);

    const log = publishEventsSince(before);
    expect(log.map((entry) => entry.name)).toEqual([
      'story.published',
      'highlight.created',
      'story.highlighted',
    ]);
    expect(log[1]?.payload).toMatchObject({ highlightId: inline.id, communityId: community });
    expect(Object.keys(log[1]?.payload ?? {}).sort()).toEqual([
      'actorUserId',
      'communityId',
      'highlightId',
      'tenantId',
    ]);
    expect(log[2]?.payload).toMatchObject({ storyId: story.id, highlightId: inline.id });
    // The curator's words never ride an event (T-05.2-37).
    expect(JSON.stringify(log)).not.toContain('Teste Inline');
  });

  it('05.2-21 every refusal writes NOTHING: archived, title_invalid, both destinations, and ONE bare 404 for every miss', async () => {
    const archivedCommunity = await makeHighlightCommunity('Destaque arquiva');
    const inArchived = await create(tokens.demoAdmin, {
      communityId: archivedCommunity,
      title: 'Teste Arquiva',
    });
    await adminSql`
      update public.communities set status = 'archived' where id = ${archivedCommunity}::uuid`;
    const home = await create(tokens.demoAdmin, { title: 'Teste Recusa' });

    // Another tenant's highlight and community: the lab tenant has stories ON for this file.
    const labRes = await createHighlight(tokens.labAdmin, { title: 'Teste Lab' }, HOSTS.lab);
    expect(labRes.status).toBe(201);
    const labHighlight = highlightSummarySchema.parse(await labRes.json());
    createdHighlights.push(labHighlight.id);
    const labCommunity = randomUUID();
    highlightCommunities.push(labCommunity);
    await adminSql`
      insert into public.communities (id, tenant_id, created_by_user_id, name, slug, status)
      select ${labCommunity}::uuid, ${tenantIds.lab}::uuid, m.user_id, 'Lab destaque', ${labCommunity}, 'active'
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenantIds.lab}::uuid and u.email = 'admin@rede-lab.local'
       limit 1`;

    const before = curationEvents.length;
    const refusals: [string, Record<string, unknown>, number, Record<string, unknown> | null][] = [
      ['archived highlight', { highlightId: inArchived.id }, 400, { highlight: 'archived' }],
      [
        'archived inline',
        { newHighlight: { communityId: archivedCommunity, title: 'Teste Novo' } },
        400,
        { highlight: 'archived' },
      ],
      [
        'long title',
        { newHighlight: { communityId: null, title: 'x'.repeat(16) } },
        400,
        { highlight: 'title_invalid' },
      ],
    ];
    for (const [label, destination, status, details] of refusals) {
      const { res, caption } = await publishInto(label, destination);
      expect(res.status, label).toBe(status);
      const body = await envelope(res);
      expect(body.error.code, label).toBe('VALIDATION_FAILED');
      expect(body.error.details, label).toEqual(details);
      expect(await captionCount(caption), label).toBe(0);
    }

    // Both destinations at once: the contract refuses the shape, never picks one.
    const both = await publishInto('dois destinos', {
      highlightId: home.id,
      newHighlight: { communityId: null, title: 'Teste Dois' },
    });
    expect(both.res.status).toBe(400);
    expect((await envelope(both.res)).error.code).toBe('VALIDATION_FAILED');
    expect(await captionCount(both.caption)).toBe(0);

    const misses: Response[] = [];
    for (const destination of [
      { highlightId: randomUUID() },
      { highlightId: labHighlight.id },
      { newHighlight: { communityId: labCommunity, title: 'Teste Fora' } },
      { newHighlight: { communityId: randomUUID(), title: 'Teste Fora' } },
    ]) {
      const { res, caption } = await publishInto('destino invisivel', destination);
      misses.push(res);
      expect(await captionCount(caption)).toBe(0);
    }
    await expectBare404s(misses);

    // Nothing was announced by any refusal, and nothing was created in either place.
    expect(publishEventsSince(before)).toHaveLength(0);
    const archivedRow = await row(tokens.demoAdmin, `?scope=all&communityId=${archivedCommunity}`);
    expect(archivedRow.map((item) => item.id)).toEqual([inArchived.id]);
    expect((await curated(home.id)).itemCount).toBe(0);
  });

  it('05.2-22 a publish-ONLY caller cannot curate through publish (403 before any lookup), and still publishes with no destination', async () => {
    const home = await create(tokens.demoAdmin, { title: 'Teste Gestao' });

    setPermissionResolver((role, enabled, settings) => {
      const granted = permissionsFor(role, enabled, settings);
      return role === 'admin_tenant'
        ? granted.filter((permission) => permission !== 'stories.story.manage')
        : granted;
    });
    try {
      for (const destination of [
        { highlightId: home.id },
        { highlightId: randomUUID() },
        { newHighlight: { communityId: null, title: 'Teste Proibido' } },
      ]) {
        const { res, caption } = await publishInto('sem manage', destination);
        expect(res.status).toBe(403);
        expect((await envelope(res)).error.code).toBe('FORBIDDEN');
        expect(await captionCount(caption)).toBe(0);
      }

      // Positive control under the SAME resolver: publishing itself is untouched.
      const { res } = await publishInto('sem manage, sem destino', {});
      expect(res.status).toBe(201);
      created.push(((await res.json()) as StorySummary).id);
    } finally {
      setPermissionResolver(permissionsFor);
    }

    // Read with the manage half restored (the curator read is itself manage-only): nothing moved.
    expect((await curated(home.id)).itemCount).toBe(0);
  });

  it('05.2-23 THE INVARIANT: born in a highlight ≡ added later — same row, same count, same membership, same event', async () => {
    const highlight = await create(tokens.demoAdmin, { title: 'Teste Igual' });
    const adminRows = await adminSql<{ id: string }[]>`
      select id::text from public.users where email = 'admin@rede-demo.local' limit 1`;
    const adminUserId = adminRows[0]?.id ?? '';

    const before = curationEvents.length;
    const born = await publishInto('nasce igual', { highlightId: highlight.id });
    expect(born.res.status).toBe(201);
    const storyA = (await born.res.json()) as StorySummary;
    created.push(storyA.id);

    const { storyId: storyB } = await publishImage('adicionado depois');
    const added = await addItem(tokens.demoAdmin, highlight.id, storyB);
    expect(added.status).toBe(200);

    const rowA = await itemRow(highlight.id, storyA.id);
    const rowB = await itemRow(highlight.id, storyB);
    expect(rowA).toHaveLength(1);
    expect(rowB).toHaveLength(1);
    expect(rowA).toEqual(rowB);
    expect(rowA[0]).toEqual({ tenant_id: tenantIds.demo, added_by_user_id: adminUserId });

    for (const storyId of [storyA.id, storyB]) {
      const res = await request(`/v1/stories/${storyId}`, tokens.demoAdmin, {
        headers: { 'x-tenant-host': HOSTS.demo },
      });
      expect(((await res.json()) as StorySummary).highlightCount).toBe(1);
    }

    const detail = highlightDetailSchema.parse(
      await (await hlRequest(tokens.demoMember, `/${highlight.id}`)).json(),
    );
    expect(detail.items.map((item) => item.id).sort()).toEqual([storyA.id, storyB].sort());

    const highlightedEvents = publishEventsSince(before).filter(
      (entry) => entry.name === 'story.highlighted',
    );
    expect(highlightedEvents.map((entry) => entry.payload.storyId)).toEqual([storyA.id, storyB]);
    expect(Object.keys(highlightedEvents[0]?.payload ?? {}).sort()).toEqual(
      Object.keys(highlightedEvents[1]?.payload ?? {}).sort(),
    );
  });

  /* ── 05.2-10: the seen state (HIGHLIGHT-06, D-105, R-D-I, R-D-J) ─────────────────────────── */

  /** `POST /v1/stories/views` with the given body (or none), on the demo host. */
  const markSeen = (token: string | undefined, body: unknown) =>
    request('/v1/stories/views', token, {
      method: 'POST',
      headers: { 'x-tenant-host': HOSTS.demo },
      body: JSON.stringify(body),
    });

  /** `story_views` rows of one tenant — optionally for one user and a set of stories. */
  async function viewRows(
    tenantId: string,
    opts: { userId?: string; storyIds?: string[] } = {},
  ): Promise<number> {
    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.story_views
       where tenant_id = ${tenantId}::uuid
         and (${opts.userId ?? null}::uuid is null or user_id = ${opts.userId ?? null}::uuid)
         and (${opts.storyIds ?? null}::uuid[] is null or story_id = any(${opts.storyIds ?? null}::uuid[]))`;
    return rows[0]?.n ?? 0;
  }

  async function userIdOf(email: string): Promise<string> {
    const rows = await adminSql<{ id: string }[]>`
      select id::text from public.users where email = ${email} limit 1`;
    const id = rows[0]?.id ?? '';
    expect(id, email).not.toBe('');
    return id;
  }

  it('05.2-24 a member records two SHOWN stories: 204, two rows, a repeat writes none, and only THEIR read flips', async () => {
    const memberId = await userIdOf('member@rede-demo.local');
    const a = await publishImage('visto a');
    const b = await publishImage('visto b');
    const c = await publishImage('nao visto c');
    const pair = [a.storyId, b.storyId];

    const first = await markSeen(tokens.demoMember, { storyIds: pair });
    expect(first.status).toBe(204);
    expect(await viewRows(tenantIds.demo, { userId: memberId, storyIds: pair })).toBe(2);

    // The arbiter `story_views_uq` absorbs the repeat: still 204, still exactly two rows.
    const repeat = await markSeen(tokens.demoMember, { storyIds: pair });
    expect(repeat.status).toBe(204);
    expect(await viewRows(tenantIds.demo, { userId: memberId, storyIds: pair })).toBe(2);

    // The member's strip reports their own flag on every story: true for the pair, false for c.
    const strip = await walk(tokens.demoMember, '/v1/stories', STORY_MAX_PAGE_SIZE);
    const seenOf = (id: string) => strip.find((story) => story.id === id)?.viewerSeen;
    expect(seenOf(a.storyId)).toBe(true);
    expect(seenOf(b.storyId)).toBe(true);
    expect(seenOf(c.storyId)).toBe(false);
    expect(strip.every((story) => typeof story.viewerSeen === 'boolean')).toBe(true);

    // The ADMIN's read of the same stories is untouched by the member's views (V8: own flag only).
    const adminStrip = await walk(tokens.demoAdmin, '/v1/stories', STORY_MAX_PAGE_SIZE);
    for (const id of pair) {
      expect(adminStrip.find((story) => story.id === id)?.viewerSeen).toBe(false);
    }
  });

  it('05.2-25 an unknown id and the LAB tenant’s story write NOTHING in either tenant — and a demo id beside them writes one row', async () => {
    const memberId = await userIdOf('member@rede-demo.local');
    const labStories = await adminSql<{ id: string }[]>`
      select id::text from public.stories
       where tenant_id = ${tenantIds.lab}::uuid and deleted_at is null
       order by published_at desc limit 1`;
    const labStory = labStories[0]?.id ?? '';
    expect(labStory, 'seeded lab story').not.toBe('');

    const demoBefore = await viewRows(tenantIds.demo);
    const labBefore = await viewRows(tenantIds.lab);

    // Foreign and unknown only: the answer is the same 204 a valid id gets (no existence oracle).
    const foreign = await markSeen(tokens.demoMember, { storyIds: [randomUUID(), labStory] });
    expect(foreign.status).toBe(204);
    expect(await viewRows(tenantIds.demo)).toBe(demoBefore);
    expect(await viewRows(tenantIds.lab)).toBe(labBefore);

    // Positive control in the same test: one demo id among the foreign ones writes exactly one row.
    const { storyId } = await publishImage('controle positivo');
    const mixed = await markSeen(tokens.demoMember, {
      storyIds: [randomUUID(), labStory, storyId],
    });
    expect(mixed.status).toBe(204);
    expect(await viewRows(tenantIds.demo)).toBe(demoBefore + 1);
    expect(await viewRows(tenantIds.demo, { userId: memberId, storyIds: [storyId] })).toBe(1);
    expect(await viewRows(tenantIds.lab)).toBe(labBefore);
  });

  it('05.2-26 an empty list, 51 ids and a non-uuid are VALIDATION_FAILED; no permission is needed; no session is 401', async () => {
    for (const body of [
      { storyIds: [] },
      { storyIds: Array.from({ length: 51 }, () => randomUUID()) },
      { storyIds: ['nao-e-um-uuid'] },
      { storyIds: [randomUUID()], extra: true },
    ]) {
      const res = await markSeen(tokens.demoMember, body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect((await envelope(res)).error.code).toBe('VALIDATION_FAILED');
    }

    // Exactly the cap is accepted — by a MEMBER, who holds no stories permission at all.
    const atCap = await markSeen(tokens.demoMember, {
      storyIds: Array.from({ length: 50 }, () => randomUUID()),
    });
    expect(atCap.status).toBe(204);

    const anonymous = await markSeen(undefined, { storyIds: [randomUUID()] });
    expect(anonymous.status).toBe(401);
  });

  it('05.2-27 an EXPIRED story is recorded, and a story seen inside a highlight reads seen in the strip too (R-D-I)', async () => {
    const memberId = await userIdOf('member@rede-demo.local');
    const highlight = await create(tokens.demoAdmin, { title: 'Teste Visto' });

    const expired = await publishImage('visto expirado');
    await adminSql`
      update public.stories
         set published_at = now() - interval '30 hours', expires_at = now() - interval '6 hours'
       where id = ${expired.storyId}::uuid`;
    const live = await publishImage('visto no destaque');
    expect((await addItem(tokens.demoAdmin, highlight.id, expired.storyId)).status).toBe(200);
    expect((await addItem(tokens.demoAdmin, highlight.id, live.storyId)).status).toBe(200);

    // Before: the highlight's items read unseen for the member.
    const before = highlightDetailSchema.parse(
      await (await hlRequest(tokens.demoMember, `/${highlight.id}`)).json(),
    );
    expect(before.items.map((item) => item.viewerSeen)).toEqual([false, false]);

    // The viewer shows both segments inside the highlight: the SAME story ids are recorded.
    const res = await markSeen(tokens.demoMember, { storyIds: [expired.storyId, live.storyId] });
    expect(res.status).toBe(204);
    expect(await viewRows(tenantIds.demo, { userId: memberId, storyIds: [expired.storyId] })).toBe(
      1,
    );

    const after = highlightDetailSchema.parse(
      await (await hlRequest(tokens.demoMember, `/${highlight.id}`)).json(),
    );
    expect(after.items.map((item) => item.viewerSeen)).toEqual([true, true]);

    // …and the live one reads seen in the STRIP as well, which is what greys the tenant ring.
    const strip = await walk(tokens.demoMember, '/v1/stories', STORY_MAX_PAGE_SIZE);
    expect(strip.find((story) => story.id === live.storyId)?.viewerSeen).toBe(true);
    expect(strip.some((story) => story.id === expired.storyId)).toBe(false);
  });

  /* ── 05.2-11: the pin model is retired (HIGHLIGHT-05, D-116, roadmap criteria 4 and 5) ─────── */

  it('05.2-28 the retired pin API is gone: a publish naming `communityId` is 400 and writes nothing; every pin route is a 404', async () => {
    const community = await makeHighlightCommunity('Destino aposentado');

    // A stale client (a PWA cached before 05.2-08) still sends 05.1's `communityId`. The contract
    // is `.strict()`, so the retired key is an unknown key: a plain VALIDATION_FAILED, no story.
    const before = curationEvents.length;
    const { res, caption } = await publishInto('destino aposentado', { communityId: community });
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.hasOwn(body.error.details ?? {}, 'pin')).toBe(false);
    expect(await captionCount(caption)).toBe(0);
    expect(publishEventsSince(before)).toHaveLength(0);

    // Every retired pin route answers 404 — never a 500 on a relation that no longer exists. The
    // retired segments are composed rather than spelled whole, so the retirement's grep gate
    // (05.2-11) stays an invariant test: a reintroduced literal anywhere in the tree trips it.
    const { storyId } = await publishImage('rota aposentada');
    const [pinsSegment, pinnedSegment] = ['pins', 'pinned'];
    for (const [method, path] of [
      ['PUT', `/v1/stories/${storyId}/${pinsSegment}/${community}`],
      ['DELETE', `/v1/stories/${storyId}/${pinsSegment}/${community}`],
      ['GET', `/v1/stories/${storyId}/${pinsSegment}`],
      ['GET', `/v1/stories/${pinnedSegment}?communityId=${community}`],
    ] as const) {
      const retired = await request(path, tokens.demoAdmin, {
        method,
        headers: { 'x-tenant-host': HOSTS.demo },
      });
      expect(retired.status, `${method} ${path}`).toBe(404);
    }

    // Nothing was curated anywhere by any of it: the community has no highlight, the story none.
    expect(await row(tokens.demoAdmin, `?scope=all&communityId=${community}`)).toEqual([]);
    const story = await request(`/v1/stories/${storyId}`, tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(((await story.json()) as StorySummary).highlightCount).toBe(0);
  });

  it('05.2-29 the pin invariants live on in highlights: a repeat add announces nothing, a removed story leaves every highlight at once, two identical publishes are two items, and no client value widens a row', async () => {
    const home = await create(tokens.demoAdmin, { title: 'Teste Gemeo A' });
    const community = await makeHighlightCommunity('Destaque gemeo');
    const inCommunity = await create(tokens.demoAdmin, {
      communityId: community,
      title: 'Teste Gemeo B',
    });
    const { storyId } = await publishImage('gemeo');

    // Transitions, not requests (the retired pin case 37): two adds, ONE `story.highlighted`.
    const before = curationEvents.length;
    expect((await addItem(tokens.demoAdmin, home.id, storyId)).status).toBe(200);
    expect((await addItem(tokens.demoAdmin, home.id, storyId)).status).toBe(200);
    const highlighted = curationEvents
      .slice(before)
      .filter((event) => event.name === 'story.highlighted');
    expect(highlighted).toHaveLength(1);
    expect(Object.keys(highlighted[0]?.payload ?? {}).sort()).toEqual([
      'actorUserId',
      'highlightId',
      'storyId',
      'tenantId',
    ]);
    expect((await addItem(tokens.demoAdmin, inCommunity.id, storyId)).status).toBe(200);

    // T-05-52 carried: soft-deleting the story removes it from EVERY highlight read at once, and
    // the item rows stay as the record of where it had been.
    const removed = await request(`/v1/stories/${storyId}`, tokens.demoAdmin, {
      method: 'DELETE',
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(removed.status).toBe(204);
    for (const highlight of [home, inCommunity]) {
      const res = await hlRequest(tokens.demoAdmin, `/${highlight.id}`);
      // Curator read: an emptied highlight still answers, and never lists the removed story.
      if (res.status === 200) {
        const detail = highlightDetailSchema.parse(await res.json());
        expect(detail.items.map((item) => item.id)).not.toContain(storyId);
      } else {
        expect(res.status).toBe(404);
      }
      expect(await itemRows(highlight.id, storyId)).toBe(1);
    }
    expect((await row(tokens.demoMember)).some((item) => item.id === home.id)).toBe(false);

    // D-96 and no idempotency (05.1-8 carried): the same publish into one highlight twice is two
    // stories and two items — and both are in the strip too.
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@rede-demo.local' });
    const twice = {
      mediaAssetId: assetId,
      mediaKind: 'image',
      caption: `${TEST_CAPTION_PREFIX} — publicada duas vezes ${randomUUID()}`,
      highlightId: inCommunity.id,
    };
    const first = await publish(tokens.demoAdmin, twice);
    const second = await publish(tokens.demoAdmin, twice);
    expect([first.status, second.status]).toEqual([201, 201]);
    const a = (await first.json()) as StorySummary;
    const b = (await second.json()) as StorySummary;
    created.push(a.id, b.id);
    expect(a.id).not.toBe(b.id);
    const items = highlightDetailSchema
      .parse(await (await hlRequest(tokens.demoMember, `/${inCommunity.id}`)).json())
      .items.map((item) => item.id);
    expect(items).toContain(a.id);
    expect(items).toContain(b.id);
    const strip = (await walk(tokens.demoMember, '/v1/stories', STORY_MAX_PAGE_SIZE)).map(
      (item) => item.id,
    );
    expect(strip).toContain(a.id);
    expect(strip).toContain(b.id);

    // T-05-53 carried: the highlight read takes no `limit`/`cursor` at all (a place is bounded by
    // STORY_HIGHLIGHT_MAX_PER_PLACE), so a hand-edited one is refused, never a widened read.
    for (const query of ['?limit=100000', `?cursor=${encodeURIComponent("' or 1=1--")}`]) {
      const res = await hlRequest(tokens.demoMember, query);
      expect(res.status, query).toBe(400);
      expect((await envelope(res)).error.code, query).toBe('VALIDATION_FAILED');
    }
  });

  /* ── Nyquist: the caps against the REAL count and lock (HIGHLIGHT-01/02, `{ highlight: 'full' }`) ── */

  /**
   * Seeds `n` demo-tenant stories straight into `highlightId` (one shared asset, captions carrying
   * `TEST_CAPTION_PREFIX` so the file's sweep removes them and their items cascade). `deletedCount`
   * of them are soft-deleted. Returns the story ids.
   */
  async function seedItems(highlightId: string, n: number, deletedCount = 0): Promise<string[]> {
    const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@rede-demo.local' });
    const inserted = await adminSql<{ id: string }[]>`
      insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption, deleted_at)
      select ${tenantIds.demo}::uuid, a.author, ${assetId}::uuid, 'image',
             ${`${TEST_CAPTION_PREFIX} — cap `} || g, case when g <= ${deletedCount} then now() end
        from generate_series(1, ${n}) g,
             (select m.user_id as author from public.memberships m
                join public.users u on u.id = m.user_id
               where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@rede-demo.local'
               limit 1) a
      returning id`;
    const ids = inserted.map((r) => r.id);
    created.push(...ids);
    await adminSql`
      insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
      select s.tenant_id, ${highlightId}::uuid, s.id, s.author_user_id
        from public.stories s where s.id = any(${ids}::uuid[])`;
    return ids;
  }

  /** Fills a community place with `STORY_HIGHLIGHT_MAX_PER_PLACE` highlights (swept by the cascade). */
  async function fillPlace(communityId: string): Promise<void> {
    await adminSql`
      insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
      select ${tenantIds.demo}::uuid, ${communityId}::uuid, 'Teste Cheio ' || g, g - 1, m.user_id
        from generate_series(1, ${STORY_HIGHLIGHT_MAX_PER_PLACE}) g,
             (select m.user_id from public.memberships m
                join public.users u on u.id = m.user_id
               where m.tenant_id = ${tenantIds.demo}::uuid and u.email = 'admin@rede-demo.local'
               limit 1) m`;
  }

  const countItems = async (highlightId: string) =>
    (
      await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.story_highlight_items where highlight_id = ${highlightId}::uuid`
    )[0]?.n ?? -1;

  const countPlace = async (communityId: string) =>
    (
      await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.story_highlights where community_id = ${communityId}::uuid`
    )[0]?.n ?? -1;

  const countCaption = async (caption: string) =>
    (
      await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.stories where caption = ${caption}`
    )[0]?.n ?? -1;

  async function expectFull(res: Response): Promise<void> {
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual({ highlight: 'full' });
  }

  it('05.2-30 a highlight holding STORY_HIGHLIGHT_MAX_ITEMS refuses a NEW story with `full` and writes nothing; a story already in it is still the idempotent 200', async () => {
    const full = await create(tokens.demoAdmin, { title: 'Teste Cheio' });
    const held = await seedItems(full.id, STORY_HIGHLIGHT_MAX_ITEMS);
    expect(await countItems(full.id)).toBe(STORY_HIGHLIGHT_MAX_ITEMS);

    const { storyId } = await publishImage('cap itens');
    const before = eventsNamed('story.highlighted').length;
    await expectFull(await addItem(tokens.demoAdmin, full.id, storyId));
    expect(await itemRows(full.id, storyId)).toBe(0);
    expect(await countItems(full.id)).toBe(STORY_HIGHLIGHT_MAX_ITEMS);
    expect(eventsNamed('story.highlighted').length).toBe(before);

    const repeat = await addItem(tokens.demoAdmin, full.id, held[0] ?? '');
    expect(repeat.status).toBe(200);
    expect(highlightMembershipResultSchema.parse(await repeat.json()).highlighted).toBe(true);
    expect(await countItems(full.id)).toBe(STORY_HIGHLIGHT_MAX_ITEMS);

    // Positive control: one below the cap still accepts the same story.
    const room = await create(tokens.demoAdmin, { title: 'Teste Quase' });
    await seedItems(room.id, STORY_HIGHLIGHT_MAX_ITEMS - 1);
    expect((await addItem(tokens.demoAdmin, room.id, storyId)).status).toBe(200);
    expect(await countItems(room.id)).toBe(STORY_HIGHLIGHT_MAX_ITEMS);
  });

  it('05.2-31 a place holding STORY_HIGHLIGHT_MAX_PER_PLACE refuses a 51st highlight with `full` and writes nothing', async () => {
    const community = await makeHighlightCommunity('Destaque lotada');
    await fillPlace(community);
    const before = eventsNamed('highlight.created').length;
    await expectFull(
      await createHighlight(tokens.demoAdmin, { communityId: community, title: 'Teste Excesso' }),
    );
    expect(await countPlace(community)).toBe(STORY_HIGHLIGHT_MAX_PER_PLACE);
    expect(eventsNamed('highlight.created').length).toBe(before);

    // Positive control: one below the cap still creates.
    const spare = await makeHighlightCommunity('Destaque quase');
    await fillPlace(spare);
    await adminSql`delete from public.story_highlights
                    where community_id = ${spare}::uuid and title = 'Teste Cheio 50'`;
    const placed = await create(tokens.demoAdmin, { communityId: spare, title: 'Teste Ultimo' });
    expect(placed.communityId).toBe(spare);
    expect(await countPlace(spare)).toBe(STORY_HIGHLIGHT_MAX_PER_PLACE);
  });

  it('05.2-32 a publish into a full highlight, or a `newHighlight` into a full place, is `full` and writes NO story', async () => {
    const full = await create(tokens.demoAdmin, { title: 'Teste Lotado' });
    await seedItems(full.id, STORY_HIGHLIGHT_MAX_ITEMS);
    const community = await makeHighlightCommunity('Destaque sem vaga');
    await fillPlace(community);

    const published = eventsNamed('story.published').length;
    const highlighted = eventsNamed('story.highlighted').length;
    const createdEvents = eventsNamed('highlight.created').length;
    const eventsBefore = events.length;

    for (const destination of [
      { highlightId: full.id },
      { newHighlight: { communityId: community, title: 'Teste Nova' } },
    ]) {
      const assetId = await makeAsset({ tenantId: tenantIds.demo, email: 'admin@rede-demo.local' });
      const caption = `${TEST_CAPTION_PREFIX} — cheio ${randomUUID()}`;
      await expectFull(
        await publish(tokens.demoAdmin, {
          mediaAssetId: assetId,
          mediaKind: 'image',
          caption,
          ...destination,
        }),
      );
      expect(await countCaption(caption), JSON.stringify(destination)).toBe(0);
      const [uses] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.stories where media_asset_id = ${assetId}::uuid`;
      expect(uses?.n).toBe(0);
      expect(await assetStatus(assetId)).toMatchObject({ status: 'ready' });
    }
    expect(await countItems(full.id)).toBe(STORY_HIGHLIGHT_MAX_ITEMS);
    expect(await countPlace(community)).toBe(STORY_HIGHLIGHT_MAX_PER_PLACE);
    expect(eventsNamed('story.published').length).toBe(published);
    expect(eventsNamed('story.highlighted').length).toBe(highlighted);
    expect(eventsNamed('highlight.created').length).toBe(createdEvents);
    expect(events.length).toBe(eventsBefore);
  });

  it('05.2-33 an item whose story was soft-deleted does not take one of the STORY_HIGHLIGHT_MAX_ITEMS slots', async () => {
    // WR-01: 100 item rows, ONE of them a ghost (its story soft-deleted) = 99 live stories.
    const ghosted = await create(tokens.demoAdmin, { title: 'Teste Fantasma' });
    await seedItems(ghosted.id, STORY_HIGHLIGHT_MAX_ITEMS, 1);
    expect(await countItems(ghosted.id)).toBe(STORY_HIGHLIGHT_MAX_ITEMS);

    const { storyId: hundredth } = await publishImage('fantasma vaga');
    const accepted = await addItem(tokens.demoAdmin, ghosted.id, hundredth);
    expect(accepted.status).toBe(200);
    expect(highlightMembershipResultSchema.parse(await accepted.json()).highlighted).toBe(true);
    expect(await countItems(ghosted.id)).toBe(STORY_HIGHLIGHT_MAX_ITEMS + 1);

    // 100 LIVE stories now: the cap holds for the next one, and nothing is written.
    const { storyId: overflow } = await publishImage('fantasma cheio');
    await expectFull(await addItem(tokens.demoAdmin, ghosted.id, overflow));
    expect(await itemRows(ghosted.id, overflow)).toBe(0);
    expect(await countItems(ghosted.id)).toBe(STORY_HIGHLIGHT_MAX_ITEMS + 1);
  });

  it('05.2-34 a ghost item (its story soft-deleted) can still be taken out of the highlight; an unknown story is still the bare 404', async () => {
    const held = await create(tokens.demoAdmin, { title: 'Teste Remover' });
    const seeded = await seedItems(held.id, 2, 1);
    // Never rely on insert order: ask which seeded story is the soft-deleted one.
    const [ghostRow] = await adminSql<{ id: string }[]>`
      select id from public.stories where id = any(${seeded}::uuid[]) and deleted_at is not null`;
    const ghost = ghostRow?.id ?? '';
    const live = seeded.find((id) => id !== ghost) ?? '';
    expect(ghost).not.toBe('');
    expect(live).not.toBe('');

    const removed = await removeItem(tokens.demoAdmin, held.id, ghost);
    expect(removed.status).toBe(200);
    expect(highlightMembershipResultSchema.parse(await removed.json())).toEqual({
      highlighted: false,
      highlightCount: 0,
    });
    expect(await itemRows(held.id, ghost)).toBe(0);
    expect(await itemRows(held.id, live)).toBe(1);

    const repeat = await removeItem(tokens.demoAdmin, held.id, ghost);
    expect(repeat.status).toBe(200);
    expect(highlightMembershipResultSchema.parse(await repeat.json())).toEqual({
      highlighted: false,
      highlightCount: 0,
    });

    // The resolve stays tenant-scoped and bare: an unknown story id is the 404 with no details.
    const unknown = await removeItem(tokens.demoAdmin, held.id, randomUUID());
    expect(unknown.status).toBe(404);
    const body = await envelope(unknown);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error).not.toHaveProperty('details');
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
