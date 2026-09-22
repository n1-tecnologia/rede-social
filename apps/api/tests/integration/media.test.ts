import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { mediaAssetSchema } from '@tria/contracts/media';
import { sqlClient } from '@tria/core/db';
import { deriveIconSet } from '@tria/core/server/branding/icons';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { deriveVariantsJob } from '@tria/core/server/media/derive-job';
import { MEDIA_TENANT_BYTES_CEILING } from '@tria/core/server/media/limits';
import { mediaInternals } from '@tria/core/server/media/service';
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
/** A SECOND seeded member of the SAME community — the intra-tenant half of the authorization gate. */
const PEER_EMAIL = 'joao.goncalves@tria-demo.local';
/** The same community's admin: the other half of the owner-OR-admin predicate. */
const ADMIN_EMAIL = 'admin@tria-demo.local';
/** The second seeded tenant — the isolation half of ROADMAP criterion 4. */
const LAB_MEMBER_EMAIL = 'member@tria-lab.local';

/**
 * The same REAL HEVC-compressed HEIC the kernel unit suite pins (RESEARCH Pitfall 2). Read from the
 * kernel's fixture directory rather than duplicated: one file, one provenance, so a substitute that
 * is not genuinely HEVC-in-HEIF fails BOTH suites at once.
 */
const HEIC = readFileSync(
  fileURLToPath(new URL('../../../../packages/core/tests/fixtures/iphone.heic', import.meta.url)),
);

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

/** A 900x600 photo-ish fixture: an inline rect rendered by sharp, then encoded as a real JPEG. */
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#0ea5e9"/><circle cx="450" cy="300" r="180" fill="#f59e0b"/></svg>`;

/**
 * A 200x200 photo — under every cap, so the browser's `normaliseImage` returns it untouched and the
 * server stores it as-is. It is SMALLER than the `w320` rung every profile surface requests, which
 * is the whole point of the CR-02 regression below.
 */
const SMALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#16a34a"/><circle cx="100" cy="100" r="70" fill="#fef08a"/></svg>`;

