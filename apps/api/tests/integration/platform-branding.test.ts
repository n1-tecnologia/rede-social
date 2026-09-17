import { createClient } from '@supabase/supabase-js';
import {
  BRANDING_UPLOAD_ID_RE,
  hostTenantSchema,
  iconsUpToDate,
  platformTenantDetailSchema,
} from '@tria/contracts';
import { sqlClient } from '@tria/core/db';
import { deriveIconsJob } from '@tria/core/server/branding/derive-icons-job';
import { deriveIconSet, inspectBrandingImage, readPixel } from '@tria/core/server/branding/icons';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, signInAs } from './setup';

/**
 * D-27 / D-28 / D-25 / D-41 / TENANT-02 — tenant branding through `/v1/platform/tenants/{id}/branding/*`
 * against the live local stack (real Storage bucket, real pg-boss queue, in-process worker handler).
 *
 * Part 1 is the tracer: start a logo upload -> PUT the bytes straight to the signed Storage URL ->
 * complete (header check, `logoUrl`, `iconVersion` 1, ONE waiting `kernel.branding-derive-icons`
 * job, NO icons yet — the request path never derives) -> drive the worker handler in-process ->
 * the five derived objects exist under `/icons/1/` with the right pixels -> the public by-host
 * answer carries them on the very next request (host cache invalidated by the job write).
 *
 * The api package has no `sharp` dependency: PNG fixtures are generated through the kernel
 * (`deriveIconSet` on an inline SVG) and pixels/dimensions are probed with `readPixel` /
 * `inspectBrandingImage` from `@tria/core/server/branding/icons`.
 *
 * Every tenant created here carries a unique `pb-…` slug and a unique `…-<run>.cliente.test` host;
 * `afterAll` removes tenants (cascade), Storage objects under their prefixes, pg-boss rows keyed by
 * their ids and the invited auth users.
 */

const RUN = Date.now();
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'ferramentas@triacompany.com.br';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

const PRIMARY = '#7c3aed';
const PRIMARY_RGB = { r: 124, g: 58, b: 237, a: 255 };

/** A 300×120 wordmark: a filled rect + text. Pixel assertions only ever touch the rect. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><rect x="0" y="0" width="300" height="120" rx="12" fill="#f59e0b"/><text x="20" y="80" font-family="sans-serif" font-size="56" font-weight="700" fill="#ffffff">PB</text></svg>`;
const LOGO_RGB = { r: 245, g: 158, b: 11, a: 255 };

let superAdmin = '';
const createdTenantIds: string[] = [];
const createdAuthEmails: string[] = [];

const platform = (
  path: string,
  init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
) =>
  api.request(`/v1/platform${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${init.token ?? superAdmin}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const byHost = (host: string) =>
  api.request(`/v1/public/tenants/by-host?host=${encodeURIComponent(host)}`);

async function tenantDetail(id: string) {
  const res = await platform(`/tenants/${id}`);
  expect(res.status).toBe(200);
  return platformTenantDetailSchema.parse(await res.json());
}

/** A throwaway tenant with a VERIFIED primary host, so by-host resolves and cache invalidation is observable. */
async function createThrowawayTenant(
  prefix: string,
  colors = { primary: PRIMARY, secondary: '#a78bfa' },
): Promise<{ id: string; host: string }> {
  const slug = `${prefix}-${RUN}`.slice(0, 40);
  const adminEmail = `admin-${slug}@tria-test.local`;
  const res = await platform('/tenants', {
    method: 'POST',
    body: { displayName: `Marca ${slug}`, slug, colors, modules: ['feed'], adminEmail },
  });
  if (res.status !== 201) throw new Error(`tenant create failed: ${res.status}`);
  const body = platformTenantDetailSchema.parse(await res.json());
  const host = `${slug}.cliente.test`;
  await adminSql`
    insert into public.tenant_domains (host, tenant_id, is_primary, verified_at, verification_status)
    values (${host}, ${body.tenant.id}::uuid, true, now(), 'verified')`;
  createdTenantIds.push(body.tenant.id);
  createdAuthEmails.push(adminEmail);
  return { id: body.tenant.id, host };
}

async function startUpload(
  tenantId: string,
  body: { kind: string; mime: string; size: number },
  token?: string,
) {
  return platform(`/tenants/${tenantId}/branding/uploads`, { method: 'POST', body, token });
}

async function putToSignedUrl(signedUrl: string, bytes: Buffer, contentType: string) {
  return fetch(signedUrl, {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: { 'content-type': contentType, 'x-upsert': 'false' },
  });
}

