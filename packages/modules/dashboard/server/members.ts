import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { sql } from 'drizzle-orm';
import {
  type CommunityEngagement,
  type EventEngagement,
  type MembersPayload,
  membersPayloadSchema,
  type OwnerMembersAnswer,
  type OwnerMembersReady,
} from '../contracts/index';
import { readLatestSnapshot, snapshotMetaOf } from './snapshot';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/** D-465: "saíram" and the balance are never numbers (`memberships.deleted_at` is never written). */
const MEMBER_EXIT = { measured: false, reason: 'needs_member_exit' } as const;

/**
 * `GET /v1/dashboard/owner/members` (08.7-02, D-465, D-460, D-462, INSIGHT-08): the Membros area of
 * the tenant's newest snapshot, read in the admin's own lane.
 *
 * - The module flags are read FIRST, before the lane opens (the A-WR-03 order: the flags cache opens
 *   its own transaction on a miss, never one nested in ours).
 * - No snapshot, or a snapshot whose `members` key is missing or fails its contract (an older
 *   payload version) → `{ state: 'preparing' }`, never zeros.
 * - `growth.left` and `growth.balance` are `{ measured: false, reason: 'needs_member_exit' }`.
 * - `communityEngagement` only while `communities` is on, `eventEngagement` only while `events` is
 *   on (planning decision 6): the builder computes every scope, the API drops the hidden ones.
 * - The snapshot keeps ids only (PR-1): each community's and event's LIVE labels are joined here, in
 *   the same lane, so a change of name, cover or schedule shows at once; an entry whose row is no
 *   longer readable (deleted since the build) is dropped.
 */
export async function getOwnerMembers(ctx: Ctx): Promise<OwnerMembersAnswer> {
  const flags = await moduleFlags.flags(ctx);
  const scopes = {
    communities: flags.keys.has('communities'),
    events: flags.keys.has('events'),
    store: flags.keys.has('store'),
  };
  return withTenantTx(ctx, async (tx) => {
    const row = await readLatestSnapshot(tx, ctx.tenantId);
    if (!row) return { state: 'preparing' } as const;
    const snapshot = snapshotMetaOf(row);
    const members = readMembersPayload(row.payload);
    if (!snapshot || !members) return { state: 'preparing' } as const;

    const answer: OwnerMembersReady = {
      state: 'ready',
      snapshot,
      growth: {
        joined: members.growth.joined,
        weeklyJoined: members.growth.weeklyJoined,
        left: MEMBER_EXIT,
        balance: MEMBER_EXIT,
      },
      engagement: members.engagement,
      movement: members.movement,
      cohorts: members.cohorts,
      atRiskWithPush: members.atRiskWithPush,
    };
    if (scopes.communities) {
      answer.communityEngagement = await withCommunityLabels(
        tx,
        members.communityEngagement,
        scopes.store,
      );
    }
    if (scopes.events) {
      answer.eventEngagement = await withEventLabels(tx, members.eventEngagement);
    }
    return answer;
  });
}

/**
 * The snapshot's `members` key parsed with its contract, or `null` when it is missing or invalid
 * (planning decision 3 of 08.7-01: the API parses what it serves, it never compares versions).
 */
export function readMembersPayload(payload: unknown): MembersPayload | null {
  const area = (payload ?? {}) as Record<string, unknown>;
  const parsed = membersPayloadSchema.safeParse(area.members);
  return parsed.success ? parsed.data : null;
}

/** `{a,b,c}`: a Postgres array literal of ids the contract already validated as uuids. */
function uuidArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}

async function withCommunityLabels(
  tx: Tx,
  entries: MembersPayload['communityEngagement'],
  storeOn: boolean,
): Promise<CommunityEngagement[]> {
  if (entries.length === 0) return [];
  const rows = await tx.execute<{
    id: string;
    name: string;
    description: string;
    cover_asset_id: string | null;
    linked: boolean;
  }>(sql`
    select c.id::text as id, c.name, c.description, c.cover_asset_id::text as cover_asset_id,
           exists (select 1 from public.store_product_communities l
                    where l.tenant_id = c.tenant_id and l.community_id = c.id) as linked
      from public.communities c
     where c.id = any (${uuidArray(entries.map((entry) => entry.id))}::uuid[])
       and c.deleted_at is null`);
  const labels = new Map(rows.map((row) => [row.id, row]));
  return entries.flatMap((entry) => {
    const label = labels.get(entry.id);
    if (!label) return [];
    return [
      {
        ...entry,
        name: label.name,
        description: label.description,
        coverAssetId: label.cover_asset_id,
        // The base of a community is its buyers only while the store is on (app.community_viewer_ids).
        exclusive: storeOn && label.linked,
      },
    ];
  });
}

async function withEventLabels(
  tx: Tx,
  entries: MembersPayload['eventEngagement'],
): Promise<EventEngagement[]> {
  if (entries.length === 0) return [];
  const rows = await tx.execute<{
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    format: 'in_person' | 'online';
    cover_asset_id: string | null;
  }>(sql`
    select e.id::text as id, e.title,
           to_char(e.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as starts_at,
           to_char(e.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ends_at,
           e.format, e.cover_asset_id::text as cover_asset_id
      from public.events e
     where e.id = any (${uuidArray(entries.map((entry) => entry.id))}::uuid[])
       and e.deleted_at is null`);
  const labels = new Map(rows.map((row) => [row.id, row]));
  return entries.flatMap((entry) => {
    const label = labels.get(entry.id);
    if (!label) return [];
    return [
      {
        ...entry,
        title: label.title,
        startsAt: label.starts_at,
        endsAt: label.ends_at,
        format: label.format,
        coverAssetId: label.cover_asset_id,
      },
    ];
  });
}
