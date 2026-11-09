import { cn } from '@rede-social/ui';
import { ArrowRight, Check, CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The Loja's product tile (UI-D-368).
 *
 * Presentational and props-only: it fetches nothing, formats no price, resolves no URL and **ships
 * no words** (PWA-03). The host passes `href`, the accessible name, the name, the already-formatted
 * price ("R$ 19,90" from `formatBrl`, or the catalog's "Grátis"), the category and the pill's label.
 * The image is a slot: the host builds the `MediaImage` (`cover` ladder, `sizes`), so this module
 * stays free of app-tier code. A plain `<a>`, never `next/link`: a module must not depend on the
 * framework (MOD-02).
 *
 * **2026-10-27, "Vitrine de loja"** (the product owner: "repense como é o card do produto em relação
 * a design e posição dos itens"; four directions built and judged, this one picked and refined with
 * the judges' grafts). A retail tile: ONE light card (the member skin's glass, `ms-card ms-panel`)
 * that holds the product on a stage and its words under it, inside the same surface: never loose
 * text under a photo, never a boxed card with a "Comprar" button.
 *
 *  - **the stage:** the 4:5 image whole, inset in its own frame, concentric with the card's corner,
 *    the brand's light under it (stronger on hover and focus) and a little zoom of the skin
 *    (`ms-zoom`). No image: the brand gradient with the name's initial, large and faint;
 *  - **the category** ("Livro", "Roupa"), when the host gives one (the mixed lists: the hero, the
 *    search, "Você também pode gostar"; a category's shelf and page leave it out, their title says
 *    it): a small eyebrow in the secondary ink after a short brand dash, so any tenant colour holds;
 *  - **the name and the price, together at the foot** (`mt-auto`): a row of cards stretched to one
 *    height lines its prices up, and the room a shorter name leaves falls above the name, never
 *    between the name and its price. The price is the card's largest text, on one line;
 *  - **the arrow** (→, `aria-hidden`, not a button: the whole tile is the one link): a ring at rest,
 *    filled with the brand on hover and keyboard focus, its arrow stepping forward (with motion
 *    allowed). It steps out below 150px; a price too wide to share its row pushes it to a row of its
 *    own at the right, so the price is never cut;
 *  - **the state** ("Comprado", "Arquivado", the manager's "Sem link de pagamento") on the stage's
 *    corner: a dark glass with the colour in a small disc around its glyph (a white word on the bare
 *    success or warning ground did not reach the contrast floor), last in the DOM so the tile reads
 *    category, name, price, state.
 *
 * The sizes follow the TILE's width: the root is a `@container` box and the link reads it (138px on
 * a 320px phone, 170px in a phone grid, 240px in a phone shelf, 260 to 340px on a desktop), the
 * card's corner included (16px, 24px from 260px). The member skin (inert outside
 * `[data-member-skin]`) adds the glass, the ring, the sheen and the 3px lift for a fine pointer.
 *
 * **Never drawn:** grayscale, a centred padlock or a "Premium" pill. Products are never locked;
 * only communities are (D-357). Truncation is CSS only (`line-clamp-2`, `truncate`), so a
 * multi-byte grapheme is never split and the 4:5 box never reflows.
 */
export interface ProductCardPill {
  /**
   * `owned` carries a check in a success disc; `archived` is bare; `noLink` (09.1-17, UI-D-525,
   * UI-D-520) carries a `CircleAlert` in a warning disc, so the manager-only "no payment link" state
   * is never colour alone. The host picks one by priority (archived, then owned, then noLink).
   */
  kind: 'owned' | 'archived' | 'noLink';
  label: string;
}

export interface ProductCardProps {
  /** Built by the HOST (`/loja/{id}`), never assembled inside the module. */
  href: string;
  /** The whole tile's accessible name, composed by the host ("{product}, {price}"). */
  ariaLabel: string;
  name: string;
  /** Already formatted by the host: `formatBrl(cents)` or the catalog word for zero. */
  priceLabel: string;
  /** The host's `MediaImage` (object-cover, filling the box); absent takes the gradient branch. */
  imageSlot?: ReactNode;
  pill?: ProductCardPill;
  /** The kind of item ("Livro", "Roupa"): the eyebrow over the name. Absent, the name leads. */
  tag?: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The skin's curve (member-skin.css `--ms-ease`), for the motions the tile runs itself. */
const EASE = 'ease-[cubic-bezier(0.23,1,0.32,1)]';

/**
 * The stage: 4:5, its corner the card's minus the inset and the hairline (16 - 5 - 1, 16 - 6 - 1,
 * 24 - 8 - 1), the brand's light under it and a step up on hover. `--glow` is a brand mix, so no
 * tenant colour is written here.
 */
const STAGE = cn(
  'relative block aspect-[4/5] overflow-hidden rounded-[10px] bg-bg-tertiary',
  '[--glow:color-mix(in_oklab,var(--brand-accent)_38%,transparent)] shadow-[0_10px_22px_-14px_var(--glow)]',
  'transition-[box-shadow,translate] duration-300 motion-safe:group-hover:-translate-y-0.5',
  'group-hover:[--glow:color-mix(in_oklab,var(--brand-accent)_62%,transparent)]',
  'group-focus-visible:[--glow:color-mix(in_oklab,var(--brand-accent)_62%,transparent)]',
  '@min-[200px]:rounded-[9px] @min-[260px]:rounded-[15px] @min-[260px]:shadow-[0_16px_30px_-18px_var(--glow)]',
  EASE,
);

/** The state's glass: dark enough for its white word on any picture. */
const PILL =
  'inline-flex min-w-0 items-center gap-1.5 rounded-full bg-black/65 py-1 pr-2.5 text-[9.5px] leading-3 font-bold uppercase tracking-[0.06em] text-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] ring-1 ring-white/15 ring-inset backdrop-blur-sm @min-[200px]:text-[10px]';

/** The glyph's disc, the state's colour. */
const PILL_DISC = {
  owned: 'bg-success',
  noLink: 'bg-warning',
} as const;

export function ProductCard({
  href,
  ariaLabel,
  name,
  priceLabel,
  imageSlot,
  pill,
  tag,
}: ProductCardProps) {
  const onImage = imageSlot !== undefined && imageSlot !== null;
  // The no-image stage's monogram: the name's first letter, drawn by CSS (no word of its own).
  const initial = name.trim().charAt(0).toLocaleUpperCase('pt-BR');

  return (
    <div className="@container h-full">
      <a
        href={href}
        aria-label={ariaLabel}
        data-testid="product-card"
        className={cn(
          'ms-card ms-panel group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(22,35,59,0.06),0_8px_22px_-12px_rgba(22,35,59,0.14)] transition-opacity active:opacity-90 @min-[260px]:rounded-3xl',
          FOCUS,
        )}
      >
        <span className="flex flex-1 flex-col p-[5px] @min-[200px]:p-1.5 @min-[260px]:p-2">
          <span
            data-testid={onImage ? 'product-card-image' : 'product-card-fallback'}
            data-initial={onImage ? undefined : initial}
            className={cn(
              STAGE,
              !onImage &&
                'before:absolute before:inset-0 before:flex before:items-center before:justify-center before:text-[38cqw] before:leading-none before:font-extralight before:text-white/30 before:content-[attr(data-initial)]',
            )}
            style={onImage ? undefined : { backgroundImage: 'var(--brand-gradient)' }}
          >
            {onImage ? <span className="ms-zoom absolute inset-0 block">{imageSlot}</span> : null}
            {/* The frame's edge: a hairline that holds a white packshot, a light that holds the dark art. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 block rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.16)]"
            />
          </span>

          <span className="flex flex-1 flex-col px-1.5 pt-2.5 pb-1.5 @min-[200px]:px-2 @min-[200px]:pt-3 @min-[200px]:pb-2 @min-[260px]:px-2.5 @min-[260px]:pt-3.5 @min-[260px]:pb-2.5">
            {tag ? (
              <span
                data-testid="product-card-tag"
                className="flex min-w-0 items-center gap-1.5 text-[9.5px] leading-[14px] font-semibold uppercase tracking-[0.14em] text-text-secondary @min-[200px]:text-[10px] @min-[260px]:text-[10.5px]"
              >
                <span aria-hidden className="h-px w-3 shrink-0 bg-brand" />
                <span className="min-w-0 truncate">{tag}</span>
              </span>
            ) : null}
            {/* Together at the foot: a row of stretched cards lines its prices up. */}
            <span className="mt-auto flex flex-col gap-1.5 pt-1.5 @min-[200px]:gap-2 @min-[200px]:pt-2">
              {/* No `block` beside `line-clamp-2`: the display utility would win over the clamp's
                  `-webkit-box` and paint every line of a long name. The long `text-wrap-style`
                  only: the `text-wrap` shorthand would reset the wrapping the clamp needs. */}
              <span
                data-testid="product-card-name"
                className="ms-title-font line-clamp-2 text-[13px] leading-[18px] font-medium tracking-[-0.01em] text-text [overflow-wrap:anywhere] [text-wrap-style:pretty] @min-[190px]:[text-wrap-style:balance] @min-[200px]:text-[15px] @min-[200px]:leading-5 @min-[260px]:text-base @min-[260px]:leading-[22px]"
              >
                {name}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span
                  data-testid="product-card-price"
                  className="whitespace-nowrap text-[15px] leading-6 font-extrabold tracking-[-0.02em] tabular-nums text-text @min-[165px]:text-[17px] @min-[200px]:text-[19px] @min-[200px]:leading-8 @min-[260px]:text-[22px] @min-[260px]:leading-9"
                >
                  {priceLabel}
                </span>
                <span
                  aria-hidden
                  data-testid="product-card-go"
                  className="ml-auto hidden size-7 shrink-0 items-center justify-center rounded-full text-brand ring-1 ring-brand/30 ring-inset transition-colors duration-200 group-hover:bg-brand group-hover:text-on-brand group-hover:ring-brand group-focus-visible:bg-brand group-focus-visible:text-on-brand group-focus-visible:ring-brand @min-[150px]:inline-flex @min-[200px]:size-8 @min-[260px]:size-9"
                >
                  <ArrowRight
                    aria-hidden
                    strokeWidth={2.25}
                    className={cn(
                      'size-3.5 shrink-0 transition-transform duration-300 motion-safe:group-hover:translate-x-0.5 motion-safe:group-focus-visible:translate-x-0.5 @min-[260px]:size-4',
                      EASE,
                    )}
                  />
                </span>
              </span>
            </span>
          </span>
        </span>

        {pill ? (
          <span className="pointer-events-none absolute top-[11px] right-[11px] left-[11px] z-10 flex @min-[200px]:top-3.5 @min-[200px]:right-3.5 @min-[200px]:left-3.5 @min-[260px]:top-[18px] @min-[260px]:right-[18px] @min-[260px]:left-[18px]">
            <span
              data-testid="product-card-pill"
              data-kind={pill.kind}
              className={cn(PILL, pill.kind === 'archived' ? 'pl-2.5' : 'pl-1')}
            >
              {pill.kind === 'archived' ? null : (
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full',
                    PILL_DISC[pill.kind],
                  )}
                >
                  {pill.kind === 'owned' ? (
                    <Check size={10} strokeWidth={3} className="shrink-0" />
                  ) : (
                    <CircleAlert size={10} strokeWidth={2.5} className="shrink-0" />
                  )}
                </span>
              )}
              <span className="min-w-0 truncate">{pill.label}</span>
            </span>
          </span>
        ) : null}
      </a>
    </div>
  );
}
