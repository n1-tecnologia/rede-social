import { Skeleton } from '@rede-social/ui';
import { NotificationsSkeleton } from './NotificationsSurface';

/**
 * `/notificacoes` loading (UI-D-265, UI E02/loading): the `PageHeader` bar plus 6 row skeletons in
 * the row's own geometry (a 40px circle, two text bars at 14px and 12px, `px-4 py-3`), shared with the
 * load-more skeleton so the swap to content does not shift the page.
 *
 * The header is redrawn rather than rendered (the `/post/[postId]` rule): `PageHeader` is a client
 * component whose title is a catalog string, and a boundary that only holds 44×44 of chrome for a
 * beat does not need either. Same geometry as the primitive, its `-0.5rem` sticky offset included.
 */
export default function NotificationsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col" aria-busy>
      <div className="sticky top-[-0.5rem] z-40 flex items-center gap-1 bg-bg/95 px-2 py-1 backdrop-blur-sm md:static md:px-0">
        <Skeleton variant="circle" className="h-11 w-11" />
        <Skeleton variant="text" width={110} className="h-4" />
      </div>
      <NotificationsSkeleton count={6} />
    </div>
  );
}
