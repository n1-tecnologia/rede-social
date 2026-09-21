import { avatarUrlFor, type OwnProfile, type UpdateProfileBody } from '@tria/contracts/profiles';
import { eq, sql } from 'drizzle-orm';
import { memberProfiles, memberships, users } from '../../db/schema';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { deleteAsset } from '../media/service';
import { membershipOfRecord } from '../tenancy/membership-scope';

/**
 * The member profile service (PROF-01, TENANT-04) — a PURE TENANT-LANE area.
 *
 * Nothing here opens the privileged lane: `profiles/**` is deliberately absent from the Biome
 * allow-list in `biome.json`, so importing the privileged transaction helper or the privileged
 * Supabase client from this directory fails `pnpm lint`. Every read and write therefore runs under
 * RLS, which is what makes the isolation argument short:
 *   - reads are scoped by `membershipOfRecord(ctx)` (layer 2 of CLAUDE.md's three-layer scoping) —
 *     never by `user_id` alone, so "one missing where" cannot leak a tenant (WR-05);
 *   - the write is scoped by the `member_profiles_self_update` policy, whose `using` AND `with check`
 *     both pin `tenant_id = app.tenant_id() and user_id = app.user_id()`. No id from the request
 *     body or path ever reaches the statement, so no payload can address another member's row
 *     (T-03-12).
 *
 * The one thing that crosses an area boundary is retiring a replaced photo: `deleteAsset` from the
 * media broker (replace-on-write, R-07). Profiles never touches `media_assets` itself.
 *
 * D-46: a rename is free and unrecorded — the value is overwritten, `users.name` is untouched, and
 * there is no approval gate and no history anywhere.
 */

const log = moduleLogger('profiles');

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'> & { requestId?: string };

type ProfileRow = {
  id: string;
  membershipId: string;
  displayName: string;
  bio: string | null;
  avatarAssetId: string | null;
  nudgeDismissedAt: Date | null;
};

/**
 * THE query: the caller's own profile, reached through the membership of record. The join is what
 * makes it layer-2 scoped — `member_profiles` is read via the membership row, never by `user_id`.
 */
async function profileRow(tx: Tx, ctx: Ctx): Promise<ProfileRow | undefined> {
  const [row] = await tx
    .select({
      id: memberProfiles.id,
      membershipId: memberProfiles.membershipId,
      displayName: memberProfiles.displayName,
      bio: memberProfiles.bio,
      avatarAssetId: memberProfiles.avatarAssetId,
      nudgeDismissedAt: memberProfiles.nudgeDismissedAt,
    })
    .from(memberProfiles)
    .innerJoin(memberships, eq(memberships.id, memberProfiles.membershipId))
    .where(membershipOfRecord(ctx))
    .limit(1);
  return row;
}

/**
 * The trigger (`member_profiles_from_membership`) guarantees a row for every membership and the
 * migration backfilled the pre-existing ones, so a missing row is a broken invariant, not a 404.
 */
function requireRow(row: ProfileRow | undefined): ProfileRow {
  if (!row) throw new ApiError(500, 'INTERNAL');
  return row;
}

function ownProfileView(row: ProfileRow, email: string): OwnProfile {
  return {
    membershipId: row.membershipId,
    displayName: row.displayName,
    bio: row.bio,
    avatarAssetId: row.avatarAssetId,
    avatarUrl: avatarUrlFor(row.avatarAssetId),
    email,
    nudgeDismissedAt: row.nudgeDismissedAt ? row.nudgeDismissedAt.toISOString() : null,
    // D-02/R-13: the card shows while EITHER the photo or the bio is missing, and stops for good
    // once the member completes them or says "agora não" (which is server state, not device state).
    needsNudge: (row.avatarAssetId === null || row.bio === null) && row.nudgeDismissedAt === null,
  };
}

async function ownEmail(tx: Tx, ctx: Ctx): Promise<string> {
  const [row] = await tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);
  if (!row) throw new ApiError(500, 'INTERNAL');
  return row.email;
}

/**
 * `bootstrap.membership.profile` (Pitfall 9): EXACTLY the frozen sub-shape, filled from the real
 * row. Takes the caller's transaction so the bootstrap handler stays one round trip — the shape does
 * not grow a field, and new profile facts (the nudge, `avatarAssetId`) live on `GET /v1/me/profile`.
 */
export async function profileForBootstrap(
  tx: Tx,
  ctx: Ctx,
): Promise<{ displayName: string; avatarUrl: string | null; bio: string | null }> {
  const row = requireRow(await profileRow(tx, ctx));
  return {
    displayName: row.displayName,
    avatarUrl: avatarUrlFor(row.avatarAssetId),
    bio: row.bio,
  };
}

/** `GET /v1/me/profile` (PROF-01). */
export async function getOwnProfile(ctx: Ctx): Promise<OwnProfile> {
  return withTenantTx(ctx, async (tx) => {
    const row = requireRow(await profileRow(tx, ctx));
    return ownProfileView(row, await ownEmail(tx, ctx));
  });
}

