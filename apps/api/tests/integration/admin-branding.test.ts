import { randomUUID } from 'node:crypto';
import { type AdminBranding, adminBrandingSchema, iconsUpToDate } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { deriveIconsJob } from '@rede-social/core/server/branding/derive-icons-job';
import { deriveIconSet } from '@rede-social/core/server/branding/icons';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * 08-06 — the tenant lane's brand editor API (ADMIN-01, D-342) against the live local stack:
 * `/v1/admin/branding/*` and `PATCH /v1/admin/tenant`.
 *
 * `branding tracer`: `admin@rede-demo.local` saves new colours through `PUT /v1/admin/branding/colors`
 * (no tenant id anywhere in the request); rede-demo's stored brand changes, rede-lab's does not, and
 * the admin's very next bootstrap carries the new primary (the shell reads it per request). The same
 * contrast gate as the platform lane refuses a failing pair without the confirmation, and support and
 * member get 403.
 *
 * Then (Task 2) the uploads on the session's prefix, a rede-lab `uploadId` completed from rede-demo
 * (the bare 404, nothing changes), the display name (`required`, `too_long`, strict body), the
 * last-write-wins case between the super_admin's platform route and the admin's, and the
 * permission and host gates on every route.
 *
 * The SEEDED tenants are the subjects because the truths name them, so `afterAll` puts both brand
 * rows (and rede-demo's display name) back exactly as the seed wrote them, removes every Storage
 * object this run uploaded and closes the derivation jobs it queued. No later suite inherits a
 * changed seed brand.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type BrandRow = { display_name: string; branding: Record<string, unknown> };

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

const tokens = { admin: '', member: '', support: '', labAdmin: '', superAdmin: '' };
const ids = { demo: '', lab: '' };
const snapshot: Record<'demo' | 'lab', BrandRow | null> = { demo: null, lab: null };
/** Storage objects each seed tenant had before this run: everything else under its prefix is ours. */
const seedObjects: Record<'demo' | 'lab', Set<string>> = { demo: new Set(), lab: new Set() };
const RUN_START = new Date();

/** A 300×120 wordmark rendered to PNG through the kernel (the api package has no `sharp`). */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><rect width="300" height="120" rx="12" fill="#f59e0b"/></svg>`;
const SQUARE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#dc2626"/></svg>`;
let LOGO_PNG: Buffer;
let SQUARE_PNG: Buffer;

const request = (
  path: string,
  token: string,
  init: { method?: string; body?: unknown; host?: string } = {},
) =>
  api.request(path, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': init.host ?? HOSTS.demo,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

const putColors = (token: string, body: unknown, host?: string) =>
  request('/v1/admin/branding/colors', token, { method: 'PUT', body, host });

async function envelope(res: Response): Promise<Envelope> {
  return (await res.json()) as Envelope;
}

async function brandRow(tenantId: string): Promise<BrandRow> {
  const [row] = await adminSql<BrandRow[]>`
    select display_name, branding from public.tenants where id = ${tenantId}::uuid`;
  if (!row) throw new Error(`tenant ${tenantId} not found`);
  return row;
}

async function storedPrimary(tenantId: string): Promise<string | undefined> {
  const row = await brandRow(tenantId);
  return (row.branding.colors as { primary?: string } | undefined)?.primary;
}

async function adminBrand(res: Response): Promise<AdminBranding> {
  return adminBrandingSchema.parse(await res.json());
}

/**
 * Service-key Storage client for fixture cleanup only (the platform-branding precedent: the Storage
 * schema forbids direct deletes from `storage.objects`, and `supabase-admin` is kernel-only).
 */
function storageAdmin() {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
}

async function objectNames(tenantId: string): Promise<string[]> {
  const rows = await adminSql<{ name: string }[]>`
    select name from storage.objects where bucket_id = 'branding' and name like ${`${tenantId}/%`}`;
  return rows.map((row) => row.name);
}

/** Removes the objects this run added under a seed tenant's prefix; the seed's own stay. */
async function removeRunObjects(key: 'demo' | 'lab'): Promise<void> {
  const added = (await objectNames(ids[key])).filter((name) => !seedObjects[key].has(name));
  if (added.length === 0) return;
  const { error } = await storageAdmin().from('branding').remove(added);
  if (error) throw new Error(`storage cleanup failed: ${error.message}`);
}

/** Start → PUT the bytes straight to Storage → the upload id (never through the API). */
async function uploadBytes(
  token: string,
  kind: 'logo' | 'icon',
  bytes: Buffer,
  host?: string,
): Promise<{ uploadId: string; path: string }> {
  const started = await request('/v1/admin/branding/uploads', token, {
    method: 'POST',
    body: { kind, mime: 'image/png', size: bytes.length },
    host,
  });
  expect(started.status).toBe(201);
  expect(started.headers.get('cache-control')).toBe('no-store');
  const body = (await started.json()) as { uploadId: string; signedUrl: string; path: string };
  const put = await fetch(body.signedUrl, {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: { 'content-type': 'image/png', 'x-upsert': 'false' },
  });
  expect(put.ok).toBe(true);
  return { uploadId: body.uploadId, path: body.path };
}

const completeUpload = (token: string, uploadId: string, host?: string) =>
  request(`/v1/admin/branding/uploads/${uploadId}/complete`, token, { method: 'POST', host });

const patchTenant = (token: string, body: unknown, host?: string) =>
  request('/v1/admin/tenant', token, { method: 'PATCH', body, host });

/** The super_admin's colours route on the platform lane (path id, `requireSuperAdmin`). */
const platformColors = (tenantId: string, body: unknown) =>
  api.request(`/v1/platform/tenants/${tenantId}/branding/colors`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${tokens.superAdmin}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  ids.demo = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  ids.lab = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';
  snapshot.demo = await brandRow(ids.demo);
  snapshot.lab = await brandRow(ids.lab);
  seedObjects.demo = new Set(await objectNames(ids.demo));
  seedObjects.lab = new Set(await objectNames(ids.lab));
  LOGO_PNG = (
    await deriveIconSet(Buffer.from(LOGO_SVG), { primaryHex: '#7c3aed', mime: 'image/svg+xml' })
  ).i512;
  SQUARE_PNG = (
    await deriveIconSet(Buffer.from(SQUARE_SVG), { primaryHex: '#7c3aed', mime: 'image/svg+xml' })
  ).i512;

  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.support = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  if (SUPER_ADMIN_PASSWORD) {
    tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  }
});

afterAll(async () => {
  for (const key of ['demo', 'lab'] as const) {
    const row = snapshot[key];
    if (!row) continue;
    await adminSql`
      update public.tenants
         set display_name = ${row.display_name}, branding = ${adminSql.json(row.branding as never)}
       where id = ${ids[key]}::uuid`;
  }
  // The derivations this run queued for the seed tenants are closed, not run: the seed's own icon
  // set (restored above) is the fixture every later suite reads.
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name = 'kernel.branding-derive-icons' and state = 'created'
       and singleton_key in (${ids.demo}, ${ids.lab}) and created_on >= ${RUN_START}`;
  await removeRunObjects('demo');
  await removeRunObjects('lab');
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('branding tracer', () => {
  it('the admin saves new colours: 200 no-store, demo changes, lab does not, and the next bootstrap carries them', async () => {
    const labBefore = await brandRow(ids.lab);

    const res = await putColors(tokens.admin, { primary: '#1d4ed8', secondary: '#60a5fa' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const raw = (await res.clone().json()) as Record<string, unknown>;
    // The tenant lane answers the three brand facts only — never the platform detail (T-08-31).
    expect(Object.keys(raw)).toEqual(['tenant']);
    expect(Object.keys(raw.tenant as object).sort()).toEqual([
      'branding',
      'contrast',
      'displayName',
    ]);
    const body = await adminBrand(res);
    expect(body.tenant.displayName).toBe(snapshot.demo?.display_name);
    expect(body.tenant.branding.colors.primary).toBe('#1d4ed8');
    expect(body.tenant.contrast.onPrimary.ok).toBe(true);

    expect(await storedPrimary(ids.demo)).toBe('#1d4ed8');
    expect(await brandRow(ids.lab)).toEqual(labBefore);

    const read = await request('/v1/admin/branding', tokens.admin);
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect((await adminBrand(read)).tenant.branding.colors.primary).toBe('#1d4ed8');

    // The authenticated shell reads the brand from the per-request bootstrap: no cache in between.
    const bootstrap = await request('/v1/me/bootstrap', tokens.admin);
    expect(bootstrap.status).toBe(200);
    const shell = (await bootstrap.json()) as {
      tenant: { branding: { colors?: { primary?: string } } };
    };
    expect(shell.tenant.branding.colors?.primary).toBe('#1d4ed8');
  });

  it('a failing contrast pair is the platform gate: 400 with the report, nothing saved; confirmed, it saves', async () => {
    const before = await storedPrimary(ids.demo);
    const refused = await putColors(tokens.admin, { primary: '#ffff00', secondary: '#ffffaa' });
    expect(refused.status).toBe(400);
    const { error } = await envelope(refused);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.confirmLowContrast).toBe('required');
    expect(error.details?.contrastReport).toMatchObject({
      onPrimary: { ok: expect.any(Boolean) },
      lightSurface: { ok: false },
    });
    expect(await storedPrimary(ids.demo)).toBe(before);

    const confirmed = await putColors(tokens.admin, {
      primary: '#ffff00',
      secondary: '#ffffaa',
      confirmLowContrast: true,
    });
    expect(confirmed.status).toBe(200);
    expect(await storedPrimary(ids.demo)).toBe('#ffff00');
  });

  it('no tenant id can ride along: a body carrying one is a 400 and changes nothing', async () => {
    const before = await storedPrimary(ids.demo);
    const res = await putColors(tokens.admin, {
      primary: '#0f766e',
      secondary: '#14b8a6',
      tenantId: ids.lab,
    });
    expect(res.status).toBe(400);
    expect(await storedPrimary(ids.demo)).toBe(before);
    expect(await brandRow(ids.lab)).toEqual(snapshot.lab);
  });

  it('support and member get 403 FORBIDDEN on the read and the write', async () => {
    for (const token of [tokens.support, tokens.member]) {
      const read = await request('/v1/admin/branding', token);
      expect(read.status).toBe(403);
      expect((await envelope(read)).error.code).toBe('FORBIDDEN');
      const write = await putColors(token, { primary: '#1d4ed8', secondary: '#60a5fa' });
      expect(write.status).toBe(403);
      expect((await envelope(write)).error.code).toBe('FORBIDDEN');
    }
  });

  it("rede-lab's admin edits rede-lab only (the session decides the tenant)", async () => {
    const demoBefore = await brandRow(ids.demo);
    const res = await putColors(
      tokens.labAdmin,
      { primary: '#be123c', secondary: '#fb7185' },
      HOSTS.lab,
    );
    expect(res.status).toBe(200);
    expect(await storedPrimary(ids.lab)).toBe('#be123c');
    expect(await brandRow(ids.demo)).toEqual(demoBefore);
  });
});

describe('uploads on the tenant lane', () => {
  it("a logo is minted under the session tenant's prefix, completed, and derived by the worker", async () => {
    const labBefore = await brandRow(ids.lab);
    const before = (await adminBrand(await request('/v1/admin/branding', tokens.admin))).tenant
      .branding.iconVersion;

    const { uploadId, path } = await uploadBytes(tokens.admin, 'logo', LOGO_PNG);
    expect(path.startsWith(`${ids.demo}/branding/`)).toBe(true);

    const res = await completeUpload(tokens.admin, uploadId);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const completed = await adminBrand(res);
    expect(completed.tenant.branding.logoUrl?.endsWith(path)).toBe(true);
    const version = completed.tenant.branding.iconVersion;
    expect(version).toBe(before + 1);
    expect(iconsUpToDate(completed.tenant.branding)).toBe(false);

    // The worker's handler, in process (the platform-branding precedent).
    await deriveIconsJob.handler({ tenantId: ids.demo, iconVersion: version, attempt: 0 });
    const derived = await adminBrand(await request('/v1/admin/branding', tokens.admin));
    expect(iconsUpToDate(derived.tenant.branding)).toBe(true);
    expect(derived.tenant.branding.iconUrls?.i512).toContain(
      `/${ids.demo}/branding/icons/${version}/`,
    );
    expect(derived.tenant.branding.faviconUrl).toContain(`/${ids.demo}/branding/icons/${version}/`);
    expect(await brandRow(ids.lab)).toEqual(labBefore);
  });

  it('the square icon override, then its removal (idempotent)', async () => {
    const { uploadId } = await uploadBytes(tokens.admin, 'icon', SQUARE_PNG);
    const completed = await adminBrand(await completeUpload(tokens.admin, uploadId));
    expect(completed.tenant.branding.iconUrl).toContain(`/${ids.demo}/branding/`);

    const removed = await request('/v1/admin/branding/icon', tokens.admin, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(removed.headers.get('cache-control')).toBe('no-store');
    const after = await adminBrand(removed);
    expect(after.tenant.branding.iconUrl).toBeNull();
    expect(after.tenant.branding.iconVersion).toBe(completed.tenant.branding.iconVersion + 1);

    const again = await adminBrand(
      await request('/v1/admin/branding/icon', tokens.admin, { method: 'DELETE' }),
    );
    expect(again.tenant.branding.iconVersion).toBe(after.tenant.branding.iconVersion);
  });

  it('a rede-lab uploadId completed from rede-demo is the same bare 404 a nonexistent one gets, and changes nothing', async () => {
    const demoBefore = await brandRow(ids.demo);
    const labBefore = await brandRow(ids.lab);
    const lab = await uploadBytes(tokens.labAdmin, 'logo', LOGO_PNG, HOSTS.lab);
    expect(lab.path.startsWith(`${ids.lab}/branding/`)).toBe(true);

    const foreign = await completeUpload(tokens.admin, lab.uploadId);
    const unknown = await completeUpload(tokens.admin, `logo-${randomUUID()}.png`);
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    const [foreignError, unknownError] = [
      (await envelope(foreign)).error,
      (await envelope(unknown)).error,
    ];
    expect(foreignError.code).toBe('NOT_FOUND');
    expect(foreignError.details).toEqual(unknownError.details);
    expect(foreignError.code).toBe(unknownError.code);

    expect(await brandRow(ids.demo)).toEqual(demoBefore);
    expect(await brandRow(ids.lab)).toEqual(labBefore);
    // The lab object is untouched (never recorded, never removed from the other tenant's prefix).
    expect(await objectNames(ids.lab)).toContain(lab.path);
  });

  it('an oversized upload is the shipped 413 (T-08-34)', async () => {
    const res = await request('/v1/admin/branding/uploads', tokens.admin, {
      method: 'POST',
      body: { kind: 'logo', mime: 'image/png', size: 2 * 1024 * 1024 + 1 },
    });
    expect(res.status).toBe(413);
    expect((await envelope(res)).error.details).toMatchObject({ size: 'too_large' });
  });
});

describe('display name', () => {
  it('empty or spaces-only is required; over 60 is too_long; nothing is saved', async () => {
    const before = (await brandRow(ids.demo)).display_name;
    for (const [value, reason] of [
      ['', 'required'],
      ['    ', 'required'],
      ['a'.repeat(61), 'too_long'],
    ] as const) {
      const res = await patchTenant(tokens.admin, { displayName: value });
      expect(res.status).toBe(400);
      const { error } = await envelope(res);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({ displayName: reason });
    }
    expect((await brandRow(ids.demo)).display_name).toBe(before);
  });

  it('a valid name (accents, emoji, trimmed) is saved for demo only and the next bootstrap carries it', async () => {
    const labBefore = await brandRow(ids.lab);
    const res = await patchTenant(tokens.admin, { displayName: '  Rede Demo Ação 🎉  ' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await adminBrand(res)).tenant.displayName).toBe('Rede Demo Ação 🎉');
    expect((await brandRow(ids.demo)).display_name).toBe('Rede Demo Ação 🎉');
    expect(await brandRow(ids.lab)).toEqual(labBefore);

    const bootstrap = await request('/v1/me/bootstrap', tokens.admin);
    expect(
      ((await bootstrap.json()) as { tenant: { displayName: string } }).tenant.displayName,
    ).toBe('Rede Demo Ação 🎉');
  });

  it('the strict body refuses anything beside the name: status, slug, modules (T-08-32)', async () => {
    for (const extra of [{ status: 'suspended' }, { slug: 'outra' }, { modules: [] }]) {
      const res = await patchTenant(tokens.admin, { displayName: 'Rede Demo', ...extra });
      expect(res.status).toBe(400);
      expect((await envelope(res)).error.code).toBe('VALIDATION_FAILED');
    }
    const [row] = await adminSql<{ status: string; slug: string }[]>`
      select status, slug from public.tenants where id = ${ids.demo}::uuid`;
    expect(row).toEqual({ status: 'active', slug: 'rede-demo' });
  });
});

describe('last write wins between the super_admin and the admin (D-342)', () => {
  it('last write wins: platform then admin leaves the admin colours; admin then platform leaves the platform colours', async () => {
    if (!tokens.superAdmin) throw new Error('SUPER_ADMIN_PASSWORD is required for this case');

    expect(
      (await platformColors(ids.demo, { primary: '#9333ea', secondary: '#c084fc' })).status,
    ).toBe(200);
    expect(
      (await putColors(tokens.admin, { primary: '#15803d', secondary: '#4ade80' })).status,
    ).toBe(200);
    expect(await storedPrimary(ids.demo)).toBe('#15803d');
    expect(
      (await adminBrand(await request('/v1/admin/branding', tokens.admin))).tenant.branding.colors
        .primary,
    ).toBe('#15803d');

    expect(
      (await putColors(tokens.admin, { primary: '#b45309', secondary: '#fbbf24' })).status,
    ).toBe(200);
    expect(
      (await platformColors(ids.demo, { primary: '#1d4ed8', secondary: '#60a5fa' })).status,
    ).toBe(200);
    expect(await storedPrimary(ids.demo)).toBe('#1d4ed8');
  });
});

describe('gates on every route', () => {
  const routes: { label: string; method: string; path: string; body?: unknown }[] = [
    { label: 'read', method: 'GET', path: '/v1/admin/branding' },
    {
      label: 'colours',
      method: 'PUT',
      path: '/v1/admin/branding/colors',
      body: { primary: '#1d4ed8', secondary: '#60a5fa' },
    },
    {
      label: 'upload start',
      method: 'POST',
      path: '/v1/admin/branding/uploads',
      body: { kind: 'logo', mime: 'image/png', size: 100 },
    },
    {
      label: 'upload complete',
      method: 'POST',
      path: `/v1/admin/branding/uploads/logo-${randomUUID()}.png/complete`,
    },
    { label: 'remove icon', method: 'DELETE', path: '/v1/admin/branding/icon' },
    {
      label: 'display name',
      method: 'PATCH',
      path: '/v1/admin/tenant',
      body: { displayName: 'X' },
    },
  ];

  it('support and member get 403 FORBIDDEN on every route', async () => {
    for (const token of [tokens.support, tokens.member]) {
      for (const route of routes) {
        const res = await request(route.path, token, { method: route.method, body: route.body });
        expect(res.status, `${route.label}`).toBe(403);
        expect((await envelope(res)).error.code, `${route.label}`).toBe('FORBIDDEN');
      }
    }
  });

  it('a rede-demo session on the rede-lab host gets 403 TENANT_HOST_MISMATCH on every route', async () => {
    const labBefore = await brandRow(ids.lab);
    for (const route of routes) {
      const res = await request(route.path, tokens.admin, {
        method: route.method,
        body: route.body,
        host: HOSTS.lab,
      });
      expect(res.status, `${route.label}`).toBe(403);
      expect((await envelope(res)).error.code, `${route.label}`).toBe('TENANT_HOST_MISMATCH');
    }
    expect(await brandRow(ids.lab)).toEqual(labBefore);
  });
});
