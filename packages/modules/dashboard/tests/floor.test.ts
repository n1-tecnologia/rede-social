import { describe, expect, it } from 'vitest';
import {
  isBelowPrivacyFloor as contractsIsBelow,
  ENGAGEMENT_BAND_ORDER,
  mergeBandsBelowFloor,
  PRIVACY_FLOOR,
} from '../contracts/floor';
import { floorBands, floorCount, sortFloored } from '../server/floor';
import * as ui from '../ui/metrics';

/**
 * The server-side privacy floor (08.7-06, D-462, INSIGHT-14, EP-44..EP-49): every group total of
 * people or orders passes `floorCount` / `floorBands` before an answer leaves the API, so a group of
 * 1-4 is not in the JSON at all (UI-D-470: zero is not floored). The helpers it stands on moved to
 * `contracts/floor.ts`; the ui entry re-exports the same functions.
 */

const BANDS = (
  newCount: number,
  superfan: number,
  engaged: number,
  occasional: number,
  atRisk: number,
  inactive: number,
) => ({ new: newCount, superfan, engaged, occasional, at_risk: atRisk, inactive });

describe('contracts/floor (planning decision 1: one implementation)', () => {
  it('is the very function and constant the ui entry exports', () => {
    expect(PRIVACY_FLOOR).toBe(5);
    expect(ui.PRIVACY_FLOOR).toBe(PRIVACY_FLOOR);
    expect(ui.mergeBandsBelowFloor).toBe(mergeBandsBelowFloor);
    expect(ui.isBelowPrivacyFloor).toBe(contractsIsBelow);
    expect(ui.ENGAGEMENT_BAND_ORDER).toBe(ENGAGEMENT_BAND_ORDER);
  });

  it('merges a small band with its smaller neighbour (the same rule as before the move)', () => {
    expect(mergeBandsBelowFloor({ counts: BANDS(22, 2, 8, 27, 96, 155) })).toEqual([
      { bands: ['new'], count: 22 },
      { bands: ['superfan', 'engaged'], count: 10 },
      { bands: ['occasional'], count: 27 },
      { bands: ['at_risk'], count: 96 },
      { bands: ['inactive'], count: 155 },
    ]);
  });
});

describe('floorCount (EP-44, UI-D-470)', () => {
  it('answers a group of 0 as the value 0: zero identifies no one', () => {
    expect(floorCount(0)).toEqual({ belowFloor: false, value: 0 });
  });

  it('answers 1 below the floor with no value key at all', () => {
    const floored = floorCount(1);
    expect(floored).toEqual({ belowFloor: true });
    expect(Object.keys(floored)).toEqual(['belowFloor']);
  });

  it('answers 4 below the floor with no value key at all', () => {
    expect(JSON.stringify(floorCount(4))).toBe('{"belowFloor":true}');
  });

  it('answers 5 as its value', () => {
    expect(floorCount(5)).toEqual({ belowFloor: false, value: 5 });
  });
});

describe('floorBands (EP-45, EP-46, EP-47)', () => {
  it('EP-45: merges the viewers by band into groups of 5 or more that sum to 16', () => {
    const groups = floorBands(BANDS(2, 7, 6, 1, 0, 0));
    expect(groups).toEqual([
      { bands: ['new', 'superfan'], count: { belowFloor: false, value: 9 } },
      {
        bands: ['engaged', 'occasional', 'at_risk', 'inactive'],
        count: { belowFloor: false, value: 7 },
      },
    ]);
    const values = groups.map((group) => (group.count.belowFloor ? 0 : group.count.value));
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(16);
    for (const value of values) expect(value).toBeGreaterThanOrEqual(PRIVACY_FLOOR);
    expect(groups.flatMap((group) => group.bands).sort()).toEqual(
      [...ENGAGEMENT_BAND_ORDER].sort(),
    );
  });

  it('EP-46: an all-zero split is no group at all', () => {
    expect(floorBands(BANDS(0, 0, 0, 0, 0, 0))).toEqual([]);
  });

  it('a whole base under the floor is one group of every band, floored', () => {
    expect(floorBands(BANDS(1, 0, 1, 0, 1, 0))).toEqual([
      { bands: [...ENGAGEMENT_BAND_ORDER], count: { belowFloor: true } },
    ]);
  });

  it('EP-47: shown groups come by value desc', () => {
    const groups = floorBands(BANDS(10, 30, 20, 40, 5, 6));
    expect(groups.map((group) => group.bands)).toEqual([
      ['occasional'],
      ['superfan'],
      ['engaged'],
      ['new'],
      ['inactive'],
      ['at_risk'],
    ]);
  });

  it('never sends a merged number below the floor beside a shown total', () => {
    const json = JSON.stringify(floorBands(BANDS(3, 40, 2, 50, 1, 60)));
    expect(json).not.toMatch(/"value":[1-4]\b/);
  });
});

describe('sortFloored (EP-47: the client order stays true)', () => {
  it('puts shown rows first by value desc and floored rows after them, in their order', () => {
    const rows = [
      { id: 'a', members: floorCount(3) },
      { id: 'b', members: floorCount(7) },
      { id: 'c', members: floorCount(0) },
      { id: 'd', members: floorCount(12) },
      { id: 'e', members: floorCount(1) },
    ];
    expect(sortFloored(rows, (row) => row.members).map((row) => row.id)).toEqual([
      'd',
      'b',
      'c',
      'a',
      'e',
    ]);
  });
});
