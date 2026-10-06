import { normalizeHost, type ResolvedBranding, resolveBranding } from '@rede-social/contracts';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantDomains, tenantInvites, tenants } from '../../db/schema';
import { isLinkActionType } from '../mail/templates/neutral';
import { isPlatformAdmin } from '../platform/platform-admins';
import { membershipInTenant, membershipsOfUser } from './membership';

/**
 * Which brand an auth e-mail carries — by the community the flow STARTED ON (D-315), recovery
 * included for a person who is only joining it (D-317). Lives under `tenancy/` because it opens the
 * admin lane (Biome allows `withAdminTx` only here and under `platform/`).
 *
 * H is the tenant whose VERIFIED host is the `redirect_to` host, read uncached from `tenant_domains`
 * (`verifiedTenantIdForHost`): the 60 s host cache could hold a stale positive or negative entry,
 * and a stale entry must neither brand nor refuse a mail. Auth mails are low volume.
 *
 * The decision (`decideMailTenant`, pure, rows in order):
 *   1. a platform admin → neutral (platform mails keep working, tests 8/16);
 *   2. H and a non-deleted membership of the identity in H (any status) → brand H (`membership`);
 *   3. H and an open (`pending`/`sent`) invite FOR H to this e-mail or user → brand H (`invite`) —
 *      never "the newest invite by e-mail" (RESEARCH Pitfall 7);
 *   4. H and action type `recovery` → brand H (`redirect_host`, D-317): the requester never sees the
 *      mail, the form's answer is constant (D-10) and the link returns to H, so the person can finish
 *      joining H (D-303);
 *   5. H and any other link type → refused `redirect_host_not_member` (D-315);
 *   6. H and a non-link type → neutral (a code-only mail tied to H must not wear another brand);
 *   7. no H and a link type while the identity has a membership or an open invite anywhere → refused
 *      `redirect_host_not_tenant` (D-23 kept for hostless link mails: GoTrue's `site_url` fallback,
 *      localhost, an unverified domain — tests 13/15);
 *   8. no H and a non-link type → the brand of the identity's ONLY membership when it has exactly
 *      one, else neutral;
 *   9. otherwise neutral.
 *
 * Refusing — never rewriting the host (T-02-26) — makes GoTrue report the failure, so the caller
 * (the `kernel.invite-send` job) retries. No row of the table brands a mail by "the oldest
 * membership" (D-37 refined): the brand comes only from H, or, hostless and non-link, from the
 * single membership. Server rows only: the payload's user-editable `user_metadata` is never read
 * (T-g0s-01).
 */
export type MailTenantResolution =
  | {
      kind: 'tenant';
      via: 'membership' | 'invite' | 'redirect_host';
      tenantId: string;
      slug: string;
      displayName: string;
      status: string;
      branding: ResolvedBranding;
      primaryHost: string | null;
    }
  | { kind: 'neutral'; via: 'platform_admin' | 'no_tenant' }
  | { kind: 'refused'; reason: 'redirect_host_not_member' | 'redirect_host_not_tenant' };

/**
 * The pre-read facts `decideMailTenant` decides from. `belongsSomewhere` = at least one non-deleted
 * membership or one open invite anywhere; `onlyMembershipTenantId` = the tenant when the identity
 * has exactly one non-deleted membership. Facts a row cannot reach may be left at their empty value
 * (`resolveMailTenant` reads the host-side facts only with an H and the identity-wide ones only
 * without one).
 */
export type MailTenantFacts = {
  isPlatformAdmin: boolean;
  hostTenantId: string | null;
  hasMembershipInHost: boolean;
  hasOpenInviteInHost: boolean;
  actionType: string;
  linkRequired: boolean;
  belongsSomewhere: boolean;
  onlyMembershipTenantId: string | null;
};

export type MailTenantDecision =
  | { kind: 'tenant'; tenantId: string; via: 'membership' | 'invite' | 'redirect_host' }
  | { kind: 'neutral'; via: 'platform_admin' | 'no_tenant' }
  | { kind: 'refused'; reason: 'redirect_host_not_member' | 'redirect_host_not_tenant' };

/** The D-315 / D-317 decision table, rows 1-9 in order (see the file comment). Pure. */
export function decideMailTenant(facts: MailTenantFacts): MailTenantDecision {
  // 1.
  if (facts.isPlatformAdmin) return { kind: 'neutral', via: 'platform_admin' };
  const host = facts.hostTenantId;
  if (host !== null) {
    // 2.
    if (facts.hasMembershipInHost) return { kind: 'tenant', tenantId: host, via: 'membership' };
    // 3.
    if (facts.hasOpenInviteInHost) return { kind: 'tenant', tenantId: host, via: 'invite' };
    // 4. D-317.
    if (facts.actionType === 'recovery') {
      return { kind: 'tenant', tenantId: host, via: 'redirect_host' };
    }
    // 5.
    if (facts.linkRequired) return { kind: 'refused', reason: 'redirect_host_not_member' };
    // 6.
    return { kind: 'neutral', via: 'no_tenant' };
  }
  // 7.
  if (facts.linkRequired && facts.belongsSomewhere) {
    return { kind: 'refused', reason: 'redirect_host_not_tenant' };
  }
  // 8.
  if (!facts.linkRequired && facts.onlyMembershipTenantId !== null) {
    return { kind: 'tenant', tenantId: facts.onlyMembershipTenantId, via: 'membership' };
  }
  // 9.
  return { kind: 'neutral', via: 'no_tenant' };
}

