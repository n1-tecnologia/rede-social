import { describe, expect, it } from 'vitest';
import { courseTopCover, trackTopCover } from './cover-fallback';

/**
 * 12.3-07 — the fallback ladder of the Topo (NOVF-02, UI-D-692), computed in the web and never in the
 * API: an entity's own Topo, else its card cover, else null (the page then draws the brand gradient,
 * D-69). The suggested invariant: an entity whose Topo is empty shows its card cover.
 */

const TOP = '11111111-1111-4111-8111-111111111111';
const CARD = '22222222-2222-4222-8222-222222222222';

describe.each([
  ['a track', trackTopCover],
  ['a course', courseTopCover],
])('the Topo of %s', (_name, topOf) => {
  it('is its own Topo when it has one, even with a card cover', () => {
    expect(topOf({ coverAssetId: CARD, topCoverAssetId: TOP })).toBe(TOP);
    expect(topOf({ coverAssetId: null, topCoverAssetId: TOP })).toBe(TOP);
  });

  it('falls back to the card cover when the Topo is empty (null or absent from an older answer)', () => {
    expect(topOf({ coverAssetId: CARD, topCoverAssetId: null })).toBe(CARD);
    expect(topOf({ coverAssetId: CARD })).toBe(CARD);
    expect(topOf({ coverAssetId: CARD, topCoverAssetId: undefined })).toBe(CARD);
  });

  it('is null with neither image, so the page draws the brand gradient', () => {
    expect(topOf({ coverAssetId: null, topCoverAssetId: null })).toBeNull();
    expect(topOf({ coverAssetId: null })).toBeNull();
  });
});
