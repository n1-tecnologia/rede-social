import type {
  EventItem,
  EventItemState,
  EventsResponse,
  PaymentEventOutcome,
  PaymentEventType,
} from '@rede-social/contracts/payments';
import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';

const log = moduleLogger('payments-events');

/**
 * The Eventos list and "Liberar manualmente" (09.1-10, D-490, D-503; PAY-21).
 *
 * WHY THE ADMIN LANE. `payment_events` has RLS enabled and no policy (plan 05): the webhook, the apply job
 * and the admin screens use the admin lane only. Every statement therefore names `e.tenant_id =
 * ${ctx.tenantId}` itself, and the tenant is ONLY ever `ctx.tenantId`; the event id of a path is looked up
 * together with it (T-09.1-48), so another tenant's id is the bare 404.
 *
 * THE LIST is the latest 50 events in the total order `(received_at desc, id desc)`: two events received
 * in the same instant keep a stable slot. Only the four settled states are listed; an event still
 * `received` (the apply job has not run) or `failed` (retryable, operational) is not (assumption A-P29).
 * **The select list below IS the contract (PR-9, T-09.1-49).** There is no payload column on the table and
 * none is read; the buyer's e-mail is the one personal datum the admin needs to answer a buyer.
 *
 * `productName` is the access product's own name or, for a store product, the name the STORE publishes
 * through `app.store_product_name_for(tenant, target)` (a seam, never a table read of the store).
 *
 * THE MANUAL RELEASE is three short steps, not one long transaction (planning decision 4):
 *   1. read and validate in the admin lane (the event is this tenant's, it waits for an account, its
 *      mapping is a store product, a live member carries the e-mail);
 *   2. call the EXISTING `app.store_grant` in the admin's own tenant lane (it checks the `admin_tenant`
 *      claim itself): an entitlement `source = 'grant'`, no order, no revenue (assumption A-P18);
 *   3. mark the event `applied` in a separate admin statement guarded by `state = 'no_membership'`.
 * A crash between 2 and 3 is repaired by the idempotent re-click (the definer answers `already_active`),
 * and `store_entitlements_active_uq` arbitrates a race with the webhook apply or a second click.
 */

const SETTLED = sql`('applied', 'no_membership', 'unknown_product', 'ignored')`;
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EventRow = {
  id: string;
  type: PaymentEventType;
  state: string;
  email: string | null;
  product_name: string | null;
  external_product_id: string | null;
  outcome: PaymentEventOutcome | null;
  received_at: string;
};

const SCREEN_STATE: Record<string, EventItemState> = {
  applied: 'applied',
  no_membership: 'no_account',
  unknown_product: 'unknown_product',
  ignored: 'ignored',
};

const toItem = (row: EventRow): EventItem => ({
  id: row.id,
  type: row.type,
  // A settled state always maps; `ignored` is the safe word for anything else.
  state: SCREEN_STATE[row.state] ?? 'ignored',
  email: row.email,
  productName: row.product_name,
  externalProductId: row.external_product_id,
  outcome: row.outcome,
  receivedAt: row.received_at,
});

/**
 * The columns the list may read. A comment, not a convention: adding a column here is adding it to what a
 * tenant admin sees, so it needs a contract change first (`eventItemSchema` is strict).
 */
const columns = sql`
  e.id::text as id,
  e.type,
  e.state,
  e.email,
  coalesce(
    p.name,
    case when p.kind = 'store_product' then app.store_product_name_for(e.tenant_id, p.target_id) end
  ) as product_name,
  e.external_product_id,
  e.outcome,
  to_char(e.received_at at time zone 'utc', ${ISO_MICROSECONDS}) as received_at`;

/** `GET /v1/payments/events`: the latest 50 settled events of the tenant, no payload, no paging. */
export async function listEvents(ctx: RequestContext): Promise<EventsResponse> {
  const rows = await withAdminTx((tx) =>
    tx.execute<EventRow>(sql`
      select ${columns}
        from public.payment_events e
        left join public.payment_products p
               on p.id = e.mapping_id and p.tenant_id = e.tenant_id
       where e.tenant_id = ${ctx.tenantId}::uuid
         and e.state in ${SETTLED}
       order by e.received_at desc, e.id desc
       limit 50`),
  );
  log.info(
    {
      event: 'payments.events.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      returned: rows.length,
    },
    'payments events listed',
  );
  return { items: rows.map(toItem), serverNow: new Date().toISOString() };
}

type GrantFacts = {
  state: string;
  outcome: string | null;
  email: string | null;
  kind: string | null;
  target_id: string | null;
};

