import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventInputSchema } from '@rede-social/module-events/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_OPENING,
  openingErrors,
  openingFieldState,
  openingKey,
  tenantWallClockNow,
} from './event-opening-form';

/**
 * Phase 10.2-12 (D-792, D-793, OPEN-03, OPEN-19, UI-D-790): the pure rules of the event form's
 * "Abertura das inscrições" field. The helper reads no clock and builds no `Date`; every case hands it
 * the facts the form holds.
 */

const STORED = { date: '2026-11-20', time: '10:00' };
const OTHER = { date: '2026-11-21', time: '09:30' };

const BASE = {
  host: true,
  locked: false,
  switchOn: true,
  hasMapping: true,
  stored: STORED as typeof STORED | null,
  typed: STORED as { date: string; time: string },
};

describe('openingKey: the payload rule (D-793, OPEN-19, assumption A-10.2-OMIT)', () => {
  it('a host that predates the section sends no key, whatever the form holds', () => {
    expect(openingKey({ ...BASE, host: false, typed: OTHER })).toEqual({});
    expect(openingKey({ ...BASE, host: false, switchOn: false, typed: EMPTY_OPENING })).toEqual({});
  });

  it('an unchanged pair sends nothing (so a web ahead of the API still saves)', () => {
    expect(openingKey(BASE)).toEqual({});
    expect(openingKey({ ...BASE, stored: null, typed: EMPTY_OPENING })).toEqual({});
  });

  it('a typed pair that differs from the stored one sends the pair', () => {
    expect(openingKey({ ...BASE, typed: OTHER })).toEqual({ registrationOpens: OTHER });
    expect(openingKey({ ...BASE, typed: { ...STORED, time: '10:05' } })).toEqual({
      registrationOpens: { ...STORED, time: '10:05' },
    });
  });

  it('a new pair on an event with none stored sends the pair (create included)', () => {
    expect(openingKey({ ...BASE, stored: null, hasMapping: false, typed: OTHER })).toEqual({
      registrationOpens: OTHER,
    });
  });

  it('a cleared field with a stored pair sends an explicit null', () => {
    expect(openingKey({ ...BASE, typed: EMPTY_OPENING })).toEqual({ registrationOpens: null });
  });

  it('a half-filled pair sends nothing (the form refuses it before any write)', () => {
    expect(openingKey({ ...BASE, typed: { date: '2026-11-21', time: '' } })).toEqual({});
    expect(openingKey({ ...BASE, typed: { date: '', time: '09:00' } })).toEqual({});
  });

  it('switch on and the section locked sends nothing, even for a different pair', () => {
    expect(openingKey({ ...BASE, locked: true, typed: OTHER })).toEqual({});
    expect(openingKey({ ...BASE, locked: true, typed: EMPTY_OPENING })).toEqual({});
  });

  it('switch off with a saved mapping sends NOTHING: the mapping removal clears it atomically', () => {
    expect(openingKey({ ...BASE, switchOn: false })).toEqual({});
    expect(openingKey({ ...BASE, switchOn: false, typed: EMPTY_OPENING })).toEqual({});
    expect(openingKey({ ...BASE, switchOn: false, typed: OTHER })).toEqual({});
  });

  it('switch off with no mapping and a stored date sends an explicit null', () => {
    expect(openingKey({ ...BASE, switchOn: false, hasMapping: false })).toEqual({
      registrationOpens: null,
    });
  });

  it('switch off with no mapping and a typed date (nothing stored) sends an explicit null', () => {
    expect(
      openingKey({ ...BASE, switchOn: false, hasMapping: false, stored: null, typed: OTHER }),
    ).toEqual({ registrationOpens: null });
    expect(
      openingKey({
        ...BASE,
        switchOn: false,
        hasMapping: false,
        stored: null,
        typed: { date: '2026-11-21', time: '' },
      }),
    ).toEqual({ registrationOpens: null });
  });

  it('switch off with no mapping, nothing stored and nothing typed sends no key (a free event)', () => {
    expect(
      openingKey({
        ...BASE,
        switchOn: false,
        hasMapping: false,
        stored: null,
        typed: EMPTY_OPENING,
      }),
    ).toEqual({});
  });

  it('a locked section with the switch off sends nothing', () => {
    expect(openingKey({ ...BASE, locked: true, switchOn: false, hasMapping: false })).toEqual({});
  });

  it('never returns the typed object itself (the payload owns its copy)', () => {
    const typed = { ...OTHER };
    const key = openingKey({ ...BASE, typed });
    expect(key.registrationOpens).not.toBe(typed);
  });
});

