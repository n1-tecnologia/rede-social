import { createHash } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { sealSecret } from '@rede-social/core/server/payments/secret';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  adminSql,
  adminSqlB,
  api,
  provisionTenantOnB,
  signedWebhook,
  type TenantOnB,
} from './setup';

/**
 * Phase 09.2-10 (D-486, D-488, DBT-12, DBT-13, DBT-16): the three routes that arrive WITHOUT a tenant host
 * (the payment-gateway webhook, the gateway product mapping and the Mux webhook) find their tenant, and with
 * it their project, through a small central index, and record inside that tenant's own database.
 *
 * The tenant lives ONLY in `rede_tenant_b` (the second local database); the central project holds just its
 * mirror and the route rows. A delivery that wrongly lands centrally therefore shows in the assertions.
 * Authenticity is untouched throughout: the fake adapters verify the same HMAC the real ones do.
 *
 * DB-level and counter assertions use two wrappers of the lanes (below): they count how many transactions a
 * request opens on each lane, which is how "an unknown integration costs ONE central read and no tenant
 * database" is made observable without a statement log.
 */

const lanes = vi.hoisted(() => ({ platform: 0, admin: 0, opened: 0 }));

vi.mock('@rede-social/core/db/platform-tx', async (importOriginal) => {
  const original = await importOriginal<typeof import('@rede-social/core/db/platform-tx')>();
  return {
    ...original,
    withPlatformTx: ((fn: Parameters<typeof original.withPlatformTx>[0]) => {
      lanes.platform += 1;
      return original.withPlatformTx(fn);
    }) as typeof original.withPlatformTx,
  };
});

vi.mock('@rede-social/core/db/admin-tx', async (importOriginal) => {
  const original = await importOriginal<typeof import('@rede-social/core/db/admin-tx')>();
  return {
    ...original,
    withAdminTx: ((...args: unknown[]) => {
      lanes.admin += 1;
      return (original.withAdminTx as (...a: unknown[]) => unknown)(...args);
    }) as typeof original.withAdminTx,
  };
});

vi.mock('@rede-social/core/server/payments/secret', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@rede-social/core/server/payments/secret')>();
  return {
    ...original,
    openSecret: ((...args: Parameters<typeof original.openSecret>) => {
      lanes.opened += 1;
      return original.openSecret(...args);
    }) as typeof original.openSecret,
  };
});

const RUN = Date.now().toString(36);
const UUID_NEVER = '99999999-9999-4999-8999-999999999999';

let b: TenantOnB;
const seededIntegrationIds: string[] = [];

const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

type Counts = { platform: number; admin: number; opened: number };
function measure(): { reset: () => void; read: () => Counts } {
  return {
    reset: () => {
      lanes.platform = 0;
      lanes.admin = 0;
      lanes.opened = 0;
    },
    read: () => ({ ...lanes }),
  };
}

// ── a gateway integration that exists ONLY in database B ────────────────────────────────────────────

async function seedIntegrationInB(): Promise<{
  id: string;
  tenantId: string;
  provider: string;
  token: string;
}> {
  const id = crypto.randomUUID();
  const token = `tok-${crypto.randomUUID()}`;
  // One integration per tenant and provider: the previous case's is replaced (its events cascade).
  await adminSqlB`delete from public.payment_integrations where tenant_id = ${b.tenantId}::uuid`;
  await adminSql`delete from platform.payment_integration_routes where tenant_id = ${b.tenantId}::uuid`;
  await adminSqlB`
    insert into public.payment_integrations (id, tenant_id, provider, secret_sealed)
    values (${id}::uuid, ${b.tenantId}::uuid, 'fake', ${sealSecret(token, id)})`;
  await adminSql`
    insert into platform.payment_integration_routes (integration_id, tenant_id, provider)
    values (${id}::uuid, ${b.tenantId}::uuid, 'fake')`;
  seededIntegrationIds.push(id);
  return { id, tenantId: b.tenantId, provider: 'fake', token };
}

