import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  type CountdownT,
  countdownBlocks,
  countdownLead,
  countdownParts,
  countdownShort,
  countdownSpoken,
  MINUTE_MS,
  msToNextMinuteChange,
} from './event-countdown';

/**
 * Phase 10.2-09 (D-787, D-785, D-788, D-790; EP-19 to EP-23): the one pure countdown formatter, proved
 * against the REAL merged catalog and the real next-intl formatter, so a plural that stops parsing or a
 * key that goes missing fails here and not on a member's phone.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'events' as never,
}) as unknown as CountdownT;

const HOUR = 60 * MINUTE_MS;
const DAY = 24 * HOUR;

/** days, hours, minutes and (optionally) loose seconds to milliseconds. */
function ms(days: number, hours: number, minutes: number, seconds = 0): number {
  return days * DAY + hours * HOUR + minutes * MINUTE_MS + seconds * 1000;
}

describe('countdown: the tracer, 2 d 4 h 13 min in the three forms (D-787, D-785, OPEN-09)', () => {
  const remaining = ms(2, 4, 13);

  it('is the units state with days 2, hours 4 and minutes 13', () => {
    expect(countdownParts(remaining)).toEqual({ state: 'units', days: 2, hours: 4, minutes: 13 });
  });

  it('reads as the card text', () => {
    expect(countdownShort(t, remaining)).toBe('2 d 4 h 13 min');
  });

  it('reads as the page cells, zero-padded, with the ICU unit labels', () => {
    expect(countdownBlocks(t, remaining)).toEqual([
      { value: '02', label: 'dias' },
      { value: '04', label: 'horas' },
      { value: '13', label: 'min' },
    ]);
  });

  it('reads as the spoken value with the opening key', () => {
    expect(countdownSpoken(t, remaining, 'opening')).toBe(
      'Tempo restante para a abertura: 2 dias, 4 horas e 13 minutos.',
    );
  });

  it('takes the lead Faltam (other)', () => {
    expect(countdownLead(remaining)).toBe('other');
  });
});

/** EP-19 and EP-20: one row per threshold and one step either side of it. */
const BOUNDARIES: Array<[label: string, remaining: number, short: string, lead: 'one' | 'other']> =
  [
    ['59 999 ms is the last minute', 59_999, 'menos de 1 min', 'other'],
    ['60 000 ms is 1 min', 60_000, '1 min', 'one'],
    ['61 000 ms is still 1 min', 61_000, '1 min', 'one'],
    ['119 999 ms is still 1 min', 119_999, '1 min', 'one'],
    ['120 000 ms is 2 min', 120_000, '2 min', 'other'],
    ['3 599 999 ms is 59 min', 3_599_999, '59 min', 'other'],
    ['3 600 000 ms is exactly 1 h', 3_600_000, '1 h', 'one'],
    ['3 659 999 ms is 1 h with the zero minute dropped', 3_659_999, '1 h', 'one'],
    ['3 660 000 ms is 1 h 1 min', 3_660_000, '1 h 1 min', 'other'],
    ['86 399 999 ms is 23 h 59 min', 86_399_999, '23 h 59 min', 'other'],
    ['86 400 000 ms is exactly 1 d (never 24 h)', 86_400_000, '1 d', 'one'],
    ['86 459 999 ms is 1 d (zero hours and minutes dropped)', 86_459_999, '1 d', 'one'],
    ['86 460 000 ms is 1 d 1 min', 86_460_000, '1 d 1 min', 'other'],
    ['86 700 000 ms is 1 d 5 min (the interior zero)', 86_700_000, '1 d 5 min', 'other'],
    ['1 d 1 h is 1 d 1 h', ms(1, 1, 0), '1 d 1 h', 'other'],
    ['2 d is 2 d, plural lead', ms(2, 0, 0), '2 d', 'other'],
    ['99 days', 99 * DAY, '99 d', 'other'],
    ['100 days', 100 * DAY, '100 d', 'other'],
    ['365 days', 365 * DAY, '365 d', 'other'],
    ['365 days 23 h 59 min', ms(365, 23, 59), '365 d 23 h 59 min', 'other'],
  ];

