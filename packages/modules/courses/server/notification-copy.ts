import { cutOnWord } from '@rede-social/contracts/text';

/**
 * The pt-BR push banner bodies for the courses kinds (08.6-05, UI-D-461), modelled on the events
 * module's file. Rendered SERVER-SIDE (a push must exist before any page loads, so it cannot come
 * from next-intl) and carried only in the intent's push hint: NEVER stored in a `notifications` row
 * (the row keeps `kind` + facts, and the web renders its own sentence). Plans 06 and 07 add their
 * bodies here.
 *
 * **Every `{time}` and `{when}` is the TENANT's wall clock** (`tenants.timezone`, read by the source
 * in its own transaction), never the server's: a Cloud Run instance runs in UTC, and a banner saying
 * "22:00" for a 19:00 São Paulo live would be a wrong time on a lock screen (T-07-28).
 *
 * The formats restate UI-D-203's (the module cannot import the web's view helpers): date
 * `seg., 12 de out.` (with ` de 2027` when the tenant-local year differs from now's), time `19:00`
 * (h23), when-line `{date} · {time}`.
 */

/** A banner body is about one line on a lock screen (the feed's cap, restated). */
export const COURSES_PUSH_BODY_MAX = 100;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat('pt-BR', { timeZone, ...options });
    formatters.set(key, found);
  }
  return found;
}

const tenantYear = (instant: string | number, timeZone: string) =>
  formatter(timeZone, { year: 'numeric' }).format(new Date(instant));

/** `19:00`: 24 h, two digits, in the tenant's zone. */
export function liveTime(iso: string, timeZone: string): string {
  return formatter(timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );
}

/** `seg., 12 de out. · 19:00` (the year appended to the date only when it is not now's). */
export function liveWhen(iso: string, timeZone: string, nowMs: number): string {
  const otherYear = tenantYear(iso, timeZone) !== tenantYear(nowMs, timeZone);
  const date = formatter(timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(otherYear ? { year: 'numeric' } : {}),
  }).format(new Date(iso));
  return `${date} · ${liveTime(iso, timeZone)}`;
}

/** The rendered bodies, each cut on a word to `COURSES_PUSH_BODY_MAX` graphemes with `…` only when it cut. */
export const coursesPushCopy = {
  /** UI-D-461: the 15-minute live reminder (D-445). */
  liveReminder: (title: string, startsAt: string, timeZone: string): string =>
    cutOnWord(
      `Em 15 minutos: ${title} começa às ${liveTime(startsAt, timeZone)}`,
      COURSES_PUSH_BODY_MAX,
    ),
  /**
   * UI-D-461: the cancel notice (D-447). INERT RED STUB (08.6-06 Task 1): answers '' until the GREEN
   * commit renders "Live cancelada: {title} · {when}".
   */
  liveCancelled: (_title: string, _startsAt: string, _timeZone: string, _nowMs: number): string =>
    '',
} as const;
