import {
  type CreateStoryHighlight,
  type HighlightDetail,
  type HighlightList,
  type HighlightMembershipResult,
  type HighlightSummary,
  highlightDetailSchema,
  highlightListSchema,
  highlightMembershipResultSchema,
  highlightSummarySchema,
  type PublishStory,
  type ReorderHighlights,
  STORY_COMMENT_ISSUE_SET,
  STORY_COMMENTS_PAGE_SIZE,
  STORY_HIGHLIGHT_ISSUE_SET,
  STORY_ISSUE_SET,
  STORY_PAGE_SIZE,
  type StoryComment,
  type StoryCommentIssue,
  type StoryCommentPage,
  type StoryHighlightIds,
  type StoryHighlightIssue,
  type StoryIssue,
  type StoryLikeResult,
  type StoryPage,
  type StorySummary,
  storyCommentPageSchema,
  storyCommentSchema,
  storyHighlightIdsSchema,
  storyLikeResultSchema,
  storyPageSchema,
  storySummarySchema,
  type UpdateHighlight,
} from '@tria/module-stories/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The ONE stories fetch implementation (the `getFeed` / `getCommunities` rule, D-58, Pitfall 9). The
 * `/inicio` home slot and every later stories surface read THIS, so two screens can never disagree
 * about the page size or the tenant the request is scoped to.
 *
 * The browser never talks to Supabase for story data: every read goes through `apiFetch` to the Hono
 * API, which re-verifies the token and re-reads the membership row on every request.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code — every caller's refusal handling is the same.
  }
  return new ApiClientError(res.status, code, details);
}

/** The query the slot sends; `cursor` is OPAQUE and forwarded verbatim. */
export type StoryQueryInput = { cursor?: string; limit?: number };

/**
 * `GET /v1/stories` (STORY-01, STORY-03) — the tenant's ACTIVE stories, newest first.
 *
 * `limit` defaults to `STORY_PAGE_SIZE`; the API clamps it anyway. The cursor is passed through
 * untouched: its encoding is an implementation detail of the API, and nothing on the web side
 * parses, rebuilds or validates it.
 */
