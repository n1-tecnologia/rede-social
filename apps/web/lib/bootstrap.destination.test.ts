import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Quick 261030-g1y (PFORM-12, PFORM-15, D-581, D-583): a deep link such as `/post/{id}` opened by a
 * member who owes a required profile-form answer must reach `/completar-perfil` carrying `next`
 * whichever refusal wins the page's `Promise.all([requireBootstrap(), loadPost()])`. The API gate
 * answers the loader's 403 before the multi-query bootstrap, so the LOADER's redirect wins the race;
 * these tests run the real guard against the real `loadPost`.
 *
 * `react`'s `cache` is replaced by a memoising stand-in: the server build memoises per request render,
 * while the default build (and so every other unit test) returns a fresh value on every call. Each test
 * is a "new request": `vi.resetModules()` plus fresh dynamic imports gives a fresh memo.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

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

vi.mock('react', () => ({
  cache: <A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) => {
    const memo = new Map<string, R>();
    return (...args: A): R => {
      const key = JSON.stringify(args);
      if (!memo.has(key)) memo.set(key, fn(...args));
      return memo.get(key) as R;
    };
  },
}));

const MEMBER = '0e000000-0000-4000-8000-000000000e01';
const TENANT = '0e000000-0000-4000-8000-000000000e02';

const bootstrapBody = {
  user: { id: MEMBER, email: 'ana@example.com', name: 'Ana' },
  membership: {
    tenantId: TENANT,
    role: 'member',
    status: 'active',
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
  profileForm: { pendingRequired: 1, newOptional: 0 },
};

const pendingEnvelope = {
  error: {
    code: 'PROFILE_FORM_PENDING',
    message: 'pending',
    details: { tenantName: 'Rede Demo' },
  },
};

/** One "request render": fresh modules (fresh memo), the API routed by path, bootstrap held open. */
async function newRequest(headerValue: string | null) {
  vi.resetModules();
  requestHeaders.current = new Headers(headerValue === null ? {} : { 'x-rede-path': headerValue });
  const { apiFetch } = await import('@/lib/api');
  let releaseBootstrap: () => void = () => {};
  const bootstrapGate = new Promise<void>((resolve) => {
    releaseBootstrap = resolve;
  });
  vi.mocked(apiFetch).mockImplementation(async (path: string) => {
    if (path === '/v1/me/bootstrap') {
      await bootstrapGate;
      return new Response(JSON.stringify(bootstrapBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // The data read: the gate answers after one macrotask, long before the bootstrap.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return new Response(JSON.stringify(pendingEnvelope), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  });
  const { requireBootstrap } = await import('./bootstrap');
  const { loadPost } = await import('./feed');
  return { requireBootstrap, loadPost, releaseBootstrap };
}

async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof Redirected) return error.path;
    throw error;
  }
}

describe('PROFILE_FORM_PENDING keeps the validated destination when the loader wins the race', () => {
  beforeEach(() => {
    requestHeaders.current = new Headers();
  });

  it('the loader refusal and the guard refusal both carry next=/post/abc', async () => {
    const { requireBootstrap, loadPost, releaseBootstrap } = await newRequest('/post/abc');

    const guard = redirectOf(() => requireBootstrap());
    const loader = redirectOf(() => loadPost('abc'));

    // The loader's 403 is answered while the bootstrap is still in flight: the loader wins.
    const loaderPath = (await loader) as string;
    expect(loaderPath).toBe('/completar-perfil?t=Rede%20Demo&next=%2Fpost%2Fabc');

    releaseBootstrap();
    const guardPath = (await guard) as string;
    expect(guardPath).toBe('/completar-perfil?next=%2Fpost%2Fabc');

    const loaderNext = new URL(loaderPath, 'http://x').searchParams.get('next');
    const guardNext = new URL(guardPath, 'http://x').searchParams.get('next');
    expect(loaderNext).toBe('/post/abc');
    expect(guardNext).toBe(loaderNext);
  });

  it('settles both refusals of a Promise.all-shaped page without an unhandled rejection', async () => {
    const { requireBootstrap, loadPost, releaseBootstrap } = await newRequest('/post/abc');
    const both = Promise.allSettled([requireBootstrap(), loadPost('abc')]);
    releaseBootstrap();
    const [guard, loader] = await both;
    expect(guard.status).toBe('rejected');
    expect(loader.status).toBe('rejected');
    expect((loader as PromiseRejectedResult).reason).toBeInstanceOf(Redirected);
    expect(((loader as PromiseRejectedResult).reason as Redirected).path).toContain(
      'next=%2Fpost%2Fabc',
    );
  });

  it.each([
    ['//evil.com'],
    ['/\\evil.com'],
    ['https://evil.com'],
    ['/%2F%2Fevil.com'],
    ['/completar-perfil'],
    ['/entrar'],
    [''],
  ])('a hostile or useless header %j never reaches the loader URL', async (value) => {
    const { requireBootstrap, loadPost, releaseBootstrap } = await newRequest(value);
    const guard = redirectOf(() => requireBootstrap());
    const loaderPath = (await redirectOf(() => loadPost('abc'))) as string;
    expect(loaderPath).toBe('/completar-perfil?t=Rede%20Demo');
    expect(new URL(loaderPath, 'http://x').searchParams.has('next')).toBe(false);
    releaseBootstrap();
    expect(await guard).toBe('/completar-perfil');
  });

  it('with no guard in the request (counters route, actions) the loader keeps the bare form path', async () => {
    const { loadPost } = await newRequest('/api/me/counters');
    const loaderPath = (await redirectOf(() => loadPost('abc'))) as string;
    expect(loaderPath).toBe('/completar-perfil?t=Rede%20Demo');
    expect(new URL(loaderPath, 'http://x').searchParams.has('next')).toBe(false);
  });

  it('keeps the destination in a request-scoped slot, never in a module-level variable', () => {
    const source = readFileSync(join(__dirname, 'bootstrap.ts'), 'utf8');
    expect(source).toMatch(/renderDestination\s*=\s*cache\(/);
    expect(source).not.toMatch(/^let\s/m);
  });
});
