import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 12.3-16 (D-697, UI-D-694): the two calls that keep the phone menu in the tenant's brand,
 * `PUT` and `DELETE /v1/admin/branding/phone-menu`. The API owns the rules and answers a refusal as a
 * 400 carrying `details.phoneMenu` from a closed vocabulary; the shell's session refusals map to the
 * navigation the rest of the app uses, and anything else is the generic failure (shape-only logging).
 */

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/lib/bootstrap', () => ({
  ApiClientError: class ApiClientError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      public readonly details?: Record<string, unknown>,
    ) {
      super(`API ${status} ${code}`);
    }
  },
  bootstrapRedirectPath: (error: { status: number; code: string }) =>
    error.status === 401 ? '/entrar' : error.code === 'TENANT_SUSPENDED' ? '/auth/suspended' : null,
}));

const { clearPhoneMenu, savePhoneMenu } = await import('./phone-menu');

const MENU = { bar: ['home', 'events'], top: ['store'], hidden: ['communities'] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('savePhoneMenu', () => {
  it('PUTs the three lists as JSON and answers ok', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, {}));
    expect(await savePhoneMenu(MENU)).toEqual({ status: 'ok' });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/admin/branding/phone-menu');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual(MENU);
  });

  it("answers the API's rule refusal as its code", async () => {
    for (const issue of [
      'bar_too_small',
      'bar_too_large',
      'top_too_large',
      'key_repeated',
      'home_not_in_bar',
      'profile_at_top',
    ]) {
      mocks.apiFetch.mockResolvedValue(
        json(400, { error: { code: 'VALIDATION_FAILED', details: { phoneMenu: issue } } }),
      );
      expect(await savePhoneMenu(MENU)).toEqual({ status: 'rules', issue });
    }
  });

  it('a plain 400 (no phoneMenu code) and an unknown code are the generic failure', async () => {
    mocks.apiFetch.mockResolvedValue(json(400, { error: { code: 'VALIDATION_FAILED' } }));
    expect(await savePhoneMenu(MENU)).toEqual({ status: 'error' });
    mocks.apiFetch.mockResolvedValue(
      json(400, { error: { code: 'VALIDATION_FAILED', details: { phoneMenu: 'surprise' } } }),
    );
    expect(await savePhoneMenu(MENU)).toEqual({ status: 'error' });
  });

  it('maps a session refusal to the navigation the app uses, a lost permission to Configurações', async () => {
    mocks.apiFetch.mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED' } }));
    expect(await savePhoneMenu(MENU)).toEqual({ status: 'redirect', path: '/entrar' });
    mocks.apiFetch.mockResolvedValue(json(403, { error: { code: 'TENANT_SUSPENDED' } }));
    expect(await savePhoneMenu(MENU)).toEqual({ status: 'redirect', path: '/auth/suspended' });
    mocks.apiFetch.mockResolvedValue(json(403, { error: { code: 'FORBIDDEN' } }));
    expect(await savePhoneMenu(MENU)).toEqual({
      status: 'redirect',
      path: '/configuracoes?erro=sem-permissao',
    });
  });

  it('a server error, a non-JSON body and a network failure are the generic failure', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('boom', { status: 500 }));
    expect(await savePhoneMenu(MENU)).toEqual({ status: 'error' });
    mocks.apiFetch.mockRejectedValue(new Error('network'));
    expect(await savePhoneMenu(MENU)).toEqual({ status: 'error' });
  });
});

describe('clearPhoneMenu', () => {
  it('DELETEs the saved menu and answers ok', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, {}));
    expect(await clearPhoneMenu()).toEqual({ status: 'ok' });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/admin/branding/phone-menu');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('answers a refusal like the save does', async () => {
    mocks.apiFetch.mockResolvedValue(json(403, { error: { code: 'FORBIDDEN' } }));
    expect(await clearPhoneMenu()).toEqual({
      status: 'redirect',
      path: '/configuracoes?erro=sem-permissao',
    });
    mocks.apiFetch.mockResolvedValue(new Response('boom', { status: 502 }));
    expect(await clearPhoneMenu()).toEqual({ status: 'error' });
  });
});
