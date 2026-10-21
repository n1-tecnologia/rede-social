import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { rootLogger } from '@rede-social/core/server/logging';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  adminSql,
  removePaymentIntegrations,
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  signedWebhook,
} from './setup';

/**
 * Phase 09.1-08 (PAY-02, PAY-03, PAY-33; D-486, D-496, D-505, D-507): the first real gateway adapter
 * proven through the REAL route, the real inbox and the real queue, with deliveries signed the way the
 * vendor documents (HMAC-SHA1 hex in `?signature=`, over the raw bytes or over the re-serialised JSON).
 *
 * The fixtures are built from the vendor's public documentation with synthetic data. Nothing here talks
 * to a real gateway; plan 20 replaces the fixtures with redacted real captures and settles which
 * signature variant the vendor really sends.
 *
 * Fixture hygiene: every case seeds its own integration and tears it down with its events and queued
 * jobs, so this file leaves no row behind.
 */

const PROVIDER = 'kiwify';
const FIXTURES = new URL(
  '../../../../packages/core/tests/fixtures/payments/kiwify/',
  import.meta.url,
);

const fixture = (name: string): Buffer => readFileSync(new URL(`${name}.json`, FIXTURES));
/** HMAC-SHA1 hex, the vendor's scheme. */
const sha1 = (body: Buffer | string, token: string) =>
  createHmac('sha1', token).update(body).digest('hex');
const reserialised = (raw: Buffer) =>
  Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))), 'utf8');

let labTenantId = '';
let demoTenantId = '';
const touchedTenants = new Set<string>();

type EventRow = {
  id: string;
  tenant_id: string;
  provider: string;
  type: string;
  effect: string;
  external_ref: string | null;
  order_ref: string | null;
  external_product_id: string | null;
  email: string | null;
  amount_cents: number | null;
  currency: string | null;
  valid_until: Date | null;
};

async function seed(tenantId: string, token?: string): Promise<SeededPaymentIntegration> {
  touchedTenants.add(tenantId);
  return seedPaymentIntegration(tenantId, { provider: PROVIDER, ...(token ? { token } : {}) });
}

/** Posts `bytes` signed with the vendor's scheme (or with `signature` / none). */
function deliver(
  integration: SeededPaymentIntegration,
  bytes: Buffer,
  options: { signWith?: Buffer; token?: string; signature?: string; omitSignature?: boolean } = {},
): Promise<Response> {
  const signature =
    options.signature ?? sha1(options.signWith ?? bytes, options.token ?? integration.token);
  return signedWebhook(integration, bytes, {
    signature,
    ...(options.omitSignature ? { omitSignature: true } : {}),
  });
}

async function eventsOf(integrationId: string): Promise<EventRow[]> {
  return adminSql<EventRow[]>`
    select id, tenant_id, provider, type, effect, external_ref, order_ref, external_product_id,
           email, amount_cents, currency, valid_until
      from public.payment_events where integration_id = ${integrationId}::uuid
     order by received_at, id`;
}

async function jobsOf(tenantId: string) {
  return adminSql<{ data: Record<string, unknown>; singleton_key: string }[]>`
    select data, singleton_key from pgboss.job_common
     where name = 'kernel.payment-event'
       and singleton_key in (select id::text from public.payment_events
                              where tenant_id = ${tenantId}::uuid)
     order by created_on`;
}

