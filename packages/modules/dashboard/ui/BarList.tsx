import { Card, cn } from '@rede-social/ui';
import type { ReactNode } from 'react';
import { CountUp } from './CountUp';
import { barPercent } from './scale';
import { RISE, SURFACE } from './surface';

export interface BarRow {
  id: string;
  label: string;
  value: number;
  /** The visible value, formatted by the host. */
  display: string;
  highlight?: boolean;
  /** Optional secondary figure after the value (a funnel's "% of the previous step"). */
  rate?: string;
  /**
   * A decorative visual before the name (an event's cover thumbnail). All rows of a list have one or
   * none: with equal-width visuals every track still starts and ends at the same x.
   */
  leading?: ReactNode;
  /** The row's own id, so a link elsewhere can land on it (an event's waiting-list row). */
  anchor?: string;
}

export interface BarListProps {
  rows: readonly BarRow[];
  /** The 100% mark; defaults to the largest value. */
  max?: number;
  /**
   * Stack each row (name and value, the rate under the value, then a full-width bar) even without a
   * `leading` visual: for long values and rates that would squeeze the bar at 360 px.
   */
  stacked?: boolean;
  className?: string;
}

function labelClass(row: BarRow) {
  return cn(
    'min-w-0 [overflow-wrap:break-word]',
    row.highlight ? 'font-bold text-text' : 'text-text-secondary',
  );
}

function Track({ row, top }: { row: BarRow; top: number }) {
  return (
    <span className="block h-2 overflow-hidden rounded-full bg-bg-tertiary">
      <span
        data-bar-fill
        className={cn(
          'dash-grow block h-full origin-left rounded-full',
          row.highlight ? 'bg-brand' : 'bg-brand/50',
        )}
        style={{ width: `${barPercent(row.value, top)}%` }}
      />
    </span>
  );
}

/**
 * Horizontal bars drawn to scale (`barPercent`), in the panels' card. The rows share one grid (each
 * row a subgrid), so every track starts and ends at the same x whatever its value label. The label
 * column wraps instead of pushing the row wider than a 360 px screen. The highlighted bar is the full
 * brand token, the others a lighter tint. Rows with a `leading` visual (or a `stacked` list) stack
 * instead: the visual, then the name and value over a full-width track, because a fourth grid column
 * would leave the name no room at 360 px. When the card is revealed each bar grows from the left, one
 * row after the other, and its value counts up (not under reduced motion).
 */
export function BarList({ rows, max, stacked = false, className }: BarListProps) {
  const top = max ?? Math.max(0, ...rows.map((row) => row.value));
  if (stacked || rows.some((row) => row.leading !== undefined)) {
    return (
      <Card className={cn(SURFACE, RISE, 'p-4', className)}>
        <ul data-dash-stagger className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              id={row.anchor}
              className={cn(
                'flex items-center gap-3 text-sm',
                row.anchor &&
                  'scroll-mt-20 rounded-md target:bg-brand/10 target:ring-2 target:ring-brand/40',
              )}
            >
              {row.leading}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className={labelClass(row)}>{row.label}</span>
                  <span className="shrink-0 text-right font-bold tabular-nums text-text">
                    <CountUp value={row.display} />
                    {row.rate ? (
                      <span className="block text-xs font-semibold text-text-tertiary">
                        {row.rate}
                      </span>
                    ) : null}
                  </span>
                </div>
                <Track row={row} top={top} />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    );
  }
  return (
    <Card className={cn(SURFACE, RISE, 'p-4', className)}>
      <ul
        data-dash-stagger
        className="grid grid-cols-[minmax(min-content,2fr)_minmax(0,3fr)_auto] gap-x-2 gap-y-3"
      >
        {rows.map((row) => (
          <li
            key={row.id}
            id={row.anchor}
            className={cn(
              'col-span-3 grid grid-cols-subgrid items-center text-sm',
              row.anchor &&
                'scroll-mt-20 rounded-md target:bg-brand/10 target:ring-2 target:ring-brand/40',
            )}
          >
            <span className={labelClass(row)}>{row.label}</span>
            <Track row={row} top={top} />
            <span className="text-right font-bold tabular-nums text-text">
              <CountUp value={row.display} />
              {row.rate ? (
                <span className="ml-1 text-xs font-semibold text-text-tertiary">{row.rate}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
