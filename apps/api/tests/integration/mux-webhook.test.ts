import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { MEDIA_LIMITS } from '@tria/contracts/media';
import { sqlClient } from '@tria/core/db';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { MEDIA_TENANT_VIDEO_SECONDS_CEILING } from '@tria/core/server/media/limits';
import { mediaProviderEventJob } from '@tria/core/server/media/video/event-job';
import {
  FAKE_VIDEO_SIGNATURE_HEADER,
  fakeVideoInternals,
  resetFakeVideoInternals,
  signFakeVideoWebhook,
} from '@tria/core/server/media/video/fake';
import type { VideoProviderEvent } from '@tria/core/server/media/video/types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * MEDIA-03 — video ingest against the live local stack, entirely through `VIDEO_PROVIDER=fake`
 * (the env default). No Mux account exists and Phase 01.1 has not run: the real transcode and the
 * real-device HLS playback are known-blocked Phase 01.1 UAT lines, recorded in `docs/DEPLOY.md`.
 *
 * The tracer is one path through every layer: an `admin_tenant` starts a video upload -> the bytes
 * go STRAIGHT to the provider's target (which, for the fake, is the same PRIVATE `media` bucket, so
 * the "no bytes through Cloud Run" invariant is exercised for real) -> a correctly SIGNED webhook
 * lands at the unauthenticated `POST /v1/webhooks/mux` -> the event id is recorded exactly once and
 * exactly one `kernel.media-provider-event` job is enqueued under `singletonKey = event.id` -> the
 * job flips the asset to `ready` with its playback id, duration and aspect ratio.
 *
 * The signature is built with the fake adapter's OWN signer, which HMACs the same
 * `timestamp.rawBody` message the real verifier does over the same header — so the route's 403
 * branch is reachable locally without a Mux secret.
 */

const ADMIN_EMAIL = 'admin@tria-demo.local';
const MEMBER_EMAIL = 'member@tria-demo.local';
const WEBHOOK_PATH = '/v1/webhooks/mux';

/** A tiny but REAL mp4 container (ftyp + a minimal moov), enough for a Storage PUT to accept it. */
const MP4_FIXTURE = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAB9tZGF0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACG1vb3Y=',
  'base64',
);

let adminToken = '';
let memberToken = '';
let demoTenantId = '';

const createdAssetIds: string[] = [];
const createdEventIds: string[] = [];

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

async function startVideo(body: Record<string, unknown>, token = adminToken): Promise<Response> {
  return api.request('/v1/media/uploads', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'video', purpose: 'post', mime: 'video/mp4', ...body }),
  });
}

/** The provider's WIRE shape — what Mux really posts, so the normaliser is exercised, not bypassed. */
function readyBody(opts: {
  eventId: string;
  assetId: string;
  providerAssetId: string;
  playbackId?: string;
  duration?: number;
  aspectRatio?: string;
}): string {
  return JSON.stringify({
    id: opts.eventId,
    type: 'video.asset.ready',
    created_at: new Date().toISOString(),
    object: { type: 'asset', id: opts.providerAssetId },
    environment: { name: 'local', id: 'local' },
    data: {
      id: opts.providerAssetId,
      status: 'ready',
      passthrough: opts.assetId,
      duration: opts.duration ?? 12.4,
      aspect_ratio: opts.aspectRatio ?? '16:9',
      playback_ids: [{ id: opts.playbackId ?? `pb-${opts.assetId}`, policy: 'signed' }],
    },
  });
}

async function postWebhook(
  raw: string,
  opts: { timestamp?: number; signature?: string; omitSignature?: boolean } = {},
): Promise<Response> {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!opts.omitSignature) {
    headers[FAKE_VIDEO_SIGNATURE_HEADER] = opts.signature ?? signFakeVideoWebhook(raw, timestamp);
  }
  return api.request(WEBHOOK_PATH, { method: 'POST', headers, body: raw });
}

