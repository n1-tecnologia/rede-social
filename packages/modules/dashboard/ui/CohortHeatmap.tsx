import { Card, cn } from '@rede-social/ui';
import type { CSSProperties } from 'react';
import { CountUp } from './CountUp';
import { heatBucket } from './scale';
import { RISE, SURFACE } from './surface';

export interface CohortRow {
  label: string;
  /** 0–100 per period after joining; `null` where the cohort has not lived that long yet. */
  values: readonly (number | null)[];
}

export interface CohortHeatmapProps {
  /** The table's accessible name (a visually hidden caption). */
  caption: string;
  /** The top-left header (may be empty). */
  corner: string;
  columns: readonly string[];
  rows: readonly CohortRow[];
  formatValue: (value: number) => string;
}

/**
 * Retention by cohort as a real table: one row per joining month, one column per month after it.
 * Each cell is tinted by a fixed brand bucket (`heatBucket`) AND prints its value, so colour is never
 * the only signal; an empty cohort cell stays empty. When the card is revealed the cells pop in along
 * the diagonal and their values count up (not under reduced motion).
 */
export function CohortHeatmap({ caption, corner, columns, rows, formatValue }: CohortHeatmapProps) {
  return (
    <Card className={cn(SURFACE, RISE, 'p-3')}>
      <table className="w-full table-fixed border-separate border-spacing-1 text-center text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="font-semibold text-text-tertiary">
              {corner}
            </th>
            {columns.map((column) => (
              <th key={column} scope="col" className="font-semibold text-text-tertiary">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.label}>
              <th scope="row" className="font-semibold text-text-tertiary">
                {row.label}
              </th>
              {columns.map((column, i) => {
                const value = row.values[i];
                const empty = value === null || value === undefined;
                return (
                  <td
                    key={column}
                    className={cn(
                      'rounded-md py-2 font-bold tabular-nums',
                      empty ? '' : cn('dash-cell', heatBucket(value)),
                    )}
                    style={empty ? undefined : ({ '--i': r + i } as CSSProperties)}
                  >
                    {empty ? null : <CountUp value={formatValue(value)} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
