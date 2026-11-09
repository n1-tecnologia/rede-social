import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { ProductCard } from '@rede-social/module-store/ui';
import { cn, SkinAmbient } from '@rede-social/ui';
import { ArrowRight, Check } from 'lucide-react';
import type {
  StoreCategoryTileView,
  StoreFrontView,
  StoreHeroView,
  StoreItemView,
  StoreShelfView,
} from '@/lib/store-front-view';
import { MemberSectionHeader } from '../cursos/MemberSection';
import { riseStyle } from '../cursos/rise';
import { STORE_CATEGORY_GLYPH } from './category-glyphs';
import { ROW_FIFTH, ROW_SIXTH, STORE_COLUMNS } from './store-styles';

/** A card in a shelf or a grid: about 60% of a phone, a quarter of the wide frame. */
export const STORE_CARD_SIZES = '(min-width: 1024px) 340px, (min-width: 640px) 40vw, 62vw';

/**
 * A one-row band's cards past the fourth: the fifth and the sixth join the row as it widens
 * (`STORE_COLUMNS`), the rest stay for the phone's scroll ("Ver tudo" opens them all).
 */
function rowOnly(index: number): string | false {
  if (index === 4) return ROW_FIFTH;
  if (index === 5) return ROW_SIXTH;
  return index > 5 && '@3xl:hidden';
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * A product on the storefront: the store's tile (`ProductCard`, the glass over the photo the
 * product owner picked) with the category's chip, its image through the media ladder.
 */
export function StoreProductCard({
  item,
  sizes = STORE_CARD_SIZES,
  eager = false,
  showTag = true,
}: {
  item: StoreItemView;
  sizes?: string;
  eager?: boolean;
  /** The category's eyebrow: only in a MIXED list (a category's shelf and page say it already). */
  showTag?: boolean;
}) {
  return (
    <ProductCard
      href={item.href}
      ariaLabel={item.ariaLabel}
      name={item.name}
      priceLabel={item.priceLabel}
      pill={item.pill}
      tag={showTag ? item.tag : undefined}
      imageSlot={
        item.imageAssetId ? (
          <MediaImage
            assetId={item.imageAssetId}
            widths={PURPOSE_WIDTHS.cover}
            alt={item.imageAlt}
            sizes={sizes}
            eager={eager}
            ratio=""
            className="h-full w-full"
          />
        ) : undefined
      }
    />
  );
}

/**
 * The hero's large card (the featured product): the 4:5 image at the left, at the right "Destaque
 * da loja", the category, the name, the price and "Ver produto", ONE link over the whole card.
 */
