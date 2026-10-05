import {
  BRANDING_UPLOAD_ID_RE,
  bootstrapSchema,
  deriveBrandColors,
  emptyBrandLook,
  hostTenantSchema,
  iconsUpToDate,
  NAVY,
  platformTenantDetailSchema,
} from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { deriveIconsJob } from '@rede-social/core/server/branding/derive-icons-job';
import {
  deriveIconSet,
  inspectBrandingImage,
  readPixel,
} from '@rede-social/core/server/branding/icons';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { brandingInternals, deriveTenantIcons } from '@rede-social/core/server/platform/branding';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

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
 * `inspectBrandingImage` from `@rede-social/core/server/branding/icons`.
 *
 * Every tenant created here carries a unique `pb-…` slug and a unique `…-<run>.cliente.test` host;
 * `afterAll` removes tenants (cascade), Storage objects under their prefixes, pg-boss rows keyed by
 * their ids and the invited auth users.
 */

const RUN = Date.now();
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

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

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

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
  const adminEmail = `admin-${slug}@rede-social-test.local`;
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
 * `@rede-social/core/server/supabase-admin`, which Biome confines to the kernel's admin lane.
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
  await adminSql`delete from auth.users where lower(email) like 'admin-pb-%@rede-social-test.local'`;
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

/** Uploads `bytes` as `kind` for the tenant and completes it; answers the complete response. */
async function uploadAndComplete(
  tenantId: string,
  kind: 'logo' | 'icon',
  mime: string,
  bytes: Buffer,
  putContentType = mime,
) {
  const start = await startUpload(tenantId, { kind, mime, size: bytes.length });
  expect(start.status).toBe(201);
  const { uploadId, signedUrl } = (await start.json()) as { uploadId: string; signedUrl: string };
  const put = await putToSignedUrl(signedUrl, bytes, putContentType);
  expect(put.ok).toBe(true);
  return { uploadId, res: await complete(tenantId, uploadId) };
}

const putColors = (tenantId: string, body: Record<string, unknown>) =>
  platform(`/tenants/${tenantId}/branding/colors`, { method: 'PUT', body });

