import { Skeleton } from '@rede-social/ui';

/**
 * The completion screen while its reads run (12-12, UI-D-588): the layout's brand is already painted, so
 * this is a 192x28 title bar, a 14px intro bar and four question skeletons (a label bar 40% wide over a
 * 50px field), all `rounded-xl`. No spinner; `aria-busy` tells assistive technology it is loading.
 */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton variant="rect" width={192} height={28} className="rounded-xl" />
        <Skeleton variant="rect" height={14} className="rounded-xl" />
      </div>
      <div className="flex flex-col gap-6 rounded-xl bg-card p-4">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex flex-col gap-2">
            <Skeleton variant="rect" width="40%" height={14} className="rounded-xl" />
            <Skeleton variant="rect" height={50} className="rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
