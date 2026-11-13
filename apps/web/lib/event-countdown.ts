/**
 * The one countdown formatter of Phase 10.2 (D-787, D-785, D-788, D-790; OPEN-09, OPEN-20, OPEN-21).
 *
 * A remaining time in milliseconds becomes the card and holder text (`2 d 4 h 13 min`), the page cells
 * (`02 dias`, `04 horas`, `13 min`), the spoken value (`2 dias, 4 horas e 13 minutos`) and the singular
 * lead (`Falta` for one unit equal to 1, else `Faltam`). The card, the hero overline, `Meus eventos` and
 * the zone all call it, so the rule lives in one place; the countdown to the opening and the countdown to
 * the event are the same function with different catalog keys (D-790).
 *
 * **Why a file of its own.** `events-view.ts` is a server-side view file of about 1500 lines; the client
 * island that ticks the count (plan 13) must import the formatter without pulling it into the client
 * bundle. This module imports nothing: no server module, nothing from the contracts index (which drags
 * `node:fs` in), no catalog of its own. Plan 10 re-exports it from `events-view.ts` so the name in the
 * UI-SPEC resolves.
 *
 * **Pure and clock-free.** It takes a remaining time and nothing else: no clock is read, no `Date` is
 * built and no timer is armed here, so the first render on the server and on the client produce the same
 * string (D-788). The server seed and the device offset live in plan 11.
 *
 * **Rules (UI-D-785).** Floor to whole minutes with integer arithmetic only, never half-up and never
 * seconds; a day is 24 hours of elapsed time (no calendar, no DST); units are days, hours and minutes;
 * every zero unit is dropped, leading or interior (`1 d 5 min`); the last minute reads "menos de 1 min";
 * a day count above 99 grows and is never capped.
 *
 * **The `now` state.** A value at or below zero, `NaN` and an infinite value are the `now` state. The
 * renderings of that state are empty (`''` / no cells): the caller decides what "now" means on its
 * surface ("Abrindo agora" in the zone, "Acontecendo agora" for a holder) and callers never pass a
 * non-finite value anyway, because a missing seed draws no count (plan 13). Nothing here throws.
 */

/** One minute in milliseconds. */
export const MINUTE_MS = 60_000;

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/**
 * The slice of a translator the formatter needs, so both the server translator (`getTranslations`) and
 * the client's `useTranslations` fit. Keys are relative to the `events` namespace.
 */
export type CountdownT = (key: string, values?: Record<string, string | number>) => string;

/** The remaining time as parts: nothing left, the last minute, or whole days, hours and minutes. */
export type CountdownParts =
  | { state: 'now' }
  | { state: 'lessThanMinute' }
  | { state: 'units'; days: number; hours: number; minutes: number };

/** One cell of the page's blocks: a zero-padded number and its unit label (`null` value: no number). */
export interface CountdownCell {
  value: string | null;
  label: string;
}

/** Which sentence frames the spoken value: the countdown to the opening or the one to the event. */
export type CountdownTarget = 'opening' | 'event';

/**
 * The remaining milliseconds as countdown parts. Floor, integer arithmetic only: a value that is not a
 * positive finite number is `now`, under one whole minute is `lessThanMinute`.
 */
export function countdownParts(remainingMs: number): CountdownParts {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return { state: 'now' };
  const totalMinutes = Math.floor(remainingMs / MINUTE_MS);
  if (totalMinutes < 1) return { state: 'lessThanMinute' };
  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const rest = totalMinutes % MINUTES_PER_DAY;
  return {
    state: 'units',
    days,
    hours: Math.floor(rest / MINUTES_PER_HOUR),
    minutes: rest % MINUTES_PER_HOUR,
  };
}

/** The non-zero units in the order days, hours, minutes. */
function nonZeroUnits(parts: Extract<CountdownParts, { state: 'units' }>) {
  const units: Array<{ unit: 'days' | 'hours' | 'minutes'; count: number }> = [];
  if (parts.days > 0) units.push({ unit: 'days', count: parts.days });
  if (parts.hours > 0) units.push({ unit: 'hours', count: parts.hours });
  if (parts.minutes > 0) units.push({ unit: 'minutes', count: parts.minutes });
  return units;
}

/**
 * The card and holder text: `2 d 4 h 13 min`, `23 h 40 min`, `40 min`, `menos de 1 min`. The count is
 * passed as a string so it is never locale-formatted (`1000 d`, not `1.000 d`). Empty at `now`.
 */
export function countdownShort(t: CountdownT, remainingMs: number): string {
  const parts = countdownParts(remainingMs);
  if (parts.state === 'now') return '';
  if (parts.state === 'lessThanMinute') return t('countdown.short.lessThanMinute');
  return nonZeroUnits(parts)
    .map(({ unit, count }) => t(`countdown.short.${unit}`, { count: String(count) }))
    .join(' ');
}

/**
 * The page cells: one per non-zero unit, numbers zero-padded to two digits with `padStart` (never
 * `Intl`) and labels pluralised by ICU (`02 dias`, `04 horas`, `13 min`); a day count above 99 grows
 * (`100`, `365`). The last minute is ONE cell with a full label and no number. No cells at `now`.
 */
export function countdownBlocks(t: CountdownT, remainingMs: number): CountdownCell[] {
  const parts = countdownParts(remainingMs);
  if (parts.state === 'now') return [];
  if (parts.state === 'lessThanMinute') {
    return [{ value: null, label: t('countdown.block.lessThanMinute') }];
  }
  return nonZeroUnits(parts).map(({ unit, count }) => ({
    value: String(count).padStart(2, '0'),
    label: t(`countdown.block.${unit}`, { count }),
  }));
}

/**
 * The spoken value for the `role="timer"` element: the units joined by `Intl.ListFormat('pt-BR')`
 * (`2 dias, 4 horas e 13 minutos`), framed by the opening or the event sentence. Empty at `now`.
 */
export function countdownSpoken(
  t: CountdownT,
  remainingMs: number,
  target: CountdownTarget,
): string {
  const parts = countdownParts(remainingMs);
  if (parts.state === 'now') return '';
  const time =
    parts.state === 'lessThanMinute'
      ? t('countdown.spoken.lessThanMinute')
      : new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' }).format(
          nonZeroUnits(parts).map(({ unit, count }) => t(`countdown.spoken.${unit}`, { count })),
        );
  return t(`countdown.spoken.${target}`, { time });
}

/**
 * The lead of the holder's text: `one` (the singular "Falta") only when the whole text is ONE unit equal
 * to 1 (`1 d`, `1 h`, `1 min`), else `other` ("Faltam"): `1 d 5 min`, `2 d`, the last minute (which has
 * its own key) and `now` are all `other`.
 */
export function countdownLead(remainingMs: number): 'one' | 'other' {
  const parts = countdownParts(remainingMs);
  if (parts.state !== 'units') return 'other';
  const units = nonZeroUnits(parts);
  return units.length === 1 && units[0]?.count === 1 ? 'one' : 'other';
}

/**
 * How long, in milliseconds, until the displayed value changes: the first millisecond at which the
 * floored minute count drops (`remaining % 60 s`, plus the one millisecond it takes to cross the
 * boundary). The only value the single timer of plan 11 needs. At the exact start of a minute the count
 * still reads that minute, so the answer is 1 ms, not 60 s: a timer armed for 60 s there would leave
 * the old minute on screen for another whole minute. In the last minute the next change is the opening
 * itself (up to 60 000 ms). 0 when there is nothing to count (`now`), so the caller never arms a timer.
 */
export function msToNextMinuteChange(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return (Math.floor(remainingMs) % MINUTE_MS) + 1;
}
