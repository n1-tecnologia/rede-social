/**
 * Pure geometry for the panel charts: every mark is drawn to scale from the data (never by eye), and
 * a degenerate series (one point, a flat line, a zero max) never divides by zero.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  lo: number;
  hi: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_PADDING: Padding = { top: 0, right: 0, bottom: 0, left: 0 };

/** The axis range: the data's min and max floored / ceiled to `step` (one shared scale per chart). */
export function niceBounds(values: readonly number[], step: number): Bounds {
  if (values.length === 0) return { lo: 0, hi: step };
  const lo = Math.floor(Math.min(...values) / step) * step;
  const hi = Math.ceil(Math.max(...values) / step) * step;
  // A flat series (every week 0, say) keeps one step of range: three distinct ticks, a real axis.
  return { lo, hi: hi > lo ? hi : lo + step };
}

/**
 * Evenly spaced x, y inverted (SVG grows downwards), inside `width` x `height` minus the padding.
 * Without `bounds` the series' own min/max is the range (a sparkline).
 */
export function linearPoints(
  values: readonly number[],
  width: number,
  height: number,
  padding: Padding = NO_PADDING,
  bounds?: Bounds,
): Point[] {
  if (values.length === 0) return [];
  const lo = bounds?.lo ?? Math.min(...values);
  const hi = bounds?.hi ?? Math.max(...values);
  const range = hi - lo || 1;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const last = values.length - 1;
  return values.map((value, i) => ({
    x: padding.left + (last === 0 ? innerW / 2 : (i * innerW) / last),
    y: padding.top + innerH * (1 - (value - lo) / range),
  }));
}

/** `M x,y L x,y …` with one decimal. */
export function pathFrom(points: readonly Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
}

/** A bar's fill as a percent of `max`, clamped to [0, 100]; 0 when `max` is not positive. */
export function barPercent(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/**
 * The cohort heatmap's fixed set of brand tints, weakest first (static class strings, so Tailwind
 * generates them). Only the strongest switches to the on-brand ink; every cell also prints its value.
 */
export const HEAT_BUCKETS = [
  'bg-brand/5 text-text',
  'bg-brand/15 text-text',
  'bg-brand/25 text-text',
  'bg-brand/40 text-text',
  'bg-brand/55 text-text',
  'bg-brand text-on-brand',
] as const;

const HEAT_THRESHOLDS = [20, 40, 50, 60, 90];

/** A 0–100 percent -> its bucket; monotonic (a higher percent never gets a lighter tint). */
export function heatBucket(percent: number): (typeof HEAT_BUCKETS)[number] {
  const index = HEAT_THRESHOLDS.filter((threshold) => percent >= threshold).length;
  return HEAT_BUCKETS[index] ?? HEAT_BUCKETS[0];
}
