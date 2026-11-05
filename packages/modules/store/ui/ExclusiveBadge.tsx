import { chipBase, cn } from '@rede-social/ui';
import { Lock } from 'lucide-react';

/**
 * The over-media "Exclusiva" pill (UI-D-372): the `chipBase` geometry on the over-media ground
 * (`bg-black/60 text-white backdrop-blur-sm`, the `ProductCard` pill's ground), a leading `Lock` 12.
 * It sits on a community card's cover through `CommunityCard`'s `coverBadge` slot, so it stays
 * legible on a photograph and on the brand gradient alike.
 *
 * **2026-10-22 (`size="compact"`, the courses area redesign on the social-igoralves prototype).**
 * The school's posters, live cards and course hero carry the prototype's small glass chips (9px,
 * uppercase, `bg-black/55`); the compact badge is that chip with a `Lock` 10, so the store's word sits
 * in the same family as the category beside it. Without `size` it renders exactly as before.
 *
 * Props only and no words of its own (PWA-03): the host passes the catalog's label. The glyph is
 * `aria-hidden`; the text is read inside the card's single link (UI-D-386), so the pill adds no
 * focus stop. The header variant on the community page is a plain `StatusPill`, not this.
 */
export interface ExclusiveBadgeProps {
  label: string;
  /** `compact`: the school's 9px glass chip. Default: the shipped `chipBase` pill. */
  size?: 'default' | 'compact';
}

const COMPACT =
  'inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-sm';

export function ExclusiveBadge({ label, size = 'default' }: ExclusiveBadgeProps) {
  if (size === 'compact') {
    return (
      <span data-testid="exclusive-badge" data-size="compact" className={COMPACT}>
        <Lock size={10} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </span>
    );
  }
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
