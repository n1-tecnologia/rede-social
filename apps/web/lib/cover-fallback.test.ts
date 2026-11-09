import { describe, expect, it } from 'vitest';
import { courseTopCover, moduleCardCover, moduleTopCover, trackTopCover } from './cover-fallback';

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

/**
 * 12.3-08 — a module's two images (NOVF-03, UI-D-692, PU-2). The card: its own card cover, else the
 * course's cover, else null. The Topo: its own Topo, else its own card cover, else the course's cover,
 * else null (the brand gradient). The suggested invariant: a module whose second image is empty shows
 * its card cover (and the course's when it has no card cover either).
 */
const COURSE = '33333333-3333-4333-8333-333333333333';

describe('the card of a module', () => {
  it('is its own card cover when it has one, even with a course cover', () => {
    expect(moduleCardCover({ coverAssetId: CARD }, COURSE)).toBe(CARD);
  });

  it('falls back to the course cover (null or absent from an older answer)', () => {
    expect(moduleCardCover({ coverAssetId: null }, COURSE)).toBe(COURSE);
    expect(moduleCardCover({}, COURSE)).toBe(COURSE);
    expect(moduleCardCover({ coverAssetId: undefined }, COURSE)).toBe(COURSE);
  });

  it('is null with neither image, so the card draws the brand gradient', () => {
    expect(moduleCardCover({ coverAssetId: null }, null)).toBeNull();
    expect(moduleCardCover({}, null)).toBeNull();
  });
});

describe('the Topo of a module', () => {
  it('is its own Topo when it has one, whatever else is set', () => {
    expect(moduleTopCover({ coverAssetId: CARD, topCoverAssetId: TOP }, COURSE)).toBe(TOP);
    expect(moduleTopCover({ coverAssetId: null, topCoverAssetId: TOP }, null)).toBe(TOP);
  });

  it('falls back to its own card cover before the course cover', () => {
    expect(moduleTopCover({ coverAssetId: CARD, topCoverAssetId: null }, COURSE)).toBe(CARD);
    expect(moduleTopCover({ coverAssetId: CARD }, COURSE)).toBe(CARD);
  });

  it('falls back to the course cover when the module has neither image', () => {
    expect(moduleTopCover({ coverAssetId: null, topCoverAssetId: null }, COURSE)).toBe(COURSE);
    expect(moduleTopCover({}, COURSE)).toBe(COURSE);
  });

  it('is null with no image anywhere, so the page draws the brand gradient', () => {
    expect(moduleTopCover({ coverAssetId: null, topCoverAssetId: null }, null)).toBeNull();
    expect(moduleTopCover({}, null)).toBeNull();
  });
});
