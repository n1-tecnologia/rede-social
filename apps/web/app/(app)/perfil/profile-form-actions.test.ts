import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 12-14 Task 2 (D-586, PFORM-16): `dismissNoticeAction` posts to the server-side dismissal, returns a typed
 * result, follows the shipped navigation for a session refusal (outside any try/catch) and logs no more
 * than a status and a code.
 */

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

const { dismissNoticeAction } = await import('./profile-form-actions');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  mocks.apiFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('dismissNoticeAction', () => {
  it('posts to the dismissal route and answers ok', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { newOptional: 0 }));
    expect(await dismissNoticeAction()).toEqual({ ok: true });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/me/profile-form/dismiss-notice', {
      method: 'POST',
    });
  });

  it('answers not ok for a 500 and for a transport failure, without throwing', async () => {
    mocks.apiFetch.mockResolvedValueOnce(json(500, { error: { code: 'INTERNAL' } }));
    expect(await dismissNoticeAction()).toEqual({ ok: false });
    mocks.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await dismissNoticeAction()).toEqual({ ok: false });
  });

  it('follows the shipped navigation for a refused session', async () => {
    mocks.apiFetch.mockResolvedValue(json(401, { error: { code: 'UNAUTHORIZED' } }));
    await expect(dismissNoticeAction()).rejects.toThrow('REDIRECT /entrar');

    mocks.apiFetch.mockResolvedValue(
      json(403, { error: { code: 'PROFILE_FORM_PENDING', details: { tenantName: 'Ana' } } }),
    );
    await expect(dismissNoticeAction()).rejects.toThrow('REDIRECT /completar-perfil?t=Ana');
  });

  it('answers not ok for a 403 that no navigation knows', async () => {
    mocks.apiFetch.mockResolvedValue(json(403, { error: { code: 'FORBIDDEN' } }));
    expect(await dismissNoticeAction()).toEqual({ ok: false });
  });
});
