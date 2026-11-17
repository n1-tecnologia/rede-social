import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { registeredSweepFunctions } from '@rede-social/core/server/jobs/sweep-functions';
import type { MessagePage, SendResult } from '@rede-social/module-chat/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  caseKit,
  post,
  removeThrowaways,
  request,
  sweepCases,
  throwawayMember,
} from './chat-case-fixtures';
import { readyVoiceAsset, removeVoiceRows } from './chat-voice-fixtures';
import { adminSql, api, HOSTS } from './setup';

/**
 * The two system removals of a chat recording, against the live local stack (Phase 12.5, plan 08; D-844,
 * D-856, D-868, D-869; VOICE-27, VOICE-34, VOICE-37).
 *
 * `voice orphan sweep`: a recording nobody sent leaves the quota after 24 hours, through the kernel's EXISTING
 * hourly sweeper (`kernel.media-sweep-orphans`) running `app.chat_voice_orphans_sweep(500)` through the admin
 * lane; a SENT recording never does (D-856). The 24 hours are ONE literal in the SQL function, pinned here.
 *
 * `voice account deletion`: the account-deletion step (`app.account_anonymise`, D-868, VOICE-37) soft-deletes a
 * member's recordings; the thread keeps the message and projects it as deleted, the recording is served to nobody
 * at once, the hourly sweeper purges the Storage objects, and the message's foreign key (NO ACTION) no longer
 * makes the purge loop: a SENT recording keeps its row as a tombstone (`status = 'failed'`, `failure_reason =
 * 'purged_referenced'`, `deleted_at` set), an unsent one is deleted with its row.
 *
 * The sweeper and its imports load INSIDE the tests (the media-sweeper precedent's heavy-import rule), after
 * `api` pulled in the registry. Every fixture belongs to a throwaway member and is removed in `afterAll`.
 */

const MEDIA_SWEEP_QUEUE = 'kernel.media-sweep-orphans';
/** D-869: the 24 hours live in the SQL function only; this constant exists to pin them, nowhere else. */
const VOICE_ORPHAN_HOURS = 24;

const memberIds: string[] = [];

async function loadSweeper() {
  // `api` is referenced so the app (and its module registry) is imported before the sweeper runs.
  expect(api).toBeDefined();
  return (await import('@rede-social/core/server/media/sweep-job')).sweepOrphansJob;
}

/** A fresh live member of the demo tenant, registered for the voice cleanup. */
async function voiceMember(label: string) {
  const member = await throwawayMember(label);
  memberIds.push(member.id);
  return member;
}

type AssetFixture = {
  tenantId: string;
  ownerId: string;
  status?: string;
  purpose?: string;
  kind?: string;
  age: string;
};

