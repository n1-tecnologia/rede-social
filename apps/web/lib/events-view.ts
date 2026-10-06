import { avatarUrlFor } from '@rede-social/contracts/profiles';
import {
  type AttendanceList,
  type Attendee,
  type EnterOutcome,
  EVENT_CHECKIN_OPENS_BEFORE_MINUTES,
  type EventDetail,
  type EventSummary,
  type RsvpAnswer,
} from '@rede-social/module-events/contracts';
import type { getTranslations } from 'next-intl/server';
import { addressMapsQuery, parseEventAddress } from './event-address';
import { type EventExtras, type ScheduleItem, splitEventDescription } from './event-extras';

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
 * `Intl` time-zone-name option below. For São Paulo's zone Node 24 prints "Horário Padrão de Brasília"
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

/** The viewer-state half of the pill rule, for the detail header. */
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

/** Whether the viewer counts the event as theirs: a "Vou", or a check-in (a walk-in included). */
function isViewerIn(event: Pick<EventSummary, 'viewerStatus' | 'viewerCheckedInAt'>): boolean {
  return event.viewerStatus === 'going' || event.viewerCheckedInAt !== null;
}

/**
 * "Últimas N vagas" (2026-10-03, the REINE poster): the scarcity line shows from this many spots
 * left down to one; above it a limited event reads like any other.
 */
export const EVENT_LOW_SPOTS = 10;

/**
 * The spots a NEW confirmation could still take: the limit minus D-219's confirmed count
 * (`going + checked_in`, the very count the guard trigger bounds), never below zero (a limit lowered
 * under the confirmations reads as full, not as a negative number). Null for an event with no limit.
 */
export function spotsLeft(event: Pick<EventSummary, 'capacity' | 'confirmedCount'>): number | null {
  if (event.capacity === null) return null;
  return Math.max(0, event.capacity - event.confirmedCount);
}

/** Whether a member can still answer, by the clock: before the start (D-204), not cancelled. */
function rsvpOpen(event: Pick<EventSummary, 'startsAt' | 'endsAt' | 'status'>, nowMs: number) {
  const phase = eventPhase(event.startsAt, event.endsAt, nowMs);
  return event.status !== 'cancelled' && (phase === 'P0' || phase === 'P1');
}

/**
 * The two galleries of `/eventos` (2026-10-03, the REINE prototype's "Meus eventos" and "Outros
 * eventos"), from the two periods the API pages:
 * - `mine`: the events the viewer is in that have not ended (a "Vou" or a check-in), then the ended
 *   ones they checked in to;
 * - `others`: every other event, the ones that have not ended first, then the ended ones.
 * A cancelled event stays where the viewer's answer puts it (D-201): a "Vou" keeps it in `mine`,
 * where its pill says it was cancelled. The order inside each half is the API's (upcoming by start,
 * past most recent first), never restated.
 */
export function splitEventSections(
  upcoming: readonly EventSummary[],
  past: readonly EventSummary[],
): { mine: EventSummary[]; others: EventSummary[] } {
  const attended = (event: EventSummary) => event.viewerCheckedInAt !== null;
  return {
    mine: [...upcoming.filter(isViewerIn), ...past.filter(attended)],
    others: [
      ...upcoming.filter((event) => !isViewerIn(event)),
      ...past.filter((event) => !attended(event)),
    ],
  };
}

/** The tenant-local day of an instant, as a bare number (`28`). */
const badgeDay = (iso: string, timeZone: string) =>
  formatter('pt-BR', timeZone, { day: 'numeric' }).format(new Date(iso));

/** The tenant-local month of an instant, short, in capitals and without its dot (`SET`). */
const badgeMonth = (iso: string, timeZone: string) =>
  formatter('pt-BR', timeZone, { month: 'short' })
    .format(new Date(iso))
    .replace('.', '')
    .toLocaleUpperCase('pt-BR');

/**
 * The card's date pill: `28 SET`, or `12-14 SET` for an event that ends on another tenant-local day
 * of the same month; across two months, the start alone.
 */
export function eventDateBadge(
  event: Pick<EventSummary, 'startsAt' | 'endsAt'>,
  timeZone: string,
  t: Translator,
): string {
  const month = badgeMonth(event.startsAt, timeZone);
  const startKey = tenantDayKey(event.startsAt, timeZone);
  const endKey = tenantDayKey(event.endsAt, timeZone);
  if (startKey !== endKey && startKey.slice(0, 7) === endKey.slice(0, 7)) {
    return t('card.dateRange', {
      start: badgeDay(event.startsAt, timeZone),
      end: badgeDay(event.endsAt, timeZone),
      month,
    });
  }
  return t('card.date', { day: badgeDay(event.startsAt, timeZone), month });
}

/** The card's top-left pill (2026-10-03, the REINE poster). */
export type EventCardBadge = {
  kind: 'registered' | 'participated' | 'date' | 'live' | 'ended' | 'cancelled';
  label: string;
};

