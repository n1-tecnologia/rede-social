import { createClient } from '@supabase/supabase-js';
import { mediaAssetSchema } from '@tria/contracts/media';
import { sqlClient } from '@tria/core/db';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { deriveVariantsJob } from '@tria/core/server/media/derive-job';
import { encodeJpeg, probeSize } from '@tria/core/server/media/variants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * MEDIA-01 / MEDIA-02 / TENANT-04 — the media broker against the live local stack (the real PRIVATE
 * `media` bucket, the real pg-boss queue, the worker handler driven in-process).
 *
 * The tracer is one path through every layer: `start` mints a signed Storage target -> the bytes go
 * STRAIGHT to Storage (never through the API) -> `complete` verifies the object and enqueues ONE
 * `kernel.media-derive-variants` job with NO variants yet (the request path never derives) -> the
 * worker handler produces the purpose's WebP ladder under immutable keys -> `GET /v1/media/{id}/w320`
 * answers a 302 to a freshly signed URL whose target really is a 320 px WebP.
 *
 * The session is a seeded MEMBER of `tria-demo`, never the super_admin: the media lane is tenant-only
 * and a platform admin has no membership (RESEARCH Pitfall 8).
 *
 * The api package has no `sharp` dependency: JPEG fixtures are built through `encodeJpeg` and probed
 * with `probeSize`, both from `@tria/core/server/media/variants` (the 02-13 `deriveIconSet` /
 * `readPixel` precedent).
 *
 * `afterAll` deletes the assets through the API, removes the Storage objects under the tenant's
 * `media/` prefix through the Storage API (direct deletes from `storage.objects` are refused — 02-13
 * finding) and clears the pg-boss rows by `singleton_key`.
 */

const MEMBER_EMAIL = 'member@tria-demo.local';

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

/** A 900x600 photo-ish fixture: an inline rect rendered by sharp, then encoded as a real JPEG. */
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#0ea5e9"/><circle cx="450" cy="300" r="180" fill="#f59e0b"/></svg>`;

let memberToken = '';
let demoTenantId = '';
let PHOTO_JPEG: Buffer;

const createdAssetIds: string[] = [];

