import { STORY_PAGE_SIZE, type StoryPage, storyPageSchema } from '@tria/module-stories/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';

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
