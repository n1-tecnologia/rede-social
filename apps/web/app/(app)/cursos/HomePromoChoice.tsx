'use client';

import { BottomSheet, useMediaQuery } from '@rede-social/ui';
import { Check, Pencil, Sparkles } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HomePromoView } from '@/lib/courses-home-view';
import { HOME_PROMO_COOKIE, type HomePromoProduct, promoWithProduct } from '@/lib/home-promo';
import { HomePromoBody } from './HomePromoBody';

export interface HomePromoOption extends HomePromoProduct {
  /** The product's 4:5 image or the brand gradient, drawn by the server, filling the 40×50 box. */
  thumb: ReactNode;
}

export interface HomePromoChoiceLabels {
  /** The pencil's name: "Escolher o destaque da loja". */
  open: string;
  title: string;
  helper: string;
  /** The default option: "Mais recente da loja", and its line with the newest product's name. */
  latest: string;
  latestLine: string;
  /** Where the pick is kept for now (`lib/home-promo.ts`). */
  device: string;
}

/** The pencil: a glass disc in the promotion's corner, always over the dark collage. */
const PENCIL =
  'absolute right-3 top-3 z-20 inline-flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black motion-reduce:transition-none';

/** A row of the picker, the store's product-choice row (`ProductChoiceSheet`) as a radio. */
const ROW =
  'flex min-h-16 w-full items-center gap-3 rounded-xl px-4 py-2 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

const THUMB = 'relative h-[50px] w-10 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary';

/** Keeps the pick on THIS device (`lib/home-promo.ts`); `null` forgets it (the newest again). */
function keepChoice(id: string | null): void {
  const secure = location.protocol === 'https:' ? '; secure' : '';
  const life = id === null ? 'max-age=0' : 'max-age=31536000';
  // biome-ignore lint/suspicious/noDocumentCookie: the theme's reason (`ThemeToggle`): the Cookie Store API is not available on every supported mobile browser; this is a one-value, per-device preference
  document.cookie = `${HOME_PROMO_COOKIE}=${id ?? ''}; path=/; ${life}; samesite=lax${secure}`;
}

/**
 * The promotion's invitation for the ADMINISTRATOR (2026-10-27, front only): the same words as
 * `HomePromoBody`, for the product of their pick, and a pencil in the corner that opens the picker,
 * the shipped `BottomSheet` (the centred card from `md`) with "Mais recente da loja" (the default)
 * and every active product of the store, newest first, as a named `radiogroup` (the brand `Check`
 * marks the one shown). A pick swaps the invitation at once and is kept in a per-device cookie, so
 * the next visit's first HTML already draws it; the server checks it against the products again.
 *
 * The sheet is portalled out of the panel: the panel around the promotion is an isolated stacking
 * context (`isolate`, `overflow-hidden`), and inside it the sheet would paint under the shell's bars.
 * 2026-11-05: into the shell's root (`[data-brand-root]`), never `<body>`, so the sheet keeps the
 * tenant's brand (out of the root the brand's variables fall back to the neutral blue).
 */
export function HomePromoChoice({
  view,
  options,
  initialChoice,
  labels,
}: {
  /** The default promotion: the store's newest active product. */
  view: HomePromoView;
  /** The store's active products, newest first. */
  options: readonly HomePromoOption[];
  /** The device's pick, already checked against `options` by the server (`null`: the default). */
  initialChoice: string | null;
  labels: HomePromoChoiceLabels;
}) {
  const [choice, setChoice] = useState(initialChoice);
  const [open, setOpen] = useState(false);
  const desktop = useMediaQuery('(min-width: 768px)');
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.querySelector<HTMLElement>('[data-brand-root]') ?? document.body);
  }, []);

  const picked = options.find((option) => option.id === choice) ?? null;
  const shown = picked ? promoWithProduct(view, picked) : view;
  // The default first, then every product: `null` is "Mais recente da loja".
  const values = [null, ...options.map((option) => option.id)];

  const choose = (id: string | null) => {
    setChoice(id);
    keepChoice(id);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = values.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
      next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
      next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
  };

  return (
    <>
      <HomePromoBody view={shown} />
      <button
        type="button"
        data-testid="courses-home-promo-edit"
        aria-label={labels.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={PENCIL}
        onClick={() => setOpen(true)}
      >
        <Pencil aria-hidden size={18} className="shrink-0" />
      </button>
      {portalTarget
        ? createPortal(
            <BottomSheet
              open={open}
              onClose={() => setOpen(false)}
              title={labels.title}
              desktopCard={desktop}
              initialFocus="title"
            >
              <p className="text-sm font-normal text-text-secondary [overflow-wrap:anywhere]">
                {labels.helper}
              </p>
              <p className="pb-2 pt-1 text-xs font-normal text-text-tertiary">{labels.device}</p>
              <div
                role="radiogroup"
                aria-label={labels.title}
                data-testid="courses-home-promo-options"
                className="-mx-4 flex flex-col"
              >
                {values.map((value, index) => {
                  const option = index === 0 ? null : options[index - 1];
                  const checked = value === (picked?.id ?? null);
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: a two-line option with a thumb (the store's product-choice row, `RoleOptionList`'s pattern); a native radio could not hold the thumb and the price line
                    <button
                      key={value ?? 'latest'}
                      ref={(node) => {
                        optionRefs.current[index] = node;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      tabIndex={checked ? 0 : -1}
                      data-promo-option={value ?? 'latest'}
                      onClick={() => choose(value)}
                      onKeyDown={(event) => onKeyDown(event, index)}
                      className={ROW}
                    >
                      <span aria-hidden className={THUMB}>
                        {option ? (
                          option.thumb
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-text-secondary">
                            <Sparkles size={18} />
                          </span>
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-bold text-text">
                          {option ? option.name : labels.latest}
                        </span>
                        <span className="truncate text-xs font-normal text-text-secondary tabular-nums">
                          {option ? option.price : labels.latestLine}
                        </span>
                      </span>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                        {checked ? <Check aria-hidden size={20} className="text-brand" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </BottomSheet>,
            portalTarget,
          )
        : null}
    </>
  );
}
