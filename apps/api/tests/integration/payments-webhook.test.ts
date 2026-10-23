import { createHash, createHmac } from 'node:crypto';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { rootLogger } from '@rede-social/core/server/logging';
import { sealSecret } from '@rede-social/core/server/payments/secret';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  adminSql,
  api,
  removePaymentIntegrations,
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  signedWebhook,
} from './setup';

/**
 * Phase 09.1-05 (PAY-01..04, PAY-29; D-486, D-488): the front door of the gateway integration, proven
 * with REAL signed requests against the live local stack and the real route.
 *
 * Everything runs through the `fake` adapter (HMAC-SHA256 hex over the received bytes in
 * `?signature=`), whose code path has the shape of the real adapter's: a query parameter, raw bytes,
 * a constant-time compare. No gateway account is needed; the real capture is plan 20.
 *
 * Fixture hygiene: every case seeds its own integration and tears it down with its events and queued
 * jobs, so this file leaves no row behind and cannot be disturbed by another file's residue.
 */

const WEBHOOK = '/v1/webhooks';

let labTenantId = '';
let demoTenantId = '';
const touchedTenants = new Set<string>();

type EventRow = {
  id: string;
  tenant_id: string;
  integration_id: string;
  provider: string;
  dedupe_key: string;
  type: string;
  effect: string;
  state: string;
  external_ref: string | null;
  order_ref: string | null;
  external_product_id: string | null;
  email: string | null;
  amount_cents: number | null;
  currency: string | null;
  valid_until: Date | null;
};

const approved = (extra: Record<string, unknown> = {}) => ({
  type: 'purchase_approved',
  externalRef: `ord-${crypto.randomUUID()}`,
  orderRef: 'REF-1',
  productId: 'prod-1',
  email: '  Buyer@Example.COM ',
  amountCents: 4990,
  currency: 'BRL',
  validUntil: '2026-12-31T00:00:00.000Z',
  recurring: false,
  ...extra,
});

async function seed(
  tenantId: string,
  options: { provider?: string; token?: string } = {},
): Promise<SeededPaymentIntegration> {
  touchedTenants.add(tenantId);
  return seedPaymentIntegration(tenantId, options);
}

async function eventsOf(integrationId: string): Promise<EventRow[]> {
  return adminSql<EventRow[]>`
    select id, tenant_id, integration_id, provider, dedupe_key, type, effect, state, external_ref,
           order_ref, external_product_id, email, amount_cents, currency, valid_until
      from public.payment_events where integration_id = ${integrationId}::uuid
     order by received_at, id`;
}

