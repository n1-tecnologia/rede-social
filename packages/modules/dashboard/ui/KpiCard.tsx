import { Card, cn } from '@rede-social/ui';
import { ArrowDown, ArrowUp, ArrowUpRight, type LucideIcon, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { CountUp } from './CountUp';
import { LIFT, RISE, SURFACE } from './surface';

export type KpiDirection = 'up' | 'down' | 'flat';
export type KpiTone = 'success' | 'danger' | 'neutral';

export interface KpiDelta {
  /** The whole change, already formatted by the host ("2 vs. mês anterior"). */
  text: string;
  /**
   * The bare change ("2"). With it the card shows a compact chip and keeps `text` for the tooltip
   * and for screen readers; without it (a hint such as "sem comparação ainda") `text` shows as is.
   */
  amount?: string;
  /** The arrow: what the number did. */
  direction: KpiDirection;
  /** Supplemental colour: whether the change is good news. */
  tone: KpiTone;
  /** Screen-reader word for the tone ("melhorou"), so the meaning never rests on colour alone. */
  sentiment?: string;
}

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Small text after the value ("de 1 GB"). */
  unit?: string;
  delta?: KpiDelta;
  note?: string;
  /** A slot under the numbers, for a `Sparkline` or a `LineChart`. */
  chart?: ReactNode;
  /** `side`: from a 56rem container the chart takes the card's right side (a wide card). */
  chartPlacement?: 'below' | 'side';
  /** `missing`: a metric the app cannot measure yet — dashed border, muted value. */
  variant?: 'default' | 'missing';
  /** A small neutral tag at the end of the card's top row ("exemplo"), worded by the host. */
  badge?: string;
  /** A last line under everything. */
  footer?: ReactNode;
  /** A glyph in a tinted tile that leads the card, the label beside it. */
  icon?: LucideIcon;
  /**
   * The card is the content of a link the host draws around it (with `group/link`): it lifts on
   * hover, shows a corner arrow, and this verb ("Ver lista") is read after the card's content.
   */
  linked?: string;
}

const DIRECTION_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus } as const;

const TONE_TEXT: Record<KpiTone, string> = {
  success: 'text-success',
  danger: 'text-danger',
  neutral: 'text-text-tertiary',
};

const TONE_CHIP: Record<KpiTone, string> = {
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  neutral: 'bg-bg-tertiary text-text-secondary',
};

/**
 * The change: a compact chip (arrow + amount) when the host gives the bare amount, the whole
 * sentence in its tooltip and for screen readers; the sentence as a muted line otherwise.
 */
function Delta({ delta }: { delta: KpiDelta }) {
  const Arrow = DIRECTION_ICON[delta.direction];
  if (delta.amount === undefined) {
    return (
      <span className={cn('flex items-center gap-1 text-xs font-semibold', TONE_TEXT[delta.tone])}>
        <Arrow aria-hidden size={13} className="shrink-0" />
        <span>{delta.text}</span>
        {delta.sentiment ? <span className="sr-only">{delta.sentiment}</span> : null}
      </span>
    );
  }
  return (
    <span
      title={delta.text}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums',
        TONE_CHIP[delta.tone],
      )}
    >
      <Arrow aria-hidden size={12} strokeWidth={2.6} className="shrink-0" />
      <span aria-hidden>{delta.amount}</span>
      <span className="sr-only">{delta.text}</span>
      {delta.sentiment ? <span className="sr-only">{delta.sentiment}</span> : null}
    </span>
  );
}

/**
 * One key number, in the panels' card: the top row is the icon tile (optional) with the label
 * beside it, then the host's tag and, on a linked card, a corner arrow. The value carries its change
 * beside it; an optional note (two lines at most), the chart slot and the footer close the card.
 * The module holds no words, no clock and no route (MOD-02, PWA-03): every string arrives formatted
 * from the web tier. Direction is an arrow icon; the tone colour only supplements it and
 * `sentiment` repeats it for screen readers.
 *
 * Motion: the card rises in when it scrolls into view (after its grid's stagger delay) and its value
 * counts up from zero (`CountUp`); a linked card lifts with a brand glow on hover, its icon tile
 * fills with the brand and its arrow nudges. None of it under reduced motion.
 */