/** One `media_assets` row written by the table owner, `age` old; the id comes back. */
async function insertAsset(f: AssetFixture): Promise<string> {
  const kind = f.kind ?? 'audio';
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets (tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds, created_at)
    values (${f.tenantId}::uuid, ${f.ownerId}::uuid, ${kind}, ${f.purpose ?? 'voice'}, ${f.status ?? 'ready'},
            ${kind === 'audio' ? 'audio/mp4' : 'image/png'}, 8000, ${kind === 'audio' ? 2 : null},
            now() - ${f.age}::interval)
    returning id::text as id`;
  if (!row) throw new Error('the asset fixture was not written');
  return row.id;
}

/** A support case of `memberId` holding ONE voice message that references `assetId` (the table owner writes it). */
async function sendDirect(tenantId: string, memberId: string, assetId: string): Promise<string> {
  const [conversation] = await adminSql<{ id: string }[]>`
    insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
    values (${tenantId}::uuid, 'support', ${memberId}::uuid)
    returning id::text as id`;
  const conversationId = conversation?.id ?? '';
  await adminSql`
    insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
    values (${tenantId}::uuid, ${conversationId}::uuid, ${memberId}::uuid, 'member', null, ${assetId}::uuid, 2)`;
  return conversationId;
}

type AssetState = { status: string; deleted: boolean; tenantId: string };

async function assetState(id: string): Promise<AssetState> {
  const [row] = await adminSql<{ status: string; deleted: boolean; tenant_id: string }[]>`
    select status, deleted_at is not null as deleted, tenant_id::text as tenant_id
      from public.media_assets where id = ${id}::uuid`;
  if (!row) throw new Error(`asset ${id} is gone`);
  return { status: row.status, deleted: row.deleted, tenantId: row.tenant_id };
}

async function cleanup(): Promise<void> {
  await removeVoiceRows(memberIds);
  await removeThrowaways();
  memberIds.splice(0);
  await adminSql`delete from pgboss.job_common where name = ${MEDIA_SWEEP_QUEUE}`;
}

beforeAll(async () => {
  await caseKit();
  await sweepCases();
});

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await sweepCases();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('voice orphan sweep', () => {
  it('the app registry registered chat_voice_orphans_sweep from the module manifest (D-844)', () => {
    expect(api).toBeDefined();
    expect(registeredSweepFunctions()).toContain('chat_voice_orphans_sweep');
  });

  it('the real hourly sweeper soft-deletes an unsent take after a day and leaves a sent one and a young one (D-856, D-869)', async () => {
    const sweepOrphansJob = await loadSweeper();
    const { ids } = await caseKit();
    const member = await voiceMember('sweep-tracer');

    const orphan = await insertAsset({ tenantId: ids.demo, ownerId: member.id, age: '25 hours' });
    const failed = await insertAsset({
      tenantId: ids.demo,
      ownerId: member.id,
      status: 'failed',
      age: '25 hours',
    });
    const young = await insertAsset({ tenantId: ids.demo, ownerId: member.id, age: '23 hours' });
    const sent = await insertAsset({ tenantId: ids.demo, ownerId: member.id, age: '25 hours' });
    await sendDirect(ids.demo, member.id, sent);
    // The other tenant's unsent take is swept in its OWN tenant (VOICE-34): the row keeps its tenant.
    const otherTenant = await insertAsset({
      tenantId: ids.lab,
      ownerId: member.id,
      age: '25 hours',
    });

    await sweepOrphansJob.handler({});

    expect(await assetState(orphan)).toEqual({
      status: 'deleted',
      deleted: true,
      tenantId: ids.demo,
    });
    expect(await assetState(failed)).toEqual({
      status: 'deleted',
      deleted: true,
      tenantId: ids.demo,
    });
    expect(await assetState(otherTenant)).toEqual({
      status: 'deleted',
      deleted: true,
      tenantId: ids.lab,
    });
    expect(await assetState(young)).toEqual({
      status: 'ready',
      deleted: false,
      tenantId: ids.demo,
    });
    expect(await assetState(sent), 'a recording a message references stays').toEqual({
      status: 'ready',
      deleted: false,
      tenantId: ids.demo,
    });
  });

  it('a sent recording survives however old it gets, and an image of the same age is not a recording (D-856)', async () => {
    const sweepOrphansJob = await loadSweeper();
    const { ids } = await caseKit();
    const member = await voiceMember('sweep-sent');
    const sent = await insertAsset({ tenantId: ids.demo, ownerId: member.id, age: '30 days' });
    await sendDirect(ids.demo, member.id, sent);
    const image = await insertAsset({
      tenantId: ids.demo,
      ownerId: member.id,
      kind: 'image',
      purpose: 'avatar',
      age: '30 days',
    });

    await sweepOrphansJob.handler({});
    await sweepOrphansJob.handler({});

    expect((await assetState(sent)).deleted).toBe(false);
    expect((await assetState(image)).deleted).toBe(false);
  });

  it('the 24 hours are one literal in the SQL function (D-869)', async () => {
    const [row] = await adminSql<{ def: string }[]>`
      select pg_get_functiondef('app.chat_voice_orphans_sweep(int)'::regprocedure) as def`;
    const hours = [...(row?.def ?? '').matchAll(/interval '(\d+) hours?'/g)].map((m) =>
      Number(m[1]),
    );
    expect(hours).toEqual([VOICE_ORPHAN_HOURS]);
  });
});

/** `GET /v1/media/{id}/original` as `token` on the demo host: 302 with a signed URL, or a refusal. */
const original = (assetId: string, token: string) =>
  api.request(`/v1/media/${assetId}/original`, {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
  });

/** The Storage objects of one asset (the original and any derived rung) in the private `media` bucket. */
async function objectsOf(assetId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from storage.objects
     where bucket_id = 'media' and name like ${`%/media/${assetId}/%`}`;
  return row?.n ?? -1;
}

type RetiredRow = { status: string; reason: string | null; deleted: boolean };

async function rowOf(assetId: string): Promise<RetiredRow | null> {
  const [row] = await adminSql<{ status: string; reason: string | null; deleted: boolean }[]>`
    select status, failure_reason as reason, deleted_at is not null as deleted
      from public.media_assets where id = ${assetId}::uuid`;
  return row ?? null;
}

