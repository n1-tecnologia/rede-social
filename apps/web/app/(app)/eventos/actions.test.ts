import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminMembers } from '@/lib/admin-members';
import { ApiClientError } from '@/lib/bootstrap';
import {
  checkIn,
  createEvent,
  grantCourtesy,
  loadCourtesyHolders,
  loadEvent,
  putRsvp,
  removeCourtesy,
  updateEvent,
} from '@/lib/events';
import {
  checkInEventAction,
  courtesyHoldersAction,
  createEventAction,
  grantCourtesyAction,
  removeCourtesyAction,
  rsvpEventAction,
  searchCourtesyMembersAction,
  updateEventAction,
} from './actions';

/**
 * 12.3-08 — how a refused image comes back from the event write actions (NOVF-04, UI-D-693).
 *
 * The events API refuses the vertical poster two ways: `400 details.event = 'poster_invalid'` for a
 * wrong purpose, kind or status, and the same bare 404 as for a missing event when the id is foreign,
 * unknown or retired. The first is a closed code. The second is told apart here the way the cover's
 * always was (the communities 05-09 rule): on a create the 404 can only be an image the body carried;
 * on an update the event is re-read, and only an image whose id CHANGED can be the one refused.
 *
 * Stubbed: `lib/events` (the requests). Real: the schemas, the refusal mapping and the attribution.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

vi.mock('@/lib/events', () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  loadEvent: vi.fn(),
  addEventPhoto: vi.fn(),
  checkIn: vi.fn(),
  deleteEvent: vi.fn(),
  getAttendance: vi.fn(),
  getEventPhotos: vi.fn(),
  getEventSections: vi.fn(),
  grantCourtesy: vi.fn(),
  loadCourtesyHolders: vi.fn(),
  putRsvp: vi.fn(),
  regenerateCode: vi.fn(),
  removeCourtesy: vi.fn(),
  removeEventPhoto: vi.fn(),
  setEventStatus: vi.fn(),
}));

vi.mock('@/lib/admin-members', () => ({ getAdminMembers: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('redirect should not be reached in these cases');
  }),
}));

const EVENT = '22222222-2222-4222-8222-222222222222';
const COVER = '11111111-1111-4111-8111-111111111111';
const POSTER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

const bare404 = () => new ApiClientError(404, 'NOT_FOUND', undefined, 'req-1');

const body = (extra: Record<string, unknown> = {}) => ({
  title: 'Encontro',
  description: '',
  category: '',
  capacity: null,
  format: 'online',
  meetingUrl: 'https://meet.example.com/x',
  start: { date: '2026-10-12', time: '19:00' },
  end: { date: '2026-10-12', time: '21:00' },
  ...extra,
});

/** What the re-read of the event says it holds now. */
const stored = (cover: string | null, poster: string | null) =>
  vi.mocked(loadEvent).mockResolvedValue({
    status: 'ok',
    event: { coverAssetId: cover, posterAssetId: poster },
  } as never);

beforeEach(() => {
  vi.mocked(createEvent).mockReset();
  vi.mocked(updateEvent).mockReset();
  vi.mocked(loadEvent).mockReset();
  vi.mocked(revalidatePath).mockClear();
});

