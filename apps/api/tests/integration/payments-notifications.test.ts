import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  bootstrapCode,
  deliverAndApply,
  freshEmail,
  membershipFacts,
  notificationCount,
  type Person,
  personWithEmail,
} from './payments-apply-fixtures';
import {
  adminSql,
  api,
  HOSTS,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  SEED_PASSWORD,
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  seedPaymentMapping,
  signInAs,
  withPaymentsGate,
} from './setup';

/**
 * 09.1-12 (PAY-17, PAY-18, PAY-24; D-496..D-500, D-506) against the live local stack: what the webhook's
 * apply job makes the notifications module do.
 *
 *  - `09.1 tracer`: a signed `subscription_canceled` for a member's access, applied by the REAL job,
 *    makes the notifications module's subscriber to `membership.access_cut` (a) forget that member's
 *    push devices in the member's tenant and (b) publish `notifications.changed` with `{ kind:
 *    'membership' }` on the member's own user topic; the member's next counters request answers 403
 *    `SUBSCRIPTION_PENDING`; the session is NOT revoked (D-499); a return publishes and deletes
 *    nothing; a failing first step never stops the nudge or the job (flagged assumption P36).
 *
 * Every identity carries the prefix below; the integration, its events and its mappings are removed in
 * `afterEach` / `afterAll`. Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

const PREFIX = 'paynotif';
const FAKE_PUSH = 'https://push.fake.test/sub';

let labTenantId = '';
let demoTenantId = '';
let integration: SeededPaymentIntegration;

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

/** One push device row for `userId` in the lab tenant. */
async function addDevice(userId: string, tenantId = labTenantId): Promise<void> {
  await adminSql`
    insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
    values (${tenantId}::uuid, ${userId}::uuid, ${`${FAKE_PUSH}/${crypto.randomUUID()}`}, 'k', 'a')`;
}

async function devicesOf(userId: string, tenantId = labTenantId): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.push_subscriptions
     where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid`;
  return row?.n ?? -1;
}

async function dbNow(): Promise<Date> {
  const [row] = await adminSql<{ now: Date }[]>`select now() as now`;
  return row?.now ?? new Date();
}

/** The committed `notifications.changed` signals on `userId`'s topic in the lab tenant since `since`. */
async function signalsOf(userId: string, since: Date) {
  return adminSql<{ payload: Record<string, unknown> }[]>`
    select payload from realtime.messages
     where topic = ${`tenant:${labTenantId}:user:${userId}`}
       and event = 'notifications.changed'
       and inserted_at >= ${since}::timestamptz`;
}

const counters = (person: Person, host: keyof typeof HOSTS = 'lab') =>
  api.request('/v1/me/counters', {
    headers: { [TENANT_HOST_HEADER]: HOSTS[host], authorization: `Bearer ${person.token}` },
  });

const errorCode = async (res: Response): Promise<string> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code ?? `HTTP_${res.status}`;

/** Gives `person` a second membership in rede-demo (a shared identity: one account, two communities). */
async function joinDemo(person: Person): Promise<void> {
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${demoTenantId}::uuid, ${person.userId}::uuid, 'member', 'active')`;
}

beforeAll(async () => {
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  labTenantId = rows.find((row) => row.slug === 'rede-lab')?.id ?? '';
  demoTenantId = rows.find((row) => row.slug === 'rede-demo')?.id ?? '';
  if (!labTenantId || !demoTenantId) throw new Error('seed tenants missing: run pnpm db:seed');
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await removeIdentitiesByPrefix(PREFIX);
  await removePaymentIntegrations(labTenantId);
  await removePaymentIntegrations(demoTenantId);
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
}, 60_000);

afterEach(async () => {
  await adminSql`drop trigger if exists paynotif_refuse_delete on public.push_subscriptions`;
  await adminSql`drop function if exists public.paynotif_refuse_delete()`;
  await removePaymentIntegrations(labTenantId);
  await removePaymentIntegrations(demoTenantId);
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
});

afterAll(async () => {
  await removePaymentIntegrations(labTenantId);
  await removePaymentIntegrations(demoTenantId);
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
  await removeIdentitiesByPrefix(PREFIX);
  await adminSql`delete from public.notifications where dedupe_key like 'payments.purchase_confirmed:%' and tenant_id = ${labTenantId}::uuid and user_id in (select id from public.users where email like ${`${PREFIX}-%`})`;
  await stopBoss();
}, 60_000);

