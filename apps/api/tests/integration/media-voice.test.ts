import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { deriveVariantsJob } from '@rede-social/core/server/media/derive-job';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * VOICE-14..17 / VOICE-26 (12.5-02) — the voice pipeline against the live local stack: the real
 * private `media` bucket, the real pg-boss queue, the worker handler driven in-process and the REAL
 * ffmpeg/ffprobe on PATH (the image and CI get them in 12.5-03).
 *
 * The tracer is one path through every layer: `start` for `audio`/`voice` -> the bytes go straight to
 * Storage -> `complete` checks the signature and enqueues the derive job -> the worker normalizes to
 * one mono AAC `audio/mp4` object over the same `original` key and measures its duration -> the row is
 * `ready` -> `GET /original` answers a 302 to a signed URL that honours `Range` (probe A3).
 */

const MEMBER_EMAIL = 'member@rede-demo.local';

const WEBM_2S = readFileSync(
  fileURLToPath(new URL('../fixtures/audio/voice-2s.webm', import.meta.url)),
);

const execFileP = promisify(execFile);

let memberToken = '';
let demoTenantId = '';
/** Generated inputs (a 305 second take, a video-only MP4): built at test time, removed in `afterAll`. */
let scratchDir = '';

const createdAssetIds: string[] = [];

const media = (
  path: string,
  init: { method?: string; body?: unknown; token?: string; redirect?: 'follow' | 'manual' } = {},
) =>
  api.request(`/v1/media${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${init.token ?? memberToken}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    ...(init.redirect ? { redirect: init.redirect } : {}),
  });

type StartBody = { kind: string; purpose: string; mime: string; size: number; filename?: string };

async function startUpload(body: StartBody, token?: string) {
  return media('/uploads', { method: 'POST', body, token });
}

async function putToSignedUrl(signedUrl: string, bytes: Buffer, contentType: string) {
  return fetch(signedUrl, {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: { 'content-type': contentType, 'x-upsert': 'false' },
  });
}

async function completeUpload(assetId: string, token?: string) {
  return media(`/uploads/${assetId}/complete`, { method: 'POST', token });
}

type VoiceRow = {
  status: string;
  mime: string;
  bytes: string;
  duration_seconds: number | null;
  failure_reason: string | null;
  ready_at: Date | null;
};

async function assetRow(assetId: string): Promise<VoiceRow | undefined> {
  const rows = await adminSql<VoiceRow[]>`
    select status, mime, bytes::text as bytes, duration_seconds, failure_reason, ready_at
      from public.media_assets where id = ${assetId}::uuid`;
  return rows[0];
}

async function storedObject(
  tenantId: string,
  assetId: string,
): Promise<{ size: number; mimetype: string } | undefined> {
  const rows = await adminSql<{ size: string; mimetype: string }[]>`
    select (metadata->>'size') as size, (metadata->>'mimetype') as mimetype
      from storage.objects
     where bucket_id = 'media' and name = ${`${tenantId}/media/${assetId}/original`}`;
  const row = rows[0];
  return row ? { size: Number(row.size), mimetype: row.mimetype } : undefined;
}

async function deriveJobs(assetId: string) {
  return adminSql<{ state: string; singleton_key: string }[]>`
    select state, singleton_key from pgboss.job_common
     where name = 'kernel.media-derive-variants' and singleton_key = ${assetId}
     order by created_on`;
}

/** Start -> PUT -> complete for one voice take; returns what the next assertions need. */
async function uploadVoice(opts: {
  bytes: Buffer;
  declaredMime: string;
  putContentType?: string;
  token?: string;
}) {
  const start = await startUpload(
    {
      kind: 'audio',
      purpose: 'voice',
      mime: opts.declaredMime,
      size: opts.bytes.length,
    },
    opts.token,
  );
  const startBody = (await start.json()) as { assetId?: string; signedUrl?: string };
  if (startBody.assetId) createdAssetIds.push(startBody.assetId);
  expect(start.status).toBe(201);
  const assetId = startBody.assetId ?? '';
  const put = await putToSignedUrl(
    startBody.signedUrl ?? '',
    opts.bytes,
    opts.putContentType ?? opts.declaredMime,
  );
  expect(put.ok).toBe(true);
  const complete = await completeUpload(assetId, opts.token);
  return { assetId, complete };
}

function storageAdmin() {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
}

async function cleanup(): Promise<void> {
  const ids = [...new Set(createdAssetIds)];
  for (const id of ids) {
    const rows = await adminSql<{ name: string }[]>`
      select name from storage.objects where bucket_id = 'media' and name like ${`%/media/${id}/%`}`;
    if (rows.length > 0) {
      await storageAdmin()
        .from('media')
        .remove(rows.map((row) => row.name));
    }
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
    await adminSql`
      delete from pgboss.job_common
       where name = 'kernel.media-derive-variants' and singleton_key = ${id}`;
  }
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  memberToken = await signInAs(MEMBER_EMAIL, SEED_PASSWORD);
  const [tenant] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-demo'`;
  if (!tenant) throw new Error('the rede-demo tenant is not seeded');
  demoTenantId = tenant.id;
  scratchDir = await mkdtemp(join(tmpdir(), 'voice-it-'));
});

