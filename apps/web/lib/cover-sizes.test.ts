import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { describe, expect, it } from 'vitest';
import { COVER_SIZES } from './cover-sizes';

/**
 * 2026-10-23 — the ideal cover sizes the cover fields print: the named shape must be the size's own,
 * and no cover asks for more width than the cover ladder ever serves.
 */
describe('COVER_SIZES', () => {
  const entries = Object.entries(COVER_SIZES);

  it.each(entries)('%s: the named shape is the size’s own', (_kind, size) => {
    const [w, h] = size.ratio.split(':').map(Number);
    expect(w && h, size.ratio).toBeTruthy();
    expect(size.width * (h as number)).toBe(size.height * (w as number));
  });

  it('no cover asks for more width than the largest variant the ladder derives', () => {
    const top = Math.max(...PURPOSE_WIDTHS.cover);
    for (const [kind, size] of entries) expect(size.width, kind).toBeLessThanOrEqual(top);
  });

  it('a landscape cover asks for the top of the ladder, so every variant is derived', () => {
    const top = Math.max(...PURPOSE_WIDTHS.cover);
    for (const [kind, size] of entries) {
      if (size.width > size.height && kind !== 'category') expect(size.width, kind).toBe(top);
    }
  });
});
