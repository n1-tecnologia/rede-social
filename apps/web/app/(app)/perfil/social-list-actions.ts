'use server';

import { type SocialListItem, socialListQuerySchema } from '@rede-social/module-social/contracts';
import { redirect } from 'next/navigation';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getFollowers, getFollowing } from '@/lib/social';

/**
 * The pagination actions of the two PRIVATE lists, "Seguidores" and "Seguindo" (09-10, D-468,
 * T-09-29), in the `membros/actions.ts` conventions: the SAME Zod the API validates with runs BEFORE
 * the request, a session refusal becomes a navigation OUTSIDE the try/catch (Next 16: `redirect()`
 * throws), and every other failure is the one `generic` code, never the server's words (T-09-37): the
 * client turns it into the `members` catalog's generic card.
 *
 * **They take a cursor and nothing else.** There is no member id to forge: the lists are the
 * SESSION's own rows (`GET /v1/social/me/followers` and `/me/following`), so no action, route or link
 * can ask for someone else's list. An action is a public POST endpoint; the API independently refuses
 * a viewer outside the graph (403) and a tenant with `social` off (404), and re-derives the tenant
 * from the token.
 *
 * The cursor is OPAQUE: forwarded exactly as the previous page returned it and never parsed here; a
 * stale or tampered value is the API's first page, not an error.
 */

export type LoadMoreSocialListResult =
  | { ok: true; items: SocialListItem[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

async function loadMore(
  read: typeof getFollowers,
  cursor: string,
): Promise<LoadMoreSocialListResult> {
  const query = socialListQuerySchema.safeParse({ cursor });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LoadMoreSocialListResult = { ok: false, code: 'generic' };
  try {
    const page = await read(query.data.cursor);
    result = { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('social.list_more_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/** One more page of "Seguidores": the people who follow the caller, newest first. */
export async function loadMoreFollowersAction(cursor: string): Promise<LoadMoreSocialListResult> {
  return loadMore(getFollowers, cursor);
}

/** One more page of "Seguindo": the people the caller follows, newest first. */
export async function loadMoreFollowingAction(cursor: string): Promise<LoadMoreSocialListResult> {
  return loadMore(getFollowing, cursor);
}
