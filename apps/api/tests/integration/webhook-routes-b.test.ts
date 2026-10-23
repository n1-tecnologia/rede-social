import { createHash } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { rootLogger } from '@rede-social/core/server/logging';
import { mediaProviderEventJob } from '@rede-social/core/server/media/video/event-job';
import {
  FAKE_VIDEO_SIGNATURE_HEADER,
  signFakeVideoWebhook,
} from '@rede-social/core/server/media/video/fake';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { sealSecret } from '@rede-social/core/server/payments/secret';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  adminSql,
  adminSqlB,
  api,
  createSharedIdentity,
  HOSTS,
  provisionTenantOnB,
  removeIdentitiesByPrefix,
  setPaymentsRow,
  signedWebhook,
  signInAs,
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
const PREFIX = `wrb${RUN}`.slice(0, 14);
const UUID_NEVER = '99999999-9999-4999-8999-999999999999';

let b: TenantOnB;
let labTenantId = '';
let labAdmin: { token: string; userId: string };
const seededIntegrationIds: string[] = [];
const seededAssetIds: string[] = [];
const seededProductExternalIds: string[] = [];
const eventIds: string[] = [];

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

/** Everything the process writes through the root logger's destination while `run` executes. */
async function captureLogs(run: () => Promise<void>): Promise<string[]> {
  const streamKey = Object.getOwnPropertySymbols(rootLogger).find(
    (symbol) => symbol.description === 'pino.stream',
  );
  if (!streamKey) throw new Error('pino stream symbol not found');
  const stream = (rootLogger as unknown as Record<symbol, { write: (chunk: string) => unknown }>)[
    streamKey
  ];
  if (!stream) throw new Error('pino stream not found');
  const lines: string[] = [];
  const original = stream.write.bind(stream);
  const spy = vi.spyOn(stream, 'write').mockImplementation((chunk: string) => {
    lines.push(String(chunk));
    return original(chunk);
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return lines;
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
  await removeIdentitiesByPrefix(PREFIX);
  b = await provisionTenantOnB({ slug: `wrb-${RUN}`.slice(0, 40), role: 'admin_tenant' });
  await adminSqlB`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${b.tenantId}::uuid, 'payments', true)`;
  const [lab] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role: 'admin_tenant' }],
  });
  labAdmin = {
    userId: identity.userId,
    token: await signInAs(identity.email, identity.password),
  };
  await setPaymentsRow(labTenantId, { enabled: true, settings: {} });
  moduleFlags.invalidate(labTenantId);
}, 60_000);

