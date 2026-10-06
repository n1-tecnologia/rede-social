import { isIP } from 'node:net';
import { normalizeHost, PLATFORM_TERMS_VERSION } from '@rede-social/contracts';
import type { JoinBody, JoinResponse, JoinState } from '@rede-social/contracts/join';
import { and, eq } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import {
  consentRecords,
  memberProfiles,
  memberships,
  platformAdmins,
  tenants,
  users,
} from '../../db/schema';
import { env } from '../env';
import { ApiError } from '../http/api-error';
import { type Logger, moduleLogger } from '../logging';
import { getTenantIdBySlug } from './public-tenant';
import type { TenantHostResolution } from './tenant-host';

/**
 * Joining a community with an identity that already exists (08.1, V2-PLAT-07, D-305, D-306). Both
 * functions run in the ADMIN lane because they read and write rows the tenant lane never may
 * (`memberships` is SELECT-only there, `platform_admins` has no tenant policy at all), so the explicit
 * guards below are the only isolation: every statement names the ONE tenant the request is about and
 * the caller's own `userId` from the verified Bearer — never a body-supplied id.
 *
 * Nothing here ever reads, counts or names another community the identity belongs to (D-302, D-309):
 * the answers and the log lines carry the acted-on tenant only.
 */

export type JoinStateInput = {
  /** The verified Bearer's subject (`requireIdentity`). */
  userId: string;
  host: string | null;
  hostTenant: TenantHostResolution;
};

export type JoinTenantInput = JoinStateInput & {
  body: JoinBody;
  /** From `X-Client-IP`, set by the web server action only. Stored as `inet` when valid. */
  ip: string | null;
  userAgent: string | null;
  /** The request's child logger, so `join.*` lines carry `requestId`. */
  logger?: Logger;
};

/** Only a syntactically valid address reaches the `inet` column; anything else is stored as null. */
const asInet = (value: string | null): string | null =>
  value && isIP(value.trim()) !== 0 ? value.trim() : null;

/**
 * `GET /v1/join/state`: exactly one fact about the HOST's community for the caller. Only a tenant host
 * has a community to ask about — `/participar` is reached through TENANT_HOST_MISMATCH, which only a
 * tenant host produces — so any other host is 404 NOT_FOUND.
 *
 * Read in one admin-lane transaction, in order: the tenant suspended -> `suspended` (D-32); a
 * `platform_admins` row -> `platform_admin` (D-316); then the `(tenant, user)` membership row: none ->
 * `joinable`, soft-deleted -> `removed`, blocked (`blocked_at` or status) -> `blocked` (D-304),
 * `invited` -> `invited` (D-29), `active` -> `member`. The tenant's status is read from the row, not
 * from the 60 s host cache.
 */
export async function joinState(input: JoinStateInput): Promise<{ state: JoinState }> {
  const { userId, hostTenant } = input;
  if (hostTenant.kind !== 'tenant') throw new ApiError(404, 'NOT_FOUND');
  const tenantId = hostTenant.tenantId;

  const state = await withAdminTx<JoinState>(async (tx) => {
    const [tenant] = await tx
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) throw new ApiError(404, 'NOT_FOUND');
    if (tenant.status === 'suspended') return 'suspended';

    const [admin] = await tx
      .select({ userId: platformAdmins.userId })
      .from(platformAdmins)
      .where(eq(platformAdmins.userId, userId))
      .limit(1);
    if (admin) return 'platform_admin';

    const [row] = await tx
      .select({
        status: memberships.status,
        blockedAt: memberships.blockedAt,
        deletedAt: memberships.deletedAt,
      })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
      .limit(1);
    if (!row) return 'joinable';
    if (row.deletedAt) return 'removed';
    if (row.blockedAt || row.status === 'blocked') return 'blocked';
    if (row.status === 'invited') return 'invited';
    return 'member';
  });

  return { state };
}

