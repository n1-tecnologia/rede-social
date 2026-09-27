'use server';

import {
  COMMUNITY_ISSUE_SET,
  type CommunityIssue,
  type CommunityStatus,
  type CommunitySummary,
  communityQuerySchema,
  createCommunitySchema,
  updateCommunitySchema,
} from '@tria/module-communities/contracts';
import { feedQuerySchema } from '@tria/module-feed/contracts';
import type { PostCardView } from '@tria/module-feed/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { createCommunity, getCommunities, loadCommunity, updateCommunity } from '@/lib/communities';
import { getFeed } from '@/lib/feed';
import { postCardView } from '@/lib/feed-view';
import { primaryHostOrigin } from '@/lib/tenant-host';

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
 *
 * The list's `status` is carried too (05.1, Pitfall 9): a scroll on `Arquivadas` must page the
 * archived keyset, never append active rows to it. It is validated by the same schema, and the API
 * enforces D-89 whatever a crafted argument says.
 */
export async function loadMoreCommunitiesAction(
  cursor: string,
  status: CommunityStatus = 'active',
): Promise<LoadMoreCommunitiesResult> {
  const query = communityQuerySchema.safeParse({ cursor, status });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LoadMoreCommunitiesResult = { ok: false, code: 'generic' };
  try {
    const page = await getCommunities({
      cursor: query.data.cursor,
      limit: query.data.limit,
      status: query.data.status,
    });
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
 *
 * It carries the list's `status` (05.1, Pitfall 9): a pull on `Arquivadas` must never swap the
 * active list in. The status is validated before any request; the API enforces D-89 regardless.
 */
export async function refreshCommunitiesAction(
  status: CommunityStatus = 'active',
): Promise<LoadMoreCommunitiesResult> {
  const query = communityQuerySchema.safeParse({ status });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LoadMoreCommunitiesResult = { ok: false, code: 'generic' };
  try {
    const page = await getCommunities({ status: query.data.status });
    result = { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('communities.refresh_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/* ── The community PAGE's post list (COMM-03, 05-04) ──────────────────────────────────────────── */

/**
 * One page of a community's posts, already mapped to the view `PostCard` renders — the SAME shape
 * `/inicio`'s own sentinel returns, because it is the same `postCardView` over the same endpoint
 * (`GET /v1/feed?communityId=`, 05-03). A community page that built its own view would drift from
 * the feed on the time zone, the media node or the profile route the first time either changed.
 */
export type CommunityPostsPageResult =
  | { ok: true; items: PostCardView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/**
 * The shared body of both community-post actions. `communityId` is the BOUND first argument (the
 * page calls `.bind(null, id)`), so the client never chooses which community it is paging — the
 * API re-checks visibility on every request regardless, and answers one bare 404 for a miss.
 */
async function communityPostsPage(
  communityId: string,
  cursor?: string,
): Promise<CommunityPostsPageResult> {
  const query = feedQuerySchema.safeParse(cursor ? { communityId, cursor } : { communityId });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: CommunityPostsPageResult = { ok: false, code: 'generic' };
  try {
    // The share origin is resolved HERE too, not inherited from page 1: a server action runs in its
    // own request, and a card appended by the sentinel must carry the same `https://{primaryHost}`
    // link the server-rendered cards do (FEED-07, T-04-51).
    // The tenant's zone comes from the bootstrap (cached per request), the same clock page 1 used.
    const [page, tf, shareOrigin, bootstrap] = await Promise.all([
      getFeed({
        communityId: query.data.communityId,
        cursor: query.data.cursor,
        limit: query.data.limit,
      }),
      getTranslations('feed'),
      primaryHostOrigin(),
      getBootstrap(),
    ]);
    const now = Date.now();
    const timeZone = bootstrap.tenant.timezone;
    result = {
      ok: true,
      items: page.items.map((post) => postCardView(post, now, tf, shareOrigin, timeZone)),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: a community NAME is member-facing content and never reaches a log line (T-05-06).
    if (!refusal) console.error('communities.posts_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * The community page's infinite-scroll sentinel.
 *
 * The cursor is OPAQUE: it is forwarded exactly as the previous page returned it and is never
 * parsed, decoded or rebuilt here (T-05-05).
 */
export async function loadMoreCommunityPostsAction(
  communityId: string,
  cursor: string,
): Promise<CommunityPostsPageResult> {
  return communityPostsPage(communityId, cursor);
}

/** Page 1 again — what `PullToRefresh` calls, through the SAME read the RSC page performed. */
export async function refreshCommunityPostsAction(
  communityId: string,
): Promise<CommunityPostsPageResult> {
  return communityPostsPage(communityId);
}

/* ── COMM-01's WRITE half: create, edit, archive and reactivate (05-04) ───────────────────────── */

/**
 * What a community write can answer. Every refusal is a catalog KEY — the client translates — and
 * the vocabulary is the API's own closed `CommunityIssue` set plus the two transport-shaped
 * outcomes a form has to be able to draw: the container vanished under the admin (`not_found`), and
 * everything else (`generic`).
 */
export type CommunityWriteResult =
  | { ok: true; communityId: string }
  | { ok: false; code: CommunityIssue | 'not_found' | 'generic' };

/**
 * The API's `details.community` vocabulary, narrowed from an unknown payload.
 *
 * The membership test runs against the contract's OWN exported set rather than a hand-written
 * disjunction, so the vocabulary has exactly one definition and a future member cannot be forgotten
 * here (05-09: `cover_invalid` is the member that exposed the hand-written version).
 */
function asCommunityIssue(value: unknown): CommunityIssue | null {
  return typeof value === 'string' && COMMUNITY_ISSUE_SET.has(value)
    ? (value as CommunityIssue)
    : null;
}

/**
 * The shared refusal mapping for all four write actions. A 404 is its own code because the FORM has
 * a different thing to say about it than about a field error; everything else that is not a closed
 * code is `generic`.
 */
function writeRefusal(error: unknown): CommunityWriteResult {
  if (error instanceof ApiClientError) {
    if (error.status === 404) return { ok: false, code: 'not_found' };
    const issue = asCommunityIssue(
      (error.details as { community?: unknown } | undefined)?.community,
    );
    if (issue) return { ok: false, code: issue };
  }
  // Shape only: a community NAME is member-facing content and never reaches a log line (T-05-06).
  console.error('communities.write_failed', { error: String(error) });
  return { ok: false, code: 'generic' };
}

/**
 * Which of the TWO bare 404s this was (05-09).
 *
 * The API answers ONE indistinguishable 404 for a missing community and for a missing cover asset,
 * deliberately: that is the anti-oracle property D-23 buys and `isolation.test.ts` case b5 pins with
 * a body equality. Nothing here weakens the server to make the client's job easier — the
 * disambiguation happens in the BFF, and it is decided by a FACT rather than by what the form
 * remembers.
 *
 *  - **On a create** there is no community id to have missed, so a 404 on a submission that carried
 *    a cover can only be about the asset. No request needed.
 *  - **On an update** the community is RE-READ. It still reads back → the 404 was the cover.
 *    Anything else — a miss, or an answer we could not read — keeps `not_found`, which is the
 *    conservative answer and is still a true statement.
 *
 * Two things about that re-read. It runs AFTER the refusal has been produced and is NOT wrapped in a
 * try/catch of its own: `loadCommunity` already collapses its own transport failures, and its
 * `redirect()` on an expired session must be allowed to throw exactly as the `redirect(refusal)` at
 * the bottom of these actions is (Next 16: a catch would swallow the navigation). And it is one
 * extra GET on an already-failed write, against a resource the admin has open on their screen — it
 * tells them nothing they did not already know, so it opens no channel of its own and the bare 404
 * on the wire stays bare.
 *
 * Deliberately NOT a comparison against the cover the form started with: a stored cover id that is
 * already bad and is re-sent UNCHANGED (the row a pre-fix release could have written) shows no
 * difference to compare, and would be reported as a community that is demonstrably open on the
 * admin's screen.
 */
async function coverAwareRefusal(
  result: CommunityWriteResult,
  submittedCoverAssetId: string | null,
  communityId: string | null,
): Promise<CommunityWriteResult> {
  if (result.ok || result.code !== 'not_found' || submittedCoverAssetId === null) return result;
  if (communityId === null) return { ok: false, code: 'cover_invalid' };

  const community = await loadCommunity(communityId);
  return community.status === 'ok' ? { ok: false, code: 'cover_invalid' } : result;
}

/**
 * `POST /v1/communities` (COMM-01), in the three conventions every server action in this app
 * encodes:
 *
 *  1. **The SAME Zod the API validates with runs BEFORE the request.** A server action is a public
 *     endpoint and its argument is untrusted; `createCommunitySchema` is the identical schema the
 *     Hono route validates the body with, so the form's disabled-submit rule and the API's refusal
 *     are literally one definition.
 *  2. **A refusal is a catalog KEY, never pt-BR copy**, so nothing server-controlled reaches the DOM.
 *  3. **`redirect()` is called OUTSIDE the try/catch.** It throws in Next 16 and a catch would
 *     swallow the navigation — which is why the FORM navigates rather than this action.
 *
 * **This module must not re-export anything.** Turbopack drops a re-export from a `'use server'`
 * module and the build fails with "The module has no exports at all".
 */
export async function createCommunityAction(input: unknown): Promise<CommunityWriteResult> {
  const body = createCommunitySchema.safeParse(input);
  if (!body.success) {
    const issue = body.error.issues
      .map((problem) => asCommunityIssue(problem.message))
      .find(Boolean);
    return { ok: false, code: issue ?? 'generic' };
  }

  let refusal: string | null = null;
  let result: CommunityWriteResult = { ok: false, code: 'generic' };
  try {
    const community = await createCommunity(body.data);
    result = { ok: true, communityId: community.id };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) result = writeRefusal(error);
  }

  // No community id was sent, so a bare 404 on a submission carrying a cover is the cover (05-09).
  result = await coverAwareRefusal(result, body.data.coverAssetId ?? null, null);

  // The new community has to appear on the server-rendered list the admin lands back on.
  if (result.ok) revalidatePath('/comunidades');
  if (refusal) redirect(refusal);
  return result;
}

/**
 * `PATCH /v1/communities/{id}` — the edit. The same three rules, and the same schema the API
 * validates with, so "Nome" being required is one definition rather than two that can drift.
 */
export async function updateCommunityAction(
  communityId: string,
  input: unknown,
): Promise<CommunityWriteResult> {
  const body = updateCommunitySchema.safeParse(input);
  if (!body.success) {
    const issue = body.error.issues
      .map((problem) => asCommunityIssue(problem.message))
      .find(Boolean);
    return { ok: false, code: issue ?? 'generic' };
  }

  let refusal: string | null = null;
  let result: CommunityWriteResult = { ok: false, code: 'generic' };
  try {
    const community = await updateCommunity(communityId, body.data);
    result = { ok: true, communityId: community.id };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) result = writeRefusal(error);
  }

  // Archive and reactivate reach here with a `status` key only, so their submitted cover is null and
  // neither pays for the re-read (05-09).
  result = await coverAwareRefusal(result, body.data.coverAssetId ?? null, communityId);

  if (result.ok) {
    revalidatePath('/comunidades');
    revalidatePath(`/comunidades/${communityId}`);
  }
  if (refusal) redirect(refusal);
  return result;
}

/**
 * Archiving and reactivating are the SAME endpoint with the SAME schema — one `status` write, not
 * two verbs (05-RESEARCH §Pattern 7). They are two exported actions only because the form binds two
 * different controls to them; both go through `updateCommunityAction`, so neither can acquire a
 * revalidation or a refusal mapping the other lacks.
 */
export async function archiveCommunityAction(communityId: string): Promise<CommunityWriteResult> {
  return updateCommunityAction(communityId, { status: 'archived' });
}

export async function reactivateCommunityAction(
  communityId: string,
): Promise<CommunityWriteResult> {
  return updateCommunityAction(communityId, { status: 'active' });
}
