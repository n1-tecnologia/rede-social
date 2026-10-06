import { Skeleton } from '@rede-social/ui';

/**
 * `/perfil/editar` loading (UI-SPEC E2/loading): a `PageHeader`-height bar, the avatar circle and two
 * field bars — the same loading vocabulary as the rest of the phase, never a spinner. The 52px bar
 * (the `/eventos/[eventId]` skeleton's) and the form's own `px-4 py-6` keep the photo where the page
 * draws it, so it does not jump when the form swaps in. It is already the task screen the form
 * declares (`data-shell-hide="nav"`), so the BottomNav does not flash back in between.
 */
export default function EditProfileLoading() {
  return (
    <div className="flex flex-col" data-shell-hide="nav" aria-busy>
      <div className="flex h-[52px] items-center gap-2 px-2 md:px-0">
        <Skeleton variant="circle" className="h-11 w-11" />
        <Skeleton variant="text" width={110} className="h-4" />
      </div>
      <div className="flex flex-col gap-6 px-4 py-6">
        <div className="flex flex-col items-center gap-3">
          <Skeleton variant="circle" className="h-20 w-20" />
          <Skeleton variant="text" width={120} className="h-4" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton variant="text" width={60} className="h-3" />
          <Skeleton variant="rect" className="h-12 w-full" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton variant="text" width={40} className="h-3" />
          <Skeleton variant="rect" className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
