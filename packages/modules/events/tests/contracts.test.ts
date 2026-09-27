import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_STATUSES,
  EVENT_ISSUE_SET,
  EVENT_ISSUES,
  EVENT_MAX_PAGE_SIZE,
  EVENT_PAGE_SIZE,
  eventDetailSchema,
  eventEditSchema,
  eventInputSchema,
  eventQuerySchema,
  eventStatusUpdateSchema,
  eventSummarySchema,
  RSVP_ANSWERS,
  rsvpResultSchema,
  rsvpSchema,
} from '../contracts/index';

/**
 * The published contract, pinned without a server: every refusal code `eventInputSchema` raises
 * (D-213, D-217), the `https:`-only URL rule, the closed `period` enum and the clamping `limit`.
 *
 * A refusal is read the way the route's `defaultHook` reads it: the FIRST issue message that is in
 * `EVENT_ISSUE_SET` becomes `details.event`.
 */

const base = {
  title: 'Encontro anual',
  format: 'in_person',
  venueName: 'Auditório da sede',
  address: 'Rua das Flores, 100',
  start: { date: '2026-10-12', time: '19:00' },
  end: { date: '2026-10-12', time: '21:00' },
};

const online = {
  title: 'Live de outubro',
  format: 'online',
  meetingUrl: 'https://meet.google.com/abc',
  start: { date: '2026-10-12', time: '19:00' },
  end: { date: '2026-10-12', time: '21:00' },
};

/** The machine code the route would lift into `details.event`, or null when the body parses. */
function refusal(body: unknown): string | null {
  const result = eventInputSchema.safeParse(body);
  if (result.success) return null;
  return (
    result.error.issues.map((issue) => issue.message).find((m) => EVENT_ISSUE_SET.has(m)) ??
    'generic'
  );
}

describe('eventInputSchema — the refusal vocabulary', () => {
  it('1. a valid in-person and a valid online body both parse (positive controls)', () => {
    expect(refusal(base)).toBeNull();
    expect(refusal(online)).toBeNull();
    // Title and description default and trim.
    const parsed = eventInputSchema.parse({ ...base, title: '  Encontro  ' });
    expect(parsed.title).toBe('Encontro');
    expect(parsed.description).toBe('');
  });

  it('2. name_required: an empty or blank title', () => {
    expect(refusal({ ...base, title: '' })).toBe('name_required');
    expect(refusal({ ...base, title: '   ' })).toBe('name_required');
    const { title: _title, ...untitled } = base;
    expect(refusal(untitled)).toBe('name_required');
  });

  it('3. end_before_start: an end at or before the start', () => {
    expect(refusal({ ...base, end: base.start })).toBe('end_before_start');
    expect(refusal({ ...base, end: { date: '2026-10-12', time: '18:59' } })).toBe(
      'end_before_start',
    );
    expect(refusal({ ...base, end: { date: '2026-10-11', time: '23:00' } })).toBe(
      'end_before_start',
    );
    // Positive control: one minute after, and a multi-day span.
    expect(refusal({ ...base, end: { date: '2026-10-12', time: '19:01' } })).toBeNull();
    expect(refusal({ ...base, end: { date: '2026-10-14', time: '18:00' } })).toBeNull();
  });

  it('4. location_required: in person without a non-blank venue and address, or carrying a URL', () => {
    expect(refusal({ ...base, venueName: '' })).toBe('location_required');
    expect(refusal({ ...base, address: '   ' })).toBe('location_required');
    expect(refusal({ ...base, venueName: null })).toBe('location_required');
    const { address: _address, ...noAddress } = base;
    expect(refusal(noAddress)).toBe('location_required');
    expect(refusal({ ...base, meetingUrl: 'https://meet.google.com/abc' })).toBe(
      'location_required',
    );
  });

  it('5. url_required: online without a URL, or carrying a venue or an address', () => {
    const { meetingUrl: _url, ...noUrl } = online;
    expect(refusal(noUrl)).toBe('url_required');
    expect(refusal({ ...online, meetingUrl: null })).toBe('url_required');
    expect(refusal({ ...online, venueName: 'Auditório' })).toBe('url_required');
    expect(refusal({ ...online, address: 'Rua das Flores, 100' })).toBe('url_required');
    // Blank inactive-side fields are "absent", not a refusal.
    expect(refusal({ ...online, venueName: '', address: null })).toBeNull();
  });

  it('6. url_invalid: https only, never http:, javascript: or a bare https://', () => {
    expect(refusal({ ...online, meetingUrl: 'https://meet.google.com/abc' })).toBeNull();
    expect(refusal({ ...online, meetingUrl: 'http://meet.google.com/abc' })).toBe('url_invalid');
    expect(refusal({ ...online, meetingUrl: 'javascript:alert(1)' })).toBe('url_invalid');
    expect(refusal({ ...online, meetingUrl: 'https://' })).toBe('url_invalid');
    expect(refusal({ ...online, meetingUrl: 'nota url' })).toBe('url_invalid');
    expect(refusal({ ...online, meetingUrl: `https://x.test/${'a'.repeat(2100)}` })).toBe(
      'url_invalid',
    );
  });

  it('7. a malformed or impossible wall clock is a generic 400, and an unknown key fails loudly', () => {
    expect(refusal({ ...base, start: { date: '12/10/2026', time: '19:00' } })).toBe('generic');
    expect(refusal({ ...base, start: { date: '2026-02-30', time: '19:00' } })).toBe('generic');
    expect(refusal({ ...base, start: { date: '2026-10-12', time: '24:00' } })).toBe('generic');
    expect(refusal({ ...base, tenantId: '22222222-2222-4222-8222-222222222222' })).toBe('generic');
    expect(refusal({ ...base, format: 'hybrid' })).toBe('generic');
  });

  it('8. the vocabulary is closed and complete from day one', () => {
    expect(EVENT_ISSUES).toContain('cover_invalid');
    expect(EVENT_ISSUES).toContain('too_many_attempts');
    expect(new Set(EVENT_ISSUES).size).toBe(EVENT_ISSUES.length);
  });
});

