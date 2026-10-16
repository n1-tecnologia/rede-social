import { Card, cn } from '@rede-social/ui';
import { ArrowDown, ArrowUp, type LucideIcon, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The card surface of "Sua atividade" (2026-10-13, the rede-social-dashboard preview's `SURFACE`): a
 * 16px radius, a hairline border and a soft shadow in the ink the app's own cards use.
 */
export const ACTIVITY_SURFACE =
  'rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(22,35,59,0.04),0_6px_18px_-10px_rgba(22,35,59,0.1)]';

export interface KpiDelta {
  /** The whole change, formatted by the host ("8 vs. semana anterior"): tooltip and screen readers. */
  text: string;
  /** The bare change ("8"), drawn in the chip. */
  amount: string;
  /** The arrow: what the number did. */
  direction: 'up' | 'down' | 'flat';
}

export interface KpiCardProps {
  label: string;
  value: string;
  /** Small text after the value ("min", "posts"). */
  unit?: string;
  delta?: KpiDelta;
  /** A glyph in a tinted tile that leads the card, the label beside it. */
  icon?: LucideIcon;
  /** A slot under the numbers, for a `LineChart`. */
  chart?: ReactNode;
  /** A last line under everything. */
  footer?: ReactNode;
}

const DIRECTION_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus } as const;

/**
 * One number of "Sua atividade", ported from the rede-social-dashboard preview's `KpiCard` (without
 * its entrance and count-up motion, the drill-down link or the tags): the icon tile with the label
 * beside it, then the value with its unit and its change as a neutral chip (the report describes,
 * it never grades, so there is no good or bad colour). The chip shows the bare amount and keeps the
 * whole comparison in its tooltip and for screen readers. Props only, no words of its own.
 */
export function KpiCard({ label, value, unit, delta, icon: Icon, chart, footer }: KpiCardProps) {
  const Arrow = delta ? DIRECTION_ICON[delta.direction] : null;
  return (
    <Card
      data-activity-card
      className={cn(
        ACTIVITY_SURFACE,
        'relative flex min-w-0 flex-col gap-2.5 p-3.5 [overflow-wrap:anywhere]',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon ? (
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"
          >
            <Icon size={16} strokeWidth={2.2} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 hyphens-auto text-xs font-semibold leading-snug text-text-secondary">
          {label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          data-activity-value
          className="text-2xl font-extrabold leading-tight tracking-tight text-text tabular-nums"
        >
          {value}
          {unit ? (
            <span className="ml-1 text-sm font-semibold tracking-normal text-text-tertiary">
              {unit}
            </span>
          ) : null}
        </span>
        {delta && Arrow ? (
          <span
            title={delta.text}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-bg-tertiary px-1.5 py-0.5 text-xs font-bold text-text-secondary tabular-nums"
          >
            <Arrow aria-hidden size={12} strokeWidth={2.6} className="shrink-0" />
            <span aria-hidden>{delta.amount}</span>
            <span className="sr-only">{delta.text}</span>
          </span>
        ) : null}
      </div>
      {chart ? <div className="mt-0.5">{chart}</div> : null}
      {footer ? <div className="mt-auto pt-0.5">{footer}</div> : null}
    </Card>
  );
}

/**
 * The cards' grid: two columns at every width, the preview's 2 x 2 blocks (never a strip that
 * scrolls sideways).
 */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
