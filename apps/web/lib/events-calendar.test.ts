import type { EventDetail } from '@rede-social/module-events/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  type CalendarEvent,
  calendarLocation,
  foldIcsLine,
  GOOGLE_DETAILS_MAX,
  googleCalendarHref,
  ICS_PRODID,
  icsEscape,
  utcStamp,
} from './events-calendar';

/**
 * EVENT-06 / D-211 — the calendar export as pure functions, byte by byte (RFC 5545 §3.1 folding,
 * §3.3.11 TEXT escaping; RESEARCH §Pattern 8). No clock is read: `nowMs` is passed in, so `DTSTAMP`
 * is deterministic here.
 *
 * The serializer receives the MEMBER-LANE `EventDetail`, which has no meeting-URL key (D-207). The
 * online cases below still hand it an object carrying a `meetingUrl`, to prove it reads only the
 * fields it names and that the online LOCATION is the app's own gated `/entrar` (T-06-51).
 */

const ORIGIN = 'https://comunidade.cliente.com.br';
const HOST = 'comunidade.cliente.com.br';
const NOW = Date.parse('2026-10-01T12:34:56.000Z');
const ID = '11111111-1111-4111-8111-111111111111';
/** An address the form composed from its parts (PDF item #10, `lib/event-address.ts`). */
const COMPOSED_ADDRESS =
  'Avenida Paulista, 1578\nSala 12, bloco B\nBela Vista, São Paulo - SP\nCEP 01310-200';

function event(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: ID,
    title: 'Encontro anual',
    format: 'in_person',
    category: null,
    capacity: null,
    venueName: 'Auditório da sede',
    address: 'Rua das Flores, 100',
    coverAssetId: null,
    coverVariantWidths: [],
    startsAt: '2026-10-12T22:00:00.000000Z',
    endsAt: '2026-10-13T00:00:00.000000Z',
    status: 'active',
    viewerStatus: null,
    viewerCheckedInAt: null,
    confirmedCount: 3,
    presentCount: 0,
    description: 'Traga um amigo.',
    viewerRespondedAt: null,
    ...overrides,
  };
}

const online = (overrides: Partial<EventDetail> = {}) =>
  ({
    ...event({ format: 'online', venueName: null, address: null, ...overrides }),
    // Not a key of EventDetail: a stray field must never reach the output.
    meetingUrl: 'https://meet.example.test/sala-secreta',
  }) as unknown as CalendarEvent;

