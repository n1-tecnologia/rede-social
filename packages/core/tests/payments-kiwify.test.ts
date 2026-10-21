import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from '../server/payments/adapters';
import { CANCEL_EFFECT, kiwifyGateway, signatureCandidates } from '../server/payments/kiwify';
import { decideAccessWrite } from '../server/payments/policy';
import { GatewayError } from '../server/payments/types';

/**
 * The first real gateway behind the seam (09.1-08, D-486, PAY-02, PAY-03, PAY-33). Pure functions of the
 * received bytes: no database, no network, no clock. Each fixture carries a `_fixture` provenance key:
 * the six triggers of the 2026-10-21 capture (approved, refunded, charged back, late, canceled, refused)
 * are `real-capture (redacted)` vendor test deliveries; every other fixture is a `documented-example
 * (synthetic)` built from the vendor documentation (09.1-20). The six real bodies are all deliveries of a
 * SUBSCRIPTION product, so a one-off sale is derived from them in the test (a labelled mutation), never
 * claimed as observed.
 */

const SECRET = 'webhook-token-for-tests';
const FIXTURES = new URL('./fixtures/payments/kiwify/', import.meta.url);

const fixture = (name: string): Buffer => readFileSync(new URL(`${name}.json`, FIXTURES));
const json = (name: string): Record<string, unknown> =>
  JSON.parse(fixture(name).toString('utf8')) as Record<string, unknown>;
/** The fixture with `change` applied to its parsed form, as bytes. */
const mutated = (name: string, change: (body: Record<string, unknown>) => void): Buffer => {
  const body = json(name);
  change(body);
  return Buffer.from(JSON.stringify(body), 'utf8');
};
/** The same body with its subscription removed: a one-off sale, derived (NOT observed in the capture). */
const dropSubscription = (body: Record<string, unknown>) => {
  delete body.Subscription;
  delete body.subscription_id;
};
const subscriptionOf = (name: string) => String((json(name).Subscription as { id: string }).id);
const orderOf = (name: string) => String(json(name).order_id);
const productOf = (name: string) =>
  String((json(name).Product as { product_id: string }).product_id);
const sha1 = (body: Buffer | string, secret = SECRET) =>
  createHmac('sha1', secret).update(body).digest('hex');
const reserialised = (raw: Buffer) =>
  Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))), 'utf8');

describe('registration', () => {
  it('is the adapter registered under its provider name and names itself for the admin copy', () => {
    expect(ADAPTERS.kiwify).toBe(kiwifyGateway);
    expect(kiwifyGateway.name).toBe('kiwify');
    expect(kiwifyGateway.displayName).toBe('Kiwify');
  });
});

