import { linearPoints, niceBounds, pathFrom } from './scale';

/** The plot's own units: x and y in percent of the plot, which stretches to the chart's width. */
const VIEW = 100;
/** Percent of the width kept free on the left for the y ticks, and on the right for the last dot. */
const INSET = { left: 9, right: 3 };
const PLOT_PADDING = { top: 0, right: INSET.right, bottom: 0, left: INSET.left };
/** Pixels above the top tick, and under the plot for the x labels. */
const TOP = 10;
const BOTTOM = 24;
const LABEL_SIZE = 11;
/** Close to a phone card's content width, in pixels: the narrowest the chart is drawn. */
const NARROWEST = 340;

/** A point of a series; `null` is a point with no value, drawn as a gap, never as 0 (UI-D-481). */
export type ChartValue = number | null;

export interface LineChartProps {
  series: readonly ChartValue[];
  /** The previous period, same length: drawn dashed on the SAME y-scale. */
  previous?: readonly ChartValue[];
  /** One per point; an empty string draws no label at that point. */
  xLabels: readonly string[];
  /** The axis is floored / ceiled to this step. */
  yStep: number;
  formatValue: (value: number) => string;
  ariaLabel: string;
  /** The chart's height in pixels: the width follows the card, the height never does. */
  height?: number;
}

/** A short, stable id for the area's gradient, from the chart's own label and data. */
function gradientId(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33) ^ seed.charCodeAt(i);
  return `dash-area-${(hash >>> 0).toString(36)}`;
}

/** Gap, in pixels at the narrowest width, the label before the end-anchored last one must keep. */
const LABEL_GAP = 4;

function labelWidth(label: string): number {
  return label.length * LABEL_SIZE * 0.6;
}

/**
 * The index of the label to skip: the last label ends at the last point, so the label before it
 * may touch it (the platform level's "set" and "out", quick 261013-uoi C-2). Only that one drops.
 */
function crowdedLabel(points: readonly { x: number }[], xLabels: readonly string[]): number | null {
  const lastIndex = points.length - 1;
  const lastLabel = xLabels[lastIndex];
  const lastPoint = points[lastIndex];
  if (!lastLabel || !lastPoint) return null;
  for (let i = lastIndex - 1; i >= 0; i -= 1) {
    const label = xLabels[i];
    const point = points[i];
    if (!label || !point) continue;
    const right = point.x + labelWidth(label) / 2 + LABEL_GAP;
    return right > lastPoint.x - labelWidth(lastLabel) ? i : null;
  }
  return null;
}

type Point = { x: number; y: number };

/** The defined values of a series (a gap has none). */
function defined(values: readonly ChartValue[]): number[] {
  return values.filter((value): value is number => value !== null);
}

/** Each value's point, `null` for a gap: x evenly spaced over every slot, gaps included. */
function pointsOf(
  values: readonly ChartValue[],
  bounds: { lo: number; hi: number },
): (Point | null)[] {
  const all = linearPoints(
    values.map((value) => value ?? bounds.lo),
    VIEW,
    VIEW,
    PLOT_PADDING,
    bounds,
  );
  return all.map((point, i) => (values[i] === null ? null : point));
}

