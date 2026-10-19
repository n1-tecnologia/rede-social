import { randomUUID } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import {
  MEDIA_TENANT_BYTES_CEILING,
  MEDIA_TENANT_VIDEO_SECONDS_CEILING,
} from '@rede-social/core/server/media/limits';
import { encodeJpeg } from '@rede-social/core/server/media/variants';
import { mediaProviderEventJob } from '@rede-social/core/server/media/video/event-job';
import { fakeVideoInternals } from '@rede-social/core/server/media/video/fake';
import type { VideoProviderEvent } from '@rede-social/core/server/media/video/types';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { FeedPage } from '@rede-social/module-feed/contracts';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
/** A 900x600 photo-ish SVG; `encodeJpeg` turns it into a real JPEG (the media.test.ts fixture). */
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#0ea5e9"/><circle cx="450" cy="300" r="180" fill="#f59e0b"/></svg>`;
/** The marker every asset this file starts carries (the crash sweep's key). */
const ASSET_FILENAME = 'social-media-09-06.jpg';
const VIDEO_FILENAME = 'social-media-09-06.mp4';
/** Caption prefix of every post this file writes (the crash sweep's key for posts). */
const PREFIX = 'Teste 09-06 ';

const tokens = {
  superAdmin: '',
  labMember: '',
  labAdmin: '',
  labSupport: '',
  demoMember: '',
  helena: '',
  alvaro: '',
};
const userIds = { labMember: '', helena: '' };
const createdAssetIds: string[] = [];
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

/** Service-key Storage client for fixture cleanup only (direct deletes from storage.objects fail). */
function storageAdmin() {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
}

async function removeObjectsOf(assetIds: string[]): Promise<void> {
  for (const id of assetIds) {
    const rows = await adminSql<{ name: string }[]>`
      select name from storage.objects
       where bucket_id = 'media' and name like ${`${labTenantId}/media/${id}/%`}`;
    if (rows.length === 0) continue;
    await storageAdmin()
      .from('media')
      .remove(rows.map((row) => row.name));
  }
}

async function sweep(): Promise<void> {
  const rows = await adminSql<{ id: string }[]>`
    select id from public.media_assets where filename in (${ASSET_FILENAME}, ${VIDEO_FILENAME})`;
  await removeObjectsOf([...rows.map((row) => row.id), ...createdAssetIds]);
  await adminSql`delete from public.feed_posts where caption like ${`${PREFIX}%`}`;
  await adminSql`
    delete from public.media_assets where filename in (${ASSET_FILENAME}, ${VIDEO_FILENAME})`;
  for (const id of createdAssetIds) {
    await adminSql`
      delete from pgboss.job_common
       where name = 'kernel.media-derive-variants' and singleton_key = ${id}`;
  }
}

async function userOf(email: string): Promise<string> {
  const [row] = await adminSql<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.user_id;
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
  tokens.labSupport = await signInAs('support@rede-lab.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.alvaro = await signInAs('alvaro.pinheiro@rede-lab.local', SEED_PASSWORD);
  userIds.labMember = await userOf('member@rede-lab.local');
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
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
  await stopBoss();
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

/* ---------------------------------------------------------------------------------------------- */
/* 09 video: member video, the duration snapshot, the completion re-judge, the sub-budget          */
/* ---------------------------------------------------------------------------------------------- */

const startVideo = async (
  token: string,
  body: Record<string, unknown> = {},
  host = HOSTS.lab,
): Promise<Response> =>
  api.request('/v1/media/uploads', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': host,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'video',
      purpose: 'post',
      mime: 'video/mp4',
      size: 1024,
      filename: VIDEO_FILENAME,
      ...body,
    }),
  });

const putSettings = async (patch: unknown): Promise<void> => {
  const res = await platform(socialSettingsPath(labTenantId), tokens.superAdmin, {
    method: 'PUT',
    body: patch,
  });
  if (res.status !== 200) throw new Error(`PUT social settings failed: ${res.status}`);
};

