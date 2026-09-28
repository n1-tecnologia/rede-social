import { Skeleton } from '@rede-social/ui';

/**
 * `/membros/[membershipId]` loading (UI-SPEC E3/loading): the 80px avatar circle, a name bar and two
 * bio bars — the shape of the screen, never a spinner. The screen has nothing else on it, so the
 * skeleton has nothing else either (D-45).
 */
export default function MemberProfileLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3" aria-busy>
      <div className="flex flex-col items-center gap-3 px-4 pt-6 pb-4">
        <Skeleton variant="circle" className="h-20 w-20" />
        <Skeleton variant="text" width={180} className="h-7" />
        <Skeleton variant="text" width={240} className="h-4" />
        <Skeleton variant="text" width={200} className="h-4" />
      </div>
    </div>
  );
}
