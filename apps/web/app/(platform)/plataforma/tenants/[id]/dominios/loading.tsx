import { Card, Skeleton } from '@tria/ui';

/**
 * Domínios tab loading (E16/loading): the attach-form geometry (label + 44 px input + button) and
 * two domain-card skeletons (title, two pills, three text rows) — never a spinner-only page.
 */
export default function TenantDomainsLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton variant="text" width={72} className="h-3" />
      <Card className="flex flex-col gap-3 p-4 md:p-6">
        <Skeleton variant="text" width={64} className="h-3.5" />
        <div className="flex flex-col gap-3 md:flex-row">
          <Skeleton variant="rect" className="h-11 md:flex-1" />
          <Skeleton variant="rect" width={180} className="h-11 w-full md:w-[180px]" />
        </div>
      </Card>
      {[0, 1].map((i) => (
        <Card key={i} className="flex flex-col gap-4 p-4 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton variant="text" width="40%" className="h-5" />
            <Skeleton variant="text" width={64} className="h-6 rounded-full" />
            <Skeleton variant="text" width={96} className="h-6 rounded-full" />
          </div>
          <Skeleton width="90%" />
          <Skeleton width="75%" />
          <Skeleton width="55%" />
        </Card>
      ))}
    </div>
  );
}