async function complete(tenantId: string, uploadId: string) {
  return platform(`/tenants/${tenantId}/branding/uploads/${uploadId}/complete`, {
    method: 'POST',
  });
}

async function fetchBytes(url: string): Promise<{ status: number; type: string; buf: Buffer }> {
  const res = await fetch(url);
  return {
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    buf: Buffer.from(await res.arrayBuffer()),
  };
}

async function deriveJobs(tenantId: string) {
  return adminSql<{ state: string; singleton_key: string; data: { iconVersion: number } }[]>`
    select state, singleton_key, data from pgboss.job_common
     where name = 'kernel.branding-derive-icons' and singleton_key = ${tenantId}
     order by created_on`;
}

/**
 * Service-key Storage client for fixture cleanup only (the Storage schema forbids direct deletes
 * from `storage.objects`). Built here like `authAdmin()` in setup.ts instead of importing
 * `@tria/core/server/supabase-admin`, which Biome confines to the kernel's admin lane.
 */
function storageAdmin() {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_KEY ?? '';
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    .storage;
}

async function objectNames(tenantId: string): Promise<string[]> {
  const rows = await adminSql<{ name: string }[]>`
    select name from storage.objects where bucket_id = 'branding' and name like ${`${tenantId}/%`}`;
  return rows.map((r) => r.name);
}

async function removeTenantObjects(tenantId: string): Promise<void> {
  const names = await objectNames(tenantId);
  if (names.length === 0) return;
  const { error } = await storageAdmin().from('branding').remove(names);
  if (error) throw new Error(`storage cleanup failed: ${error.message}`);
}

