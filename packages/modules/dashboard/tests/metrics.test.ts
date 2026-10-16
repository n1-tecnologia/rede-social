import { describe, expect, it } from 'vitest';
import type { EngagementBands } from '../fixtures';
import {
  attendancePercent,
  type BandGroup,
  bandTotal,
  ENGAGEMENT_BAND_ORDER,
  engagedPercent,
  interactedCount,
  isBelowPrivacyFloor,
  mergeBandsBelowFloor,
  PRIVACY_FLOOR,
  percentOf,
  perItem,
  sumOf,
  topBy,
} from '../ui/metrics';

const SAMPLE: EngagementBands = {
  counts: { new: 96, superfan: 62, engaged: 205, occasional: 150, at_risk: 168, inactive: 559 },
  newActivated: 54,
};
const LARGE_BASE: EngagementBands = {
  counts: {
    new: 480,
    superfan: 380,
    engaged: 1440,
    occasional: 1340,
    at_risk: 1150,
    inactive: 3640,
  },
  newActivated: 296,
};
const SMALL_BASE: EngagementBands = {
  counts: { new: 22, superfan: 2, engaged: 8, occasional: 27, at_risk: 96, inactive: 155 },
  newActivated: 1,
};

describe('ENGAGEMENT_BAND_ORDER', () => {
  it('is the evaluation order of the exclusive bands', () => {
    expect(ENGAGEMENT_BAND_ORDER).toEqual([
      'new',
      'superfan',
      'engaged',
      'occasional',
      'at_risk',
      'inactive',
    ]);
  });
});

describe('bandTotal', () => {
  it('sums every band to the member base', () => {
    expect(bandTotal(SAMPLE)).toBe(1240);
    expect(bandTotal(LARGE_BASE)).toBe(8430);
    expect(bandTotal(SMALL_BASE)).toBe(310);
  });
});

describe('interactedCount', () => {
  it('counts superfãs + engajados + ocasionais + novos ativados', () => {
    expect(interactedCount(SAMPLE)).toBe(62 + 205 + 150 + 54);
    expect(interactedCount(SAMPLE)).toBe(471);
  });
});

describe('engagedPercent', () => {
  it('is superfãs + engajados over the base', () => {
    expect(engagedPercent(SAMPLE)).toBeCloseTo((267 / 1240) * 100, 10);
    expect(Math.round(engagedPercent(SAMPLE))).toBe(22);
  });

  it('is 0 for an empty base', () => {
    const empty: EngagementBands = {
      counts: { new: 0, superfan: 0, engaged: 0, occasional: 0, at_risk: 0, inactive: 0 },
      newActivated: 0,
    };
    expect(engagedPercent(empty)).toBe(0);
  });
});

describe('percentOf', () => {
  it('is part over whole as 0–100, unrounded', () => {
    expect(Math.round(percentOf(168, 1240))).toBe(14);
  });

  it('is 0 when the whole is not positive', () => {
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(5, -1)).toBe(0);
  });
});

describe('the privacy floor (D-02)', () => {
  it('hides any count under 5', () => {
    expect(PRIVACY_FLOOR).toBe(5);
    expect(isBelowPrivacyFloor(4)).toBe(true);
    expect(isBelowPrivacyFloor(0)).toBe(true);
    expect(isBelowPrivacyFloor(5)).toBe(false);
    expect(isBelowPrivacyFloor(37)).toBe(false);
  });
});

function bands(
  newCount: number,
  superfan: number,
  engaged: number,
  occasional: number,
  atRisk: number,
  inactive: number,
): EngagementBands {
  return {
    counts: { new: newCount, superfan, engaged, occasional, at_risk: atRisk, inactive },
    newActivated: 0,
  };
}

/** Every row ≥ the floor (unless it is the one all-bands row), rows sum to the base, band order kept. */
function expectSafeGroups(input: EngagementBands, groups: BandGroup[]) {
  expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(bandTotal(input));
  expect(groups.flatMap((group) => group.bands)).toEqual(ENGAGEMENT_BAND_ORDER);
  for (const group of groups) {
    expect(group.count).toBe(group.bands.reduce((sum, band) => sum + input.counts[band], 0));
    if (groups.length > 1) expect(group.count).toBeGreaterThanOrEqual(PRIVACY_FLOOR);
  }
}