let memberToken = '';
let labToken = '';
let demoTenantId = '';
let demoUserId = '';
let labTenantId = '';
let labSlug = '';
let labDisplayName = '';
let PHOTO_JPEG: Buffer;
let SMALL_JPEG: Buffer;
let PHOTO_PNG: Buffer;

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
  for (const tenantId of [demoTenantId, labTenantId].filter(Boolean)) {
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
  SMALL_JPEG = await encodeJpeg(Buffer.from(SMALL_SVG));
  // A real PNG, built through the 02-13 kernel helper — the api package has no `sharp` dependency.
  PHOTO_PNG = (
    await deriveIconSet(Buffer.from(PHOTO_SVG), { primaryHex: '#0ea5e9', mime: 'image/svg+xml' })
  ).i512;

  labToken = await signInAs(LAB_MEMBER_EMAIL, SEED_PASSWORD);
  const [lab] = await adminSql<{ id: string; slug: string; display_name: string }[]>`
    select id, slug, display_name from public.tenants where slug = 'tria-lab'`;
  if (!lab) throw new Error('the tria-lab tenant is not seeded');
  labTenantId = lab.id;
  labSlug = lab.slug;
  labDisplayName = lab.display_name;

  const [owner] = await adminSql<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where m.tenant_id = ${demoTenantId}::uuid and u.email = ${MEMBER_EMAIL}`;
  if (!owner) throw new Error('the tria-demo member is not seeded');
  demoUserId = owner.user_id;

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

describe('refusals at start — the declared facts buy a fast, specific answer (T-03-03/T-03-05/T-03-06)', () => {
  it('a mime outside the kind+purpose allow-list answers 400 type_not_allowed', async () => {
    const res = await startUpload({
      kind: 'image',
      purpose: 'avatar',
      mime: 'image/gif',
      size: 1024,
    });
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.media).toBe('type_not_allowed');
  });

  it('image/heic is refused BY NAME and no row is ever created', async () => {
    const before = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.media_assets where tenant_id = ${demoTenantId}::uuid`;
    const res = await startUpload({
      kind: 'image',
      purpose: 'avatar',
      mime: 'image/heic',
      size: 1024,
    });
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.media).toBe('heic_unsupported');
    const after = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.media_assets where tenant_id = ${demoTenantId}::uuid`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it('a size above the purpose cap answers 413 too_large with the cap itself', async () => {
    const res = await startUpload({
      kind: 'image',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: 20 * 1024 * 1024,
    });
    expect(res.status).toBe(413);
    const details = (await envelope(res)).details;
    expect(details?.media).toBe('too_large');
    expect(details?.maxBytes).toBe(8388608);
  });

  it('an unknown (kind, purpose) pair answers type_not_allowed rather than defaulting', async () => {
    const res = await startUpload({
      kind: 'file',
      purpose: 'avatar',
      mime: 'application/pdf',
      size: 1024,
    });
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.media).toBe('type_not_allowed');
  });

  // 03-06 replaced 03-01's named `501 { media: 'video_provider_missing' }` seam with the
  // `VideoProvider` adapter. This session is a MEMBER, and V1 publishes admin-only, so the answer
  // is now the role refusal — never a 501 and never a silent gap. The admin's happy path and the
  // rest of the video contract live in `mux-webhook.test.ts`.
  it('video is no longer a 501 seam: a member is refused by ROLE, and no asset is created', async () => {
    const res = await startUpload({
      kind: 'video',
      purpose: 'post',
      mime: 'video/mp4',
      size: 1024,
    });
    expect(res.status).toBe(403);
    expect((await envelope(res)).code).toBe('FORBIDDEN');

    const rows = await adminSql<{ count: string }[]>`
      select count(*)::text as count from public.media_assets
       where tenant_id = ${demoTenantId}::uuid and kind = 'video'`;
    expect(rows[0]?.count).toBe('0');
  });
});

describe('refusals at complete — the BYTES are judged, and a refused upload leaves no object (T-03-03)', () => {
  /** start -> PUT the given bytes under the given declared mime -> complete. */
  async function roundTrip(bytes: Buffer, declaredMime: string, contentType = declaredMime) {
    const start = await startUpload({
      kind: 'image',
      purpose: 'post',
      mime: declaredMime,
      size: bytes.length,
    });
    expect(start.status).toBe(201);
    const body = (await start.json()) as { assetId: string; signedUrl: string; path: string };
    createdAssetIds.push(body.assetId);
    const put = await putToSignedUrl(body.signedUrl, bytes, contentType);
    expect(put.ok).toBe(true);
    const done = await completeUpload(body.assetId);
    return { assetId: body.assetId, path: body.path, res: done };
  }

  it('HTML bytes declared image/jpeg answer not_an_image; the object is gone and the row is rejected', async () => {
    const { assetId, path, res } = await roundTrip(
      Buffer.from('<html>hi</html>'),
      'image/jpeg',
      'image/jpeg',
    );
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.media).toBe('not_an_image');

    const objects = await adminSql<{ name: string }[]>`
      select name from storage.objects where bucket_id = 'media' and name = ${path}`;
    expect(objects.length).toBe(0);

    const row = await adminSql<{ status: string; failure_reason: string }[]>`
      select status, failure_reason from public.media_assets where id = ${assetId}::uuid`;
    expect(row[0]?.status).toBe('rejected');
    expect(row[0]?.failure_reason).toBe('not_an_image');
  });

  it('a PNG uploaded under an image/jpeg start answers format_mismatch', async () => {
    const { res } = await roundTrip(PHOTO_PNG, 'image/jpeg', 'image/jpeg');
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.media).toBe('format_mismatch');
  });

  it('a REAL iPhone-shaped HEIC answers heic_unsupported — refused by decoded format, not by name', async () => {
    const { res } = await roundTrip(HEIC, 'image/jpeg', 'image/jpeg');
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.media).toBe('heic_unsupported');
  });

  it('completing an upload whose PUT never happened answers 404 object_missing', async () => {
    const start = await startUpload({
      kind: 'image',
      purpose: 'post',
      mime: 'image/jpeg',
      size: PHOTO_JPEG.length,
    });
    const body = (await start.json()) as { assetId: string };
    createdAssetIds.push(body.assetId);
    const res = await completeUpload(body.assetId);
    expect(res.status).toBe(404);
    expect((await envelope(res)).details?.media).toBe('object_missing');
  });

  it('completing a random uuid takes the same 404 branch — no existence oracle', async () => {
    const res = await completeUpload('8f14e45f-ce1a-4e2f-8b4a-1f0a0b0c0d0e');
    expect(res.status).toBe(404);
    const error = await envelope(res);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details?.media).toBe('object_missing');
  });
});

describe('quota — the tenant ceiling is charged before a row exists (R-16/T-03-06)', () => {
  it('refuses with quota_exceeded and creates nothing, then accepts once the padding is soft-deleted', async () => {
    const padBytes = MEDIA_TENANT_BYTES_CEILING - 1024 * 1024;
    const [pad] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, mime, bytes)
      values (${demoTenantId}::uuid, ${demoUserId}::uuid, 'image', 'post', 'ready',
              'image/jpeg', ${padBytes})
      returning id`;
    const padId = pad?.id;
    if (!padId) throw new Error('could not seed the quota padding row');

    const before = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.media_assets where tenant_id = ${demoTenantId}::uuid`;
    const refused = await startUpload({
      kind: 'image',
      purpose: 'post',
      mime: 'image/jpeg',
      size: 4 * 1024 * 1024,
    });
    expect(refused.status).toBe(413);
    expect((await envelope(refused)).details?.media).toBe('quota_exceeded');
    const after = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.media_assets where tenant_id = ${demoTenantId}::uuid`;
    expect(after[0]?.n).toBe(before[0]?.n);

    await adminSql`
      update public.media_assets set deleted_at = now(), status = 'deleted'
       where id = ${padId}::uuid`;
    const accepted = await startUpload({
      kind: 'image',
      purpose: 'post',
      mime: 'image/jpeg',
      size: 4 * 1024 * 1024,
    });
    expect(accepted.status).toBe(201);
    createdAssetIds.push(((await accepted.json()) as { assetId: string }).assetId);
  });
});

