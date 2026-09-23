/**
 * "há 2 h" — the ONE relative-time formatter of the app tier.
 *
 * It was `lib/feed-view.tsx`'s until 05-06, and it moved here for a mechanical reason rather than a
 * tidy one: `feed-view.tsx` imports `VideoPlayer`, which imports a server action, which imports
 * `lib/api` → `lib/env` and fails fast without the browser env vars. Any module that needed only
 * the formatter therefore dragged the whole media stack behind it — which is exactly what a unit
 * test of the story viewer cannot supply. `feed-view.tsx` re-exports it, so every existing caller
 * is unchanged.
 *
 * It is computed on the SERVER and passed down as a string (UI-D-14): no card, circle or viewer
 * calls a clock in render, so there is no hydration mismatch and no per-second re-render.
 */

const relativeTime = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto', style: 'narrow' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function relativeFrom(iso: string, now: number): string {
  const elapsed = now - new Date(iso).getTime();
  if (elapsed < MINUTE) return relativeTime.format(0, 'second');
  if (elapsed < HOUR) return relativeTime.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relativeTime.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < WEEK) return relativeTime.format(-Math.floor(elapsed / DAY), 'day');
  if (elapsed < MONTH) return relativeTime.format(-Math.floor(elapsed / WEEK), 'week');
  if (elapsed < YEAR) return relativeTime.format(-Math.floor(elapsed / MONTH), 'month');
  return relativeTime.format(-Math.floor(elapsed / YEAR), 'year');
}