/** The host part of `redirect_to`, normalised; `null` when it does not parse. */
export function redirectHostOf(redirectTo: string): string | null {
  try {
    return normalizeHost(new URL(redirectTo).hostname);
  } catch {
    return null;
  }
}

/**
 * UNCACHED: the tenant whose VERIFIED host is `host` (`verified_at is not null`), or null — an
 * attached-but-unproven domain is no tenant host (D-36). Never the 60 s `resolveTenantHost` cache.
 */
export async function verifiedTenantIdForHost(host: string | null): Promise<string | null> {
  if (!host) return null;
  const rows = await withAdminTx((tx) =>
    tx
      .select({ tenantId: tenantDomains.tenantId })
      .from(tenantDomains)
      .where(and(eq(tenantDomains.host, host), isNotNull(tenantDomains.verifiedAt)))
      .limit(1),
  );
  return rows[0]?.tenantId ?? null;
}

const OPEN_INVITE = ['pending', 'sent'];

/** The `tenant_invites` match for this person: the citext e-mail (trimmed, lower-cased) or the user. */
function inviteeMatch(email: string | null, userId: string) {
  const address = email?.trim().toLowerCase() ?? '';
  return address
    ? or(eq(tenantInvites.email, address), eq(tenantInvites.userId, userId))
    : eq(tenantInvites.userId, userId);
}

/**
 * Is there an OPEN (`pending`, or `sent` — at GoTrue's first call `sendPendingInvites` has already
 * claimed the row) invite of `tenantId` for this e-mail or user? Asked FOR H only, so two open
 * invites in two tenants can never brand a mail with the wrong one (Pitfall 7).
 */
export async function hasOpenInviteIn(
  tenantId: string,
  email: string | null,
  userId: string,
): Promise<boolean> {
  const rows = await withAdminTx((tx) =>
    tx
      .select({ id: tenantInvites.id })
      .from(tenantInvites)
      .where(
        and(
          eq(tenantInvites.tenantId, tenantId),
          inArray(tenantInvites.status, OPEN_INVITE),
          inviteeMatch(email, userId),
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}

/** Is there an open invite in ANY tenant for this e-mail or user (row 7's `belongsSomewhere`)? */
async function hasOpenInviteAnywhere(email: string | null, userId: string): Promise<boolean> {
  const rows = await withAdminTx((tx) =>
    tx
      .select({ id: tenantInvites.id })
      .from(tenantInvites)
      .where(and(inArray(tenantInvites.status, OPEN_INVITE), inviteeMatch(email, userId)))
      .limit(1),
  );
  return rows.length > 0;
}

/** ONE admin-lane select: the tenant row plus its verified primary host (for the logo URL). */
async function tenantBrandRow(tenantId: string) {
  return withAdminTx(async (tx) => {
    const rows = await tx
      .select({
        slug: tenants.slug,
        displayName: tenants.displayName,
        status: tenants.status,
        branding: tenants.branding,
        primaryHost: tenantDomains.host,
      })
      .from(tenants)
      .leftJoin(
        tenantDomains,
        and(
          eq(tenantDomains.tenantId, tenants.id),
          eq(tenantDomains.isPrimary, true),
          isNotNull(tenantDomains.verifiedAt),
        ),
      )
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Gathers the facts for `decideMailTenant` and, for a `tenant` decision, reads that tenant's brand.
 * The host-side facts (membership in H, open invite for H) are read only when there is an H, the
 * identity-wide ones (every membership, any open invite) only when there is none.
 */
export async function resolveMailTenant(input: {
  userId: string;
  email: string | null;
  redirectTo: string;
  actionType: string;
}): Promise<MailTenantResolution> {
  const hostTenantId = await verifiedTenantIdForHost(redirectHostOf(input.redirectTo));
  const facts: MailTenantFacts = {
    isPlatformAdmin: await isPlatformAdmin(input.userId),
    hostTenantId,
    hasMembershipInHost: false,
    hasOpenInviteInHost: false,
    actionType: input.actionType,
    linkRequired: isLinkActionType(input.actionType),
    belongsSomewhere: false,
    onlyMembershipTenantId: null,
  };
  if (!facts.isPlatformAdmin) {
    if (hostTenantId !== null) {
      facts.hasMembershipInHost = (await membershipInTenant(input.userId, hostTenantId)) !== null;
      if (!facts.hasMembershipInHost) {
        facts.hasOpenInviteInHost = await hasOpenInviteIn(hostTenantId, input.email, input.userId);
      }
    } else {
      const memberships = await membershipsOfUser(input.userId);
      const [only] = memberships;
      facts.onlyMembershipTenantId = memberships.length === 1 && only ? only.tenantId : null;
      facts.belongsSomewhere =
        memberships.length > 0 || (await hasOpenInviteAnywhere(input.email, input.userId));
    }
  }

  const decision = decideMailTenant(facts);
  if (decision.kind !== 'tenant') return decision;

  const row = await tenantBrandRow(decision.tenantId);
  if (!row) return { kind: 'neutral', via: 'no_tenant' };
  // `status` is carried, not consulted: whether a suspended tenant's user may recover is GoTrue's /
  // 02-08's concern — the brand is still that tenant's (D-32).
  return {
    kind: 'tenant',
    via: decision.via,
    tenantId: decision.tenantId,
    slug: row.slug,
    displayName: row.displayName,
    status: row.status,
    branding: resolveBranding(row.branding),
    primaryHost: row.primaryHost ?? null,
  };
}
