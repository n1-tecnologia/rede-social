import { type SQL, sql } from 'drizzle-orm';

/**
 * The community gate seam (08.2, STORE-11, COMM-02; RESEARCH Pattern 1). Kernel-owned, the
 * `rls.ts` posture: the kernel NAMES the gate, a module gives it a body, and every consumer (feed
 * policies and services, later stories and the notifications worker) imports ONLY this file.
 *
 * The four SQL functions are declared by the KERNEL migration `*_community_gate_seam.sql` as stubs
 * (every community open, no hidden asset). The store module's `*_store_functions.sql` replaces the
 * first three bodies with `create or replace`, keeping the signatures, so a project that reuses feed
 * without the store keeps the stubs and the gate is a no-op:
 *
 * | Function                                     | Answer                                                        |
 * |----------------------------------------------|---------------------------------------------------------------|
 * | `app.community_locked_ids() uuid[]`          | communities locked for the request lane's user (claims)       |
 * | `app.community_locked_ids_for(uuid) uuid[]`  | the same rule for an explicit user, role read from memberships |
 * | `app.community_viewer_ids(uuid) uuid[]`      | `null` = not gated; else the member-role ids holding access   |
 * | `app.media_asset_hidden(uuid) boolean`       | the asset is attached only to posts hidden from the caller    |
 * | `app.community_action_denied_ids(text) uuid[]` | communities where the caller's product grants lack the action (11.1) |
 *
 * 11.1-02 (D-886, D-887, D-891, D-892): beside the ACCESS answer above, the store module also answers WHAT a buyer
 * may do in a community it unlocks. The union of the five flags of every linked product the caller holds an ACTIVE
 * entitlement for is `app.community_buyer_scope()`; `app.community_action_allowed(community, action)` (the seam of
 * `server/communities/action-gate.ts`) and `app.community_action_denied_ids(action)` (below) are its two wrappers. The
 * kernel declares the denied-ids function as a stub that denies nothing, so a project that reuses feed without the
 * store keeps every community open for like and comment, exactly like the locked-ids stub.
 *
 * THE COALESCE IS MANDATORY (RESEARCH Pitfall 1): `x <> all ((select app.f()))` parses as the
 * SUBQUERY form of `ALL` and fails with `operator does not exist: uuid <> uuid[]`. Wrapping the
 * scalar subquery in `coalesce(…, '{}'::uuid[])` makes it an array expression and keeps the
 * InitPlan, so the function runs once per statement, never once per row.
 */

/** The lane form, for policies and services: `community_id <> all (${LOCKED_COMMUNITY_IDS})`. */
export const LOCKED_COMMUNITY_IDS: SQL = sql`coalesce((select app.community_locked_ids()), '{}'::uuid[])`;

/**
 * 11.1-02 (D-886, D-892): the lane form of the buyer's grant, for the like and comment gates: the ORGANIZATION
 * communities of the caller's tenant that carry a product link and where `action` is NOT held (staff by claim: none;
 * a community with no link: never in the set). Same shape and same MANDATORY coalesce as `LOCKED_COMMUNITY_IDS`:
 * `community_id <> all (${deniedCommunityIds('like')})`, evaluated once per statement as an InitPlan.
 */
export const deniedCommunityIds = (action: 'like' | 'comment'): SQL =>
  sql`coalesce((select app.community_action_denied_ids(${action})), '{}'::uuid[])`;

/** The explicit-user form, for lanes whose claims are not the viewer (the notifications worker). */
export const lockedCommunityIdsFor = (userId: string): SQL =>
  sql`coalesce(app.community_locked_ids_for(${userId}::uuid), '{}'::uuid[])`;

/** `null` when the community is not gated (everyone reads it); else the ids that may. */
export const communityViewerIds = (communityId: string): SQL =>
  sql`app.community_viewer_ids(${communityId}::uuid)`;

/** `true` when the asset is attached only to posts the caller cannot see. */
export const mediaAssetHidden = (assetId: string): SQL =>
  sql`app.media_asset_hidden(${assetId}::uuid)`;