async function jobsOf(tenantId: string) {
  return adminSql<{ data: Record<string, unknown>; singleton_key: string; state: string }[]>`
    select data, singleton_key, state from pgboss.job_common
     where name = 'kernel.payment-event'
       and singleton_key in (select id::text from public.payment_events
                              where tenant_id = ${tenantId}::uuid)
     order by created_on`;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

type Answer = { status: number; json: Record<string, unknown> };
async function answer(res: Response): Promise<Answer> {
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
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
  it('records ONE event and enqueues ONE job for a correctly signed delivery of the integration tenant', async () => {
    const integration = await seed(labTenantId);
    const body = approved();

    const res = await answer(await signedWebhook(integration, body));
    expect(res).toEqual({ status: 200, json: { received: true, enqueued: true } });

    const rows = await eventsOf(integration.id);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      tenant_id: labTenantId,
      integration_id: integration.id,
      provider: 'fake',
      type: 'purchase_approved',
      effect: 'grant',
      state: 'received',
      external_ref: body.externalRef,
      order_ref: 'REF-1',
      external_product_id: 'prod-1',
      email: 'buyer@example.com',
      amount_cents: 4990,
      currency: 'BRL',
    });
    expect(row?.valid_until?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(row?.dedupe_key).toBe(sha256(JSON.stringify(body)));

    const jobs = await jobsOf(labTenantId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ eventId: row?.id });
    expect(jobs[0]?.singleton_key).toBe(row?.id);

    const [integrationRow] = await adminSql<{ last_event_at: Date | null }[]>`
      select last_event_at from public.payment_integrations where id = ${integration.id}::uuid`;
    expect(integrationRow?.last_event_at).toBeInstanceOf(Date);
  });

  it('answers the same body again with enqueued false and changes nothing', async () => {
    const integration = await seed(labTenantId);
    const body = JSON.stringify(approved());

    expect((await answer(await signedWebhook(integration, body))).json.enqueued).toBe(true);
    const [before] = await adminSql<{ last_event_at: Date }[]>`
      select last_event_at from public.payment_integrations where id = ${integration.id}::uuid`;

    const again = await answer(await signedWebhook(integration, body));
    expect(again).toEqual({ status: 200, json: { received: true, enqueued: false } });
    expect(await eventsOf(integration.id)).toHaveLength(1);
    expect(await jobsOf(labTenantId)).toHaveLength(1);

    const [after] = await adminSql<{ last_event_at: Date }[]>`
      select last_event_at from public.payment_integrations where id = ${integration.id}::uuid`;
    expect(after?.last_event_at.getTime()).toBe(before?.last_event_at.getTime());
  });

  it('refuses a wrong, missing, tampered or foreign signature with 403 and stores nothing', async () => {
    const integration = await seed(labTenantId);
    const body = JSON.stringify(approved());
    const forbidden = { status: 403, json: { error: { code: 'FORBIDDEN' } } };

    expect(
      await answer(await signedWebhook(integration, body, { signature: 'f'.repeat(64) })),
    ).toEqual(forbidden);
    expect(await answer(await signedWebhook(integration, body, { omitSignature: true }))).toEqual(
      forbidden,
    );
    expect(await answer(await signedWebhook(integration, body, { signature: '' }))).toEqual(
      forbidden,
    );
    expect(await answer(await signedWebhook(integration, body, { token: 'someone-else' }))).toEqual(
      forbidden,
    );
    // A signature over the original body with one byte of the body changed.
    const original = createHmac('sha256', integration.token).update(body).digest('hex');
    expect(
      await answer(
        await signedWebhook(integration, body.replace('prod-1', 'prod-2'), {
          signature: original,
        }),
      ),
    ).toEqual(forbidden);

    expect(await eventsOf(integration.id)).toHaveLength(0);
    expect(await jobsOf(labTenantId)).toHaveLength(0);
  });

  it('answers 404 for an unknown, malformed or wrong-provider integration id before any write', async () => {
    const integration = await seed(labTenantId);
    const body = JSON.stringify(approved());
    const notFound = { status: 404, json: { error: { code: 'NOT_FOUND' } } };

    expect(
      await answer(await signedWebhook(integration, body, { id: crypto.randomUUID() })),
    ).toEqual(notFound);
    expect(await answer(await signedWebhook(integration, body, { id: 'not-a-uuid' }))).toEqual(
      notFound,
    );
    expect(await answer(await signedWebhook(integration, body, { provider: 'other' }))).toEqual(
      notFound,
    );
    expect(await eventsOf(integration.id)).toHaveLength(0);
  });

  it('09.2-10: the tenant comes from the central route index — without its row the same signed delivery answers 404, with it 200', async () => {
    const integration = await seed(labTenantId);
    const body = JSON.stringify(approved());
    await adminSql`
      delete from platform.payment_integration_routes where integration_id = ${integration.id}::uuid`;
    expect((await signedWebhook(integration, body)).status).toBe(404);
    expect(await eventsOf(integration.id)).toHaveLength(0);

    await adminSql`
      insert into platform.payment_integration_routes (integration_id, tenant_id, provider)
      values (${integration.id}::uuid, ${labTenantId}::uuid, ${integration.provider})`;
    expect((await signedWebhook(integration, body)).status).toBe(200);
    const [event] = await eventsOf(integration.id);
    // The event's tenant is the integration's, read through the route; nothing in the payload names one.
    expect(event?.tenant_id).toBe(labTenantId);
  });

  it('answers GET and HEAD with 200 { status: ok } and reads no row', async () => {
    const integration = await seed(labTenantId);
    const url = `${WEBHOOK}/${integration.provider}/${integration.id}`;
    const get = await api.request(url);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ status: 'ok' });
    const head = await api.request(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('keeps the events table free of any payload column and of buyer data (PR-9)', async () => {
    const columns = await adminSql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'payment_events'`;
    const names = columns.map((c) => c.column_name);
    for (const forbidden of ['payload', 'body', 'raw', 'cpf', 'phone', 'address', 'ip', 'name']) {
      expect(names.some((n) => n === forbidden || n.includes(`${forbidden}_`))).toBe(false);
    }
    expect(names).toContain('email');
  });
});

describe('09.1 edges', () => {
  it('P3: two providers in one tenant coexist, the same provider twice is refused, a prefix name never resolves to the wrong adapter', async () => {
    const fake = await seed(labTenantId);
    const other = await seed(labTenantId, { provider: 'fake2' });
    expect(other.provider).toBe('fake2');

    await expect(seed(labTenantId)).rejects.toMatchObject({ code: '23505' });

    // `fake` still resolves its own adapter while `fake2` (a prefix-sharing name) has none here.
    const body = JSON.stringify(approved());
    expect((await signedWebhook(fake, body)).status).toBe(200);
    expect((await signedWebhook(other, body)).status).toBe(404);
    // Neither id works under the other's provider segment.
    expect((await signedWebhook(other, body, { provider: 'fake' })).status).toBe(404);
    expect((await signedWebhook(fake, body, { provider: 'fake2' })).status).toBe(404);
    expect(await eventsOf(other.id)).toHaveLength(0);
  });

  it('P4: an empty segment, an unknown provider answer 404, and an empty body with a valid signature is recorded as other', async () => {
    const integration = await seed(labTenantId);
    const empty = await api.request(`${WEBHOOK}//${integration.id}?signature=aa`, {
      method: 'POST',
      body: '{}',
    });
    expect(empty.status).toBe(404);
    expect((await signedWebhook(integration, '{}', { provider: 'nope' })).status).toBe(404);

    const res = await answer(await signedWebhook(integration, ''));
    expect(res).toEqual({ status: 200, json: { received: true, enqueued: true } });
    const [row] = await eventsOf(integration.id);
    expect(row).toMatchObject({ type: 'other', effect: 'none', state: 'received', email: null });
    expect(row?.dedupe_key).toBe(sha256(''));
  });

  it('P5: signatures and dedupe keys are computed over the received BYTES (a BOM and invalid UTF-8)', async () => {
    const integration = await seed(labTenantId);

    const json = Buffer.from(JSON.stringify(approved({ email: 'bom@example.com' })), 'utf8');
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), json]);
    expect((await signedWebhook(integration, withBom)).status).toBe(200);
    // The signature of the BOM-less body does not verify the BOM body (exact bytes only).
    const bomSignedWrong = await signedWebhook(integration, withBom, {
      signature: createHmac('sha256', integration.token).update(json).digest('hex'),
    });
    expect(bomSignedWrong.status).toBe(403);

    const invalid = Buffer.from([0x7b, 0xff, 0xfe, 0x7d]);
    expect((await signedWebhook(integration, invalid)).status).toBe(200);
    const reencoded = Buffer.from(invalid.toString('utf8'), 'utf8');
    expect(
      (
        await signedWebhook(integration, invalid, {
          signature: createHmac('sha256', integration.token).update(reencoded).digest('hex'),
        })
      ).status,
    ).toBe(403);

    const rows = await eventsOf(integration.id);
    expect(rows).toHaveLength(2);
    const keys = rows.map((r) => r.dedupe_key).sort();
    expect(keys).toEqual([sha256(withBom), sha256(invalid)].sort());
    expect(rows.find((r) => r.dedupe_key === sha256(withBom))).toMatchObject({
      type: 'purchase_approved',
      email: 'bom@example.com',
    });
    expect(rows.find((r) => r.dedupe_key === sha256(invalid))?.type).toBe('other');
  });

  it('P5: the stored e-mail satisfies the lower(btrim()) rule SQL uses', async () => {
    const integration = await seed(labTenantId);
    await signedWebhook(integration, approved({ email: '\t Mixed.Case@EXAMPLE.com\n' }));
    const [row] = await adminSql<{ email: string; ok: boolean }[]>`
      select email, email = lower(btrim(email)) as ok
        from public.payment_events where integration_id = ${integration.id}::uuid`;
    expect(row?.ok).toBe(true);
    expect(row?.email).toBe('mixed.case@example.com');
  });

  it('P8: eight simultaneous identical deliveries leave exactly one row and one job', async () => {
    const integration = await seed(labTenantId);
    const body = JSON.stringify(approved());
    const answers = await Promise.all(
      Array.from({ length: 8 }, async () => answer(await signedWebhook(integration, body))),
    );
    expect(answers.every((a) => a.status === 200)).toBe(true);
    expect(answers.filter((a) => a.json.enqueued === true)).toHaveLength(1);
    expect(await eventsOf(integration.id)).toHaveLength(1);
    expect(await jobsOf(labTenantId)).toHaveLength(1);
  });

  it('P7: parallel deliveries of two tenants share nothing and each event carries its own tenant', async () => {
    const lab = await seed(labTenantId);
    const demo = await seed(demoTenantId);
    const sends: Promise<Response>[] = [];
    for (let i = 0; i < 4; i += 1) {
      sends.push(signedWebhook(lab, approved({ externalRef: `lab-${i}` })));
      sends.push(signedWebhook(demo, approved({ externalRef: `demo-${i}` })));
    }
    const responses = await Promise.all(sends);
    expect(responses.every((r) => r.status === 200)).toBe(true);

    const labRows = await eventsOf(lab.id);
    const demoRows = await eventsOf(demo.id);
    expect(labRows).toHaveLength(4);
    expect(demoRows).toHaveLength(4);
    expect(
      labRows.every((r) => r.tenant_id === labTenantId && r.external_ref?.startsWith('lab-')),
    ).toBe(true);
    expect(
      demoRows.every((r) => r.tenant_id === demoTenantId && r.external_ref?.startsWith('demo-')),
    ).toBe(true);
    // A delivery signed with the lab token never lands under the demo integration.
    expect((await signedWebhook(demo, approved(), { token: lab.token })).status).toBe(403);
  });

  it('P9: a token replacement is one whole update: the old signature fails after it, the new one works, no delivery ever 5xxs', async () => {
    const integration = await seed(labTenantId);
    const body = JSON.stringify(approved());
    expect((await signedWebhook(integration, body)).status).toBe(200);

    const newToken = `new-${crypto.randomUUID()}`;
    const racing = Array.from({ length: 6 }, (_, i) =>
      signedWebhook(integration, approved({ externalRef: `race-${i}` })).then((r) => r.status),
    );
    await adminSql`
      update public.payment_integrations
         set secret_sealed = ${sealSecret(newToken, integration.id)}, secret_set_at = now()
       where id = ${integration.id}::uuid`;
    for (const status of await Promise.all(racing)) expect([200, 403]).toContain(status);

    expect((await signedWebhook(integration, approved({ externalRef: 'after' }))).status).toBe(403);
    expect(
      (await signedWebhook(integration, approved({ externalRef: 'after' }), { token: newToken }))
        .status,
    ).toBe(200);
  });

  it('refuses a 300 KiB body with 413 before anything is read or stored', async () => {
    const integration = await seed(labTenantId);
    const big = JSON.stringify(approved({ email: `${'a'.repeat(300 * 1024)}@x.co` }));
    const res = await signedWebhook(integration, big);
    expect(res.status).toBe(413);
    expect(await eventsOf(integration.id)).toHaveLength(0);
  });

  it('sends Cache-Control: no-store on every answer of the POST', async () => {
    const integration = await seed(labTenantId);
    const body = JSON.stringify(approved());
    expect((await signedWebhook(integration, body)).headers.get('cache-control')).toBe('no-store');
    expect(
      (await signedWebhook(integration, body, { signature: 'bad' })).headers.get('cache-control'),
    ).toBe('no-store');
  });
});

