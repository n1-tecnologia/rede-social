import { isIP } from 'node:net';
import { PLATFORM_TERMS_VERSION } from '@rede-social/contracts';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { consentRecords, memberships, tenantInvites, tenants, users } from '../../db/schema';
import { ApiError } from '../http/api-error';
import { type Logger, moduleLogger } from '../logging';

export type AcceptInviteInput = {
  /** The verified Bearer's subject — never a body-supplied id (T-02-120). */
  userId: string;
  /** The caller's membership tenant, as `requireAuth` resolved it (D-23). */
  tenantId: string;
  rulesVersion: number;
  termsVersion: number;
  /** From `X-Client-IP`, set by the web server action only. Stored as `inet` when valid. */
  ip: string | null;
  userAgent: string | null;
  /** The request's child logger, so `invite.*` lines carry `requestId`. */
  logger?: Logger;
};

export type AcceptInviteResult = {
  tenantSlug: string;
  /** `already_active`: an idempotent replay — nothing was written. */
  outcome: 'accepted' | 'already_active';
};

/** Only a syntactically valid address reaches the `inet` column; anything else is stored as null. */
const asInet = (value: string | null): string | null =>
  value && isIP(value.trim()) !== 0 ? value.trim() : null;

/**
 * The first admin accepts the invite (ROLE-03, D-29, D-03). AUTH-04 is NOT skipped for admins: the
 * two consents are recorded exactly like a member sign-up, and the membership only becomes `active`
 * together with them. Runs in the admin lane because it is a member-lifecycle write on a row the
 * tenant lane's policies never let a member flip (`memberships`, `consent_records`, `tenant_invites`).
 *
 * ONE transaction, in order:
 *   (a) the tenant's slug + `rules_version` (a missing tenant is a broken invariant → 500);
 *   (b) stale versions are refused BEFORE any write — a recorded consent must point at the text the
 *       person actually read (400 VALIDATION_FAILED `{ consents: 'stale' }`, same rule as sign-up);
 *   (c) `update memberships set status='active', joined_at=now() where … status='invited' returning`
 *       — the row lock on the membership is what serialises two concurrent accepts: exactly one
 *       flip happens, the other sees zero rows;
 *   (d) zero rows: an already-active membership answers `already_active` and writes NOTHING (an
 *       idempotent replay — the consents were recorded by the call that flipped); anything else
 *       (no row, blocked) is 409 INVITE_STATE_INVALID `{ reason: 'not_invited' }`;
 *   (e) one row: both consent rows, `accepted_at` from the DATABASE clock, `onConflictDoNothing` on
 *       the `(tenant, user, kind, version)` unique index as the last line of defence;
 *   (f) the tenant's invite row(s) for this identity (by `user_id`, or by citext e-mail when the
 *       `user_id` back-reference was never set) flip to `accepted`.
 *
 * Nothing about passwords exists here: the web action set it through Supabase before calling the
 * API (D-29/D-10), and this module never talks to GoTrue. Never acts on a membership other than
 * the caller's own — both ids come from the verified request context.
 */
export async function acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult> {
  const { userId, tenantId, userAgent } = input;
  const ip = asInet(input.ip);
  const log = input.logger
    ? input.logger.child({ name: 'accept-invite' })
    : moduleLogger('accept-invite');

  const result = await withAdminTx(async (tx) => {
    // (a)
    const [tenant] = await tx
      .select({ slug: tenants.slug, rulesVersion: tenants.rulesVersion })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) throw new ApiError(500, 'INTERNAL');

    // (b)
    if (
      input.rulesVersion !== tenant.rulesVersion ||
      input.termsVersion !== PLATFORM_TERMS_VERSION
    ) {
      throw new ApiError(400, 'VALIDATION_FAILED', { consents: 'stale' });
    }

    // (c)
    const now = new Date();
    const flipped = await tx
      .update(memberships)
      .set({ status: 'active', joinedAt: now })
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.userId, userId),
          eq(memberships.status, 'invited'),
          isNull(memberships.deletedAt),
        ),
      )
      .returning({ id: memberships.id });

    // (d)
    if (flipped.length === 0) {
      const [current] = await tx
        .select({ status: memberships.status })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, tenantId),
            eq(memberships.userId, userId),
            isNull(memberships.deletedAt),
          ),
        )
        .limit(1);
      if (current?.status === 'active') {
        return { tenantSlug: tenant.slug, outcome: 'already_active' as const, inviteId: null };
      }
      throw new ApiError(409, 'INVITE_STATE_INVALID', { reason: 'not_invited' });
    }

    // (e) — `accepted_at` is the column default (DB clock), never a client value.
    await tx
      .insert(consentRecords)
      .values([
        { tenantId, userId, kind: 'tenant_rules', textVersion: tenant.rulesVersion, ip, userAgent },
        {
          tenantId,
          userId,
          kind: 'platform_terms',
          textVersion: PLATFORM_TERMS_VERSION,
          ip,
          userAgent,
        },
      ])
      .onConflictDoNothing();

    // (f)
    const [user] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const accepted = await tx
      .update(tenantInvites)
      .set({ status: 'accepted', acceptedAt: now, userId })
      .where(
        and(
          eq(tenantInvites.tenantId, tenantId),
          ne(tenantInvites.status, 'accepted'),
          user
            ? or(eq(tenantInvites.userId, userId), eq(tenantInvites.email, user.email))
            : eq(tenantInvites.userId, userId),
        ),
      )
      .returning({ id: tenantInvites.id });

    return {
      tenantSlug: tenant.slug,
      outcome: 'accepted' as const,
      inviteId: accepted[0]?.id ?? null,
    };
  });

  log.info(
    {
      event: 'invite.accepted',
      tenantId,
      userId,
      inviteId: result.inviteId,
      outcome: result.outcome,
    },
    result.outcome === 'accepted' ? 'invite accepted' : 'invite accept replayed (already active)',
  );

  return { tenantSlug: result.tenantSlug, outcome: result.outcome };
}
