import { describe, expect, it } from 'vitest';
import { formatBrl, parseBrlToCents, priceCentsSchema, STORE_MAX_PRICE_CENTS } from '../src/money';

/** U+00A0, the no-break space `Intl` puts after `R$` (RESEARCH Pitfall 12). Spelled, never typed. */
const NBSP = ' ';

describe('money (08.2 P11, STORE-02): integer cents end to end', () => {
  it('pins the cap at R$ 100.000,00', () => {
    expect(STORE_MAX_PRICE_CENTS).toBe(10_000_000);
  });

  it('formatBrl prints pt-BR currency with the U+00A0 separator', () => {
    expect(formatBrl(1990)).toBe(`R$${NBSP}19,90`);
    expect(formatBrl(0)).toBe(`R$${NBSP}0,00`);
    expect(formatBrl(123450)).toBe(`R$${NBSP}1.234,50`);
    expect(formatBrl(STORE_MAX_PRICE_CENTS)).toBe(`R$${NBSP}100.000,00`);
    // The ASCII-space spelling is NOT what Intl emits.
    expect(formatBrl(1990)).not.toBe('R$ 19,90');
  });

  it.each([
    ['19', 1900],
    ['19,9', 1990],
    ['19,90', 1990],
    ['1.234,50', 123450],
    ['1234,50', 123450],
    ['0', 0],
    ['0,01', 1],
    ['R$ 19,90', 1990],
    [` R$${NBSP}1.234,50 `, 123450],
  ])('parseBrlToCents(%j) -> %d', (raw, cents) => {
    expect(parseBrlToCents(raw)).toBe(cents);
  });

  it.each(['-1', '19.90', '19,999', '', 'abc', '1,2,3', '12.34.5', '19,'])(
    'parseBrlToCents(%j) -> null',
    (raw) => {
      expect(parseBrlToCents(raw)).toBeNull();
    },
  );

  it('round-trips every formatBrl output', () => {
    for (const cents of [0, 1, 99, 1990, 123450, STORE_MAX_PRICE_CENTS]) {
      expect(parseBrlToCents(formatBrl(cents))).toBe(cents);
    }
  });

  it('parses above the cap: the cap is the schema job, not the parser job', () => {
    expect(parseBrlToCents('100.000,01')).toBe(STORE_MAX_PRICE_CENTS + 1);
    expect(priceCentsSchema.safeParse(STORE_MAX_PRICE_CENTS + 1).success).toBe(false);
  });

  it.each([
    [-1, false],
    [0, true],
    [1990, true],
    [10_000_000, true],
    [10_000_001, false],
    [1.5, false],
    [Number.NaN, false],
  ])('priceCentsSchema(%d) success = %s', (value, ok) => {
    expect(priceCentsSchema.safeParse(value).success).toBe(ok);
  });
});