describe('openingErrors: incomplete and after-start (UI-D-790 e, EP-38, EP-39)', () => {
  const START = { date: '2026-11-29', time: '10:00' };

  it('both empty is valid', () => {
    expect(openingErrors({ typed: EMPTY_OPENING, start: START })).toBeNull();
  });

  it('one half filled is incomplete, in either direction', () => {
    expect(openingErrors({ typed: { date: '2026-11-20', time: '' }, start: START })).toBe(
      'incomplete',
    );
    expect(openingErrors({ typed: { date: '', time: '10:00' }, start: START })).toBe('incomplete');
  });

  it('EP-38: equal to the start is the error, one minute before is accepted, one minute after is the error', () => {
    expect(openingErrors({ typed: { date: '2026-11-29', time: '10:00' }, start: START })).toBe(
      'afterStart',
    );
    expect(
      openingErrors({ typed: { date: '2026-11-29', time: '09:59' }, start: START }),
    ).toBeNull();
    expect(openingErrors({ typed: { date: '2026-11-29', time: '10:01' }, start: START })).toBe(
      'afterStart',
    );
  });

  it('a later day is the error and an earlier day is accepted', () => {
    expect(openingErrors({ typed: { date: '2026-11-30', time: '00:00' }, start: START })).toBe(
      'afterStart',
    );
    expect(
      openingErrors({ typed: { date: '2026-11-28', time: '23:59' }, start: START }),
    ).toBeNull();
  });

  it('is judged against the TYPED start, so moving the start re-judges the opening', () => {
    const typed = { date: '2026-11-25', time: '12:00' };
    expect(openingErrors({ typed, start: START })).toBeNull();
    expect(openingErrors({ typed, start: { date: '2026-11-25', time: '11:00' } })).toBe(
      'afterStart',
    );
  });

  it('with no usable start there is nothing to compare against', () => {
    const typed = { date: '2026-11-25', time: '12:00' };
    expect(openingErrors({ typed, start: { date: '', time: '' } })).toBeNull();
    expect(openingErrors({ typed, start: { date: '2026-11-25', time: '' } })).toBeNull();
  });

  it('agrees with the shared schema on the boundary (one rule, two places)', () => {
    const body = (opens: { date: string; time: string }) => ({
      title: 'Encontro',
      format: 'online',
      meetingUrl: 'https://meet.example.com/x',
      start: START,
      end: { date: '2026-11-29', time: '12:00' },
      registrationOpens: opens,
    });
    const refused = (opens: { date: string; time: string }) =>
      !eventInputSchema.safeParse(body(opens)).success;
    for (const opens of [
      { date: '2026-11-29', time: '09:59' },
      { date: '2026-11-29', time: '10:00' },
      { date: '2026-11-29', time: '10:01' },
      { date: '2026-11-28', time: '23:59' },
      { date: '2026-11-30', time: '00:00' },
    ]) {
      expect(openingErrors({ typed: opens, start: START }) === 'afterStart').toBe(refused(opens));
    }
  });

  it('keeps minute precision: the helper never adds seconds', () => {
    const typed = { date: '2026-11-20', time: '10:00' };
    expect(openingKey({ ...BASE, stored: null, typed }).registrationOpens?.time).toBe('10:00');
  });
});

describe('openingFieldState (UI-D-790 a to d)', () => {
  const NOW = { date: '2026-11-14', time: '12:00' };

  it('locked wins over everything, with a stored or an empty pair', () => {
    expect(openingFieldState({ typed: STORED, nowWallClock: NOW, soldCount: 1 })).toBe('locked');
    expect(openingFieldState({ typed: EMPTY_OPENING, nowWallClock: NOW, soldCount: 3 })).toBe(
      'locked',
    );
  });

  it('empty is both halves empty (or one half only: still not a filled date)', () => {
    expect(openingFieldState({ typed: EMPTY_OPENING, nowWallClock: NOW, soldCount: 0 })).toBe(
      'empty',
    );
    expect(
      openingFieldState({
        typed: { date: '2026-11-20', time: '' },
        nowWallClock: NOW,
        soldCount: 0,
      }),
    ).toBe('empty');
  });

  it('filled is a complete pair after the wall-clock now', () => {
    expect(openingFieldState({ typed: STORED, nowWallClock: NOW, soldCount: 0 })).toBe('filled');
  });

  it('past is a complete pair at or before the wall-clock now', () => {
    expect(
      openingFieldState({
        typed: { date: '2026-11-14', time: '11:59' },
        nowWallClock: NOW,
        soldCount: 0,
      }),
    ).toBe('past');
    expect(openingFieldState({ typed: NOW, nowWallClock: NOW, soldCount: 0 })).toBe('past');
    expect(
      openingFieldState({
        typed: { date: '2026-11-14', time: '12:01' },
        nowWallClock: NOW,
        soldCount: 0,
      }),
    ).toBe('filled');
  });

  it('without a wall-clock now the form never reads a clock: the pair is just filled', () => {
    expect(openingFieldState({ typed: { date: '2020-01-01', time: '00:00' }, soldCount: 0 })).toBe(
      'filled',
    );
  });
});

describe('tenantWallClockNow: the server-side "now" in the tenant zone', () => {
  it('formats an instant as the tenant wall-clock pair', () => {
    // 2026-11-14 12:30 UTC is 09:30 in Sao Paulo (UTC-3, no DST in November 2026).
    expect(tenantWallClockNow(Date.UTC(2026, 10, 14, 12, 30), 'America/Sao_Paulo')).toEqual({
      date: '2026-11-14',
      time: '09:30',
    });
  });

  it('crosses the UTC day in the tenant zone and never prints 24:00', () => {
    expect(tenantWallClockNow(Date.UTC(2026, 10, 15, 2, 30), 'America/Sao_Paulo')).toEqual({
      date: '2026-11-14',
      time: '23:30',
    });
    expect(tenantWallClockNow(Date.UTC(2026, 10, 14, 0, 0), 'UTC')).toEqual({
      date: '2026-11-14',
      time: '00:00',
    });
  });
});

describe('the module reads no clock and builds no Date for the pair', () => {
  it('has no new Date, Date.now or Date.parse in its source', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'event-opening-form.ts'), 'utf8');
    expect(source).not.toMatch(/new Date|Date\.(now|parse)/);
  });
});