const media = (
  path: string,
  init: {
    method?: string;
    body?: unknown;
    token?: string;
    redirect?: 'follow' | 'manual' | 'error';
  } = {},
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

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

type StartBody = {
  kind: string;
  purpose: string;
  mime: string;
  size: number;
  filename?: string;
};

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

async function assetRow(assetId: string) {
  const rows = await adminSql<
    { status: string; tenant_id: string; bytes: string; variant_widths: number[] }[]
  >`select status, tenant_id, bytes, variant_widths from public.media_assets where id = ${assetId}::uuid`;
  return rows[0];
}

async function deriveJobs(assetId: string) {
  return adminSql<{ state: string; singleton_key: string }[]>`
    select state, singleton_key from pgboss.job_common
     where name = 'kernel.media-derive-variants' and singleton_key = ${assetId}
     order by created_on`;
}

/**
 * Service-key Storage client for fixture cleanup only (the Storage schema forbids direct deletes
 * from `storage.objects`). Built here like `authAdmin()` in setup.ts instead of importing
 * `@tria/core/server/supabase-admin`, which Biome confines to the kernel's admin lane.
 */
function storageAdmin() {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
}

async function removeTenantMediaObjects(tenantId: string): Promise<void> {
  const rows = await adminSql<{ name: string }[]>`
    select name from storage.objects where bucket_id = 'media' and name like ${`${tenantId}/media/%`}`;
  if (rows.length === 0) return;
  const { error } = await storageAdmin()
    .from('media')
    .remove(rows.map((row) => row.name));
  if (error) throw new Error(`storage cleanup failed: ${error.message}`);
}

async function cleanup(): Promise<void> {
  for (const tenantId of [demoTenantId].filter(Boolean)) {
    await removeTenantMediaObjects(tenantId);
    await adminSql`delete from public.media_assets where tenant_id = ${tenantId}::uuid`;
  }
  const ids = [...new Set(createdAssetIds)];
  for (const id of ids) {
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
  >`select id from public.tenants where slug = 'tria-demo'`;
  if (!tenant) throw new Error('the tria-demo tenant is not seeded');
  demoTenantId = tenant.id;
  PHOTO_JPEG = await encodeJpeg(Buffer.from(PHOTO_SVG));
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer — start, PUT to Storage, complete, the worker derives, the 302 serves it back (MEDIA-01/MEDIA-02/TENANT-04)', () => {
  let assetId = '';
  let path = '';
  let signedUrl = '';

  it('1. POST /v1/media/uploads mints a signed target at <tenant>/media/<assetId>/original and records a pending row', async () => {
    const res = await startUpload({
      kind: 'image',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: PHOTO_JPEG.length,
      filename: 'foto.jpg',
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as {
      assetId: string;
      provider: string;
      signedUrl: string;
      token: string | null;
      path: string | null;
      maxBytes: number;
      resumableThresholdBytes: number;
    };
    assetId = body.assetId;
    path = body.path ?? '';
    signedUrl = body.signedUrl;
    createdAssetIds.push(assetId);

    expect(body.provider).toBe('supabase');
    expect(path).toBe(`${demoTenantId}/media/${assetId}/original`);
    expect(body.signedUrl).toContain(`/object/upload/sign/media/${demoTenantId}/media/`);
    expect(body.token).toBeTruthy();
    expect(body.maxBytes).toBe(8 * 1024 * 1024);
    expect(body.resumableThresholdBytes).toBe(6291456);

    const row = await assetRow(assetId);
    expect(row?.status).toBe('pending');
    expect(row?.tenant_id).toBe(demoTenantId);
  });

  it('2. the browser PUTs the bytes STRAIGHT to the API-minted Storage URL — they never transit the API', async () => {
    const put = await putToSignedUrl(signedUrl, PHOTO_JPEG, 'image/jpeg');
    expect(put.ok).toBe(true);

    const rows = await adminSql<{ name: string }[]>`
      select name from storage.objects where bucket_id = 'media' and name = ${path}`;
    expect(rows.length).toBe(1);
  });

  it('3. complete records the measured facts, flips to processing and enqueues exactly ONE derivation job — no variants yet', async () => {
    const res = await completeUpload(assetId);
    expect(res.status).toBe(200);
    const asset = mediaAssetSchema.parse(await res.json());
    expect(asset.status).toBe('processing');
    expect(asset.variants).toEqual([]);
    expect(asset.width).toBe(900);
    expect(asset.height).toBe(600);
    expect(asset.url).toBe(`/v1/media/${assetId}/original`);

    const jobs = await deriveJobs(assetId);
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.singleton_key).toBe(assetId);
  });

  it('4. the worker handler derives the avatar ladder and flips the asset to ready', async () => {
    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });

    const res = await completeUpload(assetId);
    expect(res.status).toBe(200);
    const asset = mediaAssetSchema.parse(await res.json());
    expect(asset.status).toBe('ready');
    expect(asset.variants).toEqual([
      { width: 128, url: `/v1/media/${assetId}/w128` },
      { width: 320, url: `/v1/media/${assetId}/w320` },
    ]);
  });

  it('5. GET /v1/media/{assetId}/w320 answers a 302 to a signed URL whose target is a 320 px WebP', async () => {
    const res = await media(`/${assetId}/w320`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('cache-control')).toBe('private, max-age=1500');
    const location = res.headers.get('location') ?? '';
    expect(location).toContain(`/object/sign/media/${demoTenantId}/media/${assetId}/w320.webp`);

    const fetched = await fetch(location);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toContain('image/webp');
    const probed = await probeSize(Buffer.from(await fetched.arrayBuffer()));
    expect(probed.width).toBe(320);
    expect(probed.format).toBe('webp');
  });

  it('6. GET /v1/media/{assetId}/original serves the untouched upload back', async () => {
    const res = await media(`/${assetId}/original`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain(`/object/sign/media/${demoTenantId}/media/${assetId}/original`);

    const fetched = await fetch(location);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toContain('image/jpeg');
  });

  it('7. DELETE soft-deletes the asset: it leaves every tenant-lane read', async () => {
    const res = await media(`/${assetId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const asset = mediaAssetSchema.parse(await res.json());
    expect(asset.status).toBe('deleted');

    const again = await completeUpload(assetId);
    expect(again.status).toBe(404);
    expect((await envelope(again)).details?.media).toBe('object_missing');
  });
});
