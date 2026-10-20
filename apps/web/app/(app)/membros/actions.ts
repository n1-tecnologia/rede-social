'use server';

import { type MemberProfile, memberListQuerySchema } from '@rede-social/contracts/profiles';
import { redirect } from 'next/navigation';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { canBrowseMemberDirectory } from '@/lib/member-directory';
import { getMembers } from '@/lib/profile';

/**
 * The directory's pagination action (PROF-03, R-11), in the `plataforma/actions.ts` conventions:
 * the SAME Zod the API validates with runs BEFORE the request, a 401/403 becomes a navigation
 * OUTSIDE the try/catch (Next 16: `redirect()` throws), and every refusal is answered with a catalog
 * KEY rather than pt-BR copy (02-12) — the client component translates.
 *
 * **Staff only since 2026-10-12**, like the page (`canBrowseMemberDirectory`): an action is a public
 * endpoint, so closing the page alone would leave the list one POST away. A viewer whose OWN role
 * (the bootstrap's) cannot browse the directory gets the `generic` refusal before any member is
 * read. The API refuses a member as well (`GET /v1/members` answers 403 `FORBIDDEN`), so this check
 * is the friendly early answer, not the only gate.
 *
 * The request itself goes through `getMembers` in `lib/profile.ts`, which is the ONE place that
 * builds the query string and runs `apiFetch('/v1/members?…')`. The plan asked for a single
 * implementation shared with the page, and duplicating the call here would let the button and the
 * first page drift apart on page size or on how `q` is encoded.
 *
 * `apiFetch` itself is what keeps this honest about tenancy: the caller's session and the browser's
 * host travel with the request and the API re-derives the tenant from them, so nothing a client
 * hands this action can widen what it may read.
 */

export type LoadMoreMembersResult =
  | { ok: true; items: MemberProfile[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/**
 * One more page of the directory.
 *
 * The cursor is OPAQUE: it is forwarded exactly as the previous page returned it and is never
 * parsed, decoded or rebuilt here (T-03-34) — its encoding belongs to
 * `packages/core/server/profiles/search.ts` and the API degrades a stale or tampered value to the
 * first page on its own. `q` travels with it so a "Carregar mais" inside a search keeps searching.
 */
export async function loadMoreMembersAction(
  cursor: string,
  q?: string,
): Promise<LoadMoreMembersResult> {
  const query = memberListQuerySchema.safeParse({
    cursor,
    ...(q ? { q } : {}),
  });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LoadMoreMembersResult = { ok: false, code: 'generic' };
  try {
    // A member's call ends here, `generic`, before the list is read. A bootstrap refusal (401,
    // blocked…) is mapped below like a list refusal.
    const { membership, permissions } = await getBootstrap();
    if (canBrowseMemberDirectory({ role: membership.role, permissions })) {
      const page = await getMembers({
        cursor: query.data.cursor,
        q: query.data.q,
        limit: query.data.limit,
      });
      result = { ok: true, items: page.items, nextCursor: page.nextCursor };
    }
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('members.load_more_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}