export async function getStories(query: StoryQueryInput = {}): Promise<StoryPage> {
  const search = new URLSearchParams();
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? STORY_PAGE_SIZE));

  const res = await apiFetch(`/v1/stories?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return storyPageSchema.parse(await res.json());
}

/**
 * One page of active stories, or `null` when the API could not answer.
 *
 * **This helper NEVER redirects and never rethrows** — the one deliberate departure from
 * `loadCommunities`, and UI-SPEC E01/error is the reason. The strip is a widget ABOVE the feed on
 * the screen every member lands on: a failed strip read must render NOTHING and leave `/inicio`
 * untouched. Turning a 401 into a navigation here would let a transient story read bounce a member
 * out of their home screen, and the page's own bootstrap has already made that decision properly.
 *
 * The failure is LOGGED, not surfaced. A member who cannot see a story that expires in an hour is
 * not helped by a retry button above their feed.
 */
export async function loadStories(query: StoryQueryInput = {}): Promise<StoryPage | null> {
  try {
    return await getStories(query);
  } catch (error) {
    // Shape only: a story CAPTION is member-facing content and never reaches a log line (T-05-29).
    console.error('stories.list_failed', { error: String(error) });
    return null;
  }
}

/**
 * The closed result vocabulary of a story publish. `code` is a catalog KEY, never pt-BR copy: the
 * client translates, so nothing server-controlled reaches the DOM through this path.
 *
 * `not_found` is the API's single bare 404 for every miss — an unknown asset id, another tenant's,
 * and one soft-deleted between the upload and the publish — so the screen says ONE thing for all of
 * them (D-23, T-05-26). Since 05.2-08 the same bare 404 also covers a destination highlight or
 * community that is unknown, removed or another tenant's.
 *
 * `archived`, `title_invalid` and `full` (a `StoryHighlightIssue`, 05.2-08) are the highlight
 * refusals of a publish that names a destination: a community archived AFTER the composer opened, a
 * pending title the API refuses, a highlight or place at its cap. They are the highlight writes'
 * own closed vocabulary (`details.highlight`), read rather than folded into `generic` so the composer
 * can name the community, reset its selection and state the title rule (UI-D-71).
 *
 * **Why this lives HERE and not beside the action.** A `'use server'` module may export nothing but
 * async functions, so a refusal mapper, a `ReadonlySet` and a result type cannot sit next to
 * `publishStoryAction`. The same reason `lib/feed-write.ts` exists.
 */
export type StoryWriteResult =
  | { ok: true; storyId: string }
  | { ok: false; code: StoryIssue | StoryHighlightIssue | 'not_found' | 'generic' };

const STORY_ISSUE_LOOKUP: ReadonlySet<string> = STORY_ISSUE_SET;

/** True for a machine code that belongs to the story module's closed vocabulary, and nothing else. */
export function asStoryIssue(value: unknown): StoryIssue | null {
  return typeof value === 'string' && STORY_ISSUE_LOOKUP.has(value) ? (value as StoryIssue) : null;
}

/** True for a code of the highlight writes' closed vocabulary (`details.highlight`), and nothing else. */
export function asStoryHighlightIssue(value: unknown): StoryHighlightIssue | null {
  return typeof value === 'string' && STORY_HIGHLIGHT_ISSUE_SET.has(value)
    ? (value as StoryHighlightIssue)
    : null;
}

/**
 * Reads the refusal the API put in `details.story` — or, for a publish that named a highlight, in
 * `details.highlight` — and nothing else from the envelope.
 *
 * The highlight code is accepted ONLY when it belongs to `STORY_HIGHLIGHT_ISSUE_SET`: an unrecognised
 * value is null (and so the generic failure), never a string passed through to the screen. The
 * retired pin refusal is no longer read: nothing in the web sends `communityId` any more.
 */
export function storyWriteIssue(
  error: unknown,
): StoryIssue | StoryHighlightIssue | 'not_found' | null {
  if (!(error instanceof ApiClientError)) return null;
  // An unknown, foreign or removed ASSET (or highlight, or community) is one bare 404.
  if (error.status === 404) return 'not_found';
  const details = error.details as { story?: unknown; highlight?: unknown } | undefined;
  return asStoryIssue(details?.story) ?? asStoryHighlightIssue(details?.highlight);
}

/**
 * `POST /v1/stories` (STORY-01) — through the SAME `apiFetch` every read above uses, so the publish
 * path cannot drift on the tenant header or on how a refusal is read.
 *
 * It deliberately does NOT revalidate and does NOT redirect: which paths a write invalidates and
 * whether a refusal becomes a navigation are decisions that belong to the action owning the request
 * (`redirect()` throws in Next 16 and this function's own catch would swallow it).
 */
export async function attemptStoryPublish(
  input: PublishStory,
): Promise<{ result: StoryWriteResult; refusal: string | null }> {
  try {
    const res = await apiFetch('/v1/stories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await apiError(res);
    const story = storySummarySchema.parse(await res.json());
    return { result: { ok: true, storyId: story.id }, refusal: null };
  } catch (error) {
    const issue = storyWriteIssue(error);
    if (issue) return { result: { ok: false, code: issue }, refusal: null };

    const refusal = error instanceof ApiClientError ? bootstrapRedirectPath(error) : null;
    // Shape only: a story CAPTION is member-facing content and never reaches a log line (T-05-29).
    if (!refusal) console.error('stories.publish_failed', { error: String(error) });
    return { result: { ok: false, code: 'generic' }, refusal };
  }
}

/* ── One story, and the like toggle (05-06) ───────────────────────────────────────────────────── */

/**
 * `GET /v1/stories/{storyId}` — the DEEP LINK's read.
 *
 * Three outcomes, never two: the story, "not this tenant's" and "we could not reach the server".
 * The middle one covers an unknown id, another tenant's and a soft-deleted one indistinguishably,
 * because the API answers one bare 404 for all three (D-23, T-05-35) — so `/stories/[storyId]`
 * renders the SAME not-found screen for every miss and tells a prober nothing.
 */
export type StoryResult =
  | { status: 'ok'; story: StorySummary }
  | { status: 'not-found' }
  | { status: 'error' };

export async function loadStory(storyId: string): Promise<StoryResult> {
  try {
    const res = await apiFetch(`/v1/stories/${encodeURIComponent(storyId)}`);
    // 400 is an id that is not a uuid; it is the same miss as far as a member is concerned.
    if (res.status === 404 || res.status === 400) return { status: 'not-found' };
    if (!res.ok) throw await apiError(res);
    return { status: 'ok', story: storySummarySchema.parse(await res.json()) };
  } catch (error) {
    // Shape only: a story CAPTION is member-facing content and never reaches a log line (T-05-29).
    console.error('stories.get_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `POST` / `DELETE /v1/stories/{storyId}/likes` (STORY-05) — through the SAME `apiFetch` every read
 * above uses, so the like path cannot drift on the tenant header or on how a refusal is read.
 *
 * The response is the AUTHORITATIVE `{ liked, likeCount }` read back inside the API's transaction.
 * Nothing here increments anything: the optimistic value lives in the button and is replaced by
 * this pair, or reverted when the request rejects.
 */
async function toggleStoryLike(
  storyId: string,
  method: 'POST' | 'DELETE',
): Promise<StoryLikeResult> {
  const res = await apiFetch(`/v1/stories/${encodeURIComponent(storyId)}/likes`, { method });
  if (!res.ok) throw await apiError(res);
  return storyLikeResultSchema.parse(await res.json());
}

export const likeStory = (storyId: string) => toggleStoryLike(storyId, 'POST');
export const unlikeStory = (storyId: string) => toggleStoryLike(storyId, 'DELETE');

/* ── Story comments (STORY-05, D-82, D-83) ────────────────────────────────────────────────────── */

/** The query the sheet sends; `cursor` is OPAQUE and forwarded verbatim. */
export type StoryCommentQueryInput = { cursor?: string; limit?: number };

/**
 * `GET /v1/stories/{storyId}/comments` (STORY-05, D-83) — the story's flat conversation, OLDEST
 * first, through the SAME `apiFetch` every read above uses.
 *
 * The cursor walks FORWARD over its own ascending index and is NOT interchangeable with the feed's
 * comment cursor, which walks backward over a different one. Feeding one to the other degrades to
 * page 1, exactly as a tampered cursor does — `decodeCursor` is total.
 */
export async function getStoryComments(
  storyId: string,
  query: StoryCommentQueryInput = {},
): Promise<StoryCommentPage> {
  const search = new URLSearchParams();
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? STORY_COMMENTS_PAGE_SIZE));

  const res = await apiFetch(
    `/v1/stories/${encodeURIComponent(storyId)}/comments?${search.toString()}`,
  );
  if (!res.ok) throw await apiError(res);
  return storyCommentPageSchema.parse(await res.json());
}

/**
 * `POST /v1/stories/{storyId}/comments`.
 *
 * **`parentId` is forwarded rather than refused here**, for the reason `createStoryCommentSchema`
 * accepts it: the DATABASE is what refuses a reply to a story comment, and a member calling the API
 * directly must get the same answer as a member tapping a button. The UI simply never draws the
 * affordance (D-82).
 */
export async function createStoryComment(
  storyId: string,
  body: string,
  parentId?: string,
): Promise<StoryComment> {
  const res = await apiFetch(`/v1/stories/${encodeURIComponent(storyId)}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parentId ? { body, parentId } : { body }),
  });
  if (!res.ok) throw await apiError(res);
  return storyCommentSchema.parse(await res.json());
}

