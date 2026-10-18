import { Skeleton } from '@rede-social/ui';

const TILES = ['a', 'b', 'c', 'd'] as const;

/**
 * "Sua atividade" while it streams (08.7-03, UI-D-482): the section's title and "Últimos 7 dias"
 * render at once above it; the body is one full-width 192px block and a two-column grid of four
 * 96px tiles, `aria-busy`. No freshness line while it loads.
 */
export function ActivitySkeleton() {
  return (
    <div data-activity-skeleton aria-busy className="flex flex-col gap-6 px-4">
      <Skeleton variant="rect" className="h-48 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3">
        {TILES.map((tile) => (
          <Skeleton key={tile} variant="rect" className="h-24 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
