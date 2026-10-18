import { KpiGrid } from '@rede-social/module-dashboard/ui';
import { cn, Skeleton } from '@rede-social/ui';
import { SPAN_ALL } from './ownerGrid';

const TILES = ['a', 'b', 'c', 'd'] as const;

/**
 * The owner area's loading shape (08.7-01, UI-D-482): a `KpiGrid` of four 96px tiles and one
 * full-width 192px block, `aria-busy`, while the area streams in its own `Suspense`. The header and
 * the area row render at once above it; no freshness line renders while it loads.
 */
export function OwnerAreaSkeleton() {
  return (
    <div data-owner-area-skeleton aria-busy className={cn(SPAN_ALL, 'flex flex-col gap-6')}>
      <KpiGrid>
        {TILES.map((tile) => (
          <Skeleton key={tile} variant="rect" className="h-24 rounded-2xl" />
        ))}
      </KpiGrid>
      <Skeleton variant="rect" className="h-48 rounded-2xl" />
    </div>
  );
}