describe('09.1 tracer', () => {
  it('a cancelled subscription forgets the member’s devices and nudges the open app, which meets the 403; the session stays', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const member = await personWithEmail(freshEmail(PREFIX, 'cut'), 'lab');
    const other = await personWithEmail(freshEmail(PREFIX, 'oth'), 'lab');
    await joinDemo(member);
    const ref = `sub-${crypto.randomUUID()}`;
    const body = (type: string) => sale(type, { ref, productId, email: member.email });

    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(integration, body('purchase_approved'));
      expect(await bootstrapCode(member)).toBe('OK');
      await addDevice(member.userId);
      await addDevice(member.userId);
      await addDevice(other.userId);
      const facts = await membershipFacts(member.userId, labTenantId);
      const since = await dbNow();

      // the cut: devices gone (the other member's stays), one signal on the member's own topic
      const cut = await deliverAndApply(integration, body('subscription_canceled'));
      expect(cut).toMatchObject({ state: 'applied', outcome: 'access_cut' });
      expect(await devicesOf(member.userId)).toBe(0);
      expect(await devicesOf(other.userId)).toBe(1);
      const signals = await signalsOf(member.userId, since);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.payload.kind).toBe('membership');
      expect(Object.keys(signals[0]?.payload ?? {}).sort()).toEqual(['id', 'kind']);
      expect((await signalsOf(other.userId, since)).length).toBe(0);

      // the open app's refetch meets the cut screen's 403
      const refetch = await counters(member);
      expect(refetch.status).toBe(403);
      expect(await errorCode(refetch)).toBe('SUBSCRIPTION_PENDING');

      // D-499: the session is not revoked. The same access token still works where the person has access,
      // and signing in again issues a token (the account is shared with another community).
      expect((await bootstrap(member, 'demo')).status).toBe(200);
      expect(await signInAs(member.email, SEED_PASSWORD)).toBeTruthy();
      expect(await membershipFacts(member.userId, labTenantId)).toEqual(facts);

      // the return publishes nothing and deletes nothing
      await addDevice(member.userId);
      const afterCut = await dbNow();
      const renewed = await deliverAndApply(integration, body('subscription_renewed'));
      expect(renewed).toMatchObject({ state: 'applied', outcome: 'access_granted' });
      expect(await devicesOf(member.userId)).toBe(1);
      expect((await signalsOf(member.userId, afterCut)).length).toBe(0);
      expect((await counters(member)).status).toBe(200);
    });
  });

  it('a staff e-mail, a gate-off tenant and a second product that keeps the member active emit nothing and delete nothing', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const [a, b] = await Promise.all([accessProduct('Plano A'), accessProduct('Plano B')]);
    const productA = await productIdOf(a.id);
    const productB = await productIdOf(b.id);
    const staff = await personWithEmail(freshEmail(PREFIX, 'adm'), 'lab', 'admin_tenant');
    const member = await personWithEmail(freshEmail(PREFIX, 'two'), 'lab');
    const refA = `sub-${crypto.randomUUID()}`;
    const refB = `sub-${crypto.randomUUID()}`;

    await withPaymentsGate(labTenantId, async () => {
      // staff: the row goes inactive, nobody is cut, the device stays and nothing is published
      await addDevice(staff.userId);
      const refStaff = `sub-${crypto.randomUUID()}`;
      const staffSale = (type: string) =>
        sale(type, { ref: refStaff, productId: productA, email: staff.email });
      await deliverAndApply(integration, staffSale('purchase_approved'));
      let since = await dbNow();
      await deliverAndApply(integration, staffSale('subscription_canceled'));
      expect(await devicesOf(staff.userId)).toBe(1);
      expect((await signalsOf(staff.userId, since)).length).toBe(0);

      // a second product keeps the member active: cancelling one is not a cut
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref: refA, productId: productA, email: member.email }),
      );
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref: refB, productId: productB, email: member.email }),
      );
      await addDevice(member.userId);
      since = await dbNow();
      await deliverAndApply(
        integration,
        sale('subscription_canceled', { ref: refA, productId: productA, email: member.email }),
      );
      expect(await bootstrapCode(member)).toBe('OK');
      expect(await devicesOf(member.userId)).toBe(1);
      expect((await signalsOf(member.userId, since)).length).toBe(0);
    });

    // a tenant whose gate is off: the row goes inactive, nobody is cut, nothing moves
    await withPaymentsGate(
      labTenantId,
      async () => {
        const open = await personWithEmail(freshEmail(PREFIX, 'off'), 'lab');
        const refOff = `sub-${crypto.randomUUID()}`;
        await deliverAndApply(
          integration,
          sale('purchase_approved', { ref: refOff, productId: productA, email: open.email }),
        );
        await addDevice(open.userId);
        const since = await dbNow();
        const settled = await deliverAndApply(
          integration,
          sale('subscription_canceled', { ref: refOff, productId: productA, email: open.email }),
        );
        expect(settled.outcome).toBe('access_cut');
        expect(await devicesOf(open.userId)).toBe(1);
        expect((await signalsOf(open.userId, since)).length).toBe(0);
        expect(await bootstrapCode(open)).toBe('OK');
      },
      { gate: false },
    );
  });

  it('P36: a failing device cleanup is logged and swallowed, the nudge still goes out and the apply result is unchanged', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const member = await personWithEmail(freshEmail(PREFIX, 'brk'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    const body = (type: string) => sale(type, { ref, productId, email: member.email });

    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(integration, body('purchase_approved'));
      await addDevice(member.userId);
      // Step 1 cannot delete a device: the database refuses it.
      await adminSql`
        create function public.paynotif_refuse_delete() returns trigger language plpgsql as $$
        begin raise exception 'paynotif: delete refused'; end $$`;
      await adminSql`
        create trigger paynotif_refuse_delete before delete on public.push_subscriptions
        for each row execute function public.paynotif_refuse_delete()`;
      const since = await dbNow();

      const cut = await deliverAndApply(integration, body('subscription_canceled'));
      expect(cut).toMatchObject({ state: 'applied', outcome: 'access_cut' });
      expect(await devicesOf(member.userId)).toBe(1);
      const signals = await signalsOf(member.userId, since);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.payload.kind).toBe('membership');
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      expect(await notificationCount(member.userId)).toBe(0);
    });
  });
});
