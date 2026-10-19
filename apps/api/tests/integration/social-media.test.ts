import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs, withSocialEnabled } from './setup';

/**
 * 09-06 (SOCIAL-05, SOCIAL-03; D-473, D-474) against the live local stack and the real seed: the
 * member media limits a `super_admin` sets per tenant, and what the media broker and the post routes
 * do with them.
 *
 * `09 tracer` is ONE limit through every layer: the platform route that writes it, the registry
 * composition that reads it, the kernel seam and `startUpload`. The later describes of this file
 * (`09 video`, `09 rules`) are added by the plan's later tasks and share these fixtures.
 *
 * The seed gives rede-lab `social` ON with an empty settings blob; the suite saves that blob in
 * `beforeAll` and writes it back in `afterAll`, and every pending asset it creates carries
 * `ASSET_FILENAME` so a crashed run is swept by name. Test ORDER is load-bearing.
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };
type SettingsBody = {
  media: {
    photoMaxBytes: number;
    photosPerPost: number;
    video: { enabled: boolean; maxDurationSeconds: number; maxBytes: number };
  };
};

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

const MIB = 1024 * 1024;
/** The marker every asset this file starts carries (the crash sweep's key). */
const ASSET_FILENAME = 'social-media-09-06.jpg';

const tokens = { superAdmin: '', labMember: '', labAdmin: '', demoMember: '' };
let labTenantId = '';
let savedSettings: Record<string, unknown> = {};
let restoreSocial: () => Promise<void> = async () => {};

