import { describe, expect, it } from 'vitest';
import {
  EVENT_ISSUE_SET,
  EVENT_ISSUES,
  EVENT_MAX_PAGE_SIZE,
  EVENT_PAGE_SIZE,
  eventInputSchema,
  eventQuerySchema,
  eventSummarySchema,
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
    };
    expect(eventSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      eventSummarySchema.safeParse({ ...summary, meetingUrl: 'https://meet.example.test/x' })
        .success,
    ).toBe(false);
  });
});
