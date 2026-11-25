import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-tx';

/**
 * The ESCOPO SEAM of Phase 10 (plan 10-05), live since 11.1-02: one small function that asks the SQL function
 * `app.community_action_allowed(community, action)` whether the caller's lane may do `action` inside an
 * ORGANIZATION community because of what a buyer's product grants (D-880, D-886).
 *
 * The answer is the union over the caller's ACTIVE entitlements of the five flags on the product-to-community link
 * (`app.community_buyer_scope()`, `*_buyer_permissions_functions.sql`). It is true only for the five names like,
 * comment, share, post and story and only for a member lane; staff, a community with no linked product, a
 * member-created community, another tenant's community and a revoked entitlement are never granted by it. Before
 * 11.1-02 the body was a constant `false` (the stub of `*_member_communities_functions.sql`).
 *
 * Why there is no user id parameter: the SQL function answers about the lane's OWN session (the transaction the
 * caller already runs in), so a caller can never ask about somebody else. Why the result is a strict `=== true`: a
 * null, an empty result, a string or any other truthy value is NOT a yes. The seam fails closed.
 *
 * A post granted this way is stamped with the audience `'community'` (`visibility = 'community'` with the
 * community's id), NEVER `'tenant'`: the 'Administrador' mark of 09 UI-D-509 (OQ-4 of 10-UI-SPEC) must never render
 * on a post that a buyer's product granted.
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
