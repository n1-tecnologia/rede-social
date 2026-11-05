import { cn, Skeleton, StatusPill } from '@rede-social/ui';
import { Archive, Check, ChevronRight, CircleAlert } from 'lucide-react';
import type { ProductCardProps } from './ProductCard';

/**
 * 2026-10-24 — one product as a management ROW (the Loja's "Gerenciar", the courses admin lists'
 * `ListRow` look): the 48px 4:5 thumb on `bg-bg-tertiary` (the tenant gradient when there is no
 * image, D-69), the name 15/700 clamped to two lines, the price under it in 12 tertiary, the one pill
 * under the price as a `StatusPill` with its glyph (never colour alone) and `ChevronRight` 18. The
 * host draws the outlined card around the rows, so the hover is the card's `bg-card-hover`.
 *
 * The SAME view as the poster (`ProductCardProps`): the host builds one `ProductCardView` per product
 * and draws it as a card or a row. Props only and no words (PWA-03); a plain `<a>` (MOD-02). Below
 * 360px the chevron is not drawn, so the name keeps whole words.
 */
export type ProductRowProps = ProductCardProps;

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

/** The pill's tone by kind: the archived state is neutral, a missing link a warning. */
const PILL_TONE = { owned: 'success', archived: 'neutral', noLink: 'warning' } as const;

const PILL_ICON = { owned: Check, archived: Archive, noLink: CircleAlert } as const;

export function ProductRow({
  href,
  ariaLabel,
  name,
  priceLabel,
  imageSlot,
  pill,
}: ProductRowProps) {
  const onImage = imageSlot !== undefined && imageSlot !== null;
  const Icon = pill ? PILL_ICON[pill.kind] : null;

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid="product-row"
      className={cn(
        'flex min-h-14 w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-card-hover active:bg-bg-active',
        FOCUS,
      )}
    >
      <span
        data-testid={onImage ? 'product-row-thumb' : 'product-row-fallback'}
        className="relative block aspect-[4/5] w-12 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary"
        style={onImage ? undefined : { backgroundImage: 'var(--brand-gradient)' }}
      >
        {onImage ? <span className="absolute inset-0 block">{imageSlot}</span> : null}
      </span>
      <span className="min-w-0 flex-1">
        {/* No `block` beside `line-clamp-2` (the `ListRow` lesson). */}
        <span
          data-testid="product-row-name"
          className="line-clamp-2 text-[15px] font-bold leading-snug text-text [overflow-wrap:anywhere]"
        >
          {name}
        </span>
        <span
          data-testid="product-row-price"
          className="mt-0.5 block whitespace-nowrap text-xs font-normal text-text-tertiary tabular-nums"
        >
          {priceLabel}
        </span>
        {pill && Icon ? (
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            <StatusPill
              tone={PILL_TONE[pill.kind]}
              data-testid="product-row-pill"
              data-kind={pill.kind}
              className="shrink-0"
            >
              <Icon aria-hidden size={12} strokeWidth={pill.kind === 'owned' ? 3 : 2} />
              {pill.label}
            </StatusPill>
          </span>
        ) : null}
      </span>
      <ChevronRight
        aria-hidden
        size={18}
        className="hidden shrink-0 text-text-tertiary min-[360px]:block"
      />
    </a>
  );
}

/** One row placeholder in the row's own geometry (wordless, hidden from the tree). */
export function ProductRowSkeleton() {
  return (
    <div
      aria-hidden
      data-testid="product-row-skeleton"
      className="flex min-h-14 items-center gap-3 px-4 py-3"
    >
      <Skeleton variant="rect" className="aspect-[4/5] h-auto w-12 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="text" width="30%" className="h-3" />
      </div>
    </div>
  );
}
