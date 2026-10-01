import { sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/realtime/token` (07-03, RESEARCH Pattern 5; threats T-07-12, T-07-13, T-07-18) — the ONE
 * place a raw Supabase access token reaches page JavaScript, for the subscribe-only Realtime client
 * (`RealtimeProvider` in `@rede-social/core/ui`). The `sb-*` cookies stay HttpOnly; the page asks
 * here, keeps the answer in memory only and asks again near expiry.
 *
 * The gates, in order — each refusal answers an empty `no-store` body:
 *  1. **Same origin (403).** `Sec-Fetch-Site` must be `same-origin`. A same-origin GET often carries
 *     no `Origin` header, so the Origin check of the POST routes does not transfer; the fetch metadata
 *     header is set by the browser and cannot be forged by page script, and a cross-site `<script>`,
 *     `<img>` or `fetch` reads `cross-site` / `same-site` / `none` here and is refused. A browser that
 *     sends NO fetch metadata (Safari/iOS before 16.4, 07 review C-WR-02) is refused only when its
 *     `Origin` is `null` or another host (`sameOriginGet`): a cross-origin `fetch` always sends one, and
 *     a header-less `<script>`/`<img>` carries no `SameSite=Lax` session cookie (gate 2) and could not
 *     read this JSON body anyway.
 *  2. **A verified session (401).** `getClaims()` checks the signature through JWKS and refreshes an
 *     expired access token, writing the refreshed cookies; only then is `getSession()` read.
 *  3. **The token (200)** `{ accessToken, expiresAt }` (`expiresAt` in SECONDS, the session's own
 *     `expires_at`), `cache-control: no-store`. The token is never logged.
 */
export const dynamic = 'force-dynamic';

const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  if (!sameOriginGet(request)) return empty(403);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return empty(401);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || typeof session.expires_at !== 'number') return empty(401);

  return Response.json(
    { accessToken: session.access_token, expiresAt: session.expires_at },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
