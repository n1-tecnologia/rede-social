import {
  pushSubscriptionDeleteSchema,
  pushSubscriptionInputSchema,
} from '@rede-social/module-notifications/contracts';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';

/**
 * `POST` / `DELETE /api/push/subscriptions` (07-07, NOTIF-03): the BFF door the page (`lib/push.ts`)
 * and the service worker (`pushsubscriptionchange`) use to save or forget THIS device's Web Push
 * subscription. It turns the session cookie into the Bearer the API verifies and forwards to
 * `POST` / `DELETE /v1/notifications/push-subscriptions` (07-06), which re-validates the endpoint's
 * host allow-list and owns every rule about who may hold which endpoint.
 *
 * The gates clone `/api/stories/views` (T-07-44). Each refusal costs ZERO API calls:
 *  1. **Same origin (403).** A route handler gets none of the Origin check Next gives Server Actions,
 *     and the session rides in a cookie, so a cross-site form post could otherwise register an
 *     attacker's endpoint to the member. The Origin must be present, not `null`, and its host (port
 *     included) must equal the browser-facing host (`x-forwarded-host` first, then `host`).
 *  2. **A declared body over 4 KiB (413).** A subscription is well under 1 KiB.
 *  3. **A verified session (401)** through `getClaims()` (JWKS).
 *  4. **The body (413 / 400).** It is read as text, capped at 4 KiB, parsed as a JSON object, and
 *     validated with the SAME strict contract schema the API applies.
 *  5. **Forward ONCE** with only the parsed value (never the raw body), answering the API's status
 *     with an empty `no-store` body. A failure is logged by SHAPE only (status and code, never the
 *     endpoint, which is a capability URL).
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;
const API_PATH = '/v1/notifications/push-subscriptions';

const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

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

type Gate = { ok: true; body: unknown } | { ok: false; response: Response };

async function gate(request: Request): Promise<Gate> {
  if (!sameOrigin(request)) return { ok: false, response: empty(403) };

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: empty(413) };
  }

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return { ok: false, response: empty(401) };

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { ok: false, response: empty(413) };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, response: empty(400) };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, response: empty(400) };
  }
  return { ok: true, body };
}

async function forward(method: 'POST' | 'DELETE', value: unknown): Promise<Response> {
  try {
    const res = await apiFetch(API_PATH, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (res.ok) return empty(204);
    console.error('push.subscription_forward_failed', { method, status: res.status });
    return empty(res.status >= 400 && res.status < 500 ? res.status : 502);
  } catch (error) {
    console.error('push.subscription_forward_failed', {
      method,
      status: null,
      code: String((error as Error)?.name ?? 'Error'),
    });
    return empty(502);
  }
}

export async function POST(request: Request): Promise<Response> {
  const checked = await gate(request);
  if (!checked.ok) return checked.response;
  const parsed = pushSubscriptionInputSchema.safeParse(checked.body);
  if (!parsed.success) return empty(400);
  return forward('POST', parsed.data);
}

export async function DELETE(request: Request): Promise<Response> {
  const checked = await gate(request);
  if (!checked.ok) return checked.response;
  const parsed = pushSubscriptionDeleteSchema.safeParse(checked.body);
  if (!parsed.success) return empty(400);
  return forward('DELETE', parsed.data);
}