describe('mergeBandsBelowFloor (C-1: no band derivable by subtraction)', () => {
  it('merges a small band with its smaller neighbour', () => {
    const groups = mergeBandsBelowFloor(SMALL_BASE);
    expect(groups).toEqual([
      { bands: ['new'], count: 22 },
      { bands: ['superfan', 'engaged'], count: 10 },
      { bands: ['occasional'], count: 27 },
      { bands: ['at_risk'], count: 96 },
      { bands: ['inactive'], count: 155 },
    ]);
    expectSafeGroups(SMALL_BASE, groups);
  });

  it('merges the first band with its only neighbour', () => {
    const input = bands(3, 10, 20, 30, 40, 50);
    const groups = mergeBandsBelowFloor(input);
    expect(groups).toEqual([
      { bands: ['new', 'superfan'], count: 13 },
      { bands: ['engaged'], count: 20 },
      { bands: ['occasional'], count: 30 },
      { bands: ['at_risk'], count: 40 },
      { bands: ['inactive'], count: 50 },
    ]);
    expectSafeGroups(input, groups);
  });

  it('merges the last band with its only neighbour', () => {
    const input = bands(10, 10, 20, 30, 40, 2);
    const groups = mergeBandsBelowFloor(input);
    expect(groups).toEqual([
      { bands: ['new'], count: 10 },
      { bands: ['superfan'], count: 10 },
      { bands: ['engaged'], count: 20 },
      { bands: ['occasional'], count: 30 },
      { bands: ['at_risk', 'inactive'], count: 42 },
    ]);
    expectSafeGroups(input, groups);
  });

  it('keeps merging until two small neighbours reach the floor', () => {
    const input = bands(40, 2, 1, 30, 50, 60);
    const groups = mergeBandsBelowFloor(input);
    expect(groups).toEqual([
      { bands: ['new'], count: 40 },
      { bands: ['superfan', 'engaged', 'occasional'], count: 33 },
      { bands: ['at_risk'], count: 50 },
      { bands: ['inactive'], count: 60 },
    ]);
    expectSafeGroups(input, groups);
  });

  it('leaves every band alone when all are at or above the floor', () => {
    for (const input of [SAMPLE, LARGE_BASE]) {
      const groups = mergeBandsBelowFloor(input);
      expect(groups).toEqual(
        ENGAGEMENT_BAND_ORDER.map((band) => ({ bands: [band], count: input.counts[band] })),
      );
      expectSafeGroups(input, groups);
    }
  });

  it('merges an empty band like any other small band', () => {
    const input = bands(20, 0, 30, 40, 50, 60);
    const groups = mergeBandsBelowFloor(input);
    expect(groups[0]).toEqual({ bands: ['new', 'superfan'], count: 20 });
    expect(groups).toHaveLength(5);
    expectSafeGroups(input, groups);
  });

  it('collapses a base under the floor into one row of all bands', () => {
    const input = bands(1, 0, 1, 0, 1, 0);
    expect(mergeBandsBelowFloor(input)).toEqual([{ bands: [...ENGAGEMENT_BAND_ORDER], count: 3 }]);
  });
});

describe('sumOf / perItem / attendancePercent (level 4, 261012-o00)', () => {
  it('sums the picked number of every row, 0 for no rows', () => {
    expect(sumOf([], (row: { n: number }) => row.n)).toBe(0);
    expect(sumOf([{ n: 2 }, { n: 3 }], (row) => row.n)).toBe(5);
  });

  it('rounds a total per item, 0 when there are no items', () => {
    expect(perItem(3940, 61)).toBe(65);
    expect(perItem(1650, 22)).toBe(75);
    expect(perItem(5, 0)).toBe(0);
  });

  it('is check-ins over confirmed RSVPs, unrounded, 0 for no events', () => {
    expect(attendancePercent([])).toBe(0);
    const past = [
      { confirmed: 100, checkIns: 82 },
      { confirmed: 148, checkIns: 86 },
      { confirmed: 50, checkIns: 32 },
      { confirmed: 61, checkIns: 30 },
    ];
    expect(attendancePercent(past)).toBeCloseTo((230 / 359) * 100, 10);
    expect(Math.round(attendancePercent(past))).toBe(64);
  });
});

describe('topBy (261012-oxi C-6: a highlight follows the values)', () => {
  it('gives undefined for no rows', () => {
    expect(topBy([], (row: { n: number }) => row.n)).toBeUndefined();
  });

  it('picks the highest score whatever the input order', () => {
    const rows = [
      { id: 'a', n: 3 },
      { id: 'b', n: 9 },
      { id: 'c', n: 5 },
    ];
    expect(topBy(rows, (row) => row.n)?.id).toBe('b');
    expect(topBy([...rows].reverse(), (row) => row.n)?.id).toBe('b');
  });

  it('keeps the earliest row on a tie', () => {
    const rows = [
      { id: 'a', n: 4 },
      { id: 'b', n: 7 },
      { id: 'c', n: 7 },
    ];
    expect(topBy(rows, (row) => row.n)?.id).toBe('b');
  });

  it('returns the largest of all-negative scores (no 0 seed)', () => {
    const rows = [
      { id: 'a', n: -8 },
      { id: 'b', n: -2 },
      { id: 'c', n: -5 },
    ];
    expect(topBy(rows, (row) => row.n)?.id).toBe('b');
  });
});
