/**
 * Pure geometry for the "Sua atividade" charts (2026-10-13, ported from the rede-social-dashboard
 * preview's `module-dashboard/ui/scale.ts`): every mark is drawn to scale from the data, and a
 * degenerate series (one point, a flat line, a zero max) never divides by zero.
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

/** The axis range: the data's min and max floored / ceiled to `step`. */
export function niceBounds(values: readonly number[], step: number): Bounds {
  if (values.length === 0) return { lo: 0, hi: step };
  return {
    lo: Math.floor(Math.min(...values) / step) * step,
    hi: Math.ceil(Math.max(...values) / step) * step,
  };
}

/**
 * Evenly spaced x, y inverted (SVG grows downwards), inside `width` x `height` minus the padding.
 * Without `bounds` the series' own min/max is the range.
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
