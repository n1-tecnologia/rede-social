import {
  EVENT_CHECKIN_OPENS_BEFORE_MINUTES,
  type EventDetail,
  type EventSummary,
  type RsvpAnswer,
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

/**
 * The form's timezone helper (UI-D-212): the tenant zone's GENERIC long name in pt-BR, from the
 * `Intl` time-zone-name option below. For `America/Sao_Paulo` Node 24 prints "Horário Padrão de Brasília"
 * (the research correction to the UI-SPEC's "Horário de Brasília"; sketch 006 message (f) accepted
 * it). Computed on the server and passed to the form as a string, so no client render formats it. An
 * unknown zone falls back to the IANA id rather than throwing.
 */
export function tenantZoneLabel(timeZone: string): string {
  try {
    const part = formatter('pt-BR', timeZone, { timeZoneName: 'longGeneric' })
      .formatToParts(new Date(0))
      .find((piece) => piece.type === 'timeZoneName');
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
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

/** `true` when the event ends on another tenant-local calendar day than it starts. */
function isMultiDay(event: Pick<EventSummary, 'startsAt' | 'endsAt'>, timeZone: string): boolean {
  return tenantDayKey(event.startsAt, timeZone) !== tenantDayKey(event.endsAt, timeZone);
}

/**
 * `12 a 14 de out.`, or `30 de out. a 2 de nov.` across months: the same month and year print the
 * start as the bare day, otherwise both ends carry it.
 */
function multiDayRange(
  event: Pick<EventSummary, 'startsAt' | 'endsAt'>,
  timeZone: string,
  nowMs: number,
  t: Translator,
): string {
  const sameMonth =
    tenantDayKey(event.startsAt, timeZone).slice(0, 7) ===
    tenantDayKey(event.endsAt, timeZone).slice(0, 7);
  const start = sameMonth
    ? formatter('pt-BR', timeZone, { day: 'numeric' }).format(new Date(event.startsAt))
    : formatDayMonth(event.startsAt, timeZone, nowMs);
  const end = formatDayMonth(event.endsAt, timeZone, nowMs);
  return t('when.range', { start, end });
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

  if (isMultiDay(event, timeZone)) {
    return { text: multiDayRange(event, timeZone, nowMs, t), live: false };
  }

  return {
    text: t('when.at', {
      date: formatEventDate(event.startsAt, timeZone, nowMs),
      time: formatEventTime(event.startsAt, timeZone),
    }),
    live: false,
  };
}

/** The poster's top-left pill: a viewer state, the cancellation, or a relative date (UI-D-201). */
export type EventPillView = {
  kind: 'cancelled' | 'present' | 'going' | 'relative';
  label: string;
};

/** The viewer-state half of the pill rule, shared by the poster and the detail header. */
type ViewerState = 'cancelled' | 'present' | 'going' | null;

function viewerState(
  event: Pick<
    EventSummary,
    'startsAt' | 'endsAt' | 'status' | 'viewerStatus' | 'viewerCheckedInAt'
  >,
  nowMs: number,
): ViewerState {
  if (event.status === 'cancelled') return 'cancelled';
  if (event.viewerCheckedInAt !== null) return 'present';
  if (event.viewerStatus === 'going' && eventPhase(event.startsAt, event.endsAt, nowMs) !== 'P3') {
    return 'going';
  }
  return null;
}

/**
 * The pill, in priority order: `Cancelado` → `Presente` (the viewer checked in, walk-ins included)
 * → `Você vai` (the viewer answered Vou and the event is not past) → a relative date: `Encerrado`
 * (ended), `Agora` (in progress), `Hoje`, `Amanhã`, `Em {n} dias`.
 */
export function eventPill(
  event: Pick<
    EventSummary,
    'startsAt' | 'endsAt' | 'status' | 'viewerStatus' | 'viewerCheckedInAt'
  >,
  timeZone: string,
  nowMs: number,
  t: Translator,
): EventPillView {
  const state = viewerState(event, nowMs);
  if (state === 'cancelled') return { kind: 'cancelled', label: t('state.cancelled') };
  if (state === 'present') return { kind: 'present', label: t('state.present') };
  if (state === 'going') return { kind: 'going', label: t('state.going') };
  const phase = eventPhase(event.startsAt, event.endsAt, nowMs);
  if (phase === 'P3') return { kind: 'relative', label: t('state.ended') };
  if (phase === 'P2') return { kind: 'relative', label: t('when.now') };
  const days = tenantDaysUntil(event.startsAt, timeZone, nowMs);
  if (days <= 0) return { kind: 'relative', label: t('when.today') };
  if (days === 1) return { kind: 'relative', label: t('when.tomorrow') };
  return { kind: 'relative', label: t('when.inDays', { count: days }) };
}

/**
 * The D-219 count line: "N confirmados" (going + checked_in) while the event has not ended, "N
 * presentes" (checked_in + walk_in) once it has, and NONE for a cancelled event (UI-D-202). ICU
 * plurals format the number with pt-BR grouping ("1.204 confirmados"); it is never rounded, capped
 * or abbreviated.
 */
export function eventCountLine(
  event: Pick<EventSummary, 'startsAt' | 'endsAt' | 'status' | 'confirmedCount' | 'presentCount'>,
  nowMs: number,
  t: Translator,
): string | undefined {
  if (event.status === 'cancelled') return undefined;
  return eventPhase(event.startsAt, event.endsAt, nowMs) === 'P3'
    ? t('count.present', { count: event.presentCount })
    : t('count.confirmed', { count: event.confirmedCount });
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
  /** The count line, or undefined for none (cancelled). */
  meta?: string;
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
  const meta = eventCountLine(event, nowMs, t);
  return {
    id: event.id,
    href: `/eventos/${event.id}`,
    title: event.title,
    overline: when.text,
    overlineLive: when.live,
    place: online ? t('place.online') : (event.venueName ?? ''),
    placeKind: online ? 'online' : 'venue',
    pill: eventPill(event, tz, nowMs, t),
    ...(meta === undefined ? {} : { meta }),
    ariaLabel: t('poster.label', { title: event.title, when: when.text }),
    coverAssetId: event.coverAssetId,
    coverVariantWidths: event.coverVariantWidths,
    coverAlt: t('cover.alt', { title: event.title }),
    grayscale: cancelled,
  };
}

/**
 * D-203 / UI-D-205: the universal Google Maps search link, which opens the maps app on iOS and
 * Android. The query is the venue and the address joined by a comma, URI-encoded (accents, commas and
 * line breaks included). An outbound, user-tapped link: no embed, no static map, no SDK.
 */
export function mapsHref(venue: string, address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue}, ${address}`)}`;
}

/** One info cell as `EventInfoGrid` renders it. */
export type EventInfoCellView = {
  icon: 'date' | 'time' | 'place' | 'online' | 'people';
  label: string;
  value: string;
};

/** The detail's banner at the top of the hero card body (UI-D-202, UI-D-207). */
export type EventBannerView =
  | { kind: 'cancelled'; title: string; body: string }
  | { kind: 'checkedIn'; title: string; body: string };

/** Everything `/eventos/[eventId]` renders, as finished strings and ISO instants. */
export type EventDetailView = {
  id: string;
  title: string;
  /** The sticky header's trailing `StatusPill`, or null for none. */
  headerPill: { tone: 'brand' | 'success' | 'danger'; label: string } | null;
  hero: {
    overline: string;
    place: string;
    placeKind: 'venue' | 'online';
    coverAssetId: string | null;
    coverVariantWidths: number[];
    coverAlt: string;
  };
  banner: EventBannerView | null;
  /** Plain text; `''` means "no description" and the paragraph is absent. */
  description: string;
  info: EventInfoCellView[];
  /** The index of the count cell (announced politely). */
  countIndex: number;
  /** In person only; null online (the action zone owns the link, UI-D-209). */
  location: {
    venue: string;
    address: string;
    href: string;
    label: string;
    ariaLabel: string;
  } | null;
  phase: EventPhase;
  cancelled: boolean;
  format: 'in_person' | 'online';
  /** ISO instants for the client's boundary refresh (UI-D-203). */
  checkinOpensAt: string;
  startsAt: string;
  endsAt: string;
};

/**
 * The hero overline (UI-SPEC §Detail page): cancelled `{date} · {time}`; past `Aconteceu em {date}`;
 * running `Acontecendo agora`; today `É hoje! · {time}`; tomorrow `Amanhã · {time}`; from 2 days
 * `Faltam N dias · {date}`. Tenant-local calendar days.
 */
function heroOverline(event: EventDetail, tz: string, nowMs: number, t: Translator): string {
  const date = formatEventDate(event.startsAt, tz, nowMs);
  const time = formatEventTime(event.startsAt, tz);
  if (event.status === 'cancelled') return t('when.at', { date, time });
  const phase = eventPhase(event.startsAt, event.endsAt, nowMs);
  if (phase === 'P3') return t('hero.happened', { date });
  if (phase === 'P2') return t('hero.live');
  const days = tenantDaysUntil(event.startsAt, tz, nowMs);
  if (days <= 0) return t('hero.today', { time });
  if (days === 1) return t('hero.tomorrow', { time });
  return t('hero.countdown', { count: days, date });
}

/**
 * `EventDetail` → `EventDetailView` (UI-D-204): the header pill, the hero, the banner, the four info
 * cells, the location and the action-zone phase, all in the TENANT's timezone from ONE request instant.
 */
export function eventDetailView(
  event: EventDetail,
  { tz, nowMs, t }: { tz: string; nowMs: number; t: Translator },
): EventDetailView {
  const online = event.format === 'online';
  const cancelled = event.status === 'cancelled';
  const phase = eventPhase(event.startsAt, event.endsAt, nowMs);
  const state = viewerState(event, nowMs);
  const headerPill =
    state === 'cancelled'
      ? { tone: 'danger' as const, label: t('state.cancelled') }
      : state === 'present'
        ? { tone: 'success' as const, label: t('state.present') }
        : state === 'going'
          ? { tone: 'brand' as const, label: t('state.going') }
          : null;

  let banner: EventBannerView | null = null;
  if (cancelled) {
    banner = { kind: 'cancelled', title: t('cancelled.title'), body: t('cancelled.body') };
  } else if (event.viewerCheckedInAt !== null) {
    const at = event.viewerCheckedInAt;
    const time = formatEventTime(at, tz);
    const sameDay = tenantDayKey(at, tz) === tenantDayKey(nowMs, tz);
    banner = {
      kind: 'checkedIn',
      title: t('checkin.banner'),
      body: sameDay
        ? t('checkin.doneAt', { time })
        : t('checkin.doneOn', { date: formatEventDate(at, tz, nowMs), time }),
    };
  }

  const multiDay = isMultiDay(event, tz);
  const start = formatEventTime(event.startsAt, tz);
  const end = formatEventTime(event.endsAt, tz);
  const past = phase === 'P3';
  const info: EventInfoCellView[] = [
    {
      icon: 'date',
      label: t('info.date'),
      value: multiDay
        ? multiDayRange(event, tz, nowMs, t)
        : formatEventDate(event.startsAt, tz, nowMs),
    },
    {
      icon: 'time',
      label: t('info.time'),
      value: multiDay
        ? t('info.timeRangeMultiDay', { start, end })
        : t('info.timeRange', { start, end }),
    },
    {
      icon: online ? 'online' : 'place',
      label: t('info.place'),
      value: online ? t('place.online') : (event.venueName ?? ''),
    },
    past
      ? {
          icon: 'people',
          label: t('info.present'),
          value: t('count.present', { count: event.presentCount }),
        }
      : {
          icon: 'people',
          label: t('info.confirmed'),
          value: t('count.confirmed', { count: event.confirmedCount }),
        },
  ];

  const venue = event.venueName ?? '';
  const address = event.address ?? '';
  const location =
    online || venue.length === 0
      ? null
      : {
          venue,
          address,
          href: mapsHref(venue, address),
          label: t('location.openMaps'),
          ariaLabel: t('location.openMapsLabel', { venue }),
        };

  return {
    id: event.id,
    title: event.title,
    headerPill,
    hero: {
      overline: heroOverline(event, tz, nowMs, t),
      place: online ? t('place.online') : venue,
      placeKind: online ? 'online' : 'venue',
      coverAssetId: event.coverAssetId,
      coverVariantWidths: event.coverVariantWidths,
      coverAlt: t('cover.alt', { title: event.title }),
    },
    banner,
    description: event.description,
    info,
    countIndex: 3,
    location,
    phase,
    cancelled,
    format: event.format,
    checkinOpensAt: new Date(
      Date.parse(event.startsAt) - EVENT_CHECKIN_OPENS_BEFORE_MINUTES * 60_000,
    ).toISOString(),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
  };
}

/**
 * What the action-zone island (`EventActions`, UI-D-207) needs to decide its RSVP rows, as plain
 * serialisable values: the phase the SERVER computed from the request instant, the flags, the
 * viewer's recorded answer, and the three ISO boundaries the island's one scheduled refresh targets
 * (UI-D-203). No instant is formatted and no clock is read on the client to draw it.
 *
 * `answer` is the recorded RSVP only (`going` / `not_going`); a check-in (`checked_in`, `walk_in`)
 * is `checkedIn` instead, and then the zone shows no RSVP row at all (the banner says it).
 */
export type EventActionState = {
  eventId: string;
  phase: EventPhase;
  format: 'in_person' | 'online';
  cancelled: boolean;
  answer: RsvpAnswer | null;
  checkedIn: boolean;
  checkinOpensAt: string;
  startsAt: string;
  endsAt: string;
};

/** `EventDetail` + its `EventDetailView` → the island's props (the view already holds the phase). */
export function eventActionState(
  event: Pick<EventDetail, 'id' | 'viewerStatus' | 'viewerCheckedInAt'>,
  view: Pick<
    EventDetailView,
    'phase' | 'format' | 'cancelled' | 'checkinOpensAt' | 'startsAt' | 'endsAt'
  >,
): EventActionState {
  const answer =
    event.viewerStatus === 'going' || event.viewerStatus === 'not_going'
      ? event.viewerStatus
      : null;
  return {
    eventId: event.id,
    phase: view.phase,
    format: view.format,
    cancelled: view.cancelled,
    answer,
    checkedIn: event.viewerCheckedInAt !== null,
    checkinOpensAt: view.checkinOpensAt,
    startsAt: view.startsAt,
    endsAt: view.endsAt,
  };
}
