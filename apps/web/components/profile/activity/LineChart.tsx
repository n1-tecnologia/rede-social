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

export interface LineChartProps {
  series: readonly number[];
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
  return `activity-area-${(hash >>> 0).toString(36)}`;
}

/**
 * The "Tempo de uso" line (2026-10-13, ported from the rede-social-dashboard preview's `LineChart`,
 * without its sweep-in motion): one series on a y-scale floored and ceiled to `yStep`, three
 * labelled ticks, a soft gradient area and a haloed dot on the last point. Colours are tokens through
 * `currentColor`: the series in brand, the grid in the divider token. No words of its own: the ticks
 * and the x labels come formatted by the host, and the whole chart is ONE image named `ariaLabel`.
 *
 * The chart has a fixed pixel height and the full width of its card. Only the plot (in its own
 * percent units) stretches, with strokes that keep their width (`non-scaling-stroke`); the labels
 * and the dot are drawn in pixels, so text never grows or distorts.
 */
export function LineChart({
  series,
  xLabels,
  yStep,
  formatValue,
  ariaLabel,
  height = 180,
}: LineChartProps) {
  const bounds = niceBounds(series, yStep);
  const plotHeight = Math.max(1, height - TOP - BOTTOM);
  const norm = (value: number) => (value - bounds.lo) / (bounds.hi - bounds.lo || 1);
  /** A value's y in the plot's own units (0 at the top, VIEW at the bottom). */
  const yView = (value: number) => VIEW * (1 - norm(value));
  /** The same y in the chart's pixels, for what must not stretch (text, the dot). */
  const yPx = (value: number) => TOP + plotHeight * (1 - norm(value));
  const points = linearPoints(series, VIEW, VIEW, PLOT_PADDING, bounds);
  const first = points[0];
  const last = points.at(-1);
  const lastValue = series.at(-1);
  const ticks = [bounds.lo, (bounds.lo + bounds.hi) / 2, bounds.hi];
  const fillId = gradientId(`${ariaLabel}|${series.join(',')}`);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      data-activity-chart
      width="100%"
      height={height}
      className="block overflow-visible"
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
        {first && last ? (
          <path
            data-series="area"
            d={`${pathFrom(points)} L${last.x.toFixed(1)},${VIEW} L${first.x.toFixed(1)},${VIEW} Z`}
            fill={`url(#${fillId})`}
            stroke="none"
            className="text-brand"
          />
        ) : null}
        <path
          data-series="current"
          d={pathFrom(points)}
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
      {last && lastValue !== undefined ? (
        <g>
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
        xLabels[i] ? (
          <text
            data-x-label
            // biome-ignore lint/suspicious/noArrayIndexKey: one label per fixed point position
            key={i}
            x={`${point.x}%`}
            y={height - 6}
            textAnchor="middle"
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
