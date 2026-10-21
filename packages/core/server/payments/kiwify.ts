import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentEventEffect, PaymentEventType } from '@rede-social/contracts/payments';
import { z } from 'zod';
import {
  EFFECT_BY_TYPE,
  GatewayError,
  type GatewayProvider,
  type NeutralPaymentEvent,
} from './types';

/**
 * The Kiwify adapter (09.1-08, D-486, PAY-02, PAY-03, PAY-33): the first real gateway behind the
 * provider-neutral seam, and together with `adapters.ts` the ONLY file that names a gateway or knows a
 * gateway field path (`packages/core/tests/payments-neutral.test.ts` exempts exactly these two). It is
 * a thin adapter: two pure functions over bytes, no outbound call, no SDK (D-486), no state, no clock.
 *
 * Built from the vendor's PUBLIC documentation and synthetic fixtures; no real delivery has been
 * observed yet. Plan 20 captures real ones and edits this file and its fixtures only.
 *
 * `verify` is the only authentication of the delivery. The vendor's page signs a different material in
 * its two examples, so BOTH candidates are tried (the raw bytes, and `JSON.stringify(JSON.parse(raw))`),
 * each compared in constant time after a length check. A forger needs the tenant's token for either, so
 * accepting both widens nothing. The label of the variant that matched goes to the log so the real
 * capture shows which one the vendor uses.
 *
 * `normalise` never throws. It reads a CLOSED set of fields through a tolerant schema (unknown keys are
 * dropped, a wrong type degrades a field to null) and builds the neutral event field by field, so buyer
 * data other than the e-mail (name, CPF, phone, address, IP) cannot reach the result (PR-9, T-09.1-38).
 * Which TYPE an event is comes from the vendor's `webhook_event_type`; what the type DOES to access comes
 * from the shared `EFFECT_BY_TYPE` table, with one exception: the cancel semantics below.
 */

/** Which of the two documented signed materials matched, for the log. */
export type SignatureVariant = 'raw' | 'reserialised';

/**
 * What a canceled subscription does to access. D-496 is literal: a cancel cuts access immediately. The
 * capture of plan 20 may show that a mid-period cancel keeps `Subscription.customer_access.has_access`
 * true until `access_until`; if the product owner then wants access kept until that date, this becomes
 * "derive the effect from `has_access`" and ONLY this constant and the line that uses it change
 * (assumption A-P2, `fixtures/payments/kiwify/CAPTURE.md`).
 */
export const CANCEL_EFFECT = 'suspend' as const satisfies PaymentEventEffect;

/** The vendor's timestamps carry no timezone; they are read as Brazil local time, UTC-3 (A-P28, display-only). */
const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Lower hex of a SHA-1 HMAC: 40 characters. */
const SIGNATURE_HEX = /^[0-9a-f]{40}$/;

/** The signed-material candidates of one delivery: the received bytes, then the re-serialised JSON. */
export function signatureCandidates(raw: Buffer): { variant: SignatureVariant; bytes: Buffer }[] {
  const candidates: { variant: SignatureVariant; bytes: Buffer }[] = [
    { variant: 'raw', bytes: raw },
  ];
  try {
    const again = JSON.stringify(JSON.parse(raw.toString('utf8')));
    candidates.push({ variant: 'reserialised', bytes: Buffer.from(again, 'utf8') });
  } catch {
    // Not JSON: only the raw bytes can have been signed.
  }
  return candidates;
}

/** A text field: trimmed, bounded and free of NUL (Postgres text refuses it); empty reads as absent. */
const text = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(max))
    .refine((value) => !value.includes('\u0000'))
    .transform((value) => (value === '' ? null : value));

/** Tolerant: absent, null or the wrong type all read as "not there". */
const optionalText = (max: number) => text(max).nullish().catch(null);

/** Integer cents only, never a rounded number: a float, a string or a negative reads as absent. */
const cents = z.number().int().min(0).max(2_147_483_647).nullish().catch(null);

const payload = z.object({
  webhook_event_type: optionalText(64),
  // Kept raw: "present and not paid" must be told apart from "absent". `.optional()` because Zod 4
  // refuses an object whose `unknown` key is missing, which would turn a body without the key into `other`.
  order_status: z.unknown().optional(),
  order_id: optionalText(128),
  subscription_id: optionalText(128),
  Product: z
    .object({ product_id: optionalText(128) })
    .nullish()
    .catch(null),
  Customer: z
    .object({ email: optionalText(320) })
    .nullish()
    .catch(null),
  Commissions: z
    .object({ charge_amount: cents, currency: optionalText(8) })
    .nullish()
    .catch(null),
  Subscription: z
    .object({
      id: optionalText(128),
      customer_access: z
        .object({ access_until: optionalText(40) })
        .nullish()
        .catch(null),
    })
    .nullish()
    .catch(null),
  // The abandoned cart is a different, FLAT json: no `webhook_event_type`, no `order_id`.
  status: optionalText(32),
  email: optionalText(320),
  product_id: optionalText(128),
});
type Payload = z.infer<typeof payload>;

