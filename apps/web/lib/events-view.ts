import {
  EVENT_CHECKIN_OPENS_BEFORE_MINUTES,
  type EventSummary,
} from '@tria/module-events/contracts';
import type { getTranslations } from 'next-intl/server';

/**
 * THE formatter module for events (UI-D-203): every date, time and relative label an events surface
 * prints is built here, with `Intl.DateTimeFormat('pt-BR', { timeZone })` pinned to
 * `bootstrap.tenant.timezone`. There is no date library (UI-SPEC Registry Safety) and no other place
 * that formats an event instant.
 *
 * **Server-side only, and clock-free.** Nothing here reads the clock: every function that needs "now"
 * takes `nowMs` from its caller, which reads `Date.now()` ONCE per request (a page) or per action.
 * Client components receive the finished strings, so no client render calls the clock (UI-D-14) and
 * server and hydration output are byte-identical.
 *
 * **Tenant-local calendar days.** "Hoje", "Amanhã" and "Em {n} dias" compare the tenant-local DATES of
 * two instants (`tenantDayKey`, the `en-CA` trick that yields `2026-10-12`), then diff those dates as
 * UTC midnights. A device in Manaus or Lisbon therefore reads the tenant's calendar, not its own.
 *
 * The prototype's formatter (`getUTC*` with no timezone) is exactly what CONTEXT forbids porting.
 */

/** The same untyped translator every `lib/*-view` module takes (namespace-scoped by the caller). */
type Translator = Awaited<ReturnType<typeof getTranslations>>;

