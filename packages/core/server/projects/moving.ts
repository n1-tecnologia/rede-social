import { and, inArray, notInArray } from 'drizzle-orm';
import { tenantMoves } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { ApiError } from '../http/api-error';
import { type MoveStore, openMoveOf } from './move/state';

/**
 * Whether a tenant is being moved to a project of its own (09.2-14 supplied the field, 09.2-23 the truth:
 * D-535, DBT-48, T-09.2-101). A tenant is MOVING while it has an open row in `platform.tenant_moves` (any state
 * other than `done` and `rolled_back`; one open move per tenant is a partial unique index).
 *
 * `assertNotMoving` is the server-side refusal behind the panel's disabled button: `setTenantStatus` and the
 * non-GET middleware of `/v1/platform/tenants/:id/**` call it, so neither the panel, another route nor a
 * script can reactivate, edit, re-invite or re-bootstrap a tenant halfway through a move. The only caller
 * that passes is the runner that holds the move: it names the move's own id, an internal argument no request
 * body can set.
 */

export async function isTenantMoving(tenantId: string): Promise<boolean> {
  return (await openMoveOf(tenantId)) !== null;
}

/** The subset of `tenantIds` being moved: one read for a whole page of the list. */
export async function tenantsMoving(tenantIds: readonly string[]): Promise<ReadonlySet<string>> {
  if (tenantIds.length === 0) return new Set();
  const rows = await withPlatformTx((tx) =>
    tx
      .selectDistinct({ tenantId: tenantMoves.tenantId })
      .from(tenantMoves)
      .where(
        and(
          inArray(tenantMoves.tenantId, [...tenantIds]),
          notInArray(tenantMoves.state, ['done', 'rolled_back']),
        ),
      ),
  );
  return new Set(rows.map((row) => row.tenantId));
}

/**
 * 409 `TENANT_MOVING` while the tenant has an open move, unless `opts.moveId` is that very move. The message
 * is the catalog's neutral one: no project fact, no tenant name.
 */
export async function assertNotMoving(
  tenantId: string,
  opts: { moveId?: string | undefined; store?: MoveStore } = {},
): Promise<void> {
  const open = await openMoveOf(tenantId, opts.store);
  if (open && open.id !== opts.moveId) throw new ApiError(409, 'TENANT_MOVING');
}