afterAll(async () => {
  for (const id of seededIntegrationIds) {
    await adminSqlB`delete from public.payment_events where integration_id = ${id}::uuid`;
    await adminSqlB`delete from public.payment_integrations where id = ${id}::uuid`;
    await adminSql`delete from platform.payment_integration_routes where integration_id = ${id}::uuid`;
  }
  await adminSqlB`delete from public.payment_events where tenant_id = ${b.tenantId}::uuid`;
  await adminSqlB`delete from public.payment_integrations where tenant_id = ${b.tenantId}::uuid`;
  await adminSqlB`delete from public.payment_products where tenant_id = ${b.tenantId}::uuid`;
  await adminSql`delete from public.payment_products where tenant_id = ${labTenantId}::uuid`;
  await adminSql`delete from platform.payment_product_routes where tenant_id in (${b.tenantId}::uuid, ${labTenantId}::uuid)`;
  if (seededAssetIds.length > 0) {
    await adminSqlB`delete from public.media_assets where id = any(${seededAssetIds}::uuid[])`;
    await adminSql`delete from platform.video_asset_routes where asset_id = any(${seededAssetIds}::uuid[])`;
  }
  if (eventIds.length > 0) {
    await adminSqlB`delete from public.media_provider_events where id = any(${eventIds})`;
    await adminSql`delete from public.media_provider_events where id = any(${eventIds})`;
    await adminSqlB`delete from pgboss.job_common where singleton_key = any(${eventIds})`;
    await adminSql`delete from pgboss.job_common where singleton_key = any(${eventIds})`;
  }
  await adminSqlB`drop trigger if exists wrb_fail_integration on public.payment_integrations`;
  await adminSqlB`drop trigger if exists wrb_fail_product on public.payment_products`;
  await adminSqlB`drop function if exists public.wrb_fail()`;
  await adminSql`delete from public.payment_events where tenant_id = ${labTenantId}::uuid`;
  await adminSql`
    delete from public.tenant_modules where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
  moduleFlags.invalidate(labTenantId);
  await removeIdentitiesByPrefix(PREFIX);
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

describe('product mapping: reserve, then write (D-488, DBT-16)', () => {
  const productCall = (token: string, host: string, method: string, path: string, body?: unknown) =>
    api.request(`/v1/payments${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-host': host,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const routesOf = (external: string) =>
    adminSql<{ tenant_id: string; provider: string }[]>`
      select tenant_id::text as tenant_id, provider from platform.payment_product_routes
       where external_product_id = ${external}`;

  it('two tenants of two projects racing one gateway id leave one route, one 409 that names nobody, and no row for the loser', async () => {
    const ext = `race-${RUN}-${crypto.randomUUID().slice(0, 8)}`;
    seededProductExternalIds.push(ext);
    const answers = await Promise.all([
      productCall(b.token, b.host, 'POST', '/access-products', {
        name: 'B',
        externalProductId: ext,
      }),
      productCall(labAdmin.token, HOSTS.lab, 'POST', '/access-products', {
        name: 'Lab',
        externalProductId: ext,
      }),
    ]);
    const statuses = answers.map((a) => a.status).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = answers.find((a) => a.status === 409) as Response;
    const text = await loser.text();
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'CONFLICT', details: { payments: 'gateway_product_taken' } },
    });
    expect(text).not.toMatch(
      new RegExp(`rede-lab|${b.tenantId}|${labTenantId}|wrb-|payment_product_routes`),
    );

    const routes = await routesOf(ext);
    expect(routes).toHaveLength(1);
    const winnerIsB = answers[0]?.status === 201;
    expect(routes[0]?.tenant_id).toBe(winnerIsB ? b.tenantId : labTenantId);
    const inB = await adminSqlB<{ n: number }[]>`
      select count(*)::int as n from public.payment_products where external_product_id = ${ext}`;
    const inLab = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.payment_products where external_product_id = ${ext}`;
    expect(inB[0]?.n).toBe(winnerIsB ? 1 : 0);
    expect(inLab[0]?.n).toBe(winnerIsB ? 0 : 1);
  }, 60_000);

  it('a tenant-write failure removes the route the call reserved', async () => {
    const ext = `fail-${RUN}-${crypto.randomUUID().slice(0, 8)}`;
    seededProductExternalIds.push(ext);
    await adminSqlB`
      create or replace function public.wrb_fail() returns trigger language plpgsql as $$
      begin raise exception 'wrb forced failure' using errcode = 'P0001'; end $$`;
    await adminSqlB`
      create trigger wrb_fail_product before insert on public.payment_products
      for each row execute function public.wrb_fail()`;
    try {
      const res = await productCall(b.token, b.host, 'POST', '/access-products', {
        name: 'Falha',
        externalProductId: ext,
      });
      expect(res.status).toBe(500);
    } finally {
      await adminSqlB`drop trigger if exists wrb_fail_product on public.payment_products`;
    }
    expect(await routesOf(ext)).toHaveLength(0);
    // The id is free again: the same call, no longer failing, succeeds.
    const retry = await productCall(b.token, b.host, 'POST', '/access-products', {
      name: 'Ok',
      externalProductId: ext,
    });
    expect(retry.status).toBe(201);
    expect((await routesOf(ext))[0]?.tenant_id).toBe(b.tenantId);
  });

  it('changing the gateway id swaps the route, and removing the product deletes it', async () => {
    const first = `swap-${RUN}-${crypto.randomUUID().slice(0, 8)}`;
    const second = `swap2-${RUN}-${crypto.randomUUID().slice(0, 8)}`;
    seededProductExternalIds.push(first, second);
    const created = await productCall(b.token, b.host, 'POST', '/access-products', {
      name: 'Troca',
      externalProductId: first,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(await routesOf(first)).toHaveLength(1);

    const patched = await productCall(b.token, b.host, 'PATCH', `/access-products/${id}`, {
      externalProductId: second,
    });
    expect(patched.status).toBe(200);
    expect(await routesOf(first)).toHaveLength(0);
    expect((await routesOf(second))[0]?.tenant_id).toBe(b.tenantId);

    // Another tenant cannot take the id the first one just released... but CAN take it now.
    const lab = await productCall(labAdmin.token, HOSTS.lab, 'POST', '/access-products', {
      name: 'Lab pega o livre',
      externalProductId: first,
    });
    expect(lab.status).toBe(201);
    // ...and cannot take the one B still holds.
    const taken = await productCall(labAdmin.token, HOSTS.lab, 'POST', '/access-products', {
      name: 'Lab',
      externalProductId: second,
    });
    expect(taken.status).toBe(409);

    // The gate is off, so the last product may go; its route goes with it.
    const removed = await productCall(b.token, b.host, 'DELETE', `/access-products/${id}`);
    expect(removed.status).toBe(200);
    expect(await routesOf(second)).toHaveLength(0);
  }, 60_000);
});

// ── Mux ─────────────────────────────────────────────────────────────────────────────────────────────

/** A pending fake-provider video asset that exists ONLY in database B. */
async function seedVideoInB(options: { route?: boolean } = {}): Promise<{
  assetId: string;
  providerAssetId: string;
}> {
  const assetId = crypto.randomUUID();
  const providerAssetId = `fake-${assetId}`;
  await adminSqlB`
    insert into public.media_assets
           (id, tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, mime, bytes)
    values (${assetId}::uuid, ${b.tenantId}::uuid, ${b.userId}::uuid, 'video', 'post', 'pending', 'fake',
            ${providerAssetId}, 'video/mp4', 1000)`;
  if (options.route) {
    await adminSql`
      insert into platform.video_asset_routes (asset_id, tenant_id, provider_asset_id)
      values (${assetId}::uuid, ${b.tenantId}::uuid, ${providerAssetId})`;
  }
  seededAssetIds.push(assetId);
  return { assetId, providerAssetId };
}

function wire(opts: {
  eventId: string;
  type?: string;
  passthrough?: string | null;
  providerAssetId: string;
}): string {
  return JSON.stringify({
    id: opts.eventId,
    type: opts.type ?? 'video.asset.ready',
    created_at: new Date().toISOString(),
    object: { type: 'asset', id: opts.providerAssetId },
    data: {
      id: opts.providerAssetId,
      status: 'ready',
      ...(opts.passthrough ? { passthrough: opts.passthrough } : {}),
      duration: 12.4,
      aspect_ratio: '16:9',
      playback_ids: [{ id: `pb-${opts.providerAssetId}`, policy: 'signed' }],
    },
  });
}

async function postMux(raw: string): Promise<Response> {
  return api.request('/v1/webhooks/mux', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [FAKE_VIDEO_SIGNATURE_HEADER]: signFakeVideoWebhook(raw, Math.floor(Date.now() / 1000)),
    },
    body: raw,
  });
}

const newEventId = () => {
  const id = `wrb-evt-${RUN}-${crypto.randomUUID().slice(0, 8)}`;
  eventIds.push(id);
  return id;
};

const eventRows = (db: typeof adminSql, id: string) =>
  db<{ n: number }[]>`select count(*)::int as n from public.media_provider_events where id = ${id}`;

const statusOfInB = async (assetId: string) =>
  (
    await adminSqlB<{ status: string; playback_id: string | null }[]>`
      select status, playback_id from public.media_assets where id = ${assetId}::uuid`
  )[0];

async function runJobFromB(eventId: string): Promise<void> {
  const [job] = await jobsIn(adminSqlB, 'kernel.media-provider-event', [eventId]);
  if (!job) throw new Error('no job in B for the event');
  await mediaProviderEventJob.handler(job.data as never, { projectId: b.projectId });
}

describe('Mux deliveries for a tenant in database B (DBT-13)', () => {
  it('Mux delivery lands in B: the <tenantId>:<assetId> passthrough records the event and the job in B only, and the job readies the asset', async () => {
    const { assetId, providerAssetId } = await seedVideoInB();
    const eventId = newEventId();
    const res = await postMux(
      wire({ eventId, passthrough: `${b.tenantId}:${assetId}`, providerAssetId }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, enqueued: true });

    expect((await eventRows(adminSqlB, eventId))[0]?.n).toBe(1);
    expect((await eventRows(adminSql, eventId))[0]?.n).toBe(0);
    expect(await jobsIn(adminSqlB, 'kernel.media-provider-event', [eventId])).toHaveLength(1);
    expect(await jobsIn(adminSql, 'kernel.media-provider-event', [eventId])).toHaveLength(0);

    await runJobFromB(eventId);
    expect(await statusOfInB(assetId)).toMatchObject({
      status: 'ready',
      playback_id: `pb-${providerAssetId}`,
    });
  });

  it('legacy bare-uuid passthrough: an asset created before this phase resolves through video_asset_routes', async () => {
    const { assetId, providerAssetId } = await seedVideoInB({ route: true });
    const eventId = newEventId();
    const res = await postMux(wire({ eventId, passthrough: assetId, providerAssetId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, enqueued: true });
    expect((await eventRows(adminSqlB, eventId))[0]?.n).toBe(1);
    expect((await eventRows(adminSql, eventId))[0]?.n).toBe(0);
    await runJobFromB(eventId);
    expect((await statusOfInB(assetId))?.status).toBe('ready');
  });

  it('no passthrough, provider id only: resolved through video_asset_routes by provider_asset_id', async () => {
    const { assetId, providerAssetId } = await seedVideoInB({ route: true });
    const eventId = newEventId();
    const res = await postMux(wire({ eventId, passthrough: null, providerAssetId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, enqueued: true });
    expect((await eventRows(adminSqlB, eventId))[0]?.n).toBe(1);
    await runJobFromB(eventId);
    expect((await statusOfInB(assetId))?.status).toBe('ready');
  });

  it('a video.upload.errored delivery (passthrough under new_asset_settings) resolves the same way and fails the asset in B', async () => {
    const { assetId, providerAssetId } = await seedVideoInB();
    const eventId = newEventId();
    const raw = JSON.stringify({
      id: eventId,
      type: 'video.upload.errored',
      data: {
        id: providerAssetId,
        new_asset_settings: { passthrough: `${b.tenantId}:${assetId}` },
      },
    });
    const res = await postMux(raw);
    expect(res.status).toBe(200);
    expect((await eventRows(adminSqlB, eventId))[0]?.n).toBe(1);
    await runJobFromB(eventId);
    expect((await statusOfInB(assetId))?.status).toBe('failed');
  });

  it('an unresolvable event is accepted (200), stores nothing anywhere and logs a count', async () => {
    const eventId = newEventId();
    const unknownAsset = crypto.randomUUID();
    let res: Response | undefined;
    const lines = await captureLogs(async () => {
      res = await postMux(
        wire({ eventId, passthrough: unknownAsset, providerAssetId: `nobody-${unknownAsset}` }),
      );
    });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ received: true, enqueued: false });
    expect((await eventRows(adminSqlB, eventId))[0]?.n).toBe(0);
    expect((await eventRows(adminSql, eventId))[0]?.n).toBe(0);
    const logged = lines.filter((line) => line.includes('media.webhook.unroutable'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/"count":\d+/);
    expect(logged[0]).not.toContain(unknownAsset);
  });

  it('a passthrough naming another tenant for an asset of B finds no asset there and is dropped (T-09.2-47)', async () => {
    const { assetId, providerAssetId } = await seedVideoInB({ route: true });
    const eventId = newEventId();
    // Tenant `lab` lives in project 0; the asset lives in B.
    const res = await postMux(
      wire({ eventId, passthrough: `${labTenantId}:${assetId}`, providerAssetId }),
    );
    expect(res.status).toBe(200);
    expect((await eventRows(adminSql, eventId))[0]?.n).toBe(1);
    expect((await eventRows(adminSqlB, eventId))[0]?.n).toBe(0);
    const [job] = await jobsIn(adminSql, 'kernel.media-provider-event', [eventId]);
    expect(job).toBeDefined();
    const { centralProjectId } = await import('@rede-social/core/server/tenancy/project-registry');
    await mediaProviderEventJob.handler(job?.data as never, {
      projectId: await centralProjectId(),
    });
    expect((await statusOfInB(assetId))?.status).toBe('pending');
  });

  it('P25: one event delivered twice, 20 times in parallel, and ready arriving before created leave one row per event and one final state', async () => {
    const { assetId, providerAssetId } = await seedVideoInB();
    const readyId = newEventId();
    const createdId = newEventId();
    const passthrough = `${b.tenantId}:${assetId}`;

    // 20 parallel deliveries of ONE event: one row, one job.
    const burst = await Promise.all(
      Array.from({ length: 20 }, () =>
        postMux(wire({ eventId: readyId, passthrough, providerAssetId })),
      ),
    );
    expect(burst.map((r) => r.status)).toEqual(Array(20).fill(200));
    const enqueued = (await Promise.all(burst.map((r) => r.json()))) as { enqueued: boolean }[];
    expect(enqueued.filter((e) => e.enqueued)).toHaveLength(1);
    expect((await eventRows(adminSqlB, readyId))[0]?.n).toBe(1);
    expect(await jobsIn(adminSqlB, 'kernel.media-provider-event', [readyId])).toHaveLength(1);

    // `created` arrives AFTER `ready` (out of order): recorded once, applies nothing, the asset stays ready.
    const created = await postMux(
      wire({ eventId: createdId, type: 'video.asset.created', passthrough, providerAssetId }),
    );
    expect(created.status).toBe(200);
    await runJobFromB(readyId);
    await runJobFromB(createdId);
    await runJobFromB(readyId); // a replayed job is a no-op
    expect((await statusOfInB(assetId))?.status).toBe('ready');
    expect((await eventRows(adminSqlB, createdId))[0]?.n).toBe(1);

    // The route-index path and the passthrough path resolve the same tenant: a legacy-shaped retry of the
    // same event id records nothing new.
    await adminSql`
      insert into platform.video_asset_routes (asset_id, tenant_id, provider_asset_id)
      values (${assetId}::uuid, ${b.tenantId}::uuid, ${providerAssetId})
      on conflict do nothing`;
    const legacyRetry = await postMux(
      wire({ eventId: readyId, passthrough: assetId, providerAssetId }),
    );
    expect(await legacyRetry.json()).toEqual({ received: true, enqueued: false });
    expect((await eventRows(adminSqlB, readyId))[0]?.n).toBe(1);
    expect((await eventRows(adminSql, readyId))[0]?.n).toBe(0);
  }, 60_000);
});
