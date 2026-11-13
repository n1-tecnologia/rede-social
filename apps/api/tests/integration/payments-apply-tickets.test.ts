import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { unsupportedMappingKind } from '@rede-social/core/server/payments/apply';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  attendancesOf,
  deliver,
  deliverAndApply,
  eventRow,
  freshEmail,
  personWithEmail,
  removeTicketEvents,
  runApply,
  type TicketEventOptions,
  ticketDelivery,
  ticketEvent,
  ticketMapping,
} from './payments-apply-fixtures';
import {
  adminSql,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  runNotificationJobs,
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  withPaymentsGate,
} from './setup';

/**
 * 10.1-05 (TICK-03, TICK-07..TICK-12, TICK-17, TICK-21; D-749..D-752, D-756..D-760) against the live local
 * stack: a signed `fake` delivery of an EVENT product goes through the REAL route and inbox, the REAL
 * `kernel.payment-event` handler applies it through `app.event_gateway_grant` / `_revoke`, and the buyer's
 * notice is read from the REAL fan-out.
 *
 *  - `10.1 tracer`: one path through every layer, from the signed delivery to the `ticket` presence, the
 *    `payments.ticket_confirmed` event and the in-app row.
 *  - `10.1 outcomes`: every outcome of the grant definer and its settlement (granted, already_in,
 *    event_ended, event_cancelled, not_mapped, unconfirmed, not_found), the type branch, the stale rule and
 *    the module-off adjacency (EP-06).
 *  - `10.1 refund`: the revoke outcomes (removed, kept, not_found) and the exhaustive kind guard.
 *
 * Every identity and every event carries the prefix below; the integration, its events and its mappings are
 * removed in `afterEach` / `afterAll`. Test ORDER is load-bearing (`fileParallelism: false`).
 */

const PREFIX = 'paytick';
const TITLE = `${PREFIX}-evento`;
const KIND = 'payments.ticket_confirmed';

let labTenantId = '';
let integration: SeededPaymentIntegration;
let restoreNotifications: () => Promise<void> = async () => {};

/** The lab tenant ships with `notifications` OFF; the fan-out answers nothing while it is. */
async function enableNotifications(tenantId: string): Promise<() => Promise<void>> {
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenantId}::uuid and module_key = 'notifications'`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantId}::uuid, 'notifications', true)
    on conflict (tenant_id, module_key) do update set enabled = true, updated_at = now()`;
  moduleFlags.invalidate(tenantId);
  return async () => {
    if (previous) {
      await adminSql`
        update public.tenant_modules set enabled = ${previous.enabled}, updated_at = now()
         where tenant_id = ${tenantId}::uuid and module_key = 'notifications'`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenantId}::uuid and module_key = 'notifications'`;
    }
    moduleFlags.invalidate(tenantId);
  };
}

type NoticeRow = {
  user_id: string;
  kind: string;
  actor_user_id: string | null;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown>;
};

/** The ticket notices of one user, oldest first. */
const noticesOf = (userId: string) =>
  adminSql<NoticeRow[]>`
    select user_id::text as user_id, kind, actor_user_id::text as actor_user_id, subject_type,
           subject_id::text as subject_id, payload
      from public.notifications
     where user_id = ${userId}::uuid and kind = ${KIND}
     order by created_at, id`;

beforeEach(async () => {
  integration = await seedPaymentIntegration(labTenantId);
});

beforeAll(async () => {
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug = 'rede-lab'`;
  labTenantId = rows[0]?.id ?? '';
  if (!labTenantId) throw new Error('seed tenants missing: run pnpm db:seed');
  await removeIdentitiesByPrefix(PREFIX);
  await removePaymentIntegrations(labTenantId);
  await removeTicketEvents(PREFIX);
  await removePaymentMappings(labTenantId);
  restoreNotifications = await enableNotifications(labTenantId);
}, 60_000);

