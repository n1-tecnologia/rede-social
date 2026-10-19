import type { Delta, EngagementBandId } from '@rede-social/module-dashboard/contracts';
import {
  isBelowPrivacyFloor,
  type KpiDelta,
  PRIVACY_FLOOR,
} from '@rede-social/module-dashboard/ui';
import type { getTranslations } from 'next-intl/server';

/**
 * The pt-BR formats of the client owner's panel on `/perfil` (2026-10-15): every number, date and
 * money value the panel shows goes through here, so the module's components stay free of words.
 */

/** The `dashboard` namespace translator (untyped catalog, as every `lib/*-view` module takes it). */
export type DashboardT = Awaited<ReturnType<typeof getTranslations>>;

const INTEGER = new Intl.NumberFormat('pt-BR');
const PERCENT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });
const PERCENT_1 = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

/** `8430` -> `8.430`. */
export function formatCount(value: number): string {
  return INTEGER.format(value);
}

/** A group total under the privacy floor reads "menos de 5", with no value (D-02). */
export function formatFloored(t: DashboardT, count: number): string {
  return isBelowPrivacyFloor(count)
    ? t('belowFloor', { floor: PRIVACY_FLOOR })
    : formatCount(count);
}

/** A 0–100 number -> `41%`. */
export function formatPercent(value: number): string {
  return PERCENT.format(value / 100);
}

/** A 0–1 ratio -> `62,5%` (one decimal at most). */
export function formatRatio(ratio: number): string {
  return PERCENT_1.format(ratio);
}

const SIGNED = new Intl.NumberFormat('pt-BR', { signDisplay: 'exceptZero' });

/** A signed count: `87` -> `+87`, `-3` -> `-3`, `0` -> `0`. */
export function formatSignedCount(value: number): string {
  return SIGNED.format(value);
}

const LIST = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' });

/** `['Feed', 'Loja']` -> `Feed e Loja`. */
export function formatList(items: readonly string[]): string {
  return LIST.format(items);
}

/** `0.84` -> `0,84` (two decimals). */
export function formatDecimal(value: number, digits = 2): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});

/** An ISO date -> `08/10`. */
export function formatDayMonth(isoDate: string): string {
  return DAY_MONTH.format(new Date(`${isoDate}T00:00:00Z`));
}

const MONTH_SHORT = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' });

function deltaAmount(t: DashboardT, delta: Delta): string {
  switch (delta.kind) {
    case 'percent':
      return formatPercent(delta.amount);
    case 'points':
      return t('amount.points', { value: formatCount(delta.amount) });
    case 'minutes':
      return t('amount.minutes', { value: formatCount(delta.amount) });
    default:
      return formatCount(delta.amount);
  }
}

/** A derived delta -> the KPI card's delta: catalog text, arrow, tone and screen-reader sentiment. */
export function kpiDelta(t: DashboardT, delta: Delta): KpiDelta {
  const tone = delta.good === null ? 'neutral' : delta.good ? 'success' : 'danger';
  const amount = deltaAmount(t, delta);
  return {
    text: t(`delta.${delta.basis}`, { amount }),
    amount,
    direction: delta.direction,
    tone,
    ...(delta.good === null
      ? {}
      : { sentiment: t(delta.good ? 'sentiment.good' : 'sentiment.bad') }),
  };
}

/**
 * A value against the same value 30 days before, as a percent change (quick 261014-dwc D-10): null
 * when there was nothing before to compare with. `higherIsGood: false` for a number that should fall.
 */
export function changeDelta(now: number, before: number, higherIsGood = true): Delta | null {
  if (before === 0) return null;
  const amount = Math.round((100 * Math.abs(now - before)) / before);
  const direction = amount === 0 ? 'flat' : now > before ? 'up' : 'down';
  return {
    amount,
    kind: 'percent',
    direction,
    good: direction === 'flat' ? null : (direction === 'up') === higherIsGood,
    basis: 'previous_30_days',
  };
}

/**
 * A share (0–100) against the same share 30 days before, as a change in percentage points (08.7-12:
 * the engaged share and the attendance of Visão geral). Rounded to whole points; higher is good.
 */
export function pointsDelta(now: number, before: number): Delta {
  const amount = Math.round(Math.abs(now - before));
  const direction = amount === 0 ? 'flat' : now > before ? 'up' : 'down';
  return {
    amount,
    kind: 'points',
    direction,
    good: direction === 'flat' ? null : direction === 'up',
    basis: 'previous_30_days',
  };
}

