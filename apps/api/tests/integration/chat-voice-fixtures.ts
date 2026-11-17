import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveVariantsJob } from '@rede-social/core/server/media/derive-job';
import { createClient } from '@supabase/supabase-js';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * The shared voice upload and cleanup helpers of the voice integration suites (Phase 12.5, plans 05 to 09).
 * Modelled on `media-voice.test.ts` (plan 02): the bytes go to the REAL private `media` bucket through the
 * signed URL, `complete` queues the derive job, and the job handler is driven IN-PROCESS so the real ffmpeg
 * normalizes the take and the row becomes `ready` with a server-measured duration.
 *
 * Every asset a helper creates is remembered, and `removeVoiceRows` deletes the MESSAGES that reference them
 * before the assets (the foreign key of `chat_messages.media_asset_id` is NO ACTION, so the order matters).
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  webm: 'audio/webm',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
};

/** The assets the helpers created, removed (after their messages) by `removeVoiceRows`. */
const createdAssetIds: string[] = [];

/** One of the committed recordings of `tests/fixtures/audio` (for example `voice-2s.webm`). */
export function voiceFixtureBytes(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`../fixtures/audio/${name}`, import.meta.url)));
}

function mimeOf(name: string): string {
  const extension = name.split('.').pop() ?? '';
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) throw new Error(`no audio mime for ${name}`);
  return mime;
}

const media = (
  path: string,
  token: string,
  init: { method: string; body?: unknown },
  host: string,
) =>
  api.request(`/v1/media${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': host,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

/**
 * Start, PUT and complete one recording and STOP there: the row is `processing` and the derive job is queued
 * but not run. The asset a "not ready" test needs.
 */
export async function processingVoiceAsset(
  token: string,
  name: string,
  host: string = HOSTS.demo,
): Promise<string> {
  const bytes = voiceFixtureBytes(name);
  const mime = mimeOf(name);
  const start = await media(
    '/uploads',
    token,
    { method: 'POST', body: { kind: 'audio', purpose: 'voice', mime, size: bytes.length } },
    host,
  );
  const startBody = (await start.json()) as { assetId?: string; signedUrl?: string };
  if (start.status !== 201 || !startBody.assetId || !startBody.signedUrl) {
    throw new Error(`voice upload start failed: ${start.status} ${JSON.stringify(startBody)}`);
  }
  createdAssetIds.push(startBody.assetId);
  const put = await fetch(startBody.signedUrl, {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: { 'content-type': mime, 'x-upsert': 'false' },
  });
  if (!put.ok) throw new Error(`voice PUT failed: ${put.status}`);
  const complete = await media(
    `/uploads/${startBody.assetId}/complete`,
    token,
    { method: 'POST' },
    host,
  );
  if (complete.status !== 200) throw new Error(`voice complete failed: ${complete.status}`);
  return startBody.assetId;
}

/** Runs the derive job for a processing asset in-process, as the worker would. */
export async function deriveVoiceAsset(assetId: string): Promise<void> {
  const [row] = await adminSql<{ tenant_id: string }[]>`
    select tenant_id::text as tenant_id from public.media_assets where id = ${assetId}::uuid`;
  if (!row) throw new Error(`asset ${assetId} does not exist`);
  await deriveVariantsJob.handler({ tenantId: row.tenant_id, assetId, attempt: 0 });
}

/** The whole upload: the asset id once it is `ready` (mono AAC audio/mp4 with a measured duration). */
export async function readyVoiceAsset(
  token: string,
  name: string,
  host: string = HOSTS.demo,
): Promise<string> {
  const assetId = await processingVoiceAsset(token, name, host);
  await deriveVoiceAsset(assetId);
  const [row] = await adminSql<{ status: string }[]>`
    select status from public.media_assets where id = ${assetId}::uuid`;
  if (row?.status !== 'ready')
    throw new Error(`voice asset ${assetId} is ${row?.status}, not ready`);
  return assetId;
}

function storageAdmin() {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
}

/**
 * Deletes the messages that carry a recording FIRST (the NO ACTION foreign key), then the assets this
 * kit created or the given members own, their Storage objects and any queued derive job.
 */
export async function removeVoiceRows(memberIds: string[] = []): Promise<void> {
  const owned =
    memberIds.length > 0
      ? await adminSql<{ id: string }[]>`
          select id::text as id from public.media_assets
           where owner_user_id in ${adminSql(memberIds)} and kind = 'audio'`
      : [];
  const ids = [...new Set([...createdAssetIds.splice(0), ...owned.map((row) => row.id)])];
  if (ids.length === 0) return;
  await adminSql`delete from public.chat_messages where media_asset_id in ${adminSql(ids)}`;
  for (const id of ids) {
    const objects = await adminSql<{ name: string }[]>`
      select name from storage.objects where bucket_id = 'media' and name like ${`%/media/${id}/%`}`;
    if (objects.length > 0) {
      await storageAdmin()
        .from('media')
        .remove(objects.map((object) => object.name));
    }
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
    await adminSql`
      delete from pgboss.job_common
       where name = 'kernel.media-derive-variants' and singleton_key = ${id}`;
  }
}

/** A signed-in token of a seeded demo staff user (`support@rede-demo.local`, `admin@rede-demo.local`). */
export async function staffToken(email: string): Promise<string> {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  return signInAs(email, SEED_PASSWORD);
}
