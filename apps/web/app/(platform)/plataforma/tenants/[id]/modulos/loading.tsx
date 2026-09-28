import { Card, Skeleton } from '@rede-social/ui';

/** Módulos tab loading (E15/loading): six switch-row skeletons (name, description, track) + helper. */
export default function TenantModulesLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton variant="text" width={64} className="h-3" />
      <Card className="flex flex-col">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex min-h-14 items-center gap-3 border-b border-divider px-4 py-2 last:border-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton variant="text" width="30%" className="h-3.5" />
              <Skeleton variant="text" width="60%" className="h-3" />
            </div>
            <Skeleton variant="text" width={64} className="h-6 rounded-full" />
            <Skeleton variant="rect" className="h-6 w-11 rounded-full" />
          </div>
        ))}
        <div className="px-4 py-3">
          <Skeleton variant="text" width="55%" className="h-3" />
        </div>
      </Card>
    </div>
  );
}