describe('the event poster refusals (NOVF-04, UI-D-693)', () => {
  it('a poster the API refuses with details.event is the closed code poster_invalid', async () => {
    vi.mocked(updateEvent).mockRejectedValue(
      new ApiClientError(400, 'VALIDATION', { event: 'poster_invalid' }, 'req-1'),
    );
    const result = await updateEventAction(EVENT, body({ posterAssetId: POSTER }));
    expect(result).toEqual({ ok: false, code: 'poster_invalid' });
    expect(loadEvent).not.toHaveBeenCalled();
  });

  it('the poster id travels in the body of a PUT, and null travels as null', async () => {
    vi.mocked(updateEvent).mockResolvedValue({ id: EVENT } as never);
    await updateEventAction(EVENT, body({ posterAssetId: POSTER }));
    expect(vi.mocked(updateEvent).mock.calls[0]?.[1]).toMatchObject({ posterAssetId: POSTER });
    await updateEventAction(EVENT, body({ posterAssetId: null }));
    expect(vi.mocked(updateEvent).mock.calls[1]?.[1]).toMatchObject({ posterAssetId: null });
  });

  it('create: a bare 404 on a body with only a poster is the poster; with a cover it stays the cover', async () => {
    vi.mocked(createEvent).mockRejectedValue(bare404());
    expect(await createEventAction(body({ posterAssetId: POSTER }))).toEqual({
      ok: false,
      code: 'poster_invalid',
    });
    expect(await createEventAction(body({ coverAssetId: COVER, posterAssetId: POSTER }))).toEqual({
      ok: false,
      code: 'cover_invalid',
    });
    expect(await createEventAction(body())).toEqual({ ok: false, code: 'not_found' });
  });

  it('update: the event still reads back and the poster changed, so the 404 was the poster', async () => {
    vi.mocked(updateEvent).mockRejectedValue(bare404());
    stored(null, OTHER);
    expect(await updateEventAction(EVENT, body({ posterAssetId: POSTER }))).toEqual({
      ok: false,
      code: 'poster_invalid',
    });
    expect(loadEvent).toHaveBeenCalledWith(EVENT);
  });

  it('update: a cover that changed is still the cover, even beside a poster that did not', async () => {
    vi.mocked(updateEvent).mockRejectedValue(bare404());
    stored(OTHER, POSTER);
    expect(
      await updateEventAction(EVENT, body({ coverAssetId: COVER, posterAssetId: POSTER })),
    ).toEqual({ ok: false, code: 'cover_invalid' });
  });

  it('update: both ids are the stored ones, so the 404 is not about an image the admin chose', async () => {
    vi.mocked(updateEvent).mockRejectedValue(bare404());
    stored(COVER, POSTER);
    expect(
      await updateEventAction(EVENT, body({ coverAssetId: COVER, posterAssetId: POSTER })),
    ).toEqual({ ok: false, code: 'not_found' });
  });

  it('update: an event that no longer reads back stays not_found, whatever the body carries', async () => {
    vi.mocked(updateEvent).mockRejectedValue(bare404());
    vi.mocked(loadEvent).mockResolvedValue({ status: 'not-found' });
    expect(await updateEventAction(EVENT, body({ posterAssetId: POSTER }))).toEqual({
      ok: false,
      code: 'not_found',
    });
  });

  it('update: no image in the body means no re-read at all', async () => {
    vi.mocked(updateEvent).mockRejectedValue(bare404());
    expect(await updateEventAction(EVENT, body({ posterAssetId: null }))).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(loadEvent).not.toHaveBeenCalled();
  });
});

/**
 * Phase 10.1-12 (D-741, D-754, UI-D-753) — how a refused RSVP comes back. The API answers a Vou in a
 * paid event `409 details.event = 'payment_required'` and a "Não vou" from a ticket holder `409
 * 'ticket_locked'`; both are CLOSED result codes the island maps to a toast and a refresh, never copy.
 * The shipped four keep their codes, and an unknown code stays the generic failure.
 */
