import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { loadCourtesyHolders } from '@/lib/events';
import { getEventMapping } from '@/lib/payments';

/**
 * Phase 10.1-08 — the two server loaders the paid event adds: the ticket mapping read of the event form
 * and the release sheet's holders read. What is stubbed: `apiFetch` (the transport). What is real: the
 * schema parse, the 404 handling and the id cap.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const EVENT = '11111111-1111-4111-8111-111111111111';
const MEMBER_A = '22222222-2222-4222-8222-222222222222';
const MEMBER_B = '33333333-3333-4333-8333-333333333333';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  logged.mockClear();
});

describe('getEventMapping (D-744, D-747, D-757)', () => {
  const answer = {
    connected: true,
    mapping: { externalProductId: 'tk-1', checkoutUrl: 'https://pay.example/tk-1' },
    soldCount: 2,
    locked: true,
    recurring: false,
  };

  it('reads GET /v1/payments/event-products/{eventId} and returns the parsed answer', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, answer));
    expect(await getEventMapping(EVENT)).toEqual(answer);
    expect(apiFetch).toHaveBeenCalledWith(`/v1/payments/event-products/${EVENT}`, {
      method: 'GET',
    });
  });

  it('reads an unmapped event as mapping null', async () => {
    const empty = { ...answer, mapping: null, soldCount: 0, locked: false };
    vi.mocked(apiFetch).mockResolvedValue(json(200, empty));
    expect((await getEventMapping(EVENT))?.mapping).toBeNull();
  });

  it('answers null on the bare 404 (module off, or an unknown event)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(404, { error: { code: 'MODULE_DISABLED' } }));
    expect(await getEventMapping(EVENT)).toBeNull();
  });

  it('throws on any other refusal, so the form never shows a mapping it could not read', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(403, { error: { code: 'FORBIDDEN' } }));
    await expect(getEventMapping(EVENT)).rejects.toMatchObject({ status: 403 });
  });

  it('encodes the id into the path', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(404, { error: { code: 'NOT_FOUND' } }));
    await getEventMapping('a/b');
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/payments/event-products/a%2Fb');
  });
});

describe('loadCourtesyHolders (A-UI-6)', () => {
  it('sends the ids comma-separated and returns the holders', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { holders: [MEMBER_A] }));
    expect(await loadCourtesyHolders(EVENT, [MEMBER_A, MEMBER_B])).toEqual([MEMBER_A]);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe(
      `/v1/events/${EVENT}/courtesy/holders?membershipIds=${encodeURIComponent(`${MEMBER_A},${MEMBER_B}`)}`,
    );
  });

  it('asks nothing for no ids', async () => {
    expect(await loadCourtesyHolders(EVENT, [])).toEqual([]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('never sends more than 50 ids', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { holders: [] }));
    const ids = Array.from(
      { length: 80 },
      (_, index) => `${MEMBER_A.slice(0, -2)}${String(index).padStart(2, '0')}`,
    );
    await loadCourtesyHolders(EVENT, ids);
    const url = String(vi.mocked(apiFetch).mock.calls[0]?.[0]);
    const sent = decodeURIComponent(url.split('membershipIds=')[1] ?? '').split(',');
    expect(sent).toHaveLength(50);
  });

  it('answers null on a 404 or 403 and on a failure, logging the shape only', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(404, { error: { code: 'NOT_FOUND' } }));
    expect(await loadCourtesyHolders(EVENT, [MEMBER_A])).toBeNull();
    vi.mocked(apiFetch).mockResolvedValueOnce(json(403, { error: { code: 'FORBIDDEN' } }));
    expect(await loadCourtesyHolders(EVENT, [MEMBER_A])).toBeNull();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error(`boom ${MEMBER_A}`));
    expect(await loadCourtesyHolders(EVENT, [MEMBER_A])).toBeNull();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(MEMBER_A);
  });

  it('answers null on a 500 without throwing', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));
    expect(await loadCourtesyHolders(EVENT, [MEMBER_A])).toBeNull();
    expect(logged).toHaveBeenCalledWith('events.courtesy_holders_failed', { status: 500 });
  });
});