type CardEvent = Pick<
  EventSummary,
  'startsAt' | 'endsAt' | 'status' | 'viewerStatus' | 'viewerCheckedInAt'
>;

/**
 * The pill, in priority order: `Cancelado` → once ended, `Participou` (the viewer checked in) or
 * `Encerrado` → `Inscrito` (the viewer is in: a "Vou" or a check-in) → `Agora` (in progress) → the
 * date (`28 SET`).
 */
export function eventCardBadge(
  event: CardEvent,
  timeZone: string,
  nowMs: number,
  t: Translator,
): EventCardBadge {
  if (event.status === 'cancelled') return { kind: 'cancelled', label: t('state.cancelled') };
  const phase = eventPhase(event.startsAt, event.endsAt, nowMs);
  if (phase === 'P3') {
    return event.viewerCheckedInAt !== null
      ? { kind: 'participated', label: t('card.participated') }
      : { kind: 'ended', label: t('state.ended') };
  }
  if (isViewerIn(event)) return { kind: 'registered', label: t('card.registered') };
  if (phase === 'P2') return { kind: 'live', label: t('when.now') };
  return { kind: 'date', label: eventDateBadge(event, timeZone, t) };
}

/** What the line under the place reads: the card's own state plus the limit and its count. */
type CardNoteEvent = CardEvent & Pick<EventSummary, 'capacity' | 'confirmedCount'>;

/**
 * The line under the place, never on a cancelled event:
 * - on an event the viewer is in that has not ended: `Acontecendo agora` while it runs, `É hoje!`,
 *   then `Falta 1 dia` / `Faltam N dias`, in tenant-local calendar days;
 * - (2026-10-03, the REINE rule) on an event that is NOT the viewer's, while answers are still open
 *   (before the start, D-204) and it has a limit: `Últimas N vagas` (`Última vaga` for one) when
 *   1 to `EVENT_LOW_SPOTS` spots are left, `Vagas esgotadas` when none is. The viewer's own events
 *   keep their countdown: their spot is already theirs.
 * Undefined otherwise: the card then ends at the place.
 */
export function eventCardNote(
  event: CardNoteEvent,
  timeZone: string,
  nowMs: number,
  t: Translator,
): string | undefined {
  if (event.status === 'cancelled') return undefined;
  const phase = eventPhase(event.startsAt, event.endsAt, nowMs);
  if (!isViewerIn(event)) {
    if (!rsvpOpen(event, nowMs)) return undefined;
    const left = spotsLeft(event);
    if (left === null || left > EVENT_LOW_SPOTS) return undefined;
    return left === 0 ? t('card.soldOut') : t('card.spotsLeft', { count: left });
  }
  if (phase === 'P3') return undefined;
  if (phase === 'P2') return t('card.live');
  const days = tenantDaysUntil(event.startsAt, timeZone, nowMs);
  return days <= 0 ? t('card.today') : t('card.countdown', { count: days });
}

/**
 * The poster's place line (2026-10-03): `Online` for an online event; for an in-person one, the
 * city of a composed address as the REINE poster prints it (`São Paulo, SP`, `parseEventAddress`),
 * or the venue name when the address is a legacy free text the parser cannot read.
 */
function cardPlace(event: Pick<EventSummary, 'format' | 'venueName' | 'address'>, t: Translator) {
  if (event.format === 'online') return t('place.online');
  const parts = event.address ? parseEventAddress(event.address) : null;
  if (parts) return t('card.city', { city: parts.city, state: parts.state });
  return event.venueName ?? '';
}

/** Everything `EventPoster` renders, as finished strings: no instant crosses to the client. */
export type EventCardView = {
  id: string;
  href: string;
  title: string;
  /**
   * The event's own category ("Workshop", 2026-10-03), or, when it has none, the format's words:
   * "Evento presencial" or "Evento online".
   */
  category: string;
  /** "São Paulo, SP" for a composed address, else the venue name; "Online" online. */
  place: string;
  placeKind: 'venue' | 'online';
  badge: EventCardBadge;
  /** The countdown or the "Últimas N vagas" line, or undefined for none. */
  note?: string;
  ariaLabel: string;
  coverAssetId: string | null;
  coverVariantWidths: number[];
  coverAlt: string;
  grayscale: boolean;
};

/**
 * `EventSummary` → `EventCardView`, in the tenant's timezone, from ONE request instant. The card
 * prints no full date, so its name carries it: the title, the when-line, then the pill and the
 * countdown as the card shows them (a date pill, or `Agora` beside the in-progress when-line, would
 * only repeat it).
 */
