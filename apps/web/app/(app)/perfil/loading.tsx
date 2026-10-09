import { Card, Skeleton } from '@rede-social/ui';

/**
 * `/perfil` loading (UI-SPEC E1/loading): the 80px avatar circle, two text bars (name + e-mail) and
 * three row bars — the shape of the screen, never a spinner.
 */
export default function ProfileLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
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