function StoreFeatureCard({
  item,
  eyebrow,
  cta,
}: {
  item: StoreItemView;
  eyebrow: string;
  cta: string;
}) {
  return (
    <a
      href={item.href}
      aria-label={item.ariaLabel}
      data-testid="store-hero-main"
      className={cn(
        'ms-card ms-panel group relative flex h-full overflow-hidden rounded-3xl border border-border bg-card',
        FOCUS,
      )}
    >
      <SkinAmbient />
      {/* Wider from the four-column row: the cards beside it are taller, and the 4:5 art keeps close
          to its shape instead of being cut at the sides. */}
      <span className="relative w-[46%] shrink-0 overflow-hidden bg-bg-tertiary @3xl:w-[55%]">
        {/* The 4:5 box sets the card's least height; the image fills a taller row too. */}
        <span aria-hidden className="block aspect-[4/5]" />
        {item.imageAssetId ? (
          <span className="ms-zoom absolute inset-0 block">
            <MediaImage
              assetId={item.imageAssetId}
              widths={PURPOSE_WIDTHS.cover}
              alt={item.imageAlt}
              sizes="(min-width: 1024px) 300px, 46vw"
              eager
              ratio=""
              className="h-full w-full"
            />
          </span>
        ) : (
          <span
            aria-hidden
            className="absolute inset-0 block"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        )}
        {item.pill?.kind === 'owned' ? (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-success px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
            <Check size={10} strokeWidth={3} aria-hidden className="shrink-0" />
            {item.pill.label}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-4 @3xl:gap-3 @3xl:p-7">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand @3xl:text-[11px]">
          {eyebrow}
        </span>
        {item.tag ? (
          <span className="ms-chip-brand w-fit rounded-full bg-brand/12 px-2.5 py-1 text-[11px] font-semibold text-brand">
            {item.tag}
          </span>
        ) : null}
        <span
          data-testid="store-hero-name"
          className="ms-title-font line-clamp-3 break-words text-lg font-semibold leading-snug tracking-tight text-text @3xl:text-[26px] @3xl:leading-tight"
        >
          {item.name}
        </span>
        <span className="whitespace-nowrap text-xl font-extrabold leading-none tracking-tight tabular-nums text-text @3xl:text-3xl">
          {item.priceLabel}
        </span>
        <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-on-brand transition-colors group-hover:bg-brand-hover @3xl:mt-2 @3xl:px-5 @3xl:py-2.5 @3xl:text-sm">
          {cta}
          <ArrowRight aria-hidden size={16} className="shrink-0" />
        </span>
      </span>
    </a>
  );
}

/**
 * "Em destaque": the featured product large (two columns) and the next two beside it, one row from
 * the wide frame; on a phone the large card across and the two under it.
 */
export function StoreHero({
  hero,
  labels,
}: {
  hero: StoreHeroView;
  labels: { title: string; eyebrow: string; cta: string };
}) {
  return (
    <section aria-labelledby="store-hero-title" data-testid="store-hero" className="flex flex-col">
      <MemberSectionHeader id="store-hero-title" title={labels.title} />
      <div className="@container px-4">
        <ul className={cn('grid grid-cols-2 gap-3 @3xl:gap-4', STORE_COLUMNS)}>
          <li className="ms-rise col-span-2 min-w-0" style={riseStyle(0)}>
            <StoreFeatureCard item={hero.main} eyebrow={labels.eyebrow} cta={labels.cta} />
          </li>
          {hero.side.map((item, index) => (
            <li
              key={item.id}
              // Two beside the large card; a third and a fourth as the row widens.
              className={cn(
                'ms-rise min-w-0',
                index === 2 && 'hidden @min-[1500px]:block',
                index === 3 && 'hidden @min-[1850px]:block',
              )}
              style={riseStyle(index + 1)}
            >
              <StoreProductCard item={item} eager />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * "Categorias": one tile per category of the store, products or not (its glyph, its name, how many;
 * 12.3-13, UI-D-690), a row that scrolls on a phone and fills the wide frame; the tile of the page
 * being shown is marked.
 */
export function StoreCategoryTiles({
  tiles,
  title,
}: {
  tiles: StoreCategoryTileView[];
  title: string;
}) {
  return (
    <section
      aria-labelledby="store-categories-title"
      data-testid="store-categories"
      className="flex flex-col"
    >
      <MemberSectionHeader id="store-categories-title" title={title} />
      <div className="@container">
        <ul className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-3 [scrollbar-width:none] @3xl:grid @3xl:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] @3xl:overflow-visible">
          {tiles.map((tile, index) => {
            const Icon = STORE_CATEGORY_GLYPH[tile.icon];
            return (
              <li
                key={tile.key}
                className="ms-rise w-36 shrink-0 snap-start @3xl:w-auto"
                style={riseStyle(index)}
              >
                <a
                  href={tile.href}
                  aria-label={tile.ariaLabel}
                  aria-current={tile.active ? 'page' : undefined}
                  data-testid="store-category-tile"
                  data-category={tile.key}
                  className={cn(
                    'ms-card ms-panel group flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-4',
                    tile.active && 'border-brand/50 ring-1 ring-brand/40',
                    FOCUS,
                  )}
                >
                  <span
                    aria-hidden
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/12 text-brand ring-1 ring-brand/20 transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none"
                  >
                    <Icon size={20} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold text-text">{tile.name}</span>
                    <span className="truncate text-xs font-normal text-text-tertiary tabular-nums">
                      {tile.count}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/**
 * A shelf: the category's name, how many, "Ver tudo" to its page, and its products, a row that
 * scrolls on a phone (big cards, the next one peeking) and one row of four in the wide frame.
 */
export function StoreShelf({
  shelf,
  showTags = false,
}: {
  shelf: StoreShelfView;
  /** A mixed shelf ("Você também pode gostar") shows each card's category; a category's does not. */
  showTags?: boolean;
}) {
  const id = `store-shelf-${shelf.key}`;
  return (
    <section
      aria-labelledby={id}
      data-testid="store-shelf"
      data-category={shelf.key}
      className="flex flex-col"
    >
      <MemberSectionHeader id={id} title={shelf.title} sub={shelf.sub} seeAll={shelf.seeAll} />
      <div className="@container">
        <ul
          className={cn(
            'flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-4 [scrollbar-width:none] @3xl:grid @3xl:gap-4 @3xl:overflow-visible',
            STORE_COLUMNS,
          )}
        >
          {shelf.items.map((item, index) => (
            <li
              key={item.id}
              className={cn(
                'ms-rise w-[62%] shrink-0 snap-start @md:w-[40%] @3xl:w-auto',
                rowOnly(index),
              )}
              style={riseStyle(index)}
            >
              <StoreProductCard item={item} showTag={showTags} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The storefront: the hero, the categories (when more than one) and a shelf per category with
 * products, from the API's front (`storeFrontView`); a store with no front or no category is the
 * plain grid instead (`StoreListing`), chosen by the screen.
 */
export function StoreFront({
  view,
  labels,
}: {
  view: StoreFrontView;
  labels: { hero: { title: string; eyebrow: string; cta: string }; categories: string };
}) {
  return (
    <div data-testid="store-front" className="flex flex-col gap-9 pt-2 pb-10 md:gap-12">
      {view.hero ? <StoreHero hero={view.hero} labels={labels.hero} /> : null}
      {view.categories.length > 1 ? (
        <StoreCategoryTiles tiles={view.categories} title={labels.categories} />
      ) : null}
      {view.shelves.map((shelf) => (
        <StoreShelf key={shelf.key} shelf={shelf} />
      ))}
    </div>
  );
}
