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

/**
 * `refresh.on` (08-08) makes `getClaims()` behave like an expired access token being refreshed: it
 * calls `setAll` (which rebuilds the request headers and the response) and reports a session.
 */
const refresh = vi.hoisted(() => ({ on: false }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          cookies: { name: string; value: string; options: object }[],
          headers: Record<string, string>,
        ) => void;
      };
    },
  ) => ({
    auth: {
      getClaims: async () => {
        if (!refresh.on) return { data: { claims: null } };
        options.cookies.setAll([{ name: 'sb-test-auth-token', value: 'rotated', options: {} }], {
          'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
        });
        return { data: { claims: { sub: 'user-1' } } };
      },
    },
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

describe('proxy.ts — the Content Security Policy rides every branch (08-08, Pitfall 10)', () => {
  const CSP = 'content-security-policy-report-only'; // the env mock leaves CSP_MODE unset
  const nonceOf = (policy: string | null) => policy?.match(/'nonce-([^']+)'/)?.[1];

  beforeEach(() => {
    resolve.mockReset();
    refresh.on = false;
  });

  it('12. a served page carries the policy on the response and the same nonce on the forwarded request', async () => {
    resolve.mockResolvedValue(tenant('primary.example', true, 'primary.example'));
    const res = await proxy(request('http://primary.example/entrar', { host: 'primary.example' }));
    const policy = res.headers.get(CSP);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain('report-uri /api/csp-report');
    expect(policy).not.toContain('upgrade-insecure-requests');
    const nonce = nonceOf(policy);
    expect(nonce).toBeTruthy();
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(res.headers.get(`x-middleware-request-${CSP}`)).toBe(policy);
  });

  it('13. a client cannot pick the nonce: the forwarded headers are overwritten, and each request mints its own', async () => {
    resolve.mockResolvedValue(tenant('primary.example', true, 'primary.example'));
    const forged = await proxy(
      request('http://primary.example/entrar', {
        host: 'primary.example',
        'x-nonce': 'forged',
        'content-security-policy': "script-src 'nonce-forged'",
      }),
    );
    expect(forged.headers.get('x-middleware-request-x-nonce')).not.toBe('forged');
    expect(forged.headers.get('x-middleware-request-content-security-policy')).toBeNull();
    const again = await proxy(
      request('http://primary.example/entrar', { host: 'primary.example' }),
    );
    expect(nonceOf(again.headers.get(CSP))).not.toBe(nonceOf(forged.headers.get(CSP)));
  });

  it('14. the 308 alias redirect, the 307 sign-in redirect and the /cadastro rewrite and redirect carry it', async () => {
    resolve.mockResolvedValue(tenant('alias.example', false, 'primary.example'));
    const alias = await proxy(request('http://alias.example/entrar', { host: 'alias.example' }));
    expect(alias.status).toBe(308);
    expect(alias.headers.get(CSP)).toContain("frame-ancestors 'none'");

    resolve.mockResolvedValue(tenant('primary.example', true, 'primary.example'));
    const signIn = await proxy(
      request('http://primary.example/inicio', { host: 'primary.example' }),
    );
    expect(signIn.status).toBe(307);
    expect(signIn.headers.get(CSP)).toContain("frame-ancestors 'none'");

    const rewrite = await proxy(
      request('http://primary.example/cadastro', { host: 'primary.example' }),
    );
    expect(rewrite.headers.get('x-middleware-rewrite')).toContain('/cadastro/acme');
    expect(rewrite.headers.get(CSP)).toContain("frame-ancestors 'none'");
    expect(rewrite.headers.get('x-middleware-request-x-nonce')).toBe(
      nonceOf(rewrite.headers.get(CSP)),
    );

    const foreign = await proxy(
      request('http://primary.example/cadastro/other', { host: 'primary.example' }),
    );
    expect(foreign.status).toBe(308);
    expect(foreign.headers.get(CSP)).toContain("frame-ancestors 'none'");
  });

  it('15. the platform host sign-up redirect and the Vercel deployment-alias 307 carry it', async () => {
    resolve.mockResolvedValue({ mode: 'platform', host: 'rede-social.test' });
    const platform = await proxy(
      request('http://rede-social.test/cadastro', { host: 'rede-social.test' }),
    );
    expect(platform.status).toBe(307);
    expect(platform.headers.get(CSP)).toContain("frame-ancestors 'none'");

    resolve.mockResolvedValue({ mode: 'generic', host: 'x.vercel.app' });
    const deployment = await proxy(
      request('https://x.vercel.app/entrar', {
        host: 'x.vercel.app',
        'x-forwarded-proto': 'https',
      }),
    );
    expect(deployment.status).toBe(307);
    expect(deployment.headers.get(CSP)).toContain('upgrade-insecure-requests');
  });

  it('16. the session-refresh branch rebuilds the response and the forwarded headers with the policy intact', async () => {
    refresh.on = true;
    resolve.mockResolvedValue(tenant('primary.example', true, 'primary.example'));
    const res = await proxy(request('http://primary.example/inicio', { host: 'primary.example' }));
    expect(res.status).toBe(200);
    expect(res.cookies.get('sb-test-auth-token')?.value).toBe('rotated');
    const policy = res.headers.get(CSP);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(policy));
    expect(res.headers.get(`x-middleware-request-${CSP}`)).toBe(policy);
  });

  it('17. the service worker script and the CSP report sink pass through with the policy, no session needed', async () => {
    resolve.mockResolvedValue(tenant('primary.example', true, 'primary.example'));
    for (const [path, method] of [
      ['/serwist/sw.js', 'GET'],
      ['/api/csp-report', 'POST'],
    ] as const) {
      const res = await proxy(
        request(`http://primary.example${path}`, { host: 'primary.example' }, method),
      );
      expect(res.status, path).toBe(200);
      expect(res.headers.get('location'), path).toBeNull();
      expect(res.headers.get(CSP), path).toContain("worker-src 'self' blob:");
    }
  });
});