/** The post cap the ready handler compares against — read from the contract, never hard-coded. */
const POST_MAX_DURATION_S = MEDIA_LIMITS.video.post?.maxDurationSeconds ?? 0;

/**
 * An `admin_tenant` video asset in `pending`, through the real broker (so the row really carries
 * the provider and its upload id). The bytes are not uploaded: every case below is about what the
 * WEBHOOK does to the row, which does not depend on the object existing.
 */
async function startVideoAsset(): Promise<{ assetId: string; providerAssetId: string }> {
  const res = await startVideo({ size: MP4_FIXTURE.length });
  if (res.status !== 201) throw new Error(`start failed: ${res.status}`);
  const { assetId } = (await res.json()) as { assetId: string };
  createdAssetIds.push(assetId);
  const row = await assetRow(assetId);
  return { assetId, providerAssetId: row?.provider_asset_id ?? '' };
}

/** The NORMALISED event the job consumes — what `verifyWebhook` would have produced. */
function readyEvent(opts: {
  eventId: string;
  assetId: string;
  providerAssetId: string;
  durationSeconds?: number;
}): VideoProviderEvent {
  return {
    id: opts.eventId,
    kind: 'ready',
    rawType: 'video.asset.ready',
    assetId: opts.assetId,
    providerAssetId: opts.providerAssetId,
    playbackId: `pb-${opts.assetId}`,
    durationSeconds: opts.durationSeconds ?? 12,
    aspectRatio: '16:9',
    failureReason: null,
  };
}

function erroredEvent(opts: {
  eventId: string;
  assetId: string;
  providerAssetId: string;
}): VideoProviderEvent {
  return {
    id: opts.eventId,
    kind: 'errored',
    rawType: 'video.asset.errored',
    assetId: opts.assetId,
    providerAssetId: opts.providerAssetId,
    playbackId: null,
    durationSeconds: null,
    aspectRatio: null,
    failureReason: 'video.asset.errored',
  };
}

async function assetRow(assetId: string) {
  const rows = await adminSql<
    {
      status: string;
      provider: string;
      provider_asset_id: string | null;
      playback_id: string | null;
      duration_seconds: number | null;
      aspect_ratio: string | null;
      failure_reason: string | null;
    }[]
  >`select status, provider, provider_asset_id, playback_id, duration_seconds, aspect_ratio, failure_reason
      from public.media_assets where id = ${assetId}::uuid`;
  return rows[0];
}

async function eventRows(eventId: string) {
  return adminSql<{ id: string; provider: string; type: string }[]>`
    select id, provider, type from public.media_provider_events where id = ${eventId}`;
}

async function eventJobs(singletonKey: string) {
  return adminSql<{ state: string; singleton_key: string }[]>`
    select state, singleton_key from pgboss.job_common
     where name = 'kernel.media-provider-event' and singleton_key = ${singletonKey}
     order by created_on`;
}

/** Service-key Storage client for fixture cleanup only (direct deletes from storage.objects fail). */
function storageAdmin() {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
}