afterAll(async () => {
  if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
  await cleanup();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('voice tracer: a recording becomes a ready AAC asset with its exact duration (VOICE-14, VOICE-15, VOICE-16)', () => {
  let assetId = '';

  it('start, PUT, complete leaves the row processing and queues ONE derive job', async () => {
    const uploaded = await uploadVoice({ bytes: WEBM_2S, declaredMime: 'audio/webm' });
    assetId = uploaded.assetId;
    expect(uploaded.complete.status).toBe(200);
    const body = (await uploaded.complete.json()) as { status: string; kind: string };
    expect(body.status).toBe('processing');
    expect(body.kind).toBe('audio');

    const jobs = await deriveJobs(assetId);
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.singleton_key).toBe(assetId);

    // The request path only judged a signature: the object is still the upload as recorded.
    const stored = await storedObject(demoTenantId, assetId);
    expect(stored?.mimetype).toBe('audio/webm');
    expect(stored?.size).toBe(WEBM_2S.length);
  });

  it('a repeated complete answers the same body and queues nothing more', async () => {
    const again = await completeUpload(assetId);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { status: string }).status).toBe('processing');
    expect((await deriveJobs(assetId)).length).toBe(1);
  });

  it('the worker normalizes the object in place: ready, audio/mp4, measured duration 2', async () => {
    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });

    const row = await assetRow(assetId);
    expect(row?.status).toBe('ready');
    expect(row?.mime).toBe('audio/mp4');
    expect(row?.duration_seconds).toBe(2);
    expect(row?.ready_at).not.toBeNull();
    expect(row?.failure_reason).toBeNull();

    const stored = await storedObject(demoTenantId, assetId);
    expect(stored?.mimetype).toBe('audio/mp4');
    expect(Number(row?.bytes)).toBe(stored?.size);
    expect(stored?.size).not.toBe(WEBM_2S.length);
  });

  it('Range probe (A3): GET /original answers 302 and the signed URL answers 206 with content-range', async () => {
    const res = await media(`/${assetId}/original`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain(`/object/sign/media/${demoTenantId}/media/${assetId}/original`);

    const ranged = await fetch(location, { headers: { Range: 'bytes=0-1' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-1\//);
    expect((await ranged.arrayBuffer()).byteLength).toBe(2);
  });
});

/** An Opus WebM of `seconds` of a sine tone, made with the real ffmpeg (no fixture is committed). */
async function sineWebm(seconds: number): Promise<Buffer> {
  const out = join(scratchDir, `sine-${seconds}.webm`);
  await execFileP('ffmpeg', [
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-ac',
    '1',
    '-ar',
    '48000',
    '-c:a',
    'libopus',
    '-b:a',
    '16k',
    out,
  ]);
  return readFile(out);
}

/** An MP4 holding ONE video stream and no audio at all. */
async function videoOnlyMp4(): Promise<Buffer> {
  const out = join(scratchDir, 'video-only.mp4');
  await execFileP('ffmpeg', [
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=1:size=64x64:rate=10',
    '-c:v',
    'mpeg4',
    '-an',
    out,
  ]);
  return readFile(out);
}

/** The Storage object is gone: the rejection removed it. */
async function objectGone(assetId: string): Promise<boolean> {
  return (await storedObject(demoTenantId, assetId)) === undefined;
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; details?: Record<string, unknown> } })
    .error;
}