describe('colours — contrast gate in both modes, one persistence path with PATCH (D-25/D-41)', () => {
  let tenantId = '';
  let host = '';
  let versionBefore = 0;

  it('0. fixture: a tenant with a derived icon set at version 1', async () => {
    const created = await createThrowawayTenant('pb-colors');
    tenantId = created.id;
    host = created.host;
    const { res } = await uploadAndComplete(tenantId, 'logo', 'image/png', LOGO_PNG);
    expect(res.status).toBe(200);
    await deriveIconsJob.handler({ tenantId, iconVersion: 1, attempt: 0 });
    const detail = await tenantDetail(tenantId);
    expect(iconsUpToDate(detail.tenant.branding)).toBe(true);
    versionBefore = detail.tenant.branding.iconVersion;
    expect(versionBefore).toBe(1);
  });

  it('1. a low-contrast pair without confirmation answers 400 { confirmLowContrast: "required", contrastReport } and persists nothing', async () => {
    const res = await putColors(tenantId, { primary: '#ffff00', secondary: '#ffffaa' });
    expect(res.status).toBe(400);
    const err = await envelope(res);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.confirmLowContrast).toBe('required');
    const report = err.details?.contrastReport as { lightSurface: { ok: boolean } };
    expect(report.lightSurface.ok).toBe(false);

    const [row] = await adminSql<{ primary: string; version: string }[]>`
      select branding->'colors'->>'primary' as primary, branding->>'iconVersion' as version
        from public.tenants where id = ${tenantId}::uuid`;
    expect(row?.primary).toBe(PRIMARY);
    expect(Number(row?.version)).toBe(versionBefore);
  });

  it('2. the same pair with confirmLowContrast: true persists, reports the failing check and bumps iconVersion once', async () => {
    const res = await putColors(tenantId, {
      primary: '#ffff00',
      secondary: '#ffffaa',
      confirmLowContrast: true,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const detail = platformTenantDetailSchema.parse(await res.json());
    expect(detail.tenant.branding.colors.primary).toBe('#ffff00');
    expect(detail.tenant.branding.colors.secondary).toBe('#ffffaa');
    expect(detail.tenant.contrast.lightSurface.ok).toBe(false);
    expect(detail.tenant.branding.iconVersion).toBe(versionBefore + 1);
    expect(iconsUpToDate(detail.tenant.branding)).toBe(false);

    const jobs = await deriveJobs(tenantId);
    expect(jobs.filter((j) => j.state === 'created')).toHaveLength(1);
  });

  it('3. the worker re-derives under the new version with a yellow maskable background and by-host reflects the colours at once', async () => {
    await deriveIconsJob.handler({ tenantId, iconVersion: versionBefore + 1, attempt: 0 });
    const detail = await tenantDetail(tenantId);
    const icons = detail.tenant.branding.iconUrls;
    expect(icons?.i512).toContain(`/icons/${versionBefore + 1}/`);
    expect(iconsUpToDate(detail.tenant.branding)).toBe(true);
    const maskable = await fetchBytes(icons?.maskable512 ?? '');
    expect(await readPixel(maskable.buf, 2, 2)).toEqual({ r: 255, g: 255, b: 0, a: 255 });

    const res = await byHost(host);
    const body = hostTenantSchema.parse(await res.json());
    expect(body.branding.colors.primary).toBe('#ffff00');
    expect(body.branding.iconUrls?.maskable512).toBe(icons?.maskable512);
  });

  it('4. a good-contrast pair saves without confirmation; a secondary-only change leaves iconVersion untouched', async () => {
    const good = await putColors(tenantId, { primary: '#1d4ed8', secondary: '#60a5fa' });
    expect(good.status).toBe(200);
    const detail = platformTenantDetailSchema.parse(await good.json());
    expect(detail.tenant.contrast.onPrimary.ok).toBe(true);
    expect(detail.tenant.contrast.lightSurface.ok).toBe(true);
    expect(detail.tenant.contrast.darkSurface.ok).toBe(true);
    const version = detail.tenant.branding.iconVersion;
    expect(version).toBe(versionBefore + 2);

    const secondaryOnly = await putColors(tenantId, { primary: '#1d4ed8', secondary: '#93c5fd' });
    expect(secondaryOnly.status).toBe(200);
    const after = platformTenantDetailSchema.parse(await secondaryOnly.json());
    expect(after.tenant.branding.colors.secondary).toBe('#93c5fd');
    expect(after.tenant.branding.iconVersion).toBe(version);
  });

  it('5. PATCH /v1/platform/tenants/{id} colours share applyBrandColors: iconVersion increments too', async () => {
    const before = (await tenantDetail(tenantId)).tenant.branding.iconVersion;
    const res = await platform(`/tenants/${tenantId}`, {
      method: 'PATCH',
      body: { colors: { primary: '#0f766e', secondary: '#14b8a6' } },
    });
    expect(res.status).toBe(200);
    const detail = platformTenantDetailSchema.parse(await res.json());
    expect(detail.tenant.branding.colors.primary).toBe('#0f766e');
    expect(detail.tenant.branding.iconVersion).toBe(before + 1);
  });

  it('6. a 404 for an unknown tenant and 400 for a malformed body', async () => {
    const missing = await putColors('00000000-0000-4000-8000-000000000000', {
      primary: '#1d4ed8',
      secondary: '#60a5fa',
    });
    expect(missing.status).toBe(404);
    const bad = await putColors(tenantId, { primary: 'blue', secondary: '#60a5fa' });
    expect(bad.status).toBe(400);
    expect((await envelope(bad)).code).toBe('VALIDATION_FAILED');
  });
});

const putLook = (tenantId: string, body: unknown, token?: string) =>
  platform(`/tenants/${tenantId}/branding/look`, { method: 'PUT', body, token });

/**
 * 2026-10-03 — the look beyond the pair, through its own route: the whole look replaces the stored
 * one in its canonical form, the persisted dark accent follows the own dark primary, and the write
 * is a jsonb MERGE (logo, icon set, `iconVersion` and the pair stay exactly as they were; no icon
 * job). A pair save keeps an own dark primary and re-derives an automatic one; by-host and the
 * bootstrap carry the look; the body is strict at every level.
 */
describe('look — PUT …/branding/look persists the six settings, merged, never clobbering (2026-10-03)', () => {
  let tenantId = '';
  let host = '';
  const LOOK = {
    lightTone: 'amarelado',
    darkTone: 'cafe',
    darkColors: { primary: '#FFB4A8', secondary: '#7dd3fc' },
    titleFont: 'Playfair Display',
    fontColors: {
      title: { light: '#7C2D12', dark: '#ffd27a' },
      appName: { light: '#0f766e', dark: null },
    },
    buttonColors: {
      style: 'gradient',
      fill: { light: '#E3AF3F', dark: '#f0cb7a' },
      fillEnd: { light: '#ffd27a', dark: null },
      ink: { light: '#382317', dark: null },
    },
  } as const;
  const STORED = {
    ...LOOK,
    darkColors: { primary: '#ffb4a8', secondary: '#7dd3fc' },
    fontColors: {
      title: { light: '#7c2d12', dark: '#ffd27a' },
      appName: { light: '#0f766e', dark: null },
    },
    buttonColors: { ...LOOK.buttonColors, fill: { light: '#e3af3f', dark: '#f0cb7a' } },
  };

  it('0. fixture: a tenant with a logo-derived icon set, created on the system look', async () => {
    const created = await createThrowawayTenant('pb-look');
    tenantId = created.id;
    host = created.host;
    const { res } = await uploadAndComplete(tenantId, 'logo', 'image/png', LOGO_PNG);
    expect(res.status).toBe(200);
    await deriveIconsJob.handler({ tenantId, iconVersion: 1, attempt: 0 });
    const detail = await tenantDetail(tenantId);
    expect(iconsUpToDate(detail.tenant.branding)).toBe(true);
    expect(detail.tenant.branding.look).toEqual(emptyBrandLook());
  });

  it('1. saves the whole look, canonical; the dark accent follows the own primary; logo, icons and pair untouched; no icon job', async () => {
    const before = (await tenantDetail(tenantId)).tenant.branding;
    const jobsBefore = (await deriveJobs(tenantId)).length;

    const res = await putLook(tenantId, LOOK);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const b = platformTenantDetailSchema.parse(await res.json()).tenant.branding;
    expect(b.look).toEqual(STORED);
    expect(b.colors.primaryDark).toBe('#ffb4a8');
    expect(b.colors.onPrimaryDark).toBe(NAVY);
    expect(b.colors.primary).toBe(before.colors.primary);
    expect(b.colors.secondary).toBe(before.colors.secondary);
    expect(b.colors.onPrimary).toBe(before.colors.onPrimary);
    expect(b.logoUrl).toBe(before.logoUrl);
    expect(b.faviconUrl).toBe(before.faviconUrl);
    expect(b.iconUrls).toEqual(before.iconUrls);
    expect(b.iconVersion).toBe(before.iconVersion);
    expect(await deriveJobs(tenantId)).toHaveLength(jobsBefore);

    // The raw row: the look under `look`, the accent merged into `colors`, the rest as it was.
    const [row] = await adminSql<
      { look: Record<string, unknown>; dark: string; logo: string; version: string }[]
    >`
      select branding->'look' as look, branding->'colors'->>'primaryDark' as dark,
             branding->>'logoUrl' as logo, branding->>'iconVersion' as version
        from public.tenants where id = ${tenantId}::uuid`;
    expect(row?.look).toEqual(STORED);
    expect(row?.dark).toBe('#ffb4a8');
    expect(row?.logo).toBe(before.logoUrl);
    expect(Number(row?.version)).toBe(before.iconVersion);
  });

  it('2. the public by-host answer carries the look on the very next request', async () => {
    const res = await byHost(host);
    expect(res.status).toBe(200);
    const body = hostTenantSchema.parse(await res.json());
    expect(body.branding.look).toEqual(STORED);
    expect(body.branding.colors.primaryDark).toBe('#ffb4a8');
  });

  it('3. a pair save keeps the own dark primary and the look', async () => {
    const res = await putColors(tenantId, { primary: '#1d4ed8', secondary: '#60a5fa' });
    expect(res.status).toBe(200);
    const b = platformTenantDetailSchema.parse(await res.json()).tenant.branding;
    expect(b.colors.primary).toBe('#1d4ed8');
    expect(b.colors.primaryDark).toBe('#ffb4a8');
    expect(b.look).toEqual(STORED);
  });

  it('4. {} resets the system look; the dark accent goes back to the derivation of the current pair', async () => {
    const res = await putLook(tenantId, {
      lightTone: 'cinza',
      darkTone: 'grafite',
      titleFont: 'Manrope',
    });
    expect(res.status).toBe(200);
    const b = platformTenantDetailSchema.parse(await res.json()).tenant.branding;
    expect(b.look).toEqual(emptyBrandLook());
    const derived = deriveBrandColors({ primary: '#1d4ed8', secondary: '#60a5fa' });
    expect(b.colors.primaryDark).toBe(derived.primaryDark);
    expect(b.colors.onPrimaryDark).toBe(derived.onPrimaryDark);
    // The default ids and Manrope have ONE spelling in the row: null.
    const [row] = await adminSql<{ tone: string | null; font: string | null }[]>`
      select branding->'look'->>'lightTone' as tone, branding->'look'->>'titleFont' as font
        from public.tenants where id = ${tenantId}::uuid`;
    expect(row?.tone).toBeNull();
    expect(row?.font).toBeNull();
    // A pair save with no own dark primary re-derives it from the new primary.
    const pair = await putColors(tenantId, { primary: '#0f766e', secondary: '#14b8a6' });
    const after = platformTenantDetailSchema.parse(await pair.json()).tenant.branding;
    expect(after.colors.primaryDark).toBe(
      deriveBrandColors({ primary: '#0f766e', secondary: '#14b8a6' }).primaryDark,
    );
  });

  it('5. 400 on an unknown key, a free colour as a tone or an unsafe family name; 404 unknown tenant', async () => {
    for (const [body, path] of [
      [{ background: '#ffffff' }, ''],
      [{ lightTone: '#f5efe5' }, 'lightTone'],
      [{ darkTone: 'amarelado' }, 'darkTone'],
      [{ titleFont: 'Poppins;color:red' }, 'titleFont'],
      [{ buttonColors: { hover: { light: '#000000' } } }, 'buttonColors'],
      [{ fontColors: { title: { light: '#fff' } } }, 'fontColors.title.light'],
    ] as const) {
      const res = await putLook(tenantId, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const err = await envelope(res);
      expect(err.code).toBe('VALIDATION_FAILED');
      const issues = (err.details?.issues ?? []) as { path: string }[];
      const paths = issues.map((issue) => issue.path);
      expect(paths, JSON.stringify(body)).toContain(path);
    }
    const missing = await putLook('00000000-0000-4000-8000-000000000000', {});
    expect(missing.status).toBe(404);
    // Nothing above was written.
    expect((await tenantDetail(tenantId)).tenant.branding.look).toEqual(emptyBrandLook());
  });

  it('6. a member Bearer is refused (403); the bootstrap carries the look of the member own tenant', async () => {
    if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
    const member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
    const res = await putLook(tenantId, LOOK, member);
    expect(res.status).toBe(403);
    expect((await envelope(res)).code).toBe('FORBIDDEN');
    // Read-only on the seeded tenant: its bootstrap brand answers a complete look.
    const boot = await api.request('/v1/me/bootstrap', {
      headers: { authorization: `Bearer ${member}` },
    });
    expect(boot.status).toBe(200);
    const look = bootstrapSchema.parse(await boot.json()).tenant.branding.look;
    expect(Object.keys(look).sort()).toEqual(
      ['buttonColors', 'darkColors', 'darkTone', 'fontColors', 'lightTone', 'titleFont'].sort(),
    );
  });

  it('7. POST /tenants stores the wizard look (canonical, the dark accent following it); a bad look creates nothing', async () => {
    const slug = `pb-look-new-${RUN}`.slice(0, 40);
    const adminEmail = `admin-${slug}@rede-social-test.local`;
    createdAuthEmails.push(adminEmail);
    const body = {
      displayName: `Marca ${slug}`,
      slug,
      colors: { primary: PRIMARY, secondary: '#a78bfa' },
      modules: ['feed'],
      adminEmail,
    };
    const refused = await platform('/tenants', {
      method: 'POST',
      body: { ...body, look: { lightTone: 'rosa' } },
    });
    expect(refused.status).toBe(400);
    const [none] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenants where slug = ${slug}`;
    expect(none?.n).toBe('0');

    const res = await platform('/tenants', {
      method: 'POST',
      body: { ...body, look: { ...LOOK, darkTone: 'grafite' } },
    });
    expect(res.status).toBe(201);
    const detail = platformTenantDetailSchema.parse(await res.json());
    createdTenantIds.push(detail.tenant.id);
    expect(detail.tenant.branding.look).toEqual({ ...STORED, darkTone: null });
    expect(detail.tenant.branding.colors.primary).toBe(PRIMARY);
    expect(detail.tenant.branding.colors.primaryDark).toBe('#ffb4a8');
    expect(detail.tenant.branding.colors.onPrimaryDark).toBe(NAVY);
  });
});

describe('square-icon override — set, derive from it, remove, derive from the logo again (D-28)', () => {
  const SQUARE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#10b981"/></svg>`;
  const GREEN = { r: 16, g: 185, b: 129, a: 255 };
  let tenantId = '';
  let overrideKey = '';

  it('0. fixture: tenant with a logo-derived set', async () => {
    tenantId = (await createThrowawayTenant('pb-icon')).id;
    const { res } = await uploadAndComplete(tenantId, 'logo', 'image/png', LOGO_PNG);
    expect(res.status).toBe(200);
    await deriveIconsJob.handler({ tenantId, iconVersion: 1, attempt: 0 });
    const icons = (await tenantDetail(tenantId)).tenant.branding.iconUrls;
    const i512 = await fetchBytes(icons?.i512 ?? '');
    expect(await readPixel(i512.buf, 256, 256)).toEqual(LOGO_RGB);
  });

  it('1. uploading kind "icon" sets iconUrl, bumps iconVersion and the next derivation uses the override', async () => {
    const squarePng = (
      await deriveIconSet(Buffer.from(SQUARE_SVG), { primaryHex: PRIMARY, mime: 'image/svg+xml' })
    ).i512;
    const start = await startUpload(tenantId, {
      kind: 'icon',
      mime: 'image/png',
      size: squarePng.length,
    });
    expect(start.status).toBe(201);
    const { uploadId, signedUrl } = (await start.json()) as {
      uploadId: string;
      signedUrl: string;
    };
    expect(uploadId.startsWith('icon-')).toBe(true);
    expect((await putToSignedUrl(signedUrl, squarePng, 'image/png')).ok).toBe(true);
    const res = await complete(tenantId, uploadId);
    expect(res.status).toBe(200);
    const detail = platformTenantDetailSchema.parse(await res.json());
    expect(detail.tenant.branding.iconUrl).toContain(`/${tenantId}/branding/`);
    expect(detail.tenant.branding.iconUrl?.endsWith(`${uploadId.slice(5)}`)).toBe(true);
    expect(detail.tenant.branding.logoUrl).not.toBeNull();
    expect(detail.tenant.branding.iconVersion).toBe(2);
    overrideKey = `${tenantId}/branding/${uploadId.slice(5)}`;

    await deriveIconsJob.handler({ tenantId, iconVersion: 2, attempt: 0 });
    const after = await tenantDetail(tenantId);
    expect(after.tenant.branding.iconUrls?.i512).toContain('/icons/2/');
    const i512 = await fetchBytes(after.tenant.branding.iconUrls?.i512 ?? '');
    expect(await readPixel(i512.buf, 256, 256)).toEqual(GREEN);
  });

  it('2. DELETE …/branding/icon clears the override, removes the object, bumps iconVersion and re-derives from the logo', async () => {
    expect(await objectNames(tenantId)).toContain(overrideKey);
    const res = await platform(`/tenants/${tenantId}/branding/icon`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const detail = platformTenantDetailSchema.parse(await res.json());
    expect(detail.tenant.branding.iconUrl).toBeNull();
    expect(detail.tenant.branding.iconVersion).toBe(3);
    expect(await objectNames(tenantId)).not.toContain(overrideKey);

    await deriveIconsJob.handler({ tenantId, iconVersion: 3, attempt: 0 });
    const after = await tenantDetail(tenantId);
    expect(after.tenant.branding.iconUrls?.i512).toContain('/icons/3/');
    const i512 = await fetchBytes(after.tenant.branding.iconUrls?.i512 ?? '');
    expect(await readPixel(i512.buf, 256, 256)).toEqual(LOGO_RGB);

    // Idempotent: no override → no write, the unchanged detail.
    const again = await platform(`/tenants/${tenantId}/branding/icon`, { method: 'DELETE' });
    expect(again.status).toBe(200);
    expect(platformTenantDetailSchema.parse(await again.json()).tenant.branding.iconVersion).toBe(
      3,
    );
  });
});

describe('upload edges — validation, size, missing objects, spoofed and unsafe files', () => {
  let tenantId = '';

  it('0. fixture', async () => {
    tenantId = (await createThrowawayTenant('pb-edges')).id;
  });

  it('1. image/gif answers 400 with the issue path "mime"; 3 MiB answers 413 { size: "too_large" }', async () => {
    const gif = await startUpload(tenantId, { kind: 'logo', mime: 'image/gif', size: 10 });
    expect(gif.status).toBe(400);
    const gifErr = await envelope(gif);
    expect(gifErr.code).toBe('VALIDATION_FAILED');
    const issues = (gifErr.details?.issues ?? []) as { path: string }[];
    expect(issues[0]?.path).toBe('mime');

    const big = await startUpload(tenantId, {
      kind: 'logo',
      mime: 'image/png',
      size: 3 * 1024 * 1024,
    });
    expect(big.status).toBe(413);
    const bigErr = await envelope(big);
    expect(bigErr.code).toBe('VALIDATION_FAILED');
    expect(bigErr.details?.size).toBe('too_large');
    expect(bigErr.details?.maxBytes).toBe(2097152);
  });

  it('2. an unknown tenant answers 404 on start; a never-uploaded id answers 404 { upload: "object_missing" }; a traversal id answers 400', async () => {
    const unknown = await startUpload('00000000-0000-4000-8000-000000000000', {
      kind: 'logo',
      mime: 'image/png',
      size: 10,
    });
    expect(unknown.status).toBe(404);
    expect((await envelope(unknown)).code).toBe('NOT_FOUND');

    const start = await startUpload(tenantId, { kind: 'logo', mime: 'image/png', size: 10 });
    const { uploadId } = (await start.json()) as { uploadId: string };
    const missing = await complete(tenantId, uploadId);
    expect(missing.status).toBe(404);
    const missingErr = await envelope(missing);
    expect(missingErr.code).toBe('NOT_FOUND');
    expect(missingErr.details?.upload).toBe('object_missing');

    const traversal = await complete(tenantId, '..%2Fx');
    expect(traversal.status).toBe(400);
    expect((await envelope(traversal)).code).toBe('VALIDATION_FAILED');
  });

  it('3. HTML bytes declared as PNG → 400 { upload: "not_an_image" } and the object is removed', async () => {
    const { uploadId, res } = await uploadAndComplete(
      tenantId,
      'logo',
      'image/png',
      Buffer.from('<html>hi</html>'),
    );
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.upload).toBe('not_an_image');
    expect(await objectNames(tenantId)).not.toContain(`${tenantId}/branding/${uploadId.slice(5)}`);
    const detail = await tenantDetail(tenantId);
    expect(detail.tenant.branding.logoUrl).toBeNull();
    expect(detail.tenant.branding.iconVersion).toBe(0);
  });

  it('4. SVG bytes under a png id → 400 { upload: "format_mismatch" }', async () => {
    const { res } = await uploadAndComplete(tenantId, 'logo', 'image/png', Buffer.from(LOGO_SVG));
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.upload).toBe('format_mismatch');
  });

  it('5. an SVG with <script> under an svg id → 400 { upload: "svg_unsafe" }', async () => {
    const evil = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const { res } = await uploadAndComplete(tenantId, 'logo', 'image/svg+xml', evil);
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.upload).toBe('svg_unsafe');
  });
});

describe('isolation and auth — tenant prefixes never cross, members are refused (T-02-83/84, ROLE-03)', () => {
  let tenantA = '';
  let tenantB = '';

  it("1. tenant B completing tenant A's uploadId finds nothing under B's prefix (404)", async () => {
    tenantA = (await createThrowawayTenant('pb-iso-a')).id;
    tenantB = (await createThrowawayTenant('pb-iso-b')).id;

    const startA = await startUpload(tenantA, {
      kind: 'logo',
      mime: 'image/png',
      size: LOGO_PNG.length,
    });
    const bodyA = (await startA.json()) as { uploadId: string; signedUrl: string; path: string };
    expect(bodyA.path.startsWith(`${tenantA}/branding/`)).toBe(true);
    expect((await putToSignedUrl(bodyA.signedUrl, LOGO_PNG, 'image/png')).ok).toBe(true);

    const startB = await startUpload(tenantB, { kind: 'logo', mime: 'image/png', size: 10 });
    const bodyB = (await startB.json()) as { path: string };
    expect(bodyB.path.startsWith(`${tenantB}/branding/`)).toBe(true);

    const crossed = await complete(tenantB, bodyA.uploadId);
    expect(crossed.status).toBe(404);
    expect((await envelope(crossed)).details?.upload).toBe('object_missing');

    const own = await complete(tenantA, bodyA.uploadId);
    expect(own.status).toBe(200);
    await deriveIconsJob.handler({ tenantId: tenantA, iconVersion: 1, attempt: 0 });
    const icons = (await tenantDetail(tenantA)).tenant.branding.iconUrls;
    expect(icons).not.toBeNull();
    for (const url of Object.values(icons ?? {})) {
      expect(url).toContain(`/${tenantA}/branding/icons/`);
    }
    expect((await tenantDetail(tenantB)).tenant.branding.logoUrl).toBeNull();
  });

  it('2. a seeded member Bearer answers 403 FORBIDDEN on the upload route', async () => {
    if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
    const member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
    const res = await startUpload(tenantA, { kind: 'logo', mime: 'image/png', size: 10 }, member);
    expect(res.status).toBe(403);
    expect((await envelope(res)).code).toBe('FORBIDDEN');
  });
});

describe('supersede protection and job resilience (T-02-88)', () => {
  let tenantId = '';

  it('1. a version bump between derivation and write makes the run "superseded"; the next run derives at the bumped version', async () => {
    tenantId = (await createThrowawayTenant('pb-race')).id;
    const { res } = await uploadAndComplete(tenantId, 'logo', 'image/png', LOGO_PNG);
    expect(res.status).toBe(200);
    await deriveIconsJob.handler({ tenantId, iconVersion: 1, attempt: 0 });
    const before = (await tenantDetail(tenantId)).tenant.branding;
    expect(before.iconUrls?.i512).toContain('/icons/1/');

    const original = brandingInternals.beforeIconWrite;
    brandingInternals.beforeIconWrite = async () => {
      await adminSql`
        update public.tenants
           set branding = jsonb_set(branding, '{iconVersion}', to_jsonb((branding->>'iconVersion')::int + 1))
         where id = ${tenantId}::uuid`;
    };
    try {
      const result = await deriveTenantIcons(tenantId, { actor: { userId: 'test' } });
      expect(result.outcome).toBe('superseded');
      expect(result.iconVersion).toBe(1);
    } finally {
      brandingInternals.beforeIconWrite = original;
    }
    const after = (await tenantDetail(tenantId)).tenant.branding;
    expect(after.iconVersion).toBe(2);
    expect(after.iconUrls?.i512).toBe(before.iconUrls?.i512);
    expect(iconsUpToDate(after)).toBe(false);

    await deriveIconsJob.handler({ tenantId, iconVersion: -1, attempt: 0 });
    const derived = (await tenantDetail(tenantId)).tenant.branding;
    expect(derived.iconUrls?.i512).toContain('/icons/2/');
    expect(iconsUpToDate(derived)).toBe(true);
  });

  it('2. the handler swallows malformed payloads and deleted tenants without throwing or enqueuing', async () => {
    await expect(
      deriveIconsJob.handler({ tenantId: 'not-a-uuid', iconVersion: 1, attempt: 0 }),
    ).resolves.toBeUndefined();
    const gone = '00000000-0000-4000-8000-00000000dead';
    await expect(
      deriveIconsJob.handler({ tenantId: gone, iconVersion: 1, attempt: 0 }),
    ).resolves.toBeUndefined();
    expect(await deriveJobs(gone)).toHaveLength(0);
  });
});