export function KpiCard({
  label,
  value,
  unit,
  delta,
  note,
  chart,
  chartPlacement = 'below',
  variant = 'default',
  badge,
  footer,
  icon: Icon,
  linked,
}: KpiCardProps) {
  const missing = variant === 'missing';
  const side = chart !== undefined && chartPlacement === 'side';
  const rootClass = cn(
    SURFACE,
    RISE,
    'relative flex min-w-0 flex-col gap-2.5 p-3 [overflow-wrap:anywhere] @3xl:p-4',
    linked && LIFT,
    missing && 'border-dashed border-border-secondary bg-transparent shadow-none',
  );

  const tag = badge ? (
    <span className="shrink-0 rounded-full bg-bg-tertiary px-2 py-0.5 text-[0.6875rem] font-semibold text-text-tertiary">
      {badge}
    </span>
  ) : null;
  const arrow = linked ? (
    <>
      <ArrowUpRight
        aria-hidden
        size={16}
        className="shrink-0 text-text-tertiary transition-[color,transform] duration-300 ease-out group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-brand motion-reduce:transition-none"
      />
      <span className="sr-only">{linked}</span>
    </>
  ) : null;
  const top = (
    <div className="flex min-w-0 items-center gap-2.5">
      {Icon ? (
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors duration-300 group-hover/link:bg-brand group-hover/link:text-on-brand motion-reduce:transition-none"
        >
          <Icon size={16} strokeWidth={2.2} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 hyphens-auto text-xs font-semibold leading-snug text-text-secondary">
        {label}
      </span>
      {tag}
      {arrow}
    </div>
  );

  // A value written as a phrase ("Todos, exceto menos de 5") reads at a smaller size than a figure.
  const phrase = typeof value === 'string' && value.length > 14;
  const valueRow = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={cn(
          'font-extrabold tabular-nums leading-tight tracking-tight',
          missing
            ? 'text-base text-text-tertiary'
            : phrase
              ? 'text-lg text-text'
              : 'text-2xl text-text',
        )}
      >
        {typeof value === 'string' && !missing ? <CountUp value={value} /> : value}
        {unit ? (
          <span className="ml-1 text-sm font-semibold tracking-normal text-text-tertiary">
            {unit}
          </span>
        ) : null}
      </span>
      {delta ? <Delta delta={delta} /> : null}
    </div>
  );

  // At most two lines, so a row of cards keeps one height; the whole note is in the tooltip.
  const noteLine = note ? (
    <span title={note} className="line-clamp-2 text-xs text-text-tertiary">
      {note}
    </span>
  ) : null;

  if (side) {
    return (
      <Card data-kpi-card className={cn(rootClass, '@4xl:flex-row @4xl:items-stretch @4xl:gap-6')}>
        <div className="flex min-w-0 flex-col gap-2 @4xl:w-56 @4xl:shrink-0">
          {top}
          {valueRow}
          {noteLine}
          {footer ? <div className="mt-auto pt-1">{footer}</div> : null}
        </div>
        <div className="min-w-0 @4xl:flex-1 @4xl:self-center">{chart}</div>
      </Card>
    );
  }

  return (
    <Card data-kpi-card className={rootClass}>
      {top}
      {valueRow}
      {noteLine}
      {chart ? <div className="mt-0.5">{chart}</div> : null}
      {footer ? <div className="mt-auto pt-0.5">{footer}</div> : null}
    </Card>
  );
}

export interface KpiGridProps {
  children: ReactNode;
  className?: string;
}

/**
 * The KPI row as a WRAPPING grid: exactly two columns at 360–430 px, more on wider screens, never a
 * sideways-scrolling strip (vertical scroll only). From a 56rem container (the web layout) the cards
 * are at least 11rem and the row has no empty tracks (`auto-fit`): the cards share the whole width,
 * and a compact amount such as "R$ 14,4 mil" (non-breaking spaces) keeps to one line. The grid
 * staggers its cards' entrance.
 */
export function KpiGrid({ children, className }: KpiGridProps) {
  return (
    <div
      data-dash-stagger
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 @4xl:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]',
        className,
      )}
    >
      {children}
    </div>
  );
}
