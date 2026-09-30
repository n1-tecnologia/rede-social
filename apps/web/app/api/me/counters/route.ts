import { countersSchema } from '@rede-social/contracts';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/me/counters` (07-03, NOTIF-02, D-240) — the BFF twin of `GET /v1/me/counters`, fetched
 * by `LiveCountersProvider` on every Realtime signal, re-join and refocus. A GET route handler rather
 * than a server action on purpose: Next runs a page's server actions one at a time, and this refetch
 * must never queue behind another action (RESEARCH anti-pattern).
 *
 * The gates mirror `/api/realtime/token`: `Sec-Fetch-Site: same-origin` (403) and a verified session
 * (401), both with an empty `no-store` body and zero API calls. Then ONE forward through `apiFetch`
 * (Bearer + `x-tenant-host`); the API's answer is re-validated against the shared contract and passed
 * on with `no-store`. An API refusal keeps its 4xx; anything else is 502. Logs carry the shape only.
 */
export const dynamic = 'force-dynamic';

const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return empty(403);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  try {
    const res = await apiFetch('/v1/me/counters');
    if (!res.ok) {
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
