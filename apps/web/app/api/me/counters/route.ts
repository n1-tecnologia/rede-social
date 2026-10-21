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
 *
 * 09.1-15 (PAY-14, PAY-15, D-497, D-499, T-09.1-73): the SECOND refusal that carries a body. A 403
 * `SUBSCRIPTION_PENDING` — the member's payment access was cut while the app was open, and the cut nudged
 * this refetch (09.1-12) — answers `{ error: { code }, location }` with `location` the pending screen
 * (`/assinatura-pendente?t=<tenant>`, again the `bootstrapRedirectPath` mapping, never a path taken from
 * the API's body). `LiveShell` navigates there; unlike the blocked flow nothing signs the device out.
 */
export const dynamic = 'force-dynamic';

const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** The refusals whose envelope carries a body: the code the shell reads and the flow it lands on. */
const REFUSAL_FLOWS = ['MEMBERSHIP_BLOCKED', 'SUBSCRIPTION_PENDING'] as const;
type RefusalFlow = (typeof REFUSAL_FLOWS)[number];

/**
 * The flow a 403 envelope sends the open app to (the blocked flow, or the pending screen), as
 * `{ code, location }`, or `null` for any other answer. The location is the `bootstrapRedirectPath`
 * mapping of the code and the tenant name: it is never taken from the API's body.
 */
async function refusalFlow(res: Response): Promise<{ code: RefusalFlow; location: string } | null> {
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    const code = REFUSAL_FLOWS.find((flow) => flow === body?.error?.code);
    if (!code) return null;
    const location = bootstrapRedirectPath(new ApiClientError(403, code, body.error?.details));
    return location ? { code, location } : null;
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
        const flow = await refusalFlow(res);
        if (flow) {
          return Response.json(
            { error: { code: flow.code }, location: flow.location },
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
