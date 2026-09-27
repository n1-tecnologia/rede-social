import { describe, expect, it } from 'vitest';
import { EVENT_CHECKIN_CODE_ALPHABET, EVENT_CHECKIN_CODE_LENGTH } from '../contracts/index';
import { generateCheckinCode, normalizeCheckinCode } from '../server/checkin-code';

/**
 * D-208 / D-217 / T-06-07 — the venue code's shape. The same regex `event_secrets_code_chk` pins in
 * the database: 4 symbols, and none of the look-alikes 0/O/1/I/L.
 */
const CODE_SHAPE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

describe('generateCheckinCode', () => {
  it('1. 1,000 generated codes all match the alphabet and the length', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(generateCheckinCode()).toMatch(CODE_SHAPE);
    }
  });

  it('2. the alphabet is the 31 unambiguous symbols and the constants agree with the CHECK', () => {
    expect(EVENT_CHECKIN_CODE_LENGTH).toBe(4);
    expect(EVENT_CHECKIN_CODE_ALPHABET).toHaveLength(31);
    for (const lookAlike of ['0', 'O', '1', 'I', 'L']) {
      expect(EVENT_CHECKIN_CODE_ALPHABET).not.toContain(lookAlike);
    }
  });

  it('3. codes vary (a CSPRNG draw, not a constant)', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateCheckinCode()));
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe('normalizeCheckinCode', () => {
  it('4. uppercases and strips whitespace and hyphens', () => {
    expect(normalizeCheckinCode(' k7-qm ')).toBe('K7QM');
    expect(normalizeCheckinCode('K7QM')).toBe('K7QM');
    expect(normalizeCheckinCode('k 7 q m')).toBe('K7QM');
  });
});
