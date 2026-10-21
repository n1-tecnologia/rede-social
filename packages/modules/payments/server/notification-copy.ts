import { cutOnWord } from '@rede-social/contracts/text';

/**
 * The pt-BR push banner body for the payments kind (09.1-12, D-506, UI-D-526), modelled on the
 * courses module's file. Rendered SERVER-SIDE (a push must exist before any page loads, so it cannot
 * come from next-intl) and carried only in the intent's push hint: NEVER stored in a `notifications`
 * row (the row keeps `kind` + facts, and the web renders its own sentence).
 */

/** A banner body is about one line on a lock screen (the feed's and the courses' cap, restated). */
export const PAYMENTS_PUSH_BODY_MAX = 100;

/** The rendered bodies, each cut on a word to `PAYMENTS_PUSH_BODY_MAX` graphemes with `…` only when it cut. */
export const paymentsPushCopy = {
  /** The buyer's confirmation (D-506). Names the product only: never an amount, an order or an e-mail. */
  purchaseConfirmed: (productName: string): string =>
    cutOnWord(`Compra confirmada: ${productName}`, PAYMENTS_PUSH_BODY_MAX),
} as const;
