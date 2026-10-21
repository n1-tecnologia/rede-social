import type { PaymentEventOutcome } from '@rede-social/contracts/payments';

/**
 * The order-of-events policy of the payment apply job (09.1-07, PAY-30, RESEARCH Pattern 4). PURE: no
 * database, no clock, no logging. `apply.ts` reads the facts, asks one of these two functions what to do,
 * and only executes the answer. This file and `tests/payments-order-policy.test.ts` are therefore the
 * executable specification of the rule, and the one place to edit when the real capture (plan 20) shows a
 * gateway behaves differently from the assumptions below.
 *
 * THE RULE (gateways send no event id, no usable timestamp and no ordering guarantee, and they retry):
 *
 *  | sale      | effect            | what it does                                                         |
 *  |-----------|-------------------|----------------------------------------------------------------------|
 *  | any       | older `occurredAt`| `stale`: the adapter KNOWS the event is older than the row's last    |
 *  |           |                   | one, so it is ignored. A null `occurredAt` (a gateway whose timestamps   |
 *  |           |                   | carry no timezone, A-P25) never compares: arrival order rules.       |
 *  | ONE-OFF   | refund/chargeback | TERMINAL: the row goes `inactive` with `terminal = true`.            |
 *  | ONE-OFF   | later grant       | `stale` when the row is terminal: a late approval can never undo a   |
 *  |           |                   | refund (T-09.1-33). Store sales read the same fact from an applied   |
 *  |           |                   | refund or chargeback event with the same reference.                  |
 *  | RECURRING | any               | arrival order wins and the payload's own effect IS the state: a      |
 *  |           |                   | cancel, a late payment and a refund all write `inactive` (not        |
 *  |           |                   | terminal), a renewal or an approval writes `active`.                 |
 *  | any       | suspend           | `inactive`, `terminal` left as it was; an `inactive` row is created  |
 *  |           |                   | when the cancel overtakes the approval, never dropped.               |
 *
 * `effect` here is the NEUTRAL effect (`EFFECT_BY_TYPE`), never a gateway word, and `none` never reaches
 * the policy (the apply job settles it as `ignored` first).
 */

/** The effects that change access. `none` is settled before the policy is asked. */
export type AccessEffect = 'grant' | 'suspend' | 'revoke';

/** The stored gateway row, as far as the decision needs it. */
export interface ExistingAccessRow {
  status: 'active' | 'inactive';
  terminal: boolean;
  lastEventAt: Date | null;
}

export type AccessDecision =
  | {
      action: 'write';
      status: 'active' | 'inactive';
      terminal: boolean;
      outcome: Extract<PaymentEventOutcome, 'access_granted' | 'access_cut'>;
    }
  | { action: 'skip'; outcome: Extract<PaymentEventOutcome, 'stale'> };

export type StoreDecision =
  | { action: 'purchase' }
  | { action: 'revoke' }
  | { action: 'skip'; outcome: Extract<PaymentEventOutcome, 'stale'> };

const STALE = { action: 'skip', outcome: 'stale' } as const;

/** What to write to the gateway `access_grants` row of one sale for one event. */
export function decideAccessWrite(input: {
  effect: AccessEffect;
  recurring: boolean;
  existing: ExistingAccessRow | null;
  occurredAt: Date | null;
}): AccessDecision {
  const { effect, recurring, existing, occurredAt } = input;

  // Only when the adapter supplied a time AND the row remembers one; strictly older, so an equal time
  // (the same event re-sent) is re-applied, which is idempotent.
  if (
    occurredAt !== null &&
    existing?.lastEventAt != null &&
    occurredAt.getTime() < existing.lastEventAt.getTime()
  ) {
    return STALE;
  }

  switch (effect) {
    case 'grant':
      // A refund or chargeback of a one-off sale is final; a recurring sale simply returns.
      if (!recurring && existing?.terminal) return STALE;
      return { action: 'write', status: 'active', terminal: false, outcome: 'access_granted' };
    case 'suspend':
      return {
        action: 'write',
        status: 'inactive',
        terminal: existing?.terminal ?? false,
        outcome: 'access_cut',
      };
    case 'revoke':
      return {
        action: 'write',
        status: 'inactive',
        terminal: !recurring,
        outcome: 'access_cut',
      };
  }
}

/**
 * What to do to the store ledgers for one event on a mapped store product. A store sale has no stored
 * row of its own to carry `terminal`, so the caller reads the one-off rule's fact from `payment_events`
 * (`priorTerminalEvent`: an APPLIED refund or chargeback with the same tenant, provider and reference).
 * A recurring sale ignores it: arrival order wins and a renewal after a revoke buys again (A-P11).
 */
export function decideStoreWrite(input: {
  effect: AccessEffect;
  recurring: boolean;
  priorTerminalEvent: boolean;
}): StoreDecision {
  const { effect, recurring, priorTerminalEvent } = input;
  if (effect !== 'grant') return { action: 'revoke' };
  if (!recurring && priorTerminalEvent) return STALE;
  return { action: 'purchase' };
}
