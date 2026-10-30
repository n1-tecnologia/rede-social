// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { landOnFormFlow } from './LiveShell';

/**
 * 12-11 (PFORM-12, D-581, T-12-28) — an open app whose counters refetch is refused with 403
 * `PROFILE_FORM_PENDING` lands on the form with a full navigation; nothing else ever navigates. The
 * mirror of `LiveShell.pending.test.ts`: the session stays, and only a same-origin `/completar-perfil`
 * path is followed.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const refusal = {
  error: { code: 'PROFILE_FORM_PENDING' },
  location: '/completar-perfil?t=Rede%20Demo',
};

describe('landOnFormFlow', () => {
  it('navigates to the BFF’s /completar-perfil path on 403 PROFILE_FORM_PENDING', async () => {
    const navigate = vi.fn();
    expect(await landOnFormFlow(json(403, refusal), navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/completar-perfil?t=Rede%20Demo');
  });

  it('never navigates for another code, another status, an empty body or a foreign location', async () => {
    const navigate = vi.fn();
    for (const response of [
      json(403, { error: { code: 'FORBIDDEN' }, location: '/completar-perfil' }),
      json(403, { error: { code: 'SUBSCRIPTION_PENDING' }, location: '/assinatura-pendente' }),
      json(403, { error: { code: 'MEMBERSHIP_BLOCKED' }, location: '/auth/blocked?t=x' }),
      json(401, refusal),
      json(200, refusal),
      new Response(null, { status: 403 }),
      new Response('not json', { status: 403 }),
      json(403, { error: { code: 'PROFILE_FORM_PENDING' }, location: 'https://evil.example/' }),
      json(403, {
        error: { code: 'PROFILE_FORM_PENDING' },
        location: '//evil.com/completar-perfil',
      }),
      json(403, {
        error: { code: 'PROFILE_FORM_PENDING' },
        location: 'https://evil.example/completar-perfil',
      }),
      json(403, { error: { code: 'PROFILE_FORM_PENDING' }, location: '/inicio' }),
      json(403, { error: { code: 'PROFILE_FORM_PENDING' }, location: 42 }),
      json(403, { error: { code: 'PROFILE_FORM_PENDING' } }),
    ]) {
      expect(await landOnFormFlow(response, navigate)).toBe(false);
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('is idempotent: the same refusal twice navigates twice and never throws', async () => {
    const navigate = vi.fn();
    expect(await landOnFormFlow(json(403, refusal), navigate)).toBe(true);
    expect(await landOnFormFlow(json(403, refusal), navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});
