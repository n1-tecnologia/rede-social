import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { type OwnerOverviewAnswer, overviewPayloadSchema } from '../contracts/index';
import { readMembersPayload } from './members';
import { readLatestSnapshot, snapshotMetaOf } from './snapshot';

/**
 * `GET /v1/dashboard/owner/overview` (08.7-01, D-464, INSIGHT-06, INSIGHT-07): the Visão geral of
 * the tenant's newest snapshot, read in the admin's own lane (one transaction, RLS admin-only).
 *
 * - No row → `{ state: 'preparing' }` (EP-15): never a 404, never zeros, no number key at all. The
 *   read has no side effect (it never enqueues a build); the hourly dispatcher covers it.
 * - A row whose `overview` key is missing or fails its contract (planning decision 3) → the same
 *   `preparing`: the API never compares versions, it parses what it serves.
 * - 08.7-02: the ready answer also carries the engaged share's inputs and the interacting trend
 *   (`engagement`, `previousEngagement`, `actions30`, `activeMembers30`, `weeklyInteracting`) from
 *   the snapshot's `members` key; while that key is missing or invalid the overview is `preparing`.
 * - Otherwise `{ state: 'ready', snapshot, members, … }`: raw integers only, the web derives the chips.
 */
export async function getOwnerOverview(
  ctx: Pick<RequestContext, 'userId' | 'tenantId' | 'role'>,
): Promise<OwnerOverviewAnswer> {
  return withTenantTx(ctx, (tx) => readOverview(tx, ctx.tenantId));
}

async function readOverview(tx: Tx, tenantId: string): Promise<OwnerOverviewAnswer> {
  const row = await readLatestSnapshot(tx, tenantId);
  if (!row) return { state: 'preparing' };
  const snapshot = snapshotMetaOf(row);
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const overview = overviewPayloadSchema.safeParse(payload.overview);
  const members = readMembersPayload(payload);
  if (!snapshot || !overview.success || !members) return { state: 'preparing' };
  return {
    state: 'ready',
    snapshot,
    members: overview.data.members,
    engagement: members.engagement,
    previousEngagement: members.previousEngagement,
    actions30: members.actions30,
    activeMembers30: members.activeMembers30,
    weeklyInteracting: members.weeklyInteracting,
  };
}
