import { cn } from '@rede-social/ui';
import { ArrowUpDown, ChevronLeft, SearchX } from 'lucide-react';
import type { StoreCategoryTileView, StoreListingView } from '@/lib/store-front-view';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from '../cursos/MemberEmptyCard';
import { riseStyle } from '../cursos/rise';
import { StoreProductCard } from './StoreFront';
import { BACK_ROW_LINK, STORE_COLUMNS } from './store-styles';

const CHIP =
  'inline-flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
const CHIP_IDLE =
  'ms-chip-surface border border-border bg-card text-text-secondary hover:text-text';
const CHIP_ON = 'bg-brand text-on-brand';

/** "‹ Loja": a category's page and the search back to the storefront. */
export function StoreBackLink({ label, ariaLabel }: { label: string; ariaLabel: string }) {
  return (
    <a href="/loja" aria-label={ariaLabel} data-testid="store-back" className={BACK_ROW_LINK}>
      <ChevronLeft aria-hidden size={18} />
      <span>{label}</span>
    </a>
  );
}

/**
 * A category's page (`?categoria=`) or the search (`?busca=`): the categories as chips ("Tudo" back
 * to the storefront, the page's own marked), how many, the three orders, then the products as the
 * storefront's big cards, two a row on a phone and up to four in the wide frame.
 */
export function StoreListing({
  view,
  chips,
  labels,
  empty,
  showTags = false,
}: {
  view: StoreListingView;
  /** The search mixes categories, so its cards show theirs; a category's page does not repeat it. */
  showTags?: boolean;
  chips: StoreCategoryTileView[];
  labels: { all: string; categories: string; sort: string };
  empty: { title: string; body: string };
}) {
  return (
    <div data-testid="store-listing" className="flex flex-col gap-5 pt-2 pb-10">
      {chips.length > 0 ? (
        <nav aria-label={labels.categories} className="@container">
          <ul className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            <li className="shrink-0">
              <a href="/loja" className={cn(CHIP, CHIP_IDLE)}>
                {labels.all}
              </a>
            </li>
            {chips.map((chip) => (
              <li key={chip.key} className="shrink-0">
                <a
                  href={chip.href}
                  aria-current={chip.active ? 'page' : undefined}
                  data-testid="store-listing-chip"
                  className={cn(CHIP, chip.active ? CHIP_ON : CHIP_IDLE)}
                >
                  {chip.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4">
        <p
          data-testid="store-listing-count"
          className="text-sm font-normal text-text-secondary tabular-nums"
        >
          {view.sub}
        </p>
        {view.items.length > 1 ? (
          <nav aria-label={labels.sort} className="flex items-center gap-2">
            <ArrowUpDown aria-hidden size={14} className="shrink-0 text-text-tertiary" />
            <ul className="flex flex-wrap gap-1.5">
              {view.sorts.map((sort) => (
                <li key={sort.key}>
                  <a
                    href={sort.href}
                    aria-current={sort.active ? 'true' : undefined}
                    data-testid="store-listing-sort"
                    className={cn(
                      'inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                      sort.active
                        ? 'bg-brand/12 text-brand ring-1 ring-brand/25'
                        : 'text-text-secondary hover:text-text',
                    )}
                  >
                    {sort.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>

      {view.items.length > 0 ? (
        <div className="@container px-4">
          <ul className={cn('grid grid-cols-2 gap-3 @min-[576px]:grid-cols-3 @min-[576px]:gap-4', STORE_COLUMNS)}>
            {view.items.map((item, index) => (
              <li key={item.id} className="ms-rise min-w-0" style={riseStyle(index)}>
                <StoreProductCard item={item} eager={index < 4} showTag={showTags} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <MemberEmptyCard
          icon={SearchX}
          data-testid="store-listing-empty"
          className={cn('mx-4', MEMBER_EMPTY_WIDE)}
          title={empty.title}
          body={empty.body}
        />
      )}
    </div>
  );
}
