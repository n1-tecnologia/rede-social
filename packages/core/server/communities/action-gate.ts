import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-tx';

/**
 * The ESCOPO SEAM of Phase 10 (plan 10-05), kernel side: one small function that asks the SQL stub
 * `app.community_action_allowed(community, action)` (plan 10-03) whether the caller's lane may do
 * `action` inside an ORGANIZATION community because of what a buyer's product grants.
 *
 * The per-product action scope that is built after Phase 11 replaces the SQL BODY of that stub and
 * nothing here. Until then the stub answers `false` for every input, so the one caller of this function
 * (the reserved third branch of `resolveCommunityTarget`, feed service) is never taken in Phase 10 and
 * no refusal, read or write changes.
 *
 * Why there is no user id parameter: the SQL function answers about the lane's OWN session (the
 * transaction the caller already runs in), so a caller can never ask about somebody else. Why the
 * result is a strict `=== true`: a null, an empty result, a string or any other truthy value is NOT a
 * yes. The seam fails closed.
 *
 * A post granted this way is stamped with the audience `'community'` (`visibility = 'community'` with
 * the community's id), NEVER `'tenant'`: the 'Administrador' mark of 09 UI-D-509 (OQ-4 of 10-UI-SPEC)
 * must never render on a post that a buyer's product granted.
 */
export const COMMUNITY_ACTIONS = ['like', 'comment', 'share', 'post', 'story'] as const;
export type CommunityAction = (typeof COMMUNITY_ACTIONS)[number];

export async function communityActionAllowed(
  tx: Tx,
  communityId: string,
  action: CommunityAction,
): Promise<boolean> {
  const rows = await tx.execute<{ allowed: boolean | null }>(
    sql`select app.community_action_allowed(${communityId}::uuid, ${action}) as allowed`,
  );
  return rows[0]?.allowed === true;
}
