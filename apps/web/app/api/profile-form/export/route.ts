import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/profile-form/export` (12-17, D-595, UI-D-579; PFORM-21, T-12-37, T-12-38) — the BFF relay of
 * the answers CSV. The file carries every member's personal data, so this handler is a pipe and nothing
 * else: it checks the same origin (403) and a verified session (401), forwards ONCE through `apiFetch`
 * (Bearer + `x-tenant-host`) to `GET /v1/profile_form/export`, and hands the API's attachment on.
 *
 * **The body is passed through unread.** `res.body` goes straight into the new `Response`: it is never
 * `.text()`, `.json()` or `.arrayBuffer()`-ed, never parsed, never logged and never cached (`no-store`).
 * The audit row ("fica registrado") is the API's, committed before its first byte (plan 10); the guard
 * chain that refuses everyone but `admin_tenant` is the API's too, so a refusal comes back with the same
 * 4xx and an empty body. A success log line does not exist; a failure logs a status only
 * (`profile_form.export_failed`), never a byte of any body.
 */
export const dynamic = 'force-dynamic';

const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/**
 * The origin gate, STRICT (12 review IN-02). This GET writes an audit row and runs a full member scan, so
 * it cannot use the lenient `sameOriginGet` of the read-only BFF routes, which lets a request with
 * neither `Sec-Fetch-Site` nor `Origin` through (old Safari). Here the browser must say `same-origin`:
 * a missing header is refused. The only caller is `startCsvDownload`, a same-origin `fetch()`, which
 * always sends `same-origin`. `none` (typed URL, bookmark) is refused too: nothing links to this URL
 * and an export is started from the dialog, never by navigation.
 */
const isStrictSameOrigin = (request: Request): boolean =>
  request.headers.get('sec-fetch-site') === 'same-origin';

export async function GET(request: Request): Promise<Response> {
  if (!isStrictSameOrigin(request)) return empty(403);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  try {
    const res = await apiFetch('/v1/profile_form/export');
    if (!res.ok || !res.body) {
      console.error('profile_form.export_failed', { status: res.status });
      return empty(res.status >= 400 && res.status < 500 ? res.status : 502);
    }
    const headers = new Headers({
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'no-store',
    });
    const disposition = res.headers.get('content-disposition');
    if (disposition) headers.set('content-disposition', disposition);
    return new Response(res.body, { status: 200, headers });
  } catch (error) {
    console.error('profile_form.export_failed', {
      status: null,
      code: String((error as Error)?.name),
    });
    return empty(502);
  }
}