describe('kiwifyGateway.verify', () => {
  const raw = fixture('trigger-compra_aprovada');

  it('the fixture is pretty-printed, so the raw bytes and the re-serialised JSON really differ', () => {
    expect(reserialised(raw).equals(raw)).toBe(false);
    expect(signatureCandidates(raw).map((candidate) => candidate.variant)).toEqual([
      'raw',
      'reserialised',
    ]);
  });

  it('accepts HMAC-SHA1 hex of the exact received bytes and names the variant raw', () => {
    expect(
      kiwifyGateway.verify({ rawBody: raw, signature: sha1(raw), secret: SECRET }).variant,
    ).toBe('raw');
  });

  it('returns the signed bytes: the received bytes for the raw variant (CR-01)', () => {
    const verified = kiwifyGateway.verify({ rawBody: raw, signature: sha1(raw), secret: SECRET });
    expect(verified.signed.equals(raw)).toBe(true);
  });

  it('returns the re-serialised bytes as the signed material for the reserialised variant (CR-01)', () => {
    const verified = kiwifyGateway.verify({
      rawBody: raw,
      signature: sha1(reserialised(raw)),
      secret: SECRET,
    });
    expect(verified.signed.equals(reserialised(raw))).toBe(true);
    expect(verified.signed.equals(raw)).toBe(false);
  });

  it('gives every rendering of one authenticated delivery the SAME signed bytes (CR-01)', () => {
    const signature = sha1(reserialised(raw));
    const renderings = [
      raw,
      Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8')), null, '\t'), 'utf8'),
      Buffer.from(`\n${JSON.stringify(JSON.parse(raw.toString('utf8')), null, 4)}\n\n`, 'utf8'),
    ];
    const signed = renderings.map(
      (rawBody) => kiwifyGateway.verify({ rawBody, signature, secret: SECRET }).signed,
    );
    for (const bytes of signed) expect(bytes.equals(signed[0] as Buffer)).toBe(true);
    expect(renderings[1]?.equals(raw)).toBe(false);
  });

  it('gives a genuinely different body different signed bytes (CR-01)', () => {
    const other = fixture('trigger-subscription_renewed');
    const a = kiwifyGateway.verify({ rawBody: raw, signature: sha1(raw), secret: SECRET });
    const b = kiwifyGateway.verify({ rawBody: other, signature: sha1(other), secret: SECRET });
    expect(a.signed.equals(b.signed)).toBe(false);
  });

  it('accepts HMAC-SHA1 hex of the re-serialised JSON and names the variant reserialised (A-P17)', () => {
    expect(
      kiwifyGateway.verify({
        rawBody: raw,
        signature: sha1(reserialised(raw)),
        secret: SECRET,
      }),
    ).toMatchObject({ variant: 'reserialised' });
  });

  it('names a compact body raw even though both candidates are identical', () => {
    const compact = reserialised(raw);
    expect(
      kiwifyGateway.verify({ rawBody: compact, signature: sha1(compact), secret: SECRET }).variant,
    ).toBe('raw');
  });

  it('accepts upper-case hex of an otherwise valid signature (the hex compare is case-insensitive)', () => {
    expect(
      kiwifyGateway.verify({ rawBody: raw, signature: sha1(raw).toUpperCase(), secret: SECRET })
        .variant,
    ).toBe('raw');
  });

  it('verifies a body that is not JSON over its raw bytes alone', () => {
    const text = Buffer.from('not json at all', 'utf8');
    const verified = kiwifyGateway.verify({ rawBody: text, signature: sha1(text), secret: SECRET });
    expect(verified.variant).toBe('raw');
    expect(verified.signed.equals(text)).toBe(true);
  });

  const refused: [
    string,
    () => { rawBody: Buffer; signature: string | undefined; secret: string },
  ][] = [
    ['a missing signature', () => ({ rawBody: raw, signature: undefined, secret: SECRET })],
    ['an empty signature', () => ({ rawBody: raw, signature: '', secret: SECRET })],
    [
      'a signature made with another token',
      () => ({ rawBody: raw, signature: sha1(raw, 'other-token'), secret: SECRET }),
    ],
    [
      'a one-byte change of the body',
      () => {
        const changed = Buffer.from(raw);
        changed[2] = (changed[2] ?? 0) ^ 0x01;
        return { rawBody: changed, signature: sha1(raw), secret: SECRET };
      },
    ],
    [
      'a truncated signature (length is checked before timingSafeEqual)',
      () => ({ rawBody: raw, signature: sha1(raw).slice(0, 38), secret: SECRET }),
    ],
    ['a longer signature', () => ({ rawBody: raw, signature: `${sha1(raw)}00`, secret: SECRET })],
    [
      'a non-hex signature of the right length',
      () => ({ rawBody: raw, signature: 'z'.repeat(40), secret: SECRET }),
    ],
    [
      'a SHA-256 signature (the fake adapter scheme)',
      () => ({
        rawBody: raw,
        signature: createHmac('sha256', SECRET).update(raw).digest('hex'),
        secret: SECRET,
      }),
    ],
    [
      'a non-JSON body whose raw HMAC does not match',
      () => ({
        rawBody: Buffer.from('not json', 'utf8'),
        signature: sha1('something else'),
        secret: SECRET,
      }),
    ],
  ];

  for (const [name, build] of refused) {
    it(`throws GatewayError invalid_signature for ${name}`, () => {
      let thrown: unknown;
      try {
        kiwifyGateway.verify(build());
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GatewayError);
      expect((thrown as GatewayError).kind).toBe('invalid_signature');
      expect((thrown as GatewayError).status).toBe(403);
    });
  }
});

