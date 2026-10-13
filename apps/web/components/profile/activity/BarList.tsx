import { Card, cn } from '@rede-social/ui';
import { ACTIVITY_SURFACE } from './KpiCard';
import { barPercent } from './scale';

export interface BarRow {
  id: string;
  label: string;
  value: number;
  /** The visible value, formatted by the host. */
  display: string;
  highlight?: boolean;
}

/**
 * "Onde você mais participa" (2026-10-13, ported from the rede-social-dashboard preview's `BarList`,
 * without its grow-in motion): horizontal bars drawn to scale against the largest value. The rows
 * share one grid (each row a subgrid), so every track starts and ends at the same x whatever its
 * value label, and the label column wraps instead of pushing the row wider than a phone. The
 * highlighted bar is the full brand token, the others a lighter tint. Props only.
 */
export function BarList({ rows }: { rows: readonly BarRow[] }) {
  const top = Math.max(0, ...rows.map((row) => row.value));
  return (
    <Card className={cn(ACTIVITY_SURFACE, 'p-4')}>
      <ul
        data-activity-bars
        className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-x-3 gap-y-3.5"
      >
        {rows.map((row) => (
          <li key={row.id} className="col-span-3 grid grid-cols-subgrid items-center text-sm">
            <span
              className={cn(
                'min-w-0 [overflow-wrap:anywhere]',
                row.highlight ? 'font-bold text-text' : 'text-text-secondary',
              )}
            >
              {row.label}
            </span>
            <span className="block h-2 overflow-hidden rounded-full bg-bg-tertiary">
              <span
                data-bar-fill
                className={cn(
                  'block h-full rounded-full',
                  row.highlight ? 'bg-brand' : 'bg-brand/45',
                )}
                style={{ width: `${barPercent(row.value, top)}%` }}
              />
            </span>
            <span className="text-right font-bold text-text tabular-nums">{row.display}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
