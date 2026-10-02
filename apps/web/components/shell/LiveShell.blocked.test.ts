// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { landOnBlockedFlow } from './LiveShell';

/**
 * 08-04 (MODER-02, T-08-24): an open app whose counters refetch is refused with 403
 * `MEMBERSHIP_BLOCKED` lands on the shipped blocked flow; nothing else ever navigates.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('landOnBlockedFlow', () => {
  it('navigates to the BFF’s /auth/blocked path on 403 MEMBERSHIP_BLOCKED', async () => {
    const navigate = vi.fn();
    const landed = await landOnBlockedFlow(
      json(403, {
        error: { code: 'MEMBERSHIP_BLOCKED' },
        location: '/auth/blocked?t=Rede%20Demo',
      }),
      navigate,
    );
    expect(landed).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/auth/blocked?t=Rede%20Demo');
  });

  it('never navigates for another code, another status, an empty body or a foreign location', async () => {
    const navigate = vi.fn();
    for (const response of [
      json(403, { error: { code: 'FORBIDDEN' }, location: '/auth/blocked' }),
      json(401, { error: { code: 'MEMBERSHIP_BLOCKED' }, location: '/auth/blocked' }),
      new Response(null, { status: 403 }),
      json(403, { error: { code: 'MEMBERSHIP_BLOCKED' }, location: 'https://evil.example/' }),
      json(403, { error: { code: 'MEMBERSHIP_BLOCKED' }, location: '//evil.example/auth/blocked' }),
      json(403, { error: { code: 'MEMBERSHIP_BLOCKED' } }),
    ]) {
      expect(await landOnBlockedFlow(response, navigate)).toBe(false);
    }
    expect(navigate).not.toHaveBeenCalled();
  });
});
