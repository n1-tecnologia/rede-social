import { randomUUID } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { MEDIA_TENANT_BYTES_CEILING } from '@rede-social/core/server/media/limits';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseKit, post, removeThrowaways, sweepCases, throwawayMember } from './chat-case-fixtures';
import { readyVoiceAsset, removeVoiceRows } from './chat-voice-fixtures';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * The read gate and the media guards of the chat voice message, against the live local stack (Phase 12.5,
 * plan 07; D-858, D-859, D-867, D-868, D-870; VOICE-24, VOICE-25, VOICE-26, VOICE-34).
 *
 * `voice media gate` asks `GET /v1/media/{id}/original` (the route a recording is played from) as the sender,
 * the case's staff, another member of the tenant and another tenant's member, each 302 beside the 404 that
 * says "no": the 404 must be the BARE body an unknown id gets, so the route is not an existence oracle.
 * `voice media guards` covers `DELETE /v1/media/{id}` and the admin library. `voice media isolation` is the
 * cross-tenant case with its positive control.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order). The recordings are real: a signed
 * upload to the private bucket and the in-process derive with the real ffmpeg (`chat-voice-fixtures.ts`).
 */

/** A 1x1 transparent PNG: the smallest object the private bucket accepts for an image row. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const memberIds: string[] = [];
/** The non-voice rows a test inserts by hand (with the Storage object it uploaded). */
const foreignAssets: { id: string; key: string }[] = [];

beforeAll(async () => {
  await caseKit();
  await sweepCases();
});

