import { tokenState } from '@rede-social/contracts/projects';
import { describe, expect, it } from 'vitest';
import { tokenChangeFields, tokenStateOf } from '../server/projects/token-state';

/**
 * 09.4-08 Task 2 (D-573, D-576, CTK-21, CTK-33): the server derives the token state from the ONE contracts
 * function, and a change of it is described by exactly four keys: the event, the project id, the state before
 * and the state after. Nothing about the token itself can be a key.
 */

const TODAY = '2026-10-27';

describe('tokenStateOf', () => {
  it('is null for a platform project: it has no token', () => {
    expect(
      tokenStateOf({ owner: 'platform', tokenCheck: 'ok', expiresAt: '2026-12-01', today: TODAY }),
    ).toBeNull();
  });

  it('for a customer project equals the contracts tokenState over the stored check, the expiry and today', () => {
    const cases: Array<[string | null, string | null]> = [
      [null, null],
      ['ok', null],
      ['invalid', null],
      ['forbidden', '2026-12-01'],
      ['org_mismatch', null],
      ['ok', '2026-10-20'],
      ['ok', '2026-11-10'],
      ['ok', '2027-05-01'],
    ];
    for (const [check, expiresAt] of cases) {
      expect(tokenStateOf({ owner: 'customer', tokenCheck: check, expiresAt, today: TODAY })).toBe(
        tokenState({
          check: check as 'ok' | 'invalid' | 'forbidden' | 'org_mismatch' | null,
          expiresAt,
          today: TODAY,
        }),
      );
    }
  });

  it('reads an unknown stored check as never checked', () => {
    expect(
      tokenStateOf({ owner: 'customer', tokenCheck: 'weird', expiresAt: null, today: TODAY }),
    ).toBe('unchecked');
  });

  it('takes today from the operator’s calendar when it is not injected', () => {
    // A far-future expiry is `valid` and a far-past one is `expired` whatever today is.
    expect(tokenStateOf({ owner: 'customer', tokenCheck: 'ok', expiresAt: '2999-01-01' })).toBe(
      'valid',
    );
    expect(tokenStateOf({ owner: 'customer', tokenCheck: 'ok', expiresAt: '2001-01-01' })).toBe(
      'expired',
    );
  });
});

describe('tokenChangeFields', () => {
  it('is exactly the event, the project id, the state before and the state after', () => {
    expect(tokenChangeFields('p1', 'valid', 'invalid')).toEqual({
      event: 'project.token.state_changed',
      projectId: 'p1',
      from: 'valid',
      to: 'invalid',
    });
  });

  it('key set: nothing but event, projectId, from and to, whatever the states', () => {
    for (const [from, to] of [
      ['unchecked', 'valid'],
      ['expiring', 'expired'],
      [null, 'valid'],
    ] as const) {
      expect(Object.keys(tokenChangeFields('p2', from, to)).sort()).toEqual([
        'event',
        'from',
        'projectId',
        'to',
      ]);
    }
  });
});