afterEach(async () => {
  // T-10.1-23: no business case ends `failed` (pg-boss retries a failed apply for ever).
  const [failed] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.payment_events
     where tenant_id = ${labTenantId}::uuid and state = 'failed'`;
  expect(failed?.n, 'no delivery of a ticket may end failed').toBe(0);
  await removePaymentIntegrations(labTenantId);
  await removeTicketEvents(PREFIX);
  await removePaymentMappings(labTenantId);
});

afterAll(async () => {
  await removePaymentIntegrations(labTenantId);
  await removeTicketEvents(PREFIX);
  await removePaymentMappings(labTenantId);
  await removeIdentitiesByPrefix(PREFIX);
  await restoreNotifications();
  await stopBoss();
}, 60_000);

describe('10.1 tracer', () => {
  it('a signed approved delivery of an event product confirms one ticket presence and tells the buyer once', async () => {
    const eventId = await ticketEvent(labTenantId, { title: TITLE });
    const mapping = await ticketMapping(labTenantId, eventId);
    const buyer = await personWithEmail(freshEmail(PREFIX, 'buyer'), 'lab');
    const ref = `ord-${crypto.randomUUID()}`;

    const id = await deliver(
      integration,
      ticketDelivery('purchase_approved', {
        ref,
        productId: mapping.externalProductId,
        email: buyer.email,
      }),
    );
    await runApply(id);
    expect(await eventRow(id)).toMatchObject({ state: 'applied', outcome: 'ticket_granted' });

    const rows = await attendancesOf(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: buyer.userId,
      status: 'going',
      origin: 'ticket',
      order_provider: 'fake',
      order_ref: ref,
    });

    expect(await runNotificationJobs(labTenantId)).toBeGreaterThan(0);
    const notices = await noticesOf(buyer.userId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: KIND,
      actor_user_id: null,
      subject_type: 'event',
      subject_id: eventId,
      payload: { eventId, eventTitle: TITLE },
    });
    // the facts are the event id and title only: no order reference, e-mail, amount or provider
    expect(Object.keys(notices[0]?.payload ?? {}).sort()).toEqual(['eventId', 'eventTitle']);
    expect(JSON.stringify(notices[0]?.payload)).not.toContain(ref);

    // a replay of the apply and of the fan-out changes nothing
    await runApply(id);
    await runNotificationJobs(labTenantId);
    expect(await attendancesOf(eventId)).toHaveLength(1);
    expect(await noticesOf(buyer.userId)).toHaveLength(1);

    // the same order delivered again (a new body) is one presence and no second notice
    const again = await deliverAndApply(
      integration,
      ticketDelivery('purchase_approved', {
        ref,
        productId: mapping.externalProductId,
        email: buyer.email,
        resent: true,
      }),
    );
    expect(again).toMatchObject({ state: 'applied', outcome: 'no_effect' });
    await runNotificationJobs(labTenantId);
    expect(await attendancesOf(eventId)).toHaveLength(1);
    expect(await noticesOf(buyer.userId)).toHaveLength(1);
  });
});

/* ── Task 2: the grant definer's outcomes, the type branch, stale, refund and revoke ────────────── */

/** An event of the lab tenant with its mapping; `productId` is the gateway's product id for a delivery. */
async function paidEvent(options: Partial<TicketEventOptions> = {}) {
  const eventId = await ticketEvent(labTenantId, {
    title: `${TITLE}-${crypto.randomUUID().slice(0, 8)}`,
    ...options,
  });
  const mapping = await ticketMapping(labTenantId, eventId);
  return { eventId, productId: mapping.externalProductId };
}

const newBuyer = (label: string) => personWithEmail(freshEmail(PREFIX, label), 'lab');
const orderRef = () => `ord-${crypto.randomUUID()}`;

/** Delivers one neutral body for `product` and applies it with the real job. */
const send = (
  type: string,
  product: { productId: string },
  email: string,
  ref: string,
  extra: Record<string, unknown> = {},
) =>
  deliverAndApply(
    integration,
    ticketDelivery(type, { ref, productId: product.productId, email, ...extra }),
  );

describe('10.1 outcomes', () => {
  it('granted: an approved purchase after the start still confirms the presence (D-750)', async () => {
    const ev = await paidEvent({ startsInMinutes: -30, endsInMinutes: 90 });
    const buyer = await newBuyer('late');
    const settled = await send('purchase_approved', ev, buyer.email, orderRef());
    expect(settled).toMatchObject({ state: 'applied', outcome: 'ticket_granted' });
    expect(await attendancesOf(ev.eventId)).toMatchObject([
      { user_id: buyer.userId, status: 'going', origin: 'ticket' },
    ]);
  });

  it('granted: a full event still confirms and the outcome says it went over the limit (D-751)', async () => {
    const ev = await paidEvent({ capacity: 1 });
    const first = await newBuyer('first');
    const second = await newBuyer('second');
    expect(await send('purchase_approved', ev, first.email, orderRef())).toMatchObject({
      outcome: 'ticket_granted',
    });
    const over = await send('purchase_approved', ev, second.email, orderRef());
    expect(over).toMatchObject({ state: 'applied', outcome: 'ticket_granted_over_limit' });
    expect(await attendancesOf(ev.eventId)).toHaveLength(2);
  });

  it('granted: an admin buys like anyone (any live role matches, D-749)', async () => {
    const ev = await paidEvent();
    const admin = await personWithEmail(freshEmail(PREFIX, 'adminbuyer'), 'lab', 'admin_tenant');
    const settled = await send('purchase_approved', ev, admin.email, orderRef());
    expect(settled).toMatchObject({ state: 'applied', outcome: 'ticket_granted' });
  });

  it('already_in: the same order twice is one presence and the second answer is no_effect (EP-20)', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('twice');
    const ref = orderRef();
    await send('purchase_approved', ev, buyer.email, ref);
    const again = await send('purchase_approved', ev, buyer.email, ref, { resent: 1 });
    expect(again).toMatchObject({ state: 'applied', outcome: 'no_effect' });
    expect(await attendancesOf(ev.eventId)).toHaveLength(1);
  });

  it('WR-03 already_in: a re-sent approval after the event ended is no_effect, not a mislabelled event_ended (D-750, D-752)', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('wr03ended');
    const ref = orderRef();
    expect(await send('purchase_approved', ev, buyer.email, ref)).toMatchObject({
      state: 'applied',
      outcome: 'ticket_granted',
    });
    await adminSql`
      update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
       where id = ${ev.eventId}::uuid`;
    const again = await send('purchase_approved', ev, buyer.email, ref, { resent: 1 });
    expect(again).toMatchObject({ state: 'applied', outcome: 'no_effect' });
    expect(again.outcome).not.toBe('event_ended');
    const rows = await attendancesOf(ev.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: buyer.userId, origin: 'ticket' });
  });

  it('WR-03 already_in: a re-sent approval after the event was cancelled is no_effect, not event_cancelled (D-760, D-752)', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('wr03cancel');
    const ref = orderRef();
    expect(await send('purchase_approved', ev, buyer.email, ref)).toMatchObject({
      state: 'applied',
      outcome: 'ticket_granted',
    });
    await adminSql`
      update public.events set status = 'cancelled', cancelled_at = now() where id = ${ev.eventId}::uuid`;
    const again = await send('purchase_approved', ev, buyer.email, ref, { resent: 1 });
    expect(again).toMatchObject({ state: 'applied', outcome: 'no_effect' });
    expect(again.outcome).not.toBe('event_cancelled');
    const rows = await attendancesOf(ev.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: buyer.userId, origin: 'ticket' });
  });

  it('already_in: the same reference for another buyer is no_effect, one reference is one presence (EP-36)', async () => {
    const ev = await paidEvent();
    const first = await newBuyer('owner');
    const other = await newBuyer('other');
    const ref = orderRef();
    await send('purchase_approved', ev, first.email, ref);
    const again = await send('purchase_approved', ev, other.email, ref);
    expect(again).toMatchObject({ state: 'applied', outcome: 'no_effect' });
    const rows = await attendancesOf(ev.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(first.userId);
  });

  it('already_in: a second order by a ticket holder changes nothing and its refund removes nothing (A10)', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('holder');
    const first = orderRef();
    const second = orderRef();
    await send('purchase_approved', ev, buyer.email, first);
    expect(await send('purchase_approved', ev, buyer.email, second)).toMatchObject({
      state: 'applied',
      outcome: 'no_effect',
    });
    const refund = await send('purchase_refunded', ev, buyer.email, second);
    expect(refund).toMatchObject({ state: 'applied', outcome: 'no_effect' });
    const rows = await attendancesOf(ev.eventId);
    expect(rows).toMatchObject([{ order_ref: first, status: 'going', origin: 'ticket' }]);
  });

  it('event_ended: a payment after the end settles ignored / event_ended and is never retried (D-750)', async () => {
    const ev = await paidEvent({ startsInMinutes: -240, endsInMinutes: -60 });
    const buyer = await newBuyer('ended');
    const settled = await send('purchase_approved', ev, buyer.email, orderRef());
    expect(settled).toMatchObject({ state: 'ignored', outcome: 'event_ended' });
    expect(settled.state).not.toBe('failed');
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  });

  it('event_cancelled: a cancelled event settles ignored / event_cancelled and is never retried (D-760)', async () => {
    const ev = await paidEvent({ status: 'cancelled' });
    const buyer = await newBuyer('cancelled');
    const settled = await send('purchase_approved', ev, buyer.email, orderRef());
    expect(settled).toMatchObject({ state: 'ignored', outcome: 'event_cancelled' });
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  });

  it('event_cancelled: a soft-deleted event gives the same answer (D-760)', async () => {
    const ev = await paidEvent({ deleted: true });
    const buyer = await newBuyer('deleted');
    const settled = await send('purchase_approved', ev, buyer.email, orderRef());
    expect(settled).toMatchObject({ state: 'ignored', outcome: 'event_cancelled' });
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  });

  it('unconfirmed: an account whose e-mail is unconfirmed settles no_membership and is not confirmed by a payment (D-759, T-10.1-10)', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('unconf');
    await adminSql`update auth.users set email_confirmed_at = null where id = ${buyer.userId}::uuid`;
    const settled = await send('purchase_approved', ev, buyer.email, orderRef());
    expect(settled).toMatchObject({ state: 'no_membership', outcome: null });
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
    const [account] = await adminSql<{ confirmed: boolean }[]>`
      select email_confirmed_at is not null as confirmed from auth.users where id = ${buyer.userId}::uuid`;
    expect(account?.confirmed).toBe(false);
  });

  it('no_membership: an e-mail with no account, a blocked membership and a removed membership wait for nobody (D-749)', async () => {
    const ev = await paidEvent();
    const ghost = await send('purchase_approved', ev, freshEmail(PREFIX, 'ghost'), orderRef());
    expect(ghost).toMatchObject({ state: 'no_membership', outcome: null });

    const blocked = await newBuyer('blocked');
    await adminSql`update public.memberships set blocked_at = now() where user_id = ${blocked.userId}::uuid`;
    expect(await send('purchase_approved', ev, blocked.email, orderRef())).toMatchObject({
      state: 'no_membership',
    });

    const removed = await newBuyer('removed');
    await adminSql`update public.memberships set deleted_at = now() where user_id = ${removed.userId}::uuid`;
    expect(await send('purchase_approved', ev, removed.email, orderRef())).toMatchObject({
      state: 'no_membership',
    });
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  });

  it('no_membership: a delivery with no e-mail is ignored / no_effect, not waiting', async () => {
    const ev = await paidEvent();
    const settled = await send('purchase_approved', ev, '', orderRef());
    expect(settled).toMatchObject({ state: 'ignored', outcome: 'no_effect' });
  });

  it('not_found: a reference the definer refuses (over 200 characters) settles ignored / no_effect and writes nothing', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('longref');
    const settled = await send('purchase_approved', ev, buyer.email, `ord-${'x'.repeat(220)}`);
    expect(settled).toMatchObject({ state: 'ignored', outcome: 'no_effect' });
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  });

  it('not_mapped: a mapping removed after the job read it settles unknown_product, no mapping id, no presence (T-10.1-15)', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('race');
    // `adminSql` has ONE connection, so the lock holder needs a connection of its own.
    const holder = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
      prepare: false,
      max: 1,
    });
    let applying: Promise<unknown> = Promise.resolve();
    try {
      // Hold the event's ticket lock, so the job reads the mapping and then waits inside the definer.
      await holder`select pg_advisory_lock(hashtextextended(${`event_ticket:${ev.eventId}`}, 0))`;
      const id = await deliver(
        integration,
        ticketDelivery('purchase_approved', {
          ref: orderRef(),
          productId: ev.productId,
          email: buyer.email,
        }),
      );
      applying = runApply(id);
      let waiting = 0;
      for (let attempt = 0; attempt < 100 && waiting === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const [row] = await adminSql<{ n: number }[]>`
          select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`;
        waiting = row?.n ?? 0;
      }
      expect(waiting, 'the job must be waiting on the event lock').toBeGreaterThan(0);
      await removePaymentMappings(labTenantId);
      await holder`select pg_advisory_unlock_all()`;
      await applying;
      expect(await eventRow(id)).toMatchObject({
        state: 'unknown_product',
        outcome: null,
        mapping_id: null,
      });
    } finally {
      await holder`select pg_advisory_unlock_all()`;
      await holder.end();
      await applying.catch(() => undefined);
    }
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  });

  it('unknown_product: an event product whose mapping was removed settles unknown_product', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('nomap');
    await removePaymentMappings(labTenantId);
    const settled = await send('purchase_approved', ev, buyer.email, orderRef());
    expect(settled).toMatchObject({ state: 'unknown_product', outcome: null, mapping_id: null });
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  });
});

describe('10.1 the type decides (D-757)', () => {
  it('a subscription type never grants: it settles ignored / no_effect before any member or definer is asked', async () => {
    // An ENDED event: were the grant definer reached, the answer would be `event_ended`, so `no_effect`
    // proves the type branch runs first. An unknown e-mail would be `no_membership` for the same reason.
    const ended = await paidEvent({ startsInMinutes: -240, endsInMinutes: -60 });
    const open = await paidEvent();
    const buyer = await newBuyer('subs');
    for (const type of ['subscription_renewed', 'subscription_late', 'subscription_canceled']) {
      const onEnded = await send(type, ended, buyer.email, orderRef());
      expect(onEnded, `${type} on an ended event`).toMatchObject({
        state: 'ignored',
        outcome: 'no_effect',
      });
      const stranger = await send(type, open, freshEmail(PREFIX, 'nobody'), orderRef());
      expect(stranger, `${type} for an unknown e-mail`).toMatchObject({
        state: 'ignored',
        outcome: 'no_effect',
      });
      const onOpen = await send(type, open, buyer.email, orderRef());
      expect(onOpen, `${type} on an open event`).toMatchObject({
        state: 'ignored',
        outcome: 'no_effect',
      });
    }
    expect(await attendancesOf(open.eventId)).toHaveLength(0);
    expect(await attendancesOf(ended.eventId)).toHaveLength(0);
  });

  it('a subscription type does not remove a presence either', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('keeps');
    const ref = orderRef();
    await send('purchase_approved', ev, buyer.email, ref);
    for (const type of ['subscription_late', 'subscription_canceled']) {
      expect(await send(type, ev, buyer.email, ref)).toMatchObject({ outcome: 'no_effect' });
    }
    expect(await attendancesOf(ev.eventId)).toHaveLength(1);
  });

  it('there is no currency rule for a ticket: a non-BRL or amount-less approved delivery still confirms (A11)', async () => {
    const ev = await paidEvent();
    const usd = await newBuyer('usd');
    const settled = await send('purchase_approved', ev, usd.email, orderRef(), { currency: 'USD' });
    expect(settled).toMatchObject({ state: 'applied', outcome: 'ticket_granted' });
  });
});

describe('10.1 stale', () => {
  it('a late approval of an order already refunded is ignored / stale and creates no presence (PAY-30, T-10.1-08)', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('stale');
    const ref = orderRef();
    const refund = await send('purchase_refunded', ev, buyer.email, ref);
    expect(refund).toMatchObject({ state: 'applied', outcome: 'no_effect' });
    const late = await send('purchase_approved', ev, buyer.email, ref, { late: 1 });
    expect(late).toMatchObject({ state: 'ignored', outcome: 'stale' });
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  });

  it('a chargeback makes the approval of the same order stale too, whatever the body says about recurrence', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('stalecb');
    const ref = orderRef();
    await send('chargeback', ev, buyer.email, ref);
    const late = await send('purchase_approved', ev, buyer.email, ref, { recurring: true });
    expect(late).toMatchObject({ state: 'ignored', outcome: 'stale' });
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  });
});

describe('10.1 refund', () => {
  it.each(['purchase_refunded', 'chargeback'])(
    'removed: a %s by the order reference alone deletes the presence and frees the seat',
    async (type) => {
      const ev = await paidEvent({ capacity: 1 });
      const buyer = await newBuyer('refund');
      const ref = orderRef();
      await send('purchase_approved', ev, buyer.email, ref);
      const settled = await send(type, ev, buyer.email, ref);
      expect(settled).toMatchObject({ state: 'applied', outcome: 'ticket_revoked' });
      expect(await attendancesOf(ev.eventId)).toHaveLength(0);
    },
  );

  it('removed: a refund of a blocked or removed buyer still works, there is no member lookup', async () => {
    const ev = await paidEvent();
    const blocked = await newBuyer('rblocked');
    const removed = await newBuyer('rremoved');
    const blockedRef = orderRef();
    const removedRef = orderRef();
    await send('purchase_approved', ev, blocked.email, blockedRef);
    await send('purchase_approved', ev, removed.email, removedRef);
    await adminSql`update public.memberships set blocked_at = now() where user_id = ${blocked.userId}::uuid`;
    await adminSql`update public.memberships set deleted_at = now() where user_id = ${removed.userId}::uuid`;
    expect(await send('purchase_refunded', ev, '', blockedRef)).toMatchObject({
      outcome: 'ticket_revoked',
    });
    expect(await send('chargeback', ev, '', removedRef)).toMatchObject({
      outcome: 'ticket_revoked',
    });
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  });

  it('kept: a checked-in presence stays and is flagged refunded, the person was there (D-760)', async () => {
    const ev = await paidEvent({ startsInMinutes: -10, endsInMinutes: 120 });
    const buyer = await newBuyer('kept');
    const ref = orderRef();
    await send('purchase_approved', ev, buyer.email, ref);
    await adminSql`
      update public.event_attendances set status = 'checked_in', checked_in_at = now(), checkin_via = 'online'
       where event_id = ${ev.eventId}::uuid`;
    const settled = await send('purchase_refunded', ev, buyer.email, ref);
    expect(settled).toMatchObject({ state: 'applied', outcome: 'ticket_kept' });
    const rows = await attendancesOf(ev.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'checked_in', origin: 'ticket' });
    expect(rows[0]?.refunded_at).toBeTruthy();
  });

  it('not_found: a refund for an unknown order is applied / no_effect and touches nothing', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('known');
    const ref = orderRef();
    await send('purchase_approved', ev, buyer.email, ref);
    const settled = await send('purchase_refunded', ev, buyer.email, orderRef());
    expect(settled).toMatchObject({ state: 'applied', outcome: 'no_effect' });
    expect(await attendancesOf(ev.eventId)).toHaveLength(1);
  });

  it('a refund after the event was cancelled removes the presence; a checked-in one is kept and flagged (the bookkeeping exit)', async () => {
    const ev = await paidEvent({ startsInMinutes: -10, endsInMinutes: 120 });
    const plain = await newBuyer('cplain');
    const present = await newBuyer('cpresent');
    const plainRef = orderRef();
    const presentRef = orderRef();
    await send('purchase_approved', ev, plain.email, plainRef);
    await send('purchase_approved', ev, present.email, presentRef);
    await adminSql`
      update public.event_attendances set status = 'checked_in', checked_in_at = now(), checkin_via = 'online'
       where event_id = ${ev.eventId}::uuid and user_id = ${present.userId}::uuid`;
    await adminSql`
      update public.events set status = 'cancelled', cancelled_at = now()
       where id = ${ev.eventId}::uuid`;

    expect(await send('purchase_refunded', ev, plain.email, plainRef)).toMatchObject({
      state: 'applied',
      outcome: 'ticket_revoked',
    });
    expect(await send('chargeback', ev, present.email, presentRef)).toMatchObject({
      state: 'applied',
      outcome: 'ticket_kept',
    });
    const rows = await attendancesOf(ev.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: present.userId, status: 'checked_in' });
    expect(rows[0]?.refunded_at).toBeTruthy();
  });

  it('a refund never touches a courtesy or a presence made before the link (T-10.1-09)', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('cour');
    const courtesy = await newBuyer('courtesy');
    const ref = orderRef();
    await send('purchase_approved', ev, buyer.email, ref);
    const [tenantRow] = await adminSql<{ tenant_id: string }[]>`
      select tenant_id::text as tenant_id from public.events where id = ${ev.eventId}::uuid`;
    await adminSql`
      insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin)
      values (${tenantRow?.tenant_id ?? ''}::uuid, ${ev.eventId}::uuid, ${courtesy.userId}::uuid,
              'going', now(), 'courtesy')`;
    await send('purchase_refunded', ev, buyer.email, ref);
    const rows = await attendancesOf(ev.eventId);
    expect(rows).toMatchObject([{ user_id: courtesy.userId, origin: 'courtesy', status: 'going' }]);
  });
});

describe('10.1 the payments module being off (EP-06)', () => {
  it('a payment while the module is OFF still confirms; a later refund still removes; turning it on changes no presence', async () => {
    const ev = await paidEvent();
    const buyer = await newBuyer('moduleoff');
    const keeper = await newBuyer('modulekeep');
    const ref = orderRef();
    await withPaymentsGate(
      labTenantId,
      async () => {
        expect(await send('purchase_approved', ev, buyer.email, ref)).toMatchObject({
          state: 'applied',
          outcome: 'ticket_granted',
        });
        expect(await send('purchase_approved', ev, keeper.email, orderRef())).toMatchObject({
          outcome: 'ticket_granted',
        });
      },
      { enabled: false },
    );
    const before = await attendancesOf(ev.eventId);
    expect(before).toHaveLength(2);

    await withPaymentsGate(labTenantId, async () => {
      expect(await attendancesOf(ev.eventId)).toEqual(before);
    });

    await withPaymentsGate(
      labTenantId,
      async () => {
        expect(await send('purchase_refunded', ev, buyer.email, ref)).toMatchObject({
          outcome: 'ticket_revoked',
        });
      },
      { enabled: false },
    );
    const after = await attendancesOf(ev.eventId);
    expect(after).toHaveLength(1);
    expect(after[0]?.user_id).toBe(keeper.userId);
  });
});

describe('10.1 the kind dispatch guard', () => {
  it('a kind that is neither access, store_product nor event ends in the guard, never in a store write', () => {
    expect(() => unsupportedMappingKind('seat' as never)).toThrow(/not handled/);
  });
});