const bytes = (line: string) => Buffer.byteLength(line, 'utf8');
/** RFC 5545 §3.1 unfolding: a CRLF followed by one space is removed. */
const unfold = (text: string) => text.replace(/\r\n /g, '');
/** The logical (unfolded) content lines of a serialised calendar. */
const logicalLines = (ics: string) => unfold(ics).split('\r\n');
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('utcStamp', () => {
  it('formats a microsecond ISO instant as the RFC 5545 UTC form', () => {
    expect(utcStamp('2026-10-12T22:00:00.000000Z')).toBe('20261012T220000Z');
  });

  it('formats epoch milliseconds, dropping the fraction', () => {
    expect(utcStamp(Date.parse('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z');
  });
});

describe('icsEscape', () => {
  it('escapes backslash first, then semicolon, comma and newlines', () => {
    expect(icsEscape('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  it('folds CRLF and a lone CR into one escaped newline each', () => {
    expect(icsEscape('um\r\ndois\rtrês')).toBe('um\\ndois\\ntrês');
  });
});

describe('foldIcsLine', () => {
  it('leaves a short line untouched', () => {
    expect(foldIcsLine('SUMMARY:Encontro anual')).toBe('SUMMARY:Encontro anual');
  });

  it('keeps every physical line within 75 octets and unfolds back to the original', () => {
    const line = `SUMMARY:${'ação é às '.repeat(40)}`;
    const folded = foldIcsLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    for (const piece of physical) expect(bytes(piece)).toBeLessThanOrEqual(75);
    for (const piece of physical.slice(1)) expect(piece.startsWith(' ')).toBe(true);
    expect(unfold(folded)).toBe(line);
  });

  it('never splits a multi-byte character at a fold boundary', () => {
    // 73 ASCII octets, then two-byte and four-byte characters straddling the 75-octet boundary.
    const line = `${'X'.repeat(73)}ãé😀ç${'Y'.repeat(100)}`;
    const folded = foldIcsLine(line);
    for (const piece of folded.split('\r\n')) {
      expect(bytes(piece)).toBeLessThanOrEqual(75);
      expect(LONE_SURROGATE.test(piece)).toBe(false);
      expect(Buffer.from(piece, 'utf8').toString('utf8')).toBe(piece);
    }
    expect(unfold(folded)).toBe(line);
  });
});

describe('calendarLocation', () => {
  it('is "{venue}, {address}" in person', () => {
    expect(calendarLocation(event(), ORIGIN)).toBe('Auditório da sede, Rua das Flores, 100');
  });

  it('is the app’s own /entrar online, never the meeting URL', () => {
    const location = calendarLocation(online(), ORIGIN);
    expect(location).toBe(`${ORIGIN}/eventos/${ID}/entrar`);
    expect(location).not.toContain('meet.example.test');
  });

  it('PDF item #10: puts an address composed from its parts on ONE line after the venue', () => {
    const structured = event({ address: COMPOSED_ADDRESS });
    expect(calendarLocation(structured, ORIGIN)).toBe(
      'Auditório da sede, Avenida Paulista, 1578, Sala 12, bloco B - Bela Vista, São Paulo - SP, 01310-200',
    );
    // The .ics LOCATION carries no escaped line break, and Google gets the same line.
    const lines = logicalLines(buildIcs(structured, { origin: ORIGIN, host: HOST, nowMs: NOW }));
    const location = lines.find((line) => line.startsWith('LOCATION:')) ?? '';
    expect(location).not.toContain('\\n');
    expect(location).toBe(
      'LOCATION:Auditório da sede\\, Avenida Paulista\\, 1578\\, Sala 12\\, bloco B - Bela Vista\\, São Paulo - SP\\, 01310-200',
    );
    expect(
      new URL(googleCalendarHref(structured, { origin: ORIGIN })).searchParams.get('location'),
    ).toBe(calendarLocation(structured, ORIGIN));
  });

  it('keeps a legacy multi-line address as stored', () => {
    const legacy = event({ address: 'Rua das Flores, 100\nBloco B, sala 12\nCentro' });
    expect(calendarLocation(legacy, ORIGIN)).toBe(
      'Auditório da sede, Rua das Flores, 100\nBloco B, sala 12\nCentro',
    );
  });
});

describe('buildIcs', () => {
  it('is one VCALENDAR with one VEVENT, every line ending in CRLF', () => {
    const ics = buildIcs(event(), { origin: ORIGIN, host: HOST, nowMs: NOW });
    expect(ics.endsWith('\r\n')).toBe(true);
    // No bare LF or CR anywhere: every line break is a CRLF.
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const lines = logicalLines(ics);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain(`PRODID:${ICS_PRODID}`);
    expect(ICS_PRODID).toBe('-//Rede Social//PT-BR');
    expect(lines).toContain('CALSCALE:GREGORIAN');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(1);
    expect(lines).toContain(`UID:${ID}@${HOST}`);
    expect(lines).toContain('DTSTAMP:20261001T123456Z');
    expect(lines).toContain('DTSTART:20261012T220000Z');
    expect(lines).toContain('DTEND:20261013T000000Z');
    expect(lines).toContain('SUMMARY:Encontro anual');
    expect(lines).toContain('STATUS:CONFIRMED');
    expect(lines).toContain(`URL:${ORIGIN}/eventos/${ID}`);
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('carries the description and the detail URL in DESCRIPTION, and the escaped place in LOCATION', () => {
    const lines = logicalLines(buildIcs(event(), { origin: ORIGIN, host: HOST, nowMs: NOW }));
    expect(lines).toContain(`DESCRIPTION:Traga um amigo.\\n\\n${ORIGIN}/eventos/${ID}`);
    expect(lines).toContain('LOCATION:Auditório da sede\\, Rua das Flores\\, 100');
  });

  it('marks a cancelled event STATUS:CANCELLED', () => {
    const lines = logicalLines(
      buildIcs(event({ status: 'cancelled' }), { origin: ORIGIN, host: HOST, nowMs: NOW }),
    );
    expect(lines).toContain('STATUS:CANCELLED');
    expect(lines).not.toContain('STATUS:CONFIRMED');
  });

  it('online: LOCATION is /entrar and the file never contains the meeting host', () => {
    const ics = buildIcs(online(), { origin: ORIGIN, host: HOST, nowMs: NOW });
    expect(logicalLines(ics)).toContain(`LOCATION:${ORIGIN}/eventos/${ID}/entrar`);
    expect(ics).not.toContain('meet.example.test');
    expect(ics).not.toContain('sala-secreta');
  });

  it('folds a 200-character accented title within 75 octets and unfolds back to the escaped original', () => {
    const title = 'Reunião de formação, ações e três câmeras; útil '.repeat(5).slice(0, 200);
    expect(Array.from(title)).toHaveLength(200);
    const ics = buildIcs(event({ title }), { origin: ORIGIN, host: HOST, nowMs: NOW });
    for (const physical of ics.split('\r\n')) {
      expect(bytes(physical)).toBeLessThanOrEqual(75);
      expect(LONE_SURROGATE.test(physical)).toBe(false);
    }
    expect(logicalLines(ics)).toContain(`SUMMARY:${icsEscape(title)}`);
  });

  it('a hostile title with an embedded newline and BEGIN:VEVENT stays ONE escaped SUMMARY in ONE VEVENT', () => {
    const title = 'Título; com, vírgula\r\nBEGIN:VEVENT\nUID:evil@attacker';
    const ics = buildIcs(event({ title }), { origin: ORIGIN, host: HOST, nowMs: NOW });
    const lines = logicalLines(ics);
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.some((line) => line.startsWith('UID:evil'))).toBe(false);
    expect(lines).toContain('SUMMARY:Título\\; com\\, vírgula\\nBEGIN:VEVENT\\nUID:evil@attacker');
  });
});

describe('googleCalendarHref', () => {
  it('is the TEMPLATE link with UTC dates, the title, the place and no ctz', () => {
    const href = googleCalendarHref(event(), { origin: ORIGIN });
    expect(href.startsWith('https://calendar.google.com/calendar/render?')).toBe(true);
    const url = new URL(href);
    expect(url.host).toBe('calendar.google.com');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Encontro anual');
    expect(url.searchParams.get('dates')).toBe('20261012T220000Z/20261013T000000Z');
    expect(url.searchParams.get('location')).toBe('Auditório da sede, Rua das Flores, 100');
    expect(url.searchParams.get('details')).toBe(`Traga um amigo.\n\n${ORIGIN}/eventos/${ID}`);
    expect(url.searchParams.has('ctz')).toBe(false);
  });

  it('online: the location is /entrar and the link never carries the meeting host', () => {
    const href = googleCalendarHref(online(), { origin: ORIGIN });
    expect(href.startsWith('https://calendar.google.com/calendar/render?')).toBe(true);
    expect(new URL(href).searchParams.get('location')).toBe(`${ORIGIN}/eventos/${ID}/entrar`);
    expect(href).not.toContain('meet.example.test');
  });

  it('truncates details to GOOGLE_DETAILS_MAX characters and keeps the detail URL', () => {
    const href = googleCalendarHref(event({ description: 'ação '.repeat(800) }), {
      origin: ORIGIN,
    });
    expect(GOOGLE_DETAILS_MAX).toBe(1000);
    expect(href.startsWith('https://calendar.google.com/calendar/render?')).toBe(true);
    const details = new URL(href).searchParams.get('details') ?? '';
    expect(Array.from(details).length).toBeLessThanOrEqual(GOOGLE_DETAILS_MAX);
    expect(details.endsWith(`${ORIGIN}/eventos/${ID}`)).toBe(true);
    expect(LONE_SURROGATE.test(details)).toBe(false);
  });
});
