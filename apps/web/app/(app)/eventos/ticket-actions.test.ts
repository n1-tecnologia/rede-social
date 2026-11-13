import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10.1-11 (D-744, D-745, D-747, UI-D-743, T-10.1-24, T-10.1-02) — the event form's SECOND write:
 * the gateway product that sells the ticket of an event, saved after the event itself. What is
 * stubbed: `apiFetch` (the transport), the cache revalidation and `redirect`. What is real: the
 * payments web client, the Zod the API validates with and the action's outcome mapping.
 *
 * The SAME Zod runs BEFORE any request (a server action is a public endpoint), so a link that is not
 * `https:` and a missing id never leave the server.
 */

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

const { removeEventTicketAction, saveEventTicketAction } = await import('./ticket-actions');

const EVENT = '11111111-1111-4111-8111-111111111111';
const PAIR = { externalProductId: 'PRD-48213', checkoutUrl: 'https://pay.example/ingresso' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const refusal = (status: number, code: string, payments?: string) =>
  json(status, { error: { code, ...(payments ? { details: { payments } } : {}) } });

const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiFetch.mockResolvedValue(json(200, { ...PAIR, recurring: false }));
});

describe('saveEventTicketAction: the tracer (D-744)', () => {
  it('PUTs /v1/payments/event-products/{eventId} with the trimmed pair, once', async () => {
    const outcome = await saveEventTicketAction(EVENT, {
      externalProductId: '  PRD-48213 ',
      checkoutUrl: ' https://pay.example/ingresso ',
    });
    expect(outcome).toEqual({ ok: true, recurring: false });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/payments/event-products/${EVENT}`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual(PAIR);
  });

  it('revalidates the event screens after a save', async () => {
    await saveEventTicketAction(EVENT, PAIR);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/eventos');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/eventos/${EVENT}`);
  });

  it('carries the recurring hint of the save answer, and only when it is true', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { ...PAIR, recurring: true }));
    expect(await saveEventTicketAction(EVENT, PAIR)).toEqual({ ok: true, recurring: true });
    mocks.apiFetch.mockResolvedValue(json(200, PAIR));
    expect(await saveEventTicketAction(EVENT, PAIR)).toEqual({ ok: true, recurring: false });
  });
});

describe('saveEventTicketAction: refused before any request (T-10.1-24)', () => {
  it('an id without a link is link_required, a link without an id is id_required', async () => {
    expect(
      await saveEventTicketAction(EVENT, { externalProductId: 'PRD-1', checkoutUrl: '  ' }),
    ).toEqual({ ok: false, issue: 'link_required' });
    expect(
      await saveEventTicketAction(EVENT, {
        externalProductId: ' ',
        checkoutUrl: PAIR.checkoutUrl,
      }),
    ).toEqual({ ok: false, issue: 'id_required' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://pay.example/x',
    'javascript:alert(1)',
    'data:text/html;base64,AAAA',
    'pay.example/x',
    'https://user:pw@pay.example/x',
    'https://pay.example/a b',
  ])('the link %s is link_invalid and nothing is sent', async (checkoutUrl) => {
    expect(await saveEventTicketAction(EVENT, { externalProductId: 'PRD-1', checkoutUrl })).toEqual(
      {
        ok: false,
        issue: 'link_invalid',
      },
    );
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('an id past the contract cap and a non-uuid event are generic, with no request', async () => {
    expect(
      await saveEventTicketAction(EVENT, {
        externalProductId: 'x'.repeat(129),
        checkoutUrl: PAIR.checkoutUrl,
      }),
    ).toEqual({ ok: false, issue: 'generic' });
    expect(await saveEventTicketAction('not-a-uuid', PAIR)).toEqual({
      ok: false,
      issue: 'generic',
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('a body that is not an object is refused and sends nothing', async () => {
    expect(await saveEventTicketAction(EVENT, null as never)).toEqual({
      ok: false,
      issue: 'id_required',
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});

describe('saveEventTicketAction: the server refusals as a closed outcome (T-10.1-02, D-747)', () => {
  it('gateway_product_taken is id_taken, naming nobody', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', 'gateway_product_taken'));
    expect(await saveEventTicketAction(EVENT, PAIR)).toEqual({ ok: false, issue: 'id_taken' });
  });

  it('ticket_locked is locked and reads the real sold count once', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(refusal(409, 'CONFLICT', 'ticket_locked'))
      .mockResolvedValueOnce(
        json(200, { connected: true, mapping: PAIR, soldCount: 4, locked: true, recurring: false }),
      );
    expect(await saveEventTicketAction(EVENT, PAIR)).toEqual({
      ok: false,
      issue: 'locked',
      soldCount: 4,
    });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect((mocks.apiFetch.mock.calls[1] as [string, RequestInit])[1].method).toBe('GET');
  });

  it('a locked answer survives an unreadable sold count', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(refusal(409, 'CONFLICT', 'ticket_locked'))
      .mockResolvedValueOnce(refusal(500, 'INTERNAL'));
    expect(await saveEventTicketAction(EVENT, PAIR)).toEqual({ ok: false, issue: 'locked' });
  });

  it.each([
    [404, 'MODULE_DISABLED'],
    [403, 'FORBIDDEN'],
    [500, 'INTERNAL'],
  ])('a %i %s is generic, and the log carries a shape only', async (status, code) => {
    mocks.apiFetch.mockResolvedValue(refusal(status, code));
    expect(await saveEventTicketAction(EVENT, PAIR)).toEqual({ ok: false, issue: 'generic' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    const text = JSON.stringify(logged.mock.calls);
    expect(text).not.toContain(PAIR.externalProductId);
    expect(text).not.toContain('pay.example');
  });

  it('a session the bootstrap knows becomes a navigation', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(saveEventTicketAction(EVENT, PAIR)).rejects.toThrow(/^REDIRECT /);
  });
});

describe('removeEventTicketAction (D-747)', () => {
  it('DELETEs the mapping and revalidates the screens', async () => {
    mocks.apiFetch.mockResolvedValue(
      json(200, { connected: true, mapping: null, soldCount: 0, locked: false, recurring: false }),
    );
    expect(await removeEventTicketAction(EVENT)).toEqual({ ok: true });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/payments/event-products/${EVENT}`);
    expect(init.method).toBe('DELETE');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/eventos/${EVENT}`);
  });

  it('a sale in the meantime is locked, with the real count', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(refusal(409, 'CONFLICT', 'ticket_locked'))
      .mockResolvedValueOnce(
        json(200, { connected: true, mapping: PAIR, soldCount: 2, locked: true, recurring: false }),
      );
    expect(await removeEventTicketAction(EVENT)).toEqual({
      ok: false,
      issue: 'locked',
      soldCount: 2,
    });
  });

  it('a non-uuid event is generic with no request, and a failure is generic', async () => {
    expect(await removeEventTicketAction('nope')).toEqual({ ok: false, issue: 'generic' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    mocks.apiFetch.mockResolvedValue(refusal(500, 'INTERNAL'));
    expect(await removeEventTicketAction(EVENT)).toEqual({ ok: false, issue: 'generic' });
  });
});
