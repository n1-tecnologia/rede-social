import { chipBase, cn } from '@rede-social/ui';
import { Lock } from 'lucide-react';

/**
 * The over-media "Exclusiva" pill (UI-D-372): the `chipBase` geometry on the over-media ground
 * (`bg-black/60 text-white backdrop-blur-sm`, the `ProductCard` pill's ground), a leading `Lock` 12.
 * It sits on a community card's cover through `CommunityCard`'s `coverBadge` slot, so it stays
 * legible on a photograph and on the brand gradient alike.
 *
 * Props only and no words of its own (PWA-03): the host passes the catalog's label. The glyph is
 * `aria-hidden`; the text is read inside the card's single link (UI-D-386), so the pill adds no
 * focus stop. The header variant on the community page is a plain `StatusPill`, not this.
 */
export interface ExclusiveBadgeProps {
  label: string;
}

export function ExclusiveBadge({ label }: ExclusiveBadgeProps) {
  return (
    <span
      data-testid="exclusive-badge"
      className={cn(chipBase, 'bg-black/60 text-white backdrop-blur-sm')}
    >
      <Lock size={12} aria-hidden />
      {label}
    </span>
  );
}