/** The runs of consecutive defined points: a gap ends one run and starts the next. */
function runsOf(points: readonly (Point | null)[]): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const point of points) {
    if (point === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push(point);
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/** One `M … L …` subpath per run. */
function linePath(runs: readonly Point[][]): string {
  return runs.map((run) => pathFrom(run)).join(' ');
}

/** The area under each run, closed to the plot's floor. */
function areaPath(runs: readonly Point[][]): string {
  return runs
    .map((run) => {
      const first = run[0];
      const last = run.at(-1);
      if (!first || !last) return '';
      return `${pathFrom(run)} L${last.x.toFixed(1)},${VIEW} L${first.x.toFixed(1)},${VIEW} Z`;
    })
    .join(' ');
}

/**
 * A line on one shared y-scale (the bounds come from the union of both series, so the dashed
 * previous period is comparable to the current one by eye), three labelled ticks, a soft gradient
 * area and a haloed dot on the last point. Colours are tokens through `currentColor`: the series in
 * brand, the previous period in the tertiary text token, the grid in the divider token. No words of
 * its own.
 *
 * Proportional at any width: the chart has a fixed pixel height and the full width of its card. Only
 * the plot (lines and area, in their own percent units) stretches, with strokes that keep their width
 * (`non-scaling-stroke`); the labels and the dot are drawn in pixels, so text never grows or
 * distorts. When its card is revealed it sweeps in from the left and the last dot pops after it
 * (not under reduced motion).
 */
export function LineChart({
  series,
  previous,
  xLabels,
  yStep,
  formatValue,
  ariaLabel,
  height = 180,
}: LineChartProps) {
  const bounds = niceBounds([...defined(series), ...defined(previous ?? [])], yStep);
  const plotHeight = Math.max(1, height - TOP - BOTTOM);
  const norm = (value: number) => (value - bounds.lo) / (bounds.hi - bounds.lo || 1);
  /** A value's y in the plot's own units (0 at the top, VIEW at the bottom). */
  const yView = (value: number) => VIEW * (1 - norm(value));
  /** The same y in the chart's pixels, for what must not stretch (text, the dot). */
  const yPx = (value: number) => TOP + plotHeight * (1 - norm(value));
  const slots = pointsOf(series, bounds);
  const runs = runsOf(slots);
  const previousRuns = previous ? runsOf(pointsOf(previous, bounds)) : null;
  // The dot sits on the last DEFINED point: a series ending in a gap has no value there.
  let lastIndex = series.length - 1;
  while (lastIndex >= 0 && series[lastIndex] === null) lastIndex -= 1;
  const last = lastIndex >= 0 ? slots[lastIndex] : undefined;
  const lastValue = lastIndex >= 0 ? series[lastIndex] : undefined;
  // Every slot keeps its x (gaps included), so the labels stay under their points.
  const points = linearPoints(
    series.map(() => bounds.lo),
    VIEW,
    VIEW,
    PLOT_PADDING,
    bounds,
  );
  const ticks = [bounds.lo, (bounds.lo + bounds.hi) / 2, bounds.hi];
  // The labels are judged at a phone card's width, where they are closest.
  const hidden = crowdedLabel(
    points.map((point) => ({ x: (point.x * NARROWEST) / VIEW })),
    xLabels,
  );
  const fillId = gradientId(`${ariaLabel}|${series.join(',')}`);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width="100%"
      height={height}
      className="dash-sweep block overflow-visible"
    >
      <svg
        aria-hidden
        x="0"
        y={TOP}
        width="100%"
        height={plotHeight}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="none"
        overflow="visible"
      >
        <defs>
          <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1" className="text-brand">
            <stop offset="0" stopColor="currentColor" stopOpacity={0.22} />
            <stop offset="1" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <line
            key={tick}
            x1={INSET.left}
            x2={VIEW - INSET.right}
            y1={yView(tick)}
            y2={yView(tick)}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray={tick === bounds.lo ? undefined : '3 4'}
            vectorEffect="non-scaling-stroke"
            className="text-divider"
          />
        ))}
        {runs.length > 0 ? (
          <path
            data-series="area"
            d={areaPath(runs)}
            fill={`url(#${fillId})`}
            stroke="none"
            className="text-brand"
          />
        ) : null}
        {previousRuns && previousRuns.length > 0 ? (
          <path
            data-series="previous"
            d={linePath(previousRuns)}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
            className="text-text-tertiary"
          />
        ) : null}
        <path
          data-series="current"
          d={linePath(runs)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="text-brand"
        />
      </svg>
      {ticks.map((tick) => (
        <text
          data-tick
          key={tick}
          x="0"
          y={yPx(tick) + 4}
          fontSize={LABEL_SIZE}
          className="fill-current text-text-tertiary"
        >
          {formatValue(tick)}
        </text>
      ))}
      {last && typeof lastValue === 'number' ? (
        <g className="dash-pop [transform-box:fill-box] [transform-origin:center]">
          <circle
            cx={`${last.x}%`}
            cy={yPx(lastValue)}
            r={9}
            fill="currentColor"
            fillOpacity={0.15}
            className="text-brand"
          />
          <circle
            data-last-point
            cx={`${last.x}%`}
            cy={yPx(lastValue)}
            r={4.5}
            fill="currentColor"
            strokeWidth={2}
            className="stroke-card text-brand"
          />
        </g>
      ) : null}
      {points.map((point, i) =>
        xLabels[i] && i !== hidden ? (
          <text
            data-x-label
            // biome-ignore lint/suspicious/noArrayIndexKey: one label per fixed point position
            key={i}
            x={`${point.x}%`}
            y={height - 6}
            // The last label ends at the last point, so it never runs past the chart.
            textAnchor={i === points.length - 1 ? 'end' : 'middle'}
            fontSize={LABEL_SIZE}
            className="fill-current text-text-tertiary"
          >
            {xLabels[i]}
          </text>
        ) : null,
      )}
    </svg>
  );
}
