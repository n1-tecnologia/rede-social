import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { mediaAssets, memberships } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';

/**
 * The member sub-budget's two sums (09-06, RESEARCH Open Question 2; FLAGGED FOR THE USER and
 * removable). `service.ts` compares them with `Math.floor(MEDIA_MEMBER_SHARE_OF_CEILING * ceiling)`;
 * this file only measures what member-owned `post` uploads already drew.
 *
 * "Member-owned" is decided by the uploader's CURRENT membership role (`role = 'member'`), not by a
 * column on the asset, so an admin's uploads never count against the members' share and an upload by
 * someone later promoted stops counting. Avatars, covers, stories and attachments are not `post`
 * uploads and are never counted here.
 *
 * Both run inside the caller's admin transaction with the tenant predicate explicit (the admin lane
 * bypasses RLS) and share its soft-quota semantics: read then insert, no row lock.
 *
 * TO DROP THE SUB-BUDGET: delete this file, `MEDIA_MEMBER_SHARE_OF_CEILING` in `limits.ts`, the two
 * blocks marked `member sub-budget` in `service.ts`, and the `EP-17 sub-budget` cases in
 * `apps/api/tests/integration/social-media.test.ts`.
 */
const ownedByAMember = sql`exists (
  select 1 from ${memberships} m
   where m.tenant_id = ${mediaAssets.tenantId}
     and m.user_id = ${mediaAssets.ownerUserId}
     and m.role = 'member')`;

/** Bytes of non-video `post` uploads by members (the Storage budget; same filter as the tenant sum). */
export async function memberPostBytesUsed(tx: Tx, tenantId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${mediaAssets.bytes}), 0)` })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.tenantId, tenantId),
        isNull(mediaAssets.deletedAt),
        eq(mediaAssets.purpose, 'post'),
        sql`${mediaAssets.kind} <> 'video'`,
        ownedByAMember,
      ),
    );
  return Number(row?.total ?? 0);
}

/** Seconds of `post` videos by members (the minutes budget; rejected and failed cost nothing). */
export async function memberPostSecondsUsed(tx: Tx, tenantId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${mediaAssets.durationSeconds}), 0)` })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.tenantId, tenantId),
        isNull(mediaAssets.deletedAt),
        eq(mediaAssets.purpose, 'post'),
        eq(mediaAssets.kind, 'video'),
        notInArray(mediaAssets.status, ['rejected', 'failed']),
        ownedByAMember,
      ),
    );
  return Number(row?.total ?? 0);
}
