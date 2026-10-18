import type { SnapshotMeta } from '@rede-social/module-dashboard/contracts';

/**
 * Pure view helpers of the snapshot-backed panels (08.7-01): no fetch, no clock of their own (`nowMs`
 * is passed in), no words (the caller picks the catalog key this answers).
 */

/** Which freshness line a snapshot reads (UI-D-468), with its interpolations. */
export interface FreshnessText {
  /** `dashboard.report.freshness.today` or `.past`. */
  key: 'today' | 'past';
  /** `time` is `HH:mm` (h23); `day` and `date` are `dd/MM`, in the `past` form only. */
  values: { time: string; day?: string; date?: string };
}

const ISO_DATE = new Map<string, Intl.DateTimeFormat>();
const CLOCK = new Map<string, Intl.DateTimeFormat>();
const DAY_MONTH = new Map<string, Intl.DateTimeFormat>();

function formatter(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let format = cache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { timeZone, ...options });
    cache.set(timeZone, format);
  }
  return format;
}

/** The calendar date of `ms` in `timeZone`, as `YYYY-MM-DD` (en-CA writes ISO order). */
function localDate(ms: number, timeZone: string): string {
  return formatter(ISO_DATE, 'en-CA', timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}

/** The calendar day before an ISO date (calendar arithmetic on the date itself, zone-free). */
function dayBefore(isoDate: string): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`) - 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** An ISO date as `dd/MM` (the date as written, no zone shift). */
function dayMonthOf(isoDate: string): string {
  return formatter(DAY_MONTH, 'pt-BR', 'UTC', { day: '2-digit', month: '2-digit' }).format(
    Date.parse(`${isoDate}T00:00:00Z`),
  );
}

/**
 * The freshness line of a snapshot (UI-D-468, EP-54), read in the TENANT's zone
 * (`bootstrap.tenant.timezone`), never the browser's or the server's:
 * - `today` ("Números até ontem · atualizados hoje às {time}") only when the snapshot's `day` is the
 *   tenant's yesterday AND it was built on the tenant's today;
 * - otherwise `past` ("Números até {day} · atualizados em {date} às {time}"): a late or failed build
 *   is shown with its real day and build date, never relabelled as today.
 * `time` is the build's `HH:mm` with `hourCycle: 'h23'` (a build at 00:30 never reads 24:30).
 */
export function freshnessText(
  meta: Pick<SnapshotMeta, 'day' | 'builtAt'>,
  timeZone: string,
  nowMs: number,
): FreshnessText {
  const builtMs = Date.parse(meta.builtAt);
  const time = formatter(CLOCK, 'pt-BR', timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(builtMs);
  const today = localDate(nowMs, timeZone);
  const builtOn = localDate(builtMs, timeZone);
  if (meta.day === dayBefore(today) && builtOn === today) {
    return { key: 'today', values: { time } };
  }
  return { key: 'past', values: { day: dayMonthOf(meta.day), date: dayMonthOf(builtOn), time } };
}
