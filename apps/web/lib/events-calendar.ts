import type { EventDetail } from '@rede-social/module-events/contracts';
import { addressOneLine, parseEventAddress } from './event-address';

/**
 * EVENT-06 / D-211 — the calendar export, as pure server-side functions (RESEARCH §Pattern 8).
 *
 * Two outputs, one shape of input:
 * - `buildIcs` serialises ONE `VCALENDAR` holding ONE `VEVENT` per RFC 5545, for the `.ics` route
 *   (`/eventos/{id}/agenda.ics`): CRLF line ends, content lines folded at 75 OCTETS with CRLF + one
 *   space (never splitting a UTF-8 character: pt-BR accents are two bytes, an emoji four), and every
 *   TEXT value escaped (`\\`, `\;`, `\,`, `\n`), so admin-authored text can never open a property or
 *   a component of its own (T-06-50).
 * - `googleCalendarHref` builds Google Calendar's `action=TEMPLATE` link with UTC `…Z` dates and NO
 *   time-zone parameter (combining the two is what shifts the time; RESEARCH A2, confirmed at the
 *   phone UAT since no automated oracle exists), `details` bounded to `GOOGLE_DETAILS_MAX` characters.
 *
 * **The meeting URL cannot leak (D-207, T-06-51).** The input is the MEMBER-LANE `EventDetail`, which
 * has no meeting-URL key, and every function reads only the fields `CalendarEvent` names. An online
 * event's LOCATION is the app's own gated `{origin}/eventos/{id}/entrar`: a calendar tap goes through
 * the gate (which counts the check-in inside the window, 06-06) instead of around it.
 *
 * **No clock is read here.** `DTSTAMP` comes from the caller's `nowMs` (one read per request).
 *
 * `UID` is `{eventId}@{host}` and LOCATION is the `/entrar` path: both are a published contract once
 * an entry sits in a member's calendar (reversibility: costly), so neither may change shape.
 */

/** VCALENDAR `PRODID` (RFC 5545 §3.7.3): who produced the file. */
export const ICS_PRODID = '-//Rede Social//PT-BR';

/** The Google link's `details` cap, in characters, so the URL stays bounded (T-06-54). */
export const GOOGLE_DETAILS_MAX = 1000;

/** RFC 5545 §3.1: a content line is at most 75 octets, excluding the line break. */
const MAX_LINE_OCTETS = 75;
const CRLF = '\r\n';
const utf8 = new TextEncoder();

/** Exactly the fields the export reads: no meeting URL, no code, nobody else's row. */
export type CalendarEvent = Pick<
  EventDetail,
  | 'id'
  | 'title'
  | 'description'
  | 'format'
  | 'venueName'
  | 'address'
  | 'startsAt'
  | 'endsAt'
  | 'status'
>;

/** `2026-10-12T22:00:00.000000Z` (or epoch ms) → `20261012T220000Z`, the RFC 5545 UTC form. */
export function utcStamp(iso: string | number): string {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso);
  // `toISOString()` is always `YYYY-MM-DDTHH:MM:SS.sssZ`; drop the separators and the fraction.
  return new Date(ms)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/**
 * RFC 5545 §3.3.11 TEXT escaping: backslash FIRST (so the escapes added after it are not doubled),
 * then `;`, `,`, and every line break (CRLF, CR or LF) as the two characters `\n`.
 */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 folding on UTF-8 BYTE length: the first physical line holds at most 75 octets, each
 * continuation is CRLF + one space + at most 74 octets. The walk is by CODE POINT (`for…of`), so a
 * multi-byte character (or a surrogate pair) always stays whole on one side of a fold.
 */
export function foldIcsLine(line: string): string {
  const pieces: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const size = utf8.encode(char).length;
    if (currentBytes + size > limit) {
      pieces.push(current);
      current = ' ';
      currentBytes = 1;
      limit = MAX_LINE_OCTETS;
    }
    current += char;
    currentBytes += size;
  }
  pieces.push(current);
  return pieces.join(CRLF);
}

/** The detail page's absolute URL. */
const detailUrl = (event: Pick<CalendarEvent, 'id'>, origin: string) =>
  `${origin}/eventos/${event.id}`;

/**
 * The place, unescaped: in person `{venue}, {address}` (either half alone when the other is empty);
 * online the app's own `{origin}/eventos/{id}/entrar` — never the meeting URL (D-211). An address
 * composed from its parts (PDF item #10) goes on ONE line, `Avenida Paulista, 1578, Sala 12 - Bela
 * Vista, São Paulo - SP, 01310-200` (`addressOneLine`), the shape a calendar's LOCATION field and
 * its map search read; a legacy free text goes as it is stored.
 */
export function calendarLocation(event: CalendarEvent, origin: string): string {
  if (event.format === 'online') return `${detailUrl(event, origin)}/entrar`;
  const address = event.address ?? '';
  const parts = parseEventAddress(address);
  return [event.venueName ?? '', parts ? addressOneLine(parts) : address]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(', ');
}

/** The description followed by a blank line and the detail URL (just the URL when there is none). */
function descriptionWithLink(description: string, link: string): string {
  return description.trim().length > 0 ? `${description}\n\n${link}` : link;
}

/**
 * The `.ics` body: one `VCALENDAR` (`VERSION`, `PRODID`, `CALSCALE`, `METHOD:PUBLISH`) with one
 * `VEVENT` (`UID`, `DTSTAMP`, `DTSTART`/`DTEND` in UTC, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `URL`,
 * `STATUS`). Every line is folded and ends in CRLF, the last one included.
 */
export function buildIcs(
  event: CalendarEvent,
  { origin, host, nowMs }: { origin: string; host: string; nowMs: number },
): string {
  const link = detailUrl(event, origin);
  const location = calendarLocation(event, origin);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@${host}`,
    `DTSTAMP:${utcStamp(nowMs)}`,
    `DTSTART:${utcStamp(event.startsAt)}`,
    `DTEND:${utcStamp(event.endsAt)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    `DESCRIPTION:${icsEscape(descriptionWithLink(event.description, link))}`,
    ...(location.length > 0 ? [`LOCATION:${icsEscape(location)}`] : []),
    `URL:${link}`,
    `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/**
 * `details` within `GOOGLE_DETAILS_MAX` characters (code points), keeping the detail URL whole at the
 * end: only the description is shortened, with an ellipsis.
 */
function googleDetails(description: string, link: string): string {
  const full = descriptionWithLink(description, link);
  if (Array.from(full).length <= GOOGLE_DETAILS_MAX) return full;
  const room = GOOGLE_DETAILS_MAX - Array.from(link).length - 3; // '…' + the blank line
  if (room <= 0) return link;
  return `${Array.from(description).slice(0, room).join('').trimEnd()}…\n\n${link}`;
}

/**
 * Google Calendar's template link: `action=TEMPLATE`, `text`, `dates={startUTC}/{endUTC}`, `details`
 * and `location`, encoded by `URLSearchParams`. The dates are UTC `…Z`, and no time-zone parameter is
 * sent (RESEARCH A2).
 */
export function googleCalendarHref(event: CalendarEvent, { origin }: { origin: string }): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', event.title);
  params.set('dates', `${utcStamp(event.startsAt)}/${utcStamp(event.endsAt)}`);
  params.set('details', googleDetails(event.description, detailUrl(event, origin)));
  const location = calendarLocation(event, origin);
  if (location.length > 0) params.set('location', location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
