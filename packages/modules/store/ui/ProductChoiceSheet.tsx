'use client';

import { BottomSheet, useMediaQuery } from '@rede-social/ui';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The product-choice pop-up of a locked community page (UI-D-375, decision (9)): the shipped
 * `BottomSheet` (the centred card from `md`, focus on the title) listing the BUYABLE products only,
 * in the server's order. Each row is an `<a>` to the product page with `?comunidade=` (the host
 * builds the href): a 40×50 4:5 thumb (the host's image or gradient), the name 14/700 `truncate`,
 * the price 12/400 `tabular-nums` ("Grátis" at 0) and `ChevronRight` 18. Tapping navigates; the
 * product page owns the purchase, so a purchase is always confirmed on a screen that shows the
 * full description. Props only and no words of its own (PWA-03).
 */
export interface ProductChoiceItem {
  href: string;
  name: string;
  priceLabel: string;
  /** "{product}, {price}" from the host's catalog. */
  ariaLabel: string;
  /** The host's 4:5 image or the brand gradient, filling the 40×50 box. */
  thumb: ReactNode;
}

export interface ProductChoiceSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "Qualquer um destes produtos libera {community}." — wraps in the sheet body. */
  helper: string;
  items: readonly ProductChoiceItem[];
}

const ROW =
  'flex min-h-16 items-center gap-3 rounded-xl px-4 py-2 transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset';

export function ProductChoiceSheet({
  open,
  onClose,
  title,
  helper,
  items,
}: ProductChoiceSheetProps) {
  const desktop = useMediaQuery('(min-width: 768px)');
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      desktopCard={desktop}
      initialFocus="title"
    >
      <p className="pb-2 text-sm font-normal text-text-secondary [overflow-wrap:anywhere]">
        {helper}
      </p>
      <ul data-testid="product-choice-list" className="-mx-4 flex flex-col">
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href} aria-label={item.ariaLabel} className={ROW}>
              <span
                aria-hidden
                className="relative h-[50px] w-10 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary"
              >
                {item.thumb}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-bold text-text">{item.name}</span>
                <span className="text-xs font-normal text-text-secondary tabular-nums">
                  {item.priceLabel}
                </span>
              </span>
              <ChevronRight size={18} aria-hidden className="shrink-0 text-text-tertiary" />
            </a>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