export function eventCardView(
  event: EventSummary,
  { tz, nowMs, t }: { tz: string; nowMs: number; t: Translator },
): EventCardView {
  const online = event.format === 'online';
  const badge = eventCardBadge(event, tz, nowMs, t);
  const note = eventCardNote(event, tz, nowMs, t);
  const whenLine = eventWhenLine(event, tz, nowMs, t);
  const when = [
    whenLine.text,
    ...(badge.kind === 'date' || badge.kind === 'live' ? [] : [badge.label]),
    ...(note === undefined || whenLine.live ? [] : [note]),
  ].join(', ');
  return {
    id: event.id,
    href: `/eventos/${event.id}`,
    title: event.title,
    category: event.category ?? t(online ? 'card.online' : 'card.inPerson'),
    place: cardPlace(event, t),
    placeKind: online ? 'online' : 'venue',
    badge,
    ...(note === undefined ? {} : { note }),
    ariaLabel: t('poster.label', { title: event.title, when }),
    coverAssetId: event.coverAssetId,
    coverVariantWidths: event.coverVariantWidths,
    coverAlt: t('cover.alt', { title: event.title }),
    grayscale: event.status === 'cancelled',
  };
}

/** The two galleries, finished. */
export type EventSectionsView = { mine: EventCardView[]; others: EventCardView[] };

/** Both periods → the two galleries' cards (`splitEventSections`, then `eventCardView`). */
export function eventSectionsView(
  { upcoming, past }: { upcoming: readonly EventSummary[]; past: readonly EventSummary[] },
  ctx: { tz: string; nowMs: number; t: Translator },
): EventSectionsView {
  const { mine, others } = splitEventSections(upcoming, past);
  return {
    mine: mine.map((event) => eventCardView(event, ctx)),
    others: others.map((event) => eventCardView(event, ctx)),
  };
}

/**
 * D-203 / UI-D-205: the universal Google Maps search link, which opens the maps app on iOS and
 * Android. An outbound, user-tapped link: no embed, no static map, no SDK. The query, URI-encoded
 * (accents, commas and line breaks included), is:
 * - for an address composed from its parts (PDF item #10, `parseEventAddress`), the canonical
 *   address alone, `Avenida Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200`: the most
 *   precise search, which a venue name in front would only blur;
 * - for a legacy free text, the venue and the address joined by a comma, byte for byte as before.
 */
