import { ScreenHeaderSkeleton } from '../ScreenHeader';
import { ManageCardsSkeleton } from './ManageHub';

/**
 * "Gerenciar" while it loads (2026-10-23): the header and the four cards at their final geometry, a
 * WIDE page like the hub (`data-shell-wide`, the cards two by two from `lg`).
 */
export default function ManageLoading() {
  return (
    <div aria-busy data-shell-wide className="mx-auto flex w-full flex-col pb-6">
      <ScreenHeaderSkeleton />
      <ManageCardsSkeleton />
    </div>
  );
}