type AssetFacts = {
  status: string;
  duration_cap_seconds: number | null;
  duration_seconds: number | null;
  failure_reason: string | null;
  provider_asset_id: string | null;
  owner_user_id: string;
};

async function assetFacts(assetId: string): Promise<AssetFacts | undefined> {
  const [row] = await adminSql<AssetFacts[]>`
    select status, duration_cap_seconds, duration_seconds, failure_reason, provider_asset_id,
           owner_user_id
      from public.media_assets where id = ${assetId}::uuid`;
  return row;
}

const countAssets = async (filename: string): Promise<number> => {
  const [row] = await adminSql<{ n: string }[]>`
    select count(*)::text as n from public.media_assets where filename = ${filename}`;
  return Number(row?.n ?? 0);
};

/** A started member video: the asset id and the provider's upload id (what a ready event names). */
async function startedVideo(
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ assetId: string; providerAssetId: string; maxBytes: number }> {
  const res = await startVideo(token, body);
  if (res.status !== 201) throw new Error(`video start failed: ${res.status}`);
  const { assetId, maxBytes } = (await res.json()) as { assetId: string; maxBytes: number };
  createdAssetIds.push(assetId);
  const row = await assetFacts(assetId);
  return { assetId, providerAssetId: row?.provider_asset_id ?? '', maxBytes };
}

function readyEvent(
  assetId: string,
  providerAssetId: string,
  durationSeconds: number,
  eventId: string = randomUUID(),
): VideoProviderEvent {
  return {
    id: eventId,
    kind: 'ready',
    rawType: 'video.asset.ready',
    assetId,
    providerAssetId,
    playbackId: `pb-${assetId}`,
    durationSeconds,
    aspectRatio: '9:16',
    failureReason: null,
  };
}

/** Rows a case seeded straight into the table; removed after the case so the budgets are not skewed. */
const seededAssetIds: string[] = [];

const MEMBER_SHARE = (ceiling: number) => Math.floor(0.5 * ceiling);

/** Bytes already drawn by member-owned `post` uploads of the lab (the sub-budget's own sum). */
async function memberPostBytes(): Promise<number> {
  const [row] = await adminSql<{ total: string }[]>`
    select coalesce(sum(a.bytes), 0)::text as total from public.media_assets a
     where a.tenant_id = ${labTenantId}::uuid and a.deleted_at is null and a.kind <> 'video'
       and a.purpose = 'post'
       and exists (select 1 from public.memberships m
                    where m.tenant_id = a.tenant_id and m.user_id = a.owner_user_id
                      and m.role = 'member')`;
  return Number(row?.total ?? 0);
}

async function memberPostSeconds(): Promise<number> {
  const [row] = await adminSql<{ total: string }[]>`
    select coalesce(sum(a.duration_seconds), 0)::text as total from public.media_assets a
     where a.tenant_id = ${labTenantId}::uuid and a.deleted_at is null and a.kind = 'video'
       and a.purpose <> 'lesson' and a.status not in ('rejected', 'failed')
       and a.purpose = 'post'
       and exists (select 1 from public.memberships m
                    where m.tenant_id = a.tenant_id and m.user_id = a.owner_user_id
                      and m.role = 'member')`;
  return Number(row?.total ?? 0);
}

