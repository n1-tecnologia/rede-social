import { createHmac, timingSafeEqual } from 'node:crypto';
import { PAYMENT_EVENT_TYPES } from '@rede-social/contracts/payments';
import { z } from 'zod';
import {
  EFFECT_BY_TYPE,
  GatewayError,
  type GatewayProvider,
  type NeutralPaymentEvent,
} from './types';

/**
 * The `fake` gateway (09.1-05, D-486): what every non-production environment and CI runs, so the real
 * route, the real inbox and the real apply job are exercised with no gateway account. It is a real
 * authentication, not a no-op, and has the SHAPE of a real adapter on purpose:
 *
 *  - the signature rides the URL as `?signature=`, like every gateway that cannot set a header;
 *  - it is HMAC-SHA256 hex over the EXACT received bytes (never a decoded and re-encoded string, so a
 *    body with invalid UTF-8 or a BOM verifies exactly when the sender signed those bytes, P5);
 *  - the compare is constant-time, with the length checked first (`timingSafeEqual` throws on unequal
 *    lengths, and a throw there would be a 500, not a 403).
 *
 * `normalise` reads a JSON body of the neutral fields directly. The effect of an event never comes
 * from the body: it is looked up from the type in the shared `EFFECT_BY_TYPE` table, the same table the
 * real adapter uses, so two gateways can never disagree on what a late subscription does. Any body it
 * cannot read degrades to type `other`, effect `none` instead of throwing.
 */

export { EFFECT_BY_TYPE };

/** Lower hex of a SHA-256 HMAC: 64 characters. */
const SIGNATURE_HEX = /^[0-9a-f]{64}$/;

/** A text field: bounded, and free of NUL, which Postgres text refuses (a NUL would 500 the insert). */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !value.includes('\u0000'));

/** A reference or product id: trimmed, 1 to 128 characters (the `payment_products.external_product_id` rule). */
const reference = z
  .string()
  .transform((value) => value.trim())
  .pipe(text(128))
  .transform((value) => (value === '' ? null : value));

const wire = z.object({
  type: z.enum(PAYMENT_EVENT_TYPES),
  externalRef: reference.nullish(),
  orderRef: reference.nullish(),
  productId: reference.nullish(),
  email: text(320).nullish(),
  amountCents: z.number().int().min(0).max(2_147_483_647).nullish(),
  currency: text(8).nullish(),
  validUntil: z.iso.datetime({ offset: true }).nullish(),
  recurring: z.boolean().nullish(),
});

const OTHER: NeutralPaymentEvent = {
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

/** Fatal decoding: invalid UTF-8 is an unreadable body, not a body with replacement characters. */
const decoder = new TextDecoder('utf-8', { fatal: true });

function normalise(rawBody: Buffer): NeutralPaymentEvent {
  try {
    const parsed = wire.safeParse(JSON.parse(decoder.decode(rawBody)));
    if (!parsed.success) return { ...OTHER };
    const body = parsed.data;
    const email = body.email?.trim().toLowerCase() || null;
    return {
      type: body.type,
      effect: EFFECT_BY_TYPE[body.type],
      externalRef: body.externalRef ?? null,
      orderRef: body.orderRef ?? null,
      externalProductId: body.productId ?? null,
      email,
      amountCents: body.amountCents ?? null,
      currency: body.currency?.trim().toUpperCase() || null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      occurredAt: null,
      recurring: body.recurring ?? false,
    };
  } catch {
    return { ...OTHER };
  }
}

export const fakeGateway: GatewayProvider = {
  name: 'fake',
  displayName: 'Gateway de teste',

  verify({ rawBody, signature, secret }) {
    if (!signature) throw new GatewayError('invalid_signature', 403);
    const given = signature.toLowerCase();
    if (!SIGNATURE_HEX.test(given)) throw new GatewayError('invalid_signature', 403);
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const received = Buffer.from(given, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new GatewayError('invalid_signature', 403);
    }
    return { variant: 'hmac-sha256', signed: rawBody };
  },

  normalise,
};
