// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { landOnPendingFlow } from './LiveShell';

/**
 * 09.1-15 (PAY-14, PAY-15, D-497, T-09.1-73) — an open app whose counters refetch is refused with 403
 * `SUBSCRIPTION_PENDING` lands on the pending screen with a full navigation; nothing else ever navigates.
 * The mirror of `LiveShell.blocked.test.ts`: the only difference is that the session stays (D-499).
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const refusal = {
  error: { code: 'SUBSCRIPTION_PENDING' },
  location: '/assinatura-pendente?t=Rede%20Demo',
};

describe('landOnPendingFlow', () => {
  it('navigates to the BFF’s /assinatura-pendente path on 403 SUBSCRIPTION_PENDING', async () => {
    const navigate = vi.fn();
    expect(await landOnPendingFlow(json(403, refusal), navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/assinatura-pendente?t=Rede%20Demo');
  });

  it('never navigates for another code, another status, an empty body or a foreign location', async () => {
    const navigate = vi.fn();
    for (const response of [
      json(403, { error: { code: 'FORBIDDEN' }, location: '/assinatura-pendente' }),
      json(403, { error: { code: 'MEMBERSHIP_BLOCKED' }, location: '/auth/blocked?t=x' }),
      json(401, refusal),
      json(200, refusal),
      new Response(null, { status: 403 }),
      json(403, { error: { code: 'SUBSCRIPTION_PENDING' }, location: 'https://evil.example/' }),
      json(403, {
        error: { code: 'SUBSCRIPTION_PENDING' },
        location: '//evil.example/assinatura-pendente',
      }),
      json(403, { error: { code: 'SUBSCRIPTION_PENDING' }, location: '/auth/blocked?t=x' }),
      json(403, { error: { code: 'SUBSCRIPTION_PENDING' }, location: 42 }),
      json(403, { error: { code: 'SUBSCRIPTION_PENDING' } }),
    ]) {
      expect(await landOnPendingFlow(response, navigate)).toBe(false);
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('is idempotent: the same refusal twice navigates twice and never throws', async () => {
    const navigate = vi.fn();
    expect(await landOnPendingFlow(json(403, refusal), navigate)).toBe(true);
    expect(await landOnPendingFlow(json(403, refusal), navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});
