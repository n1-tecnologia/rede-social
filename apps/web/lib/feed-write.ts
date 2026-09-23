import {
  FEED_COMMUNITY_ISSUE_SET,
  FEED_MEDIA_ISSUES,
  type FeedCommunityIssue,
  type FeedMediaIssue,
  type FeedPost,
} from '@tria/module-feed/contracts';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * What the three post-write server actions share (04-09): the result vocabulary, the refusal
 * mapping and the one try/catch that performs the write.
 *
 * **Why it is NOT inside either action file.** A `'use server'` module may export nothing but async
 * functions, so a refusal mapper, a `ReadonlySet` and a result type cannot live beside the actions
 * that use them without being duplicated into both `inicio/feed-actions.ts` (edit, delete) and
 * `criar/actions.ts` (create). Two copies of "which envelope field carries the refusal" is exactly
 * the drift that would let the composer show the generic sentence for a refusal it has real copy
 * for. One module, imported by both.
 *
 * **`redirect()` is deliberately NOT called here.** It throws in Next 16 and the caller's catch
 * would swallow the navigation, so `attemptPostWrite` RETURNS the path and the action — which owns
 * the request — calls `redirect()` outside its own try/catch. That is the same three-rule shape
 * every server action in this app follows.
 */

/**
 * The closed result vocabulary of a post create or edit. `code` is a catalog KEY, never pt-BR copy
 * (T-04-42): the client translates, so nothing server-controlled reaches the DOM through this path.
 *
 * The media half is the contracts' own closed set forwarded verbatim — the composer switches on it
 * exhaustively and a new refusal code cannot compile until it has copy. `not_found` is the API's
 * single bare 404 for every miss (someone else's post, an unknown id, another tenant's, and one
 * soft-deleted between the form loading and the save), so the composer says ONE thing for all of
 * them exactly as `/post/[id]` does (UI-D-16).
 */
export type PostWriteResult =
  | { ok: true; postId: string }
  | {
      ok: false;
      code: FeedMediaIssue | FeedCommunityIssue | 'empty_post' | 'not_found' | 'generic';
    };

export type PostDeleteResult = { ok: true } | { ok: false; code: 'not_found' | 'generic' };

const MEDIA_ISSUE_SET: ReadonlySet<string> = new Set(FEED_MEDIA_ISSUES);

/** True for a machine code that belongs to the feed's closed media vocabulary, and nothing else. */
export function asMediaIssue(value: unknown): FeedMediaIssue | null {
  return typeof value === 'string' && MEDIA_ISSUE_SET.has(value) ? (value as FeedMediaIssue) : null;
}

/**
 * The same, for COMM-04's destination vocabulary. A SECOND function rather than one merged lookup
 * because the two codes arrive on different envelope KEYS (`details.media` vs `details.community`),
 * and collapsing them would let a media code surface as a community refusal the day the two
 * vocabularies happen to share a word.
 */
export function asCommunityIssue(value: unknown): FeedCommunityIssue | null {
  return typeof value === 'string' && FEED_COMMUNITY_ISSUE_SET.has(value)
    ? (value as FeedCommunityIssue)
    : null;
}

/**
 * Reads the refusal the API put in `details`, and nothing else from the envelope.
 *
 * Two shapes, both already in use on the create path: `details.media` carries one machine code from
 * the closed media vocabulary, and `details.issues` carries Zod's own list — of which the composer
 * branches on exactly one, `empty_post`, because it is the only one the submit control also guards.
 */
export function postWriteIssue(
  error: unknown,
): FeedMediaIssue | FeedCommunityIssue | 'empty_post' | 'not_found' | null {
  if (!(error instanceof ApiClientError)) return null;
  // COMM-04: an unknown, foreign or removed community is the SAME bare 404 an unknown post id is
  // (D-23) — the composer says one thing for all of them, exactly as `/post/[id]` does.
  if (error.status === 404) return 'not_found';
  const details = error.details as
    | { media?: unknown; community?: unknown; issues?: { message?: unknown }[] }
    | undefined;
  const media = asMediaIssue(details?.media);
  if (media) return media;
  const community = asCommunityIssue(details?.community);
  if (community) return community;
  if (details?.issues?.some((issue) => issue.message === 'empty_post')) return 'empty_post';
  return null;
}

/**
 * Runs one post write and maps its outcome.
 *
 * It deliberately does NOT revalidate: which paths a write invalidates is a decision that belongs
 * to the action owning the request — `deletePostAction` already makes it inline — and burying it
 * here would hide it from the two call sites a reviewer actually reads.
 */
export async function attemptPostWrite(
  run: () => Promise<FeedPost>,
): Promise<{ result: PostWriteResult; refusal: string | null }> {
  try {
    const post = await run();
    return { result: { ok: true, postId: post.id }, refusal: null };
  } catch (error) {
    const issue = postWriteIssue(error);
    if (issue) return { result: { ok: false, code: issue }, refusal: null };

    const refusal = error instanceof ApiClientError ? bootstrapRedirectPath(error) : null;
    // Shape only: a caption is member content and never reaches a log line (T-04-05/T-04-40).
    if (!refusal) console.error('feed.post.write_failed', { error: String(error) });
    return { result: { ok: false, code: 'generic' }, refusal };
  }
}
