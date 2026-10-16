'use client';

import { type ProductChoiceItem, ProductChoiceSheet } from '@rede-social/module-store/ui';
import { buttonClasses } from '@rede-social/ui';
import { Lock } from 'lucide-react';
import { useState } from 'react';

/** The `outline` `fullWidth` look (A-UI-8): Início's one brand fill stays the hero CTA. */
const OUTLINE_BUTTON = buttonClasses({ variant: 'outline', size: 'md', fullWidth: true });

/**
 * The locked next live with SEVERAL buyable products (08.6-11, UI-D-452, D-446, A-UI-8): the
 * `outline` "Comprar para liberar" as a `<button aria-haspopup="dialog">` opening the store's shipped
 * `ProductChoiceSheet` ("Opções de acesso", helper "Qualquer um destes produtos libera {live}.").
 * Composed here in the app tier (MOD-02: the courses module never imports the store). The rows
 * arrive as props, already worded and with their thumbs, so there is no loading state (E06); a tap
 * only navigates to the product page, where the shipped `PurchaseDialog` confirms (PR-4).
 */
export function HomeLiveChoice({
  label,
  title,
  helper,
  choices,
}: {
  label: string;
  title: string;
  helper: string;
  choices: ProductChoiceItem[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        data-testid="courses-home-live-buy"
        className={OUTLINE_BUTTON}
        onClick={() => setOpen(true)}
      >
        <Lock aria-hidden size={16} className="shrink-0" />
        {label}
      </button>
      <ProductChoiceSheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        helper={helper}
        items={choices}
      />
    </>
  );
}
