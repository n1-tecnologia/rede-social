import { normalizeHost } from '@rede-social/contracts';
import { headers } from 'next/headers';
import { getHostTenant } from '@/lib/tenant-host';

/** Development only: `localhost` and `*.localhost` (the seed tenants live on `*.localhost:3000`). */
const DEV_LOCAL_HOST = /^(?:localhost|[a-z0-9-]+\.localhost)$/;

/**
 * Origin a GoTrue mail link (recovery, sign-up confirmation) must come back to (D-22). There is
 * deliberately NO fallback of any kind — no `SITE_URL`, no env var: on a tenant domain the link must
 * come back to THAT domain, so the only honest source is the request itself.
 *
 * `x-forwarded-host` is read BEFORE `host` for the same reason `proxy.ts` does: when a Server Action
 * issues a redirect, Next re-requests the destination on the server's own origin and carries the
 * browser-facing host only in `x-forwarded-host`. Vercel and Cloud Run set both headers themselves.
 *
 * But a header is a claim, not a fact (phase-1 review WR-09): on any runtime where the platform does
 * not overwrite `X-Forwarded-Host` (`next start` behind a misconfigured proxy, a self-hosted
 * preview), a forged value would make Supabase e-mail the member a link pointing at the
 * attacker's domain. So the host is honoured ONLY when it is one this deployment serves, as
 * classified by `proxy.ts` (`getHostTenant` reads the `x-tenant-*` headers the proxy overwrites on
 * every request):
 *   - `tenant`   — registered in `tenant_domains` (resolved through the API)
 *   - `platform` — equals `PLATFORM_HOST`
 *   - dev only   — `localhost` / `*.localhost`
 * Anything else (an unregistered host, a `*.vercel.app` preview alias, a forged header) yields
 * `null`: no e-mail is sent, and the browser still gets the constant answer. The hosted
 * `additional_redirect_urls` allow-list is the second, independent guard (docs/DEPLOY.md).
 *
 * `refusedEvent` is the `console.warn` event name of the calling flow (`forgot.origin_refused`,
 * `signup_confirmation.origin_refused`), so a refusal is attributable in the logs.
 */
export async function mailReturnOrigin(refusedEvent: string): Promise<string | null> {
  const h = await headers();
  const rawHost = h.get('x-forwarded-host')?.split(',')[0]?.trim() || h.get('host')?.trim();
  const host = normalizeHost(rawHost);
  if (!rawHost || !host) return null;

  const classified = await getHostTenant();
  // The proxy classified the same header on this very request; a disagreement means a header
  // arrived that the proxy did not see, and nothing about it can be trusted.
  if (classified.host !== host) return null;

  const isProduction = process.env.NODE_ENV === 'production';
  const allowed =
    classified.mode === 'tenant' ||
    classified.mode === 'platform' ||
    (!isProduction && DEV_LOCAL_HOST.test(host));
  if (!allowed) {
    console.warn(refusedEvent, { host, mode: classified.mode });
    return null;
  }

  // Production is HTTPS-only (Vercel terminates TLS); never let a forwarded header downgrade it.
  const proto = isProduction
    ? 'https'
    : h.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
  return `${proto}://${rawHost}`;
}
