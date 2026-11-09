'use client';

import { BottomSheet, Button, useMediaQuery, useToast } from '@rede-social/ui';
import { Check, Pencil, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HomePromoView } from '@/lib/courses-home-view';
import { type StoreSetupSaveResult, setStorePromoAction } from '../loja/actions';
import { HomePromoBody } from './HomePromoBody';

/** One product the sheet can feature: its id, its name and its price, already worded. */
export interface HomePromoProduct {
  id: string;
  name: string;
  price: string;
}

export interface HomePromoOption extends HomePromoProduct {
  /** The product's 4:5 image or the brand gradient, drawn by the server, filling the 40×50 box. */
  thumb: ReactNode;
}

export interface HomePromoChoiceLabels {
  /** The pencil's name: "Escolher o destaque da loja". */
  open: string;
  title: string;
  helper: string;
  /** Who sees the choice: "Todos os membros veem este produto no Início." */
  scope: string;
  /** The default option: "Mais recente da loja", and its line with the newest product's name. */
  latest: string;
  latestLine: string;
  save: string;
  saving: string;
  cancel: string;
  /** The success toast: "Destaque da loja salvo." */
  saved: string;
  errors: {
    /** The chosen product is no longer for sale (a stale list: refresh and choose again). */
    promo_invalid: string;
    generic: string;
  };
}

/** The pencil: a glass disc in the promotion's corner, always over the dark collage. */
const PENCIL =
  'absolute right-3 top-3 z-20 inline-flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black motion-reduce:transition-none';

/** A row of the picker, the store's product-choice row (`ProductChoiceSheet`) as a radio. */
const ROW =
  'flex min-h-16 w-full items-center gap-3 rounded-xl px-4 py-2 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

const THUMB = 'relative h-[50px] w-10 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary';

/** A sheet closed by nothing: what a save in flight leaves the backdrop, Escape and the drag. */
const NO_CLOSE = () => {};

/**
 * The one error line of the sheet (UI-D-686): 14/400 `text-danger`, `role="alert"`, directly above the
 * Save button; it takes focus when it appears so it is read where the admin is looking.
 */
function SaveError({ message }: { message: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <p
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="text-sm font-normal text-danger focus:outline-none"
    >
      {message}
    </p>
  );
}

/**
 * The promotion's invitation for the ADMINISTRATOR (2026-10-27; kept by the API since 12.3-14, D-699):
 * the same words as `HomePromoBody`, for the product the SERVER built it from (the saved promotion for
 * every member), and a pencil in the corner that opens the picker, the shipped `BottomSheet` (the
 * centred card from `md`) with "Mais recente da loja" (the default) and every active product of the
 * store, newest first, as a named `radiogroup` (the brand `Check` marks the one in the DRAFT).
 *
 * The sheet keeps a draft until Save (UI-D-686): a pick changes only the draft; Save is pending and
 * the sheet cannot be closed while the call is in flight; success closes it, toasts and refreshes the
 * route (the invitation then re-reads the saved product); a refusal keeps the sheet and the draft with
 * one alert line above Save; a stale answer (`promo_invalid`) refreshes and re-seeds the draft from the
 * refreshed list. It says who sees the choice: every member.
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
  /** The promotion the server built: the saved product, else the store's newest. */
  view: HomePromoView;
  /** The store's active products, newest first. */
  options: readonly HomePromoOption[];
  /** The saved promotion, still for sale (`null`: "Mais recente da loja"). */
  initialChoice: string | null;
  labels: HomePromoChoiceLabels;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState(initialChoice);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const desktop = useMediaQuery('(min-width: 768px)');
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.querySelector<HTMLElement>('[data-brand-root]') ?? document.body);
  }, []);

  // A stale answer asked for a refresh: the draft re-seeds when the refreshed props arrive.
  const awaitingRefresh = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seeds only when the refreshed props arrive (`options` is a new array on every server render)
  useEffect(() => {
    if (awaitingRefresh.current) {
      awaitingRefresh.current = false;
      setDraft(initialChoice);
    }
  }, [initialChoice, options]);

  // The default first, then every product: `null` is "Mais recente da loja".
  const values = [null, ...options.map((option) => option.id)];
  const checkedValue = options.some((option) => option.id === draft) ? draft : null;

  const openSheet = () => {
    // The sheet opens on what is saved, every time: a cancelled edit leaves nothing behind.
    setDraft(initialChoice);
    setFailure(null);
    setOpen(true);
  };

  const save = async () => {
    setPending(true);
    setFailure(null);
    let result: StoreSetupSaveResult;
    try {
      result = await setStorePromoAction(checkedValue);
    } catch {
      result = { ok: false, code: 'generic' };
    }
    setPending(false);
    if (result.ok) {
      setOpen(false);
      toast.show({ tone: 'success', message: labels.saved });
      router.refresh();
      return;
    }
    if (result.code === 'promo_invalid') {
      setFailure(labels.errors.promo_invalid);
      awaitingRefresh.current = true;
      router.refresh();
    } else {
      setFailure(labels.errors.generic);
    }
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
      <HomePromoBody view={view} />
      <button
        type="button"
        data-testid="courses-home-promo-edit"
        aria-label={labels.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={PENCIL}
        onClick={openSheet}
      >
        <Pencil aria-hidden size={18} className="shrink-0" />
      </button>
      {portalTarget
        ? createPortal(
            <BottomSheet
              open={open}
              onClose={pending ? NO_CLOSE : () => setOpen(false)}
              title={labels.title}
              desktopCard={desktop}
              initialFocus="title"
              scroll="content"
            >
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-3">
                <p className="text-sm font-normal text-text-secondary [overflow-wrap:anywhere]">
                  {labels.helper}
                </p>
                <p className="pb-2 pt-1 text-xs font-normal text-text-tertiary">{labels.scope}</p>
                <div
                  role="radiogroup"
                  aria-label={labels.title}
                  data-testid="courses-home-promo-options"
                  className="-mx-4 flex flex-col"
                >
                  {values.map((value, index) => {
                    const option = index === 0 ? null : options[index - 1];
                    const checked = value === checkedValue;
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
                        disabled={pending}
                        data-promo-option={value ?? 'latest'}
                        onClick={() => {
                          setFailure(null);
                          setDraft(value);
                        }}
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
              </div>
              <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
                <SaveError message={failure} />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => setOpen(false)}
                  >
                    {labels.cancel}
                  </Button>
                  <Button
                    variant="brand"
                    size="sm"
                    loading={pending}
                    data-testid="courses-home-promo-save"
                    onClick={save}
                  >
                    {pending ? labels.saving : labels.save}
                  </Button>
                </div>
              </div>
            </BottomSheet>,
            portalTarget,
          )
        : null}
    </>
  );
}
