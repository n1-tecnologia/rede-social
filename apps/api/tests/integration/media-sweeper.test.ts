import { sqlClient } from '@tria/core/db';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { MEDIA_SWEEP_BATCH } from '@tria/core/server/media/limits';
import {
  MEDIA_SWEEP_QUEUE,
  MEDIA_SWEEP_SINGLETON,
  sweepOrphansJob,
} from '@tria/core/server/media/sweep-job';
import { encodeJpeg } from '@tria/core/server/media/variants';
import { fakeVideoInternals, resetFakeVideoInternals } from '@tria/core/server/media/video/fake';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * `kernel.media-sweep-orphans` (MEDIA-01/MEDIA-02, R-07) against the live local stack — the
 * lifecycle half 03-01 deliberately left open, closed here.
 *
 * The tracer is one honest path: a member starts an upload from a phone, the bytes really reach the
 * private `media` bucket, and then nothing ever confirms it — the tab was closed, the train went
 * into a tunnel. Twenty-five hours later (one hour past the Supabase TUS URL's own 24 h validity,
 * which is what `MEDIA_PENDING_TTL_MS` is aligned to) the sweeper collects it: the OBJECTS go first,
 * then the row, and the run queues the next run an hour out under a constant `singletonKey` — the
 * whole cadence, with no scheduler existing anywhere in this repo.
 *
 * The sweeper is deliberately GLOBAL (it has no tenant parameter — an orphan belongs to no request),
 * so every assertion here is scoped to ids this file created. `fileParallelism: false` in
 * `vitest.config.ts` is what makes that safe against the sibling media suites; the age windows are
 * the second guard, since nothing another file created seconds ago can be 24 hours old.
 */

const MEMBER_EMAIL = 'member@tria-demo.local';

const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#0ea5e9"/><circle cx="320" cy="240" r="140" fill="#f59e0b"/></svg>`;

let memberToken = '';
let demoTenantId = '';
let PHOTO_JPEG: Buffer;

const createdAssetIds: string[] = [];

/** `start` only — the signed target and the pending row, with no `complete` behind it. */
async function startUpload(): Promise<{ assetId: string; signedUrl: string; path: string }> {
  const res = await api.request('/v1/media/uploads', {
    method: 'POST',
    headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'image',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: PHOTO_JPEG.length,
      filename: 'foto.jpg',
    }),
  });
  if (res.status !== 201) throw new Error(`start failed: ${res.status}`);
  const body = (await res.json()) as { assetId: string; signedUrl: string; path: string | null };
  createdAssetIds.push(body.assetId);
  return { assetId: body.assetId, signedUrl: body.signedUrl, path: body.path ?? '' };
}

/** The bytes go browser -> Storage, never through the API (MEDIA-01, CLAUDE.md §4). */
async function putBytes(signedUrl: string): Promise<void> {
  const put = await fetch(signedUrl, {
    method: 'PUT',
    body: new Uint8Array(PHOTO_JPEG),
    headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
  });
  if (!put.ok) throw new Error(`PUT to Storage failed: ${put.status}`);
}

async function assetStatus(assetId: string): Promise<string | null> {
  const rows = await adminSql<{ status: string }[]>`
    select status from public.media_assets where id = ${assetId}::uuid`;
  return rows[0]?.status ?? null;
}

async function objectCount(assetId: string): Promise<number> {
  const rows = await adminSql<{ n: number }[]>`
    select count(*)::int as n from storage.objects
     where bucket_id = 'media' and name like ${`${demoTenantId}/media/${assetId}/%`}`;
  return rows[0]?.n ?? 0;
}

async function sweepJobs(): Promise<{ singleton_key: string | null; future: boolean }[]> {
  return adminSql<{ singleton_key: string | null; future: boolean }[]>`
    select singleton_key, (start_after > now()) as future
      from pgboss.job_common
     where name = ${MEDIA_SWEEP_QUEUE} and state = 'created'`;
}

/** The sweeper's own queue rows are fixtures here: cleared before each assertion about the re-arm. */
async function clearSweepJobs(): Promise<void> {
  await adminSql`delete from pgboss.job_common where name = ${MEDIA_SWEEP_QUEUE}`;
}

async function cleanup(): Promise<void> {
  for (const id of [...new Set(createdAssetIds)]) {
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
  }
  createdAssetIds.length = 0;
  await clearSweepJobs();
}

/**
 * A row in a KNOWN state, written straight through the admin connection. The ingest path is proved
 * end to end by the tracer above and by `media.test.ts`; what these cases are about is which rows
 * the PREDICATE selects, which does not depend on how a row got there — and writing it directly is
 * the only way to place a `processing`, `failed` or `rejected` row at an arbitrary age.
 */
