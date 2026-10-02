import { type AdminBranding, adminBrandingSchema } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
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
 * The SEEDED tenants are the subjects because the truths name them, so `afterAll` puts both brand
 * rows (and rede-demo's display name) back exactly as the seed wrote them, removes every Storage
 * object this run uploaded and closes the derivation jobs it queued. No later suite inherits a
 * changed seed brand.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type BrandRow = { display_name: string; branding: Record<string, unknown> };

const tokens = { admin: '', member: '', support: '', labAdmin: '' };
const ids = { demo: '', lab: '' };
const snapshot: Record<'demo' | 'lab', BrandRow | null> = { demo: null, lab: null };
const RUN_START = new Date();

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

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  ids.demo = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  ids.lab = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';
  snapshot.demo = await brandRow(ids.demo);
  snapshot.lab = await brandRow(ids.lab);

  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.support = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
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
