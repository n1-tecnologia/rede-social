import { describe, expect, it } from 'vitest';
import { formatNumberPtBr, parseNumberPtBr } from './number';

/**
 * 12-13 (D-590, UI-D-585; T-12-31) — the pt-BR number rule, one row per case of its truth table. An
 * ambiguous text is parsed by the documented rule or refused, never guessed.
 */

describe('parseNumberPtBr: the comma is the decimal mark when present', () => {
  it.each([
    ['1.234,5', 1234.5],
    ['1234,5', 1234.5],
    ['12,5', 12.5],
    ['0,5', 0.5],
    ['1.234.567,89', 1234567.89],
    ['-3,5', -3.5],
    ['1,234', 1.234],
  ])('%s is %s', (raw, expected) => {
    expect(parseNumberPtBr(raw)).toBe(expected);
  });
});

describe('parseNumberPtBr: with no comma, a dot is thousands only in a well-formed group', () => {
  it.each([
    ['1.234', 1234],
    ['12.345.678', 12345678],
    ['999.999', 999999],
    ['1.5', 1.5],
    ['1.23', 1.23],
    ['1234.5', 1234.5],
    ['0.500', 0.5],
    ['0.5', 0.5],
    ['1234', 1234],
    ['-3', -3],
    ['-1.234', -1234],
    ['  42  ', 42],
  ])('%s is %s', (raw, expected) => {
    expect(parseNumberPtBr(raw)).toBe(expected);
  });

  it('reads 1.234 as one thousand two hundred thirty-four by the rule, not as 1.234', () => {
    expect(parseNumberPtBr('1.234')).toBe(1234);
    expect(parseNumberPtBr('1.234')).not.toBe(1.234);
  });
});

describe('parseNumberPtBr: anything else is refused, never repaired', () => {
  it.each([
    ['1e3'],
    ['1,2,3'],
    ['1.2.3'],
    ['1.2,5'],
    ['1.23,5'],
    ['abc'],
    ['12abc'],
    ['5,'],
    [',5'],
    ['.5'],
    ['1 234'],
    ['+5'],
    ['--5'],
    ['Infinity'],
    ['NaN'],
    ['9999999999999999999'],
    [''],
    ['   '],
  ])('%j is null', (raw) => {
    expect(parseNumberPtBr(raw)).toBeNull();
  });

  it('turns a negative zero into zero', () => {
    expect(Object.is(parseNumberPtBr('-0'), 0)).toBe(true);
  });
});

describe('formatNumberPtBr', () => {
  it.each([
    [1234.5, '1234,5'],
    [12, '12'],
    [-3.25, '-3,25'],
    [0, '0'],
    [1e-7, '0,0000001'],
  ])('%s shows as %s', (value, text) => {
    expect(formatNumberPtBr(value)).toBe(text);
  });

  it('what it shows parses back to the same number', () => {
    for (const value of [1234.5, 12, -3.25, 0, 0.1, 999999, 1.234]) {
      expect(parseNumberPtBr(formatNumberPtBr(value))).toBe(value);
    }
  });
});
