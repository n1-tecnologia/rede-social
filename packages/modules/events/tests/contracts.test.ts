import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_LISTS,
  ATTENDANCE_STATUSES,
  attendancePageSchema,
  attendanceQuerySchema,
  attendanceSummarySchema,
  attendeeSchema,
  CHECKIN_OUTCOMES,
  checkinCodeSchema,
  checkinResultSchema,
  checkinSchema,
  ENTER_OUTCOMES,
  ENTER_PASSING_OUTCOMES,
  EVENT_CHECKIN_FAILED_WINDOW_MINUTES,
  EVENT_CHECKIN_MAX_FAILED,
  EVENT_ISSUE_SET,
  EVENT_ISSUES,
  EVENT_MAX_CAPACITY,
  EVENT_MAX_CATEGORY,
  EVENT_MAX_PAGE_SIZE,
  EVENT_MIN_CAPACITY,
  EVENT_PAGE_SIZE,
  EVENT_PHOTO_MAX_PAGE_SIZE,
  EVENT_PHOTO_PAGE_SIZE,
  enterResultSchema,
  eventDetailSchema,
  eventEditSchema,
  eventInputSchema,
  eventPhotoInputSchema,
  eventPhotoPageSchema,
  eventPhotoQuerySchema,
  eventPhotoSchema,
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
      category: null,
      capacity: null,
      venueName: null,
      address: null,
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
  category: 'Workshop',
  capacity: 50,
  venueName: 'Sede',
  address: 'Rua das Flores, 100',
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
    category: null,
    capacity: null,
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

describe('06-05 — the in-person check-in contract', () => {
  it('18. checkinSchema takes one trimmed, non-empty code of at most 16 characters, and is strict', () => {
    expect(checkinSchema.parse({ code: ' k7-qm ' })).toEqual({ code: 'k7-qm' });
    expect(checkinSchema.safeParse({ code: '' }).success).toBe(false);
    expect(checkinSchema.safeParse({ code: '   ' }).success).toBe(false);
    expect(checkinSchema.safeParse({ code: 'A'.repeat(17) }).success).toBe(false);
    expect(checkinSchema.safeParse({ code: 'K7QM', userId: 'x' }).success).toBe(false);
    expect(checkinSchema.safeParse({}).success).toBe(false);
  });

  it('19. checkinResultSchema answers only the three 200 outcomes, and never a code key', () => {
    expect([...CHECKIN_OUTCOMES]).toEqual(['checked_in', 'walk_in', 'already']);
    const ok = { outcome: 'walk_in', checkedInAt: '2026-10-12T21:30:00.000000Z' };
    expect(checkinResultSchema.safeParse(ok).success).toBe(true);
    expect(checkinResultSchema.safeParse({ ...ok, outcome: 'wrong_code' }).success).toBe(false);
    expect(checkinResultSchema.safeParse({ ...ok, code: 'K7QM' }).success).toBe(false);
  });

  it('20. the refusals are in the closed vocabulary, and the bound mirrors the SQL literals', () => {
    for (const issue of [
      'wrong_code',
      'too_many_attempts',
      'checkin_not_open',
      'checkin_closed',
      'cancelled',
    ]) {
      expect(EVENT_ISSUE_SET.has(issue), issue).toBe(true);
    }
    expect(EVENT_CHECKIN_MAX_FAILED).toBe(5);
    expect(EVENT_CHECKIN_FAILED_WINDOW_MINUTES).toBe(15);
  });
});

describe('06-06 — the online enter contract (an API-to-BFF answer)', () => {
  const URL = 'https://meet.example.test/sala';

  it('21. the outcomes are closed, and the URL rides EXACTLY with forward, recorded and already', () => {
    expect([...ENTER_OUTCOMES]).toEqual([
      'forward',
      'recorded',
      'already',
      'confirm_first',
      'ended',
      'cancelled',
    ]);
    expect([...ENTER_PASSING_OUTCOMES].sort()).toEqual(['already', 'forward', 'recorded']);
    for (const outcome of ['forward', 'recorded', 'already'] as const) {
      expect(enterResultSchema.safeParse({ outcome, meetingUrl: URL }).success, outcome).toBe(true);
      // A passing outcome WITHOUT the URL is refused (the refine's first direction).
      expect(enterResultSchema.safeParse({ outcome, meetingUrl: null }).success, outcome).toBe(
        false,
      );
    }
    for (const outcome of ['confirm_first', 'ended', 'cancelled'] as const) {
      expect(enterResultSchema.safeParse({ outcome, meetingUrl: null }).success, outcome).toBe(
        true,
      );
      // A refusal WITH a URL is refused (the refine's second direction, T-06-35).
      expect(enterResultSchema.safeParse({ outcome, meetingUrl: URL }).success, outcome).toBe(
        false,
      );
    }
  });

  it('22. https only, strict, and not_found is never a 200 outcome', () => {
    for (const bad of [
      'http://meet.example.test/sala',
      'javascript:alert(1)',
      'meet.example.test',
    ]) {
      expect(
        enterResultSchema.safeParse({ outcome: 'forward', meetingUrl: bad }).success,
        bad,
      ).toBe(false);
    }
    expect(
      enterResultSchema.safeParse({ outcome: 'forward', meetingUrl: URL, status: 'going' }).success,
    ).toBe(false);
    expect(enterResultSchema.safeParse({ outcome: 'not_found', meetingUrl: null }).success).toBe(
      false,
    );
  });
});