type Answer = { status: number; json: Record<string, unknown> };
async function answer(res: Response): Promise<Answer> {
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** Everything the API process writes through the root logger's destination while `run` executes. */
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

beforeAll(async () => {
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  labTenantId = rows.find((row) => row.slug === 'rede-lab')?.id ?? '';
  demoTenantId = rows.find((row) => row.slug === 'rede-demo')?.id ?? '';
  if (!labTenantId || !demoTenantId) throw new Error('seed tenants missing: run pnpm db:seed');
});

afterEach(async () => {
  for (const tenantId of touchedTenants) await removePaymentIntegrations(tenantId);
  touchedTenants.clear();
});

afterAll(async () => {
  await stopBoss();
});

describe('09.1 tracer', () => {
  it('receives the approved-purchase example signed over the raw bytes as a neutral grant', async () => {
    const integration = await seed(labTenantId);
    const raw = fixture('trigger-compra_aprovada');
    expect(reserialised(raw).equals(raw)).toBe(false); // the two variants really differ

    const res = await answer(await deliver(integration, raw));
    expect(res).toEqual({ status: 200, json: { received: true, enqueued: true } });

    const rows = await eventsOf(integration.id);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      tenant_id: labTenantId,
      provider: PROVIDER,
      type: 'purchase_approved',
      effect: 'grant',
      external_ref: '6f1d5c0e-0000-4000-8000-00000000a001',
      order_ref: '6f1d5c0e-0000-4000-8000-00000000a001',
      external_product_id: 'b7a3c9d2-0000-4000-8000-00000000b001',
      email: 'comprador.teste@example.com',
      amount_cents: 9990,
      currency: 'BRL',
      valid_until: null,
    });

    const jobs = await jobsOf(labTenantId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ eventId: row?.id });
  });

  it('accepts the same example signed over the re-serialised JSON too (A-P17)', async () => {
    const integration = await seed(labTenantId);
    const raw = fixture('trigger-compra_aprovada');

    const res = await answer(await deliver(integration, raw, { signWith: reserialised(raw) }));
    expect(res).toEqual({ status: 200, json: { received: true, enqueued: true } });

    const rows = await eventsOf(integration.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'purchase_approved', effect: 'grant' });
    expect(await jobsOf(labTenantId)).toHaveLength(1);
  });

  it('refuses a one-byte change, an unsigned body and another tenant token with 403 and stores nothing', async () => {
    const integration = await seed(labTenantId);
    const other = await seed(demoTenantId);
    const raw = fixture('trigger-compra_aprovada');
    const forbidden = { status: 403, json: { error: { code: 'FORBIDDEN' } } };

    const changed = Buffer.from(raw);
    changed[changed.length - 3] = (changed[changed.length - 3] ?? 0) ^ 0x01;
    // The signature is the one of the ORIGINAL bytes; the body that arrives differs by one byte.
    expect(await answer(await deliver(integration, changed, { signWith: raw }))).toEqual(forbidden);
    expect(await answer(await deliver(integration, raw, { omitSignature: true }))).toEqual(
      forbidden,
    );
    expect(await answer(await deliver(integration, raw, { token: other.token }))).toEqual(
      forbidden,
    );
    expect(
      await answer(await deliver(integration, raw, { signature: sha1(raw, 'x').slice(2) })),
    ).toEqual(forbidden);

    expect(await eventsOf(integration.id)).toHaveLength(0);
    expect(await eventsOf(other.id)).toHaveLength(0);
    expect(await jobsOf(labTenantId)).toHaveLength(0);
    expect(await jobsOf(demoTenantId)).toHaveLength(0);
  });

  it('logs which signature variant matched and never the signature, the token or the buyer', async () => {
    const integration = await seed(labTenantId);
    const raw = fixture('trigger-compra_aprovada');
    const rawSignature = sha1(raw, integration.token);
    const reserialisedSignature = sha1(reserialised(raw), integration.token);

    const lines = await captureLogs(async () => {
      expect((await deliver(integration, raw)).status).toBe(200);
      const second = fixture('trigger-subscription_renewed');
      expect((await deliver(integration, second, { signWith: reserialised(second) })).status).toBe(
        200,
      );
    });

    const joined = lines.join('');
    const received = lines.filter((line) => line.includes('payments.webhook.received'));
    expect(received).toHaveLength(2);
    expect(received[0]).toContain('"variant":"raw"');
    expect(received[1]).toContain('"variant":"reserialised"');

    for (const secret of [
      integration.token,
      rawSignature,
      reserialisedSignature,
      'comprador.teste@example.com',
      'Comprador Sintetico',
      '000.000.000-00',
    ]) {
      expect(joined.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });
});
