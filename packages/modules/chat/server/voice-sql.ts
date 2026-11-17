import type { Tx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { sql } from 'drizzle-orm';

/**
 * The SQL fragments of a recording (Phase 12.5, D-846, D-862), shared by the member's send (plan 05), the staff
 * reply (plan 06) and the previews (plan 09). Raw SQL on purpose: the chat module reaches `media_assets` and
 * `chat_messages` through the tenant lane only, and adds no kernel import for it.
 */

/** An SQL alias is spelled by code, never by a caller; this keeps `sql.raw` honest. */
const ALIAS = /^[a-z][a-z0-9_]*$/;

/**
 * The "gone" test of a recording, as an SQL boolean over a `chat_messages` alias: the message has an asset and that
 * asset is no longer a live row (soft-deleted, or hidden from the tenant lane by the media policy). It is NOT
 * `deleted_at` of the message (moderation): the message row stays and the player draws "indisponivel".
 */
export function voiceGoneSql(alias: string) {
  if (!ALIAS.test(alias)) throw new Error(`voiceGoneSql: bad alias ${alias}`);
  return sql.raw(
    `(${alias}.media_asset_id is not null and not exists (select 1 from media_assets va where va.id = ${alias}.media_asset_id and va.deleted_at is null))`,
  );
}

/** What the send needs to know about a recording the CALLER owns. */
export type VoiceAssetFacts = {
  status: string;
  kind: string;
  purpose: string;
  durationSeconds: number | null;
};

/**
 * The caller's OWN asset by id, or null. The caller's id is compared EXPLICITLY (`owner_user_id`): the tenant
 * lane's policy alone would let any member of the tenant read it. Another member's, another tenant's, a
 * soft-deleted and an unknown id are all the same null, so the caller never learns which it was (T-12.5-15).
 */
export async function loadVoiceAsset(
  tx: Tx,
  ctx: RequestContext,
  mediaId: string,
): Promise<VoiceAssetFacts | null> {
  const rows = await tx.execute<{
    status: string;
    kind: string;
    purpose: string;
    duration_seconds: number | null;
  }>(sql`
    select a.status, a.kind, a.purpose, a.duration_seconds
      from media_assets a
     where a.id = ${mediaId}::uuid
       and a.tenant_id = ${ctx.tenantId}::uuid
       and a.owner_user_id = ${ctx.userId}::uuid
       and a.deleted_at is null`);
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status,
    kind: row.kind,
    purpose: row.purpose,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
  };
}

/**
 * The caller's own message that already carries this asset (the idempotent read of a repeated send, VOICE-18), or
 * null. A take is usable once per tenant (`chat_messages_tenant_media_asset_uq`), so there is at most one.
 */
export async function storedVoiceMessage(
  tx: Tx,
  ctx: RequestContext,
  mediaId: string,
): Promise<{ id: string; conversationId: string } | null> {
  const rows = await tx.execute<{ id: string; conversation_id: string }>(sql`
    select m.id, m.conversation_id
      from chat_messages m
     where m.tenant_id = ${ctx.tenantId}::uuid
       and m.media_asset_id = ${mediaId}::uuid
       and m.author_user_id = ${ctx.userId}::uuid
     limit 1`);
  const row = rows[0];
  return row ? { id: row.id, conversationId: row.conversation_id } : null;
}

/**
 * The asset refusals of every voice send, in ONE place (D-862). BEFORE any case write:
 *  - a recording of the caller's that is still `pending` or `processing` is `409 CONFLICT { chat: 'voice_not_ready' }`
 *    (retriable: the derive job is on its way);
 *  - every other unusable asset (unknown, another member's, another tenant's, soft-deleted, not `audio`/`voice`,
 *    `failed`, `rejected`, or with no measured duration) is ONE `400 VALIDATION_FAILED { chat: 'voice_invalid' }`.
 * `voice_not_ready` is only ever answered for the caller's OWN asset (the ownership predicate of `loadVoiceAsset`
 * comes first), so it reveals nothing about anyone else's (T-12.5-19).
 */
export async function assertVoiceUsable(
  tx: Tx,
  ctx: RequestContext,
  mediaId: string,
): Promise<void> {
  const asset = await loadVoiceAsset(tx, ctx, mediaId);
  if (asset?.kind !== 'audio' || asset.purpose !== 'voice') {
    throw new ApiError(400, 'VALIDATION_FAILED', { chat: 'voice_invalid' });
  }
  if (asset.status === 'pending' || asset.status === 'processing') {
    throw new ApiError(409, 'CONFLICT', { chat: 'voice_not_ready' });
  }
  if (asset.status !== 'ready' || asset.durationSeconds === null) {
    throw new ApiError(400, 'VALIDATION_FAILED', { chat: 'voice_invalid' });
  }
}
