'use client';

import { BottomSheet, cn } from '@rede-social/ui';
import { Check, Tag } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The single-select category sheet of the course form (08.3-07, D-411, UI-D-393): a `BottomSheet`
 * over a `role="radiogroup"` list — "Sem categoria" first, then the tenant's categories with their
 * 3:4 thumb — where the selected row carries a `Check` 20 in brand ink, the sheet's ONLY brand ink
 * (UI-D-206).
 *
 * Presentational and props-only (PWA-03, MOD-02): it fetches nothing, resolves no route and ships
 * NO words. The host passes the title, the helper, the "Sem categoria" label and every row's name;
 * the thumb arrives as the host's `MediaImage` node (an absent thumb takes the tenant gradient,
 * D-69). Choosing a row hands back its id, or `null` for the none row, and the host closes the
 * sheet. Focus: the shipped `BottomSheet` moves focus to the first option on open (the none row)
 * and returns it to the opener on close (UI-D-407).
 *
 * Rows are `<button role="radio" aria-checked>`: one tap selects, so the whole 44px row is the
 * control and the glyph at its end never has to be aimed at.
 */
export interface CategoryPickerItem {
  id: string;
  name: string;
  /** The host's 3:4 thumb (`MediaImage`); absent takes the gradient branch. */
  thumb?: ReactNode;
}

export interface CategoryPickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's heading ("Categoria"). */
  title: string;
  /** Optional line under the heading ("Toque para escolher."). */
  helper?: string;
  /** The tenant's categories, in the host's (the API's) order. */
  items: readonly CategoryPickerItem[];
  /** The selected category id, or `null` for "Sem categoria". */
  selectedId: string | null;
  /** The none row's label ("Sem categoria"). */
  noneLabel: string;
  /** Fires with the chosen id, or `null` for the none row. */
  onSelect: (id: string | null) => void;
}

const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The 3:4 thumb slot of every row: 32px wide, `rounded-lg`, on `bg-bg-tertiary`. */
const THUMB = 'relative block w-8 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary aspect-[3/4]';

function Trailing({ selected }: { selected: boolean }) {
  return selected ? (
    <Check
      aria-hidden
      size={20}
      strokeWidth={2.5}
      data-testid="category-picker-check"
      className="shrink-0 text-brand"
    />
  ) : (
    <span aria-hidden className="block h-5 w-5 shrink-0" />
  );
}

export function CategoryPickerSheet({
  open,
  onClose,
  title,
  helper,
  items,
  selectedId,
  noneLabel,
  onSelect,
}: CategoryPickerSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {helper ? <p className="pb-2 text-xs font-normal text-text-tertiary">{helper}</p> : null}
      <div role="radiogroup" aria-label={title} className="flex flex-col">
        {/* The none row comes FIRST (UI-D-393): a course with no category is the common case. */}
        {/* biome-ignore lint/a11y/useSemanticElements: UI-D-393 / UI-D-206 fix a 44px row BUTTON that selects on one tap and closes the sheet; a native radio input needs a form, a legend and a separate submit */}
        <button
          type="button"
          role="radio"
          aria-checked={selectedId === null}
          data-testid="category-picker-none"
          onClick={() => onSelect(null)}
          className={ROW}
        >
          <span className={cn(THUMB, 'flex items-center justify-center')}>
            <Tag aria-hidden size={16} className="text-text-tertiary" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">{noneLabel}</span>
          <Trailing selected={selectedId === null} />
        </button>
        {items.map((item) => {
          const selected = item.id === selectedId;
          const hasThumb = item.thumb !== undefined && item.thumb !== null;
          return (
            // biome-ignore lint/a11y/useSemanticElements: UI-D-393 / UI-D-206 fix a 44px row BUTTON that selects on one tap and closes the sheet; a native radio input needs a form, a legend and a separate submit
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid="category-picker-row"
              data-category-id={item.id}
              onClick={() => onSelect(item.id)}
              className={ROW}
            >
              <span
                className={THUMB}
                data-testid={hasThumb ? 'category-picker-thumb' : 'category-picker-fallback'}
                style={hasThumb ? undefined : { backgroundImage: 'var(--brand-gradient)' }}
              >
                {hasThumb ? <span className="absolute inset-0 block">{item.thumb}</span> : null}
              </span>
              {/* The only flexible child: a long name truncates, the thumb and the check keep their size. */}
              <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">
                {item.name}
              </span>
              <Trailing selected={selected} />
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
