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
 * The six triggers of the 2026-10-21 capture (approved, refunded, charged back, late, canceled, refused)
 * are redacted vendor test deliveries (`real-capture (redacted)`); the other fixtures are documented
 * examples (`documented-example (synthetic)`). Nothing here talks to a real gateway, and no signature was
 * captured, so which signed material the vendor really sends is still open (both are accepted).
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
const body = (name: string): Record<string, unknown> =>
  JSON.parse(fixture(name).toString('utf8')) as Record<string, unknown>;
const subscriptionOf = (name: string) => String((body(name).Subscription as { id: string }).id);
const orderOf = (name: string) => String(body(name).order_id);
const productOf = (name: string) =>
  String((body(name).Product as { product_id: string }).product_id);
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
  it('receives the approved-purchase delivery signed over the raw bytes as a neutral grant', async () => {
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
      external_ref: subscriptionOf('trigger-compra_aprovada'),
      order_ref: orderOf('trigger-compra_aprovada'),
      external_product_id: productOf('trigger-compra_aprovada'),
      email: 'comprador.teste@example.test',
      amount_cents: 7602,
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

  it('dedupes the same authenticated delivery re-sent with different whitespace (CR-01)', async () => {
    const integration = await seed(labTenantId);
    const raw = fixture('trigger-compra_aprovada');
    // The vendor signed the canonical JSON; the captured pair is (raw, signature).
    const signature = sha1(reserialised(raw), integration.token);
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    const tabbed = Buffer.from(JSON.stringify(parsed, null, '\t'), 'utf8');
    const padded = Buffer.from(`\n\n${JSON.stringify(parsed, null, 5)}\n`, 'utf8');
    expect(tabbed.equals(raw) || padded.equals(raw) || tabbed.equals(padded)).toBe(false);

    const first = await answer(await deliver(integration, raw, { signature }));
    expect(first).toEqual({ status: 200, json: { received: true, enqueued: true } });
    for (const replay of [tabbed, padded, reserialised(raw)]) {
      const again = await answer(await deliver(integration, replay, { signature }));
      expect(again).toEqual({ status: 200, json: { received: true, enqueued: false } });
    }

    expect(await eventsOf(integration.id)).toHaveLength(1);
    expect(await jobsOf(labTenantId)).toHaveLength(1);
  });

  it('does not collide two genuinely different deliveries (CR-01)', async () => {
    const integration = await seed(labTenantId);
    for (const name of ['trigger-compra_aprovada', 'trigger-subscription_renewed']) {
      const bytes = fixture(name);
      const res = await answer(
        await deliver(integration, bytes, {
          signature: sha1(reserialised(bytes), integration.token),
        }),
      );
      expect(res, name).toEqual({ status: 200, json: { received: true, enqueued: true } });
    }
    expect(await eventsOf(integration.id)).toHaveLength(2);
    expect(await jobsOf(labTenantId)).toHaveLength(2);
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
      'comprador.teste@example.test',
      'Comprador Sintetico',
      'Rua Sintetica',
      'afiliado@example.test',
    ]) {
      expect(joined.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });
});