const platform = async (
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> =>
  api.request(`/v1/platform${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const socialSettingsPath = (tenantId: string) => `/tenants/${tenantId}/modules/social/settings`;

const startImage = async (token: string, size: number, host = HOSTS.lab): Promise<Response> =>
  api.request('/v1/media/uploads', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': host,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'image',
      purpose: 'post',
      mime: 'image/jpeg',
      size,
      filename: ASSET_FILENAME,
    }),
  });

const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;

async function sweep(): Promise<void> {
  await adminSql`delete from public.media_assets where filename = ${ASSET_FILENAME}`;
}

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  await adminSql`
    update public.tenant_modules set settings = ${adminSql.json(settings as never)}
     where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
  moduleFlags.invalidate(labTenantId);
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  if (!SUPER_ADMIN_PASSWORD) throw new Error('SUPER_ADMIN_PASSWORD is required (see pnpm db:seed)');
  restoreSocial = await withSocialEnabled('lab');
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  const [lab] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  const [row] = await adminSql<{ settings: Record<string, unknown> }[]>`
    select settings from public.tenant_modules
     where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
  savedSettings = row?.settings ?? {};
  await sweep();
});

afterAll(async () => {
  await sweep();
  await writeSettings(savedSettings);
  await restoreSocial();
  await adminSql.end();
  await sqlClient.end();
});

describe('09 tracer', () => {
  it('1. the super_admin lowers the member photo cap: 200 and the effective settings, merged into the stored blob', async () => {
    const res = await platform(socialSettingsPath(labTenantId), tokens.superAdmin, {
      method: 'PUT',
      body: { media: { photoMaxBytes: MIB } },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as SettingsBody;
    expect(body.media.photoMaxBytes).toBe(MIB);
    expect(body.media.photosPerPost).toBe(4);
    expect(body.media.video).toEqual({
      enabled: false,
      maxDurationSeconds: 60,
      maxBytes: 100 * MIB,
    });

    const [row] = await adminSql<{ settings: { media?: { photoMaxBytes?: number } } }[]>`
      select settings from public.tenant_modules
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    expect(row?.settings.media?.photoMaxBytes).toBe(MIB);
  });

  it('2. a lab member’s 2 MiB post photo is refused 413 too_large with the tenant cap', async () => {
    const res = await startImage(tokens.labMember, 2 * MIB);
    expect(res.status).toBe(413);
    const error = await errorOf(res);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.media).toBe('too_large');
    expect(error.details?.maxBytes).toBe(MIB);
  });

  it('3. a 500 KiB photo is accepted with a signed target; exactly the cap is accepted, one byte over is not (EP-09)', async () => {
    const small = await startImage(tokens.labMember, 500 * 1024);
    expect(small.status).toBe(201);
    const target = (await small.json()) as { assetId: string; signedUrl: string };
    expect(target.assetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(target.signedUrl).toContain('http');

    expect((await startImage(tokens.labMember, MIB)).status).toBe(201);
    const over = await startImage(tokens.labMember, MIB + 1);
    expect(over.status).toBe(413);
    expect((await errorOf(over)).details?.maxBytes).toBe(MIB);
  });

  it('4. the lab ADMIN’s 2 MiB photo is still accepted: the admin cap is the unchanged 15 MiB', async () => {
    const res = await startImage(tokens.labAdmin, 2 * MIB);
    expect(res.status).toBe(201);
  });

  it('5. a member of a tenant without social keeps the unchanged default (rede-demo, 2 MiB accepted)', async () => {
    const res = await startImage(tokens.demoMember, 2 * MIB, HOSTS.demo);
    expect(res.status).toBe(201);
  });

  it('6. GET answers the effective settings of the tenant', async () => {
    const res = await platform(socialSettingsPath(labTenantId), tokens.superAdmin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SettingsBody;
    expect(body.media.photoMaxBytes).toBe(MIB);
    expect(body.media.photosPerPost).toBe(4);
  });

  it('7. a lab member and a lab admin are refused 403 on both platform routes (T-09-30)', async () => {
    for (const token of [tokens.labMember, tokens.labAdmin]) {
      const get = await platform(socialSettingsPath(labTenantId), token);
      expect(get.status).toBe(403);
      const put = await platform(socialSettingsPath(labTenantId), token, {
        method: 'PUT',
        body: { media: { photoMaxBytes: 15 * MIB } },
      });
      expect(put.status).toBe(403);
    }
    // And nothing moved.
    const [row] = await adminSql<{ settings: { media?: { photoMaxBytes?: number } } }[]>`
      select settings from public.tenant_modules
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    expect(row?.settings.media?.photoMaxBytes).toBe(MIB);
  });

  it('8. an out-of-range, fractional, mistyped or unknown value is a 400 VALIDATION_FAILED and writes nothing', async () => {
    const bodies: unknown[] = [
      { media: { photoMaxBytes: 15 * MIB + 1 } },
      { media: { photoMaxBytes: 1048576.5 } },
      { media: { photoMaxBytes: -1 } },
      { media: { photoMaxBytes: '1048576' } },
      { media: { photosPerPost: 11 } },
      { media: { video: { maxDurationSeconds: 301 } } },
      { media: { video: { maxBytes: 500 * MIB + 1 } } },
      { media: { unknown: 1 } },
      { other: 1 },
    ];
    for (const body of bodies) {
      const res = await platform(socialSettingsPath(labTenantId), tokens.superAdmin, {
        method: 'PUT',
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await errorOf(res)).code).toBe('VALIDATION_FAILED');
    }
    const [row] = await adminSql<{ settings: { media?: { photoMaxBytes?: number } } }[]>`
      select settings from public.tenant_modules
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    expect(row?.settings.media?.photoMaxBytes).toBe(MIB);
  });

  it('9. EP-16: a partial patch merges into the stored blob, siblings and stray keys survive, and saving twice is identical', async () => {
    await writeSettings({ stray: { keep: true }, media: { photoMaxBytes: MIB, photosPerPost: 3 } });
    const patch = { media: { video: { enabled: true } } };
    const first = await platform(socialSettingsPath(labTenantId), tokens.superAdmin, {
      method: 'PUT',
      body: patch,
    });
    expect(first.status).toBe(200);
    const afterFirst = await adminSql<{ settings: unknown }[]>`
      select settings from public.tenant_modules
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    expect(afterFirst[0]?.settings).toEqual({
      stray: { keep: true },
      media: { photoMaxBytes: MIB, photosPerPost: 3, video: { enabled: true } },
    });
    const second = await platform(socialSettingsPath(labTenantId), tokens.superAdmin, {
      method: 'PUT',
      body: patch,
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    const afterSecond = await adminSql<{ settings: unknown }[]>`
      select settings from public.tenant_modules
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    expect(afterSecond[0]?.settings).toEqual(afterFirst[0]?.settings);
  });

  it('10. a malformed stored blob reads as the defaults on GET and in the broker, never a 500', async () => {
    await writeSettings({ media: { photoMaxBytes: 'lots' } });
    const get = await platform(socialSettingsPath(labTenantId), tokens.superAdmin);
    expect(get.status).toBe(200);
    expect(((await get.json()) as SettingsBody).media.photoMaxBytes).toBe(5 * MIB);
    // 6 MiB is above the 5 MiB default, 4 MiB is below it.
    expect((await startImage(tokens.labMember, 6 * MIB)).status).toBe(413);
    expect((await startImage(tokens.labMember, 4 * MIB)).status).toBe(201);
  });

  it('11. an unknown tenant is the bare 404 on both routes, and so is PUT on a tenant with no social row', async () => {
    const ghost = '00000000-0000-4000-8000-000000000999';
    expect((await platform(socialSettingsPath(ghost), tokens.superAdmin)).status).toBe(404);
    expect(
      (
        await platform(socialSettingsPath(ghost), tokens.superAdmin, {
          method: 'PUT',
          body: { media: { photoMaxBytes: MIB } },
        })
      ).status,
    ).toBe(404);

    const slug = `e2e-09-06-${Date.now()}`.slice(0, 40);
    const [created] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${slug}, 'Comunidade Sem Social', 'Regras de teste.', 1)
      returning id`;
    try {
      const put = await platform(socialSettingsPath(created?.id ?? ''), tokens.superAdmin, {
        method: 'PUT',
        body: { media: { photoMaxBytes: MIB } },
      });
      expect(put.status).toBe(404);
      const get = await platform(socialSettingsPath(created?.id ?? ''), tokens.superAdmin);
      expect(get.status).toBe(200);
      expect(((await get.json()) as SettingsBody).media.photoMaxBytes).toBe(5 * MIB);
    } finally {
      await adminSql`delete from public.tenants where id = ${created?.id ?? ''}::uuid`;
    }
  });
});
