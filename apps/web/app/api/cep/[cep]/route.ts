import { sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';
import { readViaCep, VIACEP_TIMEOUT_MS, viaCepUrl } from '@/lib/viacep';

/**
 * `GET /api/cep/{cep}` (PDF item #10): the event form's CEP lookup, a BFF in front of ViaCEP so the
 * admin's browser only ever talks to this origin. No third party sees the admin's IP or user agent,
 * a future Content-Security-Policy needs no `connect-src` for ViaCEP, and the answer is bounded,
 * validated and cached in one place. A web-tier route handler (the `/api/me/counters` pattern),
 * not the API: nothing here touches the tenant's data.
 *
 * The gates, in order, each refusal an empty `no-store` body that costs ZERO upstream calls:
 *  1. **Same origin (403)** through `sameOriginGet`, C-WR-02's fallback included.
 *  2. **Exactly 8 digits (400).** The path is the CEP and nothing else reaches the upstream URL,
 *     whose host is fixed (no SSRF surface).
 *  3. **A verified session (401)** through `getClaims()`. ViaCEP's terms let them block a caller
 *     that overuses the service, and behind a BFF that caller is this deployment, so only a
 *     signed-in person may spend it (proxy.ts already redirects anyone else; this is the handler's
 *     own layer).
 *
 * Then ONE upstream call bounded by `VIACEP_TIMEOUT_MS`, read by `readViaCep` (zod):
 *  - ViaCEP's unknown CEP (`{ "erro": "true" }`) is 404;
 *  - an address is 200 `{ cep, street, district, city, state }` with `private, max-age=86400`: a
 *    CEP's street changes on the scale of years, and `private` keeps the answer out of shared
 *    caches. ViaCEP's `complemento` and `unidade` never leave this file (`lib/viacep.ts`);
 *  - anything else (a non-2xx, the timeout, a body of another shape) is 502, and the form tells
 *    the admin to type the address. The lookup never blocks the save.
 * Logs carry the SHAPE only (status, error name), never the CEP.
 */
export const dynamic = 'force-dynamic';

const CEP_RE = /^\d{8}$/;

const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cep: string }> },
): Promise<Response> {
  if (!sameOriginGet(request)) return empty(403);

  const { cep } = await params;
  if (!CEP_RE.test(cep)) return empty(400);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  try {
    const res = await fetch(viaCepUrl(cep), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(VIACEP_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('cep.lookup_failed', { status: res.status, code: 'UPSTREAM' });
      return empty(502);
    }
    const answer = readViaCep(await res.json());
    if (answer === null) {
      console.error('cep.lookup_failed', { status: res.status, code: 'SHAPE' });
      return empty(502);
    }
    if (answer.kind === 'not_found') return empty(404);
    return Response.json(answer.address, {
      status: 200,
      headers: { 'cache-control': 'private, max-age=86400' },
    });
  } catch (error) {
    console.error('cep.lookup_failed', { status: null, code: String((error as Error)?.name) });
    return empty(502);
  }
}
