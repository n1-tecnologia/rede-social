import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/bootstrap';
import { createEvent, loadEvent, putRsvp, updateEvent } from '@/lib/events';
import { createEventAction, rsvpEventAction, updateEventAction } from './actions';

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
  putRsvp: vi.fn(),
  regenerateCode: vi.fn(),
  removeEventPhoto: vi.fn(),
  setEventStatus: vi.fn(),
}));

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
