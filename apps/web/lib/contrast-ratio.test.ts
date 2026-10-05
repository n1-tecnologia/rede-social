import { contrastRatio } from '@rede-social/contracts/branding';
import { describe, expect, it } from 'vitest';
import { formatContrastRatio } from './contrast-ratio';

/**
 * 2026-10-03 (review BTN-CARD-3) — the contrast pills' number. A failing ratio never reads as the
 * floor it misses: #777777 under white is 4.48:1, which plain rounding printed "Baixo 4,5:1".
 */
describe('formatContrastRatio', () => {
  it('rounds a failing ratio down, so it never reaches the floor it misses', () => {
    const grey = contrastRatio('#777777', '#ffffff');
    expect(grey).toBeGreaterThan(4.45);
    expect(grey).toBeLessThan(4.5);
    expect(formatContrastRatio(grey, false)).toBe('4,4');
    expect(formatContrastRatio(2.96, false)).toBe('2,9');
    expect(formatContrastRatio(1.04, false)).toBe('1');
  });

  it('rounds a passing ratio as usual, in pt-BR with one decimal', () => {
    expect(formatContrastRatio(contrastRatio('#e3af3f', '#382317'), true)).toBe('7,4');
    expect(formatContrastRatio(4.5, true)).toBe('4,5');
    expect(formatContrastRatio(4.96, true)).toBe('5');
    expect(formatContrastRatio(21, true)).toBe('21');
  });
});
