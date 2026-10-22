import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { RequestContext } from '../server/auth/context';
import { resolveProject } from '../server/tenancy/project-registry';
import { projectOfTx } from './project-handle';
import { withHandle } from './project-pools';
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
 *
 * 09.2-03 (D-538): the transaction opens on the project REGISTERED for `ctx.tenantId` and on no other. The
 * project is resolved from the tenant id argument through the registry, never from ambient context, and the
 * transaction carries its project (`projectOfTx`) so a later step (plan 09's `enqueueInTx`) can find the
 * database it belongs to. A tenant with no binding fails closed (`ProjectUnboundError`); nothing falls back
 * to project 0. For every tenant bound to project 0 (all of them today) the connection is the same
 * process-wide pool as before.
 */
export async function withTenantTx<T>(
  ctx: Pick<RequestContext, 'userId' | 'tenantId' | 'role'>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const project = await resolveProject(ctx.tenantId);
  return withHandle(project, (handle) =>
    handle.db.transaction(async (tx) => {
      projectOfTx.set(tx, handle);
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
    }),
  );
}

// The admin lane (`withAdminTx`, `set local role service_role`) lives ONLY in `./admin-tx.ts`, whose
// entry point Biome restricts to the kernel. It must never be defined or re-exported here: this file
// is the public `@rede-social/core/db/tenant-tx` every module imports (phase-1 review CR-03).