describe('voice rejections: every way a recording can be wrong ends removed and rejected (VOICE-15, VOICE-16, VOICE-17)', () => {
  it('a WebM declared as audio/mp4 is refused at complete with format_mismatch and its object is removed', async () => {
    const { assetId, complete } = await uploadVoice({ bytes: WEBM_2S, declaredMime: 'audio/mp4' });
    expect(complete.status).toBe(400);
    const error = await errorOf(complete);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.media).toBe('format_mismatch');

    const row = await assetRow(assetId);
    expect(row?.status).toBe('rejected');
    expect(row?.failure_reason).toBe('format_mismatch');
    expect(await objectGone(assetId)).toBe(true);
    expect((await deriveJobs(assetId)).length).toBe(0);
  });

  it('an object whose Storage content type differs from the declared mime is format_mismatch', async () => {
    const { assetId, complete } = await uploadVoice({
      bytes: WEBM_2S,
      declaredMime: 'audio/webm',
      putContentType: 'audio/ogg',
    });
    expect(complete.status).toBe(400);
    expect((await errorOf(complete)).details?.media).toBe('format_mismatch');

    const row = await assetRow(assetId);
    expect(row?.status).toBe('rejected');
    expect(row?.failure_reason).toBe('format_mismatch');
    expect(await objectGone(assetId)).toBe(true);
  });

  it('random bytes behind a valid-looking WebM signature pass complete and are rejected transcode_failed by the worker', async () => {
    const garbage = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), randomBytes(4096)]);
    const { assetId, complete } = await uploadVoice({ bytes: garbage, declaredMime: 'audio/webm' });
    expect(complete.status).toBe(200);
    expect(((await complete.json()) as { status: string }).status).toBe('processing');

    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });

    const row = await assetRow(assetId);
    expect(row?.status).toBe('rejected');
    expect(row?.failure_reason).toBe('transcode_failed');
    expect(await objectGone(assetId)).toBe(true);
  });

  it('an MP4 with a video stream and no audio is rejected transcode_failed', async () => {
    const { assetId, complete } = await uploadVoice({
      bytes: await videoOnlyMp4(),
      declaredMime: 'audio/mp4',
    });
    expect(complete.status).toBe(200);

    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });

    const row = await assetRow(assetId);
    expect(row?.status).toBe('rejected');
    expect(row?.failure_reason).toBe('transcode_failed');
    expect(await objectGone(assetId)).toBe(true);
  });

  it('a 305 second take is rejected duration_too_long: the 302 second input bound does not hide it', async () => {
    const { assetId, complete } = await uploadVoice({
      bytes: await sineWebm(305),
      declaredMime: 'audio/webm',
    });
    expect(complete.status).toBe(200);

    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });

    const row = await assetRow(assetId);
    expect(row?.status).toBe('rejected');
    expect(row?.failure_reason).toBe('duration_too_long');
    expect(row?.duration_seconds).toBeNull();
    expect(await objectGone(assetId)).toBe(true);
  });

  it('a 299 second take is ready with duration_seconds 299', async () => {
    const { assetId, complete } = await uploadVoice({
      bytes: await sineWebm(299),
      declaredMime: 'audio/webm',
    });
    expect(complete.status).toBe(200);

    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });

    const row = await assetRow(assetId);
    expect(row?.status).toBe('ready');
    expect(row?.duration_seconds).toBe(299);
  });

  it('a 300.4 second take is ready, clamped to 300', async () => {
    const { assetId, complete } = await uploadVoice({
      bytes: await sineWebm(300.4),
      declaredMime: 'audio/webm',
    });
    expect(complete.status).toBe(200);

    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });

    const row = await assetRow(assetId);
    expect(row?.status).toBe('ready');
    expect(row?.duration_seconds).toBe(300);
  });

  it('a declared size above 6 MiB is refused at start with 413 too_large and no row exists', async () => {
    const res = await startUpload({
      kind: 'audio',
      purpose: 'voice',
      mime: 'audio/webm',
      size: 6 * 1024 * 1024 + 1,
    });
    expect(res.status).toBe(413);
    const error = await errorOf(res);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.media).toBe('too_large');
  });

  it('an unlisted mime is refused at start with type_not_allowed', async () => {
    const res = await startUpload({
      kind: 'audio',
      purpose: 'voice',
      mime: 'audio/mpeg',
      size: 1000,
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).details?.media).toBe('type_not_allowed');
  });
});