/** `DELETE /v1/stories/{storyId}/comments/{commentId}` — a member removes their OWN comment. */
export async function deleteStoryComment(storyId: string, commentId: string): Promise<void> {
  const res = await apiFetch(
    `/v1/stories/${encodeURIComponent(storyId)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw await apiError(res);
}

/**
 * Reads the STORY-05 refusal the API put in `details.comment`, and nothing else from the envelope.
 *
 * It answers only `story_comment_no_reply`: `story_comment_not_likeable` is raised by the FEED's
 * comment-like route and read by the feed's own mapper, and a story's flat list has no like control
 * to raise it from in the first place. Both codes live in one exported vocabulary so the pair can
 * still be switched on exhaustively (`STORY_COMMENT_ISSUE_SET`).
 */
export function storyCommentIssue(error: unknown): StoryCommentIssue | null {
  if (!(error instanceof ApiClientError)) return null;
  const issue = (error.details as { comment?: unknown } | undefined)?.comment;
  return typeof issue === 'string' && STORY_COMMENT_ISSUE_SET.has(issue)
    ? (issue as StoryCommentIssue)
    : null;
}

/* ── Community pins (STORY-04, D-68) ──────────────────────────────────────────────────────────── */

/**
 * `GET /v1/stories/mine` (D-84) — the admin's own history, expired stories included.
 *
 * Unlike the strip's read this one DOES surface its failure, because the history IS the screen: an
 * empty list and an unreadable one are different answers there, and UI E08/error asks for the
 * generic empty state plus a retry. `null` is "we could not read it".
 */
export async function loadOwnStories(query: StoryQueryInput = {}): Promise<StoryPage | null> {
  try {
    const search = new URLSearchParams();
    if (query.cursor) search.set('cursor', query.cursor);
    search.set('limit', String(query.limit ?? STORY_PAGE_SIZE));

    const res = await apiFetch(`/v1/stories/mine?${search.toString()}`);
    if (!res.ok) throw await apiError(res);
    return storyPageSchema.parse(await res.json());
  } catch (error) {
    console.error('stories.list_own_failed', { error: String(error) });
    return null;
  }
}

/** `DELETE /v1/stories/{storyId}` (D-84) — the admin soft-deletes one of their tenant's stories. */
export async function deleteStory(storyId: string): Promise<void> {
  const res = await apiFetch(`/v1/stories/${encodeURIComponent(storyId)}`, { method: 'DELETE' });
  if (!res.ok) throw await apiError(res);
}

/* ── Highlights (05.2) ────────────────────────────────────────────────────────────────────────── */

/**
 * The query a place's highlight row sends. No `communityId` means Início — the ABSENCE of the id,
 * never a null or a sentinel. `scope: 'all'` is the CURATOR's read (empty highlights included,
 * D-102); the API refuses it 403 to a caller without `stories.story.manage`, and the Início row
 * never asks for it (T-05.2-20).
 */
export type HighlightQueryInput = { communityId?: string; scope?: 'all' };

/**
 * `GET /v1/stories/highlights?communityId=&scope=` (HIGHLIGHT-03) — one place's row in `position,
 * id` order, each highlight with its server-resolved cover (R-D-D). No paging: a place holds at most
 * `STORY_HIGHLIGHT_MAX_PER_PLACE`.
 */
export async function getHighlights(query: HighlightQueryInput = {}): Promise<HighlightList> {
  const search = new URLSearchParams();
  if (query.communityId) search.set('communityId', query.communityId);
  if (query.scope) search.set('scope', query.scope);
  const qs = search.toString();

  const res = await apiFetch(`/v1/stories/highlights${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw await apiError(res);
  return highlightListSchema.parse(await res.json());
}

/**
 * One place's highlights, or `null` when the API could not answer.
 *
 * **It NEVER navigates and never rethrows** — the `loadStories` rule, for the same reason (UI E01/E02
 * error, T-05.2-22): the row sits above the feed on the screen every member lands on, and a row
 * must never be why a page errors. A tenant whose `stories` module is off answers 404 here, which is
 * swallowed into the same `null` an empty row renders as.
 */
export async function loadHighlights(
  query: HighlightQueryInput = {},
): Promise<HighlightList | null> {
  try {
    return await getHighlights(query);
  } catch (error) {
    // Shape only: a highlight TITLE is tenant content and never reaches a log line (T-05-29).
    console.error('stories.highlights_list_failed', { error: String(error) });
    return null;
  }
}

/**
 * `GET /v1/stories/highlights/{highlightId}` (HIGHLIGHT-02) — ONE highlight and its stories, oldest
 * first by publish time (D-103), EXPIRED ones included: the item row is the expiry override. The
 * API re-authorises every read and answers the same bare 404 for another tenant's highlight, a
 * deleted one, and an EMPTY one a member may not open (T-05.2-23). Throws `ApiClientError` like its
 * siblings; the grouped viewer's lazy read (`loadHighlightItemsAction`) decides what a miss means.
 */
export async function getHighlight(highlightId: string): Promise<HighlightDetail> {
  const res = await apiFetch(`/v1/stories/highlights/${encodeURIComponent(highlightId)}`);
  if (!res.ok) throw await apiError(res);
  return highlightDetailSchema.parse(await res.json());
}

/* ── The highlight sheet (05.2-06, D-110) ─────────────────────────────────────────────────────── */

/**
 * `GET /v1/stories/highlights/catalog` — EVERY highlight a curator can act on, in one statement:
 * Início's first, then each ACTIVE community's in position order (never an archived one, and none at
 * all while the communities module is off). Manage-only: a member is refused 403 (T-05.2-26).
 */
export async function getHighlightCatalog(): Promise<HighlightList> {
  const res = await apiFetch('/v1/stories/highlights/catalog');
  if (!res.ok) throw await apiError(res);
  return highlightListSchema.parse(await res.json());
}

/** `GET /v1/stories/{storyId}/highlights` — the ids of the highlights one story is in. Manage-only. */
export async function getStoryHighlightIds(storyId: string): Promise<StoryHighlightIds> {
  const res = await apiFetch(`/v1/stories/${encodeURIComponent(storyId)}/highlights`);
  if (!res.ok) throw await apiError(res);
  return storyHighlightIdsSchema.parse(await res.json());
}

/**
 * `PUT` / `DELETE /v1/stories/highlights/{highlightId}/stories/{storyId}` — ONE toggle, ONE request.
 *
 * The answer is the AUTHORITATIVE `{ highlighted, highlightCount }` read back inside the API's
 * transaction (`highlightCount` is how many highlights the STORY is in now). Both writes are
 * idempotent at the API, so a retried toggle never double-counts. It neither revalidates nor
 * redirects: those are the calling action's decisions.
 */
export async function setHighlightMembership(
  highlightId: string,
  storyId: string,
  next: boolean,
): Promise<HighlightMembershipResult> {
  const res = await apiFetch(
    `/v1/stories/highlights/${encodeURIComponent(highlightId)}/stories/${encodeURIComponent(storyId)}`,
    { method: next ? 'PUT' : 'DELETE' },
  );
  if (!res.ok) throw await apiError(res);
  return highlightMembershipResultSchema.parse(await res.json());
}

/**
 * Reads the refusal a highlight WRITE put in `details.highlight`, and nothing else from the envelope
 * — accepted ONLY when it belongs to `STORY_HIGHLIGHT_ISSUE_SET`, so an unrecognised value is null
 * (the generic failure), never a string passed through to the screen. A 404 is the API's ONE bare
 * miss (unknown, deleted or another tenant's highlight or story) and reads as `not_found`.
 */
export function highlightWriteIssue(error: unknown): StoryHighlightIssue | 'not_found' | null {
  if (!(error instanceof ApiClientError)) return null;
  if (error.status === 404) return 'not_found';
  const issue = (error.details as { highlight?: unknown } | undefined)?.highlight;
  return typeof issue === 'string' && STORY_HIGHLIGHT_ISSUE_SET.has(issue)
    ? (issue as StoryHighlightIssue)
    : null;
}

/* ── Curation (05.2-09, HIGHLIGHT-01) ─────────────────────────────────────────────────────────── */

/**
 * The manage screen's four writes, each against its plan 01/03 route and each parsing its answer
 * with the published schema. They THROW `ApiClientError` on any refusal and neither revalidate nor
 * redirect: what a refusal means (a closed code, a toast, a navigation) is the calling action's
 * decision. Every route is manage-only at the API (the literal `stories.story.manage`, T-05.2-39).
 */

/** `POST /v1/stories/highlights` — a new highlight, appended at the END of its place (R-D-C). */
export async function createHighlight(input: CreateStoryHighlight): Promise<HighlightSummary> {
  const res = await apiFetch('/v1/stories/highlights', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiError(res);
  return highlightSummarySchema.parse(await res.json());
}

/**
 * `PATCH /v1/stories/highlights/{id}` — rename and/or re-cover. The answer is the summary AFTER the
 * write, with the cover re-resolved by the server. Replacing or clearing an uploaded cover never
 * deletes the old asset (R-D-E) — there is no delete anywhere in this path.
 */
export async function updateHighlight(
  highlightId: string,
  patch: UpdateHighlight,
): Promise<HighlightSummary> {
  const res = await apiFetch(`/v1/stories/highlights/${encodeURIComponent(highlightId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await apiError(res);
  return highlightSummarySchema.parse(await res.json());
}

/** `DELETE /v1/stories/highlights/{id}` — 204; the stories themselves are untouched (R-D-F). */
export async function deleteHighlight(highlightId: string): Promise<void> {
  const res = await apiFetch(`/v1/stories/highlights/${encodeURIComponent(highlightId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw await apiError(res);
}

/**
 * `PUT /v1/stories/highlights/order` — ONE place's FULL permutation (Início when `communityId` is
 * absent). A set that is not exactly the place's current one is `order_stale` and writes nothing.
 * The answer is the place's curator row in the new order.
 */
export async function reorderHighlights(input: ReorderHighlights): Promise<HighlightList> {
  const res = await apiFetch('/v1/stories/highlights/order', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiError(res);
  return highlightListSchema.parse(await res.json());
}

/**
 * The manage screens' ONE read (05.2-09, D-109): one place's CURATOR row (`scope: 'all'`, empty
 * highlights included). Unlike the row's `loadHighlights`, a miss here MATTERS — the list IS the
 * screen — so the outcome is explicit: the API's bare 404 (a community that is unknown, another
 * tenant's, removed, or the communities module off) is `not-found`; a session refusal is the
 * navigation `bootstrapRedirectPath` names; anything else is `error`. The caller decides what each
 * renders, and calls `redirect()` / `notFound()` itself (both throw in Next 16).
 */
export type CuratorHighlightsResult =
  | { status: 'ok'; list: HighlightList }
  | { status: 'not-found' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

export async function loadCuratorHighlights(query: {
  communityId?: string;
}): Promise<CuratorHighlightsResult> {
  try {
    return { status: 'ok', list: await getHighlights({ ...query, scope: 'all' }) };
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.status === 404) return { status: 'not-found' };
      const path = bootstrapRedirectPath(error);
      if (path) return { status: 'redirect', path };
    }
    // Shape only: highlight titles are tenant content (T-05.2-28).
    console.error('stories.curator_highlights_failed', { error: String(error) });
    return { status: 'error' };
  }
}
