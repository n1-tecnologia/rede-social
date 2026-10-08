import { chipBase, cn } from '@rede-social/ui';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The Loja poster (UI-D-368): the prototype's course card and the shipped `EventPoster` language,
 * a 4:5 box with the name and the price over a veil, and at most one pill at the top left.
 *
 * Presentational and props-only: it fetches nothing, formats no price, resolves no URL and **ships
 * no words** (PWA-03). The host passes `href`, the accessible name, the name, the already-formatted
 * price ("R$ 19,90" from `formatBrl`, or the catalog's "Grátis") and the pill's label. The image is
 * a slot: the host builds the `MediaImage` (`cover` ladder, `sizes`), so this module stays free of
 * app-tier code. A plain `<a>`, never `next/link`: a module must not depend on the framework
 * (MOD-02).
 *
 * **Two branches, one bottom block.** With an image: the slot under the
 * `from-black/80 via-black/25` veil, white ink. Without: the `--brand-gradient` block in the
 * persisted `--brand-on-primary` ink (D-69 / UI-D-35), never `text-white` on a tenant hex. The
 * bottom block is drawn from ONE definition so the branches never drift.
 *
 * **Never drawn:** grayscale, a centred padlock or a "Premium" pill. Products are never locked;
 * only communities are (D-357). Truncation is CSS only (`line-clamp-2`), so a multi-byte grapheme
 * is never split and the 4:5 box never reflows.
 */
export interface ProductCardPill {
  /** `owned` carries a leading check; `archived` is bare. The host picks one by priority. */
  kind: 'owned' | 'archived';
  label: string;
}

export interface ProductCardProps {
  /** Built by the HOST (`/loja/{id}`), never assembled inside the module. */
  href: string;
  /** The whole card's accessible name, composed by the host ("{product}, {price}"). */
  ariaLabel: string;
  name: string;
  /** Already formatted by the host: `formatBrl(cents)` or the catalog word for zero. */
  priceLabel: string;
  /** The host's `MediaImage` (object-cover, filling the box); absent takes the gradient branch. */
  imageSlot?: ReactNode;
  pill?: ProductCardPill;
}

/** The over-media pill: the `StatusPill` geometry on the events `participated` ground. */
const PILL = cn(chipBase, 'bg-black/60 text-white backdrop-blur-sm');

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function ProductCard({
  href,
  ariaLabel,
  name,
  priceLabel,
  imageSlot,
  pill,
}: ProductCardProps) {
  const onImage = imageSlot !== undefined && imageSlot !== null;

  const bottom = (
    <span className="absolute inset-x-3 bottom-3 block">
      <span
        data-testid="product-card-name"
        className={cn('line-clamp-2 text-sm font-bold leading-tight', onImage && 'text-white')}
      >
        {name}
      </span>
      <span
        data-testid="product-card-price"
        className={cn(
          'mt-1 block whitespace-nowrap text-xs font-bold tabular-nums',
          onImage ? 'text-white/80' : 'opacity-80',
        )}
      >
        {priceLabel}
      </span>
    </span>
  );

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid="product-card"
      className={cn('block rounded-xl transition-opacity active:opacity-80', FOCUS)}
    >
      <span
        data-testid={onImage ? 'product-card-image' : 'product-card-fallback'}
        className="relative block aspect-[4/5] overflow-hidden rounded-xl bg-bg-tertiary"
        style={onImage ? undefined : { backgroundImage: 'var(--brand-gradient)' }}
      >
        {onImage ? (
          <>
            <span className="absolute inset-0 block">{imageSlot}</span>
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent"
            />
            {bottom}
          </>
        ) : (
          <span className="absolute inset-0 block" style={{ color: 'var(--brand-on-primary)' }}>
            {bottom}
          </span>
        )}
        {pill ? (
          <span className="absolute top-3 left-3 z-10">
            <span data-testid="product-card-pill" data-kind={pill.kind} className={PILL}>
              {pill.kind === 'owned' ? <Check size={12} strokeWidth={3} aria-hidden /> : null}
              {pill.label}
            </span>
          </span>
        ) : null}
      </span>
    </a>
  );
}