describe('idempotency and concurrency — one confirmation, one job, one ladder', () => {
  /** A fully uploaded but not yet confirmed asset. */
  async function uploaded(purpose = 'post') {
    const start = await startUpload({
      kind: 'image',
      purpose,
      mime: 'image/jpeg',
      size: PHOTO_JPEG.length,
    });
    expect(start.status).toBe(201);
    const body = (await start.json()) as { assetId: string; signedUrl: string };
    createdAssetIds.push(body.assetId);
    const put = await putToSignedUrl(body.signedUrl, PHOTO_JPEG, 'image/jpeg');
    expect(put.ok).toBe(true);
    return body.assetId;
  }

  it('two sequential completes answer the same body and leave exactly ONE derivation job', async () => {
    const assetId = await uploaded();
    const first = mediaAssetSchema.parse(await (await completeUpload(assetId)).json());
    const second = mediaAssetSchema.parse(await (await completeUpload(assetId)).json());
    expect(second).toEqual(first);
    expect((await deriveJobs(assetId)).length).toBe(1);
  });

  it('two CONCURRENT completes likewise produce exactly one job (singletonKey under the short policy)', async () => {
    const assetId = await uploaded();
    const [a, b] = await Promise.all([completeUpload(assetId), completeUpload(assetId)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await deriveJobs(assetId)).length).toBe(1);
  });

  it('running the derivation twice is safe: the same widths, still ready', async () => {
    const assetId = await uploaded('avatar');
    await completeUpload(assetId);
    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });
    const once = await assetRow(assetId);
    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });
    const twice = await assetRow(assetId);
    expect(twice?.status).toBe('ready');
    expect(twice?.variant_widths).toEqual(once?.variant_widths);
    expect(twice?.variant_widths).toEqual([128, 320]);
  });

  it('a row soft-deleted mid-derivation is never resurrected (the beforeVariantWrite seam)', async () => {
    const assetId = await uploaded('avatar');
    await completeUpload(assetId);
    const original = mediaInternals.beforeVariantWrite;
    try {
      mediaInternals.beforeVariantWrite = async () => {
        await adminSql`
          update public.media_assets set status = 'deleted', deleted_at = now()
           where id = ${assetId}::uuid`;
      };
      await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });
    } finally {
      mediaInternals.beforeVariantWrite = original;
    }
    const row = await assetRow(assetId);
    expect(row?.status).toBe('deleted');
  });

  it('a derivation that keeps failing re-arms while it may, then ends in a terminal failed state', async () => {
    const assetId = await uploaded('avatar');
    await completeUpload(assetId);
    const original = mediaInternals.beforeVariantWrite;
    try {
      mediaInternals.beforeVariantWrite = async () => {
        throw new Error('boom');
      };

      // Below the attempt ceiling: one deferred job is re-armed and the row stays `processing`.
      await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });
      expect((await assetRow(assetId))?.status).toBe('processing');

      // At the ceiling: no infinite `processing`, a terminal `failed` with its reason instead.
      await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 3 });
      const row = await adminSql<{ status: string; failure_reason: string }[]>`
        select status, failure_reason from public.media_assets where id = ${assetId}::uuid`;
      expect(row[0]?.status).toBe('failed');
      expect(row[0]?.failure_reason).toBe('derive_failed');
    } finally {
      mediaInternals.beforeVariantWrite = original;
    }
  });
});