async function seedMemberAsset(input: {
  kind: 'image' | 'video';
  purpose: 'post' | 'avatar';
  bytes: number;
  durationSeconds?: number;
}): Promise<void> {
  const video = input.kind === 'video';
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, playback_id, mime, bytes,
       duration_seconds, filename, ready_at)
    values (${labTenantId}::uuid, ${userIds.labMember}::uuid, ${input.kind}, ${input.purpose},
            'ready', ${video ? 'fake' : 'supabase'}, ${video ? `pb-${randomUUID()}` : null},
            ${video ? 'video/mp4' : 'image/jpeg'}, ${input.bytes},
            ${input.durationSeconds ?? null}, ${video ? VIDEO_FILENAME : ASSET_FILENAME}, now())
    returning id`;
  seededAssetIds.push(row?.id ?? '');
}

describe('09 video', () => {
  afterEach(async () => {
    fakeVideoInternals.deletedAssetIds = [];
    for (const id of seededAssetIds.splice(0)) {
      await adminSql`delete from public.media_assets where id = ${id}::uuid`;
    }
  });

  it('1. video is 403 while the tenant has not enabled it, and no asset row is created', async () => {
    await writeSettings({});
    const before = await countAssets(VIDEO_FILENAME);
    const res = await startVideo(tokens.labMember);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('FORBIDDEN');
    expect(await countAssets(VIDEO_FILENAME)).toBe(before);
  });

  it('2. video is 403 while social is off for the tenant, even with video enabled in the blob', async () => {
    await writeSettings({ media: { video: { enabled: true } } });
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(labTenantId);
    try {
      const before = await countAssets(VIDEO_FILENAME);
      const res = await startVideo(tokens.labMember);
      expect(res.status).toBe(403);
      expect(await countAssets(VIDEO_FILENAME)).toBe(before);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
    }
  });

  it('3. with video enabled a member starts a post video, the cap is snapshotted; story, lesson and support stay 403', async () => {
    await putSettings({ media: { video: { enabled: true } } });
    const res = await startVideo(tokens.labMember);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetId: string; maxBytes: number };
    createdAssetIds.push(body.assetId);
    expect(body.maxBytes).toBe(100 * MIB);
    expect((await assetFacts(body.assetId))?.duration_cap_seconds).toBe(60);

    const before = await countAssets(VIDEO_FILENAME);
    for (const purpose of ['story', 'lesson']) {
      const refused = await startVideo(tokens.labMember, { purpose });
      expect(refused.status, purpose).toBe(403);
    }
    expect((await startVideo(tokens.labSupport)).status).toBe(403);
    expect(await countAssets(VIDEO_FILENAME)).toBe(before);

    // The admin path is unchanged: no snapshot, the static 500 MiB cap.
    const admin = await startVideo(tokens.labAdmin);
    expect(admin.status).toBe(201);
    const adminBody = (await admin.json()) as { assetId: string; maxBytes: number };
    createdAssetIds.push(adminBody.assetId);
    expect(adminBody.maxBytes).toBe(500 * MIB);
    expect((await assetFacts(adminBody.assetId))?.duration_cap_seconds).toBeNull();
  });

  it('4. the byte cap of a member video is the lower of the admin cap and video.maxBytes (EP-09)', async () => {
    const over = await startVideo(tokens.labMember, { size: 100 * MIB + 1 });
    expect(over.status).toBe(413);
    const error = await errorOf(over);
    expect(error.details?.media).toBe('too_large');
    expect(error.details?.maxBytes).toBe(100 * MIB);
    const exact = await startVideo(tokens.labMember, { size: 100 * MIB });
    expect(exact.status).toBe(201);
    createdAssetIds.push(((await exact.json()) as { assetId: string }).assetId);
  });

  it('5. duration is judged at ready, strictly greater: exactly the cap is ready, one second more is rejected (EP-10)', async () => {
    const exact = await startedVideo(tokens.labMember);
    await mediaProviderEventJob.handler(readyEvent(exact.assetId, exact.providerAssetId, 60));
    expect((await assetFacts(exact.assetId))?.status).toBe('ready');

    const longer = await startedVideo(tokens.labMember);
    fakeVideoInternals.deletedAssetIds = [];
    await mediaProviderEventJob.handler(readyEvent(longer.assetId, longer.providerAssetId, 61));
    const row = await assetFacts(longer.assetId);
    expect(row?.status).toBe('rejected');
    expect(row?.failure_reason).toBe('duration_too_long');
    expect(fakeVideoInternals.deletedAssetIds).toEqual([longer.providerAssetId]);
  });

  it('6. the cap is a snapshot (EP-17): lowering it after the start does not change that asset, a new start takes the new cap', async () => {
    const started = await startedVideo(tokens.labMember);
    await putSettings({ media: { video: { maxDurationSeconds: 30 } } });
    await mediaProviderEventJob.handler(readyEvent(started.assetId, started.providerAssetId, 45));
    expect((await assetFacts(started.assetId))?.status).toBe('ready');

    const fresh = await startedVideo(tokens.labMember);
    expect((await assetFacts(fresh.assetId))?.duration_cap_seconds).toBe(30);
    await mediaProviderEventJob.handler(readyEvent(fresh.assetId, fresh.providerAssetId, 45));
    expect((await assetFacts(fresh.assetId))?.status).toBe('rejected');
    await putSettings({ media: { video: { maxDurationSeconds: 60 } } });
  });

  it('7. a replayed ready event is a no-op and does not re-judge duration (EP-16)', async () => {
    const started = await startedVideo(tokens.labMember);
    const eventId = randomUUID();
    await mediaProviderEventJob.handler(
      readyEvent(started.assetId, started.providerAssetId, 60, eventId),
    );
    await mediaProviderEventJob.handler(
      readyEvent(started.assetId, started.providerAssetId, 60, eventId),
    );
    // A later delivery reporting a longer duration finds a ready row and changes nothing.
    await mediaProviderEventJob.handler(readyEvent(started.assetId, started.providerAssetId, 61));
    const row = await assetFacts(started.assetId);
    expect(row?.status).toBe('ready');
    expect(row?.duration_seconds).toBe(60);
  });

  it('8. two simultaneous member video starts both pass (a soft quota) and each carries its own snapshot (EP-17)', async () => {
    const [one, two] = await Promise.all([
      startVideo(tokens.labMember),
      startVideo(tokens.labMember),
    ]);
    expect([one.status, two.status]).toEqual([201, 201]);
    for (const res of [one, two]) {
      const { assetId } = (await res.json()) as { assetId: string };
      createdAssetIds.push(assetId);
      expect((await assetFacts(assetId))?.duration_cap_seconds).toBe(60);
    }
  });

  it('9. complete twice on a member photo returns the same asset and enqueues one derive job (EP-16)', async () => {
    await putSettings({ media: { photoMaxBytes: 5 * MIB } });
    const jpeg = await encodeJpeg(Buffer.from(PHOTO_SVG));
    const start = await startImage(tokens.labMember, jpeg.length);
    expect(start.status).toBe(201);
    const target = (await start.json()) as { assetId: string; signedUrl: string };
    createdAssetIds.push(target.assetId);
    const put = await fetch(target.signedUrl, {
      method: 'PUT',
      body: new Uint8Array(jpeg),
      headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
    });
    expect(put.ok).toBe(true);

    const complete = () =>
      api.request(`/v1/media/uploads/${target.assetId}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokens.labMember}`, 'x-tenant-host': HOSTS.lab },
      });
    const first = await complete();
    const second = await complete();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    const jobs = await adminSql<{ state: string }[]>`
      select state from pgboss.job_common
       where name = 'kernel.media-derive-variants' and singleton_key = ${target.assetId}`;
    expect(jobs).toHaveLength(1);
  });

  it('10. a photo declared small and uploaded over the tenant cap is rejected too_large at complete and the object is removed (T-09-18)', async () => {
    await putSettings({ media: { photoMaxBytes: 1000 } });
    const jpeg = await encodeJpeg(Buffer.from(PHOTO_SVG));
    expect(jpeg.length).toBeGreaterThan(1000);
    const start = await startImage(tokens.labMember, 500);
    expect(start.status).toBe(201);
    const target = (await start.json()) as { assetId: string; signedUrl: string };
    createdAssetIds.push(target.assetId);
    const put = await fetch(target.signedUrl, {
      method: 'PUT',
      body: new Uint8Array(jpeg),
      headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
    });
    expect(put.ok).toBe(true);

    const res = await api.request(`/v1/media/uploads/${target.assetId}/complete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.labMember}`, 'x-tenant-host': HOSTS.lab },
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).details?.media).toBe('too_large');
    expect((await assetFacts(target.assetId))?.status).toBe('rejected');
    const objects = await adminSql<{ name: string }[]>`
      select name from storage.objects
       where bucket_id = 'media' and name like ${`${labTenantId}/media/${target.assetId}/%`}`;
    expect(objects).toHaveLength(0);
    await putSettings({ media: { photoMaxBytes: 5 * MIB } });
  });

  it('11. EP-17 sub-budget: member post photos draw from half the byte ceiling, the admin is unaffected', async () => {
    const half = MEMBER_SHARE(MEDIA_TENANT_BYTES_CEILING);
    await putSettings({ media: { photoMaxBytes: 15 * MIB } });
    const used = await memberPostBytes();
    // An avatar of the member does not count toward the share.
    await seedMemberAsset({ kind: 'image', purpose: 'avatar', bytes: 100 * MIB });
    await seedMemberAsset({ kind: 'image', purpose: 'post', bytes: half - used - MIB });
    expect(await memberPostBytes()).toBe(half - MIB);

    const atEdge = await startImage(tokens.labMember, MIB);
    expect(atEdge.status).toBe(201);
    createdAssetIds.push(((await atEdge.json()) as { assetId: string }).assetId);
    const over = await startImage(tokens.labMember, 1);
    expect(over.status).toBe(413);
    expect((await errorOf(over)).details?.media).toBe('quota_exceeded');

    const admin = await startImage(tokens.labAdmin, 1);
    expect(admin.status).toBe(201);
    createdAssetIds.push(((await admin.json()) as { assetId: string }).assetId);
  });

  it('12. EP-17 sub-budget: member post video seconds draw from half the minutes ceiling, the admin is unaffected', async () => {
    const half = MEMBER_SHARE(MEDIA_TENANT_VIDEO_SECONDS_CEILING);
    const used = await memberPostSeconds();
    await seedMemberAsset({
      kind: 'video',
      purpose: 'post',
      bytes: 1024,
      durationSeconds: half - used,
    });
    expect(await memberPostSeconds()).toBe(half);

    const refused = await startVideo(tokens.labMember);
    expect(refused.status).toBe(413);
    expect((await errorOf(refused)).details?.media).toBe('quota_exceeded');

    const admin = await startVideo(tokens.labAdmin);
    expect(admin.status).toBe(201);
    createdAssetIds.push(((await admin.json()) as { assetId: string }).assetId);
  });

  it('13. limits apply to new uploads only: a member video post stays in Explorar and its tokens are still minted', async () => {
    const [asset] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
         mime, bytes, width, height, duration_seconds, aspect_ratio, filename, ready_at)
      values (${labTenantId}::uuid, ${userIds.helena}::uuid, 'video', 'post', 'ready', 'fake',
              ${`fake-${randomUUID()}`}, ${`pb-${randomUUID()}`}, 'video/mp4', 1048576, 1080, 1920,
              15, '9:16', ${VIDEO_FILENAME}, now())
      returning id`;
    const assetId = asset?.id ?? '';
    const [post] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, media_kind)
      values (${labTenantId}::uuid, ${userIds.helena}::uuid, ${`${PREFIX}vídeo de Helena`},
              'followers', 'video')
      returning id`;
    await adminSql`
      insert into public.feed_post_media
        (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${labTenantId}::uuid, ${post?.id ?? ''}::uuid, 'video', ${assetId}::uuid, 'video', 0)`;

    // The tenant turns video off AND narrows everything: nothing already published moves.
    await putSettings({ media: { video: { enabled: false }, photosPerPost: 1, photoMaxBytes: 1 } });
    const explorar = await api.request('/v1/feed?scope=explorar&limit=25', {
      headers: { authorization: `Bearer ${tokens.alvaro}`, 'x-tenant-host': HOSTS.lab },
    });
    expect(explorar.status).toBe(200);
    const ids = ((await explorar.json()) as FeedPage).items.map((item) => item.id);
    expect(ids).toContain(post?.id);

    const playback = await api.request(`/v1/media/${assetId}/playback`, {
      headers: { authorization: `Bearer ${tokens.alvaro}`, 'x-tenant-host': HOSTS.lab },
    });
    expect(playback.status).toBe(200);
    const tokensBody = (await playback.json()) as { tokens: { playback: string } };
    expect(tokensBody.tokens.playback.length).toBeGreaterThan(0);
  });
});
