import { createClient } from '@supabase/supabase-js';
import { sqlClient } from '@tria/core/db';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { mediaProviderEventJob } from '@tria/core/server/media/video/event-job';
import {
  FAKE_VIDEO_SIGNATURE_HEADER,
  signFakeVideoWebhook,
} from '@tria/core/server/media/video/fake';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    await adminSql`delete from public.media_assets where tenant_id = ${demoTenantId}::uuid and kind = 'video'`;
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
});