async function cleanup(): Promise<void> {
  if (demoTenantId) {
    const objects = await adminSql<{ name: string }[]>`
      select name from storage.objects where bucket_id = 'media' and name like ${`${demoTenantId}/media/%`}`;
    if (objects.length > 0) {
      const { error } = await storageAdmin()
        .from('media')
        .remove(objects.map((row) => row.name));
      if (error) throw new Error(`storage cleanup failed: ${error.message}`);
    }
    // 04-04: `feed_post_media.media_asset_id` references this table, and `scripts/seed.ts` attaches
    // real assets to the seeded gallery/video/attachment posts. The sweep below exists to clear a
    // previous run's leftovers, so it must skip anything a post still points at — otherwise it
    // fails on the foreign key AND destroys seeded content the e2e measures.
    // 05-05 adds a SECOND referencing table: `stories.media_asset_id` is NOT NULL and real, so a
    // story's asset must be skipped for exactly the reason a post's is — the sweep would fail on
    // the foreign key AND destroy the seeded strip the e2e measures.
    await adminSql`
      delete from public.media_assets
       where tenant_id = ${demoTenantId}::uuid and kind = 'video'
         and id not in (select media_asset_id from public.feed_post_media)
         and id not in (select media_asset_id from public.stories)`;
  }
  for (const id of [...new Set(createdEventIds)]) {
    await adminSql`delete from public.media_provider_events where id = ${id}`;
    await adminSql`delete from pgboss.job_common where name = 'kernel.media-provider-event' and singleton_key = ${id}`;
  }
  for (const id of [...new Set(createdAssetIds)]) {
    await adminSql`
      delete from pgboss.job_common
       where name = 'kernel.media-provider-event' and singleton_key = ${`fake-ready-${id}`}`;
  }
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  adminToken = await signInAs(ADMIN_EMAIL, SEED_PASSWORD);
  memberToken = await signInAs(MEMBER_EMAIL, SEED_PASSWORD);
  const [tenant] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'tria-demo'`;
  if (!tenant) throw new Error('the tria-demo tenant is not seeded');
  demoTenantId = tenant.id;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer — an admin uploads a video, a signed webhook lands, and the job makes it ready (MEDIA-03)', () => {
  let assetId = '';
  let providerAssetId = '';
  let signedUrl = '';
  let eventId = '';

  it('1. POST /v1/media/uploads { kind: video } mints a provider direct-upload target and records a pending row', async () => {
    const res = await startVideo({ size: MP4_FIXTURE.length, filename: 'festa.mp4' });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = (await res.json()) as {
      assetId: string;
      provider: string;
      signedUrl: string;
      token: string | null;
      path: string | null;
      maxBytes: number;
    };
    assetId = body.assetId;
    signedUrl = body.signedUrl;
    createdAssetIds.push(assetId);

    // The seam, not the vendor: the row says which implementation brokered it.
    expect(body.provider).toBe('fake');
    expect(body.signedUrl).toContain(`/object/upload/sign/media/${demoTenantId}/media/${assetId}/`);
    // The provider owns the object — there is no Storage token and no object name to hand back.
    expect(body.token).toBeNull();
    expect(body.path).toBeNull();
    expect(body.maxBytes).toBe(500 * 1024 * 1024);

    const row = await assetRow(assetId);
    expect(row?.status).toBe('pending');
    expect(row?.provider).toBe('fake');
    expect(row?.provider_asset_id).toBeTruthy();
    providerAssetId = row?.provider_asset_id ?? '';
  });

  it('2. the browser PUTs the bytes STRAIGHT to the provider target — they never transit the API', async () => {
    const put = await fetch(signedUrl, {
      method: 'PUT',
      body: new Uint8Array(MP4_FIXTURE),
      headers: { 'content-type': 'video/mp4', 'x-upsert': 'false' },
    });
    expect(put.ok).toBe(true);

    const rows = await adminSql<{ name: string }[]>`
      select name from storage.objects
       where bucket_id = 'media' and name = ${`${demoTenantId}/media/${assetId}/original`}`;
    expect(rows.length).toBe(1);
  });

  it('3. a correctly signed webhook is recorded ONCE and enqueues exactly ONE job under singletonKey = event id', async () => {
    eventId = `evt-tracer-${assetId}`;
    createdEventIds.push(eventId);
    const raw = readyBody({ eventId, assetId, providerAssetId });

    const res = await postWebhook(raw);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ received: true, enqueued: true });

    const events = await eventRows(eventId);
    expect(events.length).toBe(1);
    expect(events[0]?.provider).toBe('fake');
    expect(events[0]?.type).toBe('video.asset.ready');

    const jobs = await eventJobs(eventId);
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.singleton_key).toBe(eventId);
  });

  it('4. the job flips the asset to ready with its playback id, duration and aspect ratio', async () => {
    await mediaProviderEventJob.handler({
      id: eventId,
      kind: 'ready',
      rawType: 'video.asset.ready',
      assetId,
      providerAssetId,
      playbackId: `pb-${assetId}`,
      durationSeconds: 12,
      aspectRatio: '16:9',
      failureReason: null,
    });

    const row = await assetRow(assetId);
    expect(row?.status).toBe('ready');
    expect(row?.playback_id).toBe(`pb-${assetId}`);
    expect(row?.duration_seconds).toBe(12);
    expect(row?.aspect_ratio).toBe('16:9');
    expect(row?.failure_reason).toBeNull();
  });

  it('5. there is no complete call on the video path — the webhook is what makes an asset ready', async () => {
    const res = await api.request(`/v1/media/uploads/${assetId}/complete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    // `complete` is idempotent for an already-`ready` row: it answers the asset unchanged and
    // enqueues nothing. 03-07 adds the admin list route; for now the row itself is the assertion.
    expect(res.status).toBe(200);
    const row = await assetRow(assetId);
    expect(row?.status).toBe('ready');
    expect(row?.playback_id).toBe(`pb-${assetId}`);
  });
});

