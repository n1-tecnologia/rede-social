import { countersSchema } from '@rede-social/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/me/counters` (07-03, NOTIF-02, D-240) — the BFF twin of `GET /v1/me/counters`, fetched
 * by `LiveCountersProvider` on every Realtime signal, re-join and refocus. A GET route handler rather
 * than a server action on purpose: Next runs a page's server actions one at a time, and this refetch
 * must never queue behind another action (RESEARCH anti-pattern).
 *
 * The gates mirror `/api/realtime/token`: `sameOriginGet` (403; `Sec-Fetch-Site: same-origin`, or no
 * cross-origin `Origin` where the browser sends no fetch metadata, C-WR-02) and a verified session
 * (401), both with an empty `no-store` body and zero API calls. Then ONE forward through `apiFetch`
 * (Bearer + `x-tenant-host`); the API's answer is re-validated against the shared contract and passed
 * on with `no-store`. An API refusal keeps its 4xx; anything else is 502. Logs carry the shape only.
 *
 * 08-04 (MODER-02, T-08-24): ONE refusal carries a body. A 403 `MEMBERSHIP_BLOCKED` — the member was
 * blocked while the app was open, and an admin's block nudged this refetch — answers
 * `{ error: { code }, location }`, where `location` is the shipped blocked flow
 * (`/auth/blocked?t=<tenant>`, the `bootstrapRedirectPath` mapping). `LiveShell` navigates there, so
 * the open app lands on "Acesso suspenso" without a reload. The body never carries anything else.
 */
export const dynamic = 'force-dynamic';

const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** The blocked flow's path for a 403 `MEMBERSHIP_BLOCKED` envelope, or `null` for any other answer. */
async function blockedLocation(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (body?.error?.code !== 'MEMBERSHIP_BLOCKED') return null;
    return bootstrapRedirectPath(new ApiClientError(403, 'MEMBERSHIP_BLOCKED', body.error.details));
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!sameOriginGet(request)) return empty(403);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  try {
    const res = await apiFetch('/v1/me/counters');
    if (!res.ok) {
      if (res.status === 403) {
        const blocked = await blockedLocation(res);
        if (blocked) {
          return Response.json(
            { error: { code: 'MEMBERSHIP_BLOCKED' }, location: blocked },
            { status: 403, headers: { 'cache-control': 'no-store' } },
          );
        }
      }
      console.error('me.counters_failed', { status: res.status });
      return empty(res.status >= 400 && res.status < 500 ? res.status : 502);
    }
    const counters = countersSchema.parse(await res.json());
    return Response.json(counters, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('me.counters_failed', { status: null, code: String((error as Error)?.name) });
    return empty(502);
  }
}
