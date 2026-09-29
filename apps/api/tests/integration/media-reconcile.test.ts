import { mediaAssetSchema } from '@rede-social/contracts/media';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { mediaProviderEventJob } from '@rede-social/core/server/media/video/event-job';
import {
  fakeVideoInternals,
  resetFakeVideoInternals,
} from '@rede-social/core/server/media/video/fake';
import {
  reconcileInternals,
  resetReconcileInternals,
} from '@rede-social/core/server/media/video/reconcile';
import {
  type VideoAssetInfo,
  VideoProviderError,
  type VideoProviderEvent,
  type VideoUploadState,
} from '@rede-social/core/server/media/video/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * Reconcile-on-read (quick-260929-ltf), against the live local stack through `VIDEO_PROVIDER=fake`.
 *
 * On 2026-09-29 a Cloud Run revision swap delayed the provider's webhook deliveries for about 14
 * minutes, and two videos the provider already had `ready` sat `pending` in `media_assets`. The
 * webhook stays the primary path; this file proves the fallback: `GET /v1/media/{assetId}` asks the
 * provider about a stale pending video (through the `VideoProvider.getUploadState` seam, driven here
 * by `fakeVideoInternals.uploadState`) and applies the answer through the SAME
 * `kernel.media-provider-event` handler the webhook uses.
 *
 * `api` is the in-process app, so `fakeVideoInternals` and `reconcileInternals` are shared with the
 * server under test.
 */

const DEMO_ADMIN = 'admin@rede-demo.local';
const DEMO_MEMBER = 'member@rede-demo.local';

let adminToken = '';
let memberToken = '';
let demoTenantId = '';

const createdAssetIds: string[] = [];

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

const read = (assetId: string, token: string = adminToken) =>
  api.request(`/v1/media/${assetId}`, { headers: authed(token) });

type Seed = {
  status?: 'pending' | 'processing' | 'ready' | 'failed' | 'rejected';
  purpose?: 'post' | 'story';
  provider?: 'fake' | 'mux';
  /** `undefined` → a fresh `fake-up-<uuid>` upload id; `null` → the column stays null. */
  providerAssetId?: string | null;
  ageSeconds?: number;
  email?: string;
};

async function seedVideo(values: Seed = {}): Promise<{ id: string; uploadId: string | null }> {
  const uploadId =
    values.providerAssetId === undefined
      ? `fake-up-${crypto.randomUUID()}`
      : values.providerAssetId;
  const rows = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id,
       mime, bytes, filename, created_at)
    select ${demoTenantId}::uuid, u.id, 'video', ${values.purpose ?? 'post'},
           ${values.status ?? 'pending'}, ${values.provider ?? 'fake'}, ${uploadId},
           'video/mp4', 1048576, 'reconcile.mp4',
           now() - make_interval(secs => ${values.ageSeconds ?? 60})
      from public.users u where u.email = ${values.email ?? DEMO_ADMIN}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error('could not seed a video');
  createdAssetIds.push(id);
  return { id, uploadId };
}

type DbRow = {
  status: string;
  provider_asset_id: string | null;
  playback_id: string | null;
  duration_seconds: number | null;
  aspect_ratio: string | null;
  ready_at: Date | null;
  failure_reason: string | null;
};

async function dbRow(id: string): Promise<DbRow> {
  const rows = await adminSql<DbRow[]>`
    select status, provider_asset_id, playback_id, duration_seconds, aspect_ratio, ready_at,
           failure_reason
      from public.media_assets where id = ${id}::uuid`;
  const row = rows[0];
  if (!row) throw new Error(`no row ${id}`);
  return row;
}

const readyAsset = (overrides: Partial<VideoAssetInfo> = {}): VideoAssetInfo => ({
  providerAssetId: `fake-asset-${crypto.randomUUID()}`,
  status: 'ready',
  playbackId: `fake-pb-${crypto.randomUUID()}`,
  durationSeconds: 12,
  aspectRatio: '9:16',
  ...overrides,
});

