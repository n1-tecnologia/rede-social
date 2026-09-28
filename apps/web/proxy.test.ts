import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveHostTenant } from './lib/tenant-host';
import { proxy } from './proxy';

/**
 * Host routing rules of `proxy.ts` (D-35 alias → primary 308, D-36 verified-only classification,
 * PUBLIC entries). The by-host answer is stubbed at `resolveHostTenant`; the Supabase client answers
 * "no session" so the private-route rule is exercised too.
 */
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://sb.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk',
  },
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: { claims: null } }) },
  }),
}));

vi.mock('@/lib/tenant-host', async (orig) => ({
  ...(await orig<typeof import('./lib/tenant-host')>()),
  resolveHostTenant: vi.fn(),
}));

const resolve = vi.mocked(resolveHostTenant);

const branding = {
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
};

function tenant(host: string, isPrimary: boolean, primaryHost: string) {
  return {
    mode: 'tenant' as const,
    host,
    slug: 'acme',
    displayName: 'Acme',
    status: 'active' as const,
    isPrimary,
    primaryHost,
    branding,
  };
}

function request(url: string, headers: Record<string, string>, method = 'GET') {
  return new NextRequest(url, { method, headers });
}

describe('proxy.ts — alias → primary 308 (D-35)', () => {
  beforeEach(() => resolve.mockReset());

  it('1. a verified non-primary host 308s to the primary, path + query preserved, no-store', async () => {
    resolve.mockResolvedValue(tenant('alias.example', false, 'primary.example'));
    const res = await proxy(request('http://alias.example/entrar?x=1', { host: 'alias.example' }));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('http://primary.example/entrar?x=1');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('2. scheme from x-forwarded-proto, port from the browser-facing host', async () => {
    resolve.mockResolvedValue(tenant('alias.example', false, 'primary.example'));
    const res = await proxy(
      request('http://localhost:3000/entrar?x=1', {
        host: 'localhost:3000',
        'x-forwarded-host': 'alias.example:3000',
        'x-forwarded-proto': 'https',
      }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://primary.example:3000/entrar?x=1');
  });

  it('3. a POST on the alias is redirected too (308 keeps the method)', async () => {
    resolve.mockResolvedValue(tenant('alias.example', false, 'primary.example'));
    const res = await proxy(
      request('http://alias.example/cadastro', { host: 'alias.example' }, 'POST'),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('http://primary.example/cadastro');
  });

  it('4. the primary host is served: no redirect, x-tenant-mode = tenant', async () => {
    resolve.mockResolvedValue(tenant('primary.example', true, 'primary.example'));
    const res = await proxy(request('http://primary.example/entrar', { host: 'primary.example' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-tenant-mode')).toBe('tenant');
  });

  it('5. an unverified host is generic (D-36): neutral shell, no redirect, private routes still guarded', async () => {
    resolve.mockResolvedValue({ mode: 'generic', host: 'unverified.example' });
    const entrar = await proxy(
      request('http://unverified.example/entrar', { host: 'unverified.example' }),
    );
    expect(entrar.status).toBe(200);
    expect(entrar.headers.get('location')).toBeNull();
    expect(entrar.headers.get('x-middleware-request-x-tenant-mode')).toBe('generic');

    const inicio = await proxy(
      request('http://unverified.example/inicio', { host: 'unverified.example' }),
    );
    expect(inicio.status).toBe(307);
    expect(inicio.headers.get('location')).toBe('http://unverified.example/entrar');
  });

  it('6. loop guard: a primaryHost equal to the current host never redirects', async () => {
    resolve.mockResolvedValue(tenant('alias.example', false, 'alias.example'));
    const res = await proxy(request('http://alias.example/entrar', { host: 'alias.example' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('7. an unregistrable primaryHost never becomes a Location (T-02-40)', async () => {
    resolve.mockResolvedValue(tenant('alias.example', false, 'evil.example/@'));
    const res = await proxy(request('http://alias.example/entrar', { host: 'alias.example' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('proxy.ts — PUBLIC entries', () => {
  beforeEach(() => {
    resolve.mockReset();
    resolve.mockResolvedValue(tenant('primary.example', true, 'primary.example'));
  });

  it('8. /comunidade-indisponivel and /aceitar-convite are public; /configuracoes is not', async () => {
    const unavailable = await proxy(
      request('http://primary.example/comunidade-indisponivel', { host: 'primary.example' }),
    );
    expect(unavailable.status).toBe(200);
    expect(unavailable.headers.get('location')).toBeNull();

    const invite = await proxy(
      request('http://primary.example/aceitar-convite?t=abc', { host: 'primary.example' }),
    );
    expect(invite.status).toBe(200);

    const settings = await proxy(
      request('http://primary.example/configuracoes', { host: 'primary.example' }),
    );
    expect(settings.status).toBe(307);
    expect(settings.headers.get('location')).toBe('http://primary.example/entrar');
  });
});

describe('proxy.ts — PWA PUBLIC entries (02-11, T-02-77)', () => {
  beforeEach(() => {
    resolve.mockReset();
    resolve.mockResolvedValue(tenant('primary.example', true, 'primary.example'));
  });

  it('9. the tenant manifest, the reserved _rede manifest, the SW script and /~offline are public', async () => {
    for (const path of [
      '/m/rede-demo/manifest.webmanifest',
      '/m/_rede/manifest.webmanifest',
      '/serwist/sw.js',
      '/~offline',
    ]) {
      const res = await proxy(
        request(`http://primary.example${path}`, { host: 'primary.example' }),
      );
      expect(res.status, path).toBe(200);
      expect(res.headers.get('location'), path).toBeNull();
    }
  });

  it('10. /inicio still redirects to /entrar without a session', async () => {
    const res = await proxy(request('http://primary.example/inicio', { host: 'primary.example' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://primary.example/entrar');
  });

  it('11. the anchored manifest entry refuses a traversal suffix and an upper-case slug (class stays lower-case)', async () => {
    // `/m/rede-demo/manifest.webmanifest/../inicio` normalises to `/m/rede-demo/inicio`.
    const traversal = await proxy(
      request('http://primary.example/m/rede-demo/manifest.webmanifest/../inicio', {
        host: 'primary.example',
      }),
    );
    expect(traversal.status).toBe(307);
    expect(traversal.headers.get('location')).toBe('http://primary.example/entrar');

    const upper = await proxy(
      request('http://primary.example/m/Rede_Demo/manifest.webmanifest', {
        host: 'primary.example',
      }),
    );
    expect(upper.status).toBe(307);
    expect(upper.headers.get('location')).toBe('http://primary.example/entrar');
  });
});
