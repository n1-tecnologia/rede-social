import { getSupabaseCoordinates } from '@/lib/supabase-coordinates';

/**
 * Content Security Policy (D-346, 08-RESEARCH Pattern 10). Built per request in `proxy.ts`, which
 * puts the policy and `x-nonce` on the FORWARDED request headers (Next reads the nonce from the
 * request's CSP header during SSR and stamps it on every framework `<script>`) and on every response
 * it returns, including the session-refresh rebuild, the `/cadastro` rewrite and the redirects
 * (Pitfall 10).
 *
 * - `script-src` is nonce + `'strict-dynamic'`: a script runs only when the server minted it for this
 *   response, or when one of those scripts loaded it. `'unsafe-eval'` exists only under `next dev`.
 * - `style-src` carries NO nonce (Pitfall 8): a nonce or hash makes browsers ignore `'unsafe-inline'`,
 *   and the app renders SSR `style=` attributes for the tenant brand, the shell and progress bars.
 *   Script injection is the threat this policy addresses.
 * - The Supabase origin (signed PUTs, TUS, public branding and avatar images, Realtime over its
 *   `ws:`/`wss:` twin) is the HOST'S project (09.2-17, D-538): `proxy.ts` passes the exact origin of
 *   the tenant's own project (or the central one for the platform, a generic host and a tenant of the
 *   central project), so local (`http://127.0.0.1:54321`) and production need no separate list and a
 *   tenant never gets another project's origin. No wildcard host is ever written for Supabase. Mux playback, Mux Data and UpChunk's upload host come from
 *   Mux's own CSP guidance.
 * - `frame-src` admits exactly the two inline players (`LinkPreviewCard`, click-to-play) and the
 *   event page's keyless Google Maps embed (`EventLocationMap`, the 2026-10-06 reversal of D-203):
 *   its `maps.google.com/maps?…&output=embed` answers a 301 to `www.google.com/maps/embed`, and a
 *   frame's redirect hop is checked against `frame-src` too, so both are named, each on its path.
 * - The tenant's title font (`look.titleFont`, `lib/title-font.ts`) is one Google Fonts stylesheet
 *   (`style-src`) whose files come from Google's font host (`font-src`); nothing else of Google's.
 *   Both hosts are in `connect-src` too: this same header is the service worker's own policy, and
 *   a worker that answers a request with `fetch()` (the `next dev` catch-all rule in `app/sw.ts`)
 *   is held to `connect-src`, not to `style-src`/`font-src`.
 * - `upgrade-insecure-requests` only when the request arrived over https (Pitfall 9): the local e2e,
 *   including the production-build PWA suite, serves plain http on `*.localhost`.
 *
 * `CSP_MODE` (server-only, default `report-only`) picks the header name: production ships
 * report-only first and flips to `enforce` after the real-device pass (DEPLOY.md "Content Security
 * Policy (Phase 8)"). The e2e harness always runs `enforce`.
 */

export type CspMode = 'report-only' | 'enforce';

export const CSP_REPORT_PATH = '/api/csp-report';

/** The forwarded request header that carries the nonce to server components. */
export const NONCE_HEADER = 'x-nonce';

export interface CspOptions {
  /** True when the request reached us over https (`x-forwarded-proto`, else the URL's scheme). */
  https: boolean;
  mode: CspMode;
  /** Where browsers POST violation reports; defaults to the app's own sink. */
  reportUri?: string;
  /**
   * The exact origin of the Supabase project this host talks to (`SupabaseCoordinates.origin`).
   * Omitted: the central project's, from the environment. `null`: none at all (a tenant whose
   * project address was refused names no Supabase origin).
   */
  supabaseOrigin?: string | null;
}

/** Base64 of 16 random bytes: a fresh, unguessable nonce for every request. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** `Content-Security-Policy` when enforcing, `Content-Security-Policy-Report-Only` otherwise. */
export function cspHeaderName(mode: CspMode): string {
  return mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
}

/** The keyless Maps embed and the host it redirects to (`EventLocationMap`). */
const GOOGLE_MAPS_EMBED = 'https://maps.google.com/maps https://www.google.com/maps/embed';
/** The title font's stylesheet host and its font-file host (`lib/title-font-rules.ts`). */
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';

/** The Supabase origin and its Realtime twin (`wss:` for https, `ws:` for the local http stack). */
function supabaseOrigins(supabaseOrigin: string | null | undefined): string[] {
  if (supabaseOrigin === null) return [];
  const url = new URL(supabaseOrigin ?? (getSupabaseCoordinates(null)?.origin as string));
  const wsScheme = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return [url.origin, `${wsScheme}//${url.host}`];
}

export function cspFor(
  nonce: string,
  { https, reportUri = CSP_REPORT_PATH, supabaseOrigin }: CspOptions,
): string {
  const [supabaseHttp, supabaseWs] = supabaseOrigins(supabaseOrigin);
  const sources = (...list: (string | undefined)[]) => list.filter(Boolean).join(' ');
  const dev = process.env.NODE_ENV === 'development';
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`,
    `img-src ${sources("'self'", 'data:', 'blob:', supabaseHttp, 'https://*.mux.com', 'https://*.litix.io')}`,
    `media-src ${sources("'self'", 'blob:', supabaseHttp, 'https://*.mux.com')}`,
    `connect-src ${sources("'self'", supabaseHttp, supabaseWs, 'https://*.mux.com', 'https://*.litix.io', 'https://storage.googleapis.com', GOOGLE_FONTS_CSS, GOOGLE_FONTS_FILES)}`,
    "worker-src 'self' blob:",
    `frame-src https://www.youtube-nocookie.com https://player.vimeo.com ${GOOGLE_MAPS_EMBED}`,
    `font-src 'self' ${GOOGLE_FONTS_FILES}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${reportUri}`,
  ];
  if (https) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
