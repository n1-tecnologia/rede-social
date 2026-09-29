import { normalizeHost, type ResolvedBranding, resolveBranding } from '@rede-social/contracts';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantDomains, tenantInvites, tenants } from '../../db/schema';
import { isPlatformAdmin } from '../platform/platform-admins';
import { membershipForUser } from './membership';
import { resolveTenantHost } from './tenant-host';

/**
 * Which brand an auth e-mail carries (D-37, T-02-24). Lives under `tenancy/` because it opens the
 * admin lane (Biome allows `withAdminTx` only here and under `platform/`).
 *
 * Resolution order — membership first, always:
 *   1. the user's membership → that tenant (D-23: membership is the authority), unless the link
 *      guard below refuses;
 *   2. no membership, `platform_admins` → neutral platform (before any invite lookup, so platform
 *      mails keep working);
 *   3. no membership, a LINK mail, and an open (`pending`/`sent`) `tenant_invites` row for the
 *      address → that tenant (`via: 'invite'`), unless the link guard refuses;
 *   4. no membership, `redirect_to` host resolves to a VERIFIED tenant host → that tenant (a user
 *      with neither membership nor invite, e.g. the hook tests' memberless invitee);
 *   5. otherwise neutral platform.
 *
 * The link guard (quick 260929-g0s, `decideLinkHostRefusal`): a membership/invite tenant that differs
 * from the verified tenant of the `redirect_to` host is REFUSED for every type (`tenant_host_mismatch`
 * — the mail must carry neither brand); and a LINK mail (invite, recovery, signup, email, magiclink,
 * email_change) whose `redirect_to` host is not a verified host of the recipient's tenant is REFUSED
 * too (`redirect_host_not_tenant`). Refusing — never rewriting the host (T-02-26) — makes GoTrue
 * report the failure, so the caller (the `kernel.invite-send` job) retries.
 *
 * Why the guard exists (production, 2026-09-29): GoTrue drops a `redirect_to` its allow-list does
 * not contain yet and falls back to `site_url` (the platform host). At GoTrue's FIRST invite call the
 * invited membership does not exist yet (02-05 inserts it after GoTrue returns), the recipient is
 * not a platform admin and the `site_url` host resolves to no tenant — so the old step "otherwise
 * neutral platform" mailed the first admin a neutral, pathless link on the platform host. Step 3
 * recognises that recipient from the server-side invite row (never from the payload's user-editable
 * `user_metadata`, T-g0s-01) and the guard refuses the fallback link.
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
  | { kind: 'refused'; reason: 'tenant_host_mismatch' | 'redirect_host_not_tenant' };

/** The host part of `redirect_to`, normalised; `null` when it does not parse. */
export function redirectHostOf(redirectTo: string): string | null {
  try {
    return normalizeHost(new URL(redirectTo).hostname);
  } catch {
    return null;
  }
}

/**
 * The pure refusal rule for a recipient that belongs to a tenant (member or open invitee):
 *  - the redirect host resolves (cached) to ANOTHER tenant → `tenant_host_mismatch`, every type;
 *  - a link mail whose redirect host is not a verified host of the recipient's tenant (decided from
 *    the database, `isVerifiedHostOf`) → `redirect_host_not_tenant`;
 *  - otherwise null. `redirectHostVerifiedForRecipient` is what decides, never `hostTenantId === null`
 *    alone: a stale negative entry in the 60 s host cache must never refuse a correct link.
 */
export function decideLinkHostRefusal(input: {
  recipientTenantId: string;
  hostTenantId: string | null;
  linkRequired: boolean;
  redirectHostVerifiedForRecipient: boolean;
}): 'tenant_host_mismatch' | 'redirect_host_not_tenant' | null {
  if (input.hostTenantId !== null && input.hostTenantId !== input.recipientTenantId) {
    return 'tenant_host_mismatch';
  }
  if (input.linkRequired && !input.redirectHostVerifiedForRecipient) {
    return 'redirect_host_not_tenant';
  }
  return null;
}

/**
 * UNCACHED: is `host` a verified host of `tenantId`? `resolveTenantHost` caches negative answers for
 * 60 s per API instance, and the hook request may land on an instance that cached this host while it
 * was still pending — the refusal must rest on the database, not on that cache. Auth mails are low
 * volume, so one indexed read per link mail is fine.
 */