/**
 * The vendor's `webhook_event_type` to our neutral type. Exact names, looked up in a Map (no prototype
 * keys). The two instalment events that move access ride the late/renewed types; the event NAME decides,
 * even when the installment's own `customer_access.has_access` disagrees with it (a late or re-sent
 * delivery can carry the access of now, but an unknown disagreement must not invent a state change).
 * Every other `scheduled_installment_*` name is absent here on purpose and so reads as `other`.
 */
const TYPE_BY_EVENT: ReadonlyMap<string, PaymentEventType> = new Map([
  ['order_approved', 'purchase_approved'],
  ['subscription_renewed', 'subscription_renewed'],
  ['subscription_late', 'subscription_late'],
  ['subscription_canceled', 'subscription_canceled'],
  ['order_refunded', 'purchase_refunded'],
  ['chargeback', 'chargeback'],
  ['order_rejected', 'purchase_refused'],
  ['billet_created', 'boleto_generated'],
  ['pix_created', 'pix_generated'],
  ['scheduled_installment_access_removed', 'subscription_late'],
  ['scheduled_installment_access_restored', 'subscription_renewed'],
]);

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

/** Kiwify: release access only when `order_status` is `paid`. Absent is accepted; present and anything else is not. */
function isPaid(status: unknown): boolean {
  if (status === undefined || status === null) return true;
  return typeof status === 'string' && status.trim().toLowerCase() === 'paid';
}

function classify(body: Payload): PaymentEventType {
  const name = body.webhook_event_type;
  if (name == null) {
    // No event name: only the flat abandoned-cart shape is understood.
    const abandoned = body.status?.toLowerCase() === 'abandoned' && body.order_id == null;
    return abandoned ? 'cart_abandoned' : 'other';
  }
  const type = TYPE_BY_EVENT.get(name);
  if (type === undefined) return 'other';
  if (type === 'purchase_approved' && !isPaid(body.order_status)) return 'other';
  return type;
}

/** "YYYY-MM-DD HH:mm" (seconds optional) read as Brazil local time; anything else, or an impossible date, is null. */
function brazilLocalTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const seconds = secondText === undefined ? 0 : Number(secondText);
  const utc = Date.UTC(year, month - 1, day, hour, minute, seconds);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== seconds
  ) {
    return null;
  }
  return new Date(utc + BRAZIL_OFFSET_MS);
}

/** The neutral event of a recognised order or subscription delivery. */
export function toNeutral(body: Payload, type: PaymentEventType): NeutralPaymentEvent {
  if (type === 'cart_abandoned') {
    // The flat shape: a buyer address and a product, no order and no amount.
    return {
      ...OTHER,
      type,
      effect: EFFECT_BY_TYPE[type],
      externalProductId: body.product_id ?? null,
      email: body.email?.toLowerCase() ?? null,
    };
  }
  const orderId = body.order_id ?? null;
  const subscriptionId = body.Subscription?.id ?? body.subscription_id ?? null;
  const recurring = body.Subscription != null || body.subscription_id != null;
  return {
    type,
    effect: type === 'subscription_canceled' ? CANCEL_EFFECT : EFFECT_BY_TYPE[type],
    externalRef: recurring ? (subscriptionId ?? orderId) : orderId,
    orderRef: orderId,
    externalProductId: body.Product?.product_id ?? null,
    email: body.Customer?.email?.toLowerCase() ?? null,
    amountCents: body.Commissions?.charge_amount ?? null,
    currency: body.Commissions?.currency?.toUpperCase() ?? null,
    validUntil: brazilLocalTime(body.Subscription?.customer_access?.access_until),
    occurredAt: null,
    recurring,
  };
}

function normalise(rawBody: Buffer): NeutralPaymentEvent {
  try {
    const parsed = payload.safeParse(JSON.parse(decoder.decode(rawBody)));
    if (!parsed.success) return { ...OTHER };
    const type = classify(parsed.data);
    return type === 'other' ? { ...OTHER } : toNeutral(parsed.data, type);
  } catch {
    return { ...OTHER };
  }
}

export const kiwifyGateway: GatewayProvider = {
  name: 'kiwify',
  displayName: 'Kiwify',

  verify({ rawBody, signature, secret }) {
    if (!signature) throw new GatewayError('invalid_signature', 403);
    const given = signature.toLowerCase();
    if (!SIGNATURE_HEX.test(given)) throw new GatewayError('invalid_signature', 403);
    const received = Buffer.from(given, 'hex');
    let matched: SignatureVariant | null = null;
    for (const { variant, bytes } of signatureCandidates(rawBody)) {
      const expected = createHmac('sha1', secret).update(bytes).digest();
      const equal = received.length === expected.length && timingSafeEqual(received, expected);
      if (equal && matched === null) matched = variant;
    }
    if (matched === null) throw new GatewayError('invalid_signature', 403);
    return matched;
  },

  normalise,
};
