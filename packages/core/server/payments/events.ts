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
import { emit } from '../events/bus';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { appliedRefundExists, lockPaymentOrder } from './order-lock';

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
 * through `app.store_product_name_for(tenant, target)` (a seam, never a table read of the store). For a
 * paid-event delivery (Phase 10.1, D-749, D-758) it is the event's title through `app.event_title_for(tenant,
 * event)` (the same seam, `service_role` only) and the item also carries `kind: 'event'` and `eventTitle`
 * (null when the event is gone: soft-deleted or foreign); a store or access item carries neither key, so a
 * tenant with no ticket delivery lists exactly as before. A delivery for an ended or cancelled event is
 * `ignored` with the matching outcome and the screen says so (`event_ended` / `event_cancelled`).
 *
 * THE MANUAL RELEASE is three short steps, not one long transaction (planning decision 4):
 *   1. read and validate in the admin lane (the event is this tenant's, it waits for an account, its
 *      mapping is a store product OR an event, a live member carries the e-mail);
 *   2. call the EXISTING `app.store_grant` in the admin's own tenant lane (it checks the `admin_tenant`
 *      claim itself): an entitlement `source = 'grant'`, no order, no revenue (assumption A-P18);
 *   3. mark the event `applied` in a separate admin statement guarded by `state = 'no_membership'`.
 * A crash between 2 and 3 is repaired by the idempotent re-click (the definer answers `already_active`),
 * and `store_entitlements_active_uq` arbitrates a race with the webhook apply or a second click.
 *
 * A PAID-EVENT delivery (Phase 10.1, D-749, D-759) takes the same three steps with one difference in the
 * middle: step 2 is `app.event_gateway_grant` (a `service_role` definer, so it runs in the admin lane and
 * the tenant is `ctx.tenantId`, never the client's) with `p_admin_release = true`, which is the ONE way an
 * unconfirmed account is confirmed for a ticket: the admin looked at the delivery and decided. The stale
 * rule is checked AGAIN here (a refunded order cannot be released, `409 not_grantable`), an ended or
 * cancelled event answers `409 event_ended` / `event_cancelled` and leaves the row, and the definer and the
 * settlement share one transaction so a crash cannot leave a presence without its applied row.
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
  kind: string | null;
  event_title: string | null;
  received_at: string;
};

const SCREEN_STATE: Record<string, EventItemState> = {
  applied: 'applied',
  no_membership: 'no_account',
  unknown_product: 'unknown_product',
  ignored: 'ignored',
};

/** An ignored delivery for a closed event says why on the screen (D-758); every other state maps one to one. */
function screenState(row: EventRow): EventItemState {
  if (row.state === 'ignored' && row.outcome === 'event_ended') return 'event_ended';
  if (row.state === 'ignored' && row.outcome === 'event_cancelled') return 'event_cancelled';
  // A settled state always maps; `ignored` is the safe word for anything else.
  return SCREEN_STATE[row.state] ?? 'ignored';
}

const toItem = (row: EventRow): EventItem => {
  const item: EventItem = {
    id: row.id,
    type: row.type,
    state: screenState(row),
    email: row.email,
    productName: row.product_name,
    externalProductId: row.external_product_id,
    outcome: row.outcome,
    receivedAt: row.received_at,
  };
  // Only a paid-event delivery carries the two optional keys: a store or access item keeps its exact shape.
  if (row.kind === 'event') {
    item.kind = 'event';
    item.eventTitle = row.event_title;
  }
  return item;
};

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
    case when p.kind = 'store_product' then app.store_product_name_for(e.tenant_id, p.target_id) end,
    case when p.kind = 'event' then app.event_title_for(e.tenant_id, p.event_id) end
  ) as product_name,
  e.external_product_id,
  e.outcome,
  p.kind,
  case when p.kind = 'event' then app.event_title_for(e.tenant_id, p.event_id) end as event_title,
  to_char(e.received_at at time zone 'utc', ${ISO_MICROSECONDS}) as received_at`;

