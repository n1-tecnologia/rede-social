'use client';

import { useToast } from '@tria/ui';
import { useCallback } from 'react';
import type { deletePostAction } from '@/app/(app)/inicio/feed-actions';

/**
 * THE composition point for FEED-03's soft delete (UI-SPEC E18/loading, E18/error).
 *
 * It exists for the same one reason `useSharePost` does: the outcome branch is a TOAST, `useToast`
 * is a hook, and a server component cannot hold one. Nothing inside `@tria/module-feed` decides
 * what a delete outcome means and nothing inside it holds a catalog string (PWA-03) — the module's
 * `PostMenu` only knows that the promise it awaits either settles or rejects.
 *
 * | Outcome                | What happens here          | What the menu does |
 * |------------------------|----------------------------|--------------------|
 * | the API confirmed it   | the "Publicação excluída." toast | closes, and the list drops the card |
 * | a refusal, any reason  | the generic error toast, then a REJECTION | the dialog closes and the card STAYS |
 *
 * **The rejection is load-bearing.** `ConfirmDialog` closes on either outcome, but only a rejection
 * keeps `FeedList` from removing the card — and a post must never leave one member's screen while
 * it still exists for everyone else (the 03-05 "no optimistic removal plus the generic toast" rule).
 *
 * A repeat delete answers the API's bare 404 and lands on the error branch: the post is already
 * gone, the row keeps its single `deleted_at` stamp, and no second event is emitted.
 */
export function useDeletePost(
  action: typeof deletePostAction,
  labels: { deleted: string; error: string },
) {
  const toast = useToast();

  return useCallback(
    async (postId: string) => {
      let ok = false;
      try {
        ok = (await action(postId)).ok;
      } catch (error) {
        // A server action that never reached the server rejects; that is the same outcome as a
        // refusal for the member, and letting it escape here would skip the toast entirely.
        console.error('feed.post.delete_failed', { error: String(error) });
      }
      if (!ok) {
        toast.show({ tone: 'error', message: labels.error });
        throw new Error('post_delete_refused');
      }
      toast.show({ tone: 'success', message: labels.deleted });
    },
    [action, toast, labels.deleted, labels.error],
  );
}
