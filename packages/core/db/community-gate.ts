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
 *
 * THE COALESCE IS MANDATORY (RESEARCH Pitfall 1): `x <> all ((select app.f()))` parses as the
 * SUBQUERY form of `ALL` and fails with `operator does not exist: uuid <> uuid[]`. Wrapping the
 * scalar subquery in `coalesce(…, '{}'::uuid[])` makes it an array expression and keeps the
 * InitPlan, so the function runs once per statement, never once per row.
 */

/** The lane form, for policies and services: `community_id <> all (${LOCKED_COMMUNITY_IDS})`. */
export const LOCKED_COMMUNITY_IDS: SQL = sql`coalesce((select app.community_locked_ids()), '{}'::uuid[])`;

/** The explicit-user form, for lanes whose claims are not the viewer (the notifications worker). */
export const lockedCommunityIdsFor = (userId: string): SQL =>
  sql`coalesce(app.community_locked_ids_for(${userId}::uuid), '{}'::uuid[])`;

/** `null` when the community is not gated (everyone reads it); else the ids that may. */
export const communityViewerIds = (communityId: string): SQL =>
  sql`app.community_viewer_ids(${communityId}::uuid)`;

/** `true` when the asset is attached only to posts the caller cannot see. */
export const mediaAssetHidden = (assetId: string): SQL =>
  sql`app.media_asset_hidden(${assetId}::uuid)`;
