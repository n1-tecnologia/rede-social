import { cutOnWord } from '@rede-social/contracts/text';
import { EVENTS_NOTIFICATION_KINDS, type EventsNotificationKind } from '../contracts/index';

/**
 * The pt-BR push banner bodies for the events kinds, verbatim from 07-UI-SPEC §Push banner copy
 * (UI-D-266). Rendered SERVER-SIDE (a push must exist before any page loads, so it cannot come from
 * next-intl) and carried only in the intent's push hint: NEVER stored in a `notifications` row (the
 * row keeps `kind` + facts, and the web renders its own sentence).
 *
 * **Every `{when}` and `{time}` is the TENANT's wall clock** (`tenants.timezone`, read by the source
 * in its own transaction), never the server's: a Cloud Run instance runs in UTC, and a banner saying
 * "22:00" for a 19:00 São Paulo event would be a wrong time on a lock screen (T-07-28).
 *
 * The formats are UI-D-203's, restated here because the module cannot import the web's
 * `lib/events-view.ts`: date `sáb., 12 de out.` (with ` de 2027` when the tenant-local year differs
 * from now's), time `19:00` (h23), when-line `{date} · {time}`.
 */

/** A banner body is about one line on a lock screen (the feed's cap, restated). */
export const EVENTS_PUSH_BODY_MAX = 100;

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
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(new Date(instant));

/** `19:00`: 24 h, two digits, in the tenant's zone. */
export function eventTime(iso: string, timeZone: string): string {
  return formatter(timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );
}

/** `seg., 12 de out. · 19:00` (the year appended to the date only when it is not now's). */
export function eventWhen(iso: string, timeZone: string, nowMs: number): string {
  const otherYear = tenantYear(iso, timeZone) !== tenantYear(nowMs, timeZone);
  const date = formatter(timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(otherYear ? { year: 'numeric' } : {}),
  }).format(new Date(iso));
  return `${date} · ${eventTime(iso, timeZone)}`;
}

export const EVENTS_PUSH_COPY = {
  event: (title: string, when: string) => `Novo evento: ${title} · ${when}`,
  reactivated: (title: string, when: string) => `Evento reativado: ${title} · ${when}`,
  reminder24h: (title: string, time: string) => `Amanhã às ${time}: ${title}`,
  reminder1h: (title: string, time: string) => `Em 1 hora: ${title} começa às ${time}`,
} as const;

/** The rendered body, cut on a word to `EVENTS_PUSH_BODY_MAX` graphemes with `…` only when it cut. */
export function eventsPushCopy(facts: {
  kind: EventsNotificationKind;
  title: string;
  startsAt: string;
  timeZone: string;
  nowMs: number;
}): string {
  const { kind, title, startsAt, timeZone, nowMs } = facts;
  let body: string;
  switch (kind) {
    case EVENTS_NOTIFICATION_KINDS.event:
      body = EVENTS_PUSH_COPY.event(title, eventWhen(startsAt, timeZone, nowMs));
      break;
    case EVENTS_NOTIFICATION_KINDS.reactivated:
      body = EVENTS_PUSH_COPY.reactivated(title, eventWhen(startsAt, timeZone, nowMs));
      break;
    case EVENTS_NOTIFICATION_KINDS.reminder24h:
      body = EVENTS_PUSH_COPY.reminder24h(title, eventTime(startsAt, timeZone));
      break;
    case EVENTS_NOTIFICATION_KINDS.reminder1h:
      body = EVENTS_PUSH_COPY.reminder1h(title, eventTime(startsAt, timeZone));
      break;
  }
  return cutOnWord(body, EVENTS_PUSH_BODY_MAX);
}
