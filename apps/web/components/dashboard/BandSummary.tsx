import { barPercent, percentOf } from '@rede-social/module-dashboard/ui';
import { cn } from '@rede-social/ui';
import type { EngagementBand } from '@/lib/owner-band-scope';
import { type DashboardT, formatCount, formatPercent } from './format';

/*
 * A band's count and share (08.7-05: out of BandMembers.tsx, so the Conteúdo and Financeiro areas
 * that draw it do not import the Membros list island and its server action).
 */

/**
 * A band's share of the scope: "menos de 1%" when it has members but rounds to 0% (A-1).
 * `Math.round` matches formatPercent's half-expand rounding.
 */
function bandShare(t: DashboardT, count: number, total: number): string {
  const percent = percentOf(count, total);
  return count > 0 && Math.round(percent) === 0
    ? t('tenantOwner.bandMembers.underOnePercent')
    : formatPercent(percent);
}

/**
 * A band's count and share with its mini bar. `label` replaces the default "N · P%" text (Conteúdo's
 * "41 membros · 43% da faixa", quick 261013-orf E-03.3); the bar stays. `barClassName` sizes the
 * bar (Membros widens it where its band rows read across the whole area).
 */
export function BandSummary({
  t,
  band,
  count,
  total,
  label,
  barClassName,
}: {
  t: DashboardT;
  band: EngagementBand;
  count: number;
  total: number;
  label?: string;
  barClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {label ??
        t('tenantOwner.bandMembers.summary', {
          count: formatCount(count),
          percent: bandShare(t, count, total),
        })}
      <span
        aria-hidden
        className={cn('block h-1.5 w-16 overflow-hidden rounded-full bg-bg-tertiary', barClassName)}
      >
        {/* min-w-1.5: a band with members never draws an empty bar (a 6 px dot at least). */}
        <span
          className={cn(
            'block h-full rounded-full',
            band === 'at_risk' ? 'bg-brand' : 'bg-brand/50',
            count > 0 && 'min-w-1.5',
          )}
          style={{ width: `${barPercent(count, total)}%` }}
        />
      </span>
    </span>
  );
}
