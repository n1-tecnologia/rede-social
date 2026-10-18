import { cn } from '@rede-social/ui';
import { History } from 'lucide-react';
import { SPAN_ALL } from './ownerGrid';

/**
 * The freshness line (08.7-01, UI-D-468, D-464): one per screen, directly under the owner panel's
 * area row and above the area's first block, spanning the whole area grid. 12px/400 tertiary text
 * with a 14px `History` glyph, top-aligned so a wrapped `past` form keeps the glyph on its first
 * line. The text is decided by the caller (`freshnessText` + the catalog); the line is absent while
 * loading, while preparing and on error — the caller simply does not render it then.
 */
export function SnapshotFreshness({ text, className }: { text: string; className?: string }) {
  return (
    <p
      data-snapshot-freshness
      className={cn(
        SPAN_ALL,
        'flex items-start gap-1 text-xs font-normal leading-normal text-text-tertiary',
        className,
      )}
    >
      <History aria-hidden size={14} className="mt-px shrink-0" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}
