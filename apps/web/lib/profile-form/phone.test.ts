import { describe, expect, it } from 'vitest';
import { caretAfterDigits, onlyDigits, parseBrazilianPhone, phoneMask } from './phone';

/**
 * 12-13 (D-590, UI-D-585; T-12-31) — the Brazilian phone helpers: the mask the member sees, the national
 * number that is stored, and the paste forms that reach it. They move between the two and never drop a digit.
 */

describe('parseBrazilianPhone: every common form reaches the national number', () => {
  it.each([
    ['+55 11 91234-5678', '11912345678'],
    ['5511912345678', '11912345678'],
    ['(11) 91234-5678', '11912345678'],
    ['11912345678', '11912345678'],
    ['+55 (11) 91234-5678', '11912345678'],
    ['11 1234-5678', '1112345678'],
    ['+55 11 1234-5678', '1112345678'],
    ['551112345678', '1112345678'],
  ])('%s is %s', (raw, expected) => {
    expect(parseBrazilianPhone(raw)).toBe(expected);
  });

  it('keeps a DDD 55 number whole: 11 digits never lose their first two', () => {
    expect(parseBrazilianPhone('55912345678')).toBe('55912345678');
    expect(parseBrazilianPhone('(55) 91234-5678')).toBe('55912345678');
    expect(parseBrazilianPhone('5512345678')).toBe('5512345678');
  });

  it('removes the 55 of a number whose DDD is 55 as well, once, from a country-code paste', () => {
    expect(parseBrazilianPhone('+55 55 91234-5678')).toBe('55912345678');
  });

  it('returns what was typed when no country code can explain the length, never truncated', () => {
    expect(parseBrazilianPhone('119123456789')).toBe('119123456789');
    expect(parseBrazilianPhone('5511912345678901')).toBe('5511912345678901');
    expect(parseBrazilianPhone('12345')).toBe('12345');
    expect(parseBrazilianPhone('')).toBe('');
    expect(parseBrazilianPhone('abc')).toBe('');
  });
});

describe('phoneMask', () => {
  it.each([
    ['', ''],
    ['1', '(1'],
    ['11', '(11'],
    ['119', '(11) 9'],
    ['1191', '(11) 91'],
    ['11912', '(11) 912'],
    ['119123', '(11) 9123'],
    ['1191234', '(11) 9123-4'],
    ['111234567', '(11) 1234-567'],
    ['1112345678', '(11) 1234-5678'],
    ['11912345678', '(11) 91234-5678'],
  ])('%s shows as %s', (digits, masked) => {
    expect(phoneMask(digits)).toBe(masked);
  });

  it('cuts at 11 digits and ignores anything that is not a digit', () => {
    expect(phoneMask('119123456789999')).toBe('(11) 91234-5678');
    expect(phoneMask('(11) 91234-5678')).toBe('(11) 91234-5678');
  });
});

describe('the helpers around the mask', () => {
  it('onlyDigits drops every other character', () => {
    expect(onlyDigits('+55 (11) 9-1234')).toBe('55119 1234'.replace(' ', ''));
  });

  it('caretAfterDigits puts the caret right after the nth digit of the mask', () => {
    const masked = '(11) 91234-5678';
    expect(caretAfterDigits(masked, 0)).toBe(0);
    expect(caretAfterDigits(masked, 1)).toBe(2);
    expect(caretAfterDigits(masked, 2)).toBe(3);
    expect(caretAfterDigits(masked, 3)).toBe(6);
    expect(caretAfterDigits(masked, 7)).toBe(10);
    expect(caretAfterDigits(masked, 11)).toBe(masked.length);
    expect(caretAfterDigits(masked, 99)).toBe(masked.length);
  });
});
