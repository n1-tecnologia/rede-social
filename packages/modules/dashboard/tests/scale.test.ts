import { describe, expect, it } from 'vitest';
import {
  barPercent,
  HEAT_BUCKETS,
  heatBucket,
  linearPoints,
  niceBounds,
  pathFrom,
} from '../ui/scale';

describe('linearPoints', () => {
  it('spaces x evenly and inverts y (the max sits at the top)', () => {
    const points = linearPoints([0, 5, 10], 100, 50);
    expect(points.map((p) => p.x)).toEqual([0, 50, 100]);
    expect(points.map((p) => p.y)).toEqual([50, 25, 0]);
  });

  it('honours the padding and a shared bounds', () => {
    const points = linearPoints(
      [10, 20],
      120,
      60,
      { top: 10, right: 10, bottom: 10, left: 10 },
      {
        lo: 0,
        hi: 40,
      },
    );
    expect(points[0]).toEqual({ x: 10, y: 10 + 40 * (1 - 10 / 40) });
    expect(points[1]).toEqual({ x: 110, y: 10 + 40 * (1 - 20 / 40) });
  });

  it('a flat series and a single point never divide by zero', () => {
    for (const p of [...linearPoints([7, 7, 7], 100, 50), ...linearPoints([3], 100, 50)]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(linearPoints([3], 100, 50)[0]?.x).toBe(50);
    expect(linearPoints([], 100, 50)).toEqual([]);
  });
});

describe('pathFrom', () => {
  it('moves to the first point and draws lines to the rest', () => {
    expect(
      pathFrom([
        { x: 0, y: 1 },
        { x: 2.25, y: 3 },
      ]),
    ).toBe('M0.0,1.0 L2.3,3.0');
  });
});

describe('niceBounds', () => {
  it('floors the min and ceils the max to the step', () => {
    expect(niceBounds([6, 12], 2)).toEqual({ lo: 6, hi: 12 });
    expect(niceBounds([280, 425], 50)).toEqual({ lo: 250, hi: 450 });
  });
});

describe('barPercent', () => {
  it('is value / max * 100, clamped to [0, 100]', () => {
    expect(barPercent(5230, 5230)).toBe(100);
    expect(barPercent(410, 5230)).toBeCloseTo((410 / 5230) * 100);
    expect(barPercent(150, 100)).toBe(100);
    expect(barPercent(-1, 100)).toBe(0);
  });

  it('is 0 when max is 0', () => {
    expect(barPercent(3, 0)).toBe(0);
  });
});

describe('heatBucket', () => {
  it('is monotonic: a higher percent never gets a lighter bucket', () => {
    let previous = -1;
    for (let v = 0; v <= 100; v += 1) {
      const index = HEAT_BUCKETS.indexOf(heatBucket(v));
      expect(index, String(v)).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
  });

  it('spans the whole set and puts on-brand ink on the strongest bucket only', () => {
    expect(heatBucket(0)).toBe(HEAT_BUCKETS[0]);
    expect(heatBucket(100)).toBe(HEAT_BUCKETS.at(-1));
    expect(HEAT_BUCKETS.at(-1)).toContain('text-on-brand');
    for (const bucket of HEAT_BUCKETS.slice(0, -1)) expect(bucket).not.toContain('text-on-brand');
  });
});
