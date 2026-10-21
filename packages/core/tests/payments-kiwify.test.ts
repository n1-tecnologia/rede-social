import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from '../server/payments/adapters';
import { CANCEL_EFFECT, kiwifyGateway, signatureCandidates } from '../server/payments/kiwify';
import { GatewayError } from '../server/payments/types';

/**
 * The first real gateway behind the seam (09.1-08, D-486, PAY-02, PAY-03, PAY-33). Pure functions of the
 * received bytes: no database, no network, no clock. The fixtures are built from the vendor's public
 * documentation with synthetic data (each carries a `_fixture` provenance key); plan 20 replaces them
 * with redacted real captures, and the assertions below are the contract that replacement must keep.
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
    expect(kiwifyGateway.verify({ rawBody: raw, signature: sha1(raw), secret: SECRET })).toBe(
      'raw',
    );
  });

  it('accepts HMAC-SHA1 hex of the re-serialised JSON and names the variant reserialised (A-P17)', () => {
    expect(
      kiwifyGateway.verify({
        rawBody: raw,
        signature: sha1(reserialised(raw)),
        secret: SECRET,
      }),
    ).toBe('reserialised');
  });

  it('names a compact body raw even though both candidates are identical', () => {
    const compact = reserialised(raw);
    expect(
      kiwifyGateway.verify({ rawBody: compact, signature: sha1(compact), secret: SECRET }),
    ).toBe('raw');
  });

  it('accepts upper-case hex of an otherwise valid signature (the hex compare is case-insensitive)', () => {
    expect(
      kiwifyGateway.verify({ rawBody: raw, signature: sha1(raw).toUpperCase(), secret: SECRET }),
    ).toBe('raw');
  });

  it('verifies a body that is not JSON over its raw bytes alone', () => {
    const text = Buffer.from('not json at all', 'utf8');
    expect(kiwifyGateway.verify({ rawBody: text, signature: sha1(text), secret: SECRET })).toBe(
      'raw',
    );
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
  it('maps an approved purchase to purchase_approved / grant with the amount in integer cents', () => {
    const event = kiwifyGateway.normalise(fixture('trigger-compra_aprovada'));
    expect(event).toEqual({
      type: 'purchase_approved',
      effect: 'grant',
      externalRef: '6f1d5c0e-0000-4000-8000-00000000a001',
      orderRef: '6f1d5c0e-0000-4000-8000-00000000a001',
      externalProductId: 'b7a3c9d2-0000-4000-8000-00000000b001',
      email: 'comprador.teste@example.com',
      amountCents: 9990,
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
      externalRef: '5c2e8b41-0000-4000-8000-00000000c001',
      recurring: true,
    });
    const canceled = kiwifyGateway.normalise(fixture('trigger-subscription_canceled'));
    expect(canceled).toMatchObject({
      type: 'subscription_canceled',
      effect: CANCEL_EFFECT,
      externalRef: '5c2e8b41-0000-4000-8000-00000000c001',
      recurring: true,
    });
  });

  it('keeps D-496 literal in the cancel constant: a cancel cuts access', () => {
    expect(CANCEL_EFFECT).toBe('suspend');
  });

  it('maps a refund and a chargeback to revoke, as two different neutral types', () => {
    const refunded = kiwifyGateway.normalise(fixture('trigger-compra_reembolsada'));
    const chargeback = kiwifyGateway.normalise(fixture('trigger-chargeback'));
    expect(refunded).toMatchObject({ type: 'purchase_refunded', effect: 'revoke' });
    expect(chargeback).toMatchObject({ type: 'chargeback', effect: 'revoke' });
    expect(refunded.externalRef).toBe(chargeback.externalRef);
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
    for (const personal of [
      'Sintetico',
      'Comprador Sintetico',
      '000.000.000-00',
      '+5511900000000',
      '203.0.113.7',
      'Rua Sintetica',
      '01000-000',
    ]) {
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

const SUBSCRIPTION = '5c2e8b41-0000-4000-8000-00000000c001';
const ORDER = '6f1d5c0e-0000-4000-8000-00000000a001';

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
    externalRef: ORDER,
    recurring: false,
    amountCents: 9990,
    currency: 'BRL',
    email: 'comprador.teste@example.com',
  },
  {
    name: 'trigger-compra_reembolsada',
    type: 'purchase_refunded',
    effect: 'revoke',
    externalRef: ORDER,
    recurring: false,
    amountCents: 9990,
    currency: 'BRL',
    email: 'comprador.teste@example.com',
  },
  {
    name: 'trigger-chargeback',
    type: 'chargeback',
    effect: 'revoke',
    externalRef: ORDER,
    recurring: false,
    amountCents: 9990,
    currency: 'BRL',
    email: 'comprador.teste@example.com',
  },
  {
    name: 'trigger-subscription_renewed',
    type: 'subscription_renewed',
    effect: 'grant',
    externalRef: SUBSCRIPTION,
    recurring: true,
    amountCents: 4990,
    currency: 'BRL',
    email: 'assinante.teste@example.com',
  },
  {
    name: 'trigger-subscription_late',
    type: 'subscription_late',
    effect: 'suspend',
    externalRef: SUBSCRIPTION,
    recurring: true,
    amountCents: 4990,
    currency: 'BRL',
    email: 'assinante.teste@example.com',
  },
  {
    name: 'trigger-subscription_canceled',
    type: 'subscription_canceled',
    effect: 'suspend',
    externalRef: SUBSCRIPTION,
    recurring: true,
    amountCents: 4990,
    currency: 'BRL',
    email: 'assinante.teste@example.com',
  },
  {
    name: 'trigger-compra_recusada',
    type: 'purchase_refused',
    effect: 'none',
    externalRef: '6f1d5c0e-0000-4000-8000-00000000a010',
    recurring: false,
    amountCents: 2990,
    currency: 'BRL',
    email: 'recusado.teste@example.com',
  },
  {
    name: 'trigger-boleto_gerado',
    type: 'boleto_generated',
    effect: 'none',
    externalRef: '6f1d5c0e-0000-4000-8000-00000000a011',
    recurring: false,
    amountCents: 2990,
    currency: 'BRL',
    email: 'boleto.teste@example.com',
  },
  {
    name: 'trigger-pix_gerado',
    type: 'pix_generated',
    effect: 'none',
    externalRef: '6f1d5c0e-0000-4000-8000-00000000a012',
    recurring: false,
    amountCents: 2990,
    currency: 'BRL',
    email: 'pix.teste@example.com',
  },
  {
    name: 'trigger-carrinho_abandonado',
    type: 'cart_abandoned',
    effect: 'none',
    externalRef: null,
    recurring: false,
    amountCents: null,
    currency: null,
    email: 'carrinho.teste@example.com',
  },
  {
    name: 'payload-scheduled_installment_access_removed',
    type: 'subscription_late',
    effect: 'suspend',
    externalRef: '6f1d5c0e-0000-4000-8000-00000000a020',
    recurring: false,
    amountCents: 14900,
    currency: 'BRL',
    email: 'parcelado.teste@example.com',
  },
  {
    name: 'payload-scheduled_installment_access_restored',
    type: 'subscription_renewed',
    effect: 'grant',
    externalRef: '6f1d5c0e-0000-4000-8000-00000000a020',
    recurring: false,
    amountCents: 14900,
    currency: 'BRL',
    email: 'parcelado.teste@example.com',
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
      expect(String(body._fixture)).toContain('synthetic data');
      expect(fixture(row.name).toString('utf8')).not.toMatch(
        /@(?!example\.com)[a-z0-9.-]+\.[a-z]+/i,
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
    expect(kiwifyGateway.normalise(fixture('trigger-compra_aprovada'))).toMatchObject({
      recurring: false,
      externalRef: ORDER,
      orderRef: ORDER,
    });
    const viaId = kiwifyGateway.normalise(
      mutated('trigger-compra_aprovada', (body) => {
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
    const refund = kiwifyGateway.normalise(fixture('trigger-compra_reembolsada'));
    const chargeback = kiwifyGateway.normalise(fixture('trigger-chargeback'));
    expect(refund.type).not.toBe(chargeback.type);
    expect({ ...refund, type: 'x' }).toEqual({ ...chargeback, type: 'x' });
    expect(refund.effect).toBe('revoke');
    expect(chargeback.effect).toBe('revoke');
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