export function mapsHref(venue: string, address: string): string {
  const parts = parseEventAddress(address);
  const query = parts ? addressMapsQuery(parts) : `${venue}, ${address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** One info cell as `EventInfoGrid` renders it. */
export type EventInfoCellView = {
  icon: 'date' | 'time' | 'place' | 'online' | 'people' | 'spots' | 'dress';
  label: string;
  value: string;
};

/* ── 2026-10-06: the REINE detail page's extra pieces ─────────────────────────────────────── */

/** Whole UTC-midnight days between two tenant day keys (`2026-10-12`). */
function dayKeyDiff(from: string, to: string): number {
  const utc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** `HH:MM` → minutes after midnight. */
const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * The event's hours of content: the plain duration for a one-day event; for one that spans days,
 * the daily window (start time to end time, tenant-local) times the days, so the nights between
 * never count. One decimal at most ("16", "2,5" in the copy).
 */
export function eventHours(event: Pick<EventSummary, 'startsAt' | 'endsAt'>, tz: string): number {
  const span = (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 3_600_000;
  if (!isMultiDay(event, tz)) return Math.max(0, Math.round(span * 10) / 10);
  const days = dayKeyDiff(tenantDayKey(event.startsAt, tz), tenantDayKey(event.endsAt, tz)) + 1;
  const daily =
    (minutesOf(formatEventTime(event.endsAt, tz)) -
      minutesOf(formatEventTime(event.startsAt, tz))) /
    60;
  if (daily <= 0) return Math.max(0, Math.round(span));
  return Math.round(daily * days * 10) / 10;
}

/**
 * The EXAMPLE ticket code of the REINE "Inscrição confirmada" card (`RR-2609` there): there are no
 * tickets in the system, so the page marks it as an example. Stable per event and member (a hash of
 * the two ids), with the tenant's initials, so it reads the same on every visit.
 */
export function exampleTicketCode(eventId: string, viewerId: string, tenantName: string): string {
  let hash = 0;
  for (const char of `${eventId}:${viewerId}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const initials = tenantName
    .normalize('NFD')
    .replace(/[^A-Za-z ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2)
    .padEnd(2, 'X');
  return `${initials}-${String(hash % 10_000).padStart(4, '0')}`;
}

/** The "Como chegar" block: what the map searches, the address line and the area for stays. */
export type EventMapView = {
  /** The map's search for the venue itself (the address, Google's order). */
  query: string;
  venue: string;
  /** `Av. das Nações Unidas, 12551, Brooklin, São Paulo/SP`. */
  addressLine: string;
  /** The neighbourhood search for stays (`Brooklin, São Paulo/SP`). */
  areaQuery: string;
  /** `Brooklin`, or the city without a district. */
  areaLabel: string;
};

export function eventMapView(venue: string, address: string): EventMapView | null {
  if (venue === '' && address === '') return null;
  const parts = address === '' ? null : parseEventAddress(address);
  if (!parts) {
    const line = address.replace(/\s*\n\s*/g, ', ');
    const query = [venue, line].filter(Boolean).join(', ');
    return { query, venue, addressLine: line, areaQuery: query, areaLabel: venue || line };
  }
  const place = `${parts.city}/${parts.state}`;
  // The complement (the room, the block) stays on the line: at the venue it is what people look for.
  const addressLine = [
    `${parts.street}, ${parts.number || 's/n'}`,
    parts.complement,
    parts.district,
    place,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    query: addressMapsQuery(parts),
    venue,
    addressLine,
    areaQuery: parts.district ? `${parts.district}, ${place}` : place,
    areaLabel: parts.district || parts.city,
  };
}

/** The hero's place line: `{venue} · {cidade}, {UF}` when the address names its city. */
function heroPlace(venue: string, address: string): string {
  const parts = address === '' ? null : parseEventAddress(address);
  return parts ? `${venue} · ${parts.city}, ${parts.state}` : venue;
}

/** The REINE cards' countdown: "É hoje!", or "Falta 1 dia" / "Faltam N dias" (tenant days). */
export function eventCountdown(
  event: Pick<EventSummary, 'startsAt'>,
  tz: string,
  nowMs: number,
  t: Translator,
): string {
  const days = tenantDaysUntil(event.startsAt, tz, nowMs);
  return days <= 0 ? t('reine.mine.today') : t('reine.mine.countdown', { count: days });
}

/** The cards' date: `seg., 12 de out.`, or the range of an event that spans days. */
export function eventDateLabel(
  event: Pick<EventSummary, 'startsAt' | 'endsAt'>,
  tz: string,
  nowMs: number,
  t: Translator,
): string {
  return isMultiDay(event, tz)
    ? multiDayRange(event, tz, nowMs, t)
    : formatEventDate(event.startsAt, tz, nowMs);
}

/** The cards' place line: `{venue} · {cidade}, {UF}`, or "Online". */
export function eventPlaceLine(
  event: Pick<EventSummary, 'format' | 'venueName' | 'address'>,
  t: Translator,
): string {
  if (event.format === 'online') return t('place.online');
  return heroPlace(event.venueName ?? '', event.address ?? '');
}

/** One day of the programme (REINE "Programação"). */
export type ScheduleDayView = {
  label: string;
  date: string;
  items: Array<{ time: string; title: string; note?: string }>;
};

/**
 * The detail's programme: the organiser's own (the form's "Cronograma", stored with the step-2
 * block), or, without one, an EXAMPLE the page marks as such.
 */
export type EventScheduleView = { days: ScheduleDayView[]; example: boolean };

/**
 * The organiser's programme by day: one tab per day that has moments, each dated from the event's
 * start in the tenant's zone (day 2 is the day after the start), its moments in their stored order.
 */
function organiserSchedule(
  event: Pick<EventSummary, 'startsAt'>,
  schedule: readonly ScheduleItem[],
  tz: string,
  nowMs: number,
  t: Translator,
): ScheduleDayView[] {
  const days = [...new Set(schedule.map((moment) => moment.day))];
  return days.map((day) => ({
    label: t('reine.schedule.day', { n: day }),
    date: formatDayMonth(
      new Date(Date.parse(event.startsAt) + (day - 1) * 86_400_000).toISOString(),
      tz,
      nowMs,
    ),
    items: schedule
      .filter((moment) => moment.day === day)
      .map(({ time, title }) => ({ time, title })),
  }));
}

const SCHEDULE_MAX_DAYS = 4;

/**
 * The example programme: one tab per tenant-local day of the event (up to four), each with the
 * day's real window (start time to end time) split into the REINE rhythm: arrival, opening, break,
 * closing. Only the times are the event's; the titles are illustrative and the page says so.
 */
function exampleSchedule(
  event: Pick<EventSummary, 'startsAt' | 'endsAt'>,
  tz: string,
  nowMs: number,
  t: Translator,
): ScheduleDayView[] | null {
  const start = minutesOf(formatEventTime(event.startsAt, tz));
  const end = minutesOf(formatEventTime(event.endsAt, tz));
  const days = isMultiDay(event, tz)
    ? dayKeyDiff(tenantDayKey(event.startsAt, tz), tenantDayKey(event.endsAt, tz)) + 1
    : 1;
  const dayEnd = days === 1 ? start + Math.round(eventHours(event, tz) * 60) : end;
  if (dayEnd - start < 60) return null;
  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const middle = start + Math.round((dayEnd - start) / 2 / 30) * 30;
  return Array.from({ length: Math.min(days, SCHEDULE_MAX_DAYS) }, (_, index) => {
    const day = new Date(Date.parse(event.startsAt) + index * 86_400_000).toISOString();
    return {
      label: t('reine.schedule.day', { n: index + 1 }),
      date: formatDayMonth(day, tz, nowMs),
      items: [
        {
          time: clock(start),
          title: t(index === 0 ? 'reine.schedule.arrival' : 'reine.schedule.welcomeBack'),
        },
        { time: clock(start + 30), title: t('reine.schedule.opening') },
        { time: clock(middle), title: t('reine.schedule.break') },
        { time: clock(dayEnd), title: t('reine.schedule.closing') },
      ],
    };
  });
}

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
    /** The event's own category, the hero's top-left pill (2026-10-03); null draws none. */
    category: string | null;
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
  /**
   * 2026-10-03: the event has a limit and no spot is left for a NEW confirmation. The action zone
   * says so under the RSVP pair to a viewer who is not already going; the database still decides.
   */
  full: boolean;
  format: 'in_person' | 'online';
  /** ISO instants for the client's boundary refresh (UI-D-203). */
  checkinOpensAt: string;
  startsAt: string;
  endsAt: string;
  /** The start as the tenant's wall-clock `HH:MM` (the online P0 hint, 06-06). */
  startTime: string;
  /**
   * 06-08 (UI-D-210): whether the calendar pair ("Adicionar à agenda") renders — P0-P2 for EVERY
   * member whatever their answer, never for a cancelled or ended event (no export of an event that
   * will not happen).
   */
  calendar: boolean;
  /* ── 2026-10-06, the REINE detail page ── */
  /** The organiser's "Informações úteis" (the form's step 2, stored in the description), or null. */
  extras: EventExtras | null;
  /**
   * "Inscrição confirmada": the viewer is going (or present) and the event is not cancelled nor
   * over. `ticketCode` is an EXAMPLE (the system issues no tickets) and the page says so.
   */
  registration: { ticketCode: string } | null;
  /** "Você participou deste evento": checked in to an event that is over. */
  participation: { line: string } | null;
  /** The event's hours of content (`eventHours`). */
  hours: number;
  /** "Como chegar": in person only, null online or without a venue. */
  map: EventMapView | null;
  /**
   * "Programação": the organiser's programme, for every viewer; without one, the EXAMPLE programme
   * for an `engaged` viewer only; null otherwise.
   */
  schedule: EventScheduleView | null;
  /** The viewer is going, or present at an event not yet over: the REINE sections meant for them. */
  engaged: boolean;
  past: boolean;
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
 * "Realizado às 18:42", or "Realizado em sáb., 12 de out., às 18:42" when the check-in happened on
 * another tenant-local day than `nowMs` (UI-D-207). ONE definition for the detail's checked-in banner,
 * the ticket's done state and the check-in action's answer, so the three can never word it apart.
 */
export function checkedInLine(at: string, tz: string, nowMs: number, t: Translator): string {
  const time = formatEventTime(at, tz);
  return tenantDayKey(at, tz) === tenantDayKey(nowMs, tz)
    ? t('checkin.doneAt', { time })
    : t('checkin.doneOn', { date: formatEventDate(at, tz, nowMs), time });
}

/**
 * The info grid's "Vagas" cell (2026-10-03), only for an event with a limit: while answers are open
 * (before the start, not cancelled) the spots a new confirmation could take ("Restam 12 de 50",
 * "Esgotadas (50 vagas)"); afterwards, or when cancelled, the limit alone ("50 vagas"), since nobody
 * can confirm any more.
 */
function spotsCell(
  event: Pick<EventDetail, 'capacity' | 'confirmedCount' | 'startsAt' | 'endsAt' | 'status'>,
  nowMs: number,
  t: Translator,
): EventInfoCellView | null {
  const capacity = event.capacity;
  const left = spotsLeft(event);
  if (capacity === null || left === null) return null;
  const value = !rsvpOpen(event, nowMs)
    ? t('info.spotsLimit', { capacity })
    : left === 0
      ? t('info.spotsFull', { capacity })
      : t('info.spotsLeft', { count: left, capacity });
  return { icon: 'spots', label: t('info.spots'), value };
}

/**
 * `EventDetail` → `EventDetailView` (UI-D-204): the header pill, the hero, the banner, the info
 * cells (four, plus "Vagas" for an event with a limit), the location and the action-zone phase, all
 * in the TENANT's timezone from ONE request instant.
 */
export function eventDetailView(
  event: EventDetail,
  {
    tz,
    nowMs,
    t,
    viewerId = '',
    tenantName = '',
  }: { tz: string; nowMs: number; t: Translator; viewerId?: string; tenantName?: string },
): EventDetailView {
  const online = event.format === 'online';
  const cancelled = event.status === 'cancelled';
  const phase = eventPhase(event.startsAt, event.endsAt, nowMs);
  const state = viewerState(event, nowMs);
  // 2026-10-06 (REINE): "Inscrito" in green while going; "Participou" once a check-in is over.
  const headerPill =
    state === 'cancelled'
      ? { tone: 'danger' as const, label: t('state.cancelled') }
      : state === 'present'
        ? phase === 'P3'
          ? { tone: 'brand' as const, label: t('state.participated') }
          : { tone: 'success' as const, label: t('state.present') }
        : state === 'going'
          ? { tone: 'success' as const, label: t('state.going') }
          : null;
  const { text: description, extras } = splitEventDescription(event.description);
  const hours = eventHours(event, tz);
  const engaged = state === 'going' || (state === 'present' && phase !== 'P3');
  // The organiser's programme for everyone; the example one only for a viewer who is in for it.
  const exampleDays =
    engaged && !extras?.schedule.length ? exampleSchedule(event, tz, nowMs, t) : null;
  const schedule: EventScheduleView | null = extras?.schedule.length
    ? { days: organiserSchedule(event, extras.schedule, tz, nowMs, t), example: false }
    : exampleDays
      ? { days: exampleDays, example: true }
      : null;

  let banner: EventBannerView | null = null;
  if (cancelled) {
    banner = { kind: 'cancelled', title: t('cancelled.title'), body: t('cancelled.body') };
  } else if (event.viewerCheckedInAt !== null) {
    banner = {
      kind: 'checkedIn',
      title: t('checkin.banner'),
      body: checkedInLine(event.viewerCheckedInAt, tz, nowMs, t),
    };
  }

  const multiDay = isMultiDay(event, tz);
  const start = formatEventTime(event.startsAt, tz);
  const end = formatEventTime(event.endsAt, tz);
  const past = phase === 'P3';
  const info: EventInfoCellView[] = [
    // REINE (2026-10-06): an event over several days reads "Dias" and, when it runs by day, its
    // daily window ("08:00 às 18:00"); one that runs through the night keeps "Começa · termina".
    {
      icon: 'date',
      label: multiDay ? t('info.days') : t('info.date'),
      value: multiDay
        ? multiDayRange(event, tz, nowMs, t)
        : formatEventDate(event.startsAt, tz, nowMs),
    },
    {
      icon: 'time',
      label: t('info.time'),
      value:
        multiDay && minutesOf(end) <= minutesOf(start)
          ? t('info.timeRangeMultiDay', { start, end })
          : t('info.timeRange', { start, end }),
    },
    {
      icon: online ? 'online' : 'place',
      label: t('info.place'),
      value: online ? t('place.online') : (event.venueName ?? ''),
    },
    // REINE's fourth cell is the dress code when the organiser gave one; the count otherwise.
    extras?.dressCode
      ? { icon: 'dress', label: t('info.dressCode'), value: extras.dressCode }
      : past
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
  // After the count cell, so `countIndex` (the polite live region) keeps pointing at the count. With
  // a dress code the grid is REINE's four cells exactly, so the limit is left out.
  const spots = extras?.dressCode ? null : spotsCell(event, nowMs, t);
  if (spots) info.push(spots);

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
      category: event.category,
      place: online ? t('place.online') : heroPlace(venue, address),
      placeKind: online ? 'online' : 'venue',
      coverAssetId: event.coverAssetId,
      coverVariantWidths: event.coverVariantWidths,
      coverAlt: t('cover.alt', { title: event.title }),
    },
    banner,
    description,
    info,
    countIndex: extras?.dressCode ? -1 : 3,
    location,
    phase,
    cancelled,
    full: spotsLeft(event) === 0,
    format: event.format,
    checkinOpensAt: new Date(
      Date.parse(event.startsAt) - EVENT_CHECKIN_OPENS_BEFORE_MINUTES * 60_000,
    ).toISOString(),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    startTime: start,
    calendar: !cancelled && phase !== 'P3',
    extras,
    // Going and not yet present: once checked in, the "Check-in confirmado" banner says it.
    registration:
      state === 'going' ? { ticketCode: exampleTicketCode(event.id, viewerId, tenantName) } : null,
    participation:
      phase === 'P3' && event.viewerCheckedInAt !== null && !cancelled
        ? {
            line: extras?.certificate
              ? extras.certificate.hours
                ? t('reine.participated.certificate', { hours: extras.certificate.hours })
                : t('reine.participated.certificateNoHours')
              : t('reine.participated.hours', { hours: formatHours(hours) }),
          }
        : null,
    hours,
    map: online ? null : eventMapView(venue, address),
    schedule,
    engaged,
    past,
  };
}

