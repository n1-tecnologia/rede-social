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
import { FEED_MAX_CAPTION, type FeedPage, type FeedPost } from '@rede-social/module-feed/contracts';
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

const startImage = async (
  token: string,
  size: number,
  host = HOSTS.lab,
  purpose: 'post' | 'avatar' | 'cover' = 'post',
): Promise<Response> =>
  api.request('/v1/media/uploads', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': host,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'image',
      purpose,
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

/** Bytes already drawn by member-owned non-video uploads of the lab, every purpose (the sub-budget's own sum). */
async function memberBytes(): Promise<number> {
  const [row] = await adminSql<{ total: string }[]>`
    select coalesce(sum(a.bytes), 0)::text as total from public.media_assets a
     where a.tenant_id = ${labTenantId}::uuid and a.deleted_at is null and a.kind <> 'video'
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

  it('11. EP-17 sub-budget (WR-03): member uploads of ANY purpose draw from half the byte ceiling, the admin is unaffected', async () => {
    const half = MEMBER_SHARE(MEDIA_TENANT_BYTES_CEILING);
    expect(half).toBe(419430400);
    await putSettings({ media: { photoMaxBytes: 15 * MIB } });
    const used = await memberBytes();
    // An avatar the member already uploaded counts toward the share now.
    await seedMemberAsset({ kind: 'image', purpose: 'avatar', bytes: 100 * MIB });
    expect(await memberBytes()).toBe(used + 100 * MIB);
    await seedMemberAsset({ kind: 'image', purpose: 'post', bytes: half - used - 100 * MIB - MIB });
    expect(await memberBytes()).toBe(half - MIB);

    // Exactly on half is accepted (EP-71), whatever the purpose a start names first.
    const atEdge = await startImage(tokens.labMember, MIB);
    expect(atEdge.status).toBe(201);
    createdAssetIds.push(((await atEdge.json()) as { assetId: string }).assetId);
    expect(await memberBytes()).toBe(half);

    // One byte more is refused for post, avatar and cover alike, and no row is created.
    const before = await countAssets(ASSET_FILENAME);
    for (const purpose of ['post', 'avatar', 'cover'] as const) {
      const over = await startImage(tokens.labMember, 1, HOSTS.lab, purpose);
      expect(over.status, purpose).toBe(413);
      const error = await errorOf(over);
      expect(error.code, purpose).toBe('VALIDATION_FAILED');
      expect(error.details?.media, purpose).toBe('quota_exceeded');
    }
    expect(await countAssets(ASSET_FILENAME)).toBe(before);

    // The admin's start of the same size is accepted for any purpose.
    for (const purpose of ['post', 'cover'] as const) {
      const admin = await startImage(tokens.labAdmin, 1, HOSTS.lab, purpose);
      expect(admin.status, purpose).toBe(201);
      createdAssetIds.push(((await admin.json()) as { assetId: string }).assetId);
    }
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

/* ---------------------------------------------------------------------------------------------- */
/* 09 rules: the member authoring rules of createPost and updatePost (D-473)                       */
/* ---------------------------------------------------------------------------------------------- */

const ACTIVE_COMMUNITY = '0e000000-0000-4000-8000-0000000000c2';

const postAs = async (token: string, body: Record<string, unknown>): Promise<Response> =>
  api.request('/v1/feed/posts', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': HOSTS.lab,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

const patchAs = async (
  token: string,
  postId: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  api.request(`/v1/feed/posts/${postId}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': HOSTS.lab,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

const postCount = async (): Promise<number> => {
  const [row] = await adminSql<{ n: string }[]>`
    select count(*)::text as n from public.feed_posts where caption like ${`${PREFIX}%`}`;
  return Number(row?.n ?? 0);
};

/** A media asset written straight into the table, owned by `ownerUserId`, with the marker filename. */
async function seedAsset(input: {
  ownerUserId: string;
  kind: 'image' | 'video' | 'file';
  status?: 'ready' | 'processing' | 'rejected';
}): Promise<string> {
  const status = input.status ?? 'ready';
  const video = input.kind === 'video';
  const file = input.kind === 'file';
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, width, height, duration_seconds, aspect_ratio, failure_reason, filename,
       ready_at)
    values (${labTenantId}::uuid, ${input.ownerUserId}::uuid, ${input.kind},
            ${file ? 'attachment' : 'post'}, ${status}, ${video ? 'fake' : 'supabase'},
            ${video ? `fake-${randomUUID()}` : null},
            ${video && status === 'ready' ? `pb-${randomUUID()}` : null},
            ${video ? 'video/mp4' : file ? 'application/pdf' : 'image/jpeg'}, 2048,
            ${file ? null : 1080}, ${file ? null : 1080}, ${video && status === 'ready' ? 15 : null},
            ${video ? '9:16' : null}, ${status === 'rejected' ? 'duration_too_long' : null},
            ${video ? VIDEO_FILENAME : ASSET_FILENAME},
            ${status === 'ready' ? new Date() : null})
    returning id`;
  return row?.id ?? '';
}

const detailsOf = async (res: Response) => (await errorOf(res)).details;

describe('09 rules', () => {
  const userIdsMore = { admin: '', marcos: '' };

  beforeAll(async () => {
    userIdsMore.admin = await userOf('admin@rede-lab.local');
    userIdsMore.marcos = await userOf('marcos.vinicius@rede-lab.local');
    await writeSettings({});
  });

  afterEach(async () => {
    await adminSql`delete from public.feed_posts where caption like ${`${PREFIX}%`}`;
  });

  it('1. D-473: a member post with an attachment is member_no_attachments before any asset lookup, and writes nothing', async () => {
    const before = await postCount();
    // A random id proves the refusal comes BEFORE the lookup (which would say asset_not_usable).
    const ghost = await postAs(tokens.helena, {
      caption: `${PREFIX}anexo`,
      attachmentAssetIds: [randomUUID()],
    });
    expect(ghost.status).toBe(400);
    expect((await detailsOf(ghost))?.member).toBe('member_no_attachments');

    const real = await seedAsset({ ownerUserId: userIds.helena, kind: 'file' });
    const own = await postAs(tokens.helena, {
      caption: `${PREFIX}anexo`,
      attachmentAssetIds: [real],
    });
    expect(own.status).toBe(400);
    expect((await detailsOf(own))?.member).toBe('member_no_attachments');
    expect(await postCount()).toBe(before);
  });

  it('2. D-473: a member post with a community is member_no_community before any community lookup', async () => {
    const before = await postCount();
    for (const communityId of [randomUUID(), ACTIVE_COMMUNITY]) {
      const res = await postAs(tokens.helena, { caption: `${PREFIX}comunidade`, communityId });
      expect(res.status, communityId).toBe(400);
      expect((await detailsOf(res))?.member).toBe('member_no_community');
    }
    expect(await postCount()).toBe(before);
  });

  it('3. D-474: a member video post is member_video_off while video is off, and publishes once the tenant turns it on', async () => {
    const videoId = await seedAsset({ ownerUserId: userIds.helena, kind: 'video' });
    const refused = await postAs(tokens.helena, {
      caption: `${PREFIX}vídeo`,
      videoAssetId: videoId,
    });
    expect(refused.status).toBe(400);
    expect((await detailsOf(refused))?.member).toBe('member_video_off');
    expect(await postCount()).toBe(0);

    await putSettings({ media: { video: { enabled: true } } });
    const ok = await postAs(tokens.helena, { caption: `${PREFIX}vídeo`, videoAssetId: videoId });
    expect(ok.status).toBe(201);
    const post = (await ok.json()) as FeedPost;
    expect(post.audience).toBe('followers');
    expect(post.mediaKind).toBe('video');
  });

  it('4. EP-09: with photosPerPost 4 four images publish and five are too_many_images; a caption at the limit publishes and one more is refused', async () => {
    await putSettings({ media: { photosPerPost: 4 } });
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(await seedAsset({ ownerUserId: userIds.helena, kind: 'image' }));
    }
    const four = await postAs(tokens.helena, {
      caption: `${PREFIX}quatro`,
      imageAssetIds: ids.slice(0, 4),
    });
    expect(four.status).toBe(201);
    const five = await postAs(tokens.helena, { caption: `${PREFIX}cinco`, imageAssetIds: ids });
    expect(five.status).toBe(400);
    expect((await detailsOf(five))?.media).toBe('too_many_images');

    const atLimit = `${PREFIX}${'a'.repeat(FEED_MAX_CAPTION - PREFIX.length)}`;
    expect(atLimit).toHaveLength(FEED_MAX_CAPTION);
    expect((await postAs(tokens.helena, { caption: atLimit })).status).toBe(201);
    const over = await postAs(tokens.helena, { caption: `${atLimit}a` });
    expect(over.status).toBe(400);
  });

  it('5. T-09-20: a member cannot attach another member’s or the admin’s asset (asset_not_usable)', async () => {
    await putSettings({ media: { video: { enabled: true } } });
    const foreign = [
      await seedAsset({ ownerUserId: userIds.labMember, kind: 'image' }),
      await seedAsset({ ownerUserId: userIdsMore.admin, kind: 'image' }),
    ];
    for (const imageId of foreign) {
      const res = await postAs(tokens.helena, {
        caption: `${PREFIX}alheio`,
        imageAssetIds: [imageId],
      });
      expect(res.status).toBe(400);
      expect((await detailsOf(res))?.media).toBe('asset_not_usable');
    }
    const foreignVideo = await seedAsset({ ownerUserId: userIds.labMember, kind: 'video' });
    const video = await postAs(tokens.helena, {
      caption: `${PREFIX}alheio`,
      videoAssetId: foreignVideo,
    });
    expect(video.status).toBe(400);
    expect((await detailsOf(video))?.media).toBe('asset_not_usable');

    const own = await seedAsset({ ownerUserId: userIds.helena, kind: 'image' });
    expect(
      (await postAs(tokens.helena, { caption: `${PREFIX}proprio`, imageAssetIds: [own] })).status,
    ).toBe(201);
  });

  it('6. a member’s processing or rejected video is asset_not_usable; a ready one publishes (duration is enforced at publish)', async () => {
    await putSettings({ media: { video: { enabled: true } } });
    for (const status of ['processing', 'rejected'] as const) {
      const id = await seedAsset({ ownerUserId: userIds.helena, kind: 'video', status });
      const res = await postAs(tokens.helena, { caption: `${PREFIX}${status}`, videoAssetId: id });
      expect(res.status, status).toBe(400);
      expect((await detailsOf(res))?.media).toBe('asset_not_usable');
    }
    const ready = await seedAsset({ ownerUserId: userIds.helena, kind: 'video', status: 'ready' });
    expect(
      (await postAs(tokens.helena, { caption: `${PREFIX}pronto`, videoAssetId: ready })).status,
    ).toBe(201);
  });

  it('7. PATCH: no attachments; an edit re-sending the EXISTING video passes with video off, a new video does not', async () => {
    await putSettings({ media: { video: { enabled: true } } });
    const videoId = await seedAsset({ ownerUserId: userIds.helena, kind: 'video' });
    const created = await postAs(tokens.helena, {
      caption: `${PREFIX}edit`,
      videoAssetId: videoId,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as FeedPost;

    const withFile = await patchAs(tokens.helena, id, {
      attachmentAssetIds: [randomUUID()],
    });
    expect(withFile.status).toBe(400);
    expect((await detailsOf(withFile))?.member).toBe('member_no_attachments');

    await putSettings({ media: { video: { enabled: false } } });
    const same = await patchAs(tokens.helena, id, {
      caption: `${PREFIX}edit 2`,
      videoAssetId: videoId,
    });
    expect(same.status).toBe(200);

    const another = await seedAsset({ ownerUserId: userIds.helena, kind: 'video' });
    const swapped = await patchAs(tokens.helena, id, { videoAssetId: another });
    expect(swapped.status).toBe(400);
    expect((await detailsOf(swapped))?.member).toBe('member_video_off');
    // Nothing moved: the post still carries the original video.
    const [media] = await adminSql<{ media_asset_id: string }[]>`
      select media_asset_id from public.feed_post_media where post_id = ${id}::uuid`;
    expect(media?.media_asset_id).toBe(videoId);
  });

  it('8. the admin path is byte-identical: an admin post with an attachment and a community still publishes', async () => {
    const attachment = await seedAsset({ ownerUserId: userIdsMore.admin, kind: 'file' });
    const res = await postAs(tokens.labAdmin, {
      caption: `${PREFIX}admin`,
      attachmentAssetIds: [attachment],
      communityId: ACTIVE_COMMUNITY,
    });
    expect(res.status).toBe(201);
    const post = (await res.json()) as FeedPost;
    expect(post.communityId).toBe(ACTIVE_COMMUNITY);
    expect(post).not.toHaveProperty('audience');
  });

  it('9. EP-08: social switched off inside the flags-cache window is a 403 FORBIDDEN that writes nothing; after the cache expires the permission guard answers 403', async () => {
    // Warm the cache with the social-on state.
    expect((await postAs(tokens.helena, { caption: `${PREFIX}aquece` })).status).toBe(201);
    await adminSql`delete from public.feed_posts where caption like ${`${PREFIX}%`}`;

    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    try {
      // NOT invalidated: this instance still believes social is on.
      const stale = await postAs(tokens.helena, { caption: `${PREFIX}janela` });
      expect(stale.status).toBe(403);
      expect((await errorOf(stale)).code).toBe('FORBIDDEN');
      expect(await postCount()).toBe(0);

      moduleFlags.invalidate(labTenantId);
      const fresh = await postAs(tokens.helena, { caption: `${PREFIX}janela` });
      expect(fresh.status).toBe(403);
      expect((await errorOf(fresh)).code).toBe('FORBIDDEN');
      expect(await postCount()).toBe(0);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
    }
  });
});
