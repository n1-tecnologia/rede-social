import { createServerClient } from '@supabase/ssr';
import { isRegistrableHost, normalizeHost } from '@tria/contracts';
import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { sessionCookieOptions } from '@/lib/supabase/cookie-options';
import {
  type HostTenant,
  resolveHostTenant,
  TENANT_HOST_REQUEST_HEADER,
  TENANT_MODE_HEADER,
  TENANT_NAME_HEADER,
  TENANT_SLUG_HEADER,
} from '@/lib/tenant-host';

/**
 * Public paths (D-01/D-22). `/cadastro` exact serves tenant hosts; `/cadastro/{slug}` generic hosts.
 * Phase 2 entries: `/comunidade-indisponivel` (D-32, 02-08); `/aceitar-convite` + `/convite-expirado`
 * (02-10) and the manifest, `/serwist/*`, `/~offline` (02-11) are pre-registered here because those
 * plans share a wave and neither may edit this file — a public path that does not exist yet just 404s.
 */
const PUBLIC = [
  /^\/entrar(?:\/|$)/,
  /^\/cadastro(?:\/|$)/,
  /^\/esqueci-senha(?:\/|$)/,
  /^\/redefinir-senha(?:\/|$)/,
  /^\/auth\//,
  /^\/acesso-suspenso(?:\/|$)/,
  /^\/endereco-invalido(?:\/|$)/,
  /^\/sem-comunidade(?:\/|$)/,
  /^\/comunidade-indisponivel(?:\/|$)/,
  /^\/aceitar-convite(?:\/|$)/,
  /^\/convite-expirado(?:\/|$)/,
  /^\/termos(?:\/|$)/,
  /^\/privacidade(?:\/|$)/,
  /^\/manifest\.webmanifest$/,
  /^\/m\/[a-z0-9_-]+\/manifest\.webmanifest$/, // underscore admits the reserved neutral manifest slug (02-11)
  /^\/serwist\//,
  /^\/~offline(?:\/|$)/,
];

const TENANT_SLUG_COOKIE = 'tenant_slug';
const ONE_YEAR_S = 31536000;

/**
 * Builds the request headers forwarded to pages/actions. The four `x-tenant-*` headers
 * (`x-tenant-mode`, `x-tenant-host`, `x-tenant-slug`, `x-tenant-name`) are ALWAYS overwritten (a client
 * must never be able to claim a mode). Rebuilt after cookie refreshes so the forwarded `cookie` header
 * carries the rotated session.
 */
function buildRequestHeaders(request: NextRequest, hostTenant: HostTenant): Headers {
  const h = new Headers(request.headers);
  h.set(TENANT_MODE_HEADER, hostTenant.mode);
  h.set(TENANT_HOST_REQUEST_HEADER, hostTenant.host);
  h.set(TENANT_SLUG_HEADER, hostTenant.mode === 'tenant' ? hostTenant.slug : '');
  h.set(
    TENANT_NAME_HEADER,
    hostTenant.mode === 'tenant' ? encodeURIComponent(hostTenant.displayName) : '',
  );
  return h;
}

/**
 * D-35: a VERIFIED non-primary host (an alias) folds into the tenant's ONE primary origin with a 308
 * (method + body preserved) — installs, cookies and push subscriptions live on that origin.
 *
 * The target host comes ONLY from the by-host answer (`primaryHost`, a verified `tenant_domains` row),
 * normalised, `isRegistrableHost`-checked and different from the current host (loop guard — the
 * one-primary-per-tenant index makes a real cycle impossible, this is defence in depth; T-02-40/45).
 * Scheme: `x-forwarded-proto` when it is literally `http`/`https`, else the request's; port: the
 * `:NNNN` suffix of the browser-facing host value when present (local dev keeps `:3000`, production
 * hosts carry none). Path + query are re-emitted from `request.nextUrl`, never from a raw header.
 * `Cache-Control: no-store` because a 308 is cacheable by default and the primary may be switched
 * later (T-02-42). Returns null when no redirect applies.
 */
