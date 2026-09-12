import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { RequestContext } from '../server/auth/context';
import { db } from './client';
import type * as schema from './schema';

export type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Tenant lane (TENANT-03): every tenant-scoped query runs inside ONE transaction that injects the claims
 * RLS reads and switches to the `authenticated` role for that transaction only. Both settings are LOCAL,
 * so they die with the transaction before Supavisor hands the connection to the next request.
 */
export async function withTenantTx<T>(
  ctx: Pick<RequestContext, 'userId' | 'tenantId' | 'role'>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({
      sub: ctx.userId,
      role: 'authenticated',
      tenant_id: ctx.tenantId,
      tenant_role: ctx.role,
    });
    // Bound parameter + is_local=true: never string-interpolated, never session-scoped.
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

/**
 * Admin lane: `service_role` bypasses RLS for this transaction only. Importable ONLY from
 * `packages/core/server/{tenancy,platform}` and `scripts/` (Biome `noRestrictedImports`).
 */
export async function withAdminTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);
    return fn(tx);
  });
}
