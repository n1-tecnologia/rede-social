import { describe, expect, it } from 'vitest';
import { countUpParts, countUpText } from '../ui/CountUp';

/** The count keeps the host's pt-BR format at every step: only the numbers move. */

describe('countUpParts / countUpText', () => {
  it('ends on the exact text and starts every number at zero', () => {
    for (const text of [
      '8.430',
      'R$ 14,4 mil',
      'R$ 8.940,00',
      '0,84',
      '22%',
      '1 h 12 min',
      '1h04',
    ]) {
      const parts = countUpParts(text);
      expect(countUpText(parts, 1)).toBe(text);
    }
    expect(countUpText(countUpParts('R$ 14,4 mil'), 0)).toBe('R$ 0,0 mil');
    expect(countUpText(countUpParts('8.430'), 0)).toBe('0');
    expect(countUpText(countUpParts('1h04'), 0)).toBe('0h00');
  });

  it('keeps the grouping, the decimals and the words while counting', () => {
    expect(countUpText(countUpParts('8.430'), 0.5)).toBe('4.215');
    expect(countUpText(countUpParts('R$ 8.940,00'), 0.5)).toBe('R$ 4.470,00');
    expect(countUpText(countUpParts('0,84'), 0.5)).toBe('0,42');
    expect(countUpText(countUpParts('1 h 12 min'), 0.5)).toBe('1 h 6 min');
  });

  it('keeps dates, hours of the day and numbered labels still; amounts in the same text run', () => {
    expect(countUpText(countUpParts('Melhor: quinta, 20h–22h, com 97 interações'), 0)).toBe(
      'Melhor: quinta, 20h–22h, com 0 interações',
    );
    expect(countUpText(countUpParts('15/10, 20h · 64 inscritos'), 0)).toBe(
      '15/10, 20h · 0 inscritos',
    );
    expect(countUpText(countUpParts('0:41'), 0)).toBe('0:41');
    expect(countUpText(countUpParts('S12: 38'), 0)).toBe('S12: 0');
    // A duration still runs, minutes included; so does an amount of hours with a space.
    expect(countUpText(countUpParts('1h40'), 0)).toBe('0h00');
    expect(countUpText(countUpParts('26 h'), 0)).toBe('0 h');
    for (const text of ['Melhor: quinta, 20h–22h, com 97 interações', '15/10, 20h', 'S12: 38']) {
      expect(countUpText(countUpParts(text), 1)).toBe(text);
    }
  });

  it('a value with no number is left as it is', () => {
    expect(countUpParts('Falhou')).toEqual(['Falhou']);
    expect(countUpText(countUpParts('Falhou'), 0)).toBe('Falhou');
  });
});