async function seedAsset(values: {
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'rejected' | 'deleted';
  kind?: 'image' | 'video';
  ageHours?: number;
  deletedMinutesAgo?: number | null;
  providerAssetId?: string | null;
}): Promise<string> {
  const rows = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, created_at, deleted_at)
    select ${demoTenantId}::uuid, u.id, ${values.kind ?? 'image'},
           ${values.kind === 'video' ? 'post' : 'avatar'}, ${values.status},
           ${values.providerAssetId ? 'fake' : 'supabase'}, ${values.providerAssetId ?? null},
           ${values.providerAssetId ? `fake-playback-${values.providerAssetId}` : null},
           ${values.kind === 'video' ? 'video/mp4' : 'image/jpeg'}, 1024,
           now() - make_interval(hours => ${values.ageHours ?? 0}::int),
           case when ${values.deletedMinutesAgo ?? null}::int is null then null
                else now() - make_interval(mins => ${values.deletedMinutesAgo ?? null}::int) end
      from public.users u where u.email = ${MEMBER_EMAIL}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error('could not seed a media asset');
  createdAssetIds.push(id);
  return id;
}

/**
 * Runs the sweeper until it collects nothing, so a case that counts what a run collected is not
 * measuring a sibling file's leftovers. The sweeper is global by design; this is the test-side
 * consequence of that, not a workaround.
 */
async function drain(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    const before = await collectableCount();
    if (before === 0) return;
    await sweepOrphansJob.handler({});
  }
}

