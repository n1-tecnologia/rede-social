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