describe('09.1 triggers', () => {
  /** The ten triggers, the instalment events and the odd shapes, named after the COVERAGE.md ids. */
  const MAPPED: [string, string, string][] = [
    ['trigger-compra_aprovada', 'purchase_approved', 'grant'],
    ['trigger-compra_reembolsada', 'purchase_refunded', 'revoke'],
    ['trigger-chargeback', 'chargeback', 'revoke'],
    ['trigger-subscription_late', 'subscription_late', 'suspend'],
    ['trigger-subscription_canceled', 'subscription_canceled', 'suspend'],
    ['trigger-subscription_renewed', 'subscription_renewed', 'grant'],
    ['trigger-compra_recusada', 'purchase_refused', 'none'],
    ['trigger-boleto_gerado', 'boleto_generated', 'none'],
    ['trigger-pix_gerado', 'pix_generated', 'none'],
    ['trigger-carrinho_abandonado', 'cart_abandoned', 'none'],
    ['payload-scheduled_installment_access_removed', 'subscription_late', 'suspend'],
    ['payload-scheduled_installment_access_restored', 'subscription_renewed', 'grant'],
    ['payload-scheduled_installment_other', 'other', 'none'],
    ['payload-unknown_shape', 'other', 'none'],
  ];

  it('accepts every fixture through the real route and stores the neutral type and effect', async () => {
    const integration = await seed(labTenantId);
    for (const [name] of MAPPED) {
      const res = await answer(await deliver(integration, fixture(name)));
      expect(res, name).toEqual({ status: 200, json: { received: true, enqueued: true } });
    }

    const rows = await eventsOf(integration.id);
    expect(rows).toHaveLength(MAPPED.length);
    const stored = rows.map((row) => `${row.type}/${row.effect}`).sort();
    expect(stored).toEqual(MAPPED.map(([, type, effect]) => `${type}/${effect}`).sort());
    expect(await jobsOf(labTenantId)).toHaveLength(MAPPED.length);
  });

  it('records the four triggers that change nothing with no effect', async () => {
    const integration = await seed(labTenantId);
    const names = [
      'trigger-compra_recusada',
      'trigger-boleto_gerado',
      'trigger-pix_gerado',
      'trigger-carrinho_abandonado',
    ];
    for (const name of names) expect((await deliver(integration, fixture(name))).status).toBe(200);

    const rows = await eventsOf(integration.id);
    expect(rows.map((row) => row.effect)).toEqual(['none', 'none', 'none', 'none']);
    expect(rows.map((row) => row.type).sort()).toEqual([
      'boleto_generated',
      'cart_abandoned',
      'pix_generated',
      'purchase_refused',
    ]);
    const states = await adminSql<{ state: string }[]>`
      select state from public.payment_events where integration_id = ${integration.id}::uuid`;
    // The apply job (plan 07) ends them `ignored`; until it runs they sit `received`.
    for (const { state } of states) expect(['received', 'ignored']).toContain(state);
  });

  it('keys a renewal and a late payment of one subscription by the subscription id, the sale by the order', async () => {
    const integration = await seed(labTenantId);
    for (const name of [
      'trigger-compra_aprovada',
      'trigger-subscription_renewed',
      'trigger-subscription_late',
    ]) {
      expect((await deliver(integration, fixture(name))).status).toBe(200);
    }
    const byType = new Map((await eventsOf(integration.id)).map((row) => [row.type, row]));
    // The observed approval is a subscription sale: it is keyed by the subscription id, like the renewal.
    expect(byType.get('purchase_approved')?.external_ref).toBe(
      subscriptionOf('trigger-compra_aprovada'),
    );
    expect(byType.get('subscription_renewed')?.external_ref).toBe(
      '5c2e8b41-0000-4000-8000-00000000c001',
    );
    expect(byType.get('subscription_late')?.external_ref).toBe(
      subscriptionOf('trigger-subscription_late'),
    );
    expect(byType.get('subscription_renewed')?.valid_until?.toISOString()).toBe(
      '2026-11-20T17:32:00.000Z',
    );
  });

  it('P76: signed empty and malformed bodies answer 200 and are stored as other / none', async () => {
    const integration = await seed(labTenantId);
    const base = body('trigger-compra_aprovada');
    const bodies: Buffer[] = [
      Buffer.from('{}'),
      Buffer.from('[]'),
      Buffer.from('null'),
      Buffer.alloc(0),
      Buffer.from('not json at all'),
      Buffer.from(JSON.stringify({ ...base, webhook_event_type: '' })),
    ];
    for (const body of bodies) {
      const res = await answer(await deliver(integration, body));
      expect(res.status).toBe(200);
    }
    const rows = await eventsOf(integration.id);
    expect(rows).toHaveLength(bodies.length);
    for (const row of rows) {
      expect(row).toMatchObject({ type: 'other', effect: 'none', email: null, amount_cents: null });
    }
  });

  it('P76: a body without Product, with a null Customer or without Commissions is stored as the mapped type with null fields', async () => {
    const integration = await seed(labTenantId);
    // A one-off sale derived from the observed approval (which is a subscription sale): the three variants
    // are told apart by their order id, so the subscription is removed.
    const base = body('trigger-compra_aprovada');
    delete base.Subscription;
    delete base.subscription_id;
    const withoutProduct: Record<string, unknown> = { ...base, order_id: 'no-product' };
    delete withoutProduct.Product;
    const variants = [
      withoutProduct,
      { ...base, order_id: 'no-customer', Customer: null },
      { ...base, order_id: 'no-commissions', Commissions: undefined },
    ];
    for (const variant of variants) {
      expect((await deliver(integration, Buffer.from(JSON.stringify(variant)))).status).toBe(200);
    }
    const byRef = new Map((await eventsOf(integration.id)).map((row) => [row.external_ref, row]));
    expect(byRef.get('no-product')).toMatchObject({
      type: 'purchase_approved',
      external_product_id: null,
      email: 'comprador.teste@example.test',
    });
    expect(byRef.get('no-customer')).toMatchObject({ type: 'purchase_approved', email: null });
    expect(byRef.get('no-commissions')).toMatchObject({
      type: 'purchase_approved',
      amount_cents: null,
      currency: null,
    });
  });

  it('answers a replay of a delivered body with enqueued false and stores no second event', async () => {
    const integration = await seed(labTenantId);
    const raw = fixture('trigger-subscription_canceled');
    // A replay carries the same bytes AND the same signature as the delivery it repeats. (Before CR-01 this
    // case replayed the bytes under the OTHER signed material, which only the token holder can produce and
    // which keyed on the received bytes; the replay memory now keys on the authenticated material.)
    expect((await answer(await deliver(integration, raw))).json.enqueued).toBe(true);
    const again = await answer(await deliver(integration, raw));
    expect(again).toEqual({ status: 200, json: { received: true, enqueued: false } });
    expect(await eventsOf(integration.id)).toHaveLength(1);
    expect(await jobsOf(labTenantId)).toHaveLength(1);
  });
});
