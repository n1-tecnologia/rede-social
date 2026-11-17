import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

let memberToken = '';
let demoTenantId = '';

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
});

afterAll(async () => {
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
