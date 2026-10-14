'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { BottomSheet, Button } from '@rede-social/ui';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CourseFormProduct } from '@/lib/courses-view';

/**
 * The course form's product multi-select (08.3-07, D-404, UI-D-393): the `CommunityPickerSheet`
 * posture — a `BottomSheet` of 44px checklist rows (a 40×50 thumb, the name truncating, a `Check`
 * 20 on an included row) with a sticky "Concluir" footer — over the STORE's products, composed
 * HERE in the app tier. The courses module never imports the store (D-405): the rows arrive from
 * the page, which read `getProducts` only while the store is on and the admin holds
 * `store.product.manage`.
 *
 * One tap toggles: the whole row is the control (`aria-label` "{product}, incluído" / "{product},
 * não incluído"), never the glyph at its end. The empty case is the form's: with zero products the
 * sheet lists nothing and the "Escolher produtos" button is the only thing that opened it.
 */
export interface ProductPickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** The tenant's ACTIVE products, in the store's order. */
  products: readonly CourseFormProduct[];
  /** The ids currently selected (the saved links plus the admin's edits). */
  selected: readonly string[];
  onToggle: (id: string) => void;
}

/** The 40×50 thumb (the store's poster ratio at row size); one rung is enough. */
const THUMB_SIZES = '40px';

const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The gradient a product without an image (or a failed one) falls back to (D-69). */
const GRADIENT = (
  <span
    aria-hidden
    className="block h-full w-full"
    style={{ backgroundImage: 'var(--brand-gradient)' }}
  />
);

/** The 40×50 product thumb: the image, or the brand gradient (also when the image fails). */
export function ProductThumb({ product }: { product: CourseFormProduct }) {
  return (
    <span
      aria-hidden
      data-course-product-thumb
      className="relative block h-[50px] w-10 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary"
    >
      {product.imageAssetId === null ? (
        GRADIENT
      ) : (
        <MediaImage
          assetId={product.imageAssetId}
          widths={PURPOSE_WIDTHS.cover}
          alt=""
          sizes={THUMB_SIZES}
          ratio=""
          className="h-full w-full"
          fallback={GRADIENT}
        />
      )}
    </span>
  );
}

export function ProductPickerSheet({
  open,
  onClose,
  products,
  selected,
  onToggle,
}: ProductPickerSheetProps) {
  const t = useTranslations('courses');
  return (
    <BottomSheet open={open} onClose={onClose} title={t('form.productPicker.title')}>
      <p className="pb-2 text-xs font-normal text-text-tertiary">
        {t('form.productPicker.helper')}
      </p>
      <ul className="flex flex-col" data-course-product-picker>
        {products.map((product) => {
          const on = selected.includes(product.id);
          return (
            <li key={product.id}>
              <button
                type="button"
                aria-label={
                  on
                    ? t('form.productPicker.rowOn', { product: product.name })
                    : t('form.productPicker.rowOff', { product: product.name })
                }
                aria-pressed={on}
                data-course-picker-product={product.id}
                onClick={() => onToggle(product.id)}
                className={ROW}
              >
                <ProductThumb product={product} />
                <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">
                  {product.name}
                </span>
                <span className="shrink-0">
                  {on ? (
                    <Check aria-hidden size={20} strokeWidth={2.5} className="text-brand" />
                  ) : (
                    <span aria-hidden className="block h-5 w-5" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {/* Pinned to the panel's real bottom edge over the body's 16px padding (the picker footer rule). */}
      <div
        data-picker-footer
        className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-2 bg-bg-secondary px-4 pt-3 pb-4"
      >
        <Button
          type="button"
          variant="secondary"
          size="md"
          fullWidth
          data-course-picker-done
          onClick={onClose}
        >
          {t('form.productPicker.done')}
        </Button>
      </div>
    </BottomSheet>
  );
}
