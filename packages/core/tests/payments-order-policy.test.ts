import { describe, expect, it } from 'vitest';
import {
  type AccessEffect,
  decideAccessWrite,
  decideStoreWrite,
  type ExistingAccessRow,
} from '../server/payments/policy';

/**
 * 09.1-07 (PAY-30, Pattern 4): the executable specification of the order-of-events rule. The apply job
 * only EXECUTES the decision this pure table makes, so editing the semantics after the real capture
 * (plan 20) means editing `policy.ts` and the rows below, nothing else.
 *
 * The rule: a ONE-OFF sale's refund or chargeback is terminal (a later approval is `stale`); for a
 * RECURRING sale arrival order wins and the payload's own effect is the state; an `occurredAt` older
 * than the row's `lastEventAt` is `stale` for every effect, and a null `occurredAt` never compares.
 */

const T0 = new Date('2026-10-20T10:00:00.000Z');
const OLDER = new Date('2026-10-20T09:00:00.000Z');
const NEWER = new Date('2026-10-20T11:00:00.000Z');

const row = (
  status: 'active' | 'inactive',
  terminal: boolean,
  lastEventAt: Date | null = T0,
): ExistingAccessRow => ({ status, terminal, lastEventAt });

describe('decideAccessWrite', () => {
  const EFFECTS: AccessEffect[] = ['grant', 'suspend', 'revoke'];

  it('a grant on nothing writes an active, non-terminal row (access_granted)', () => {
    for (const recurring of [true, false]) {
      expect(
        decideAccessWrite({ effect: 'grant', recurring, existing: null, occurredAt: null }),
      ).toEqual({ action: 'write', status: 'active', terminal: false, outcome: 'access_granted' });
    }
  });

  it('a late approval of a terminal ONE-OFF sale is stale; the same for a recurring sale writes active', () => {
    const terminal = row('inactive', true);
    expect(
      decideAccessWrite({
        effect: 'grant',
        recurring: false,
        existing: terminal,
        occurredAt: null,
      }),
    ).toEqual({ action: 'skip', outcome: 'stale' });
    expect(
      decideAccessWrite({ effect: 'grant', recurring: true, existing: terminal, occurredAt: null }),
    ).toEqual({ action: 'write', status: 'active', terminal: false, outcome: 'access_granted' });
  });

  it('a renewal after a non-terminal inactive row writes active again', () => {
    for (const recurring of [true, false]) {
      expect(
        decideAccessWrite({
          effect: 'grant',
          recurring,
          existing: row('inactive', false),
          occurredAt: null,
        }),
      ).toEqual({ action: 'write', status: 'active', terminal: false, outcome: 'access_granted' });
    }
  });

  it('a revoke is terminal for a one-off sale and not for a recurring one, with or without a row', () => {
    for (const existing of [null, row('active', false), row('inactive', false)]) {
      expect(
        decideAccessWrite({ effect: 'revoke', recurring: false, existing, occurredAt: null }),
      ).toEqual({ action: 'write', status: 'inactive', terminal: true, outcome: 'access_cut' });
      expect(
        decideAccessWrite({ effect: 'revoke', recurring: true, existing, occurredAt: null }),
      ).toEqual({ action: 'write', status: 'inactive', terminal: false, outcome: 'access_cut' });
    }
  });

  it('a suspend writes inactive and leaves terminal as it was (a cancel that overtakes creates an inactive row)', () => {
    for (const recurring of [true, false]) {
      expect(
        decideAccessWrite({ effect: 'suspend', recurring, existing: null, occurredAt: null }),
      ).toEqual({ action: 'write', status: 'inactive', terminal: false, outcome: 'access_cut' });
      expect(
        decideAccessWrite({
          effect: 'suspend',
          recurring,
          existing: row('active', false),
          occurredAt: null,
        }),
      ).toEqual({ action: 'write', status: 'inactive', terminal: false, outcome: 'access_cut' });
      expect(
        decideAccessWrite({
          effect: 'suspend',
          recurring,
          existing: row('inactive', true),
          occurredAt: null,
        }),
      ).toEqual({ action: 'write', status: 'inactive', terminal: true, outcome: 'access_cut' });
    }
  });

  it('an occurredAt older than lastEventAt is stale for every effect and recurrence', () => {
    for (const effect of EFFECTS) {
      for (const recurring of [true, false]) {
        expect(
          decideAccessWrite({
            effect,
            recurring,
            existing: row('active', false, T0),
            occurredAt: OLDER,
          }),
        ).toEqual({ action: 'skip', outcome: 'stale' });
      }
    }
  });

  it('an occurredAt equal to or newer than lastEventAt is applied', () => {
    for (const occurredAt of [T0, NEWER]) {
      expect(
        decideAccessWrite({
          effect: 'suspend',
          recurring: true,
          existing: row('active', false, T0),
          occurredAt,
        }).action,
      ).toBe('write');
    }
  });

  it('a null occurredAt, a null lastEventAt or no row never compares', () => {
    for (const effect of EFFECTS) {
      expect(
        decideAccessWrite({
          effect,
          recurring: true,
          existing: row('active', false, T0),
          occurredAt: null,
        }).action,
      ).toBe('write');
      expect(
        decideAccessWrite({
          effect,
          recurring: true,
          existing: row('active', false, null),
          occurredAt: OLDER,
        }).action,
      ).toBe('write');
      expect(
        decideAccessWrite({ effect, recurring: true, existing: null, occurredAt: OLDER }).action,
      ).toBe('write');
    }
  });

  it('is a pure function: the same input twice gives the same answer and mutates nothing', () => {
    const existing = row('inactive', true);
    const frozen = Object.freeze({ ...existing });
    const input = {
      effect: 'grant' as const,
      recurring: false,
      existing: frozen,
      occurredAt: null,
    };
    expect(decideAccessWrite(input)).toEqual(decideAccessWrite(input));
    expect(frozen).toEqual(existing);
  });
});

describe('decideStoreWrite', () => {
  it('a one-off grant after an applied refund or chargeback of the same reference is stale', () => {
    expect(
      decideStoreWrite({ effect: 'grant', recurring: false, priorTerminalEvent: true }),
    ).toEqual({ action: 'skip', outcome: 'stale' });
  });

  it('a one-off grant with no prior terminal event is a purchase', () => {
    expect(
      decideStoreWrite({ effect: 'grant', recurring: false, priorTerminalEvent: false }),
    ).toEqual({ action: 'purchase' });
  });

  it('a recurring grant is always a purchase: arrival order wins, a renewal after a revoke buys again', () => {
    for (const priorTerminalEvent of [true, false]) {
      expect(decideStoreWrite({ effect: 'grant', recurring: true, priorTerminalEvent })).toEqual({
        action: 'purchase',
      });
    }
  });

  it('suspend and revoke revoke, whatever the history', () => {
    for (const effect of ['suspend', 'revoke'] as const) {
      for (const recurring of [true, false]) {
        for (const priorTerminalEvent of [true, false]) {
          expect(decideStoreWrite({ effect, recurring, priorTerminalEvent })).toEqual({
            action: 'revoke',
          });
        }
      }
    }
  });
});
