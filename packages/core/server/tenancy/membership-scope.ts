import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { memberships } from '../../db/schema';

/**
 * The ONE where-clause for "the caller's membership in the tenant of record" (WR-05).
 *
 * Layer 2 of CLAUDE.md's three-layer tenant scoping: layer 1 is the host-selected lookup in
 * `requireAuth` (`app.membership_in_tenant`, or `app.memberships_of_user` plus the D-308 choice rule
 * on a non-tenant host — it picked `ctx.tenantId`), layer 3 is RLS (`tenant_id = app.tenant_id()`).
 * This clause is the explicit predicate in between — `tenant_id = ctx.tenantId AND user_id =
 * ctx.userId AND deleted_at IS NULL`. Since 08.1 an identity holds one membership per tenant in any
 * number of tenants (`memberships_tenant_user_uq` is the only uniqueness), so `user_id` alone would
 * match several rows: the tenant predicate is what picks the membership the host selected (D-307).
 *
 * `deleted_at is null` mirrors the lookup functions' lifecycle rule (migrations
 * 20260914171114_membership_lookup_lifecycle, 20261006195913_multi_tenant_identity_lookups): a
 * soft-deleted membership is gone for every reader.
 *
 * Reuse it in every tenant-lane read of `memberships` (profile, members directory, …) — never scope
 * by `user_id` alone ("one missing `where` leaks tenants").
 */
export function membershipOfRecord(ctx: { tenantId: string; userId: string }): SQL {
  const clause = and(
    eq(memberships.tenantId, ctx.tenantId),
    eq(memberships.userId, ctx.userId),
    isNull(memberships.deletedAt),
  );
  // `and()` is typed `SQL | undefined` (empty input); three operands can never yield undefined.
  if (!clause) throw new Error('membershipOfRecord: empty clause');
  return clause;
}