async function cleanup(): Promise<void> {
  await adminSql`
    delete from public.memberships where tenant_id in
      (select id from public.tenants where slug like 'pb-%')`;
  const stale = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug like 'pb-%'`;
  const ids = [...new Set([...createdTenantIds, ...stale.map((r) => r.id)])];
  await adminSql`delete from public.tenants where slug like 'pb-%'`;
  await adminSql`delete from auth.users where lower(email) like 'admin-pb-%@tria-test.local'`;
  for (const id of ids) {
    await removeTenantObjects(id);
    await adminSql`
      delete from pgboss.job_common
       where name = 'kernel.branding-derive-icons' and singleton_key = ${id}`;
  }
}

let LOGO_PNG: Buffer;

beforeAll(async () => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  await cleanup();
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  LOGO_PNG = (
    await deriveIconSet(Buffer.from(LOGO_SVG), { primaryHex: PRIMARY, mime: 'image/svg+xml' })
  ).i512;
});

afterAll(async () => {
  await cleanup();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer — upload a logo, complete, the worker derives the icons, by-host carries them (D-27/D-28)', () => {
  let tenantId = '';
  let host = '';
  let uploadId = '';
  let path = '';
  let detailIcons: { i192: string; i512: string; maskable512: string; apple180: string } | null =
    null;
  let faviconUrl: string | null = null;

  it('0. a fresh tenant resolves by host with no icons yet (cache warmed)', async () => {
    const created = await createThrowawayTenant('pb-tracer');
    tenantId = created.id;
    host = created.host;
    const res = await byHost(host);
    expect(res.status).toBe(200);
    const body = hostTenantSchema.parse(await res.json());
    expect(body.branding.iconUrls).toBeNull();
    expect(body.branding.logoUrl).toBeNull();
  });

  it('1. POST …/branding/uploads mints a signed URL for <tenant>/branding/<uuid>.png (never through the API)', async () => {
    const res = await startUpload(tenantId, {
      kind: 'logo',
      mime: 'image/png',
      size: LOGO_PNG.length,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as {
      uploadId: string;
      signedUrl: string;
      path: string;
      maxBytes: number;
      expiresInSeconds: number;
    };
    uploadId = body.uploadId;
    path = body.path;
    expect(uploadId).toMatch(BRANDING_UPLOAD_ID_RE);
    expect(uploadId.startsWith('logo-')).toBe(true);
    expect(path).toMatch(new RegExp(`^${tenantId}/branding/[0-9a-f-]{36}\\.png$`));
    expect(body.signedUrl).toContain(`/object/upload/sign/branding/${tenantId}/branding/`);
    expect(body.maxBytes).toBe(2097152);
    expect(body.expiresInSeconds).toBe(7200);
    expect(Object.keys(body).sort()).toEqual(
      ['expiresInSeconds', 'maxBytes', 'path', 'signedUrl', 'uploadId'].sort(),
    );

    const put = await putToSignedUrl(body.signedUrl, LOGO_PNG, 'image/png');
    expect(put.ok).toBe(true);
  });

  it('2. complete verifies the object, records logoUrl, bumps iconVersion to 1 and enqueues ONE derivation job — no icons yet', async () => {
    const res = await complete(tenantId, uploadId);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const detail = platformTenantDetailSchema.parse(await res.json());
    expect(detail.tenant.branding.logoUrl?.endsWith(path)).toBe(true);
    expect(detail.tenant.branding.logoUrl).toContain('/storage/v1/object/public/branding/');
    expect(detail.tenant.branding.iconVersion).toBe(1);
    expect(detail.tenant.branding.iconUrls).toBeNull();
    expect(detail.tenant.branding.faviconUrl).toBeNull();
    expect(iconsUpToDate(detail.tenant.branding)).toBe(false);

    const jobs = await deriveJobs(tenantId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.state).toBe('created');
    expect(jobs[0]?.data.iconVersion).toBe(1);
    const [queue] = await adminSql<{ policy: string }[]>`
      select policy from pgboss.queue where name = 'kernel.branding-derive-icons'`;
    expect(queue?.policy).toBe('short');
  });

  it('3. the worker handler derives favicon + 192 + 512 + maskable-on-primary + apple-180 under /icons/1/', async () => {
    await deriveIconsJob.handler({ tenantId, iconVersion: 1, attempt: 0 });

    const detail = await tenantDetail(tenantId);
    const icons = detail.tenant.branding.iconUrls;
    expect(icons).not.toBeNull();
    if (!icons) return;
    detailIcons = icons;
    faviconUrl = detail.tenant.branding.faviconUrl;
    for (const url of [icons.i192, icons.i512, icons.maskable512, icons.apple180]) {
      expect(url).toContain(`/${tenantId}/branding/icons/1/`);
    }
    expect(faviconUrl?.endsWith('/icons/1/favicon.ico')).toBe(true);
    expect(icons.i512.endsWith('/icons/1/icon-512.png')).toBe(true);
    expect(icons.maskable512.endsWith('/icons/1/maskable-512.png')).toBe(true);
    expect(iconsUpToDate(detail.tenant.branding)).toBe(true);

    const i512 = await fetchBytes(icons.i512);
    expect(i512.status).toBe(200);
    expect(i512.type.startsWith('image/png')).toBe(true);
    expect(await inspectBrandingImage(i512.buf, 'image/png')).toMatchObject({
      width: 512,
      height: 512,
    });
    const i192 = await fetchBytes(icons.i192);
    expect(await inspectBrandingImage(i192.buf, 'image/png')).toMatchObject({
      width: 192,
      height: 192,
    });
    const apple = await fetchBytes(icons.apple180);
    expect(await inspectBrandingImage(apple.buf, 'image/png')).toMatchObject({
      width: 180,
      height: 180,
    });

    const maskable = await fetchBytes(icons.maskable512);
    expect(maskable.status).toBe(200);
    expect(await readPixel(maskable.buf, 2, 2)).toEqual(PRIMARY_RGB);
    const centre = await readPixel(maskable.buf, 256, 256);
    expect(centre).not.toEqual(PRIMARY_RGB);
    expect(centre).toEqual(LOGO_RGB);

    const favicon = await fetchBytes(faviconUrl ?? '');
    expect(favicon.status).toBe(200);
    expect([...favicon.buf.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(favicon.buf[4]).toBe(2);

    const objects = await adminSql<{ name: string }[]>`
      select name from storage.objects where bucket_id = 'branding'
       and name like ${`${tenantId}/branding/icons/1/%`} order by name`;
    expect(objects.map((o) => o.name.split('/').pop())).toEqual([
      'apple-touch-icon-180.png',
      'favicon.ico',
      'icon-192.png',
      'icon-512.png',
      'maskable-512.png',
    ]);
  });

  it('4. GET /v1/public/tenants/by-host reflects the icons on the very next request (TENANT-02: host cache invalidated by the job write)', async () => {
    const res = await byHost(host);
    expect(res.status).toBe(200);
    const body = hostTenantSchema.parse(await res.json());
    expect(body.branding.iconUrls?.i512).toBe(detailIcons?.i512);
    expect(body.branding.faviconUrl).toBe(faviconUrl);
    expect(body.branding.logoUrl?.endsWith(path)).toBe(true);
  });
});