describe('kiwifyGateway.normalise: the state-changing triggers', () => {
  it('maps the observed approval of a subscription product to purchase_approved / grant, keyed by the subscription', () => {
    const event = kiwifyGateway.normalise(fixture('trigger-compra_aprovada'));
    expect(event).toEqual({
      type: 'purchase_approved',
      effect: 'grant',
      externalRef: subscriptionOf('trigger-compra_aprovada'),
      orderRef: orderOf('trigger-compra_aprovada'),
      externalProductId: productOf('trigger-compra_aprovada'),
      email: 'comprador.teste@example.test',
      amountCents: 7602,
      currency: 'BRL',
      validUntil: null,
      occurredAt: null,
      recurring: true,
    });
  });

  it('maps a derived one-off approval (no Subscription) to a grant keyed by the order id', () => {
    const event = kiwifyGateway.normalise(mutated('trigger-compra_aprovada', dropSubscription));
    expect(event).toEqual({
      type: 'purchase_approved',
      effect: 'grant',
      externalRef: orderOf('trigger-compra_aprovada'),
      orderRef: orderOf('trigger-compra_aprovada'),
      externalProductId: productOf('trigger-compra_aprovada'),
      email: 'comprador.teste@example.test',
      amountCents: 7602,
      currency: 'BRL',
      validUntil: null,
      occurredAt: null,
      recurring: false,
    });
  });

  it('lower-cases and trims the e-mail and upper-cases the currency', () => {
    const event = kiwifyGateway.normalise(
      mutated('trigger-compra_aprovada', (body) => {
        (body.Customer as Record<string, unknown>).email = '  Mixed.Case@Example.COM \n';
        (body.Commissions as Record<string, unknown>).currency = ' brl ';
      }),
    );
    expect(event.email).toBe('mixed.case@example.com');
    expect(event.currency).toBe('BRL');
  });

  it('maps a renewal to subscription_renewed / grant keyed by the subscription id, with validUntil as Brazil time', () => {
    const event = kiwifyGateway.normalise(fixture('trigger-subscription_renewed'));
    expect(event).toMatchObject({
      type: 'subscription_renewed',
      effect: 'grant',
      externalRef: '5c2e8b41-0000-4000-8000-00000000c001',
      orderRef: '6f1d5c0e-0000-4000-8000-00000000a002',
      recurring: true,
      amountCents: 4990,
      occurredAt: null,
    });
    // "2026-11-20 14:32" read as UTC-3 is 17:32 UTC (A-P28, display-only).
    expect(event.validUntil).toEqual(new Date('2026-11-20T17:32:00.000Z'));
  });

  it('maps late to subscription_late / suspend and canceled to subscription_canceled / CANCEL_EFFECT', () => {
    const late = kiwifyGateway.normalise(fixture('trigger-subscription_late'));
    expect(late).toMatchObject({
      type: 'subscription_late',
      effect: 'suspend',
      externalRef: subscriptionOf('trigger-subscription_late'),
      recurring: true,
    });
    const canceled = kiwifyGateway.normalise(fixture('trigger-subscription_canceled'));
    expect(canceled).toMatchObject({
      type: 'subscription_canceled',
      effect: CANCEL_EFFECT,
      externalRef: subscriptionOf('trigger-subscription_canceled'),
      recurring: true,
    });
  });

  it('keeps D-496 literal in the cancel constant: a cancel cuts access at the cancel event (owner decision 2026-10-21, option a)', () => {
    expect(CANCEL_EFFECT).toBe('suspend');
    expect(kiwifyGateway.normalise(fixture('trigger-subscription_canceled')).effect).toBe(
      'suspend',
    );
  });

  it('maps a refund and a chargeback to revoke, as two different neutral types, each keyed by its own subscription', () => {
    const refunded = kiwifyGateway.normalise(fixture('trigger-compra_reembolsada'));
    const chargeback = kiwifyGateway.normalise(fixture('trigger-chargeback'));
    expect(refunded).toMatchObject({
      type: 'purchase_refunded',
      effect: 'revoke',
      externalRef: subscriptionOf('trigger-compra_reembolsada'),
    });
    expect(chargeback).toMatchObject({
      type: 'chargeback',
      effect: 'revoke',
      externalRef: subscriptionOf('trigger-chargeback'),
    });
  });

  it('does not carry the buyer personal data: the result holds exactly the neutral keys and no PII value', () => {
    const event = kiwifyGateway.normalise(fixture('trigger-compra_aprovada'));
    expect(Object.keys(event).sort()).toEqual(
      [
        'amountCents',
        'currency',
        'effect',
        'email',
        'externalProductId',
        'externalRef',
        'occurredAt',
        'orderRef',
        'recurring',
        'type',
        'validUntil',
      ].sort(),
    );
    const text = JSON.stringify(event);
    const customer = json('trigger-compra_aprovada').Customer as Record<string, string>;
    for (const personal of [
      customer.full_name,
      customer.first_name,
      customer.mobile,
      customer.CPF,
      customer.ip,
      customer.street,
      customer.city,
      'loja@example.test',
      'coprodutor@example.test',
      'afiliado@example.test',
    ]) {
      expect(personal, 'the fixture must hold the value this assertion looks for').toBeTruthy();
      expect(text).not.toContain(personal);
    }
  });
});