function primaryHostRedirect(
  request: NextRequest,
  hostTenant: HostTenant,
  browserHost: string | null | undefined,
): NextResponse | null {
  if (hostTenant.mode !== 'tenant' || hostTenant.isPrimary) return null;
  const target = normalizeHost(hostTenant.primaryHost);
  if (!target || !isRegistrableHost(target) || target === hostTenant.host) return null;

  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const scheme =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : request.nextUrl.protocol.replace(/:$/, '');
  const port = browserHost?.match(/:(\d{1,5})$/)?.[1];
  const origin = `${scheme}://${target}${port ? `:${port}` : ''}`;

  const response = NextResponse.redirect(
    new URL(request.nextUrl.pathname + request.nextUrl.search, origin),
    308,
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/** Refreshed session cookies must survive when a rewrite/redirect replaces the Supabase response. */
function withCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

export async function proxy(request: NextRequest) {
  // 1. Host -> public shell (D-20/D-21). Runs BEFORE the Supabase client so the
  //    "nothing between createServerClient and getClaims()" rule stays intact.
  //
  //    `x-forwarded-host` FIRST, `host` only as the fallback: when a Server Action calls `redirect()`,
  //    Next re-requests the destination through this proxy on the SERVER's own origin
  //    (`host: localhost:3000`) and carries the browser-facing host in `x-forwarded-host` — verified in
  //    both `next dev` and `next start`. Reading `host` there would classify every post-action page as
  //    a generic host and silently drop the tenant from the public shell. Vercel and Cloud Run set
  //    `x-forwarded-host` themselves (a client-supplied value is overwritten at the edge), and per
  //    D-20/D-23 the host only SELECTS the public shell — the API still re-resolves it and can only
  //    DENY a session — so trusting it here cannot leak another tenant's data.
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const browserHost = forwardedHost || request.headers.get('host');
  const hostTenant = await resolveHostTenant(browserHost);

  // D-35: an alias host answers 308 to the tenant's primary origin (still before the Supabase client).
  const toPrimary = primaryHostRedirect(request, hostTenant, browserHost);
  if (toPrimary) return toPrimary;

  let requestHeaders = buildRequestHeaders(request, hostTenant);

  // Vercel Production only (01-11 sets PLATFORM_HOST there, never on Preview): the deployment alias
  // must not serve the generic shell, so it 307s to the platform host with path + query preserved.
  if (
    hostTenant.mode === 'generic' &&
    hostTenant.host.endsWith('.vercel.app') &&
    env.PLATFORM_HOST
  ) {
    return NextResponse.redirect(
      new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${env.PLATFORM_HOST}`),
      307,
    );
  }

  // 2. Session refresh (RESEARCH §Pattern 5, official @supabase/ssr shape).
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: sessionCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          requestHeaders = buildRequestHeaders(request, hostTenant);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, val] of Object.entries(headers)) response.headers.set(key, val);
        },
      },
    },
  );
  // Signature-verified claims (ES256 via JWKS); refreshes the session when the access token expired.
  const { data } = await supabase.auth.getClaims();
  const authenticated = Boolean(data?.claims);

  const url = request.nextUrl;
  const path = url.pathname;

  // 3. Path rules by host mode.
  if (hostTenant.mode === 'tenant') {
    if (path === '/cadastro') {
      // Every HTTP method: the GET that renders and the POST a server action issues to the same URL.
      const target = url.clone();
      target.pathname = `/cadastro/${hostTenant.slug}`;
      return withCookies(
        NextResponse.rewrite(target, { request: { headers: requestHeaders } }),
        response,
      );
    }
    if (path.startsWith('/cadastro/')) {
      // The host decides the slug; a foreign slug in the path is ignored. 308 keeps method and body.
      const target = url.clone();
      target.pathname = '/cadastro';
      return withCookies(NextResponse.redirect(target, 308), response);
    }
  } else if (hostTenant.mode === 'platform') {
    if (path === '/cadastro' || path.startsWith('/cadastro/')) {
      // Member sign-up is not offered on the platform domain (D-21).
      const target = url.clone();
      target.pathname = '/entrar';
      target.search = '';
      return withCookies(NextResponse.redirect(target, 307), response);
    }
  } else {
    // generic host: remember the slug for /entrar (D-06 as amended by D-22). Server-side only.
    const slug = path.match(/^\/cadastro\/([a-z0-9-]+)/)?.[1];
    if (slug) {
      response.cookies.set(TENANT_SLUG_COOKIE, slug, {
        maxAge: ONE_YEAR_S,
        sameSite: 'lax',
        path: '/',
        httpOnly: true,
      });
    }
  }

  // 4. Private routes require a verified session.
  if (!authenticated && !PUBLIC.some((re) => re.test(path))) {
    const target = url.clone();
    target.pathname = '/entrar';
    target.search = '';
    return withCookies(NextResponse.redirect(target), response);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