describe('09.1 secrecy', () => {
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

  it('no log line carries the token, the signature value or any part of the body', async () => {
    const integration = await seed(labTenantId);
    const marker = `body-marker-${crypto.randomUUID()}`;
    const body = JSON.stringify(approved({ email: `${marker}@example.com`, orderRef: marker }));
    const goodSignature = createHmac('sha256', integration.token).update(body).digest('hex');
    const forgedSignature = 'e'.repeat(64);

    const lines = await captureLogs(async () => {
      expect((await signedWebhook(integration, body)).status).toBe(200);
      expect((await signedWebhook(integration, body, { signature: forgedSignature })).status).toBe(
        403,
      );
      expect((await signedWebhook(integration, body)).status).toBe(200); // duplicate
    });

    // Non-vacuous: the capture saw the rejection line and the three request lines.
    const joined = lines.join('');
    expect(joined).toContain('payments.webhook.signature_rejected');
    expect(lines.filter((l) => l.includes('"message":"request"'))).toHaveLength(3);

    for (const secret of [integration.token, goodSignature, forgedSignature, marker, 'Buyer']) {
      expect(joined).not.toContain(secret);
    }

    const requestLines = lines
      .filter((l) => l.includes('"message":"request"'))
      .map((l) => JSON.parse(l) as { path: string });
    for (const line of requestLines) {
      expect(line.path).toBe(`${WEBHOOK}/fake/${integration.id}`);
      expect(line.path).not.toContain('?');
      expect(line.path).not.toContain('signature');
    }
  });

  it('WR-02: a failed insert answers 500 and logs neither the buyer e-mail nor the amount', async () => {
    const integration = await seed(labTenantId);
    const email = `ana.${crypto.randomUUID().slice(0, 8)}@exemplo.com.br`;
    const amount = 8_467_135;
    const ref = `pii-${crypto.randomUUID()}`;
    const body = JSON.stringify(approved({ externalRef: ref, email, amountCents: amount }));

    await adminSql.unsafe(`
      create or replace function public.paywh_boom() returns trigger language plpgsql as $$
      begin
        if new.external_ref like 'pii-%' then raise exception 'paywh boom'; end if;
        return new;
      end $$`);
    await adminSql.unsafe(`
      create trigger paywh_boom before insert on public.payment_events
      for each row execute function public.paywh_boom()`);
    let status = 0;
    let answer = '';
    let lines: string[] = [];
    try {
      lines = await captureLogs(async () => {
        const res = await signedWebhook(integration, body);
        status = res.status;
        answer = await res.text();
      });
    } finally {
      await adminSql.unsafe('drop trigger if exists paywh_boom on public.payment_events');
      await adminSql.unsafe('drop function if exists public.paywh_boom()');
    }

    expect(status).toBe(500);
    // Non-vacuous: the failure reached the error log.
    expect(lines.some((line) => line.includes('"severity":"ERROR"'))).toBe(true);
    for (const text of [lines.join(''), answer]) {
      expect(text).not.toContain(email);
      expect(text).not.toContain(String(amount));
      expect(text).not.toContain('Failed query');
      expect(text).not.toContain('params:');
    }
  });

  it('the 403 and 404 answers carry no message or detail', async () => {
    const integration = await seed(labTenantId);
    const body = JSON.stringify(approved());
    const forbidden = await signedWebhook(integration, body, { signature: 'bad' });
    expect(await forbidden.json()).toStrictEqual({ error: { code: 'FORBIDDEN' } });
    const notFound = await signedWebhook(integration, body, { id: crypto.randomUUID() });
    expect(await notFound.json()).toStrictEqual({ error: { code: 'NOT_FOUND' } });
  });

  it('stores the token only sealed: the column never equals or contains it', async () => {
    const integration = await seed(labTenantId);
    const [row] = await adminSql<{ secret_sealed: string }[]>`
      select secret_sealed from public.payment_integrations where id = ${integration.id}::uuid`;
    expect(row?.secret_sealed).not.toBe(integration.token);
    expect(row?.secret_sealed).not.toContain(integration.token);
    expect(row?.secret_sealed.startsWith('v1:')).toBe(true);
  });
});
