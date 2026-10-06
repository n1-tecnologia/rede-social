import { Card, Skeleton } from '@rede-social/ui';

/**
 * Marca tab loading (E14/loading): skeletons shaped like the cards — the two drop zones, the
 * colour fields + the two 200×140 mini-shells + the contrast pills, the look's cards (2026-10-03:
 * a title, a field row and a pill each), and the app-icons row. Never a spinner-only page.
 */
export default function TenantBrandingLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <Card className="flex flex-col gap-4 p-4 md:p-6">
        <Skeleton variant="text" width="30%" className="h-3" />
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton variant="rect" className="min-h-40 w-full" />
          <Skeleton variant="rect" className="min-h-40 w-full" />
        </div>
      </Card>
      <Card className="flex flex-col gap-4 p-4 md:p-6">
        <Skeleton variant="text" width="20%" className="h-3" />
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton variant="rect" className="h-11 w-full" />
          <Skeleton variant="rect" className="h-11 w-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton variant="rect" className="mx-auto h-[140px] w-[200px]" />
          <Skeleton variant="rect" className="mx-auto h-[140px] w-[200px]" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton variant="text" width={88} className="h-6 rounded-full" />
          <Skeleton variant="text" width={88} className="h-6 rounded-full" />
          <Skeleton variant="text" width={88} className="h-6 rounded-full" />
        </div>
      </Card>
      {[0, 1, 2, 3].map((card) => (
        <Card key={card} className="flex flex-col gap-4 p-4 md:p-6">
          <Skeleton variant="text" width="30%" className="h-4" />
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton variant="rect" className="h-11 w-full" />
            <Skeleton variant="rect" className="h-11 w-full" />
          </div>
          <Skeleton variant="text" width={88} className="h-6 rounded-full" />
        </Card>
      ))}
      <Card className="flex flex-col gap-4 p-4 md:p-6">
        <Skeleton variant="text" width="35%" className="h-3" />
        <div className="flex flex-wrap gap-3">
          <Skeleton variant="rect" className="h-10 w-10" />
          <Skeleton variant="rect" className="h-10 w-10" />
          <Skeleton variant="rect" className="h-10 w-10" />
          <Skeleton variant="rect" className="h-10 w-10" />
        </div>
      </Card>
    </div>
  );
}