describe('voice account deletion', () => {
  it('a deleted member recordings stop playing at once, read as deleted, are purged once and the purge does not loop on the message foreign key (D-868, VOICE-37, T-12.5-34, T-12.5-36)', async () => {
    const sweepOrphansJob = await loadSweeper();
    const { ids, tokens } = await caseKit();
    const member = await voiceMember('deletion-chain');
    const sentAsset = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const unsentAsset = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const sent = await post('/v1/chat/support/voice-messages', member.token, {
      mediaId: sentAsset,
    });
    expect(sent.status).toBe(201);
    const { conversationId, message } = (await sent.json()) as SendResult;

    const thread = async () => {
      const res = await request(
        `/v1/chat/conversations/${conversationId}/messages`,
        tokens.demoSupport,
      );
      expect(res.status).toBe(200);
      const page = (await res.json()) as MessagePage;
      const found = page.items.find((item) => item.id === message.id);
      if (!found) throw new Error('the voice message is not in the thread');
      return found;
    };

    // Before: the recording plays for the staff and the thread shows a live recording.
    expect((await original(sentAsset, tokens.demoSupport)).status).toBe(302);
    expect((await thread()).voice).toEqual({ mediaId: sentAsset, durationSeconds: 2 });
    expect(await objectsOf(sentAsset)).toBeGreaterThan(0);
    expect(await objectsOf(unsentAsset)).toBeGreaterThan(0);

    // The member is due for anonymisation exactly as 222 builds its `a3` member, then the step runs.
    const [membership] = await adminSql<{ id: string }[]>`
      update public.memberships
         set deletion_requested_at = now() - interval '20 days',
             deletion_due_at = now() - interval '1 day',
             deleted_at = now() - interval '15 days'
       where tenant_id = ${ids.demo}::uuid and user_id = ${member.id}::uuid
      returning id::text as id`;
    const [done] = await adminSql<{ ok: boolean }[]>`
      select app.account_anonymise(${membership?.id ?? ''}::uuid) as ok`;
    expect(done?.ok).toBe(true);

    // The thread keeps the message: no body, the same seconds, and `deleted: true`.
    const after = await thread();
    expect(after.voice).toEqual({ mediaId: sentAsset, durationSeconds: 2, deleted: true });
    expect(after.body).toBe('');
    const [still] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_messages where id = ${message.id}::uuid`;
    expect(still?.n).toBe(1);

    // The recording is served to nobody at once: the staff and the tenant admin get the bare 404.
    for (const token of [tokens.demoSupport, tokens.demoAdmin]) {
      const res = await original(sentAsset, token);
      expect(res.status).toBe(404);
    }

    // Both recordings are soft-deleted, the bytes are still on Storage until the sweeper runs.
    expect(await rowOf(sentAsset)).toEqual({ status: 'deleted', reason: null, deleted: true });
    expect(await rowOf(unsentAsset)).toEqual({ status: 'deleted', reason: null, deleted: true });
    expect(await objectsOf(sentAsset)).toBeGreaterThan(0);

    // An hour passes: the REAL hourly sweeper purges the objects of both.
    await adminSql`
      update public.media_assets set deleted_at = now() - interval '2 hours'
       where id in (${sentAsset}::uuid, ${unsentAsset}::uuid)`;
    await sweepOrphansJob.handler({});

    expect(await objectsOf(sentAsset)).toBe(0);
    expect(await objectsOf(unsentAsset)).toBe(0);
    // The unsent one is gone with its row; the SENT one stays as a tombstone the message can still point at.
    expect(await rowOf(unsentAsset)).toBeNull();
    expect(await rowOf(sentAsset)).toEqual({
      status: 'failed',
      reason: 'purged_referenced',
      deleted: true,
    });
    expect((await thread()).voice?.deleted).toBe(true);

    // A second run changes nothing: the tombstone is no longer collectable, so the hourly loop is over, and a direct
    // purge of the same row is a clean no-op that reports success instead of throwing on the foreign key.
    await sweepOrphansJob.handler({});
    expect(await rowOf(sentAsset)).toEqual({
      status: 'failed',
      reason: 'purged_referenced',
      deleted: true,
    });
    const { purgeAsset } = await import('@rede-social/core/server/media/service');
    expect(
      await purgeAsset({ id: sentAsset, tenantId: ids.demo, kind: 'audio', providerAssetId: null }),
    ).toEqual({ purged: true, objects: 0 });
  });

  it('the step leaves a live member recordings and another tenant alone (VOICE-34)', async () => {
    const { ids } = await caseKit();
    const gone = await voiceMember('deletion-gone');
    const live = await voiceMember('deletion-live');
    const goneAsset = await readyVoiceAsset(gone.token, 'voice-2s.webm');
    const liveAsset = await readyVoiceAsset(live.token, 'voice-2s.webm');
    // The same departing person also owns a recording in the OTHER tenant (a direct row: the throwaway is demo-only).
    const [other] = await adminSql<{ id: string }[]>`
      insert into public.media_assets (tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds)
      values (${ids.lab}::uuid, ${gone.id}::uuid, 'audio', 'voice', 'ready', 'audio/mp4', 8000, 2)
      returning id::text as id`;
    const otherAsset = other?.id ?? '';

    const [membership] = await adminSql<{ id: string }[]>`
      update public.memberships
         set deletion_requested_at = now() - interval '20 days',
             deletion_due_at = now() - interval '1 day',
             deleted_at = now() - interval '15 days'
       where tenant_id = ${ids.demo}::uuid and user_id = ${gone.id}::uuid
      returning id::text as id`;
    const [done] = await adminSql<{ ok: boolean }[]>`
      select app.account_anonymise(${membership?.id ?? ''}::uuid) as ok`;
    expect(done?.ok).toBe(true);

    expect((await rowOf(goneAsset))?.deleted).toBe(true);
    expect(await rowOf(liveAsset)).toEqual({ status: 'ready', reason: null, deleted: false });
    expect(await rowOf(otherAsset)).toEqual({ status: 'ready', reason: null, deleted: false });
  });
});
