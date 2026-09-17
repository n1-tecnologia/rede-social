import { Card, Skeleton } from '@tria/ui';

/** Tenant segment loading (E13): the 24 px title, a pill and a card of rows while the detail streams. */
export default function TenantLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="flex items-center gap-3">
        <Skeleton variant="text" width="40%" className="h-7" />
        <Skeleton variant="text" width={72} className="h-7 rounded-full" />
      </div>
      <Skeleton variant="text" width="25%" className="h-3" />
      <Card className="flex flex-col gap-3 p-4 md:p-6">
        <Skeleton width="60%" />
        <Skeleton width="80%" />
        <Skeleton width="45%" />
      </Card>
    </div>
  );
}
