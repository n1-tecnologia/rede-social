import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  bootstrapCode,
  deliver,
  deliverAndApply,
  eventRow,
  freshEmail,
  membershipFacts,
  notificationCount,
  type Person,
  personWithEmail,
  runApply,
} from './payments-apply-fixtures';
import {
  adminSql,
  api,
  HOSTS,
  notificationJobsOf,
  pushSendJobsOf,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  runNotificationJobs,
  SEED_PASSWORD,
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  seedPaymentMapping,
  signInAs,
  withPaymentsGate,
  withStoreEnabled,
} from './setup';

/**
 * 09.1-12 (PAY-17, PAY-18, PAY-24; D-496..D-500, D-506) against the live local stack: what the webhook's
 * apply job makes the notifications module do.
 *
 *  - `09.1 purchase confirmed` / `09.1 silence`: the buyer's one "Compra confirmada" notice (in-app row,
 *    push job, user-topic signal) and the proof that nothing else the webhook does notifies anyone
 *    (D-498, D-500, PR-6).
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

/* ── Task 2: the buyer's "Compra confirmada" notice and the silence of everything else ─────────── */

const KIND = 'payments.purchase_confirmed';
const STORE_NAME = `${PREFIX}-store`;
const PRICE = 99_900;

const storeSale = (
  type: string,
  f: { ref: string; productId: string; email: string } & Record<string, unknown>,
) => {
  const { ref, productId, email, ...rest } = f;
  return {
    type,
    externalRef: ref,
    productId,
    email,
    amountCents: 12_345,
    currency: 'BRL',
    recurring: false,
    ...rest,
  };
};

