import { ApiClientError } from '@/lib/bootstrap';
import { fetchStaffRoster } from '@/lib/chat';
import { empty, sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/chat/staff` (12.4-20, D-806, CASE-16): the live team as `{ items: [{ userId, name }] }`,
 * names only, for the inbox's "Responsável" filter and the assign sheet. STAFF only: the API answers a
 * member 403 and this handler passes it through.
 *
 * Gates, each refusal costing ZERO API calls: `sameOriginGet` (403) and a verified session (401). Then
 * ONE forward through `apiFetch` (the caller's own Bearer). The two named fields are copied one by one,
 * so nothing else the payload might carry leaves this handler. `no-store` always; logs carry the shape
 * only (status and code, never a name).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!sameOriginGet(request)) return empty(403);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  try {
    const roster = await fetchStaffRoster();
    return Response.json(
      { items: roster.items.map(({ userId, name }) => ({ userId, name })) },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error('chat.staff_roster_bff_failed', {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
