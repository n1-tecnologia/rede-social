import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { membershipOfRecord } from '../server/tenancy/membership-scope';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

const render = () => new PgDialect().sqlToQuery(membershipOfRecord({ tenantId, userId }));

/**
 * WR-05 / CLAUDE.md three-layer tenant scoping: the bootstrap's membership read must carry the
 * explicit tenant predicate (layer 2) — never rely on the V1 one-tenant-per-user index alone.
 */
describe('membershipOfRecord — the caller membership in the tenant of record', () => {
  it('1. renders tenant_id, user_id AND deleted_at is null, with both ids as params', () => {
    const q = render();
    expect(q.sql).toContain('"memberships"."tenant_id" = $1');
    expect(q.sql).toContain('"memberships"."user_id" = $2');
    expect(q.sql).toContain('"memberships"."deleted_at" is null');
    expect(q.params).toEqual([tenantId, userId]);
  });

  it('2. never degrades to user-only scoping', () => {
    const q = render();
    expect(q.sql).not.toMatch(/^\(?"memberships"\."user_id" = \$1\)?$/);
    expect(q.params).toHaveLength(2);
  });
});
