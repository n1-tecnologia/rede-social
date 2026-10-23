import { BOOTSTRAP_STEP_KEYS } from '@rede-social/contracts/projects';
import { Card, Skeleton } from '@rede-social/ui';

const OVERVIEW_ROWS = ['project', 'schema', 'plan', 'shared'] as const;

/**
 * Banco tab loading (09.2-19, UI-D-544): three card skeletons in the tab's own geometry, never a
 * spinner-only page. Card 1 is the overview (a 14px bar for the title, a rounded-full bar and four
 * `dl` bar rows); card 2 the Preparação list (eight rows of a 20px disc and one bar); card 3 the
 * Credenciais card (two bars and a 36px button bar).
 */
export default function TenantDatabaseLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <Card className="flex flex-col gap-4 p-4 md:p-6">
        <Skeleton variant="text" width={96} className="h-3.5" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton variant="text" width={80} className="h-6 rounded-full" />
          <Skeleton variant="text" width={120} className="h-3" />
        </div>
        <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
          {OVERVIEW_ROWS.map((row) => (
            <div key={row} className="contents">
              <Skeleton variant="text" width="70%" className="h-3.5" />
              <Skeleton
                variant="text"
                width={row === 'project' ? '90%' : '45%'}
                className="h-3.5"
              />
            </div>
          ))}
        </div>
      </Card>
      <Card className="flex flex-col gap-4 p-4 md:p-6">
        <Skeleton variant="text" width={96} className="h-3.5" />
        <div className="flex flex-col gap-3">
          {BOOTSTRAP_STEP_KEYS.map((step, row) => (
            <div key={step} className="flex items-center gap-3">
              <Skeleton variant="circle" className="h-5 w-5" />
              <Skeleton variant="text" width={`${60 + ((row * 7) % 30)}%`} className="h-3.5" />
            </div>
          ))}
        </div>
      </Card>
      <Card className="flex flex-col gap-4 p-4 md:p-6">
        <Skeleton variant="text" width={96} className="h-3.5" />
        <Skeleton width="85%" className="h-3.5" />
        <Skeleton width="55%" className="h-3.5" />
        <Skeleton variant="rect" width={180} className="h-9 rounded-full" />
      </Card>
    </div>
  );
}