describe('countdown: the boundaries of the card text and the lead (EP-19, EP-20)', () => {
  it.each(BOUNDARIES)('%s', (_label, remaining, short, lead) => {
    expect(countdownShort(t, remaining)).toBe(short);
    expect(countdownLead(remaining)).toBe(lead);
  });

  it('is the last-minute state for 1 ms to 59 999 ms and the units state from 60 000 ms', () => {
    expect(countdownParts(1)).toEqual({ state: 'lessThanMinute' });
    expect(countdownParts(59_999)).toEqual({ state: 'lessThanMinute' });
    expect(countdownParts(60_000)).toEqual({ state: 'units', days: 0, hours: 0, minutes: 1 });
  });

  it('keeps the order days, hours, minutes with the zero units dropped in between', () => {
    expect(countdownShort(t, ms(1, 0, 5))).toBe('1 d 5 min');
    expect(countdownShort(t, ms(3, 2, 0))).toBe('3 d 2 h');
    expect(countdownShort(t, ms(0, 5, 7))).toBe('5 h 7 min');
  });
});

describe('countdown: the page cells (D-785, EP-22)', () => {
  it('pads to two digits, keeps the order and drops the zero units', () => {
    expect(countdownBlocks(t, ms(1, 0, 5))).toEqual([
      { value: '01', label: 'dia' },
      { value: '05', label: 'min' },
    ]);
    expect(countdownBlocks(t, ms(0, 1, 0))).toEqual([{ value: '01', label: 'hora' }]);
    expect(countdownBlocks(t, ms(0, 0, 40))).toEqual([{ value: '40', label: 'min' }]);
  });

  it('grows a day count above 99, never capped', () => {
    expect(countdownBlocks(t, 99 * DAY)).toEqual([{ value: '99', label: 'dias' }]);
    expect(countdownBlocks(t, 100 * DAY)).toEqual([{ value: '100', label: 'dias' }]);
    expect(countdownBlocks(t, 365 * DAY)).toEqual([{ value: '365', label: 'dias' }]);
  });

  it('is one full-width cell with no number in the last minute', () => {
    expect(countdownBlocks(t, 59_999)).toEqual([{ value: null, label: 'Menos de 1 min' }]);
  });

  it('draws no cell once it has reached zero', () => {
    expect(countdownBlocks(t, 0)).toEqual([]);
  });
});

describe('countdown: the spoken value (D-790, EP-22)', () => {
  it('lists the units with e before the last one', () => {
    expect(countdownSpoken(t, ms(2, 4, 13), 'opening')).toBe(
      'Tempo restante para a abertura: 2 dias, 4 horas e 13 minutos.',
    );
    expect(countdownSpoken(t, ms(1, 0, 5), 'opening')).toBe(
      'Tempo restante para a abertura: 1 dia e 5 minutos.',
    );
    expect(countdownSpoken(t, ms(0, 0, 13), 'opening')).toBe(
      'Tempo restante para a abertura: 13 minutos.',
    );
    expect(countdownSpoken(t, ms(0, 1, 0), 'opening')).toBe(
      'Tempo restante para a abertura: 1 hora.',
    );
  });

  it('is the same function for the countdown to the event, with the other key', () => {
    expect(countdownSpoken(t, ms(2, 4, 13), 'event')).toBe(
      'Tempo restante para o evento: 2 dias, 4 horas e 13 minutos.',
    );
  });

  it('says less than a minute in the last minute and nothing at zero', () => {
    expect(countdownSpoken(t, 59_999, 'opening')).toBe(
      'Tempo restante para a abertura: menos de 1 minuto.',
    );
    expect(countdownSpoken(t, 0, 'opening')).toBe('');
  });
});

