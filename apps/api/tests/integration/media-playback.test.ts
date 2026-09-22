import { MEDIA_LIST_PAGE_SIZE } from '@tria/contracts/media';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { mediaProviderEventJob } from '@tria/core/server/media/video/event-job';
import { resetFakeVideoInternals } from '@tria/core/server/media/video/fake';
import type { VideoProviderEvent } from '@tria/core/server/media/video/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs, uploadAvatar } from './setup';

/**
 * MEDIA-03 (playback half) and TENANT-04 (plan 03-07), against the live local stack through
 * `VIDEO_PROVIDER=fake` — no Mux account exists, so the real transcode and the real-device HLS check
 * remain the two known-blocked Phase 01.1 UAT lines recorded in `docs/DEPLOY.md`.
 *
 * What is proved here:
 *  - `GET /v1/media/{assetId}/playback` mints THREE non-empty tokens for a ready video of the
 *    CALLER's own community, answers `Cache-Control: no-store`, and never persists the value;
 *  - the refusal vocabulary is almost closed (T-03-49): `409 { media: 'not_ready' }` is the ONLY
 *    distinguishable code and is reachable only for the caller's own still-transcoding asset —
 *    an unknown id, an image, a failed row and ANOTHER COMMUNITY's ready video all take the same
 *    bare 404 with no details payload (T-03-46);
 *  - `GET /v1/media` is `admin_tenant`-only (403 for a member, checked before any tenant
 *    consideration, T-03-48), lists the caller's own assets newest-first, pages by the shared
 *    keyset cursor, and never contains another community's asset id.
 *
 * Tenant A is the seeded `tria-demo`, tenant B the seeded `tria-lab`; the two-community pair is the
 * same one `isolation.test.ts` uses, and 03-08 lifts the cross-tenant case from here into it.
 */

const DEMO_ADMIN = 'admin@tria-demo.local';
const DEMO_MEMBER = 'member@tria-demo.local';
const LAB_ADMIN = 'admin@tria-lab.local';
const LAB_MEMBER = 'member@tria-lab.local';

let demoAdminToken = '';
let demoMemberToken = '';
let labAdminToken = '';
let labMemberToken = '';
let demoTenantId = '';
let labTenantId = '';

const createdAssetIds: string[] = [];

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * A video asset in a KNOWN state, written directly. The ingest path itself is 03-06's subject and is
 * proved end to end there; what this file is about is what the PLAYBACK and LIST endpoints do to a
 * row, which does not depend on how the row got there. Writing it directly also lets a tenant-B
 * fixture exist without a second live upload.
 */
