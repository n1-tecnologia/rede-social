import { Skeleton } from '@rede-social/ui';

/**
 * `/perfil/editar` loading (UI-SPEC E2/loading): the avatar circle and two field bars — the same
 * loading vocabulary as the rest of the phase, never a spinner.
 */
export default function EditProfileLoading() {
  return (
    <div className="flex flex-col gap-6 px-4 py-6" aria-busy>
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
  );
}
