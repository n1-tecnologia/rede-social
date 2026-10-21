import { createHmac } from 'node:crypto';
import { PAYMENT_EVENT_TYPES } from '@rede-social/contracts/payments';
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from '../server/payments/adapters';
import { EFFECT_BY_TYPE, fakeGateway } from '../server/payments/fake';
import { enabledProviders, gatewayAdapter } from '../server/payments/index';
import { GatewayError } from '../server/payments/types';

/**
 * The provider-neutral seam and its `fake` adapter (09.1-05, D-486). Pure functions of the received
 * BYTES, the `signature` query value and the opened secret: no database, no network.
 */

const SECRET = 'webhook-token-for-tests';
const sign = (body: Buffer | string, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex');
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');

describe('fakeGateway.verify', () => {
  const body = bytes({ type: 'purchase_approved', email: 'a@b.c' });

  it('accepts a body signed with HMAC-SHA256 hex of its exact bytes and names the variant', () => {
    const verified = fakeGateway.verify({ rawBody: body, signature: sign(body), secret: SECRET });
    expect(verified.variant).toBe('hmac-sha256');
    // CR-01: the signed material is the received bytes, the material the replay memory keys on.
    expect(verified.signed.equals(body)).toBe(true);
  });

  it('accepts the HMAC of zero bytes for an empty body', () => {
    const empty = Buffer.alloc(0);
    expect(() =>
      fakeGateway.verify({ rawBody: empty, signature: sign(empty), secret: SECRET }),
    ).not.toThrow();
  });

  const cases: [
    string,
    () => { rawBody: Buffer; signature: string | undefined; secret: string },
  ][] = [
    ['a missing signature', () => ({ rawBody: body, signature: undefined, secret: SECRET })],
    ['an empty signature', () => ({ rawBody: body, signature: '', secret: SECRET })],
    [
      'a wrong secret',
      () => ({ rawBody: body, signature: sign(body, 'other-token'), secret: SECRET }),
    ],
    [
      'a one-byte change',
      () => {
        const changed = Buffer.from(body);
        changed[0] = (changed[0] ?? 0) ^ 0x01;
        return { rawBody: changed, signature: sign(body), secret: SECRET };
      },
    ],
    [
      'a different-length signature (length is checked before timingSafeEqual)',
      () => ({ rawBody: body, signature: sign(body).slice(0, 40), secret: SECRET }),
    ],
    ['a longer signature', () => ({ rawBody: body, signature: `${sign(body)}00`, secret: SECRET })],
    [
      'a non-hex signature of the right length',
      () => ({
        rawBody: body,
        signature: 'z'.repeat(64),
        secret: SECRET,
      }),
    ],
  ];

  for (const [name, input] of cases) {
    it(`throws GatewayError('invalid_signature') for ${name}`, () => {
      try {
        fakeGateway.verify(input());
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(GatewayError);
        expect((error as GatewayError).kind).toBe('invalid_signature');
      }
    });
  }

  it('verifies the received BYTES: invalid UTF-8 and a BOM are signed as they arrived', () => {
    const invalid = Buffer.from([0x7b, 0xff, 0xfe, 0x7d]);
    expect(() =>
      fakeGateway.verify({ rawBody: invalid, signature: sign(invalid), secret: SECRET }),
    ).not.toThrow();
    // The signature over the decoded-and-re-encoded string is NOT the signature over the bytes.
    const reencoded = Buffer.from(invalid.toString('utf8'), 'utf8');
    expect(() =>
      fakeGateway.verify({ rawBody: invalid, signature: sign(reencoded), secret: SECRET }),
    ).toThrow(GatewayError);

    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
    expect(() =>
      fakeGateway.verify({ rawBody: bom, signature: sign(bom), secret: SECRET }),
    ).not.toThrow();
    expect(() =>
      fakeGateway.verify({ rawBody: bom, signature: sign(body), secret: SECRET }),
    ).toThrow(GatewayError);
  });
});

describe('GatewayError', () => {
  it('takes a kind and a status only, so no provider body can reach a log', () => {
    expect(GatewayError.length).toBeLessThanOrEqual(2);
    const error = new GatewayError('invalid_signature', 403);
    expect(error.message).toBe('payment gateway: invalid_signature (403)');
    expect(new GatewayError('unreadable').message).toBe('payment gateway: unreadable');
  });
});

describe('fakeGateway.normalise', () => {
  const normalise = (value: unknown) => fakeGateway.normalise(bytes(value));

  const EFFECTS: [string, string][] = [
    ['purchase_approved', 'grant'],
    ['subscription_renewed', 'grant'],
    ['subscription_late', 'suspend'],
    ['subscription_canceled', 'suspend'],
    ['purchase_refunded', 'revoke'],
    ['chargeback', 'revoke'],
    ['purchase_refused', 'none'],
    ['boleto_generated', 'none'],
    ['pix_generated', 'none'],
    ['cart_abandoned', 'none'],
    ['other', 'none'],
  ];
  for (const [type, effect] of EFFECTS) {
    it(`maps ${type} to the effect ${effect}`, () => {
      expect(normalise({ type }).effect).toBe(effect);
      expect(normalise({ type }).type).toBe(type);
    });
  }

  it('the effect table covers every neutral type exactly', () => {
    expect(Object.keys(EFFECT_BY_TYPE).sort()).toEqual([...PAYMENT_EVENT_TYPES].sort());
  });

  it('maps the neutral fields, lower-casing and trimming the e-mail', () => {
    const event = normalise({
      type: 'purchase_approved',
      externalRef: 'sub-1',
      orderRef: 'ord-9',
      productId: 'prod-77',
      email: '  Buyer@Example.COM ',
      amountCents: 4990,
      currency: 'BRL',
      validUntil: '2026-12-31T00:00:00.000Z',
      recurring: true,
    });
    expect(event).toMatchObject({
      type: 'purchase_approved',
      effect: 'grant',
      externalRef: 'sub-1',
      orderRef: 'ord-9',
      externalProductId: 'prod-77',
      email: 'buyer@example.com',
      amountCents: 4990,
      currency: 'BRL',
      recurring: true,
      occurredAt: null,
    });
    expect(event.validUntil?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('fills the absent fields with null and recurring with false', () => {
    expect(normalise({ type: 'purchase_approved' })).toEqual({
      type: 'purchase_approved',
      effect: 'grant',
      externalRef: null,
      orderRef: null,
      externalProductId: null,
      email: null,
      amountCents: null,
      currency: null,
      validUntil: null,
      occurredAt: null,
      recurring: false,
    });
  });

  const degraded: [string, Buffer][] = [
    ['an empty body', Buffer.alloc(0)],
    ['non-JSON', Buffer.from('not json at all')],
    ['a JSON array', Buffer.from('[1,2,3]')],
    ['invalid UTF-8', Buffer.from([0x7b, 0xff, 0xfe, 0x7d])],
    ['an unknown type', bytes({ type: 'something_new' })],
    ['a missing type', bytes({ email: 'a@b.c' })],
    ['a negative amount', bytes({ type: 'purchase_approved', amountCents: -1 })],
    ['a fractional amount', bytes({ type: 'purchase_approved', amountCents: 1.5 })],
    ['a NUL in a text field', bytes({ type: 'purchase_approved', email: 'a\u0000@b.c' })],
    ['an over-long product id', bytes({ type: 'purchase_approved', productId: 'x'.repeat(129) })],
    ['a bad date', bytes({ type: 'purchase_approved', validUntil: 'next tuesday' })],
  ];
  for (const [name, body] of degraded) {
    it(`degrades ${name} to type other, effect none, and never throws`, () => {
      const event = fakeGateway.normalise(body);
      expect(event.type).toBe('other');
      expect(event.effect).toBe('none');
      expect(event.email).toBeNull();
    });
  }

  it('reads a body that starts with a BOM as the JSON it carries', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes({ type: 'chargeback' })]);
    expect(fakeGateway.normalise(bom).type).toBe('chargeback');
  });

  it('holds no state between calls: the same bytes give the same event', () => {
    const body = bytes({ type: 'subscription_late', email: 'X@y.z' });
    expect(fakeGateway.normalise(body)).toEqual(fakeGateway.normalise(body));
  });
});

describe('the adapter list (P3: whole-name matching)', () => {
  it('registers fake and nothing else here', () => {
    expect(Object.keys(ADAPTERS)).toEqual(['fake', 'kiwify']);
    expect(ADAPTERS.fake).toBe(fakeGateway);
    expect(fakeGateway.name).toBe('fake');
    expect(fakeGateway.displayName.length).toBeGreaterThan(0);
  });

  it('resolves an adapter by the whole name only', () => {
    expect(gatewayAdapter('fake')).toBe(fakeGateway);
    expect(gatewayAdapter('fake2')).toBeNull();
    expect(gatewayAdapter('fak')).toBeNull();
    expect(gatewayAdapter('FAKE')).toBeNull();
    expect(gatewayAdapter('')).toBeNull();
    expect(gatewayAdapter('constructor')).toBeNull();
    expect(gatewayAdapter('__proto__')).toBeNull();
    expect(gatewayAdapter('toString')).toBeNull();
  });

  it('honours the PAYMENTS_PROVIDERS list: unset = every adapter, a list = only the listed ones', () => {
    expect(enabledProviders(undefined)).toEqual(['fake', 'kiwify']);
    expect(enabledProviders('fake')).toEqual(['fake']);
    expect(enabledProviders(' fake , acme ')).toEqual(['fake']);
    expect(enabledProviders('acme')).toEqual([]);
    expect(gatewayAdapter('fake', 'acme')).toBeNull();
    expect(gatewayAdapter('fake', 'acme,fake')).toBe(fakeGateway);
  });
});
