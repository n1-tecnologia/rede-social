import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  attendancesOf,
  deliver,
  deliverAndApply,
  eventRow,
  freshEmail,
  personWithEmail,
  removeTicketEvents,
  runApply,
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
} from './setup';

/**
 * 10.1-05 (TICK-03, TICK-07..TICK-12, TICK-17, TICK-21; D-749..D-752, D-756..D-760) against the live local
 * stack: a signed `fake` delivery of an EVENT product goes through the REAL route and inbox, the REAL
 * `kernel.payment-event` handler applies it through `app.event_gateway_grant` / `_revoke`, and the buyer's
 * notice is read from the REAL fan-out.
 *
 *  - `10.1 tracer`: one path through every layer, from the signed delivery to the `ticket` presence, the
 *    `payments.ticket_confirmed` event and the in-app row.
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
    integration = await seedPaymentIntegration(labTenantId);
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