const approved = () => ({
  type: 'purchase_approved',
  externalRef: `ord-${crypto.randomUUID()}`,
  orderRef: 'REF-1',
  productId: 'prod-1',
  email: 'buyer@example.com',
  amountCents: 4990,
  currency: 'BRL',
  recurring: false,
});

type JobRow = { name: string; singleton_key: string | null; data: Record<string, unknown> };
const jobsIn = (db: typeof adminSql, name: string, keys: string[]) =>
  db<JobRow[]>`
    select name, singleton_key, data from pgboss.job_common
     where name = ${name} and singleton_key = any(${keys})`;

beforeAll(async () => {
  b = await provisionTenantOnB({ slug: `wrb-${RUN}`.slice(0, 40), role: 'admin_tenant' });
  await adminSqlB`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${b.tenantId}::uuid, 'payments', true)`;
}, 60_000);

afterAll(async () => {
  for (const id of seededIntegrationIds) {
    await adminSqlB`delete from public.payment_events where integration_id = ${id}::uuid`;
    await adminSqlB`delete from public.payment_integrations where id = ${id}::uuid`;
    await adminSql`delete from platform.payment_integration_routes where integration_id = ${id}::uuid`;
  }
  await adminSqlB`delete from public.payment_events where tenant_id = ${b.tenantId}::uuid`;
  await adminSqlB`delete from public.payment_integrations where tenant_id = ${b.tenantId}::uuid`;
  await adminSqlB`drop trigger if exists wrb_fail_integration on public.payment_integrations`;
  await adminSqlB`drop function if exists public.wrb_fail()`;
  await b?.cleanup();
  await stopBoss();
  await closeAllPools();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer: a signed gateway delivery for a tenant in database B (D-486, DBT-12)', () => {
  it('tracer: gateway delivery lands in B — the event and the kernel.payment-event job are recorded in B only', async () => {
    const integration = await seedIntegrationInB();
    const body = approved();

    const first = await signedWebhook(integration, body);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, enqueued: true });

    const inB = await adminSqlB<{ id: string; tenant_id: string; dedupe_key: string }[]>`
      select id::text as id, tenant_id::text as tenant_id, dedupe_key
        from public.payment_events where integration_id = ${integration.id}::uuid`;
    expect(inB).toHaveLength(1);
    expect(inB[0]?.tenant_id).toBe(b.tenantId);
    expect(inB[0]?.dedupe_key).toBe(sha256(JSON.stringify(body)));
    const central = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.payment_events where integration_id = ${integration.id}::uuid`;
    expect(central[0]?.n).toBe(0);

    const eventId = inB[0]?.id ?? '';
    expect(await jobsIn(adminSqlB, 'kernel.payment-event', [eventId])).toHaveLength(1);
    expect(await jobsIn(adminSql, 'kernel.payment-event', [eventId])).toHaveLength(0);

    // The same bytes again: recorded once, nothing new enqueued.
    const again = await signedWebhook(integration, body);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ received: true, enqueued: false });
    const afterRetry = await adminSqlB<{ n: number }[]>`
      select count(*)::int as n from public.payment_events where integration_id = ${integration.id}::uuid`;
    expect(afterRetry[0]?.n).toBe(1);
  });

  it('a wrong signature answers 403 and stores nothing; an unknown or malformed id answers 404 after ONE central read and no decryption', async () => {
    const integration = await seedIntegrationInB();

    const forged = await signedWebhook(integration, approved(), { token: 'not-the-token' });
    expect(forged.status).toBe(403);
    const stored = await adminSqlB<{ n: number }[]>`
      select count(*)::int as n from public.payment_events where integration_id = ${integration.id}::uuid`;
    expect(stored[0]?.n).toBe(0);

    const probe = measure();
    probe.reset();
    const unknown = await signedWebhook(integration, approved(), { id: UUID_NEVER });
    expect(unknown.status).toBe(404);
    expect(probe.read()).toEqual({ platform: 1, admin: 0, opened: 0 });

    probe.reset();
    const malformed = await signedWebhook(integration, approved(), { id: 'not-a-uuid' });
    expect(malformed.status).toBe(404);
    expect(probe.read()).toEqual({ platform: 0, admin: 0, opened: 0 });

    // A provider the route does not carry is refused from the index row alone.
    probe.reset();
    const wrongProvider = await signedWebhook(integration, approved(), { provider: 'kiwify' });
    expect(wrongProvider.status).toBe(404);
    expect(probe.read()).toEqual({ platform: 1, admin: 0, opened: 0 });

    // The liveness probe some gateways send before saving the URL needs no database at all.
    const path = `/v1/webhooks/fake/${integration.id}`;
    probe.reset();
    expect((await api.request(path)).status).toBe(200);
    expect((await api.request(path, { method: 'HEAD' })).status).toBe(200);
    expect(probe.read()).toEqual({ platform: 0, admin: 0, opened: 0 });
  });

  it('an orphan route (reserved, tenant row never written) answers 404 harmlessly', async () => {
    const orphan = crypto.randomUUID();
    await adminSql`
      insert into platform.payment_integration_routes (integration_id, tenant_id, provider)
      values (${orphan}::uuid, ${b.tenantId}::uuid, 'fake')`;
    seededIntegrationIds.push(orphan);
    const res = await signedWebhook(
      { id: orphan, tenantId: b.tenantId, provider: 'fake', token: 'whatever' },
      approved(),
    );
    expect(res.status).toBe(404);
  });

  it('reserve-then-write: saving the token in B writes the central route first, the row only in B, and the saved token verifies a delivery', async () => {
    const res = await api.request('/v1/payments/integration', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${b.token}`,
        'x-tenant-host': b.host,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token: `tok-${RUN}`, provider: 'fake' }),
    });
    expect(res.status).toBe(200);

    const [row] = await adminSqlB<{ id: string }[]>`
      select id::text as id from public.payment_integrations
       where tenant_id = ${b.tenantId}::uuid and provider = 'fake'`;
    const id = row?.id ?? '';
    seededIntegrationIds.push(id);
    const [route] = await adminSql<{ tenant_id: string; provider: string }[]>`
      select tenant_id::text as tenant_id, provider from platform.payment_integration_routes
       where integration_id = ${id}::uuid`;
    expect(route).toEqual({ tenant_id: b.tenantId, provider: 'fake' });
    const central = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.payment_integrations where id = ${id}::uuid`;
    expect(central[0]?.n).toBe(0);

    const delivery = await signedWebhook(
      { id, tenantId: b.tenantId, provider: 'fake', token: `tok-${RUN}` },
      approved(),
    );
    expect(delivery.status).toBe(200);
    expect(await delivery.json()).toEqual({ received: true, enqueued: true });
  });

  it('compensation: a failed tenant write removes the route the save reserved', async () => {
    await adminSqlB`delete from public.payment_integrations where tenant_id = ${b.tenantId}::uuid`;
    await adminSql`delete from platform.payment_integration_routes where tenant_id = ${b.tenantId}::uuid`;
    await adminSqlB`
      create or replace function public.wrb_fail() returns trigger language plpgsql as $$
      begin raise exception 'wrb forced failure' using errcode = 'P0001'; end $$`;
    await adminSqlB`
      create trigger wrb_fail_integration before insert on public.payment_integrations
      for each row execute function public.wrb_fail()`;
    try {
      const res = await api.request('/v1/payments/integration', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${b.token}`,
          'x-tenant-host': b.host,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ token: `tok-${RUN}-x`, provider: 'fake' }),
      });
      expect(res.status).toBe(500);
    } finally {
      await adminSqlB`drop trigger if exists wrb_fail_integration on public.payment_integrations`;
    }
    const routes = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.payment_integration_routes
       where tenant_id = ${b.tenantId}::uuid`;
    expect(routes[0]?.n).toBe(0);
    const rows = await adminSqlB<{ n: number }[]>`
      select count(*)::int as n from public.payment_integrations where tenant_id = ${b.tenantId}::uuid`;
    expect(rows[0]?.n).toBe(0);
  });
});
