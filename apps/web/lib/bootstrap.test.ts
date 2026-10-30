import { describe, expect, it, vi } from 'vitest';

/**
 * 09.1-15 (PAY-14, PAY-15, D-497, D-499) — `bootstrapRedirectPath` maps a payment cut to the pending
 * screen and leaves every older mapping alone. A pure function of the error: the same input always gives
 * the same path, and nothing in the mapping touches a session (the cut never signs the person out).
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

/** `redirect()` throws NEXT_REDIRECT in Next; the stand-in throws the target so a test can read it. */
class Redirected extends Error {
  constructor(readonly path: string) {
    super(`REDIRECT ${path}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Redirected(path);
  },
}));

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => requestHeaders.current }));

const { apiFetch } = await import('@/lib/api');
const { ApiClientError, bootstrapRedirectPath, requireBootstrap } = await import('./bootstrap');

describe('bootstrapRedirectPath: SUBSCRIPTION_PENDING (09.1-15)', () => {
  it('sends a payment cut to /assinatura-pendente with the tenant name as the fallback text', () => {
    const error = new ApiClientError(403, 'SUBSCRIPTION_PENDING', { tenantName: 'Clínica Ana' });
    expect(bootstrapRedirectPath(error)).toBe('/assinatura-pendente?t=Cl%C3%ADnica%20Ana');
  });

  it('reads a missing or null name as an empty fallback, never as "undefined" or "null"', () => {
    expect(bootstrapRedirectPath(new ApiClientError(403, 'SUBSCRIPTION_PENDING'))).toBe(
      '/assinatura-pendente?t=',
    );
    expect(
      bootstrapRedirectPath(new ApiClientError(403, 'SUBSCRIPTION_PENDING', { tenantName: null })),
    ).toBe('/assinatura-pendente?t=');
  });

  it('encodes a name that tries to smuggle a second parameter or a path', () => {
    const path = bootstrapRedirectPath(
      new ApiClientError(403, 'SUBSCRIPTION_PENDING', {
        tenantName: 'A&link=https://evil.example/',
      }),
    );
    expect(path).toBe('/assinatura-pendente?t=A%26link%3Dhttps%3A%2F%2Fevil.example%2F');
  });

  it('is a pure function of the error: the same input gives the same path', () => {
    const make = () => new ApiClientError(403, 'SUBSCRIPTION_PENDING', { tenantName: 'Rede Demo' });
    expect(bootstrapRedirectPath(make())).toBe(bootstrapRedirectPath(make()));
  });

  it('keeps the blocked flow and the other mappings exactly as they were', () => {
    expect(
      bootstrapRedirectPath(
        new ApiClientError(403, 'MEMBERSHIP_BLOCKED', { tenantName: 'Rede Demo' }),
      ),
    ).toBe('/auth/blocked?t=Rede%20Demo');
    expect(bootstrapRedirectPath(new ApiClientError(401, 'UNAUTHORIZED'))).toBe('/entrar');
    expect(bootstrapRedirectPath(new ApiClientError(403, 'TENANT_SUSPENDED'))).toBe(
      '/auth/suspended',
    );
    expect(bootstrapRedirectPath(new ApiClientError(403, 'TENANT_HOST_MISMATCH'))).toBe(
      '/participar',
    );
    expect(bootstrapRedirectPath(new ApiClientError(403, 'FORBIDDEN'))).toBeNull();
  });
});

/**
 * 09.2-21 (UI-D-542, DBT-53, T-09.2-95; P105): the three held-out refusals of plan 08 land on their
 * public screens DIRECTLY. None of them goes through `/auth/suspended` (the only route that clears the
 * session), so a migration is never a logout; the session is cleared only by the suspended flow's own
 * route, and a change of state between two requests simply maps the NEW code to its own screen.
 */
describe('bootstrapRedirectPath: held-out tenant states (09.2-21)', () => {
  it.each([
    ['TENANT_UPDATING', '/comunidade-em-atualizacao'],
    ['TENANT_PREPARING', '/comunidade-em-preparacao'],
    ['TENANT_UNAVAILABLE', '/comunidade-indisponivel'],
  ])('%s -> %s, with no query and no detail carried', (code, path) => {
    expect(bootstrapRedirectPath(new ApiClientError(503, code))).toBe(path);
    expect(
      bootstrapRedirectPath(
        new ApiClientError(503, code, { tenantName: 'Rede Demo', reason: 'x' }),
      ),
    ).toBe(path);
  });

  it('none of the three routes through the session-clearing /auth/suspended route (T-09.2-95)', () => {
    for (const code of ['TENANT_UPDATING', 'TENANT_PREPARING', 'TENANT_UNAVAILABLE']) {
      const path = bootstrapRedirectPath(new ApiClientError(503, code));
      expect(path).not.toBeNull();
      expect(path).not.toMatch(/^\/auth\//);
    }
  });

  it('P105: a tenant going from updating to suspended maps the next refusal to the suspended flow', () => {
    expect(bootstrapRedirectPath(new ApiClientError(503, 'TENANT_UPDATING'))).toBe(
      '/comunidade-em-atualizacao',
    );
    expect(bootstrapRedirectPath(new ApiClientError(403, 'TENANT_SUSPENDED'))).toBe(
      '/auth/suspended',
    );
  });

  it('keeps every older mapping exactly as it was', () => {
    expect(bootstrapRedirectPath(new ApiClientError(401, 'UNAUTHORIZED'))).toBe('/entrar');
    expect(bootstrapRedirectPath(new ApiClientError(403, 'TENANT_SUSPENDED'))).toBe(
      '/auth/suspended',
    );
    expect(bootstrapRedirectPath(new ApiClientError(403, 'TENANT_HOST_MISMATCH'))).toBe(
      '/participar',
    );
    expect(bootstrapRedirectPath(new ApiClientError(403, 'NO_MEMBERSHIP'))).toBe('/sem-comunidade');
    expect(bootstrapRedirectPath(new ApiClientError(500, 'INTERNAL'))).toBeNull();
  });
});

/**
 * 12-11 (PFORM-12, D-581): a member who owes a required answer is sent to the form. The mapping carries
 * the tenant name as fallback text and NO destination; the destination of a render travels in the
 * validated `x-rede-path` header (D-583).
 */
describe('bootstrapRedirectPath: PROFILE_FORM_PENDING (12-11)', () => {
  it('sends a pending member to /completar-perfil with the tenant name as the fallback text', () => {
    const error = new ApiClientError(403, 'PROFILE_FORM_PENDING', { tenantName: 'Clínica Ana' });
    expect(bootstrapRedirectPath(error)).toBe('/completar-perfil?t=Cl%C3%ADnica%20Ana');
  });

  it('reads a missing or null name as an empty fallback', () => {
    expect(bootstrapRedirectPath(new ApiClientError(403, 'PROFILE_FORM_PENDING'))).toBe(
      '/completar-perfil?t=',
    );
    expect(
      bootstrapRedirectPath(new ApiClientError(403, 'PROFILE_FORM_PENDING', { tenantName: null })),
    ).toBe('/completar-perfil?t=');
  });

  it('encodes a name that tries to smuggle a second parameter, and never carries a next', () => {
    const path = bootstrapRedirectPath(
      new ApiClientError(403, 'PROFILE_FORM_PENDING', { tenantName: 'A&next=//evil.example' }),
    );
    expect(path).toBe('/completar-perfil?t=A%26next%3D%2F%2Fevil.example');
    expect(new URL(path as string, 'http://x').searchParams.has('next')).toBe(false);
  });
});

const MEMBER = '0e000000-0000-4000-8000-000000000e01';
const TENANT = '0e000000-0000-4000-8000-000000000e02';

function bootstrapBody(overrides: Record<string, unknown> = {}, status = 'active') {
  return {
    user: { id: MEMBER, email: 'ana@example.com', name: 'Ana' },
    membership: {
      tenantId: TENANT,
      role: 'member',
      status,
      profile: { displayName: 'Ana', avatarUrl: null, bio: null },
    },
    tenant: {
      id: TENANT,
      slug: 'rede-demo',
      displayName: 'Rede Demo',
      branding: {
        logoUrl: null,
        faviconUrl: null,
        iconUrls: null,
        colors: {
          primary: '#b91c1c',
          secondary: '#f87171',
          onPrimary: '#ffffff',
          primaryDark: '#e26666',
          onPrimaryDark: '#16233b',
        },
      },
      timezone: 'America/Sao_Paulo',
    },
    modules: [],
    permissions: [],
    counters: { unreadNotifications: 0, unreadConversations: 0 },
    ...overrides,
  };
}

function answer(body: unknown) {
  vi.mocked(apiFetch).mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

async function redirectOf(): Promise<string | null> {
  try {
    await requireBootstrap();
    return null;
  } catch (error) {
    if (error instanceof Redirected) return error.path;
    throw error;
  }
}

describe('requireBootstrap: the pending-form redirect (12-11, D-581, D-583, PFORM-15)', () => {
  const pending = { profileForm: { pendingRequired: 1, newOptional: 0 } };

  it('redirects a pending member to the form carrying the validated destination, encoded once', async () => {
    requestHeaders.current = new Headers({ 'x-rede-path': '/post/abc' });
    answer(bootstrapBody(pending));
    expect(await redirectOf()).toBe('/completar-perfil?next=%2Fpost%2Fabc');
  });

  it('keeps a query string of the destination inside the single encoded parameter', async () => {
    requestHeaders.current = new Headers({ 'x-rede-path': '/post/abc?x=1&y=2' });
    answer(bootstrapBody(pending));
    const path = (await redirectOf()) as string;
    expect(new URL(path, 'http://x').searchParams.get('next')).toBe('/post/abc?x=1&y=2');
  });

  it.each([
    ['//evil.com'],
    ['/\\evil.com'],
    ['https://evil.com'],
    ['/%2F%2Fevil.com'],
    ['/completar-perfil'],
    ['/entrar'],
    [''],
  ])(
    'a hostile or useless header %j redirects to the bare form, with no next parameter',
    async (value) => {
      requestHeaders.current = new Headers({ 'x-rede-path': value });
      answer(bootstrapBody(pending));
      const path = await redirectOf();
      expect(path).toBe('/completar-perfil');
      expect(path).not.toContain('next');
    },
  );

  it('a missing header redirects to the bare form', async () => {
    requestHeaders.current = new Headers();
    answer(bootstrapBody(pending));
    expect(await redirectOf()).toBe('/completar-perfil');
  });

  it('returns the bootstrap when nothing is pending, or when the API sends no profileForm block', async () => {
    requestHeaders.current = new Headers({ 'x-rede-path': '/post/abc' });
    answer(bootstrapBody({ profileForm: { pendingRequired: 0, newOptional: 2 } }));
    expect((await requireBootstrap()).tenant.slug).toBe('rede-demo');
    answer(bootstrapBody());
    expect((await requireBootstrap()).tenant.slug).toBe('rede-demo');
  });

  it('an invited membership still goes to /aceitar-convite first', async () => {
    requestHeaders.current = new Headers({ 'x-rede-path': '/post/abc' });
    answer(bootstrapBody(pending, 'invited'));
    expect(await redirectOf()).toBe('/aceitar-convite');
  });
});