/**
 * CR-02. The profile payloads (`ownProfileSchema`, `memberProfileSchema`) carry only an
 * `avatarAssetId`, so every profile surface renders the STATIC `PURPOSE_WIDTHS.avatar` ladder with
 * `baseWidth={320}`. The derived ladder therefore has to be knowable from the purpose alone — if it
 * depended on the source size, a small photo would 404 the `w320` the browser picks at DPR >= 2 and
 * `MediaImage.onError` would silently show the neutral "no photo" icon instead.
 */
describe('the derived ladder is a function of the PURPOSE, not of the source size (CR-02/T-03-51)', () => {
  it('a 200 px avatar still answers the w320 every profile surface requests — with a 200 px WebP, never an upscale', async () => {
    expect((await probeSize(SMALL_JPEG)).width).toBe(200);

    const start = await startUpload({
      kind: 'image',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: SMALL_JPEG.length,
      filename: 'pequena.jpg',
    });
    expect(start.status).toBe(201);
    const body = (await start.json()) as { assetId: string; signedUrl: string };
    const assetId = body.assetId;
    createdAssetIds.push(assetId);
    expect((await putToSignedUrl(body.signedUrl, SMALL_JPEG, 'image/jpeg')).ok).toBe(true);
    expect((await completeUpload(assetId)).status).toBe(200);
    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId, attempt: 0 });

    // The whole avatar ladder, even though the source is smaller than its top rung.
    const asset = mediaAssetSchema.parse(await (await completeUpload(assetId)).json());
    expect(asset.status).toBe('ready');
    expect(asset.width).toBe(200);
    expect(asset.variants).toEqual([
      { width: 128, url: `/v1/media/${assetId}/w128` },
      { width: 320, url: `/v1/media/${assetId}/w320` },
    ]);
    expect((await assetRow(assetId))?.variant_widths).toEqual([128, 320]);

    // The rung the srcset advertises really resolves — this is the 404 that used to erase the photo.
    const res = await media(`/${assetId}/w320`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain(`/object/sign/media/${demoTenantId}/media/${assetId}/w320.webp`);

    const fetched = await fetch(location);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toContain('image/webp');
    // `withoutEnlargement`: the w320 rung of a 200 px source is a 200 px WebP, not a blurred upscale.
    const probed = await probeSize(Buffer.from(await fetched.arrayBuffer()));
    expect(probed.format).toBe('webp');
    expect(probed.width).toBe(200);

    // The smaller rung is a genuine downscale, so the ladder still gives the browser a real choice.
    const small = await media(`/${assetId}/w128`, { redirect: 'manual' });
    expect(small.status).toBe(302);
    const smallBytes = await fetch(small.headers.get('location') ?? '');
    expect((await probeSize(Buffer.from(await smallBytes.arrayBuffer()))).width).toBe(128);
  });
});

/**
 * One layer inward from the isolation suite below. Cross-tenant refusal on this lane is structural
 * (the key is a pure function of the caller's own tenant id), but the `media_assets` select policy
 * is deliberately TENANT-wide, so the tenant lane is not an authorization boundary between two
 * members of the SAME community — and `GET /v1/members` publishes every member's `avatarAssetId`,
 * so the ids need no guessing. These cases pin the second predicate `deleteAsset` now carries.
 */