describe('the RSVP refusals of a paid event (D-741, D-754, UI-D-753)', () => {
  beforeEach(() => {
    vi.mocked(putRsvp).mockReset();
  });
  const refused = (event: string) => new ApiClientError(409, 'CONFLICT', { event }, 'req-1');

  it('payment_required is the closed code payment_required', async () => {
    vi.mocked(putRsvp).mockRejectedValue(refused('payment_required'));
    expect(await rsvpEventAction(EVENT, 'going')).toEqual({ ok: false, error: 'payment_required' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('ticket_locked is the closed code ticket_locked', async () => {
    vi.mocked(putRsvp).mockRejectedValue(refused('ticket_locked'));
    expect(await rsvpEventAction(EVENT, 'not_going')).toEqual({
      ok: false,
      error: 'ticket_locked',
    });
  });

  it('the shipped refusals keep their codes', async () => {
    for (const code of ['rsvp_closed', 'cancelled', 'attendance_locked', 'event_full']) {
      vi.mocked(putRsvp).mockRejectedValue(refused(code));
      expect(await rsvpEventAction(EVENT, 'going')).toEqual({ ok: false, error: code });
    }
  });

  it('an unknown code, and a bare 404, stay the generic failure; copy is never returned', async () => {
    vi.mocked(putRsvp).mockRejectedValue(refused('something_else'));
    expect(await rsvpEventAction(EVENT, 'going')).toEqual({ ok: false, error: 'failed' });
    vi.mocked(putRsvp).mockRejectedValue(bare404());
    expect(await rsvpEventAction(EVENT, 'going')).toEqual({ ok: false, error: 'failed' });
  });

  it('a success still revalidates the list', async () => {
    vi.mocked(putRsvp).mockResolvedValue({ status: 'going' } as never);
    expect(await rsvpEventAction(EVENT, 'going')).toEqual({ ok: true, status: 'going' });
    expect(revalidatePath).toHaveBeenCalledWith('/eventos');
  });
});

/**
 * Phase 10.1-13 (D-742, UI-D-752) — how a refused venue-code submit comes back for a paid event without a
 * presence: `409 details.event = 'payment_required'` is the CLOSED code the form maps to its inline
 * "O check-in é só para quem tem ingresso." and a refresh. The shipped refusals keep their codes.
 */
describe('the check-in refusals of a paid event (D-742, UI-D-752)', () => {
  beforeEach(() => {
    vi.mocked(checkIn).mockReset();
  });
  const refused = (event: string) => new ApiClientError(409, 'CONFLICT', { event }, 'req-1');

  it('payment_required is the closed code payment_required', async () => {
    vi.mocked(checkIn).mockRejectedValue(refused('payment_required'));
    expect(await checkInEventAction(EVENT, 'K7QM')).toEqual({
      ok: false,
      error: 'payment_required',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('the shipped refusals keep their codes; an unknown code stays the generic failure', async () => {
    for (const code of [
      'wrong_code',
      'too_many_attempts',
      'checkin_not_open',
      'checkin_closed',
      'cancelled',
    ]) {
      vi.mocked(checkIn).mockRejectedValue(refused(code));
      expect(await checkInEventAction(EVENT, 'K7QM')).toEqual({ ok: false, error: code });
    }
    vi.mocked(checkIn).mockRejectedValue(refused('ticket_required'));
    expect(await checkInEventAction(EVENT, 'K7QM')).toEqual({ ok: false, error: 'failed' });
  });
});

/**
 * Phase 10.1-14 (D-743, D-752, UI-D-756, T-10.1-12/13) — taking a courtesy back. Every answer is a CLOSED
 * code the list maps to catalog copy; the ids are checked before any request is built; a success refreshes
 * the screens that print the counts.
 */
describe('removeCourtesyAction (D-743, D-752, UI-D-756)', () => {
  const ROW = '55555555-5555-4555-8555-555555555555';
  const refused = (status: number, event?: string) =>
    new ApiClientError(
      status,
      status === 404 ? 'NOT_FOUND' : 'CONFLICT',
      event ? { event } : undefined,
      'req-1',
    );

  beforeEach(() => {
    vi.mocked(removeCourtesy).mockReset();
    vi.mocked(revalidatePath).mockClear();
  });

  it('a success sends the two ids once and refreshes the participants and the detail', async () => {
    vi.mocked(removeCourtesy).mockResolvedValue(undefined);
    expect(await removeCourtesyAction(EVENT, ROW)).toEqual({ ok: true });
    expect(removeCourtesy).toHaveBeenCalledTimes(1);
    expect(removeCourtesy).toHaveBeenCalledWith(EVENT, ROW);
    expect(revalidatePath).toHaveBeenCalledWith(`/eventos/${EVENT}/participantes`);
    expect(revalidatePath).toHaveBeenCalledWith(`/eventos/${EVENT}`);
  });

  it.each([
    ['attendance_locked', 'locked'],
    ['not_courtesy', 'not_courtesy'],
  ] as const)('the 409 %s is the closed code %s and revalidates nothing', async (event, code) => {
    vi.mocked(removeCourtesy).mockRejectedValue(refused(409, event));
    expect(await removeCourtesyAction(EVENT, ROW)).toEqual({ ok: false, code });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('the bare 404 is not_found; any other failure, and an unknown 409 code, are generic', async () => {
    vi.mocked(removeCourtesy).mockRejectedValue(refused(404));
    expect(await removeCourtesyAction(EVENT, ROW)).toEqual({ ok: false, code: 'not_found' });
    vi.mocked(removeCourtesy).mockRejectedValue(refused(409, 'something_new'));
    expect(await removeCourtesyAction(EVENT, ROW)).toEqual({ ok: false, code: 'generic' });
    vi.mocked(removeCourtesy).mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await removeCourtesyAction(EVENT, ROW)).toEqual({ ok: false, code: 'generic' });
    spy.mockRestore();
  });

  it('a malformed id never reaches the API', async () => {
    expect(await removeCourtesyAction('nope', ROW)).toEqual({ ok: false, code: 'generic' });
    expect(await removeCourtesyAction(EVENT, '../../x')).toEqual({ ok: false, code: 'generic' });
    expect(removeCourtesy).not.toHaveBeenCalled();
  });
});

/**
 * Phase 10.1-14 (D-743, A-UI-5, A-UI-6, UI-D-755, T-10.1-12/13/16) — releasing a presence, the member search
 * and the holders read. Only the events client and the admin members read are stubbed, so these also prove
 * the release needs nothing from the payments module (D-746): it works with the module off.
 */
describe('grantCourtesyAction (D-743, UI-D-755)', () => {
  const MEMBER = '66666666-6666-4666-8666-666666666666';
  const ROW = '55555555-5555-4555-8555-555555555555';
  const refused = (status: number, event?: string) =>
    new ApiClientError(
      status,
      status === 404 ? 'NOT_FOUND' : 'CONFLICT',
      event ? { event } : undefined,
      'req-1',
    );

  beforeEach(() => {
    vi.mocked(grantCourtesy).mockReset();
    vi.mocked(revalidatePath).mockClear();
  });

  it('granted and already_in pass through, send the body untouched and refresh the screens', async () => {
    vi.mocked(grantCourtesy).mockResolvedValueOnce({ outcome: 'granted' });
    expect(await grantCourtesyAction(EVENT, { membershipId: MEMBER })).toEqual({
      status: 'granted',
    });
    expect(grantCourtesy).toHaveBeenCalledWith(EVENT, { membershipId: MEMBER });
    expect(revalidatePath).toHaveBeenCalledWith(`/eventos/${EVENT}/participantes`);
    expect(revalidatePath).toHaveBeenCalledWith(`/eventos/${EVENT}`);
    vi.mocked(grantCourtesy).mockResolvedValueOnce({ outcome: 'already_in' });
    expect(await grantCourtesyAction(EVENT, { attendanceId: ROW })).toEqual({
      status: 'already_in',
    });
    expect(grantCourtesy).toHaveBeenLastCalledWith(EVENT, { attendanceId: ROW });
  });

  it.each([
    [409, 'event_ended', 'event_ended'],
    [409, 'cancelled', 'event_cancelled'],
    [409, 'event_not_paid', 'event_not_paid'],
    [404, undefined, 'not_found'],
    [409, 'something_new', 'generic'],
    [500, undefined, 'generic'],
  ] as const)(
    'the %s %s refusal is the closed code %s and revalidates nothing',
    async (status, event, code) => {
      vi.mocked(grantCourtesy).mockRejectedValue(refused(status, event));
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await grantCourtesyAction(EVENT, { membershipId: MEMBER })).toEqual({ status: code });
      expect(revalidatePath).not.toHaveBeenCalled();
      spy.mockRestore();
    },
  );

  it('a body naming both ids, a forged key or a malformed id never reaches the API (T-10.1-12)', async () => {
    const forged = [
      { membershipId: MEMBER, attendanceId: ROW },
      { membershipId: MEMBER, userId: ROW },
      { membershipId: MEMBER, origin: 'ticket' },
      { membershipId: 'nope' },
      {},
    ];
    for (const body of forged) {
      expect(await grantCourtesyAction(EVENT, body as never)).toEqual({ status: 'generic' });
    }
    expect(await grantCourtesyAction('nope', { membershipId: MEMBER })).toEqual({
      status: 'generic',
    });
    expect(grantCourtesy).not.toHaveBeenCalled();
  });
});

describe('searchCourtesyMembersAction (A-UI-6, T-10.1-16)', () => {
  const MEMBER = '66666666-6666-4666-8666-666666666666';
  beforeEach(() => {
    vi.mocked(getAdminMembers).mockReset();
  });

  it('asks the ACTIVE members of the admin read and answers only what the row draws', async () => {
    vi.mocked(getAdminMembers).mockResolvedValue({
      items: [
        {
          membershipId: MEMBER,
          displayName: null,
          email: 'ana@email.com',
          avatarAssetId: null,
          role: 'member',
        },
      ],
      nextCursor: 'c2',
    } as never);
    expect(await searchCourtesyMembersAction('  ana ', null)).toEqual({
      ok: true,
      items: [
        {
          membershipId: MEMBER,
          name: 'ana@email.com',
          email: 'ana@email.com',
          avatarAssetId: null,
        },
      ],
      nextCursor: 'c2',
    });
    expect(getAdminMembers).toHaveBeenCalledWith({ q: 'ana', status: 'active', cursor: undefined });
  });

  it('an empty or blank query never reaches the API: the list is never unbounded', async () => {
    expect(await searchCourtesyMembersAction('', null)).toEqual({ ok: false, code: 'generic' });
    expect(await searchCourtesyMembersAction('   ', null)).toEqual({ ok: false, code: 'generic' });
    expect(await searchCourtesyMembersAction('x'.repeat(81), null)).toEqual({
      ok: false,
      code: 'generic',
    });
    expect(getAdminMembers).not.toHaveBeenCalled();
  });

  it('forwards the cursor untouched and answers generic on a refusal', async () => {
    vi.mocked(getAdminMembers).mockResolvedValue({ items: [], nextCursor: null } as never);
    await searchCourtesyMembersAction('ana', 'opaque');
    expect(getAdminMembers).toHaveBeenCalledWith({ q: 'ana', status: 'active', cursor: 'opaque' });
    vi.mocked(getAdminMembers).mockRejectedValue(
      new ApiClientError(500, 'INTERNAL', undefined, 'r'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await searchCourtesyMembersAction('ana', null)).toEqual({ ok: false, code: 'generic' });
    spy.mockRestore();
  });
});

describe('courtesyHoldersAction (A-UI-6, T-10.1-16)', () => {
  const ids = (count: number) =>
    Array.from(
      { length: count },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
  beforeEach(() => {
    vi.mocked(loadCourtesyHolders).mockReset();
  });

  it('answers the holders the API reports', async () => {
    vi.mocked(loadCourtesyHolders).mockResolvedValue(ids(1));
    expect(await courtesyHoldersAction(EVENT, ids(3))).toEqual({ ok: true, holders: ids(1) });
    expect(loadCourtesyHolders).toHaveBeenCalledWith(EVENT, ids(3));
  });

  it('an unreadable answer is { ok: false }, never an empty "nobody holds one"', async () => {
    vi.mocked(loadCourtesyHolders).mockResolvedValue(null);
    expect(await courtesyHoldersAction(EVENT, ids(2))).toEqual({ ok: false });
  });

  it('more than 50 ids, a non-uuid or a bad event id never leave the server', async () => {
    expect(await courtesyHoldersAction(EVENT, ids(51))).toEqual({ ok: false });
    expect(await courtesyHoldersAction(EVENT, ['nope'])).toEqual({ ok: false });
    expect(await courtesyHoldersAction('nope', ids(1))).toEqual({ ok: false });
    expect(loadCourtesyHolders).not.toHaveBeenCalled();
    vi.mocked(loadCourtesyHolders).mockResolvedValue([]);
    expect(await courtesyHoldersAction(EVENT, ids(50))).toEqual({ ok: true, holders: [] });
  });
});
