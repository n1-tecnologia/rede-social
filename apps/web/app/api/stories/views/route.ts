import { ApiClientError } from '@/lib/bootstrap';
import { parseSeenBatch } from '@/lib/seen-batch';
import { markStoriesSeen } from '@/lib/stories';
import { createClient } from '@/lib/supabase/server';

/**
 * `POST /api/stories/views` — the page-hide twin of `markStoriesSeenAction` (HIGHLIGHT-06; quick
 * 260926-d8f, review WR-07; threat T-05.2-57).
 *
 * WHY it exists: when the page hides, `StoriesSurface` has one last batch of shown story ids to
 * send, and a server action is a plain `fetch` the browser may abort on unload. `sendSeenBeacon`
 * (`lib/seen-batch.ts`) posts that batch here with `navigator.sendBeacon` (or `fetch` with
 * `keepalive`), which the browser delivers after the page is gone. This handler turns the session
 * cookie into the Bearer the API verifies, exactly like the action does. The beacon ignores the
 * answer, so every answer is an empty body with `cache-control: no-store`.
 *
 * The gates, in order — each refusal costs ZERO API calls:
 *  1. **Same origin (403).** A route handler gets NONE of the Origin check Next gives Server Actions
 *     (data-security.md, "Allowed origins"), and the session rides in a cookie, so a cross-site
 *     form post would otherwise write seen rows as the member. The Origin must be present, not the
 *     literal `null`, and its host (port included) must equal the browser-facing host —
 *     `x-forwarded-host` first, `host` second, the precedence proxy.ts uses.
 *  2. **A declared body over 4 KiB (413)** — a full 50-uuid batch is about 2 KiB.
 *  3. **A verified session (401)** — `getClaims()` checks the signature via JWKS. proxy.ts already
 *     redirects an unauthenticated request; this is the handler's own layer, and the API re-verifies
 *     the Bearer anyway.
 *  4. **The body (413 / 400)** — read as text (the beacon sends `text/plain`), capped at 4 KiB, parsed
 *     as a JSON object, and its `storyIds` run through `parseSeenBatch`: the SAME dedupe-then-cap
 *     rule `markStoriesSeenAction` applies (review WR-04), so the two doors cannot drift apart.
 *  5. **Forward ONCE (204)** through `markStoriesSeen` → `apiFetch` (Bearer + `x-tenant-host`). Only
 *     `storyIds` is ever forwarded; the raw body never is. A failure is logged by SHAPE only (status
 *     and code, never an id — V8) and answers the API's 4xx, or 502 for anything else.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** The browser-facing host, lower-cased — `x-forwarded-host` first, the proxy.ts precedence. */
function browserHost(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwarded || request.headers.get('host');
  return host ? host.toLowerCase() : null;
}

function sameOrigin(request: Request): boolean {
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

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return empty(403);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return empty(413);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return empty(413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return empty(400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return empty(400);
  const ids = parseSeenBatch((body as { storyIds?: unknown }).storyIds);
  if (ids === null) return empty(400);

  try {
    await markStoriesSeen(ids);
    return empty(204);
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error('stories.seen_beacon_failed', {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
