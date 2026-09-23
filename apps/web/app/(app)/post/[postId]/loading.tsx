import { CommentsListSkeleton, FeedCardSkeleton } from '@tria/module-feed/ui';
import { Skeleton } from '@tria/ui';

/**
 * `/post/[postId]` loading (UI-SPEC E13/loading): the header chrome, ONE card skeleton and the
 * comment list's own rows beneath it.
 *
 * Both skeletons are the module's OWN exports — the same geometry the real card and the real rows
 * have — so the swap to content does not shift the page. A skeleton drawn by hand here would be a
 * second card geometry to keep in step with the first, which is exactly what exporting them from
 * `FeedList`/`CommentsList` avoids.
 *
 * The header is redrawn rather than rendered: `PageHeader` is a client component whose title is a
 * catalog string, and a boundary that only has to hold 44×44 of chrome for a beat does not need to
 * pay for either.
 */
export default function PostLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3" aria-busy>
      <div className="sticky top-0 z-40 flex items-center gap-1 bg-bg/95 px-2 py-1 backdrop-blur-sm md:static md:px-0">
        <Skeleton variant="circle" className="h-11 w-11" />
        <Skeleton variant="text" width={110} className="h-4" />
      </div>
      <FeedCardSkeleton />
      <CommentsListSkeleton />
    </div>
  );
}