describe('the role gate at start — V1 publishes admin-only (T-03-44)', () => {
  it('a MEMBER starting a video upload is refused 403 FORBIDDEN and creates no row', async () => {
    const before = await adminSql<{ count: string }[]>`
      select count(*)::text as count from public.media_assets
       where tenant_id = ${demoTenantId}::uuid and kind = 'video'`;

    const res = await startVideo({ size: MP4_FIXTURE.length }, memberToken);
    expect(res.status).toBe(403);
    expect((await envelope(res)).code).toBe('FORBIDDEN');

    const after = await adminSql<{ count: string }[]>`
      select count(*)::text as count from public.media_assets
       where tenant_id = ${demoTenantId}::uuid and kind = 'video'`;
    expect(after[0]?.count).toBe(before[0]?.count);
  });

  it('an admin at the stored-minutes ceiling is refused 413 quota_exceeded, and accepted once it lifts', async () => {
    // Pad the community to the ceiling with a `ready` video that costs the whole budget.
    const padding = randomUUID();
    createdAssetIds.push(padding);
    await adminSql`
      insert into public.media_assets
        (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, duration_seconds)
      select ${padding}::uuid, ${demoTenantId}::uuid, m.user_id, 'video', 'post', 'ready', 'fake',
             'video/mp4', 1024, ${MEDIA_TENANT_VIDEO_SECONDS_CEILING}
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${demoTenantId}::uuid and u.email = ${ADMIN_EMAIL}`;

    const refused = await startVideo({ size: MP4_FIXTURE.length });
    expect(refused.status).toBe(413);
    expect((await envelope(refused)).details?.media).toBe('quota_exceeded');

    // A soft delete takes the padding out of the sum, so the ceiling lifts.
    await adminSql`
      update public.media_assets set status = 'deleted', deleted_at = now() where id = ${padding}::uuid`;
    const accepted = await startVideo({ size: MP4_FIXTURE.length });
    expect(accepted.status).toBe(201);
    createdAssetIds.push(((await accepted.json()) as { assetId: string }).assetId);
  });
});

