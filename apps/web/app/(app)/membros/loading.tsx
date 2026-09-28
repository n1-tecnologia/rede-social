import { Skeleton } from '@rede-social/ui';
import { MembersSkeleton } from './MembersList';

/**
 * `/membros` loading (UI-SPEC E4/loading): the search pill's geometry and the SAME eight rows the
 * list renders while a debounced query change is in flight — one shape for both loads, never a
 * spinner.
 */
export default function MembersLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3" aria-busy>
      <div className="px-4 pb-3">
        <Skeleton variant="rect" className="h-11 rounded-full" />
      </div>
      <MembersSkeleton />
    </div>
  );
}