/** `16`, `2,5`: hours with at most one decimal, pt-BR. */
export function formatHours(hours: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(hours);
}

/**
 * What the action-zone island (`EventActions`, UI-D-207) needs to decide its RSVP rows, as plain
 * serialisable values: the phase the SERVER computed from the request instant, the flags, the
 * viewer's recorded answer, and the three ISO boundaries the island's one scheduled refresh targets
 * (UI-D-203). No instant is formatted and no clock is read on the client to draw it.
 *
 * `answer` is the recorded RSVP only (`going` / `not_going`); a check-in (`checked_in`, `walk_in`)
 * is `checkedIn` instead, and then the zone shows no RSVP row at all (the banner says it).
 *
 * `startTime` (06-06) is the start already formatted on the server in the tenant zone, for the online
 * P0 hint "A transmissão começa às {time}." — the island formats no instant. The zone never receives
 * the meeting URL: every `Entrar` points at `/eventos/{id}/entrar` (D-207).
 */
export type EventActionState = {
  eventId: string;
  phase: EventPhase;
  format: 'in_person' | 'online';
  cancelled: boolean;
  /**
   * 2026-10-03: no spot is left for a NEW confirmation (`EventDetailView.full`). Optional so a host
   * that predates limits draws the zone exactly as before; the server always sends it.
   */
  full?: boolean;
  answer: RsvpAnswer | null;
  checkedIn: boolean;
  checkinOpensAt: string;
  startsAt: string;
  endsAt: string;
  startTime: string;
};