type GrantRow = {
  outcome: 'granted' | 'already_active' | 'not_found' | 'forbidden';
  entitlement_id: string | null;
};

async function readItem(tenantId: string, eventId: string): Promise<EventItem> {
  const rows = await withAdminTx((tx) =>
    tx.execute<EventRow>(sql`
      select ${columns}
        from public.payment_events e
        left join public.payment_products p
               on p.id = e.mapping_id and p.tenant_id = e.tenant_id
       where e.id = ${eventId}::uuid and e.tenant_id = ${tenantId}::uuid
       limit 1`),
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toItem(row);
}

/**
 * `POST /v1/payments/events/{eventId}/grant` ("Liberar manualmente", D-490, D-503): releases the store
 * product to an event that was waiting for an account. Answers the event as the list would show it.
 *
 *  - another tenant's id, an unknown id or a non-uuid: the bare 404;
 *  - an event already `applied` with the outcome `product_granted` or `no_effect`: returned as it is, no
 *    second entitlement (idempotent);
 *  - any other state, or a mapping that is not a store product: `409 { payments: 'not_grantable' }`;
 *  - no live member carries the event's e-mail yet: `409 { payments: 'no_membership' }`, the row untouched.
 */
export async function grantEventManually(ctx: RequestContext, eventId: string): Promise<EventItem> {
  if (!UUID.test(eventId)) throw new ApiError(404, 'NOT_FOUND');

  // 1. Read and validate (admin lane, tenant pinned).
  const { facts, membershipId } = await withAdminTx(async (tx) => {
    const found = await tx.execute<GrantFacts>(sql`
      select e.state, e.outcome, e.email, p.kind, p.target_id::text as target_id
        from public.payment_events e
        left join public.payment_products p
               on p.id = e.mapping_id and p.tenant_id = e.tenant_id
       where e.id = ${eventId}::uuid and e.tenant_id = ${ctx.tenantId}::uuid
       limit 1`);
    const row = found[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    if (
      row.state === 'applied' &&
      (row.outcome === 'product_granted' || row.outcome === 'no_effect')
    ) {
      return { facts: row, membershipId: null };
    }
    if (row.state !== 'no_membership') {
      throw new ApiError(409, 'CONFLICT', { payments: 'not_grantable' });
    }
    if (row.kind !== 'store_product' || row.target_id === null) {
      throw new ApiError(409, 'CONFLICT', { payments: 'not_grantable' });
    }
    // The same definition of "a member" the apply job uses: live, active, not blocked, exact e-mail.
    const member = row.email
      ? await tx.execute<{ id: string }>(sql`
          select m.id::text as id
            from public.memberships m
            join public.users u on u.id = m.user_id
           where m.tenant_id = ${ctx.tenantId}::uuid
             and m.status = 'active' and m.blocked_at is null and m.deleted_at is null
             and lower(btrim(u.email)) = ${row.email}
           order by m.id
           limit 1`)
      : [];
    if (!member[0]) throw new ApiError(409, 'CONFLICT', { payments: 'no_membership' });
    return { facts: row, membershipId: member[0].id };
  });

  // Already granted: the same applied row, nothing written.
  if (membershipId === null) return readItem(ctx.tenantId, eventId);
  const targetId = facts.target_id as string;

  // 2. The store's own definer, in the admin's tenant lane (it needs the `admin_tenant` claim by design).
  const granted = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<GrantRow>(sql`
      select r.outcome, r.entitlement_id
        from app.store_grant(${targetId}::uuid, ${membershipId}::uuid) r`);
    return rows[0] ?? { outcome: 'not_found' as const, entitlement_id: null };
  });
  if (granted.outcome === 'forbidden') throw new ApiError(403, 'FORBIDDEN');
  if (granted.outcome === 'not_found' || granted.entitlement_id === null) {
    throw new ApiError(404, 'NOT_FOUND');
  }

  // 3. Mark the event applied, guarded by the state it was read in. `already_active` means the member
  //    already held the product (an earlier grant, a purchase, or the other of two simultaneous clicks):
  //    nothing was written, which is the job's `no_effect`.
  const outcome: PaymentEventOutcome =
    granted.outcome === 'granted' ? 'product_granted' : 'no_effect';
  await withAdminTx((tx) =>
    tx.execute(sql`
      update public.payment_events
         set state = 'applied', outcome = ${outcome}, applied_at = now()
       where id = ${eventId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
         and state = 'no_membership'`),
  );

  log.info(
    {
      event: 'payments.events.grant',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      eventId,
      outcome: granted.outcome,
    },
    'payments event released manually',
  );
  return readItem(ctx.tenantId, eventId);
}
