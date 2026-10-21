import type { MembershipAccessCut } from '@rede-social/contracts/payments';
import { subscribe } from '@rede-social/core/server/events/bus';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCode,
  deliver,
  deliverAndApply,
  eventRow,
  freshEmail,
  gatewayRowsOf,
  membershipFacts,
  notificationCount,
  personWithEmail,
  runApply,
} from './payments-apply-fixtures';
import {
  adminSql,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  seedPaymentMapping,
  withPaymentsGate,
} from './setup';

/**
 * 09.1-07 (PAY-07, PAY-11, PAY-13, PAY-17, PAY-18, PAY-23..PAY-27, PAY-29; D-490, D-494, D-496, D-499,
 * D-500, D-505, D-506, D-509) against the live local stack: a signed `fake` delivery goes through the
 * REAL route and inbox, the REAL `kernel.payment-event` handler applies it, and a REAL gated request
 * proves what a member may do afterwards.
 *
 *  - `09.1 tracer`: one subscription's whole life (approved, canceled or late or refunded or charged
 *    back, renewed) for an e-mail that has no account when the purchase arrives.
 *  - `09.1 job`: the handler's own contract (payload, replay, failure and retry).
 *  - `09.1 store events`: the store branch and the visible states (Task 2 of the plan).
 *
 * Every identity carries the prefix below (its access rows go with it); the integration, its events and
 * its mappings are removed in `afterEach` / `afterAll`. Test ORDER is load-bearing (`fileParallelism:
 * false`, declaration order).
 */

const PREFIX = 'payapply';

let labTenantId = '';
let demoTenantId = '';
let integration: SeededPaymentIntegration;

const cuts: MembershipAccessCut[] = [];
let unsubscribe: () => void = () => {};

/** An access mapping of rede-lab with a unique gateway product id. */
const accessProduct = (name = 'Plano') =>
  seedPaymentMapping(labTenantId, {
    kind: 'access',
    name,
    externalProductId: `acc-${crypto.randomUUID()}`,
  });

const productIdOf = async (mappingId: string): Promise<string> => {
  const [row] = await adminSql<{ external_product_id: string }[]>`
    select external_product_id from public.payment_products where id = ${mappingId}::uuid`;
  return row?.external_product_id ?? '';
};

/** A neutral `fake` delivery body for a recurring sale. */
const sale = (
  type: string,
  fields: { ref: string; productId: string; email: string } & Record<string, unknown>,
) => {
  const { ref, productId, email, ...rest } = fields;
  return {
    type,
    externalRef: ref,
    productId,
    email,
    amountCents: 4990,
    currency: 'BRL',
    recurring: true,
    validUntil: '2027-01-01T00:00:00.000Z',
    ...rest,
  };
};

beforeAll(async () => {
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  labTenantId = rows.find((row) => row.slug === 'rede-lab')?.id ?? '';
  demoTenantId = rows.find((row) => row.slug === 'rede-demo')?.id ?? '';
  if (!labTenantId || !demoTenantId) throw new Error('seed tenants missing: run pnpm db:seed');
  await removeIdentitiesByPrefix(PREFIX);
  await removePaymentIntegrations(labTenantId);
  await removePaymentIntegrations(demoTenantId);
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
  unsubscribe = subscribe('membership.access_cut', async (payload) => {
    cuts.push(payload);
  });
}, 60_000);

afterEach(async () => {
  await removePaymentIntegrations(labTenantId);
  await removePaymentIntegrations(demoTenantId);
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
  cuts.length = 0;
});

afterAll(async () => {
  unsubscribe();
  await removePaymentIntegrations(labTenantId);
  await removePaymentIntegrations(demoTenantId);
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
  await removeIdentitiesByPrefix(PREFIX);
  await stopBoss();
}, 60_000);