/** `EventDetail` + its `EventDetailView` → the island's props (the view already holds the phase). */
export function eventActionState(
  event: Pick<EventDetail, 'id' | 'viewerStatus' | 'viewerCheckedInAt'>,
  view: Pick<
    EventDetailView,
    | 'phase'
    | 'format'
    | 'cancelled'
    | 'full'
    | 'checkinOpensAt'
    | 'startsAt'
    | 'endsAt'
    | 'startTime'
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
    full: view.full,
    answer,
    checkedIn: event.viewerCheckedInAt !== null,
    checkinOpensAt: view.checkinOpensAt,
    startsAt: view.startsAt,
    endsAt: view.endsAt,
    startTime: view.startTime,
  };
}

/* ── 06-05: the check-in boarding pass (`/eventos/[eventId]/check-in`, UI-D-208) ───────────────── */

/**
 * The ticket's bottom section, ONE state at a time (UI E08/partial): the code form, or a finished
 * state with no form. `done` carries the "Realizado às …" line; the three closed states carry their
 * sentence.
 */
export type EventTicketSection =
  | { kind: 'open' }
  | { kind: 'done'; doneLine: string }
  | { kind: 'notOpenYet'; sentence: string }
  | { kind: 'closed'; sentence: string }
  | { kind: 'cancelled'; sentence: string };