/** `GET /v1/payments/events`: the latest 50 settled events of the tenant, no payload, no paging. */
export async function listEvents(ctx: RequestContext): Promise<EventsResponse> {
  const rows = await withAdminTx({ tenantId: ctx.tenantId }, (tx) =>
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
  event_id: string | null;
  provider: string;
  external_ref: string | null;
  stale: boolean;
};

type TicketGrantRow = {
  outcome: string;
  user_id: string | null;
  event_title: string | null;
  over_limit: boolean | null;
};

type GrantRow = {
  outcome: 'granted' | 'already_active' | 'not_found' | 'forbidden';
  entitlement_id: string | null;
};

async function readItem(tenantId: string, eventId: string): Promise<EventItem> {
  const rows = await withAdminTx({ tenantId }, (tx) =>
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
 *  - an event already `applied` with the outcome `product_granted`, `ticket_granted`,
 *    `ticket_granted_over_limit` or `no_effect`: returned as it is, no second entitlement or presence
 *    (idempotent);
 *  - any other state, or a mapping that is neither a store product nor an event, or (an event) an order
 *    already refunded or charged back: `409 { payments: 'not_grantable' }`;
 *  - no live member carries the event's e-mail yet: `409 { payments: 'no_membership' }`, the row untouched;
 *  - (an event) the event has ended or was cancelled or deleted: `409 { payments: 'event_ended' }` /
 *    `'event_cancelled'`, the row untouched.
 */
export async function grantEventManually(ctx: RequestContext, eventId: string): Promise<EventItem> {
  if (!UUID.test(eventId)) throw new ApiError(404, 'NOT_FOUND');

  // 1. Read and validate (admin lane, tenant pinned).
  const { facts, membershipId } = await withAdminTx({ tenantId: ctx.tenantId }, async (tx) => {
    const found = await tx.execute<GrantFacts>(sql`
      select e.state, e.outcome, e.email, p.kind, p.target_id::text as target_id,
             p.event_id::text as event_id, e.provider, e.external_ref,
             -- PAY-30 again: an APPLIED refund or chargeback of the same order makes a late release stale.
             exists (
               select 1
                 from public.payment_events t
                where t.tenant_id = e.tenant_id
                  and t.provider = e.provider
                  and t.external_ref = e.external_ref
                  and t.id <> e.id
                  and t.state = 'applied'
                  and t.type in ('purchase_refunded', 'chargeback')) as stale
        from public.payment_events e
        left join public.payment_products p
               on p.id = e.mapping_id and p.tenant_id = e.tenant_id
       where e.id = ${eventId}::uuid and e.tenant_id = ${ctx.tenantId}::uuid
       limit 1`);
    const row = found[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    if (
      row.state === 'applied' &&
      (row.outcome === 'product_granted' ||
        row.outcome === 'ticket_granted' ||
        row.outcome === 'ticket_granted_over_limit' ||
        row.outcome === 'no_effect')
    ) {
      return { facts: row, membershipId: null };
    }
    if (row.state !== 'no_membership') {
      throw new ApiError(409, 'CONFLICT', { payments: 'not_grantable' });
    }
    const isStore = row.kind === 'store_product' && row.target_id !== null;
    const isTicket = row.kind === 'event' && row.event_id !== null && row.external_ref !== null;
    if (!isStore && !isTicket) {
      throw new ApiError(409, 'CONFLICT', { payments: 'not_grantable' });
    }
    // A refunded or charged-back order is not released by hand either (PAY-30, T-10.1-08).
    if (isTicket && row.stale) throw new ApiError(409, 'CONFLICT', { payments: 'not_grantable' });
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

  if (facts.kind === 'event') return releaseTicket(ctx, eventId, facts, membershipId);
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
  await withAdminTx({ tenantId: ctx.tenantId }, (tx) =>
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

/**
 * The paid-event half of "Liberar manualmente" (Phase 10.1, D-749, D-759): the definer and the settlement in
 * ONE admin transaction. `facts` was read for this tenant and this delivery, so the event, the provider and
 * the order reference are the STORED ones; the client sent nothing but the delivery id.
 *
 *  - the transaction first takes the order's advisory lock (`lockPaymentOrder`, the SAME key the apply job
 *    holds) and re-reads whether another delivery of the order is APPLIED as a refund or chargeback
 *    (`appliedRefundExists`): when it is, `409 { payments: 'not_grantable' }` and nothing is written, so a
 *    refund that applied since the first read is never undone (WR-01). Lock order, no deadlock: the order
 *    lock, then the event lock and the member's row inside the definer, which is the apply job's order;
 *  - `granted` / `already_in`: the delivery is settled `applied` (`ticket_granted`, `ticket_granted_over_limit`
 *    or `no_effect`), guarded by the state it was read in; only `granted` tells the payer;
 *  - `event_ended` / `event_cancelled`: `409 { payments: ... }`, nothing written, the row stays "sem conta"
 *    so the admin sees why;
 *  - `not_mapped` (the mapping went away) or `unconfirmed` (cannot happen with the admin flag): `409
 *    not_grantable`; `not_found`: the bare 404.
 */
async function releaseTicket(
  ctx: RequestContext,
  eventId: string,
  facts: GrantFacts,
  membershipId: string,
): Promise<EventItem> {
  const ticketEventId = facts.event_id as string;
  const orderRef = facts.external_ref as string;

  const granted = await withAdminTx({ tenantId: ctx.tenantId }, async (tx) => {
    // WR-01 (D-752, D-757): the order lock the apply job holds, then the refund fact read AGAIN under it, so a
    // refund that applied since the first read is seen. The throw rolls the transaction back, nothing written.
    await lockPaymentOrder(tx, ctx.tenantId, facts.provider, orderRef);
    if (await appliedRefundExists(tx, ctx.tenantId, facts.provider, orderRef, eventId)) {
      throw new ApiError(409, 'CONFLICT', { payments: 'not_grantable' });
    }
    const rows = await tx.execute<TicketGrantRow>(sql`
      select outcome, user_id::text as user_id, event_title, over_limit
        from app.event_gateway_grant(
          ${ctx.tenantId}::uuid, ${membershipId}::uuid, ${ticketEventId}::uuid,
          ${facts.provider}::text, ${orderRef}::text, true)`);
    const row = rows[0] ?? {
      outcome: 'not_found',
      user_id: null,
      event_title: null,
      over_limit: null,
    };
    if (row.outcome === 'granted' || row.outcome === 'already_in') {
      const outcome: PaymentEventOutcome =
        row.outcome === 'already_in'
          ? 'no_effect'
          : row.over_limit
            ? 'ticket_granted_over_limit'
            : 'ticket_granted';
      await tx.execute(sql`
        update public.payment_events
           set state = 'applied', outcome = ${outcome}, applied_at = now()
         where id = ${eventId}::uuid
           and tenant_id = ${ctx.tenantId}::uuid
           and state = 'no_membership'`);
    }
    return row;
  });

  if (granted.outcome === 'event_ended') {
    throw new ApiError(409, 'CONFLICT', { payments: 'event_ended' });
  }
  if (granted.outcome === 'event_cancelled') {
    throw new ApiError(409, 'CONFLICT', { payments: 'event_cancelled' });
  }
  if (granted.outcome === 'not_mapped' || granted.outcome === 'unconfirmed') {
    throw new ApiError(409, 'CONFLICT', { payments: 'not_grantable' });
  }
  if (granted.outcome === 'not_found') throw new ApiError(404, 'NOT_FOUND');

  if (granted.outcome === 'granted' && granted.user_id) {
    // After the response middleware flushes, the payer gets the same "Presença confirmada" as from the webhook.
    emit(ctx, 'payments.ticket_confirmed', {
      tenantId: ctx.tenantId,
      userId: granted.user_id,
      eventId: ticketEventId,
      eventTitle: granted.event_title ?? '',
    });
  }

  log.info(
    {
      event: 'payments.events.grant',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      eventId,
      outcome: granted.outcome,
    },
    'payments ticket event released manually',
  );
  return readItem(ctx.tenantId, eventId);
}