/** `2026-09` -> `set.` (the abbreviation as pt-BR writes it in a sentence). */
export function formatMonthAbbrev(isoMonth: string): string {
  return MONTH_SHORT.format(new Date(`${isoMonth}-01T00:00:00Z`));
}

const MONTH_YEAR = new Intl.DateTimeFormat('pt-BR', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-09-30` -> `set. de 2026` ("Membro desde …"). */
export function formatMonthYear(isoDate: string): string {
  return MONTH_YEAR.format(new Date(`${isoDate}T00:00:00Z`));
}

const FULL_DATE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-09-30` -> `30/09/2026`. */
export function formatDate(isoDate: string): string {
  return FULL_DATE.format(new Date(`${isoDate}T00:00:00Z`));
}

/** `100` minutes -> `1h40`. */
export function formatDuration(t: DashboardT, minutes: number): string {
  return t('duration', {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, '0'),
  });
}

/** `266` minutes -> `4 h 26 min`; under an hour -> `38 min` (a duration in a sentence). */
export function formatHoursMinutes(t: DashboardT, minutes: number): string {
  return t('durationLong', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** `130` seconds -> `2 min 10 s`, `252` -> `4 min 12 s`, `45` -> `45 s`, `180` -> `3 min`. */
export function formatMinutesSeconds(t: DashboardT, seconds: number): string {
  return t('durationSeconds', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

/** `252` seconds -> `4:12` (a video's length). */
export function formatClock(t: DashboardT, seconds: number): string {
  return t('clock', {
    minutes: Math.floor(seconds / 60),
    seconds: String(seconds % 60).padStart(2, '0'),
  });
}

/** An engagement band (or `active`, any of the three active bands) -> its catalog name. */
export function bandLabel(t: DashboardT, band: EngagementBandId | 'active'): string {
  return t(`bands.${band}`);
}

/** A client community -> its scope label: the exclusive VIP reads `Comunidade VIP`, the others by name. */
export function communityLabel(
  t: DashboardT,
  community: { name: string; exclusive: boolean },
): string {
  return community.exclusive
    ? t('tenantOwner.bandScope.exclusive', { name: community.name })
    : community.name;
}

/** Merged bands -> one label: `['superfan', 'engaged']` -> `Superfãs e engajados`. */
export function bandGroupLabel(t: DashboardT, bands: readonly EngagementBandId[]): string {
  const [first, ...rest] = bands;
  if (first === undefined) return '';
  return formatList([bandLabel(t, first), ...rest.map((band) => t(`bands.lower.${band}`))]);
}

/** `Ana Souza` -> `AS`, `M. Vieira` -> `MV`: the first letter of the first and last words. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * A moment relative to the tenant's today, as `localMoment` (`@/lib/owner-list-view`) derives it
 * from an ISO instant in the tenant's zone: the calendar days back and, when known, the local
 * `HH:mm` (08.7-12: instant-based, no fixture type).
 */
export interface RelativeMoment {
  daysAgo: number;
  time?: string;
}

/**
 * `{ daysAgo: 0, time: '09:12' }` -> `hoje às 09:12`; 1 -> `ontem às …` (or `ontem` without a
 * time); more -> `há 14 dias`. The one "when" format of the panels (quick 261013-uoi F-4).
 */
export function momentText(t: DashboardT, moment: RelativeMoment): string {
  return t('moment', {
    days: moment.daysAgo,
    timed: moment.time ? 'yes' : 'no',
    time: moment.time ?? '',
  });
}

const BRL_WHOLE = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * A highlight or a total, in whole reais rounded to the nearest: `416200` -> `R$ 4.162`, `7361` ->
 * `R$ 74`. The money rule of the panel (quick 261014-ia8 F-8): whole reais for highlighted numbers,
 * totals and averages; `formatBrlCompact` for bars and card cells; centavos (`formatBrl`, from the
 * contracts) only for the value of one order. The gap is U+00A0, as `formatBrl`'s. Kept here, not
 * in `@rede-social/contracts/money`, which the API shares.
 */
export function formatBrlWhole(cents: number): string {
  return BRL_WHOLE.format(Math.round(cents / 100));
}

const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * A bar's value or a card cell (quick 261014-ia8 F-8): `1438000` -> `R$ 14,4 mil`, `150000000` ->
 * `R$ 1,5 mi`; below a thousand reais it is `formatBrlWhole` (`33200` -> `R$ 332`), never centavos.
 * Both gaps are U+00A0, so the value never wraps mid-number.
 */
export function formatBrlCompact(cents: number): string {
  const reais = Math.round(cents / 100);
  return reais < 1000 ? BRL_WHOLE.format(reais) : BRL_COMPACT.format(reais);
}