/** Everything `/eventos/[eventId]/check-in` renders, as finished strings. */
export type EventTicketView = {
  id: string;
  title: string;
  /** The cover overline: the contract date, `sáb., 12 de out.` (UI-D-203). */
  overline: string;
  place: string;
  coverAssetId: string | null;
  coverVariantWidths: number[];
  coverAlt: string;
  /** Exactly three: Data, Horário (the start), Local. */
  cells: EventInfoCellView[];
  section: EventTicketSection;
};

/**
 * `EventDetail` → `EventTicketView` (UI-D-208), in the TENANT's timezone from ONE request instant.
 *
 * **The section, in precedence order:** `done` when the viewer is already present (a walk-in
 * included), then `cancelled`, then `closed` from `ends_at`, then `notOpenYet` before
 * `starts_at − 1 h` (D-209), otherwise `open`. The window here only decides what to DRAW; the
 * database decides whether a check-in lands (`app.events_check_in`), and a race comes back as the
 * form's inline refusal.
 *
 * `notOpenYet`'s `{when}` is "às 18:00" when the window opens on the same tenant-local day as the
 * request, or "em sáb., 12 de out., às 18:00" otherwise.
 *
 * **The Data cell prints the date WITHOUT the weekday** (`12 de out.`; a multi-day event prints its
 * range, `12 a 14 de out.`). Measured in Chromium on the built page: the contract date
 * (`sáb., 12 de out.`, ~104px at 14/700) fits the 106px cell of a 390px ticket with 2px to spare, but
 * is cut to "sáb., 12 de o…" in the 83px cell at 320px (the 06-02 drawing's finding, which it placed
 * at 390); a year-suffixed date would be cut at both. `12 de out.` fits at both widths, and the cover
 * overline above already carries the weekday. Same formatter, no new token or size; the
 * `events check-in` e2e asserts the cell is not cut at 390 and 320.
 */
export function eventTicketView(
  event: EventDetail,
  { tz, nowMs, t }: { tz: string; nowMs: number; t: Translator },
): EventTicketView {
  const venue = event.venueName ?? '';
  const opensAtMs = Date.parse(event.startsAt) - EVENT_CHECKIN_OPENS_BEFORE_MINUTES * 60_000;

  let section: EventTicketSection;
  if (event.viewerCheckedInAt !== null) {
    section = { kind: 'done', doneLine: checkedInLine(event.viewerCheckedInAt, tz, nowMs, t) };
  } else if (event.status === 'cancelled') {
    section = { kind: 'cancelled', sentence: t('errors.cancelled') };
  } else if (nowMs >= Date.parse(event.endsAt)) {
    section = { kind: 'closed', sentence: t('checkin.closed') };
  } else if (nowMs < opensAtMs) {
    const opens = new Date(opensAtMs).toISOString();
    const time = formatEventTime(opens, tz);
    const when =
      tenantDayKey(opens, tz) === tenantDayKey(nowMs, tz)
        ? t('checkin.opensAt', { time })
        : t('checkin.opensOn', { date: formatEventDate(opens, tz, nowMs), time });
    section = { kind: 'notOpenYet', sentence: t('checkin.notOpenYet', { when }) };
  } else {
    section = { kind: 'open' };
  }

  return {
    id: event.id,
    title: event.title,
    overline: formatEventDate(event.startsAt, tz, nowMs),
    place: venue,
    coverAssetId: event.coverAssetId,
    coverVariantWidths: event.coverVariantWidths,
    coverAlt: t('cover.alt', { title: event.title }),
    cells: [
      {
        icon: 'date',
        label: t('info.date'),
        value: isMultiDay(event, tz)
          ? multiDayRange(event, tz, nowMs, t)
          : formatDayMonth(event.startsAt, tz, nowMs),
      },
      { icon: 'time', label: t('info.time'), value: formatEventTime(event.startsAt, tz) },
      { icon: 'place', label: t('info.place'), value: venue },
    ],
    section,
  };
}

