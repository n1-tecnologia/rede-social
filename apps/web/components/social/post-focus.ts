/**
 * The one-shot that carries "focus the post" across a server re-render of the SAME URL (09-11,
 * UI-D-499, planning decision 3).
 *
 * The "Siga para ver" screen unmounts the moment `router.refresh()` lands, because the server then
 * renders the real post at the shared link: nothing client-side survives the swap. `LockedPostScreen`
 * marks the post before it refreshes and `PostDetail` consumes the mark on mount, moving focus into
 * the post region so a keyboard or screen-reader user lands on what just opened.
 *
 * A module variable rather than a query parameter, so the URL stays exactly the shared one. The mark
 * is for ONE post, is consumed once, and goes stale after ten seconds: a refresh that never landed
 * must not steal focus on some later visit to the same post.
 */
const STALE_AFTER_MS = 10_000;

let pending: { postId: string; at: number } | null = null;

/** Called by the locked screen after a successful follow, before it refreshes. */
export function markFocusAfterFollow(postId: string): void {
  pending = { postId, at: Date.now() };
}

/** Called by the post page on mount: true exactly once, for the marked post, while the mark is fresh. */
export function consumeFocusAfterFollow(postId: string): boolean {
  if (pending === null || pending.postId !== postId) return false;
  const fresh = Date.now() - pending.at <= STALE_AFTER_MS;
  pending = null;
  return fresh;
}