describe('06-07 — the attendance contract (Participantes)', () => {
  const attendee = {
    id: '0e000000-0000-4000-8000-0000000000a1',
    displayName: 'Iris Muñoz',
    avatarAssetId: null,
    avatarVariantWidths: [],
    removed: false,
    status: 'going',
    respondedAt: '2026-10-10T12:00:00.000000Z',
    checkedInAt: null,
    walkIn: false,
  } as const;

  it('23. the list is a closed enum that does not clamp; limit clamps; strict', () => {
    expect([...ATTENDANCE_LISTS]).toEqual(['confirmed', 'present', 'not_going']);
    expect(attendanceQuerySchema.parse({})).toEqual({ list: 'confirmed', limit: EVENT_PAGE_SIZE });
    for (const list of ATTENDANCE_LISTS) {
      expect(attendanceQuerySchema.parse({ list }).list).toBe(list);
    }
    for (const bad of ['PRESENT', 'presentes', 'going', 'walk_in', '']) {
      expect(attendanceQuerySchema.safeParse({ list: bad }).success, bad).toBe(false);
    }
    expect(attendanceQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(attendanceQuerySchema.parse({ limit: '999' }).limit).toBe(EVENT_MAX_PAGE_SIZE);
    expect(attendanceQuerySchema.parse({ limit: 'abc' }).limit).toBe(EVENT_PAGE_SIZE);
    expect(attendanceQuerySchema.safeParse({ period: 'past' }).success).toBe(false);
  });

  it('24. an attendee carries no email, no role and no membership id (T-06-46), and is strict', () => {
    expect(attendeeSchema.safeParse(attendee).success).toBe(true);
    const keys = Object.keys(attendeeSchema.shape).sort();
    expect(keys).toEqual([
      'avatarAssetId',
      'avatarVariantWidths',
      'checkedInAt',
      'displayName',
      'id',
      'removed',
      'respondedAt',
      'status',
      'walkIn',
    ]);
    for (const extra of ['email', 'role', 'membershipId', 'userId']) {
      expect(attendeeSchema.safeParse({ ...attendee, [extra]: 'x' }).success, extra).toBe(false);
    }
    expect(attendancePageSchema.safeParse({ items: [attendee], nextCursor: null }).success).toBe(
      true,
    );
    expect(attendancePageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });

  it('25. Pitfall 11: the summary names both "confirmados" numbers, and the code is nullable', () => {
    const summary = {
      format: 'in_person',
      pendingConfirmedCount: 2,
      presentCount: 2,
      notGoingCount: 1,
      confirmedCount: 3,
      checkinCode: 'K7QM',
    } as const;
    expect(attendanceSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      attendanceSummarySchema.safeParse({ ...summary, format: 'online', checkinCode: null })
        .success,
    ).toBe(true);
    expect(Object.keys(attendanceSummarySchema.shape)).toEqual(
      expect.arrayContaining(['pendingConfirmedCount', 'confirmedCount']),
    );
    expect(attendanceSummarySchema.safeParse({ ...summary, meetingUrl: null }).success).toBe(false);
  });

  it('26. the regeneration answer is the code and nothing else', () => {
    expect(checkinCodeSchema.safeParse({ checkinCode: 'K7QM' }).success).toBe(true);
    expect(checkinCodeSchema.safeParse({ checkinCode: 'K7QM', previous: 'ABCD' }).success).toBe(
      false,
    );
  });
});

describe('2026-10-03 — category, capacity, the list address and the photos', () => {
  it('27. category: optional, trimmed, at most 40 units after trimming, carried by either format', () => {
    expect(EVENT_MAX_CATEGORY).toBe(40);
    expect(refusal({ ...base, category: 'Workshop' })).toBeNull();
    expect(eventInputSchema.parse({ ...base, category: '  Imersão presencial  ' }).category).toBe(
      'Imersão presencial',
    );
    // Blank, null and absent all parse: the service stores each as "no category" (null).
    expect(eventInputSchema.parse({ ...base, category: '   ' }).category).toBe('');
    expect(refusal({ ...base, category: null })).toBeNull();
    expect(eventInputSchema.parse(base).category).toBeUndefined();
    const atCap = 'x'.repeat(EVENT_MAX_CATEGORY);
    expect(refusal({ ...base, category: atCap })).toBeNull();
    expect(refusal({ ...base, category: ` ${atCap} ` })).toBeNull();
    // Over the cap is a generic 400, like an over-long title: the form's maxLength prevents it.
    expect(refusal({ ...base, category: `${atCap}x` })).toBe('generic');
    expect(refusal({ ...online, category: 'Live' })).toBeNull();
  });

  it('28. capacity: an integer from 1 to 100000, or null / absent for no limit', () => {
    expect(EVENT_MIN_CAPACITY).toBe(1);
    expect(EVENT_MAX_CAPACITY).toBe(100_000);
    for (const ok of [1, 50, 100_000, null]) {
      expect(refusal({ ...base, capacity: ok }), String(ok)).toBeNull();
    }
    expect(eventInputSchema.parse(base).capacity).toBeUndefined();
    for (const bad of [0, -1, 100_001, 1.5, '50', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(refusal({ ...base, capacity: bad }), String(bad)).toBe('generic');
    }
  });

  it('29. the list item carries category, capacity and address; the detail and the edit read too', () => {
    const keys = Object.keys(eventSummarySchema.shape);
    for (const key of ['category', 'capacity', 'address']) expect(keys).toContain(key);
    expect(
      eventDetailSchema.safeParse({ ...detail, category: null, capacity: null, address: null })
        .success,
    ).toBe(true);
    // A limit on the wire is a positive integer, and the keys are required (null, never absent).
    expect(eventDetailSchema.safeParse({ ...detail, capacity: 0 }).success).toBe(false);
    expect(eventDetailSchema.safeParse({ ...detail, capacity: 2.5 }).success).toBe(false);
    const { category: _category, ...uncategorised } = detail;
    expect(eventDetailSchema.safeParse(uncategorised).success).toBe(false);
    expect(Object.keys(eventEditSchema.shape)).toEqual(
      expect.arrayContaining(['category', 'capacity']),
    );
  });

  it('30. event_full and photo_invalid are in the closed vocabulary', () => {
    expect(EVENT_ISSUE_SET.has('event_full')).toBe(true);
    expect(EVENT_ISSUE_SET.has('photo_invalid')).toBe(true);
    expect(new Set(EVENT_ISSUES).size).toBe(EVENT_ISSUES.length);
  });

  it('31. a photo is its id, its asset and the ladder, never the uploader; strict', () => {
    const photo = {
      id: '0e000000-0000-4000-8000-0000000000f1',
      mediaAssetId: '0e000000-0000-4000-8000-0000000000f2',
      variantWidths: [320, 640, 1080, 1600],
    };
    expect(eventPhotoSchema.safeParse(photo).success).toBe(true);
    expect(Object.keys(eventPhotoSchema.shape).sort()).toEqual([
      'id',
      'mediaAssetId',
      'variantWidths',
    ]);
    for (const extra of ['createdByUserId', 'userId', 'url', 'eventId']) {
      expect(eventPhotoSchema.safeParse({ ...photo, [extra]: 'x' }).success, extra).toBe(false);
    }
    expect(eventPhotoPageSchema.safeParse({ items: [photo], nextCursor: 'c' }).success).toBe(true);
    expect(eventPhotoPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });

  it('32. the gallery query clamps 1..60 and degrades; the add body is one uuid, strict', () => {
    expect(eventPhotoQuerySchema.parse({})).toEqual({ limit: EVENT_PHOTO_PAGE_SIZE });
    expect(eventPhotoQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(eventPhotoQuerySchema.parse({ limit: '999' }).limit).toBe(EVENT_PHOTO_MAX_PAGE_SIZE);
    expect(eventPhotoQuerySchema.parse({ limit: 'abc' }).limit).toBe(EVENT_PHOTO_PAGE_SIZE);
    expect(eventPhotoQuerySchema.safeParse({ cursor: 'x'.repeat(513) }).success).toBe(false);
    expect(eventPhotoQuerySchema.safeParse({ period: 'past' }).success).toBe(false);

    const asset = '0e000000-0000-4000-8000-0000000000f2';
    expect(eventPhotoInputSchema.safeParse({ mediaAssetId: asset }).success).toBe(true);
    expect(eventPhotoInputSchema.safeParse({ mediaAssetId: 'nota-uuid' }).success).toBe(false);
    expect(eventPhotoInputSchema.safeParse({}).success).toBe(false);
    for (const extra of ['eventId', 'tenantId', 'createdByUserId']) {
      expect(
        eventPhotoInputSchema.safeParse({ mediaAssetId: asset, [extra]: asset }).success,
        extra,
      ).toBe(false);
    }
  });
});
