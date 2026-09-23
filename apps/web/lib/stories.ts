import {
  type PublishStory,
  STORY_ISSUE_SET,
  STORY_PAGE_SIZE,
  type StoryIssue,
  type StoryPage,
  storyPageSchema,
  storySummarySchema,
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
 * them (D-23, T-05-26).
 *
 * **Why this lives HERE and not beside the action.** A `'use server'` module may export nothing but
 * async functions, so a refusal mapper, a `ReadonlySet` and a result type cannot sit next to
 * `publishStoryAction`. The same reason `lib/feed-write.ts` exists.
 */
export type StoryWriteResult =
  | { ok: true; storyId: string }
  | { ok: false; code: StoryIssue | 'not_found' | 'generic' };

const STORY_ISSUE_LOOKUP: ReadonlySet<string> = STORY_ISSUE_SET;

/** True for a machine code that belongs to the story module's closed vocabulary, and nothing else. */
export function asStoryIssue(value: unknown): StoryIssue | null {
  return typeof value === 'string' && STORY_ISSUE_LOOKUP.has(value) ? (value as StoryIssue) : null;
}

/** Reads the refusal the API put in `details.story`, and nothing else from the envelope. */
export function storyWriteIssue(error: unknown): StoryIssue | 'not_found' | null {
  if (!(error instanceof ApiClientError)) return null;
  // An unknown, foreign or removed ASSET is the same bare 404 an unknown story id is (D-23).
  if (error.status === 404) return 'not_found';
  return asStoryIssue((error.details as { story?: unknown } | undefined)?.story);
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