describe('the signature IS the authentication — nothing else gets in (T-03-37)', () => {
  const body = () =>
    readyBody({
      eventId: `evt-sig-${randomUUID()}`,
      assetId: randomUUID(),
      providerAssetId: `pa-${randomUUID()}`,
    });

  async function expectRefused(res: Response, eventId: string) {
    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toEqual({ error: { code: 'FORBIDDEN' } });
    // Nothing was recorded and nothing was enqueued: a refused delivery leaves no trace to replay.
    expect(await eventRows(eventId)).toHaveLength(0);
    expect(await eventJobs(eventId)).toHaveLength(0);
  }

  it('no signature header at all → 403', async () => {
    const raw = body();
    const eventId = (JSON.parse(raw) as { id: string }).id;
    await expectRefused(await postWebhook(raw, { omitSignature: true }), eventId);
  });

  it('a signature computed over a DIFFERENT body → 403', async () => {
    const raw = body();
    const eventId = (JSON.parse(raw) as { id: string }).id;
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signFakeVideoWebhook(`${raw} tampered`, timestamp);
    await expectRefused(await postWebhook(raw, { timestamp, signature }), eventId);
  });

  it('a perfectly valid signature that is TEN MINUTES old → 403 (the replay window)', async () => {
    const raw = body();
    const eventId = (JSON.parse(raw) as { id: string }).id;
    const stale = Math.floor(Date.now() / 1000) - 600;
    await expectRefused(await postWebhook(raw, { timestamp: stale }), eventId);
  });
});

describe('a delivery arriving twice changes state exactly once (T-03-38, Pitfall 6)', () => {
  it('the second POST answers { enqueued: false } and leaves ONE event row and ONE job', async () => {
    const { assetId, providerAssetId } = await startVideoAsset();
    const eventId = `evt-replay-${assetId}`;
    createdEventIds.push(eventId);
    const raw = readyBody({ eventId, assetId, providerAssetId, duration: 30 });
    const signature = signFakeVideoWebhook(raw, Math.floor(Date.now() / 1000));
    const timestamp = Math.floor(Date.now() / 1000);

    const first = await postWebhook(raw, {
      timestamp,
      signature: signFakeVideoWebhook(raw, timestamp),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, enqueued: true });

    const second = await postWebhook(raw, {
      timestamp,
      signature: signFakeVideoWebhook(raw, timestamp),
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, enqueued: false });
    expect(signature).toBeTruthy();

    expect(await eventRows(eventId)).toHaveLength(1);
    expect(await eventJobs(eventId)).toHaveLength(1);
  });

  it('running the handler twice leaves the asset ready with the SAME values', async () => {
    const { assetId, providerAssetId } = await startVideoAsset();
    const event = readyEvent({ eventId: `evt-twice-${assetId}`, assetId, providerAssetId });

    await mediaProviderEventJob.handler(event);
    const once = await assetRow(assetId);
    await mediaProviderEventJob.handler(event);
    const twice = await assetRow(assetId);

    expect(once?.status).toBe('ready');
    expect(twice).toEqual(once);
  });
});

describe('out-of-order delivery cannot clobber a good row (T-03-39, Pitfall 6)', () => {
  it('an errored event arriving AFTER a ready leaves the asset ready and its reason null', async () => {
    const { assetId, providerAssetId } = await startVideoAsset();
    await mediaProviderEventJob.handler(
      readyEvent({ eventId: `evt-ooo-ready-${assetId}`, assetId, providerAssetId }),
    );
    await mediaProviderEventJob.handler(
      erroredEvent({ eventId: `evt-ooo-err-${assetId}`, assetId, providerAssetId }),
    );

    const row = await assetRow(assetId);
    expect(row?.status).toBe('ready');
    expect(row?.failure_reason).toBeNull();
  });

  it('an errored event arriving FIRST flips to failed, and a later ready still recovers', async () => {
    const { assetId, providerAssetId } = await startVideoAsset();
    await mediaProviderEventJob.handler(
      erroredEvent({ eventId: `evt-rec-err-${assetId}`, assetId, providerAssetId }),
    );
    const failed = await assetRow(assetId);
    expect(failed?.status).toBe('failed');
    expect(failed?.failure_reason).toBe('video.asset.errored');

    await mediaProviderEventJob.handler(
      readyEvent({ eventId: `evt-rec-ready-${assetId}`, assetId, providerAssetId }),
    );
    const recovered = await assetRow(assetId);
    expect(recovered?.status).toBe('ready');
    expect(recovered?.failure_reason).toBeNull();
  });
});

