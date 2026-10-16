import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { CategoryTileView } from '@/lib/courses-member-view';
import { CoverGradient, HomeSectionHeader } from './HomeShelf';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * "Explore por categoria" (08.6-09, UI-D-455, COURSE-34), ported from the prototype's tiles
 * (`app/membros/page.tsx` § 8) at 112px and without the icon map (categories carry no icon): a
 * horizontal `<ul>` named by its heading, in the SERVER's `lower(name)` order, scrolling natively.
 * The host renders this only when the overview carries `categories`.
 *
 * Each tile is one 4:3 link to the 08.5 catalogue already filtered by that category: the 08.3
 * category cover (or the gradient) under the `from-black/75` veil, the name (`line-clamp-2`) and the
 * pluralised count at the bottom. Not accent (neutral ink over media). Every word arrives finished
 * from `categoryTileView` and renders as React text (UI-D-463, T-08.6-25).
 */
export function HomeCategories({ tiles, title }: { tiles: CategoryTileView[]; title: string }) {
  return (
    <section data-testid="courses-home-categories" className="flex flex-col">
      <HomeSectionHeader id="courses-home-categories-title" title={title} />
      <ul aria-label={title} className="flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-none">
        {tiles.map((tile) => (
          <li key={tile.id} className="shrink-0">
            <a
              href={tile.href}
              aria-label={tile.ariaLabel}
              data-testid="courses-home-category"
              className={`relative block aspect-[4/3] w-28 overflow-hidden rounded-xl bg-bg-tertiary transition-opacity active:opacity-80 ${FOCUS}`}
            >
              {tile.coverAssetId ? (
                <MediaImage
                  assetId={tile.coverAssetId}
                  widths={PURPOSE_WIDTHS.cover}
                  alt=""
                  sizes="112px"
                  ratio=""
                  className="absolute inset-0 h-full w-full"
                  fallback={<CoverGradient />}
                />
              ) : (
                <CoverGradient />
              )}
              <span
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent"
              />
              <span className="absolute right-2 bottom-2 left-2 block">
                <span
                  data-testid="courses-home-category-name"
                  className="line-clamp-2 break-words text-xs font-bold leading-tight text-white"
                >
                  {tile.name}
                </span>
                <span
                  data-testid="courses-home-category-count"
                  className="block text-xs font-normal text-white/80 tabular-nums"
                >
                  {tile.count}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
