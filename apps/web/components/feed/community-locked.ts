'use client';

import { useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

/**
 * UI-D-376 (08.2-09): the ONE reaction to a feed action the API refused with `community_locked` —
 * the viewer lost access to the post's community mid-session (a revoke, or a product was just
 * linked). The caller has already reverted its optimistic state and closed any comment sheet; this
 * toasts "Esta comunidade agora é exclusiva…" and refreshes the route, so the post page lands on the
 * locked community page and Início, Reels and the community page re-render without the post (or as
 * the locked variant). No polling and no push: the refresh is the only re-read.
 *
 * Shared by every host of the feed actions (`FeedSurface`, `PostDetail`, `ReelsHost`), so the
 * behaviour cannot drift between them; each passes the catalog's `feed.errors.communityLocked`.
 * `refresh: false` (2026-10-09) is the Reels overlay over a feed: it toasts only, because a refresh
 * would hand the list underneath a new first page and lose the place the member scrolled to.
 *
 * It lives in its own module (2026-10-09) rather than in `FeedSurface`, which now opens the Reels
 * overlay: `ReelsHost` importing it from there would close an import cycle.
 */
export function useCommunityLockedRefusal(
  message: string,
  { refresh = true }: { refresh?: boolean } = {},
): () => void {
  const toast = useToast();
  const router = useRouter();
  return useCallback(() => {
    toast.show({ tone: 'info', message });
    if (refresh) router.refresh();
  }, [message, toast, router, refresh]);
}

/** The like refusal's code read by every host: the locked reaction, or the generic toast. */
export function isCommunityLockedCode(code: string | undefined): boolean {
  return code === 'community_locked';
}

/**
 * UI-D-500 (09-11, D-469): the ONE reaction to a feed action the API refused with `follow_required` -
 * the viewer stopped following a member post's author, or the author's audience changed, while a card
 * or the comment sheet was open. The caller has already reverted its optimistic state and closed any
 * comment sheet; this toasts "Siga o autor para curtir e comentar." (info, not an error: it is a
 * reaction) and refreshes the route, so the card leaves Explorar and the post page re-renders as the
 * "Siga para ver" screen.
 *
 * Shared by the same three hosts as the community reaction, so the two cannot drift. `refresh: false`
 * is the Reels overlay over a feed: it toasts only, because a refresh would hand the list underneath a
 * new first page and lose the place the member scrolled to (the list refreshes on its own next load).
 * The two reactions are separate hooks with separate sentences: they are different meanings.
 */
export function useFollowRequiredRefusal(
  message: string,
  { refresh = true }: { refresh?: boolean } = {},
): () => void {
  const toast = useToast();
  const router = useRouter();
  return useCallback(() => {
    toast.show({ tone: 'info', message });
    if (refresh) router.refresh();
  }, [message, toast, router, refresh]);
}

/** The like refusal's code of the second closed value (09-11). */
export function isFollowRequiredCode(code: string | undefined): boolean {
  return code === 'follow_required';
}