describe('the per-purpose duration cap: a too-long video is rejected AND deleted at the provider (R-02)', () => {
  afterEach(() => {
    resetFakeVideoInternals();
  });

  it('a duration above the post cap flips the row to rejected/duration_too_long and deletes the provider asset', async () => {
    const { assetId, providerAssetId } = await startVideoAsset();
    fakeVideoInternals.deletedAssetIds = [];

    await mediaProviderEventJob.handler(
      readyEvent({
        eventId: `evt-long-${assetId}`,
        assetId,
        providerAssetId,
        durationSeconds: POST_MAX_DURATION_S + 1,
      }),
    );

    const row = await assetRow(assetId);
    expect(row?.status).toBe('rejected');
    expect(row?.failure_reason).toBe('duration_too_long');
    expect(row?.playback_id).toBeNull();
    expect(fakeVideoInternals.deletedAssetIds).toEqual([providerAssetId]);
  });

  it('a duration EXACTLY at the cap is accepted — the comparison is `>`, not `>=`', async () => {
    const { assetId, providerAssetId } = await startVideoAsset();
    fakeVideoInternals.deletedAssetIds = [];

    await mediaProviderEventJob.handler(
      readyEvent({
        eventId: `evt-exact-${assetId}`,
        assetId,
        providerAssetId,
        durationSeconds: POST_MAX_DURATION_S,
      }),
    );

    const row = await assetRow(assetId);
    expect(row?.status).toBe('ready');
    expect(row?.duration_seconds).toBe(POST_MAX_DURATION_S);
    expect(fakeVideoInternals.deletedAssetIds).toEqual([]);
  });
});

describe('a failed transcode ends in a terminal state the UI can render (R-03)', () => {
  it('video.asset.errored flips the row to failed with the event TYPE as the reason, and leaks no provider text', async () => {
    const { assetId, providerAssetId } = await startVideoAsset();
    const eventId = `evt-failed-${assetId}`;
    createdEventIds.push(eventId);

    // A realistic errored delivery whose payload carries a chatty provider message.
    const raw = JSON.stringify({
      id: eventId,
      type: 'video.asset.errored',
      data: {
        id: providerAssetId,
        status: 'errored',
        passthrough: assetId,
        errors: {
          type: 'invalid_input',
          messages: ['could not decode the source file: internal-mux-trace-abc123'],
        },
      },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await postWebhook(raw, {
      timestamp,
      signature: signFakeVideoWebhook(raw, timestamp),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, enqueued: true });

    await mediaProviderEventJob.handler(erroredEvent({ eventId, assetId, providerAssetId }));

    const row = await assetRow(assetId);
    expect(row?.status).toBe('failed');
    expect(row?.failure_reason).toBe('video.asset.errored');
    // The provider's own message never reaches the row (T-03-41).
    expect(JSON.stringify(row)).not.toContain('internal-mux-trace-abc123');

    // Nor the event inbox, which records the TYPE and nothing else.
    const [recorded] = await eventRows(eventId);
    expect(recorded?.type).toBe('video.asset.errored');
    expect(JSON.stringify(recorded)).not.toContain('internal-mux-trace-abc123');
  });
});

describe('an event naming no asset of ours resolves without throwing', () => {
  it('a passthrough uuid with no row logs `gone` and changes nothing', async () => {
    const orphan = randomUUID();
    await expect(
      mediaProviderEventJob.handler(
        readyEvent({
          eventId: `evt-orphan-${orphan}`,
          assetId: orphan,
          providerAssetId: `pa-${orphan}`,
        }),
      ),
    ).resolves.toBeUndefined();

    const rows = await adminSql<{ count: string }[]>`
      select count(*)::text as count from public.media_assets where id = ${orphan}::uuid`;
    expect(rows[0]?.count).toBe('0');
  });

  it('a malformed job payload is dropped rather than crashing the worker', async () => {
    await expect(mediaProviderEventJob.handler({ nope: true } as never)).resolves.toBeUndefined();
  });
});