/**
 * `POST /v1/join`: the caller becomes an active `member` of ONE community, with the name typed on
 * `/participar` and both consents, or nothing is written. The password was already proven by GoTrue
 * in the web tier (the session's Bearer); the API never sees it.
 *
 * Which community, before the transaction:
 *   - a verified tenant host decides, and `body.slug` is ignored there (D-22 parity with sign-up);
 *   - the platform host (`PLATFORM_HOST`) serves no community: 404 NOT_FOUND (D-21);
 *   - any other host (localhost, Preview) takes `body.slug`; absent, unknown or suspended -> 404
 *     TENANT_NOT_FOUND (the `getTenantIdBySlug` sign-up precedent).
 *
 * Then ONE admin-lane transaction, guards in order:
 *   (a) the tenant row; suspended -> 403 TENANT_SUSPENDED `{ tenantName }` of THIS tenant only;
 *   (b) a `platform_admins` row -> 403 FORBIDDEN, no details: platform accounts never join (D-316);
 *   (c) consent versions differing from `tenants.rules_version` / `PLATFORM_TERMS_VERSION` -> 400
 *       VALIDATION_FAILED `{ consents: 'stale' }` BEFORE any write;
 *   (d) the existing `(tenant, user)` row, `for update`: soft-deleted -> 403 FORBIDDEN (never revived,
 *       RESEARCH Pitfall 9: the unique index covers deleted rows); blocked (`blocked_at` or status) ->
 *       403 MEMBERSHIP_BLOCKED `{ tenantName }` (D-304: re-joining a community that blocked you is
 *       refused, and a block elsewhere never shows here); `invited` -> 409 INVITE_STATE_INVALID
 *       `{ reason: 'invite_pending' }` (D-29: accept the invite instead); active -> `already_member`,
 *       writing nothing;
 *   (e) the `public.users` mirror exists (the sign-up precedent; a missing one is a broken invariant);
 *   (f) `insert … (member, active) on conflict (tenant_id, user_id) do nothing returning id`. Zero rows
 *       means a concurrent join committed first (`memberships_tenant_user_uq`): answer
 *       `already_member` and write nothing else, so the race leaves one membership and two consents;
 *   (g) the `member_profiles` row the membership trigger just created gets the typed name (D-311: the
 *       new profile starts from this name and nothing from another community);
 *   (h) both `consent_records` rows with `ip` / `userAgent`, `onConflictDoNothing` as the last line of
 *       defence on the `(tenant, user, kind, version)` unique index.
 *
 * The log line after the transaction carries `{ tenantId, userId, outcome }` only — never an e-mail,
 * never another tenant's id (D-302).
 */
export async function joinTenant(input: JoinTenantInput): Promise<JoinResponse> {
  const { userId, host, hostTenant, body, userAgent } = input;
  const ip = asInet(input.ip);
  const log = input.logger ? input.logger.child({ name: 'join' }) : moduleLogger('join');

  let tenantId: string;
  if (hostTenant.kind === 'tenant') {
    tenantId = hostTenant.tenantId;
  } else {
    const platformHost = normalizeHost(env.PLATFORM_HOST);
    if (platformHost && host === platformHost) throw new ApiError(404, 'NOT_FOUND');
    if (!body.slug) throw new ApiError(404, 'TENANT_NOT_FOUND');
    tenantId = await getTenantIdBySlug(body.slug);
  }

  const result = await withAdminTx<JoinResponse>(async (tx) => {
    // (a)
    const [tenant] = await tx
      .select({
        slug: tenants.slug,
        displayName: tenants.displayName,
        status: tenants.status,
        rulesVersion: tenants.rulesVersion,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) throw new ApiError(404, 'TENANT_NOT_FOUND');
    if (tenant.status === 'suspended') {
      throw new ApiError(403, 'TENANT_SUSPENDED', { tenantName: tenant.displayName });
    }

    // (b)
    const [admin] = await tx
      .select({ userId: platformAdmins.userId })
      .from(platformAdmins)
      .where(eq(platformAdmins.userId, userId))
      .limit(1);
    if (admin) throw new ApiError(403, 'FORBIDDEN');

    // (c)
    if (
      body.consents.tenantRulesVersion !== tenant.rulesVersion ||
      body.consents.platformTermsVersion !== PLATFORM_TERMS_VERSION
    ) {
      throw new ApiError(400, 'VALIDATION_FAILED', { consents: 'stale' });
    }

    // (d)
    const [existing] = await tx
      .select({
        status: memberships.status,
        blockedAt: memberships.blockedAt,
        deletedAt: memberships.deletedAt,
      })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
      .limit(1)
      .for('update');
    if (existing) {
      if (existing.deletedAt) throw new ApiError(403, 'FORBIDDEN');
      if (existing.blockedAt || existing.status === 'blocked') {
        throw new ApiError(403, 'MEMBERSHIP_BLOCKED', { tenantName: tenant.displayName });
      }
      if (existing.status === 'invited') {
        throw new ApiError(409, 'INVITE_STATE_INVALID', { reason: 'invite_pending' });
      }
      return { outcome: 'already_member', tenantSlug: tenant.slug };
    }

    // (e)
    const [mirrored] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!mirrored) throw new Error(`public.users row missing for ${userId}`);

    // (f)
    const inserted = await tx
      .insert(memberships)
      .values({ tenantId, userId, role: 'member', status: 'active' })
      .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })
      .returning({ id: memberships.id });
    const membershipId = inserted[0]?.id;
    if (!membershipId) return { outcome: 'already_member', tenantSlug: tenant.slug };

    // (g)
    const named = await tx
      .update(memberProfiles)
      .set({ displayName: body.name })
      .where(
        and(eq(memberProfiles.membershipId, membershipId), eq(memberProfiles.tenantId, tenantId)),
      )
      .returning({ id: memberProfiles.membershipId });
    if (named.length !== 1) throw new Error(`member_profiles row missing for ${membershipId}`);

    // (h) — `accepted_at` is the column default (DB clock), never a client value.
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

    return { outcome: 'joined', tenantSlug: tenant.slug };
  });

  log.info(
    {
      event: result.outcome === 'joined' ? 'join.created' : 'join.replayed',
      tenantId,
      userId,
      outcome: result.outcome,
    },
    result.outcome === 'joined' ? 'membership joined' : 'join replayed (already a member)',
  );

  return result;
}
