import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { memberships } from '../../db/schema';

/**
 * The ONE where-clause for "the caller's membership in the tenant of record" (WR-05).
 *
 * Layer 2 of CLAUDE.md's three-layer tenant scoping: layer 1 is `app.membership_for_user()` in
 * `requireAuth` (it picked `ctx.tenantId`), layer 3 is RLS (`tenant_id = app.tenant_id()`). This
 * clause is the explicit predicate in between — `tenant_id = ctx.tenantId AND user_id = ctx.userId
 * AND deleted_at IS NULL` — so a read of `memberships` never depends on the V1 one-tenant-per-user
 * index (`memberships_one_tenant_per_user_v1`) to pick the row: the day that index is dropped for V2
 * multi-tenant membership, the bootstrap still answers the membership of the tenant of record.
 *
 * `deleted_at is null` mirrors the lookup function's lifecycle rule (migration
 * 20260914171114_membership_lookup_lifecycle): a soft-deleted membership is gone for every reader.
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