/** Cached per zone: `Intl.DateTimeFormat` construction is the expensive part. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, { timeZone, ...options });
    formatters.set(key, found);
  }
  return found;
}

/** `'2026-10-12'`: the tenant-local calendar day of an instant. */
export function tenantDayKey(iso: string | number, timeZone: string): string {
  return formatter('en-CA', timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

/** Whole tenant-local calendar days from `fromMs` to `iso` (negative when `iso` is earlier). */
function tenantDaysUntil(iso: string, timeZone: string, fromMs: number): number {
  const toUtcMidnight = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  const diff =
    toUtcMidnight(tenantDayKey(iso, timeZone)) - toUtcMidnight(tenantDayKey(fromMs, timeZone));
  return Math.round(diff / 86_400_000);
}

/** The tenant-local year of an instant. */
const tenantYear = (iso: string | number, timeZone: string) =>
  tenantDayKey(iso, timeZone).slice(0, 4);

/**
 * `seg., 12 de out.`, with ` de 2027` appended only when the instant falls in another tenant-local
 * year than `nowMs`.
 */
export function formatEventDate(iso: string, timeZone: string, nowMs: number): string {
  const otherYear = tenantYear(iso, timeZone) !== tenantYear(nowMs, timeZone);
  return formatter('pt-BR', timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(otherYear ? { year: 'numeric' } : {}),
  }).format(new Date(iso));
}

/** `19:00`: 24 h, always two digits. */
export function formatEventTime(iso: string, timeZone: string): string {
  return formatter('pt-BR', timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** `12 de out.` (plus the year when it is not the current tenant-local year). */
function formatDayMonth(iso: string, timeZone: string, nowMs: number): string {
  const otherYear = tenantYear(iso, timeZone) !== tenantYear(nowMs, timeZone);
  return formatter('pt-BR', timeZone, {
    day: 'numeric',
    month: 'short',
    ...(otherYear ? { year: 'numeric' } : {}),
  }).format(new Date(iso));
}

/**
 * The action-zone phase (UI-SPEC "Action zone contract", D-209):
 * - `P0`: `now < starts_at − 1 h`;
 * - `P1`: `starts_at − 1 h ≤ now < starts_at` (the check-in window is open, RSVP still is);
 * - `P2`: `starts_at ≤ now < ends_at` (in progress);
 * - `P3`: `now ≥ ends_at` (ended).
 */
export type EventPhase = 'P0' | 'P1' | 'P2' | 'P3';

export function eventPhase(startsAt: string, endsAt: string, nowMs: number): EventPhase {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (nowMs >= end) return 'P3';
  if (nowMs >= start) return 'P2';
  if (nowMs >= start - EVENT_CHECKIN_OPENS_BEFORE_MINUTES * 60_000) return 'P1';
  return 'P0';
}

/** A when-line plus whether it is the in-progress form (rendered in full white on a poster). */
export type EventWhenLine = { text: string; live: boolean };

/**
 * The poster overline / when-line (UI-D-201, UI-D-203):
 * - in progress and not cancelled: `Acontecendo agora · até {time}`;
 * - ending on another tenant-local day: `{start} a {end}` (`12 a 14 de out.`, or
 *   `30 de out. a 2 de nov.` across months);
 * - otherwise `{date} · {time}`.
 */
export function eventWhenLine(
  event: Pick<EventSummary, 'startsAt' | 'endsAt' | 'status'>,
  timeZone: string,
  nowMs: number,
  t: Translator,
): EventWhenLine {
  const phase = eventPhase(event.startsAt, event.endsAt, nowMs);
  if (phase === 'P2' && event.status !== 'cancelled') {
    return {
      text: t('when.liveUntil', { time: formatEventTime(event.endsAt, timeZone) }),
      live: true,
    };
  }

  const startDay = tenantDayKey(event.startsAt, timeZone);
  const endDay = tenantDayKey(event.endsAt, timeZone);
  if (startDay !== endDay) {
    // Same month and year: the start is the bare day ("12 a 14 de out."); otherwise both carry it.
    const sameMonth = startDay.slice(0, 7) === endDay.slice(0, 7);
    const start = sameMonth
      ? formatter('pt-BR', timeZone, { day: 'numeric' }).format(new Date(event.startsAt))
      : formatDayMonth(event.startsAt, timeZone, nowMs);
    const end = formatDayMonth(event.endsAt, timeZone, nowMs);
    return { text: t('when.range', { start, end }), live: false };
  }

  return {
    text: t('when.at', {
      date: formatEventDate(event.startsAt, timeZone, nowMs),
      time: formatEventTime(event.startsAt, timeZone),
    }),
    live: false,
  };
}

/** The poster's top-left pill: a state, or a relative date (UI-D-201). 06-03 adds `going`/`present`. */
export type EventPillView = { kind: 'cancelled' | 'relative'; label: string };

/**
 * The pill, in priority order: `Cancelado` → (06-03: `Presente`, `Você vai`) → a relative date:
 * `Encerrado` (ended), `Agora` (in progress), `Hoje`, `Amanhã`, `Em {n} dias`.
 */
export function eventPill(
  event: Pick<EventSummary, 'startsAt' | 'endsAt' | 'status'>,
  timeZone: string,
  nowMs: number,
  t: Translator,
): EventPillView {
  if (event.status === 'cancelled') return { kind: 'cancelled', label: t('state.cancelled') };
  const phase = eventPhase(event.startsAt, event.endsAt, nowMs);
  if (phase === 'P3') return { kind: 'relative', label: t('state.ended') };
  if (phase === 'P2') return { kind: 'relative', label: t('when.now') };
  const days = tenantDaysUntil(event.startsAt, timeZone, nowMs);
  if (days <= 0) return { kind: 'relative', label: t('when.today') };
  if (days === 1) return { kind: 'relative', label: t('when.tomorrow') };
  return { kind: 'relative', label: t('when.inDays', { count: days }) };
}

/** Everything `EventPoster` renders, as finished strings: no instant crosses to the client. */
export type EventPosterView = {
  id: string;
  href: string;
  title: string;
  overline: string;
  overlineLive: boolean;
  place: string;
  placeKind: 'venue' | 'online';
  pill: EventPillView;
  ariaLabel: string;
  coverAssetId: string | null;
  coverVariantWidths: number[];
  coverAlt: string;
  grayscale: boolean;
};

/** `EventSummary` → `EventPosterView`, in the tenant's timezone, from ONE request instant. */
export function eventPosterView(
  event: EventSummary,
  { tz, nowMs, t }: { tz: string; nowMs: number; t: Translator },
): EventPosterView {
  const when = eventWhenLine(event, tz, nowMs, t);
  const online = event.format === 'online';
  const cancelled = event.status === 'cancelled';
  return {
    id: event.id,
    href: `/eventos/${event.id}`,
    title: event.title,
    overline: when.text,
    overlineLive: when.live,
    place: online ? t('place.online') : (event.venueName ?? ''),
    placeKind: online ? 'online' : 'venue',
    pill: eventPill(event, tz, nowMs, t),
    ariaLabel: t('poster.label', { title: event.title, when: when.text }),
    coverAssetId: event.coverAssetId,
    coverVariantWidths: event.coverVariantWidths,
    coverAlt: t('cover.alt', { title: event.title }),
    grayscale: cancelled,
  };
}
