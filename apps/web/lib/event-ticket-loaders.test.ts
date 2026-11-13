import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { loadCourtesyHolders } from '@/lib/events';
import {
  deleteEventMapping,
  getEventMapping,
  loadTicketIntegration,
  putEventMapping,
} from '@/lib/payments';

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

describe('putEventMapping and deleteEventMapping (10.1-11, D-744, D-747)', () => {
  const pair = { externalProductId: 'tk-1', checkoutUrl: 'https://pay.example/tk-1' };

  it('PUTs the pair to the event path and reads the recurring hint', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { ...pair, recurring: true }));
    expect(await putEventMapping(EVENT, pair)).toEqual({ ok: true, recurring: true });
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/payments/event-products/${EVENT}`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual(pair);
  });

  it('an answer with no hint reads as not recurring', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, pair));
    expect(await putEventMapping(EVENT, pair)).toEqual({ ok: true, recurring: false });
  });

  it.each([
    ['gateway_product_taken', 409, 'id_taken'],
    ['ticket_locked', 409, 'locked'],
    ['link_required', 400, 'link_required'],
    ['link_invalid', 400, 'link_invalid'],
    ['gateway_product_id_required', 400, 'id_required'],
  ])('maps the issue %s to %s', async (issue, status, reason) => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(status, { error: { code: 'CONFLICT', details: { payments: issue } } }),
    );
    expect(await putEventMapping(EVENT, pair)).toEqual({ ok: false, reason });
  });

  it('a bare 404, a 403 and anything else never throw, and the log has no id or link', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(404, { error: { code: 'MODULE_DISABLED' } }));
    expect(await putEventMapping(EVENT, pair)).toEqual({ ok: false, reason: 'not_found' });
    vi.mocked(apiFetch).mockResolvedValue(json(403, { error: { code: 'FORBIDDEN' } }));
    expect(await putEventMapping(EVENT, pair)).toEqual({ ok: false, reason: 'forbidden' });
    vi.mocked(apiFetch).mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));
    expect(await putEventMapping(EVENT, pair)).toEqual({ ok: false, reason: 'generic' });
    const text = JSON.stringify(logged.mock.calls);
    expect(text).not.toContain('tk-1');
    expect(text).not.toContain('pay.example');
  });

  it('a session the bootstrap knows is a redirect path', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED' } }));
    const outcome = await putEventMapping(EVENT, pair);
    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ reason: 'redirect' });
  });

  it('DELETEs the event path and is ok without reading the body', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 200 }));
    expect(await deleteEventMapping(EVENT)).toEqual({ ok: true, recurring: false });
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/payments/event-products/${EVENT}`);
    expect(init.method).toBe('DELETE');
  });

  it('DELETE with a sale is locked', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(409, { error: { code: 'CONFLICT', details: { payments: 'ticket_locked' } } }),
    );
    expect(await deleteEventMapping(EVENT)).toEqual({ ok: false, reason: 'locked' });
  });
});

describe('loadTicketIntegration (10.1-11, A-11-GATEWAY)', () => {
  const overview = {
    integration: {
      provider: 'gateway_x',
      gatewayName: 'Gateway Exemplo',
      connected: true,
      webhookUrl: 'https://api.example/webhook',
      lastEventAt: null,
    },
    accessProducts: [],
    gate: { required: false, canEnable: false },
    serverNow: '2026-11-13T12:00:00.000Z',
  };

  it('asks nothing when it is not asked', async () => {
    expect(await loadTicketIntegration(false)).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('reads the gateway name and the connection from the overview', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, overview));
    expect(await loadTicketIntegration(true)).toEqual({
      gatewayName: 'Gateway Exemplo',
      connected: true,
    });
  });

  it('a failed read is null, never a throw, and the log carries a shape only', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));
    expect(await loadTicketIntegration(true)).toBeNull();
    expect(JSON.stringify(logged.mock.calls)).not.toContain('Gateway Exemplo');
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