/**
 * The avatar gate (T-03-13). FOUR facts must hold and the tenant is a fifth supplied by RLS:
 * the asset is an `avatar`, it is the CALLER's own (`owner_user_id`), it is `processing` or `ready`
 * (a `pending` upload has no bytes yet; a `rejected`/`failed`/`deleted` one never will), and it is
 * not soft-deleted. Every failing reason answers the SAME `{ avatarAssetId: 'invalid' }`, so nothing
 * about another member's or another tenant's assets is inferable from the refusal.
 */
async function assertOwnAvatarAsset(tx: Tx, assetId: string): Promise<void> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id from media_assets
     where id = ${assetId}::uuid
       and purpose = 'avatar'
       and owner_user_id = app.user_id()
       and status in ('processing', 'ready')
       and deleted_at is null
     limit 1`);
  if (rows.length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', { avatarAssetId: 'invalid' });
  }
}

/**
 * `PATCH /v1/me/profile` (PROF-01, D-46). A key ABSENT leaves the column alone; a key present with
 * `null` clears it — the distinction is made with `Object.hasOwn`, never with `?? current`, which
 * would make "remove my photo" indistinguishable from "do not touch my photo".
 */
export async function updateOwnProfile(ctx: Ctx, body: UpdateProfileBody): Promise<OwnProfile> {
  const fields: string[] = [];

  const { profile, email, previousAvatarAssetId } = await withTenantTx(ctx, async (tx) => {
    const current = requireRow(await profileRow(tx, ctx));

    const patch: {
      displayName?: string;
      bio?: string | null;
      avatarAssetId?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (Object.hasOwn(body, 'displayName') && body.displayName !== undefined) {
      patch.displayName = body.displayName;
      fields.push('displayName');
    }
    if (Object.hasOwn(body, 'bio')) {
      patch.bio = body.bio ?? null;
      fields.push('bio');
    }

    let previous: string | null = null;
    if (Object.hasOwn(body, 'avatarAssetId')) {
      const next = body.avatarAssetId ?? null;
      if (next !== null) await assertOwnAvatarAsset(tx, next);
      // Replace AND remove both retire the outgoing asset; re-pointing at the same id retires nothing.
      if (current.avatarAssetId !== null && current.avatarAssetId !== next) {
        previous = current.avatarAssetId;
      }
      patch.avatarAssetId = next;
      fields.push('avatarAssetId');
    }

    // The self policy is the scoping: the statement carries the row's OWN id, never one from a body.
    const [updated] = await tx
      .update(memberProfiles)
      .set(patch)
      .where(eq(memberProfiles.id, current.id))
      .returning({
        id: memberProfiles.id,
        membershipId: memberProfiles.membershipId,
        displayName: memberProfiles.displayName,
        bio: memberProfiles.bio,
        avatarAssetId: memberProfiles.avatarAssetId,
        nudgeDismissedAt: memberProfiles.nudgeDismissedAt,
      });

    return {
      profile: requireRow(updated),
      email: await ownEmail(tx, ctx),
      previousAvatarAssetId: previous,
    };
  });

  // R-07 replace-on-write, AFTER the transaction committed: the outgoing asset is soft-deleted so
  // the 03-08 sweeper collects its objects. Best effort — the sweeper is the backstop, so a failure
  // here must never fail a profile edit the member already sees applied.
  if (previousAvatarAssetId) {
    try {
      await deleteAsset(ctx, previousAvatarAssetId);
    } catch (err) {
      log.warn(
        {
          event: 'profiles.avatar_cleanup_failed',
          err,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          requestId: ctx.requestId,
          assetId: previousAvatarAssetId,
        },
        'could not retire the replaced avatar asset',
      );
    }
  }

  // T-03-15: the CHANGED FIELD KEYS only. A bio and a display name are member content and never
  // belong in a log line.
  log.info(
    {
      event: 'profiles.updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      membershipId: profile.membershipId,
      fields,
    },
    'member profile updated',
  );

  return ownProfileView(profile, email);
}

/**
 * `POST /v1/me/profile/dismiss-nudge` (D-02/R-13). `coalesce(nudge_dismissed_at, now())` makes a
 * repeat call a true no-op: the recorded moment is the FIRST refusal, so a second tap from another
 * device cannot move the timestamp.
 */
export async function dismissNudge(ctx: Ctx): Promise<OwnProfile> {
  return withTenantTx(ctx, async (tx) => {
    const current = requireRow(await profileRow(tx, ctx));
    await tx.execute(sql`
      update member_profiles
         set nudge_dismissed_at = coalesce(nudge_dismissed_at, now()),
             updated_at = now()
       where id = ${current.id}::uuid`);
    const row = requireRow(await profileRow(tx, ctx));
    return ownProfileView(row, await ownEmail(tx, ctx));
  });
}