describe('kiwifyGateway.normalise: the amount (D-507)', () => {
  const amountOf = (value: unknown) =>
    kiwifyGateway.normalise(
      mutated('trigger-compra_aprovada', (body) => {
        (body.Commissions as Record<string, unknown>).charge_amount = value;
      }),
    ).amountCents;

  it('keeps an integer and refuses anything that would need rounding or guessing', () => {
    expect(amountOf(9990)).toBe(9990);
    expect(amountOf(0)).toBe(0);
    expect(amountOf(99.9)).toBeNull();
    expect(amountOf('9990')).toBeNull();
    expect(amountOf(-1)).toBeNull();
    expect(amountOf(null)).toBeNull();
    expect(amountOf(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it('a float or string amount still maps the event itself', () => {
    const event = kiwifyGateway.normalise(
      mutated('trigger-compra_aprovada', (body) => {
        (body.Commissions as Record<string, unknown>).charge_amount = '99.90';
      }),
    );
    expect(event).toMatchObject({ type: 'purchase_approved', effect: 'grant', amountCents: null });
  });
});

/** The documented-example renewal (not captured): its subscription id, used by the synthetic renewal rows. */
const SUBSCRIPTION = '5c2e8b41-0000-4000-8000-00000000c001';
const ORDER = orderOf('trigger-compra_aprovada');

/** All fourteen fixtures, named after the capability ids of COVERAGE.md, with what the adapter must say about each. */
const TABLE: {
  name: string;
  type: string;
  effect: string;
  externalRef: string | null;
  recurring: boolean;
  amountCents: number | null;
  currency: string | null;
  email: string | null;
}[] = [
  {
    name: 'trigger-compra_aprovada',
    type: 'purchase_approved',
    effect: 'grant',
    externalRef: subscriptionOf('trigger-compra_aprovada'),
    recurring: true,
    amountCents: 7602,
    currency: 'BRL',
    email: 'comprador.teste@example.test',
  },
  {
    name: 'trigger-compra_reembolsada',
    type: 'purchase_refunded',
    effect: 'revoke',
    externalRef: subscriptionOf('trigger-compra_reembolsada'),
    recurring: true,
    amountCents: 7663,
    currency: 'BRL',
    email: 'comprador.teste@example.test',
  },
  {
    name: 'trigger-chargeback',
    type: 'chargeback',
    effect: 'revoke',
    externalRef: subscriptionOf('trigger-chargeback'),
    recurring: true,
    amountCents: 7800,
    currency: 'BRL',
    email: 'comprador.teste@example.test',
  },
  {
    name: 'trigger-subscription_renewed',
    type: 'subscription_renewed',
    effect: 'grant',
    externalRef: SUBSCRIPTION,
    recurring: true,
    amountCents: 4990,
    currency: 'BRL',
    email: 'assinante.teste@example.test',
  },
  {
    name: 'trigger-subscription_late',
    type: 'subscription_late',
    effect: 'suspend',
    externalRef: subscriptionOf('trigger-subscription_late'),
    recurring: true,
    amountCents: 7517,
    currency: 'BRL',
    email: 'comprador.teste@example.test',
  },
  {
    name: 'trigger-subscription_canceled',
    type: 'subscription_canceled',
    effect: 'suspend',
    externalRef: subscriptionOf('trigger-subscription_canceled'),
    recurring: true,
    amountCents: 8437,
    currency: 'BRL',
    email: 'comprador.teste@example.test',
  },
  {
    name: 'trigger-compra_recusada',
    type: 'purchase_refused',
    effect: 'none',
    externalRef: orderOf('trigger-compra_recusada'),
    recurring: false,
    amountCents: 4697,
    currency: 'BRL',
    email: 'comprador.teste@example.test',
  },
  {
    name: 'trigger-boleto_gerado',
    type: 'boleto_generated',
    effect: 'none',
    externalRef: '6f1d5c0e-0000-4000-8000-00000000a011',
    recurring: false,
    amountCents: 2990,
    currency: 'BRL',
    email: 'boleto.teste@example.test',
  },
  {
    name: 'trigger-pix_gerado',
    type: 'pix_generated',
    effect: 'none',
    externalRef: '6f1d5c0e-0000-4000-8000-00000000a012',
    recurring: false,
    amountCents: 2990,
    currency: 'BRL',
    email: 'pix.teste@example.test',
  },
  {
    name: 'trigger-carrinho_abandonado',
    type: 'cart_abandoned',
    effect: 'none',
    externalRef: null,
    recurring: false,
    amountCents: null,
    currency: null,
    email: 'carrinho.teste@example.test',
  },
  {
    name: 'payload-scheduled_installment_access_removed',
    type: 'subscription_late',
    effect: 'suspend',
    externalRef: '6f1d5c0e-0000-4000-8000-00000000a020',
    recurring: false,
    amountCents: 14900,
    currency: 'BRL',
    email: 'parcelado.teste@example.test',
  },
  {
    name: 'payload-scheduled_installment_access_restored',
    type: 'subscription_renewed',
    effect: 'grant',
    externalRef: '6f1d5c0e-0000-4000-8000-00000000a020',
    recurring: false,
    amountCents: 14900,
    currency: 'BRL',
    email: 'parcelado.teste@example.test',
  },
  {
    name: 'payload-scheduled_installment_other',
    type: 'other',
    effect: 'none',
    externalRef: null,
    recurring: false,
    amountCents: null,
    currency: null,
    email: null,
  },
  {
    name: 'payload-unknown_shape',
    type: 'other',
    effect: 'none',
    externalRef: null,
    recurring: false,
    amountCents: null,
    currency: null,
    email: null,
  },
];

describe('kiwifyGateway.normalise: every fixture (PAY-33)', () => {
  it('covers all fourteen fixture files and nothing else', () => {
    expect(TABLE).toHaveLength(14);
    expect(new Set(TABLE.map((row) => row.name)).size).toBe(14);
  });

  for (const row of TABLE) {
    it(`${row.name} is ${row.type} / ${row.effect}`, () => {
      const event = kiwifyGateway.normalise(fixture(row.name));
      expect({
        type: event.type,
        effect: event.effect,
        externalRef: event.externalRef,
        recurring: event.recurring,
        amountCents: event.amountCents,
        currency: event.currency,
        email: event.email,
        occurredAt: event.occurredAt,
      }).toEqual({
        type: row.type,
        effect: row.effect,
        externalRef: row.externalRef,
        recurring: row.recurring,
        amountCents: row.amountCents,
        currency: row.currency,
        email: row.email,
        occurredAt: null,
      });
    });

    it(`${row.name} carries a provenance header and holds only synthetic data`, () => {
      const body = json(row.name);
      expect(String(body._fixture)).toMatch(
        /^(real-capture \(redacted\) \d{4}-\d{2}-\d{2}|documented-example \(synthetic\))/,
      );
      expect(fixture(row.name).toString('utf8')).not.toMatch(
        /@(?!example\.test)[a-z0-9.-]+\.[a-z]+/i,
      );
    });
  }

  it('the cart carries no order reference and the installment events are keyed by the order', () => {
    const cart = kiwifyGateway.normalise(fixture('trigger-carrinho_abandonado'));
    expect(cart).toMatchObject({
      orderRef: null,
      externalProductId: 'b7a3c9d2-0000-4000-8000-00000000b003',
      validUntil: null,
    });
    const removed = kiwifyGateway.normalise(
      fixture('payload-scheduled_installment_access_removed'),
    );
    expect(removed.orderRef).toBe('6f1d5c0e-0000-4000-8000-00000000a020');
  });

  it('a has_access that contradicts the installment event name falls back to the event name', () => {
    const removedButAccess = kiwifyGateway.normalise(
      mutated('payload-scheduled_installment_access_removed', (body) => {
        (
          (body.ScheduledInstallment as Record<string, unknown>).customer_access as Record<
            string,
            unknown
          >
        ).has_access = true;
      }),
    );
    expect(removedButAccess).toMatchObject({ type: 'subscription_late', effect: 'suspend' });
    const restoredButNoAccess = kiwifyGateway.normalise(
      mutated('payload-scheduled_installment_access_restored', (body) => {
        (
          (body.ScheduledInstallment as Record<string, unknown>).customer_access as Record<
            string,
            unknown
          >
        ).has_access = false;
      }),
    );
    expect(restoredButNoAccess).toMatchObject({ type: 'subscription_renewed', effect: 'grant' });
  });

  it('every other scheduled_installment_* type is other / none', () => {
    for (const name of ['created', 'cycle_paid', 'settled', 'overdue', 'cancelled', 'surprise']) {
      const event = kiwifyGateway.normalise(
        mutated('payload-scheduled_installment_other', (body) => {
          body.webhook_event_type = `scheduled_installment_${name}`;
        }),
      );
      expect(event).toMatchObject({ type: 'other', effect: 'none', email: null });
    }
  });
});

describe('P75 PAY-33 adjacency: approval, renewal, refund and chargeback', () => {
  it('an approved subscription purchase and a renewal of the SAME subscription are told apart by the event type and key the same subscription id', () => {
    const renewal = kiwifyGateway.normalise(fixture('trigger-subscription_renewed'));
    const approval = kiwifyGateway.normalise(
      mutated('trigger-subscription_renewed', (body) => {
        body.webhook_event_type = 'order_approved';
      }),
    );
    expect(approval).toMatchObject({
      type: 'purchase_approved',
      effect: 'grant',
      externalRef: SUBSCRIPTION,
      recurring: true,
    });
    expect(renewal).toMatchObject({ type: 'subscription_renewed', externalRef: SUBSCRIPTION });
    expect(approval.externalRef).toBe(renewal.externalRef);
    expect(approval.type).not.toBe(renewal.type);
  });

  it('the type comes from the event name, never from the shape of the body', () => {
    // A one-off order body labelled as a renewal is a renewal keyed by the order: no subscription object invented.
    const event = kiwifyGateway.normalise(
      mutated('trigger-compra_aprovada', (body) => {
        dropSubscription(body);
        body.webhook_event_type = 'subscription_renewed';
      }),
    );
    expect(event).toMatchObject({
      type: 'subscription_renewed',
      externalRef: ORDER,
      recurring: false,
    });
  });

  it('a plain approval is a one-off sale whose reference is the order id; a top-level subscription id alone makes it recurring', () => {
    expect(
      kiwifyGateway.normalise(mutated('trigger-compra_aprovada', dropSubscription)),
    ).toMatchObject({
      recurring: false,
      externalRef: ORDER,
      orderRef: ORDER,
    });
    const viaId = kiwifyGateway.normalise(
      mutated('trigger-compra_aprovada', (body) => {
        dropSubscription(body);
        body.subscription_id = SUBSCRIPTION;
      }),
    );
    expect(viaId).toMatchObject({ recurring: true, externalRef: SUBSCRIPTION, orderRef: ORDER });
  });

  it('a recurring sale with no usable subscription id falls back to the order id', () => {
    const event = kiwifyGateway.normalise(
      mutated('trigger-subscription_renewed', (body) => {
        body.Subscription = {};
        body.subscription_id = null;
      }),
    );
    expect(event).toMatchObject({
      type: 'subscription_renewed',
      recurring: true,
      externalRef: '6f1d5c0e-0000-4000-8000-00000000a002',
    });
  });

  it('a refund and a chargeback of one order differ in type only', () => {
    // The same observed body labelled either way: the two real deliveries are different sales.
    const label = (name: string) =>
      kiwifyGateway.normalise(
        mutated('trigger-chargeback', (body) => {
          body.webhook_event_type = name;
        }),
      );
    const refund = label('order_refunded');
    const chargeback = label('chargeback');
    expect(refund.type).toBe('purchase_refunded');
    expect(chargeback.type).toBe('chargeback');
    expect({ ...refund, type: 'x' }).toEqual({ ...chargeback, type: 'x' });
    expect(refund.effect).toBe('revoke');
    expect(chargeback.effect).toBe('revoke');
  });
});

describe('the observed disagreements between the event name and the statuses (capture 2026-10-21)', () => {
  const status = (name: string) => {
    const body = json(name);
    return {
      order: body.order_status,
      subscription: (body.Subscription as { status?: string } | undefined)?.status,
    };
  };

  it('pins the disagreements the vendor really sent, so the cases below mean something', () => {
    expect(status('trigger-compra_aprovada')).toEqual({ order: 'paid', subscription: 'active' });
    expect(status('trigger-subscription_late')).toEqual({
      order: 'paid',
      subscription: 'waiting_payment',
    });
    expect(status('trigger-subscription_canceled')).toEqual({
      order: 'refunded',
      subscription: 'canceled',
    });
    expect(status('trigger-compra_reembolsada')).toEqual({
      order: 'refunded',
      subscription: 'canceled',
    });
    expect(status('trigger-chargeback')).toEqual({ order: 'chargedback', subscription: 'active' });
    expect(status('trigger-compra_recusada')).toEqual({
      order: 'refused',
      subscription: undefined,
    });
  });

  it('a late subscription whose order_status is paid is a late subscription, never an approval', () => {
    expect(kiwifyGateway.normalise(fixture('trigger-subscription_late'))).toMatchObject({
      type: 'subscription_late',
      effect: 'suspend',
    });
  });

  it('a canceled subscription whose order_status is refunded is a cancel, never a refund, and cuts access', () => {
    const event = kiwifyGateway.normalise(fixture('trigger-subscription_canceled'));
    expect(event).toMatchObject({ type: 'subscription_canceled', effect: CANCEL_EFFECT });
    expect(event.effect).toBe('suspend');
    expect(event.type).not.toBe('purchase_refunded');
  });

  it('a chargeback whose Subscription.status is still active is a chargeback and still revokes', () => {
    expect(kiwifyGateway.normalise(fixture('trigger-chargeback'))).toMatchObject({
      type: 'chargeback',
      effect: 'revoke',
    });
  });

  it('the observed refund and the observed cancel are different neutral types even though both say refunded', () => {
    const refund = kiwifyGateway.normalise(fixture('trigger-compra_reembolsada'));
    const cancel = kiwifyGateway.normalise(fixture('trigger-subscription_canceled'));
    expect(refund.type).toBe('purchase_refunded');
    expect(cancel.type).toBe('subscription_canceled');
    expect(refund.effect).toBe('revoke');
    expect(cancel.effect).toBe('suspend');
  });

  it('no observed delivery carries customer_access, so validUntil stays null for all six (unconfirmed, A-P28)', () => {
    for (const name of [
      'trigger-compra_aprovada',
      'trigger-compra_reembolsada',
      'trigger-chargeback',
      'trigger-subscription_late',
      'trigger-subscription_canceled',
      'trigger-compra_recusada',
    ]) {
      const subscription = json(name).Subscription as Record<string, unknown> | undefined;
      expect(subscription?.customer_access, name).toBeUndefined();
      expect(kiwifyGateway.normalise(fixture(name)).validUntil, name).toBeNull();
    }
  });

  it('amountCents is Commissions.charge_amount, not the completed charge or the commission (owed: which one is the amount paid)', () => {
    const body = json('trigger-compra_aprovada');
    const commissions = body.Commissions as { charge_amount: number; my_commission: number };
    const charged = (body.Subscription as { charges: { completed: { amount: number }[] } }).charges
      .completed[0]?.amount;
    expect(charged).not.toBe(commissions.charge_amount);
    expect(commissions.my_commission).not.toBe(commissions.charge_amount);
    expect(kiwifyGateway.normalise(fixture('trigger-compra_aprovada')).amountCents).toBe(
      commissions.charge_amount,
    );
  });

  it('the refused purchase has no Subscription and is keyed by its order id', () => {
    expect(json('trigger-compra_recusada').Subscription).toBeUndefined();
    expect(kiwifyGateway.normalise(fixture('trigger-compra_recusada'))).toMatchObject({
      type: 'purchase_refused',
      effect: 'none',
      recurring: false,
      externalRef: orderOf('trigger-compra_recusada'),
    });
  });
});

describe('the observed events through the order-of-events policy (D-496, owner decision 2026-10-21)', () => {
  const decide = (name: string, existing: Parameters<typeof decideAccessWrite>[0]['existing']) => {
    const event = kiwifyGateway.normalise(fixture(name));
    return decideAccessWrite({
      effect: event.effect as 'grant' | 'suspend' | 'revoke',
      recurring: event.recurring,
      existing,
      occurredAt: event.occurredAt,
    });
  };
  const active = { status: 'active', terminal: false, lastEventAt: null } as const;

  it('the observed approval of a subscription grants', () => {
    expect(decide('trigger-compra_aprovada', null)).toEqual({
      action: 'write',
      status: 'active',
      terminal: false,
      outcome: 'access_granted',
    });
  });

  it('the observed cancel cuts access at the cancel event and stays reversible by a later renewal', () => {
    expect(decide('trigger-subscription_canceled', active)).toEqual({
      action: 'write',
      status: 'inactive',
      terminal: false,
      outcome: 'access_cut',
    });
  });

  it('the observed late payment cuts access at once, and the observed chargeback cuts it too', () => {
    expect(decide('trigger-subscription_late', active)).toMatchObject({
      action: 'write',
      status: 'inactive',
      outcome: 'access_cut',
    });
    expect(decide('trigger-chargeback', active)).toMatchObject({
      action: 'write',
      status: 'inactive',
      outcome: 'access_cut',
    });
  });

  it('the observed refusal changes no access at all', () => {
    expect(kiwifyGateway.normalise(fixture('trigger-compra_recusada')).effect).toBe('none');
  });
});

describe('the approval rule (Kiwify: release access only when order_status is paid)', () => {
  const approvalWith = (change: (body: Record<string, unknown>) => void) =>
    kiwifyGateway.normalise(mutated('trigger-compra_aprovada', change));

  it('accepts paid in any case and an absent status', () => {
    expect(
      approvalWith((b) => {
        b.order_status = 'PAID';
      }).type,
    ).toBe('purchase_approved');
    expect(
      approvalWith((b) => {
        b.order_status = ' paid ';
      }).type,
    ).toBe('purchase_approved');
    expect(
      approvalWith((b) => {
        delete b.order_status;
      }).type,
    ).toBe('purchase_approved');
    expect(
      approvalWith((b) => {
        b.order_status = null;
      }).type,
    ).toBe('purchase_approved');
  });

  it('turns any present status other than paid into other / none, whatever its type', () => {
    for (const status of [
      'waiting_payment',
      'refused',
      'refunded',
      'chargedback',
      '',
      'unknown',
      7,
      true,
      [],
      {},
    ]) {
      const event = approvalWith((b) => {
        b.order_status = status;
      });
      expect(event).toMatchObject({ type: 'other', effect: 'none', email: null });
    }
  });

  it('matches event names exactly: a different case, a padded name and prototype keys are other', () => {
    for (const name of [
      'ORDER_APPROVED',
      'order-approved',
      'constructor',
      '__proto__',
      'toString',
    ]) {
      const event = approvalWith((b) => {
        b.webhook_event_type = name;
      });
      expect(event.type).toBe('other');
    }
    // surrounding whitespace is trimmed like every other text field
    expect(
      approvalWith((b) => {
        b.webhook_event_type = ' order_approved ';
      }).type,
    ).toBe('purchase_approved');
  });
});

describe('P76 PAY-33 empty and hostile bodies never throw', () => {
  const OTHER = {
    type: 'other',
    effect: 'none',
    externalRef: null,
    orderRef: null,
    externalProductId: null,
    email: null,
    amountCents: null,
    currency: null,
    validUntil: null,
    occurredAt: null,
    recurring: false,
  };
  const body = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');

  it('degrades an empty object, an array, a JSON null, scalars and an empty body to other / none', () => {
    for (const raw of [
      body({}),
      body([]),
      body(null),
      body(7),
      body('text'),
      body(true),
      Buffer.alloc(0),
      Buffer.from('   \n', 'utf8'),
      Buffer.from('{', 'utf8'),
      Buffer.from('not json', 'utf8'),
      Buffer.from([0xff, 0xfe, 0x00, 0x7b]),
    ]) {
      expect(kiwifyGateway.normalise(raw)).toEqual(OTHER);
    }
  });

  it('a 5 MB body of whitespace does not throw', () => {
    const big = Buffer.alloc(5 * 1024 * 1024, 0x20);
    expect(kiwifyGateway.normalise(big)).toEqual(OTHER);
  });

  it('a deeply nested body does not throw', () => {
    const deep = `${'['.repeat(50_000)}${']'.repeat(50_000)}`;
    expect(() => kiwifyGateway.normalise(Buffer.from(deep, 'utf8'))).not.toThrow();
  });

  it('an empty webhook_event_type is other / none', () => {
    expect(
      kiwifyGateway.normalise(
        mutated('trigger-compra_aprovada', (b) => {
          b.webhook_event_type = '';
        }),
      ),
    ).toEqual(OTHER);
  });

  it('a body without Product, with a null Customer or without Commissions keeps the mapped type with null fields', () => {
    const noProduct = kiwifyGateway.normalise(
      mutated('trigger-compra_aprovada', (b) => {
        delete b.Product;
      }),
    );
    expect(noProduct).toMatchObject({ type: 'purchase_approved', externalProductId: null });
    const noCustomer = kiwifyGateway.normalise(
      mutated('trigger-compra_aprovada', (b) => {
        dropSubscription(b);
        b.Customer = null;
      }),
    );
    expect(noCustomer).toMatchObject({
      type: 'purchase_approved',
      email: null,
      externalRef: ORDER,
    });
    const noCommissions = kiwifyGateway.normalise(
      mutated('trigger-compra_aprovada', (b) => {
        delete b.Commissions;
      }),
    );
    expect(noCommissions).toMatchObject({
      type: 'purchase_approved',
      amountCents: null,
      currency: null,
    });
  });

  it('wrong-typed objects and fields read as absent', () => {
    const event = kiwifyGateway.normalise(
      mutated('trigger-subscription_renewed', (b) => {
        b.Product = 'nope';
        b.Customer = [];
        b.Commissions = 5;
        b.Subscription = 'nope';
        b.subscription_id = 12;
        b.order_id = { not: 'a string' };
      }),
    );
    expect(event).toEqual({ ...OTHER, type: 'subscription_renewed', effect: 'grant' });
  });

  it('a NUL byte or an over-long text field reads as absent, never as a value Postgres would refuse', () => {
    const event = kiwifyGateway.normalise(
      mutated('trigger-compra_aprovada', (b) => {
        dropSubscription(b);
        (b.Customer as Record<string, unknown>).email = 'a\u0000b@example.com';
        (b.Product as Record<string, unknown>).product_id = 'p'.repeat(129);
        b.order_id = 'o'.repeat(129);
      }),
    );
    expect(event).toMatchObject({
      type: 'purchase_approved',
      email: null,
      externalProductId: null,
      externalRef: null,
      orderRef: null,
    });
  });

  it('a lower-case currency is upper-cased and a blank one is absent', () => {
    const currencyOf = (value: unknown) =>
      kiwifyGateway.normalise(
        mutated('trigger-compra_aprovada', (b) => {
          (b.Commissions as Record<string, unknown>).currency = value;
        }),
      ).currency;
    expect(currencyOf('usd')).toBe('USD');
    expect(currencyOf('  brl ')).toBe('BRL');
    expect(currencyOf('   ')).toBeNull();
    expect(currencyOf(986)).toBeNull();
  });

  it('reads access_until as Brazil local time and refuses anything it cannot place', () => {
    const untilOf = (value: unknown) =>
      kiwifyGateway.normalise(
        mutated('trigger-subscription_renewed', (b) => {
          (
            (b.Subscription as Record<string, unknown>).customer_access as Record<string, unknown>
          ).access_until = value;
        }),
      ).validUntil;
    expect(untilOf('2026-11-20 14:32')).toEqual(new Date('2026-11-20T17:32:00.000Z'));
    expect(untilOf('2026-11-20 14:32:45')).toEqual(new Date('2026-11-20T17:32:45.000Z'));
    expect(untilOf('2026-12-31 23:30')).toEqual(new Date('2027-01-01T02:30:00.000Z'));
    for (const bad of [
      '',
      'tomorrow',
      '2026-02-31 10:00',
      '2026-11-20 24:00',
      '2026-13-01 10:00',
      '20/11/2026 14:32',
      20261120,
      null,
    ]) {
      expect(untilOf(bad)).toBeNull();
    }
  });

  it('reads an access_until that carries its own zone as given (the vendor Subscription dates are ISO-8601 UTC)', () => {
    const untilOf = (value: unknown) =>
      kiwifyGateway.normalise(
        mutated('trigger-subscription_renewed', (b) => {
          (
            (b.Subscription as Record<string, unknown>).customer_access as Record<string, unknown>
          ).access_until = value;
        }),
      ).validUntil;
    expect(untilOf('2026-11-20T17:32:00.000Z')).toEqual(new Date('2026-11-20T17:32:00.000Z'));
    expect(untilOf('2026-11-20T17:32Z')).toEqual(new Date('2026-11-20T17:32:00.000Z'));
    expect(untilOf('2026-11-20T14:32:00-03:00')).toEqual(new Date('2026-11-20T17:32:00.000Z'));
    expect(untilOf('2026-11-20T14:32:00.250-03:00')).toEqual(new Date('2026-11-20T17:32:00.250Z'));
    // no zone and fractional seconds: not placeable, so absent (never guessed)
    expect(untilOf('2026-11-20T14:32:00.250')).toBeNull();
    for (const bad of [
      '2026-11-20T25:00:00Z',
      '2026-02-31T10:00:00Z',
      '2026-11-20T10:00:00+25:00',
    ]) {
      expect(untilOf(bad)).toBeNull();
    }
  });

  it('a body with a byte order mark is read, and a non-UTF-8 body is other', () => {
    const bom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      fixture('trigger-compra_aprovada'),
    ]);
    expect(kiwifyGateway.normalise(bom).type).toBe('purchase_approved');
    const bad = Buffer.concat([fixture('trigger-compra_aprovada'), Buffer.from([0xff])]);
    expect(kiwifyGateway.normalise(bad)).toEqual(OTHER);
  });
});

describe('P77 PAY-33 ordering: normalise is a pure function of the bytes', () => {
  it('maps every fixture the same whatever the order they arrive in, and the same on a repeat', () => {
    const forward = TABLE.map((row) => kiwifyGateway.normalise(fixture(row.name)));
    const backward = [...TABLE]
      .reverse()
      .map((row) => kiwifyGateway.normalise(fixture(row.name)))
      .reverse();
    const shuffled = TABLE.map((_, index) => TABLE[(index * 5) % TABLE.length]).map((row) =>
      row ? kiwifyGateway.normalise(fixture(row.name)) : null,
    );
    expect(backward).toEqual(forward);
    expect(forward.map((event) => event.type)).toEqual(TABLE.map((row) => row.type));
    expect(shuffled.map((event) => event?.type)).toEqual(
      TABLE.map((_, index) => TABLE[(index * 5) % TABLE.length]?.type),
    );
    expect(TABLE.map((row) => kiwifyGateway.normalise(fixture(row.name)))).toEqual(forward);
  });

  it('never consults the clock: a frozen and a moved clock give the same event', () => {
    const before = kiwifyGateway.normalise(fixture('trigger-subscription_renewed'));
    const realNow = Date.now;
    Date.now = () => realNow() + 10 * 365 * 24 * 60 * 60 * 1000;
    try {
      expect(kiwifyGateway.normalise(fixture('trigger-subscription_renewed'))).toEqual(before);
    } finally {
      Date.now = realNow;
    }
  });
});
