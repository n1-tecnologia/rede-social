import type { PaymentEventEffect, PaymentEventType } from '@rede-social/contracts/payments';

/**
 * Payment gateway adapter contracts (09.1-05, D-486). This file knows no database, no env and no
 * gateway: it is the seam between the unauthenticated webhook route
 * (`apps/api/src/routes/webhooks/payments.ts`), the kernel receive/inbox services next to it, the apply
 * job of plan 07 and the adapters themselves (`fake` here; the real gateway's adapter is added by plan
 * 08). It is the `VideoProvider` shape, but per INTEGRATION ROW instead of per environment: the
 * `provider` name stored on a tenant's `payment_integrations` row selects the adapter
 * (`adapters.ts` / `index.ts#gatewayAdapter`), so two tenants can sit on two gateways at once.
 *
 * Everything the rest of the codebase consumes is NORMALISED. `NeutralPaymentEvent` is OUR shape, never
 * a gateway payload: the inbox stores its fields, the apply job reads them, and no table, column,
 * queue, contract, route or log field outside an adapter carries a gateway's name (PAY-02, enforced by
 * `packages/core/tests/payments-neutral.test.ts`).
 */

/** The kernel-owned pg-boss queue every recorded delivery is applied through. Registered in `./index.ts`. */
export const PAYMENT_EVENT_QUEUE = 'kernel.payment-event';

/**
 * What an event does to access, per neutral type (D-496, D-505). Shared by every adapter, so two
 * gateways can never disagree on whether a late subscription cuts access: an adapter decides the TYPE,
 * this table decides the EFFECT.
 */
export const EFFECT_BY_TYPE: Readonly<Record<PaymentEventType, PaymentEventEffect>> = {
  purchase_approved: 'grant',
  subscription_renewed: 'grant',
  subscription_late: 'suspend',
  subscription_canceled: 'suspend',
  purchase_refunded: 'revoke',
  chargeback: 'revoke',
  purchase_refused: 'none',
  boleto_generated: 'none',
  pix_generated: 'none',
  cart_abandoned: 'none',
  other: 'none',
};

/**
 * One gateway delivery in OUR vocabulary. Everything is nullable except the type, the effect and
 * `recurring`: a delivery that does not carry a field leaves it null, and the apply job decides what a
 * missing field means for its type.
 *
 * - `externalRef`: the gateway's order or subscription reference, the key an access row and the terminal
 *   (refund, chargeback) check hang off.
 * - `orderRef`: the reference a buyer would quote; a display aid, never a key.
 * - `email`: the buyer's address, already `lower(btrim())`. The ONLY personal datum kept (PR-9).
 * - `amountCents`: integer cents in `currency` (the amount the gateway reports as charged, D-507).
 * - `occurredAt`: the gateway's own timestamp WHEN it is reliable, else null (arrival order then rules).
 * - `validUntil`: the access end the gateway reports, for display only.
 */
export interface NeutralPaymentEvent {
  type: PaymentEventType;
  effect: PaymentEventEffect;
  externalRef: string | null;
  orderRef: string | null;
  externalProductId: string | null;
  email: string | null;
  amountCents: number | null;
  currency: string | null;
  validUntil: Date | null;
  occurredAt: Date | null;
  recurring: boolean;
}

/**
 * One gateway, seen from the webhook route. Nothing else (no outbound call, no SDK): the kernel only
 * ever receives.
 *
 * `verify` is the ONLY authentication of `POST /v1/webhooks/{provider}/{integrationId}`, so it must
 * THROW `GatewayError('invalid_signature')` on a missing, wrong or tampered signature: a return means
 * "this really came from the provider" (and, for a gateway whose docs sign two different materials, it
 * returns a short label of the variant that matched, for the log). It receives the exact received BYTES
 * (never a decoded and re-encoded string, P5), the `signature` query value and the OPENED secret.
 *
 * `normalise` never throws: it degrades an unreadable or unknown shape to type `other`, effect `none`,
 * so a delivery we cannot read is still recorded once and acknowledged instead of retried forever.
 *
 * An adapter holds NO state between calls: both methods are pure functions of their input, so
 * concurrent deliveries for one or many integrations share nothing (P7).
 */
export interface GatewayProvider {
  readonly name: string;
  /** What an admin reads in the UI for this gateway (the `{gateway}` placeholder of the copy). */
  readonly displayName: string;
  verify(input: { rawBody: Buffer; signature: string | undefined; secret: string }): string;
  normalise(rawBody: Buffer): NeutralPaymentEvent;
}

export type GatewayErrorKind = 'invalid_signature' | 'unreadable';

/**
 * The ONLY error shape an adapter raises. The message carries the kind and the HTTP status and nothing
 * else: the constructor deliberately accepts NO message argument, so there is no way to smuggle a
 * gateway body, a header or the token into a log line (the `VideoProviderError` rule, T-02-51).
 */
export class GatewayError extends Error {
  readonly kind: GatewayErrorKind;
  readonly status: number | undefined;

  constructor(kind: GatewayErrorKind, status?: number) {
    super(
      status === undefined ? `payment gateway: ${kind}` : `payment gateway: ${kind} (${status})`,
    );
    this.name = 'GatewayError';
    this.kind = kind;
    this.status = status;
  }
}
