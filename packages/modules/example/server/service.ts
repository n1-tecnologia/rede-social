import { withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { emit } from '@tria/core/server/events/bus';
import { ApiError } from '@tria/core/server/http/api-error';
import { enqueueInTx } from '@tria/core/server/jobs/boss';
import { and, desc, eq } from 'drizzle-orm';
import {
  type CreateExampleItem,
  EXAMPLE_PROCESS_QUEUE,
  type ExampleItem,
} from '../contracts/index';
import { exampleItems } from '../db/schema';

/** Row → published contract. Timestamps cross the wire as ISO strings, never as `Date`. */
type Row = typeof exampleItems.$inferSelect;
const toItem = (row: Row): ExampleItem => ({
  id: row.id,
  tenantId: row.tenantId,
  title: row.title,
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt.toISOString(),
  processedAt: row.processedAt?.toISOString() ?? null,
});

/**
 * TENANT-03: the tenant is never a parameter — `withTenantTx` binds it from `ctx` (which
 * `requireAuth` read from the membership row) and RLS filters the rows. The `order by` matches
 * `example_items_tenant_created_idx` exactly, tie-breaker included, so the order is stable.
 */
export async function listItems(ctx: RequestContext): Promise<ExampleItem[]> {
  const rows = await withTenantTx(ctx, (tx) =>
    tx
      .select()
      .from(exampleItems)
      .orderBy(desc(exampleItems.createdAt), desc(exampleItems.id))
      .limit(50),
  );
  return rows.map(toItem);
}

/**
 * T-07-02: there is ONE code path for "does not exist" and "belongs to another tenant" — RLS hides
 * the foreign row, the query returns nothing, and the caller gets 404 `NOT_FOUND`. Nothing here
 * compares tenant ids, so no future edit can accidentally turn the 404 into a 403 that confirms
 * the row exists somewhere.
 */
export async function getItem(ctx: RequestContext, id: string): Promise<ExampleItem> {
  const [row] = await withTenantTx(ctx, (tx) =>
    tx.select().from(exampleItems).where(eq(exampleItems.id, id)).limit(1),
  );
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toItem(row);
}

/**
 * The whole point of the module (D-19): row + job in ONE transaction, event after commit.
 *
 * - `createdByUserId` comes from `ctx`, never from the body (T-07-01).
 * - `enqueueInTx` writes the pg-boss job through the SAME Drizzle transaction, so a rollback takes
 *   the job with it — there is no window where the item exists without its job, or the reverse.
 * - `singletonKey = itemId` makes a retried request idempotent at the queue (T-07-04).
 * - `emit` runs only after `withTenantTx` RESOLVES, and even then only queues the event; the bus
 *   delivers it after the response handler returns. A subscriber can never see an uncommitted row.
 */
export async function createItem(
  ctx: RequestContext,
  input: CreateExampleItem,
): Promise<ExampleItem> {
  const row = await withTenantTx(ctx, async (tx) => {
    const [inserted] = await tx
      .insert(exampleItems)
      .values({
        tenantId: ctx.tenantId,
        title: input.title,
        createdByUserId: ctx.userId,
      })
      .returning();
    if (!inserted) throw new ApiError(500, 'INTERNAL');

    await enqueueInTx(
      tx,
      EXAMPLE_PROCESS_QUEUE,
      { tenantId: ctx.tenantId, itemId: inserted.id },
      { singletonKey: inserted.id },
    );
    return inserted;
  });

  emit(ctx, 'example.item.created', {
    tenantId: ctx.tenantId,
    itemId: row.id,
    userId: ctx.userId,
  });

  return toItem(row);
}

/**
 * The worker's half. It re-enters the TENANT lane with a context synthesised from the job payload,
 * so the update is filtered by exactly the same RLS policy a request would face: a payload naming
 * the wrong tenant updates zero rows instead of another tenant's item (T-07-03).
 */
export async function markProcessed(tenantId: string, itemId: string): Promise<number> {
  const ctx: RequestContext = {
    // The job has no human behind it; the tenant lane only reads `tenant_id` from the claims.
    userId: '00000000-0000-0000-0000-000000000000',
    tenantId,
    role: 'member',
    requestId: 'job',
    events: [],
  };
  const updated = await withTenantTx(ctx, (tx) =>
    tx
      .update(exampleItems)
      .set({ processedAt: new Date() })
      .where(and(eq(exampleItems.id, itemId), eq(exampleItems.tenantId, tenantId)))
      .returning({ id: exampleItems.id }),
  );
  return updated.length;
}