describe('intra-tenant authorization — a fellow member is not an owner (CR-01/T-03-50)', () => {
  let peerToken = '';
  let adminToken = '';

  /** A `ready` avatar owned by the `member@tria-demo.local` session the suite runs as. */
  async function ownedByMember(): Promise<string> {
    const start = await startUpload({
      kind: 'image',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: PHOTO_JPEG.length,
    });
    expect(start.status).toBe(201);
    const body = (await start.json()) as { assetId: string; signedUrl: string };
    createdAssetIds.push(body.assetId);
    expect((await putToSignedUrl(body.signedUrl, PHOTO_JPEG, 'image/jpeg')).ok).toBe(true);
    expect((await completeUpload(body.assetId)).status).toBe(200);
    await deriveVariantsJob.handler({ tenantId: demoTenantId, assetId: body.assetId, attempt: 0 });
    return body.assetId;
  }

  beforeAll(async () => {
    peerToken = await signInAs(PEER_EMAIL, SEED_PASSWORD);
    adminToken = await signInAs(ADMIN_EMAIL, SEED_PASSWORD);
  });

  it('another member of the SAME community cannot retire the asset: 404, and the row is untouched', async () => {
    const assetId = await ownedByMember();

    const res = await media(`/${assetId}`, { method: 'DELETE', token: peerToken });
    expect(res.status).toBe(404);
    const error = await envelope(res);
    expect(error.code).toBe('NOT_FOUND');
    // The SAME bare 404 the nonexistent and cross-tenant branches answer: no `details`, nothing that
    // confirms the id exists and belongs to somebody else.
    expect(error.details).toBeUndefined();

    const row = await assetRow(assetId);
    expect(row?.status).toBe('ready');

    // And the owner still can — the refusal was about the CALLER, not about the asset.
    const mine = await media(`/${assetId}`, { method: 'DELETE' });
    expect(mine.status).toBe(200);
    expect(mediaAssetSchema.parse(await mine.json()).status).toBe('deleted');
  });

  it('a nonexistent id answers the identical refusal — the two are indistinguishable', async () => {
    const res = await media('/8f14e45f-ce1a-4e2f-8b4a-1f0a0b0c0d0e', {
      method: 'DELETE',
      token: peerToken,
    });
    expect(res.status).toBe(404);
    const error = await envelope(res);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details).toBeUndefined();
  });

  it('the community ADMIN may retire a member asset — the gate is owner-OR-admin, never admin-only', async () => {
    const assetId = await ownedByMember();
    const res = await media(`/${assetId}`, { method: 'DELETE', token: adminToken });
    expect(res.status).toBe(200);
    expect((await assetRow(assetId))?.status).toBe('deleted');
  });
});

describe('isolation — a tenant-B session cannot reach a tenant-A object (TENANT-04, criterion 4)', () => {
  let tenantAAssetId = '';

  beforeAll(async () => {
    const start = await startUpload({
      kind: 'image',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: PHOTO_JPEG.length,
    });
    const body = (await start.json()) as { assetId: string; signedUrl: string };
    tenantAAssetId = body.assetId;
    createdAssetIds.push(tenantAAssetId);
    await putToSignedUrl(body.signedUrl, PHOTO_JPEG, 'image/jpeg');
    await completeUpload(tenantAAssetId);
    await deriveVariantsJob.handler({
      tenantId: demoTenantId,
      assetId: tenantAAssetId,
      attempt: 0,
    });
  });

  it('each community mints keys under its OWN prefix and never the other one', async () => {
    const mine = await startUpload({
      kind: 'image',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: PHOTO_JPEG.length,
    });
    const theirs = await startUpload(
      { kind: 'image', purpose: 'avatar', mime: 'image/jpeg', size: PHOTO_JPEG.length },
      labToken,
    );
    const a = (await mine.json()) as { assetId: string; path: string };
    const b = (await theirs.json()) as { assetId: string; path: string };
    createdAssetIds.push(a.assetId, b.assetId);
    expect(a.path.startsWith(`${demoTenantId}/media/`)).toBe(true);
    expect(b.path.startsWith(`${labTenantId}/media/`)).toBe(true);
  });

  it('GET on the foreign asset answers 404 with NO Location and a body that names no community', async () => {
    const res = await media(`/${tenantAAssetId}/w320`, {
      token: labToken,
      redirect: 'manual',
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();

    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(labSlug);
    expect(text).not.toContain('tria-demo');
    expect(text).not.toContain(labDisplayName);
    expect(text).not.toContain(demoTenantId);
  });

  it('completing the foreign asset answers the same 404 object_missing a nonexistent id gets', async () => {
    const res = await completeUpload(tenantAAssetId, labToken);
    expect(res.status).toBe(404);
    expect((await envelope(res)).details?.media).toBe('object_missing');
  });

  it('deleting the foreign asset answers 404 and leaves it untouched', async () => {
    const res = await media(`/${tenantAAssetId}`, { method: 'DELETE', token: labToken });
    expect(res.status).toBe(404);
    const row = await assetRow(tenantAAssetId);
    expect(row?.status).toBe('ready');
    expect(row?.tenant_id).toBe(demoTenantId);
  });

  it('the owner still reads it — the refusal was about the caller, not about the asset', async () => {
    const res = await media(`/${tenantAAssetId}/w320`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(`/media/${tenantAAssetId}/w320.webp`);
  });
});