/** Marks every waiting fan-out / push job of the lab tenant done, so a case counts only its own. */
async function closeWaitingJobs(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name in ('notifications.fanout', 'notifications.push-send') and state = 'created'
       and data->>'tenantId' = ${labTenantId}`;
}

type NoticeRow = {
  user_id: string;
  kind: string;
  dedupe_key: string;
  actor_user_id: string | null;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown>;
};

/** Every payments notice row of a tenant, oldest first. */
async function noticeRows(tenantId: string): Promise<NoticeRow[]> {
  return adminSql<NoticeRow[]>`
    select user_id::text as user_id, kind, dedupe_key, actor_user_id::text as actor_user_id,
           subject_type, subject_id::text as subject_id, payload
      from public.notifications
     where tenant_id = ${tenantId}::uuid and kind like 'payments.%'
     order by created_at, id`;
}

/** The push jobs of the lab tenant for the confirmation kind, oldest first. */
async function confirmationPushJobs() {
  return (await pushSendJobsOf(labTenantId)).filter(
    (job) => (job.data as { kind?: string }).kind === KIND,
  );
}

describe('09.1 purchase confirmed', () => {
  let restoreStore: () => Promise<void> = async () => {};
  let labAdmin = '';
  let community = '';
  let product = '';

  const mapStore = async () => {
    const externalProductId = `sp-${crypto.randomUUID()}`;
    await seedPaymentMapping(labTenantId, {
      kind: 'store_product',
      targetId: product,
      externalProductId,
    });
    return externalProductId;
  };

  async function sweepStore(): Promise<void> {
    const products = adminSql`select id from public.store_products where name like ${`${STORE_NAME}%`}`;
    await adminSql`delete from public.store_entitlements where product_id in (${products})`;
    await adminSql`delete from public.store_orders where product_id in (${products})`;
    await removePaymentMappings(labTenantId);
    await adminSql`delete from public.store_products where name like ${`${STORE_NAME}%`}`;
    await adminSql`delete from public.communities where name like ${`${STORE_NAME}%`}`;
  }

  beforeAll(async () => {
    restoreStore = await withStoreEnabled('lab');
    const [lab] = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.memberships
       where tenant_id = ${labTenantId}::uuid and role = 'admin_tenant' limit 1`;
    labAdmin = lab?.user_id ?? '';
    await sweepStore();
    const [c] = await adminSql<{ id: string }[]>`
      insert into public.communities (tenant_id, created_by_user_id, name, slug)
      values (${labTenantId}::uuid, ${labAdmin}::uuid, ${`${STORE_NAME} comunidade`}, ${`${STORE_NAME}-c`})
      returning id::text as id`;
    community = c?.id ?? '';
    const [p] = await adminSql<{ id: string }[]>`
      insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, status)
      values (${labTenantId}::uuid, ${labAdmin}::uuid, ${`${STORE_NAME} curso`}, ${PRICE}, 'active')
      returning id::text as id`;
    product = p?.id ?? '';
    await adminSql`
      insert into public.store_product_communities (tenant_id, product_id, community_id)
      values (${labTenantId}::uuid, ${product}::uuid, ${community}::uuid)`;
    await closeWaitingJobs();
  }, 60_000);

  afterAll(async () => {
    await closeWaitingJobs();
    await sweepStore();
    await restoreStore();
  }, 60_000);

  it('a signed approved delivery notifies the buyer once, in-app and by push, and nobody else', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const gateway = await mapStore();
    const buyer = await personWithEmail(freshEmail(PREFIX, 'buyer'), 'lab');
    const bystander = await personWithEmail(freshEmail(PREFIX, 'by'), 'lab');
    await addDevice(buyer.userId);
    await addDevice(bystander.userId);
    const pushBefore = (await confirmationPushJobs()).length;
    const demoBefore = (await noticeRows(demoTenantId)).length;
    const since = await dbNow();
    const ref = `ord-${crypto.randomUUID()}`;
    const body = storeSale('purchase_approved', { ref, productId: gateway, email: buyer.email });

    const eventId = await deliver(integration, body);
    await runApply(eventId);
    expect(await eventRow(eventId)).toMatchObject({ state: 'applied', outcome: 'product_granted' });
    expect(await runNotificationJobs(labTenantId)).toBeGreaterThan(0);

    // ONE row, for the buyer, with no actor, the two facts and a sink-instant dedupe key
    const rows = await noticeRows(labTenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: buyer.userId,
      kind: KIND,
      actor_user_id: null,
      subject_type: 'product',
      subject_id: product,
      payload: { productId: product, productName: `${STORE_NAME} curso` },
    });
    expect(Object.keys(rows[0]?.payload ?? {}).sort()).toEqual(['productId', 'productName']);
    expect(rows[0]?.dedupe_key.startsWith(`${KIND}:${product}:`)).toBe(true);
    // nobody else: not the lab admin, not another member, nothing in the other tenant
    expect(rows.filter((row) => row.user_id !== buyer.userId)).toEqual([]);
    expect((await noticeRows(demoTenantId)).length).toBe(demoBefore);
    expect(await notificationCount(bystander.userId)).toBe(0);
    const adminPayments = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where user_id = ${labAdmin}::uuid and kind like 'payments.%'`;
    expect(adminPayments[0]?.n).toBe(0);

    // ONE push job carrying the hint, for the buyer only
    const jobs = await confirmationPushJobs();
    expect(jobs).toHaveLength(pushBefore + 1);
    const job = jobs[jobs.length - 1]?.data as {
      userIds: string[];
      dedupeKey: string;
      push: Record<string, unknown>;
    };
    expect(job.userIds).toEqual([buyer.userId]);
    expect(job.dedupeKey).toBe(rows[0]?.dedupe_key);
    expect(job.push).toMatchObject({
      title: 'tenant',
      body: `Compra confirmada: ${STORE_NAME} curso`,
      url: `/loja/${product}`,
      ttlSeconds: 86_400,
      urgency: 'normal',
      renotify: false,
    });

    // the existing sink nudges the buyer's own topic, ids only
    const signals = await signalsOf(buyer.userId, since);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.payload.kind).toBe(KIND);
    expect((await signalsOf(bystander.userId, since)).length).toBe(0);

    // a replay of the apply and of the fan-out adds nothing
    await runApply(eventId);
    await runNotificationJobs(labTenantId);
    expect(await noticeRows(labTenantId)).toHaveLength(1);
    expect(await confirmationPushJobs()).toHaveLength(pushBefore + 1);

    // a refund adds nothing; a repurchase after it is a new notice
    const refunded = await deliverAndApply(
      integration,
      storeSale('purchase_refunded', { ref, productId: gateway, email: buyer.email }),
    );
    expect(refunded.state).toBe('applied');
    await runNotificationJobs(labTenantId);
    expect(await noticeRows(labTenantId)).toHaveLength(1);
    expect(await confirmationPushJobs()).toHaveLength(pushBefore + 1);

    const again = await deliverAndApply(
      integration,
      storeSale('purchase_approved', {
        ref: `ord-${crypto.randomUUID()}`,
        productId: gateway,
        email: buyer.email,
      }),
    );
    expect(again).toMatchObject({ state: 'applied', outcome: 'product_granted' });
    await runNotificationJobs(labTenantId);
    const after = await noticeRows(labTenantId);
    expect(after).toHaveLength(2);
    expect(new Set(after.map((row) => row.dedupe_key)).size).toBe(2);
    expect(after.every((row) => row.user_id === buyer.userId)).toBe(true);
  });

  it('a buyer whose access was cut still gets the in-app row (D-498) and has no devices, so no push', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const gateway = await mapStore();
    const access = await accessProduct();
    const accessId = await productIdOf(access.id);
    const buyer = await personWithEmail(freshEmail(PREFIX, 'cutbuyer'), 'lab');
    const subRef = `sub-${crypto.randomUUID()}`;
    const subBody = (type: string) =>
      sale(type, { ref: subRef, productId: accessId, email: buyer.email });

    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(integration, subBody('purchase_approved'));
      await addDevice(buyer.userId);
      await deliverAndApply(integration, subBody('subscription_canceled'));
      expect(await bootstrapCode(buyer)).toBe('SUBSCRIPTION_PENDING');
      expect(await devicesOf(buyer.userId)).toBe(0);
      const pushBefore = (await confirmationPushJobs()).length;
      const rowsBefore = (await noticeRows(labTenantId)).filter(
        (row) => row.user_id === buyer.userId,
      );

      const bought = await deliverAndApply(
        integration,
        storeSale('purchase_approved', {
          ref: `ord-${crypto.randomUUID()}`,
          productId: gateway,
          email: buyer.email,
        }),
      );
      expect(bought).toMatchObject({ state: 'applied', outcome: 'product_granted' });
      await runNotificationJobs(labTenantId);

      const rows = (await noticeRows(labTenantId)).filter((row) => row.user_id === buyer.userId);
      expect(rows).toHaveLength(rowsBefore.length + 1);
      expect(rows[rows.length - 1]?.kind).toBe(KIND);
      expect(await devicesOf(buyer.userId)).toBe(0);
      expect(await confirmationPushJobs()).toHaveLength(pushBefore);
    });
  });
});

describe('09.1 silence', () => {
  let restoreStore: () => Promise<void> = async () => {};
  let labAdmin = '';
  let adminToken = '';
  let community = '';
  let product = '';

  async function sweepStore(): Promise<void> {
    const products = adminSql`select id from public.store_products where name like ${`${STORE_NAME}-quiet%`}`;
    await adminSql`delete from public.store_entitlements where product_id in (${products})`;
    await adminSql`delete from public.store_orders where product_id in (${products})`;
    await removePaymentMappings(labTenantId);
    await adminSql`delete from public.store_products where name like ${`${STORE_NAME}-quiet%`}`;
    await adminSql`delete from public.communities where name like ${`${STORE_NAME}-quiet%`}`;
  }

  beforeAll(async () => {
    restoreStore = await withStoreEnabled('lab');
    const [lab] = await adminSql<{ user_id: string; email: string }[]>`
      select m.user_id::text as user_id, u.email
        from public.memberships m join public.users u on u.id = m.user_id
       where m.tenant_id = ${labTenantId}::uuid and m.role = 'admin_tenant' limit 1`;
    labAdmin = lab?.user_id ?? '';
    adminToken = await signInAs(lab?.email ?? '', SEED_PASSWORD);
    await sweepStore();
    const [c] = await adminSql<{ id: string }[]>`
      insert into public.communities (tenant_id, created_by_user_id, name, slug)
      values (${labTenantId}::uuid, ${labAdmin}::uuid, ${`${STORE_NAME}-quiet comunidade`}, ${`${STORE_NAME}-quiet-c`})
      returning id::text as id`;
    community = c?.id ?? '';
    const [p] = await adminSql<{ id: string }[]>`
      insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, status)
      values (${labTenantId}::uuid, ${labAdmin}::uuid, ${`${STORE_NAME}-quiet curso`}, ${PRICE}, 'active')
      returning id::text as id`;
    product = p?.id ?? '';
    await adminSql`
      insert into public.store_product_communities (tenant_id, product_id, community_id)
      values (${labTenantId}::uuid, ${product}::uuid, ${community}::uuid)`;
    await closeWaitingJobs();
  }, 60_000);

  afterAll(async () => {
    await closeWaitingJobs();
    await sweepStore();
    await restoreStore();
  }, 60_000);

  /** Everything a notification could change: rows, push jobs, fan-out jobs and the admin's counters. */
  async function snapshot() {
    const [rows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications where tenant_id = ${labTenantId}::uuid`;
    const res = await api.request('/v1/me/counters', {
      headers: { [TENANT_HOST_HEADER]: HOSTS.lab, authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    return {
      rows: rows?.n ?? -1,
      push: (await pushSendJobsOf(labTenantId)).length,
      fanout: (await notificationJobsOf(labTenantId)).length,
      adminCounters: await res.json(),
    };
  }

  it('a revocation, a cut, a return, a refund, an event waiting for an account and an ignored event create nothing for anyone (D-498, D-500, PR-6)', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const access = await accessProduct();
    const accessId = await productIdOf(access.id);
    const gateway = `sp-${crypto.randomUUID()}`;
    await seedPaymentMapping(labTenantId, {
      kind: 'store_product',
      targetId: product,
      externalProductId: gateway,
    });
    const member = await personWithEmail(freshEmail(PREFIX, 'quiet'), 'lab');
    const subRef = `sub-${crypto.randomUUID()}`;
    const subBody = (type: string, extra: Record<string, unknown> = {}) =>
      sale(type, { ref: subRef, productId: accessId, email: member.email, ...extra });

    const expectQuiet = async (label: string, run: () => Promise<unknown>) => {
      const before = await snapshot();
      await run();
      await runNotificationJobs(labTenantId);
      expect(await snapshot(), label).toEqual(before);
    };

    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(integration, subBody('purchase_approved'));
      await addDevice(member.userId);
      await closeWaitingJobs();

      // access: late (a cut), renewed (a return), canceled (a cut), refunded, renewed, charged back
      for (const type of [
        'subscription_late',
        'subscription_renewed',
        'subscription_canceled',
        'subscription_renewed',
        'purchase_refunded',
        'subscription_renewed',
        'chargeback',
      ]) {
        await expectQuiet(type, () => deliverAndApply(integration, subBody(type)));
      }
      // a refused purchase, an unknown product, an event with no e-mail (ignored)
      await expectQuiet('purchase_refused', () =>
        deliverAndApply(integration, subBody('purchase_refused')),
      );
      await expectQuiet('unknown product', () =>
        deliverAndApply(
          integration,
          sale('purchase_approved', {
            ref: `sub-${crypto.randomUUID()}`,
            productId: `nope-${crypto.randomUUID()}`,
            email: member.email,
          }),
        ),
      );
      await expectQuiet('ignored (no e-mail)', () =>
        deliverAndApply(
          integration,
          sale('purchase_approved', {
            ref: `sub-${crypto.randomUUID()}`,
            productId: accessId,
            email: '',
          }),
        ),
      );
      // an access purchase for an e-mail with no account, and a store purchase waiting for one
      await expectQuiet('access, no account yet', () =>
        deliverAndApply(
          integration,
          sale('purchase_approved', {
            ref: `sub-${crypto.randomUUID()}`,
            productId: accessId,
            email: freshEmail(PREFIX, 'ghost'),
          }),
        ),
      );
      await expectQuiet('store, no account yet', async () => {
        const settled = await deliverAndApply(
          integration,
          storeSale('purchase_approved', {
            ref: `ord-${crypto.randomUUID()}`,
            productId: gateway,
            email: freshEmail(PREFIX, 'ghost'),
          }),
        );
        expect(settled.state).toBe('no_membership');
      });
    });

    // the store: the purchase is the ONLY notice; its refund and a charged-back second purchase are silent
    const buyer = await personWithEmail(freshEmail(PREFIX, 'quietbuyer'), 'lab');
    const ref = `ord-${crypto.randomUUID()}`;
    await deliverAndApply(
      integration,
      storeSale('purchase_approved', { ref, productId: gateway, email: buyer.email }),
    );
    await runNotificationJobs(labTenantId);
    await closeWaitingJobs();
    await expectQuiet('store refund', async () => {
      const settled = await deliverAndApply(
        integration,
        storeSale('purchase_refunded', { ref, productId: gateway, email: buyer.email }),
      );
      expect(settled.state).toBe('applied');
    });
    const ref2 = `ord-${crypto.randomUUID()}`;
    await deliverAndApply(
      integration,
      storeSale('purchase_approved', { ref: ref2, productId: gateway, email: buyer.email }),
    );
    await runNotificationJobs(labTenantId);
    await closeWaitingJobs();
    await expectQuiet('store chargeback', () =>
      deliverAndApply(
        integration,
        storeSale('chargeback', { ref: ref2, productId: gateway, email: buyer.email }),
      ),
    );
    // the admin never got a payments notice of any kind
    const adminRows = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where user_id = ${labAdmin}::uuid and kind like 'payments.%'`;
    expect(adminRows[0]?.n).toBe(0);
  });
});
