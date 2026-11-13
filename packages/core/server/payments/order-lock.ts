import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-tx';

/**
 * The order lock and the applied-refund fact, defined ONCE (Phase 10.1, WR-01, D-752, D-757).
 *
 * Two writers can create or remove the presence of one paid order at the same moment: the apply job (a
 * gateway delivery, `apply.ts`) and the manual release ("Liberar manualmente", `events.ts`). Both must hold
 * the SAME transaction-scoped advisory lock, one per order, before they read the refund fact and write, or a
 * refund that applies between the manual release's read and its grant leaves a paid-origin row for a refunded
 * order that nothing will ever revoke (the refund event is final).
 *
 * The key text, `<tenant>:<provider>:<external_ref>` hashed with seed 0, is a PUBLISHED CONVENTION between API
 * revisions: during a rolling deploy two revisions run together and an old revision's apply job must still
 * serialise with this revision's manual release. It must never change; `tests/payments-order-lock.test.ts`
 * pins the rendered SQL. Lock order for a caller (no deadlock, D-752): this order lock first, then (inside
 * `app.event_gateway_grant`) the event lock and the member's row, which is the order the apply job uses.
 *
 * Both helpers take the CALLER's transaction and open none.
 */

/** Takes the order's advisory lock for the rest of `tx` (released at commit or rollback). */
export async function lockPaymentOrder(
  tx: Tx,
  tenantId: string,
  provider: string,
  externalRef: string,
): Promise<void> {
  await tx.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(${tenantId}::text || ':' || ${provider}::text || ':' || ${externalRef}::text, 0))`);
}

/**
 * The one-off rule's fact (T-09.1-33, PAY-30): another delivery of the same order (same tenant, provider and
 * reference, a different id) is APPLIED as a refund or a chargeback. Read it under {@link lockPaymentOrder},
 * or a refund can apply right after the answer.
 */
export async function appliedRefundExists(
  tx: Tx,
  tenantId: string,
  provider: string,
  externalRef: string,
  exceptEventId: string,
): Promise<boolean> {
  const rows = (await tx.execute(sql`
    select exists (
      select 1
        from public.payment_events
       where tenant_id = ${tenantId}::uuid
         and provider = ${provider}
         and external_ref = ${externalRef}
         and id <> ${exceptEventId}::uuid
         and state = 'applied'
         and type in ('purchase_refunded', 'chargeback')) as found`)) as unknown as {
    found: boolean;
  }[];
  return rows[0]?.found ?? false;
}