describe('eventQuerySchema — period is closed, limit clamps', () => {
  it('9. period defaults to upcoming and accepts exactly upcoming | past', () => {
    expect(eventQuerySchema.parse({}).period).toBe('upcoming');
    expect(eventQuerySchema.parse({ period: 'past' }).period).toBe('past');
    expect(eventQuerySchema.safeParse({ period: 'PAST' }).success).toBe(false);
    expect(eventQuerySchema.safeParse({ period: 'soon' }).success).toBe(false);
    expect(eventQuerySchema.safeParse({ unknown: '1' }).success).toBe(false);
  });

  it('10. limit clamps to 1..25 and degrades on garbage', () => {
    expect(eventQuerySchema.parse({}).limit).toBe(EVENT_PAGE_SIZE);
    expect(eventQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(eventQuerySchema.parse({ limit: '100000' }).limit).toBe(EVENT_MAX_PAGE_SIZE);
    expect(eventQuerySchema.parse({ limit: 'abc' }).limit).toBe(EVENT_PAGE_SIZE);
    expect(eventQuerySchema.safeParse({ cursor: 'x'.repeat(513) }).success).toBe(false);
  });
});

describe('eventSummarySchema — no secret key exists (D-207)', () => {
  it('11. the summary has no URL and no code key, and refuses one', () => {
    const keys = Object.keys(eventSummarySchema.shape);
    expect(keys).not.toContain('meetingUrl');
    expect(keys).not.toContain('checkinCode');
    const summary = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 't',
      format: 'online',
      venueName: null,
      coverAssetId: null,
      coverVariantWidths: [],
      startsAt: '2026-10-12T22:00:00.000000Z',
      endsAt: '2026-10-13T00:00:00.000000Z',
      status: 'active',
      viewerStatus: null,
      viewerCheckedInAt: null,
      confirmedCount: 0,
      presentCount: 0,
    };
    expect(eventSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      eventSummarySchema.safeParse({ ...summary, meetingUrl: 'https://meet.example.test/x' })
        .success,
    ).toBe(false);
  });
});

