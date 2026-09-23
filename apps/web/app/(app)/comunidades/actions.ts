'use server';

import { type CommunitySummary, communityQuerySchema } from '@tria/module-communities/contracts';
import { redirect } from 'next/navigation';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getCommunities } from '@/lib/communities';

/**
 * The community list's pagination action (COMM-03, D-76), in the `membros/actions.ts` conventions:
 * the SAME Zod the API validates with runs BEFORE the request (a server action is a public
 * endpoint), a 401/403 becomes a navigation OUTSIDE the try/catch (Next 16: `redirect()` throws),
 * and every refusal is answered with a catalog KEY rather than pt-BR copy — the client component
 * translates.
 *
 * The request itself goes through `getCommunities` in `lib/communities.ts`, which is the ONE place
 * that builds the query string and runs `apiFetch('/v1/communities?…')`. Duplicating the call here
 * would let the sentinel and the first page drift apart on page size.
 *
 * **This module must not re-export anything.** Turbopack drops re-exports from a `'use server'`
 * module and the build fails with "The module has no exports at all" — so an action that lives
 * elsewhere is IMPORTED from its defining file by the component, never forwarded through here.
 */

export type LoadMoreCommunitiesResult =
  | { ok: true; items: CommunitySummary[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/**
 * One more page of the community list.
 *
 * The cursor is OPAQUE: it is forwarded exactly as the previous page returned it and is never
 * parsed, decoded or rebuilt here (T-05-05) — its encoding belongs to
 * `packages/core/server/paging.ts`, and the API degrades a stale or tampered value to the first page
 * on its own rather than raising.
 */
export async function loadMoreCommunitiesAction(
  cursor: string,
): Promise<LoadMoreCommunitiesResult> {
  const query = communityQuerySchema.safeParse({ cursor });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LoadMoreCommunitiesResult = { ok: false, code: 'generic' };
  try {
    const page = await getCommunities({ cursor: query.data.cursor, limit: query.data.limit });
    result = { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('communities.load_more_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * Page 1 again — what `PullToRefresh` calls. It is the SAME `getCommunities` the RSC page called, so
 * a refresh and a first paint can never return differently shaped pages.
 */
export async function refreshCommunitiesAction(): Promise<LoadMoreCommunitiesResult> {
  let refusal: string | null = null;
  let result: LoadMoreCommunitiesResult = { ok: false, code: 'generic' };
  try {
    const page = await getCommunities();
    result = { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('communities.refresh_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}