/* ── 06-06: the online `Entrar` refusal screens (UI-D-209) ──────────────────────────────────── */

/** A lowercase-or-uppercase RFC 4122-shaped id: the only `eventId` `/entrar` sends to the API. */
export const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `?motivo=` values of `/eventos/{id}/entrar/aviso` (UI-D-209), one per refusal the gate names.
 * The aviso page accepts EXACTLY these and nothing else (D-93).
 */
export const ENTER_NOTICE_REASONS = ['encerrado', 'cancelado', 'confirmar'] as const;
export type EnterNoticeReason = (typeof ENTER_NOTICE_REASONS)[number];

/** Which refusal screen each refusing outcome of the gate lands on. */
export const ENTER_NOTICE_FOR: Readonly<
  Record<Extract<EnterOutcome, 'ended' | 'cancelled' | 'confirm_first'>, EnterNoticeReason>
> = { ended: 'encerrado', cancelled: 'cancelado', confirm_first: 'confirmar' };

/* ── 06-07: Participantes (UI-D-213) ─────────────────────────────────────────────────────────────── */

/** The pt-BR `?lista=` value of each chip; the API's closed enum never appears in a URL. */
export const ATTENDANCE_LIST_PARAMS: Readonly<Record<AttendanceList, string>> = {
  confirmed: 'confirmados',
  present: 'presentes',
  not_going: 'nao-vao',
};

/**
 * `?lista=` -> the chip (D-93): only EXACTLY `presentes` or `nao-vao` select those chips; an array, a
 * re-cased or unknown value, or no value lands on Confirmados silently.
 */
export function attendanceListFromParam(value: string | string[] | undefined): AttendanceList {
  if (value === ATTENDANCE_LIST_PARAMS.present) return 'present';
  if (value === ATTENDANCE_LIST_PARAMS.not_going) return 'not_going';
  return 'confirmed';
}

/** The chip link. Confirmados is the bare path, so it is the one canonical URL of the default. */
export function participantsHref(eventId: string, list: AttendanceList): string {
  const base = `/eventos/${encodeURIComponent(eventId)}/participantes`;
  return list === 'confirmed' ? base : `${base}?lista=${ATTENDANCE_LIST_PARAMS[list]}`;
}

/** `'K7QM'` -> `'K, 7, Q, M'`: the code's accessible name, so a screen reader spells it (UI-D-213). */
export function spelledCode(code: string): string {
  return Array.from(code).join(', ');
}

/** One finished Participantes row: every string built here, on the server. */
export type AttendeeView = {
  id: string;
  /** The display name, or the catalog's "Membro removido" for a member who has left. */
  name: string;
  removed: boolean;
  avatarUrl: string | null;
  meta: string;
  walkIn: boolean;
};

/**
 * `Attendee` -> `AttendeeView` for the chip it is listed under, in the TENANT's timezone from ONE
 * request instant (UI-D-203). The meta line by chip:
 *  - `confirmed`: "Confirmou em {date}" (when they answered Vou);
 *  - `present`: "Check-in às {time}", or "Check-in em {date}, às {time}" when the check-in was on
 *    another tenant-local day than `nowMs`;
 *  - `not_going`: "Respondeu em {date}".
 * A member who has left (or, defensively, a row with no name) renders the removed label with the
 * neutral avatar, and the row still counts (D-219/A5). The avatar is the stable `/v1/media` path,
 * never a signed URL.
 */
export function attendeeView(
  attendee: Attendee,
  list: AttendanceList,
  { tz, nowMs, t }: { tz: string; nowMs: number; t: Translator },
): AttendeeView {
  const removed = attendee.removed || attendee.displayName === null;
  let meta = '';
  if (list === 'present' && attendee.checkedInAt) {
    const at = attendee.checkedInAt;
    const time = formatEventTime(at, tz);
    meta =
      tenantDayKey(at, tz) === tenantDayKey(nowMs, tz)
        ? t('participants.meta.presentAt', { time })
        : t('participants.meta.presentOn', { date: formatEventDate(at, tz, nowMs), time });
  } else if (attendee.respondedAt) {
    const date = formatEventDate(attendee.respondedAt, tz, nowMs);
    meta =
      list === 'not_going'
        ? t('participants.meta.notGoing', { date })
        : t('participants.meta.confirmed', { date });
  }
  return {
    id: attendee.id,
    name: removed ? t('participants.removed') : (attendee.displayName ?? ''),
    removed,
    avatarUrl: removed ? null : avatarUrlFor(attendee.avatarAssetId),
    meta,
    walkIn: attendee.walkIn,
  };
}