/** A valid detail payload, the positive control every case below mutates. */
const detail = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 't',
  format: 'in_person',
  venueName: 'Sede',
  coverAssetId: null,
  coverVariantWidths: [],
  startsAt: '2026-10-12T22:00:00.000000Z',
  endsAt: '2026-10-13T00:00:00.000000Z',
  status: 'active',
  viewerStatus: 'going',
  viewerCheckedInAt: null,
  confirmedCount: 1204,
  presentCount: 0,
  description: '',
  address: 'Rua das Flores, 100',
  viewerRespondedAt: '2026-10-10T12:00:00.000000Z',
};

describe('06-03 — attendance vocabulary, detail and RSVP contracts', () => {
  it('12. the status vocabulary is the four D-216 values, and an answer is only going | not_going', () => {
    expect([...ATTENDANCE_STATUSES]).toEqual(['going', 'not_going', 'checked_in', 'walk_in']);
    expect([...RSVP_ANSWERS]).toEqual(['going', 'not_going']);
  });

  it('13. the detail carries the viewer state and two counts, and NO url, code or attendee key (D-206, D-207)', () => {
    expect(eventDetailSchema.safeParse(detail).success).toBe(true);
    const keys = Object.keys(eventDetailSchema.shape);
    for (const forbidden of ['meetingUrl', 'checkinCode', 'attendees', 'attendeeIds', 'userId']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(eventDetailSchema.safeParse({ ...detail, checkinCode: 'K7QM' }).success).toBe(false);
    expect(eventDetailSchema.safeParse({ ...detail, attendees: [] }).success).toBe(false);
    // The counts are exact non-negative integers (never rounded or abbreviated on the wire).
    expect(eventDetailSchema.safeParse({ ...detail, confirmedCount: 1.5 }).success).toBe(false);
    expect(eventDetailSchema.safeParse({ ...detail, presentCount: -1 }).success).toBe(false);
  });

  it('14. rsvpSchema is strict: only { answer: going | not_going }', () => {
    expect(rsvpSchema.safeParse({ answer: 'going' }).success).toBe(true);
    expect(rsvpSchema.safeParse({ answer: 'not_going' }).success).toBe(true);
    expect(rsvpSchema.safeParse({ answer: 'checked_in' }).success).toBe(false);
    expect(rsvpSchema.safeParse({ answer: 'walk_in' }).success).toBe(false);
    expect(rsvpSchema.safeParse({ answer: 'going', userId: detail.id }).success).toBe(false);
    expect(rsvpSchema.safeParse({}).success).toBe(false);
    expect(rsvpResultSchema.safeParse({ status: 'checked_in' }).success).toBe(true);
  });
});

describe('06-04 — the edit read and the status write', () => {
  const edit = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Encontro anual',
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    format: 'online',
    venueName: null,
    address: null,
    meetingUrl: 'https://meet.google.com/abc',
    start: { date: '2026-10-12', time: '23:30' },
    end: { date: '2026-10-13', time: '01:30' },
    status: 'active',
    startsAt: '2026-10-13T02:30:00.000000Z',
    endsAt: '2026-10-13T04:30:00.000000Z',
  };

  it('15. eventEditSchema carries the wall-clock pairs and the URL, and is strict', () => {
    expect(eventEditSchema.safeParse(edit).success).toBe(true);
    expect(eventEditSchema.safeParse({ ...edit, checkinCode: 'K7QM' }).success).toBe(false);
    expect(
      eventEditSchema.safeParse({ ...edit, start: { ...edit.start, zone: 'x' } }).success,
    ).toBe(false);
  });

  it('16. eventStatusUpdateSchema is only { status: active | cancelled }', () => {
    expect(eventStatusUpdateSchema.safeParse({ status: 'cancelled' }).success).toBe(true);
    expect(eventStatusUpdateSchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(eventStatusUpdateSchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(eventStatusUpdateSchema.safeParse({ status: 'cancelled', title: 'x' }).success).toBe(
      false,
    );
    expect(eventStatusUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('17. the edit PUT reuses the create schema: the hidden side of the XOR is refused', () => {
    // An online replacement that still carries the venue the in-person event had is refused, so the
    // form must submit only the visible side (D-213).
    expect(
      eventInputSchema.safeParse({ ...online, venueName: 'Sede', address: 'Rua A' }).success,
    ).toBe(false);
    expect(eventInputSchema.safeParse({ ...base, meetingUrl: 'https://x.test' }).success).toBe(
      false,
    );
  });
});