export async function isVerifiedHostOf(tenantId: string, host: string | null): Promise<boolean> {
  if (!host) return false;
  const rows = await withAdminTx((tx) =>
    tx
      .select({ id: tenantDomains.id })
      .from(tenantDomains)
      .where(
        and(
          eq(tenantDomains.tenantId, tenantId),
          eq(tenantDomains.host, host),
          isNotNull(tenantDomains.verifiedAt),
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}

/**
 * The tenant of the newest OPEN first-admin invite for `email` (`pending`, or `sent` — at GoTrue's
 * first call `sendPendingInvites` has already claimed the row as `sent`), or null. Server rows only:
 * the payload's `user_metadata.tenant_slug` is user-editable and is never consulted (T-g0s-01). The
 * column is citext; the value is trimmed and lower-cased like `createPendingInvite` stores it.
 */
export async function openInviteTenantId(email: string): Promise<string | null> {
  const address = email.trim().toLowerCase();
  if (!address) return null;
  const rows = await withAdminTx((tx) =>
    tx
      .select({ tenantId: tenantInvites.tenantId })
      .from(tenantInvites)
      .where(
        and(eq(tenantInvites.email, address), inArray(tenantInvites.status, ['pending', 'sent'])),
      )
      .orderBy(desc(tenantInvites.createdAt))
      .limit(1),
  );
  return rows[0]?.tenantId ?? null;
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

export async function resolveMailTenant(input: {
  userId: string;
  email: string | null;
  redirectTo: string;
  linkRequired: boolean;
}): Promise<MailTenantResolution> {
  const redirectHost = redirectHostOf(input.redirectTo);
  const membership = await membershipForUser(input.userId);
  // VERIFIED hosts only (D-36): an attached-but-unproven domain never selects a brand.
  const hostTenant = redirectHost
    ? await resolveTenantHost(redirectHost)
    : { kind: 'unknown' as const };
  const hostTenantId = hostTenant.kind === 'tenant' ? hostTenant.tenantId : null;

  /** The link guard for a recipient known to belong to `tenantId` (member or open invitee). */
  const refusalFor = async (tenantId: string) =>
    decideLinkHostRefusal({
      recipientTenantId: tenantId,
      hostTenantId,
      linkRequired: input.linkRequired,
      redirectHostVerifiedForRecipient: input.linkRequired
        ? await isVerifiedHostOf(tenantId, redirectHost)
        : false,
    });

  /** The tenant resolution, brand read from the DB (not from the host cache). */
  const tenantResolution = async (
    tenantId: string,
    via: 'membership' | 'invite',
  ): Promise<MailTenantResolution> => {
    const row = await tenantBrandRow(tenantId);
    if (!row) return { kind: 'neutral', via: 'no_tenant' };
    // `status` is carried, not consulted: whether a suspended tenant's user may recover is GoTrue's
    // / 02-08's concern — the brand is still that tenant's (D-32).
    return {
      kind: 'tenant',
      via,
      tenantId,
      slug: row.slug,
      displayName: row.displayName,
      status: row.status,
      branding: resolveBranding(row.branding),
      primaryHost: row.primaryHost ?? null,
    };
  };

  // 1. D-23: membership is the authority.
  if (membership) {
    const refused = await refusalFor(membership.tenantId);
    if (refused) return { kind: 'refused', reason: refused };
    return tenantResolution(membership.tenantId, 'membership');
  }

  // 2. Platform staff get the neutral platform mail.
  if (await isPlatformAdmin(input.userId)) return { kind: 'neutral', via: 'platform_admin' };

  // 3. The first-admin invitee, whose membership 02-05 inserts AFTER GoTrue returns.
  if (input.linkRequired && input.email) {
    const inviteTenantId = await openInviteTenantId(input.email);
    if (inviteTenantId) {
      const refused = await refusalFor(inviteTenantId);
      if (refused) return { kind: 'refused', reason: refused };
      return tenantResolution(inviteTenantId, 'invite');
    }
  }

  // 4. The verified tenant behind the `redirect_to` host.
  if (hostTenant.kind === 'tenant') {
    return {
      kind: 'tenant',
      via: 'redirect_host',
      tenantId: hostTenant.tenantId,
      slug: hostTenant.slug,
      displayName: hostTenant.displayName,
      status: hostTenant.status,
      branding: hostTenant.branding,
      primaryHost: hostTenant.primaryHost,
    };
  }
  // 5.
  return { kind: 'neutral', via: 'no_tenant' };
}
