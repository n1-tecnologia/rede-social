import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10.1-13 (D-749, D-750, UI-D-759) — how a refused manual release comes back for a ticket delivery.
 * The API answers `409 { payments: 'event_ended' | 'event_cancelled' }` when the paid event moved on, and
 * the action maps each to a CLOSED code the list turns into a toast and a refresh; the shipped codes keep
 * theirs and a malformed id never reaches the API. Stubbed: `lib/payments` (the request). Real: the schemas
 * and the refusal mapping.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

const { grantEvent } = vi.hoisted(() => ({ grantEvent: vi.fn() }));
vi.mock('@/lib/payments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payments')>();
  return { ...actual, grantEvent };
});
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('redirect should not be reached in these cases');
  }),
}));

const { PaymentsApiError } = await import('@/lib/payments');
const { grantEventAction } = await import('./actions');

const ID = '66666666-6666-4666-8666-666666666666';
const refused = (issue: string | null, status = 409, code = 'CONFLICT') =>
  new PaymentsApiError(status, code, issue as never);

beforeEach(() => {
  grantEvent.mockReset();
});

describe('grantEventAction: the ticket refusals (D-750, UI-D-759)', () => {
  it.each([
    ['event_ended', 'event_ended'],
    ['event_cancelled', 'event_cancelled'],
    ['no_membership', 'no_membership'],
    ['not_grantable', 'not_grantable'],
  ])('a 409 %s is the closed code %s', async (issue, code) => {
    grantEvent.mockRejectedValue(refused(issue));
    expect(await grantEventAction(ID)).toEqual({ ok: false, code });
  });

  it('the bare 404 is gone, a lost module or permission is forbidden, the rest is generic', async () => {
    grantEvent.mockRejectedValue(refused(null, 404, 'NOT_FOUND'));
    expect(await grantEventAction(ID)).toEqual({ ok: false, code: 'gone' });
    grantEvent.mockRejectedValue(refused(null, 403, 'MODULE_DISABLED'));
    expect(await grantEventAction(ID)).toEqual({ ok: false, code: 'forbidden' });
    grantEvent.mockRejectedValue(refused(null, 500, 'INTERNAL'));
    expect(await grantEventAction(ID)).toEqual({ ok: false, code: 'generic' });
  });

  it('a success returns the updated event from the server, never an invented one', async () => {
    const event = { id: ID, state: 'applied', outcome: 'ticket_granted' };
    grantEvent.mockResolvedValue(event);
    const out = await grantEventAction(ID);
    expect(out).toMatchObject({ ok: true, event });
    expect(grantEvent).toHaveBeenCalledWith(ID);
  });

  it('a malformed id never reaches the API', async () => {
    expect(await grantEventAction('not-an-id')).toEqual({ ok: false, code: 'generic' });
    expect(grantEvent).not.toHaveBeenCalled();
  });
});