/** How many rows the sweeper's own predicate would select right now, asked in the same SQL. */
async function collectableCount(): Promise<number> {
  const rows = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.media_assets
     where (status = 'pending' and created_at < now() - interval '24 hours')
        or (status in ('deleted','rejected')
            and coalesce(deleted_at, created_at) < now() - interval '1 hour')`;
  return rows[0]?.n ?? 0;
}

async function existingIds(ids: readonly string[]): Promise<number> {
  const rows = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.media_assets where id = any(${ids as string[]}::uuid[])`;
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  memberToken = await signInAs(MEMBER_EMAIL, SEED_PASSWORD);
  const [tenant] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'tria-demo'`;
  if (!tenant) throw new Error('the tria-demo tenant is not seeded');
  demoTenantId = tenant.id;
  PHOTO_JPEG = await encodeJpeg(Buffer.from(PHOTO_SVG));
  await clearSweepJobs();
});

afterAll(async () => {
  await cleanup();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer — an abandoned upload disappears, bytes first, and the run queues the next one', () => {
  it('collects a pending asset 25 hours old: the objects go, then the row, and the sweeper re-arms', async () => {
    const started = await startUpload();
    await putBytes(started.signedUrl);

    // The honest starting state: a real object in the private bucket and a pending row pointing at it.
    expect(started.path).toBe(`${demoTenantId}/media/${started.assetId}/original`);
    expect(await assetStatus(started.assetId)).toBe('pending');
    expect(await objectCount(started.assetId)).toBe(1);

    // 25 hours: one hour PAST the Supabase TUS upload URL's own 24 h validity, so by construction
    // nothing legitimate could still have completed this upload.
    await adminSql`
      update public.media_assets
         set created_at = now() - interval '25 hours'
       where id = ${started.assetId}::uuid`;

    await clearSweepJobs();
    await sweepOrphansJob.handler({});

    expect(await assetStatus(started.assetId)).toBeNull();
    expect(await objectCount(started.assetId)).toBe(0);

    const queued = await sweepJobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.singleton_key).toBe(MEDIA_SWEEP_SINGLETON);
    expect(MEDIA_SWEEP_SINGLETON).toBe('media-sweep');
    // `start_after` in the future IS the cadence: the next run is deferred, not immediate.
    expect(queued[0]?.future).toBe(true);
  });

  it('leaves an upload that is only 23 hours old alone — the window is a fact, not a heuristic', async () => {
    const started = await startUpload();
    await putBytes(started.signedUrl);
    await adminSql`
      update public.media_assets
         set created_at = now() - interval '23 hours'
       where id = ${started.assetId}::uuid`;

    await sweepOrphansJob.handler({});

    expect(await assetStatus(started.assetId)).toBe('pending');
    expect(await objectCount(started.assetId)).toBe(1);
  });

  it('the queue really carries the `short` policy, which is what keeps ONE sweeper queued', async () => {
    const [queue] = await adminSql<{ policy: string }[]>`
      select policy from pgboss.queue where name = ${MEDIA_SWEEP_QUEUE}`;
    expect(queue?.policy).toBe('short');

    // A second arm while the first is still `created` is dropped by the `job_i1` partial index.
    await clearSweepJobs();
    await sweepOrphansJob.handler({});
    await sweepOrphansJob.handler({});
    expect(await sweepJobs()).toHaveLength(1);
  });
});

describe('safety — the sweeper touches ONLY what the two windows name (T-03-53)', () => {
  it('leaves a `processing` and a `ready` asset alone even at 48 hours old', async () => {
    const processing = await seedAsset({ status: 'processing', ageHours: 48 });
    const ready = await seedAsset({ status: 'ready', ageHours: 48 });

    await sweepOrphansJob.handler({});

    // Out of scope by CONSTRUCTION: neither status appears in either window's status list, so no
    // runtime guard has to remember them and no later edit can invert one.
    expect(await assetStatus(processing)).toBe('processing');
    expect(await assetStatus(ready)).toBe('ready');
  });

  it('keeps a `deleted` asset for the first hour and collects it after it', async () => {
    const fresh = await seedAsset({ status: 'deleted', ageHours: 5, deletedMinutesAgo: 30 });
    const stale = await seedAsset({ status: 'deleted', ageHours: 5, deletedMinutesAgo: 90 });

    await sweepOrphansJob.handler({});

    // 30 minutes: a member who removes their photo and puts it back is not racing the collector.
    expect(await assetStatus(fresh)).toBe('deleted');
    expect(await assetStatus(stale)).toBeNull();
  });

  it('collects a `rejected` asset older than an hour', async () => {
    const rejected = await seedAsset({ status: 'rejected', ageHours: 3 });
    const freshReject = await seedAsset({ status: 'rejected', ageHours: 0 });

    await sweepOrphansJob.handler({});

    expect(await assetStatus(rejected)).toBeNull();
    expect(await assetStatus(freshReject)).toBe('rejected');
  });

  it('measures the age with the DATABASE clock: `deleted_at` wins over `created_at`', async () => {
    // Created a week ago, soft-deleted a minute ago — the row is young by the window that applies.
    const id = await seedAsset({ status: 'deleted', ageHours: 168, deletedMinutesAgo: 1 });
    await sweepOrphansJob.handler({});
    expect(await assetStatus(id)).toBe('deleted');
  });
});

describe('bounded and idempotent — one run cannot stall the worker, and re-running is free', () => {
  it(`collects exactly MEDIA_SWEEP_BATCH rows per run and the re-armed run takes the rest`, async () => {
    await drain();
    const ids: string[] = [];
    for (let i = 0; i < MEDIA_SWEEP_BATCH + 5; i += 1) {
      ids.push(await seedAsset({ status: 'rejected', ageHours: 2 }));
    }
    expect(await existingIds(ids)).toBe(MEDIA_SWEEP_BATCH + 5);

    await sweepOrphansJob.handler({});
    expect(await existingIds(ids)).toBe(5);

    await sweepOrphansJob.handler({});
    expect(await existingIds(ids)).toBe(0);
  });

  it('re-running over the same set converges: a row whose prefix is already empty is still deleted', async () => {
    // No object was ever uploaded for this row, so `listObjects` answers an empty prefix. The purge
    // must still delete the row — otherwise a single failed upload would be collected forever.
    const id = await seedAsset({ status: 'pending', ageHours: 30 });
    await sweepOrphansJob.handler({});
    expect(await assetStatus(id)).toBeNull();

    // And a second run over the same (now empty) set is a no-op rather than an error.
    await sweepOrphansJob.handler({});
    expect(await assetStatus(id)).toBeNull();
  });
});

describe('the provider path — a collected video does not linger at the vendor', () => {
  it('deletes the provider asset through the seam, then the row', async () => {
    resetFakeVideoInternals();
    try {
      const providerAssetId = `fake-sweep-${Date.now()}`;
      const id = await seedAsset({
        status: 'deleted',
        kind: 'video',
        ageHours: 5,
        deletedMinutesAgo: 120,
        providerAssetId,
      });

      await sweepOrphansJob.handler({});

      expect(fakeVideoInternals.deletedAssetIds).toContain(providerAssetId);
      expect(await assetStatus(id)).toBeNull();
    } finally {
      resetFakeVideoInternals();
    }
  });

  it('a provider that REFUSES leaves the row for the next run instead of orphaning the asset', async () => {
    resetFakeVideoInternals();
    const providerAssetId = `fake-sweep-refused-${Date.now()}`;
    const id = await seedAsset({
      status: 'deleted',
      kind: 'video',
      ageHours: 5,
      deletedMinutesAgo: 120,
      providerAssetId,
    });

    try {
      fakeVideoInternals.failDeleteAsset = true;
      await sweepOrphansJob.handler({});
      // The row SURVIVES: deleting it here would have left a vendor-side asset nothing can find.
      expect(await assetStatus(id)).toBe('deleted');
      expect(fakeVideoInternals.deletedAssetIds).not.toContain(providerAssetId);
    } finally {
      fakeVideoInternals.failDeleteAsset = false;
    }

    // …and the next run, once the provider answers again, collects it.
    await sweepOrphansJob.handler({});
    expect(fakeVideoInternals.deletedAssetIds).toContain(providerAssetId);
    expect(await assetStatus(id)).toBeNull();
    resetFakeVideoInternals();
  });
});