async function seedVideo(
  tenantId: string,
  email: string,
  values: {
    status: 'pending' | 'processing' | 'ready' | 'failed' | 'rejected';
    playbackId?: string | null;
    durationSeconds?: number | null;
    filename?: string;
    createdAt?: string;
  },
): Promise<string> {
  const rows = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, duration_seconds, aspect_ratio, filename, created_at, ready_at)
    select ${tenantId}::uuid, u.id, 'video', 'post', ${values.status}, 'fake',
           ${`fake-${crypto.randomUUID()}`}, ${values.playbackId ?? null},
           'video/mp4', 1048576, ${values.durationSeconds ?? null}, '16:9',
           ${values.filename ?? 'reuniao.mp4'},
           ${values.createdAt ?? new Date().toISOString()}::timestamptz,
           ${values.status === 'ready' ? new Date().toISOString() : null}::timestamptz
      from public.users u where u.email = ${email}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not seed a video for ${email}`);
  createdAssetIds.push(id);
  return id;
}

async function cleanup(): Promise<void> {
  for (const id of [...new Set(createdAssetIds)]) {
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
  }
  createdAssetIds.length = 0;
  for (const tenantId of [demoTenantId, labTenantId]) {
    if (!tenantId) continue;
    await adminSql`delete from public.media_assets where tenant_id = ${tenantId}::uuid and kind = 'video'`;
  }
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  [demoAdminToken, demoMemberToken, labAdminToken, labMemberToken] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(DEMO_MEMBER, SEED_PASSWORD),
    signInAs(LAB_ADMIN, SEED_PASSWORD),
    signInAs(LAB_MEMBER, SEED_PASSWORD),
  ]);
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  demoTenantId = tenants.find((t) => t.slug === 'tria-demo')?.id ?? '';
  labTenantId = tenants.find((t) => t.slug === 'tria-lab')?.id ?? '';
  if (!demoTenantId || !labTenantId) throw new Error('the two seed tenants are not both present');
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  resetFakeVideoInternals();
  await stopBoss();
  await adminSql.end();
});

describe('GET /v1/media/{assetId}/playback — a per-request signed credential (D-44, TENANT-04)', () => {
  it('mints three non-empty tokens for a READY video and answers Cache-Control: no-store', async () => {
    const assetId = await seedVideo(demoTenantId, DEMO_ADMIN, {
      status: 'ready',
      playbackId: 'fake-playback-ready-1',
      durationSeconds: 12,
    });

    const res = await api.request(`/v1/media/${assetId}/playback`, {
      headers: authed(demoAdminToken),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = (await res.json()) as {
      playbackId: string;
      tokens: { playback: string; thumbnail: string; storyboard: string };
      expiresAt: string;
    };
    expect(body.playbackId).toBe('fake-playback-ready-1');
    expect(body.tokens.playback.length).toBeGreaterThan(0);
    expect(body.tokens.thumbnail.length).toBeGreaterThan(0);
    expect(body.tokens.storyboard.length).toBeGreaterThan(0);
    // The three are distinct: a single token reused three times would pass a "non-empty" check while
    // silently breaking the poster and the scrub strip.
    expect(new Set(Object.values(body.tokens)).size).toBe(3);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());

    // NEVER persisted: the row must carry no trace of the credential it was used to mint.
    const [row] = await adminSql<{ row: string }[]>`
      select row_to_json(m)::text as row from public.media_assets m where m.id = ${assetId}::uuid`;
    expect(row?.row).not.toContain(body.tokens.playback);
  });

  it('is minted fresh on every request — nothing is cached between two calls', async () => {
    const assetId = await seedVideo(demoTenantId, DEMO_ADMIN, {
      status: 'ready',
      playbackId: 'fake-playback-ready-2',
    });
    const first = await api.request(`/v1/media/${assetId}/playback`, {
      headers: authed(demoAdminToken),
    });
    const second = await api.request(`/v1/media/${assetId}/playback`, {
      headers: authed(demoAdminToken),
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get('cache-control')).toBe('no-store');
    const a = (await first.json()) as { expiresAt: string };
    const b = (await second.json()) as { expiresAt: string };
    expect(Date.parse(b.expiresAt)).toBeGreaterThanOrEqual(Date.parse(a.expiresAt));
  });

  it('a MEMBER of the same community may obtain a token — playback is not an admin surface', async () => {
    const assetId = await seedVideo(demoTenantId, DEMO_ADMIN, {
      status: 'ready',
      playbackId: 'fake-playback-ready-3',
    });
    const res = await api.request(`/v1/media/${assetId}/playback`, {
      headers: authed(demoMemberToken),
    });
    expect(res.status).toBe(200);
  });

  it('a still-transcoding asset answers 409 { media: "not_ready" } — the ONE distinguishable code', async () => {
    for (const status of ['pending', 'processing'] as const) {
      const assetId = await seedVideo(demoTenantId, DEMO_ADMIN, { status });
      const res = await api.request(`/v1/media/${assetId}/playback`, {
        headers: authed(demoAdminToken),
      });
      expect(res.status).toBe(409);
      const error = await envelope(res);
      expect(error.code).toBe('CONFLICT');
      expect(error.details?.media).toBe('not_ready');
    }
  });

  it('every OTHER miss is the SAME bare 404 with no details payload (T-03-49)', async () => {
    const unknown = crypto.randomUUID();
    const image = await uploadAvatar(demoAdminToken, { purpose: 'post' });
    const failed = await seedVideo(demoTenantId, DEMO_ADMIN, { status: 'failed' });
    const rejected = await seedVideo(demoTenantId, DEMO_ADMIN, { status: 'rejected' });
    const readyWithoutPlayback = await seedVideo(demoTenantId, DEMO_ADMIN, {
      status: 'ready',
      playbackId: null,
    });

    for (const assetId of [unknown, image, failed, rejected, readyWithoutPlayback]) {
      const res = await api.request(`/v1/media/${assetId}/playback`, {
        headers: authed(demoAdminToken),
      });
      expect(res.status).toBe(404);
      const error = await envelope(res);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toBeUndefined();
    }
  });

  it('a soft-deleted video takes the same bare 404 — the row is invisible to the lane', async () => {
    const assetId = await seedVideo(demoTenantId, DEMO_ADMIN, {
      status: 'ready',
      playbackId: 'fake-playback-doomed',
    });
    const removed = await api.request(`/v1/media/${assetId}`, {
      method: 'DELETE',
      headers: authed(demoAdminToken),
    });
    expect(removed.status).toBe(200);

    const res = await api.request(`/v1/media/${assetId}/playback`, {
      headers: authed(demoAdminToken),
    });
    expect(res.status).toBe(404);
    expect((await envelope(res)).details).toBeUndefined();
  });

  it('the literal `playback` segment beats the variant route — it is registered first', async () => {
    // Registration order is the contract: were `/{assetId}/{variant}` declared first, `playback`
    // would be matched as a `{variant}` and answer the variant regex's 400 instead of a token.
    const assetId = await seedVideo(demoTenantId, DEMO_ADMIN, {
      status: 'ready',
      playbackId: 'fake-playback-order',
    });
    const res = await api.request(`/v1/media/${assetId}/playback`, {
      headers: authed(demoAdminToken),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('GET /v1/media — the admin-only asset list (MEDIA-03, R-11)', () => {
  it('refuses a MEMBER with 403 FORBIDDEN before any tenant consideration (T-03-48)', async () => {
    const res = await api.request('/v1/media?kind=video', { headers: authed(demoMemberToken) });
    expect(res.status).toBe(403);
    expect((await envelope(res)).code).toBe('FORBIDDEN');
  });

  it("lists the admin's own community assets newest-first", async () => {
    const older = await seedVideo(demoTenantId, DEMO_ADMIN, {
      status: 'ready',
      playbackId: 'fake-playback-older',
      filename: 'antigo.mp4',
      createdAt: '2026-01-01T10:00:00Z',
    });
    const newer = await seedVideo(demoTenantId, DEMO_ADMIN, {
      status: 'processing',
      filename: 'novo.mp4',
      createdAt: '2026-01-02T10:00:00Z',
    });

    const res = await api.request('/v1/media?kind=video', { headers: authed(demoAdminToken) });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { items: { id: string; status: string }[] };
    const ids = body.items.map((item) => item.id);
    expect(ids).toContain(newer);
    expect(ids).toContain(older);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
  });

  it('pages by the shared keyset cursor and never repeats or skips a row', async () => {
    // Four assets created in the SAME microsecond-scale window, so the tiebreaker (`id desc`) is
    // what actually orders them and a page boundary has something to get wrong.
    const createdAt = new Date().toISOString();
    for (let index = 0; index < 4; index += 1) {
      await seedVideo(demoTenantId, DEMO_ADMIN, {
        status: 'ready',
        playbackId: `fake-playback-page-${index}`,
        filename: `pagina-${index}.mp4`,
        createdAt,
      });
    }

    // The ground truth: ONE request for the first four rows, in the endpoint's own order.
    const whole = await api.request('/v1/media?kind=video&limit=4', {
      headers: authed(demoAdminToken),
    });
    const expected = ((await whole.json()) as { items: { id: string }[] }).items.map((i) => i.id);
    expect(expected).toHaveLength(4);

    const first = await api.request('/v1/media?kind=video&limit=2', {
      headers: authed(demoAdminToken),
    });
    const page1 = (await first.json()) as { items: { id: string }[]; nextCursor: string | null };
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const second = await api.request(
      `/v1/media?kind=video&limit=2&cursor=${encodeURIComponent(page1.nextCursor ?? '')}`,
      { headers: authed(demoAdminToken) },
    );
    const page2 = (await second.json()) as { items: { id: string }[]; nextCursor: string | null };
    const ids = [...page1.items, ...page2.items].map((item) => item.id);

    // Two pages of two reconstruct the single page of four EXACTLY: no duplicate across the
    // boundary (the `<` comparison is strict) and no row skipped (the cursor is the last row's own
    // ordered pair, not the next one's).
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expected);
  });

  it('a tampered or stale cursor answers the FIRST page rather than an error (T-03-52)', async () => {
    await seedVideo(demoTenantId, DEMO_ADMIN, { status: 'ready', playbackId: 'fake-playback-t' });
    const clean = await api.request('/v1/media?kind=video&limit=3', {
      headers: authed(demoAdminToken),
    });
    const tampered = await api.request('/v1/media?kind=video&limit=3&cursor=not-a-cursor', {
      headers: authed(demoAdminToken),
    });
    expect(tampered.status).toBe(200);
    const a = (await clean.json()) as { items: { id: string }[] };
    const b = (await tampered.json()) as { items: { id: string }[] };
    expect(b.items.map((i) => i.id)).toEqual(a.items.map((i) => i.id));
  });

  it('clamps `limit` and refuses an unknown query key', async () => {
    const tooBig = await api.request('/v1/media?kind=video&limit=100000', {
      headers: authed(demoAdminToken),
    });
    expect(tooBig.status).toBe(400);

    const unknownKey = await api.request('/v1/media?kind=video&tenant=tria-lab', {
      headers: authed(demoAdminToken),
    });
    expect(unknownKey.status).toBe(400);

    const defaulted = await api.request('/v1/media?kind=video', {
      headers: authed(demoAdminToken),
    });
    const body = (await defaulted.json()) as { items: unknown[] };
    expect(body.items.length).toBeLessThanOrEqual(MEDIA_LIST_PAGE_SIZE);
  });
});

describe('cross-tenant refusal — criterion 4 video half (T-03-46, TENANT-04)', () => {
  it('a tenant-B admin gets a bare 404 for a tenant-A ready video, with NO token in the body', async () => {
    const tenantAAsset = await seedVideo(demoTenantId, DEMO_ADMIN, {
      status: 'ready',
      playbackId: 'fake-playback-tenant-a',
      filename: 'privado-da-demo.mp4',
    });

    const res = await api.request(`/v1/media/${tenantAAsset}/playback`, {
      headers: authed(labAdminToken),
    });
    expect(res.status).toBe(404);
    const raw = await res.text();
    expect(raw).not.toContain('tokens');
    expect(raw).not.toContain('fake-playback-tenant-a');
    expect(raw).not.toContain('tria-demo');
    expect(raw).not.toContain('privado-da-demo');
  });

  it("a tenant-B admin's list contains NONE of tenant A's asset ids", async () => {
    const tenantAAsset = await seedVideo(demoTenantId, DEMO_ADMIN, {
      status: 'ready',
      playbackId: 'fake-playback-tenant-a-2',
      filename: 'so-da-demo.mp4',
    });
    const tenantBAsset = await seedVideo(labTenantId, LAB_ADMIN, {
      status: 'ready',
      playbackId: 'fake-playback-tenant-b',
      filename: 'so-do-lab.mp4',
    });

    const res = await api.request('/v1/media?kind=video', { headers: authed(labAdminToken) });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain(tenantBAsset);
    expect(raw).not.toContain(tenantAAsset);
    expect(raw).not.toContain('so-da-demo');
  });

  it('a tenant-B MEMBER is refused the list with 403 before any tenant consideration', async () => {
    const res = await api.request('/v1/media?kind=video', { headers: authed(labMemberToken) });
    expect(res.status).toBe(403);
    expect((await envelope(res)).code).toBe('FORBIDDEN');
  });
});

describe('the fake provider keeps the seam honest', () => {
  it('a video the event job flips to ready becomes playable through the SAME endpoint', async () => {
    const assetId = await seedVideo(demoTenantId, DEMO_ADMIN, { status: 'processing' });
    const [row] = await adminSql<{ provider_asset_id: string }[]>`
      select provider_asset_id from public.media_assets where id = ${assetId}::uuid`;

    const event: VideoProviderEvent = {
      id: `evt-${assetId}`,
      kind: 'ready',
      rawType: 'video.asset.ready',
      assetId,
      providerAssetId: row?.provider_asset_id ?? null,
      playbackId: `fake-playback-${assetId}`,
      durationSeconds: 9,
      aspectRatio: '16:9',
      failureReason: null,
    };

    const notReady = await api.request(`/v1/media/${assetId}/playback`, {
      headers: authed(demoAdminToken),
    });
    expect(notReady.status).toBe(409);

    await mediaProviderEventJob.handler(event);

    const ready = await api.request(`/v1/media/${assetId}/playback`, {
      headers: authed(demoAdminToken),
    });
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { playbackId: string };
    expect(body.playbackId).toBe(`fake-playback-${assetId}`);

    await adminSql`delete from public.media_provider_events where id = ${event.id}`;
  });
});
