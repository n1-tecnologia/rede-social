import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.2-21 (UI-D-542, T-09.2-95): the login action refuses a held-out host before any Auth call, each to
 * its own public screen, and clears no cookie for it. An active host proceeds as before.
 */
const mocks = vi.hoisted(() => ({
  status: 'active' as string | undefined,
  signIn: vi.fn(),
  cookieDeletes: [] as string[],
}));

vi.mock('@/lib/host-brand', () => ({
  getHostBrand: async () => ({
    tenant: mocks.status === undefined ? null : { slug: 'rede-demo', status: mocks.status },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signInWithPassword: mocks.signIn } }),
}));
vi.mock('@/lib/pending-confirmation', () => ({
  isEmailNotConfirmed: () => false,
  writePendingConfirmation: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    delete: (name: string) => mocks.cookieDeletes.push(name),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const { login } = await import('./actions');

function form(): FormData {
  const data = new FormData();
  data.set('email', 'maria@example.com');
  data.set('password', 'Segredo123');
  return data;
}

async function run(): Promise<string> {
  try {
    await login(form());
  } catch (error) {
    return (error as Error).message;
  }
  return 'returned';
}

beforeEach(() => {
  mocks.status = 'active';
  mocks.signIn.mockReset();
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.cookieDeletes.length = 0;
});

describe('login on a held-out host (09.2-21)', () => {
  it.each([
    ['suspended', '/comunidade-indisponivel'],
    ['unavailable', '/comunidade-indisponivel'],
    ['updating', '/comunidade-em-atualizacao'],
    ['preparing', '/comunidade-em-preparacao'],
  ])(
    '%s redirects to %s without reaching the auth client or clearing a cookie',
    async (status, path) => {
      mocks.status = status;
      expect(await run()).toBe(`redirect:${path}`);
      expect(mocks.signIn).not.toHaveBeenCalled();
      expect(mocks.cookieDeletes).toEqual([]);
    },
  );

  it('an active host proceeds to the auth client and lands on /inicio', async () => {
    expect(await run()).toBe('redirect:/inicio');
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });

  it('a host with no tenant answer (generic or platform) proceeds as before', async () => {
    mocks.status = undefined;
    expect(await run()).toBe('redirect:/inicio');
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });
});
