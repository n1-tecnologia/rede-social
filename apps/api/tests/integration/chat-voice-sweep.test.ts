import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { registeredSweepFunctions } from '@rede-social/core/server/jobs/sweep-functions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { caseKit, removeThrowaways, sweepCases, throwawayMember } from './chat-case-fixtures';
import { removeVoiceRows } from './chat-voice-fixtures';
import { adminSql, api } from './setup';

/**
 * The two system removals of a chat recording, against the live local stack (Phase 12.5, plan 08; D-844,
 * D-856, D-868, D-869; VOICE-27, VOICE-34, VOICE-37).
 *
 * `voice orphan sweep`: a recording nobody sent leaves the quota after 24 hours, through the kernel's EXISTING
 * hourly sweeper (`kernel.media-sweep-orphans`) running `app.chat_voice_orphans_sweep(500)` through the admin
 * lane; a SENT recording never does (D-856). The 24 hours are ONE literal in the SQL function, pinned here.
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
    const otherTenant = await insertAsset({ tenantId: ids.lab, ownerId: member.id, age: '25 hours' });

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
    expect(await assetState(young)).toEqual({ status: 'ready', deleted: false, tenantId: ids.demo });
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
    const hours = [...(row?.def ?? '').matchAll(/interval '(\d+) hours?'/g)].map((m) => Number(m[1]));
    expect(hours).toEqual([VOICE_ORPHAN_HOURS]);
  });
});