describe('09.1 tracer', () => {
  it('a subscription whole life: bought before the account exists, cut on cancel, returned on renewal, nothing else moves', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const email = freshEmail(PREFIX, 'ana');
    const ref = `sub-${crypto.randomUUID()}`;

    // (a) the purchase arrives while the e-mail has NO account (D-490, D-493)
    const approved = await deliverAndApply(
      integration,
      sale('purchase_approved', { ref, productId, email }),
    );
    expect(approved).toMatchObject({
      state: 'applied',
      outcome: 'access_granted',
      mapping_id: mapping.id,
      tenant_id: labTenantId,
    });
    expect(approved.applied_at).not.toBeNull();
    const rows = await gatewayRowsOf(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: labTenantId,
      status: 'active',
      terminal: false,
      provider: 'fake',
      external_ref: ref,
      mapping_id: mapping.id,
    });
    expect(rows[0]?.valid_until?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(rows[0]?.last_event_at).not.toBeNull();

    await withPaymentsGate(labTenantId, async () => {
      // (b) the person signs up later: the gated tenant admits them
      const member = await personWithEmail(email, 'lab');
      expect(await bootstrapCode(member)).toBe('OK');
      const facts = await membershipFacts(member.userId, labTenantId);
      const notices = await notificationCount(member.userId);

      // (c) the cancel: the very next request is refused, exactly one signal, nothing else moves
      const canceled = await deliverAndApply(
        integration,
        sale('subscription_canceled', { ref, productId, email }),
      );
      expect(canceled).toMatchObject({ state: 'applied', outcome: 'access_cut' });
      expect((await gatewayRowsOf(email))[0]).toMatchObject({
        status: 'inactive',
        terminal: false,
      });
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      expect(cuts).toEqual([
        { tenantId: labTenantId, userId: member.userId, membershipId: member.membershipId },
      ]);
      expect(await membershipFacts(member.userId, labTenantId)).toEqual(facts);

      // (d) the renewal: back with no admin action, no signal, no notification of any kind
      const renewed = await deliverAndApply(
        integration,
        sale('subscription_renewed', { ref, productId, email }),
      );
      expect(renewed).toMatchObject({ state: 'applied', outcome: 'access_granted' });
      expect(await bootstrapCode(member)).toBe('OK');
      expect(cuts).toHaveLength(1);
      expect(await notificationCount(member.userId)).toBe(notices);
      expect(await membershipFacts(member.userId, labTenantId)).toEqual(facts);
      expect(await gatewayRowsOf(email)).toHaveLength(1);
    });
  });

  it.each([
    ['subscription_late', 'subscription_renewed'],
    ['purchase_refunded', 'subscription_renewed'],
    ['chargeback', 'subscription_renewed'],
    ['purchase_refunded', 'purchase_approved'],
  ])('%s cuts a recurring sale and %s returns it (D-496, D-505)', async (cutType, returnType) => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const member = await personWithEmail(freshEmail(PREFIX, 'seq'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    const body = (type: string) => sale(type, { ref, productId, email: member.email });

    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(integration, body('purchase_approved'));
      expect(await bootstrapCode(member)).toBe('OK');

      const cut = await deliverAndApply(integration, body(cutType));
      expect(cut).toMatchObject({ state: 'applied', outcome: 'access_cut' });
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      expect(cuts).toHaveLength(1);

      const back = await deliverAndApply(integration, body(returnType));
      expect(back).toMatchObject({ state: 'applied', outcome: 'access_granted' });
      expect(await bootstrapCode(member)).toBe('OK');
      expect(cuts).toHaveLength(1);
    });
  });

  it('D-494: with two access products cancelling one leaves the other active, no cut and no event', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const [a, b] = await Promise.all([accessProduct('Plano A'), accessProduct('Plano B')]);
    const member = await personWithEmail(freshEmail(PREFIX, 'two'), 'lab');
    const refA = `sub-${crypto.randomUUID()}`;
    const refB = `sub-${crypto.randomUUID()}`;
    const productA = await productIdOf(a.id);
    const productB = await productIdOf(b.id);

    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref: refA, productId: productA, email: member.email }),
      );
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref: refB, productId: productB, email: member.email }),
      );
      expect(await gatewayRowsOf(member.email)).toHaveLength(2);

      await deliverAndApply(
        integration,
        sale('subscription_canceled', { ref: refA, productId: productA, email: member.email }),
      );
      expect(await bootstrapCode(member)).toBe('OK');
      expect(cuts).toHaveLength(0);

      await deliverAndApply(
        integration,
        sale('subscription_canceled', { ref: refB, productId: productB, email: member.email }),
      );
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      expect(cuts).toHaveLength(1);
    });
  });

  it('emits nothing for staff, for a tenant whose gate is off, and for a return (D-499, D-500, PR-4)', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const staff = await personWithEmail(freshEmail(PREFIX, 'adm'), 'lab', 'admin_tenant');
    const member = await personWithEmail(freshEmail(PREFIX, 'off'), 'lab');
    const run = async (email: string) => {
      const ref = `sub-${crypto.randomUUID()}`;
      await deliverAndApply(integration, sale('purchase_approved', { ref, productId, email }));
      return deliverAndApply(integration, sale('subscription_canceled', { ref, productId, email }));
    };

    // staff: gate on, role exempt
    await withPaymentsGate(labTenantId, async () => {
      expect((await run(staff.email)).outcome).toBe('access_cut');
      expect(await bootstrapCode(staff)).toBe('OK');
    });
    // gate off: the row still goes inactive, nobody is cut
    await withPaymentsGate(
      labTenantId,
      async () => {
        expect((await run(member.email)).outcome).toBe('access_cut');
        expect(await bootstrapCode(member)).toBe('OK');
      },
      { gate: false },
    );
    expect(cuts).toHaveLength(0);
  });

  it('PAY-29 / T-09.1-22: a delivery signed with tenant A token that names tenant B product is unknown_product and writes nothing anywhere', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    await seedPaymentIntegration(demoTenantId);
    const foreign = await seedPaymentMapping(demoTenantId, {
      kind: 'access',
      name: 'Plano do outro',
      externalProductId: `acc-${crypto.randomUUID()}`,
    });
    const productId = await productIdOf(foreign.id);
    const email = freshEmail(PREFIX, 'pin');
    const ref = `sub-${crypto.randomUUID()}`;

    const settled = await deliverAndApply(
      integration,
      sale('purchase_approved', { ref, productId, email }),
    );
    expect(settled).toMatchObject({ state: 'unknown_product', tenant_id: labTenantId });
    expect(settled.mapping_id).toBeNull();
    expect(await gatewayRowsOf(email)).toEqual([]);
    const [leaked] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.access_grants where external_ref = ${ref}`;
    expect(leaked?.n).toBe(0);
  });
});

describe('09.1 job', () => {
  it('drops a malformed payload without throwing', async () => {
    for (const payload of [undefined, null, {}, { eventId: 'nope' }, { eventId: 42 }, []]) {
      await expect(
        (await import('@rede-social/core/server/payments/event-job')).paymentEventJob.handler(
          payload as never,
        ),
      ).resolves.toBeUndefined();
    }
  });

  it('a missing event is logged and returned, never thrown', async () => {
    await expect(runApply(crypto.randomUUID())).resolves.toBeUndefined();
  });

  it('P12: applying the same event twice leaves one row, one applied event and no second emission', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const member = await personWithEmail(freshEmail(PREFIX, 'twice'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;

    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref, productId, email: member.email }),
      );
      const eventId = await deliver(
        integration,
        sale('subscription_canceled', { ref, productId, email: member.email }),
      );
      await runApply(eventId);
      const first = await eventRow(eventId);
      const [rowBefore] = await gatewayRowsOf(member.email);
      expect(cuts).toHaveLength(1);

      await runApply(eventId);
      const second = await eventRow(eventId);
      const [rowAfter] = await gatewayRowsOf(member.email);
      expect(second).toEqual(first);
      expect(rowAfter?.updated_at).toEqual(rowBefore?.updated_at);
      expect(await gatewayRowsOf(member.email)).toHaveLength(1);
      expect(cuts).toHaveLength(1);
    });
  });

  it('Pitfall 7: a thrown error rolls the write back, marks the event failed and rethrows; the retry converges', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const email = freshEmail(PREFIX, 'boom');
    const ref = `boom-${crypto.randomUUID()}`;
    const eventId = await deliver(
      integration,
      sale('purchase_approved', { ref, productId, email }),
    );

    // A trigger that refuses exactly this reference makes the access write throw.
    await adminSql.unsafe(`
      create or replace function public.payapply_boom() returns trigger language plpgsql as $$
      begin
        if new.external_ref like 'boom-%' then raise exception 'payapply boom'; end if;
        return new;
      end $$`);
    await adminSql.unsafe(`
      create trigger payapply_boom before insert on public.access_grants
      for each row execute function public.payapply_boom()`);
    try {
      await expect(runApply(eventId)).rejects.toThrow();
      expect(await eventRow(eventId)).toMatchObject({ state: 'failed', outcome: null });
      expect(await gatewayRowsOf(email)).toEqual([]);
    } finally {
      await adminSql.unsafe('drop trigger if exists payapply_boom on public.access_grants');
      await adminSql.unsafe('drop function if exists public.payapply_boom()');
    }

    // `failed` is re-appliable: the retry (or the gateway's manual resend) converges.
    await runApply(eventId);
    expect(await eventRow(eventId)).toMatchObject({ state: 'applied', outcome: 'access_granted' });
    expect(await gatewayRowsOf(email)).toHaveLength(1);
  });

  it('an event whose state is already settled is an idempotent no-op even for a different outcome', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const eventId = await deliver(integration, { type: 'boleto_generated' });
    await runApply(eventId);
    const settled = await eventRow(eventId);
    expect(settled).toMatchObject({ state: 'ignored', outcome: 'no_effect' });
    await runApply(eventId);
    expect(await eventRow(eventId)).toEqual(settled);
  });
});
