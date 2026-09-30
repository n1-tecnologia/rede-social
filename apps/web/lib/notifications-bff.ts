import { ApiClientError } from '@/lib/bootstrap';
import { createClient } from '@/lib/supabase/server';

/**
 * The gates every `/api/notifications/…` route handler runs before forwarding a mark ONCE to the API
 * (07-01 planning decision 10), cloned from `app/api/stories/views/route.ts`. The marks are BFF route
 * handlers rather than server actions because the read POST must survive the navigation it triggers
 * (`fetch(…, { keepalive: true })`), which a server action cannot promise; seen and read-all are its
 * siblings so the three share one door.
 *
 * In order, each refusal costing ZERO API calls:
 *  1. **Same origin (403).** A route handler gets none of the Origin check Next gives Server Actions,
 *     and the session rides in a cookie, so a cross-site form post would otherwise mark rows as the
 *     member. The Origin must be present, not `null`, and its host must equal the browser-facing
 *     host (`x-forwarded-host` first, `host` second: the proxy.ts precedence).
 *  2. **No body (413).** A mark carries nothing; a declared length above 0 is refused.
 *  3. **A verified session (401)** through `getClaims()` (JWKS). The API re-verifies the Bearer anyway.
 *  4. **Forward ONCE**, answering the API's own status (204, or its 4xx) with an empty `no-store`
 *     body, or 502 for a transport failure. Logs carry the SHAPE only: status and code, never an id.
 */

export const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** The browser-facing host, lower-cased — `x-forwarded-host` first, the proxy.ts precedence. */
function browserHost(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwarded || request.headers.get('host');
  return host ? host.toLowerCase() : null;
}

/** Gate 1: the request's Origin is this very host. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const host = browserHost(request);
  return host !== null && originHost === host;
}

/** A canonical uuid, or the path id is refused before any request is built. */
export const NOTIFICATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gates 1-4 around one forward. `event` names the log line (shape only). */
export async function gatedMark(
  request: Request,
  event: string,
  forward: () => Promise<void>,
): Promise<Response> {
  if (!sameOrigin(request)) return empty(403);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > 0) return empty(413);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  try {
    await forward();
    return empty(204);
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error(event, {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