const answer = (state: VideoUploadState) => {
  fakeVideoInternals.uploadState = async () => state;
};

function webhookReady(
  assetId: string,
  providerAssetId: string | null,
  overrides: Partial<VideoProviderEvent> = {},
): VideoProviderEvent {
  return {
    id: `evt-webhook-${crypto.randomUUID()}`,
    kind: 'ready',
    rawType: 'video.asset.ready',
    assetId,
    providerAssetId,
    playbackId: 'webhook-pb',
    durationSeconds: 30,
    aspectRatio: '16:9',
    failureReason: null,
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  for (const id of [...new Set(createdAssetIds)]) {
    await adminSql`delete from public.stories where media_asset_id = ${id}::uuid`;
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
  }
  createdAssetIds.length = 0;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  [adminToken, memberToken] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(DEMO_MEMBER, SEED_PASSWORD),
  ]);
  const tenants = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = 'rede-demo'`;
  demoTenantId = tenants[0]?.id ?? '';
  if (!demoTenantId) throw new Error('the seed tenant is not present');
});

beforeEach(() => {
  resetFakeVideoInternals();
  resetReconcileInternals();
});

afterAll(async () => {
  await cleanup();
  resetFakeVideoInternals();
  resetReconcileInternals();
  await stopBoss();
  await adminSql.end();
});

describe('GET /v1/media/{assetId} reconciles a stale pending video (quick-260929-ltf)', () => {
  it('L1 (tracer): the provider says ready, so the SAME response says ready and the row holds the asset id', async () => {
    const { id, uploadId } = await seedVideo();
    const asset = readyAsset();
    answer({ state: 'asset', asset });

    const res = await read(id);
    expect(res.status).toBe(200);
    const body = mediaAssetSchema.parse(await res.json());
    expect(body.status).toBe('ready');
    expect(body.durationSeconds).toBe(12);
    expect(body.aspectRatio).toBe('9:16');

    const row = await dbRow(id);
    expect(row.status).toBe('ready');
    expect(row.provider_asset_id).toBe(asset.providerAssetId);
    expect(row.provider_asset_id).not.toBe(uploadId);
    expect(row.playback_id).toBe(asset.playbackId);
    expect(row.ready_at).not.toBeNull();
    expect(row.failure_reason).toBeNull();
    expect(fakeVideoInternals.uploadStateCalls).toEqual([uploadId]);
  });

  it('L2: a late webhook after reconciliation changes nothing', async () => {
    const { id } = await seedVideo();
    const asset = readyAsset();
    answer({ state: 'asset', asset });
    expect((await read(id)).status).toBe(200);
    const before = await dbRow(id);
    expect(before.status).toBe('ready');

    await mediaProviderEventJob.handler(webhookReady(id, asset.providerAssetId));

    const after = await dbRow(id);
    expect(after.playback_id).toBe(asset.playbackId);
    expect(after.duration_seconds).toBe(12);
    expect(after.ready_at?.getTime()).toBe(before.ready_at?.getTime());
  });

  it('L3: a video the webhook already made ready causes zero provider lookups', async () => {
    const { id } = await seedVideo();
    answer({ state: 'asset', asset: readyAsset() });

    await mediaProviderEventJob.handler(webhookReady(id, `fake-asset-${crypto.randomUUID()}`));

    const res = await read(id);
    expect(res.status).toBe(200);
    expect(mediaAssetSchema.parse(await res.json()).status).toBe('ready');
    expect(fakeVideoInternals.uploadStateCalls).toEqual([]);
  });

  it('L4: no lookup inside the 15 s grace', async () => {
    const { id } = await seedVideo({ ageSeconds: 0 });
    answer({ state: 'asset', asset: readyAsset() });

    const res = await read(id);
    expect(mediaAssetSchema.parse(await res.json()).status).toBe('pending');
    expect(fakeVideoInternals.uploadStateCalls).toEqual([]);
  });

  it('L5: at most one lookup per asset per 10 s, and a waiting/preparing answer leaves the row pending', async () => {
    const { id } = await seedVideo();
    answer({ state: 'waiting' });

    expect(mediaAssetSchema.parse(await (await read(id)).json()).status).toBe('pending');
    expect(mediaAssetSchema.parse(await (await read(id)).json()).status).toBe('pending');
    expect(fakeVideoInternals.uploadStateCalls.length).toBe(1);

    const later = Date.now() + 10_001;
    reconcileInternals.now = () => later;
    answer({ state: 'asset', asset: readyAsset({ status: 'preparing', playbackId: null }) });
    expect(mediaAssetSchema.parse(await (await read(id)).json()).status).toBe('pending');
    expect(fakeVideoInternals.uploadStateCalls.length).toBe(2);
    expect((await dbRow(id)).status).toBe('pending');
  });

  it('L6: a provider error never fails the GET', async () => {
    const { id } = await seedVideo();
    fakeVideoInternals.uploadState = async () => {
      throw new VideoProviderError('unavailable', 503);
    };

    const res = await read(id);
    expect(res.status).toBe(200);
    expect(mediaAssetSchema.parse(await res.json()).status).toBe('pending');
    expect(fakeVideoInternals.uploadStateCalls.length).toBe(1);
  });

  it('L7: an errored asset or an errored upload fails the row with the event type', async () => {
    const assetErrored = await seedVideo();
    answer({
      state: 'asset',
      asset: readyAsset({ status: 'errored', playbackId: null, durationSeconds: null }),
    });
    const first = await read(assetErrored.id);
    expect(mediaAssetSchema.parse(await first.json()).status).toBe('failed');
    expect((await dbRow(assetErrored.id)).failure_reason).toBe('video.asset.errored');

    const uploadErrored = await seedVideo();
    answer({ state: 'errored' });
    const second = await read(uploadErrored.id);
    expect(mediaAssetSchema.parse(await second.json()).status).toBe('failed');
    const row = await dbRow(uploadErrored.id);
    expect(row.status).toBe('failed');
    expect(row.failure_reason).toBe('video.upload.errored');
  });

  it('L8: a ready story video over the cap is rejected and its provider asset deleted', async () => {
    const { id } = await seedVideo({ purpose: 'story' });
    const asset = readyAsset({ durationSeconds: 61 });
    answer({ state: 'asset', asset });

    const res = await read(id);
    expect(res.status).toBe(200);
    const body = mediaAssetSchema.parse(await res.json());
    expect(body.status).toBe('rejected');
    expect(body.failureReason).toBe('duration_too_long');
    expect(fakeVideoInternals.deletedAssetIds).toEqual([asset.providerAssetId]);
  });

  describe('L9: eligibility and authorization come before any lookup', () => {
    beforeEach(() => {
      answer({ state: 'asset', asset: readyAsset() });
    });

    it('a row of another provider is not looked up', async () => {
      const { id } = await seedVideo({ provider: 'mux' });
      expect(mediaAssetSchema.parse(await (await read(id)).json()).status).toBe('pending');
      expect(fakeVideoInternals.uploadStateCalls).toEqual([]);
    });

    it('a row without a provider upload id is not looked up', async () => {
      const { id } = await seedVideo({ providerAssetId: null });
      expect(mediaAssetSchema.parse(await (await read(id)).json()).status).toBe('pending');
      expect(fakeVideoInternals.uploadStateCalls).toEqual([]);
    });

    it('a terminal row is not looked up', async () => {
      const { id } = await seedVideo({ status: 'failed' });
      expect(mediaAssetSchema.parse(await (await read(id)).json()).status).toBe('failed');
      expect(fakeVideoInternals.uploadStateCalls).toEqual([]);
    });

    it("a member reading the admin's stale video gets the bare 404 and triggers nothing", async () => {
      const { id } = await seedVideo();
      const res = await read(id, memberToken);
      expect(res.status).toBe(404);
      const error = ((await res.json()) as Envelope).error;
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toBeUndefined();
      expect(fakeVideoInternals.uploadStateCalls).toEqual([]);
      expect((await dbRow(id)).status).toBe('pending');
    });
  });
});
