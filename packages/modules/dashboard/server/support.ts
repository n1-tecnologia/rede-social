import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { sql } from 'drizzle-orm';
import {
  type OwnerSupportAnswer,
  type OwnerSupportStaff,
  type SupportPayload,
  supportPayloadSchema,
} from '../contracts/index';
import { readLatestSnapshot, snapshotMetaOf } from './snapshot';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/** D-465: no subject is ever written on a support conversation ("Em breve"). */
const BY_SUBJECT = { measured: false, reason: 'needs_support_subject' } as const;

/**
 * The snapshot's `support` key parsed with its contract, or `null` when it is missing or invalid
 * (an older payload version): the caller answers `preparing`, never zeros (R-Pitfall 3).
 */
export function readSupportPayload(payload: unknown): SupportPayload | null {
  const area = (payload ?? {}) as Record<string, unknown>;
  const parsed = supportPayloadSchema.safeParse(area.support);
  return parsed.success ? parsed.data : null;
}

/** `{a,b,c}`: a Postgres array literal of ids the contract already validated as uuids. */
function uuidArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}

/**
 * The live names of the given STAFF users of `tenantId` (explicit predicate beside RLS), read in
 * the admin's lane: the display name exactly as stored in the profile of their current
 * `admin_tenant` or `support_tenant` membership. A user who is no longer staff has no name, so the
 * caller drops them (planning decision 3: the answer never names anyone but the team).
 */
async function liveStaffNames(
  tx: Tx,
  tenantId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx.execute<{ user_id: string; display_name: string }>(sql`
    select ms.user_id::text as user_id, coalesce(mp.display_name, '') as display_name
      from public.memberships ms
      left join public.member_profiles mp on mp.membership_id = ms.id
     where ms.user_id = any (${uuidArray(userIds)}::uuid[])
       and ms.tenant_id = ${tenantId}::uuid
       and ms.role in ('admin_tenant', 'support_tenant')
       and ms.status = 'active'
       and ms.deleted_at is null`);
  return new Map(rows.map((row) => [row.user_id, row.display_name]));
}

/**
 * `GET /v1/dashboard/owner/support` (08.7-11, D-455, D-460, D-465, INSIGHT-13, EP-42, EP-43): the
 * Atendimento area of the tenant's newest snapshot, read in the admin's own lane (the admin-only
 * policy of `dashboard_snapshots` applies). The route's chain already refused a tenant without
 * `chat` (404 `MODULE_DISABLED`) and any role but `admin_tenant` (403), in that order.
 *
 * - No snapshot, or a snapshot whose `support` key is missing or fails its contract → `preparing`.
 * - The team's names are joined LIVE, exactly as stored; a user no longer staff is dropped.
 * - `bySubject` is always `{ measured: false, reason: 'needs_support_subject' }` (D-465).
 * - Counts and minutes only: no message text, member name or member id (EP-43).
 */
export async function getOwnerSupport(ctx: Ctx): Promise<OwnerSupportAnswer> {
  return withTenantTx(ctx, async (tx) => {
    const row = await readLatestSnapshot(tx, ctx.tenantId);
    if (!row) return { state: 'preparing' } as const;
    const snapshot = snapshotMetaOf(row);
    const support = readSupportPayload(row.payload);
    if (!snapshot || !support) return { state: 'preparing' } as const;

    const names = await liveStaffNames(
      tx,
      ctx.tenantId,
      support.answeredByStaff.map((entry) => entry.userId),
    );
    const answeredByStaff: OwnerSupportStaff[] = support.answeredByStaff.flatMap((entry) => {
      const name = names.get(entry.userId);
      return name === undefined
        ? []
        : [{ userId: entry.userId, name, conversations: entry.conversations }];
    });
    return {
      state: 'ready',
      snapshot,
      awaiting: support.awaiting,
      weeklyMedianMinutes: support.weeklyMedianMinutes,
      weeklyConversations: support.weeklyConversations,
      answeredByStaff,
      bySubject: BY_SUBJECT,
      moderation: support.moderation,
    };
  });
}
