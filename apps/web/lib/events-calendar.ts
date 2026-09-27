import type { EventDetail } from '@tria/module-events/contracts';

/**
 * 06-08 RED STUB — deliberately inert. Every export answers the empty string so the tests in
 * `events-calendar.test.ts` fail on their ASSERTIONS (not on an import error). The GREEN commit
 * replaces this whole file with the RFC 5545 serializer and the Google Calendar template link.
 */

export const ICS_PRODID = '';
export const GOOGLE_DETAILS_MAX = 0;

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

export function utcStamp(_iso: string | number): string {
  return '';
}

export function icsEscape(_text: string): string {
  return '';
}

export function foldIcsLine(_line: string): string {
  return '';
}

export function calendarLocation(_event: CalendarEvent, _origin: string): string {
  return '';
}

export function buildIcs(
  _event: CalendarEvent,
  _options: { origin: string; host: string; nowMs: number },
): string {
  return '';
}

export function googleCalendarHref(_event: CalendarEvent, _options: { origin: string }): string {
  return '';
}
