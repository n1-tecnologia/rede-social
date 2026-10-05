import { Card, Skeleton } from '@rede-social/ui';

/**
 * `/perfil` loading (UI-SPEC E1/loading): a `PageHeader`-height bar, the 80px avatar circle, two text
 * bars (name + e-mail) and three row bars — the shape of the screen, never a spinner. The 52px bar
 * (a 44px control plus `py-1`, the `/eventos/[eventId]` skeleton's) keeps the avatar where the page
 * draws it, so it does not jump when the profile swaps in.
 */
export default function ProfileLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="flex h-[52px] items-center gap-2 px-2 md:px-0">
        <Skeleton variant="circle" className="h-11 w-11" />
        <Skeleton variant="text" width={110} className="h-4" />
      </div>
      <div className="flex flex-col items-center gap-3 px-4 pt-6 pb-4">
        <Skeleton variant="circle" className="h-20 w-20" />
        <Skeleton variant="text" width={180} className="h-6" />
        <Skeleton variant="text" width={140} className="h-4" />
      </div>
      <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
        <div className="flex flex-col gap-3 px-4 py-4">
          <Skeleton variant="text" className="h-5" />
          <Skeleton variant="text" className="h-5" />
          <Skeleton variant="text" className="h-5" />
        </div>
      </Card>
    </div>
  );
}