afterAll(async () => {
  await sweepCases();
  await removeVoiceRows(memberIds);
  const storage = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  ).storage;
  for (const asset of foreignAssets.splice(0)) {
    await storage.from('media').remove([asset.key]);
    await adminSql`delete from public.media_assets where id = ${asset.id}::uuid`;
  }
  await removeThrowaways();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

/** `GET /v1/media/{id}/original` as `token` on `host`. A 302 carries the signed URL in `Location`. */
const original = (assetId: string, token: string, host: string = HOSTS.demo) =>
  api.request(`/v1/media/${assetId}/original`, {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-host': host },
  });

type ErrorBody = { error: { code: string; details?: unknown; requestId?: string } };

/** The refusal body without its per-request id, to compare two answers byte for byte. */
async function refusal(res: Response) {
  const { error } = (await res.json()) as ErrorBody;
  const { requestId: _requestId, ...rest } = error;
  return rest;
}

/** Asserts a bare 404 identical in status and body to the answer for an id that does not exist. */
async function expectBare404(res: Response, token: string, host: string = HOSTS.demo) {
  expect(res.status).toBe(404);
  const unknown = await original(randomUUID(), token, host);
  expect(unknown.status).toBe(404);
  expect(await refusal(res)).toEqual(await refusal(unknown));
}

function expectSigned302(res: Response, tenantId: string, assetId: string) {
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toContain(
    `/object/sign/media/${tenantId}/media/${assetId}/original`,
  );
}

/** A fresh member with nothing in the chat tables, registered for the voice cleanup. */
async function voiceMember(label: string) {
  const member = await throwawayMember(label);
  memberIds.push(member.id);
  return member;
}

const sendVoice = (token: string, mediaId: string) =>
  post('/v1/chat/support/voice-messages', token, { mediaId });

describe('voice media gate', () => {
  it('an unsent take opens only for its uploader; everyone else gets the bare 404 of an unknown id (D-858, VOICE-24)', async () => {
    const { tokens, ids } = await caseKit();
    const uploader = await voiceMember('gate-unsent');
    const other = await voiceMember('gate-unsent-other');
    const take = await readyVoiceAsset(uploader.token, 'voice-2s.webm');

    expectSigned302(await original(take, uploader.token), ids.demo, take);
    await expectBare404(await original(take, other.token), other.token);
    await expectBare404(await original(take, tokens.demoSupport), tokens.demoSupport);
    await expectBare404(await original(take, tokens.demoAdmin), tokens.demoAdmin);
  });

  it('a sent recording opens for the sender, the support staff and the admin, never for another member or another tenant (VOICE-24, VOICE-25, T-12.5-24)', async () => {
    const { tokens, ids } = await caseKit();
    const sender = await voiceMember('gate-sent');
    const other = await voiceMember('gate-sent-other');
    const take = await readyVoiceAsset(sender.token, 'voice-2s.webm');
    const sent = await sendVoice(sender.token, take);
    expect(sent.status).toBe(201);

    // The 302s: the people who can read the message.
    expectSigned302(await original(take, sender.token), ids.demo, take);
    expectSigned302(await original(take, tokens.demoSupport), ids.demo, take);
    expectSigned302(await original(take, tokens.demoAdmin), ids.demo, take);

    // The 404s beside them: a member who is not in the case, and tenant B's member on tenant B's host.
    await expectBare404(await original(take, other.token), other.token);
    const labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
    await expectBare404(await original(take, labMember, HOSTS.lab), labMember, HOSTS.lab);
  });

  it('a retired recording is served to nobody, the sender and the staff included (D-868, T-12.5-26)', async () => {
    const { tokens } = await caseKit();
    const sender = await voiceMember('gate-retired');
    const take = await readyVoiceAsset(sender.token, 'voice-2s.webm');
    const sent = await sendVoice(sender.token, take);
    expect(sent.status).toBe(201);
    expect((await original(take, sender.token)).status).toBe(302);

    // The system action (the account-deletion step and the orphan sweep of plan 08 do the same): soft delete.
    await adminSql`
      update public.media_assets set status = 'deleted', deleted_at = now()
       where id = ${take}::uuid`;

    await expectBare404(await original(take, sender.token), sender.token);
    await expectBare404(await original(take, tokens.demoSupport), tokens.demoSupport);
    await expectBare404(await original(take, tokens.demoAdmin), tokens.demoAdmin);
  });

  it('a non-voice asset keeps its shipped answer: a member who did not upload it still gets the 302 (D-858)', async () => {
    const { ids } = await caseKit();
    const owner = await voiceMember('gate-image');
    const other = await voiceMember('gate-image-other');
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.media_assets (tenant_id, owner_user_id, kind, purpose, status, mime, bytes, ready_at)
      values (${ids.demo}::uuid, ${owner.id}::uuid, 'image', 'post', 'ready', 'image/png', ${ONE_PIXEL_PNG.length}, now())
      returning id::text as id`;
    const id = row?.id ?? '';
    const key = `${ids.demo}/media/${id}/original`;
    foreignAssets.push({ id, key });
    const storage = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_KEY ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    ).storage;
    const put = await storage.from('media').upload(key, new Uint8Array(ONE_PIXEL_PNG), {
      contentType: 'image/png',
    });
    expect(put.error).toBeNull();

    expectSigned302(await original(id, owner.token), ids.demo, id);
    expectSigned302(await original(id, other.token), ids.demo, id);
  });
});

/** `DELETE /v1/media/{id}` as `token`. */
const retire = (assetId: string, token: string) =>
  api.request(`/v1/media/${assetId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
  });

/** `GET /v1/media?...` (the admin library) as `token`: the ids of the first page of up to 50 assets. */
async function libraryIds(
  token: string,
  query = '',
): Promise<{ ids: string[]; next: string | null }> {
  const res = await api.request(`/v1/media?limit=50${query}`, {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
  });
  expect(res.status).toBe(200);
  const page = (await res.json()) as { items: { id: string }[]; nextCursor: string | null };
  return { ids: page.items.map((item) => item.id), next: page.nextCursor };
}

describe('voice media guards', () => {
  it('nobody retires a voice asset through the media API, the uploader and the admin alike, before and after sending (D-870, VOICE-26, T-12.5-28)', async () => {
    const { tokens } = await caseKit();
    const sender = await voiceMember('guard-delete');
    const take = await readyVoiceAsset(sender.token, 'voice-2s.webm');

    // Before the send: the uploader is refused the way a caller who may not retire an asset is (the bare 404).
    const unknown = await retire(randomUUID(), sender.token);
    expect(unknown.status).toBe(404);
    const baseline = await refusal(unknown);
    const beforeSend = await retire(take, sender.token);
    expect(beforeSend.status).toBe(404);
    expect(await refusal(beforeSend)).toEqual(baseline);
    const rowBefore = await adminSql<{ status: string; deleted_at: Date | null }[]>`
      select status, deleted_at from public.media_assets where id = ${take}::uuid`;
    expect(rowBefore[0]).toEqual({ status: 'ready', deleted_at: null });

    // After the send: the uploader, then the admin (who may retire an ordinary asset), are refused the same way.
    const sent = await sendVoice(sender.token, take);
    expect(sent.status).toBe(201);
    const afterSend = await retire(take, sender.token);
    expect(afterSend.status).toBe(404);
    expect(await refusal(afterSend)).toEqual(baseline);
    const byAdmin = await retire(take, tokens.demoAdmin);
    expect(byAdmin.status).toBe(404);
    expect(await refusal(byAdmin)).toEqual(baseline);

    // The row is untouched and the recording still plays for the people who may read the message.
    const rowAfter = await adminSql<{ status: string; deleted_at: Date | null }[]>`
      select status, deleted_at from public.media_assets where id = ${take}::uuid`;
    expect(rowAfter[0]).toEqual({ status: 'ready', deleted_at: null });
    expect((await original(take, sender.token)).status).toBe(302);
    expect((await original(take, tokens.demoSupport)).status).toBe(302);
  });

  it('the admin library never lists a voice asset, whatever the filter, and still lists an ordinary one (D-870, VOICE-26, T-12.5-30)', async () => {
    const { tokens, ids } = await caseKit();
    const sender = await voiceMember('guard-list');
    const take = await readyVoiceAsset(sender.token, 'voice-2s.webm');
    const sent = await readyVoiceAsset(sender.token, 'voice-2s.webm');
    expect((await sendVoice(sender.token, sent)).status).toBe(201);

    // The ordinary asset the listing must keep showing, written newer than both recordings.
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.media_assets (tenant_id, owner_user_id, kind, purpose, status, mime, bytes, ready_at)
      values (${ids.demo}::uuid, ${sender.id}::uuid, 'image', 'post', 'ready', 'image/png', 70, now())
      returning id::text as id`;
    const ordinary = row?.id ?? '';
    foreignAssets.push({ id: ordinary, key: `${ids.demo}/media/${ordinary}/original` });

    const all = await libraryIds(tokens.demoAdmin);
    expect(all.ids).toContain(ordinary);
    expect(all.ids).not.toContain(take);
    expect(all.ids).not.toContain(sent);

    const byPurpose = await libraryIds(tokens.demoAdmin, '&purpose=voice');
    expect(byPurpose.ids).toEqual([]);
    expect(byPurpose.next).toBeNull();
    const byKind = await libraryIds(tokens.demoAdmin, '&kind=audio');
    expect(byKind.ids).toEqual([]);
    expect(byKind.next).toBeNull();
    const both = await libraryIds(tokens.demoAdmin, '&kind=audio&purpose=voice');
    expect(both.ids).toEqual([]);

    // The ordinary kind is unchanged under its own filter.
    const images = await libraryIds(tokens.demoAdmin, '&kind=image&purpose=post');
    expect(images.ids).toContain(ordinary);
  });

  it('a voice asset still counts in the byte totals: a start that does not fit beside it is refused 413 (D-870)', async () => {
    const { tokens, ids } = await caseKit();
    const padBytes = MEDIA_TENANT_BYTES_CEILING - 1024 * 1024;
    const [pad] = await adminSql<{ id: string }[]>`
      insert into public.media_assets (tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds, ready_at)
      values (${ids.demo}::uuid, ${ids.demoAdmin}::uuid, 'audio', 'voice', 'ready', 'audio/mp4', ${padBytes}, 5, now())
      returning id::text as id`;
    const padId = pad?.id ?? '';
    try {
      const refused = await api.request('/v1/media/uploads', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.demoAdmin}`,
          'x-tenant-host': HOSTS.demo,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'image',
          purpose: 'post',
          mime: 'image/jpeg',
          size: 4 * 1024 * 1024,
        }),
      });
      expect(refused.status).toBe(413);
      const body = (await refused.json()) as { error: { details?: { media?: string } } };
      expect(body.error.details?.media).toBe('quota_exceeded');
    } finally {
      await adminSql`delete from public.media_assets where id = ${padId}::uuid`;
    }
  });
});