describe('countdown: rounding is floor, never half-up (EP-23)', () => {
  it('reads 13 min 40 s as 13 min, never 14', () => {
    expect(countdownShort(t, ms(0, 0, 13, 40))).toBe('13 min');
    expect(countdownParts(ms(0, 0, 13, 40))).toEqual({
      state: 'units',
      days: 0,
      hours: 0,
      minutes: 13,
    });
  });

  it('reads 59 min 59.999 s as 59 min, never 1 h', () => {
    expect(countdownShort(t, 59 * MINUTE_MS + 59_999)).toBe('59 min');
  });

  it('keeps the arithmetic integer: a 365 day count has no drift', () => {
    expect(countdownParts(ms(365, 23, 59))).toEqual({
      state: 'units',
      days: 365,
      hours: 23,
      minutes: 59,
    });
  });

  it('never shows seconds', () => {
    for (const remaining of [ms(0, 0, 13, 40), ms(1, 2, 3, 59), 59_999, 61_999]) {
      expect(countdownShort(t, remaining)).not.toMatch(/\bs\b|seg/i);
    }
  });
});

describe('countdown: nothing to count (EP-21)', () => {
  it.each([
    ['zero', 0],
    ['a negative value', -1],
    ['a large negative value', -5 * DAY],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('%s is the now state and no formatter throws', (_label, remaining) => {
    expect(countdownParts(remaining)).toEqual({ state: 'now' });
    expect(countdownShort(t, remaining)).toBe('');
    expect(countdownBlocks(t, remaining)).toEqual([]);
    expect(countdownSpoken(t, remaining, 'opening')).toBe('');
    expect(countdownLead(remaining)).toBe('other');
  });
});

describe('countdown: the single timer of the client island (D-788)', () => {
  it('is how long until the floored minute count changes', () => {
    // 2 min 30 s left: the count turns from 2 to 1 once 30 s have passed (and 1 ms to cross it).
    expect(msToNextMinuteChange(ms(0, 0, 2, 30))).toBe(30_001);
    // At exactly a minute boundary the displayed value changes after one millisecond.
    expect(msToNextMinuteChange(2 * MINUTE_MS)).toBe(1);
    // In the last minute the next change is the opening itself.
    expect(msToNextMinuteChange(59_999)).toBe(60_000);
  });

  it.each([
    1, 59_999, 60_000, 60_001, 61_000, 119_999, 120_000, 3_599_999, 3_600_000, 86_400_000,
    86_700_001,
  ])('lands exactly on the first millisecond the value changes (%i ms left)', (remaining) => {
    const delay = msToNextMinuteChange(remaining);
    const before = Math.floor(remaining / MINUTE_MS);
    // Just before the timer fires the count is unchanged; the moment it fires it has changed.
    expect(Math.floor((remaining - (delay - 1)) / MINUTE_MS)).toBe(before);
    expect(Math.floor((remaining - delay) / MINUTE_MS)).toBeLessThan(before);
  });

  it('never exceeds one minute and is zero when there is nothing left to count', () => {
    for (let remaining = 1; remaining < 5 * MINUTE_MS; remaining += 977) {
      const delay = msToNextMinuteChange(remaining);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(MINUTE_MS);
    }
    for (const nothing of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(msToNextMinuteChange(nothing)).toBe(0);
    }
  });
});

describe('countdown: the module reads no clock and arms no timer (OPEN-21)', () => {
  const source = readFileSync(join(process.cwd(), 'lib', 'event-countdown.ts'), 'utf8')
    // Comments are prose; the rule is about the code.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('has no Date.now(), no argument-less new Date() and no timer', () => {
    expect(source).not.toMatch(/Date\.now|new Date\(\s*\)|setTimeout|setInterval|performance\.now/);
  });

  it('imports nothing server-side', () => {
    expect(source).not.toMatch(
      /from\s+['"](node:|server-only|@rede-social\/(core|db|contracts)\b)/,
    );
  });
});
