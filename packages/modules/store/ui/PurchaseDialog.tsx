'use client';

import { cn, useFocusTrap } from '@rede-social/ui';
import { ChevronRight, CircleCheck, Loader2, ShoppingBag } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useId, useRef } from 'react';

/**
 * The purchase pop-up (UI-D-370, UI-D-371, UI-D-386, D-358, D-361): the ONE place a member confirms
 * a purchase. Two steps in one panel, swapped instantly (no slide):
 *
 *  - **confirm**: the brand disc with `ShoppingBag`, "Comprar {product}?" (or "Obter…" at R$ 0),
 *    the price and the communities it opens, an optional inline `role="alert"` failure line, and the
 *    hairline-split footer "Cancelar" │ "Confirmar". While `pending` both buttons are disabled,
 *    "Confirmar" spins with the pending label, and Escape and the overlay do nothing.
 *  - **success**: the success disc with `CircleCheck`, the title (focused on entry, `tabIndex={-1}`,
 *    announced by the `aria-live="polite"` step container) and, by the number of communities the
 *    host passes: one → "Fechar" │ the brand `<a>` the host names; several → a scrolling list of
 *    community links capped at 240px and one full-width "Fechar"; none → one full-width "Fechar".
 *
 * **The `ConfirmDialog` shell, pixel for pixel** (overlay `bg-black/60`, the centred 300px
 * `rounded-2xl bg-bg-secondary shadow-2xl` panel, the 56px disc, the hairline footer, the same spring
 * and reduced-motion rule, the shipped `useFocusTrap`), but not `ConfirmDialog` itself: that one
 * closes when `onConfirm` settles, and this panel must turn into its success state in place.
 *
 * **Props only, no words** (PWA-03, MOD-02): every title, body, label and community name arrives
 * from the host, already composed from the pt-BR catalog; hrefs are host-built and the rows are
 * plain `<a>`s (no framework router). The host owns the request, the state machine and the refusal
 * mapping; this component only draws the step it is given. A fresh purchase and an `owned` replay
 * therefore render the same success markup (P27).
 */

export interface PurchaseDialogCommunity {
  href: string;
  name: string;
  /** The 32px thumb, host-built (the cover or the brand gradient). */
  thumb?: ReactNode;
}

export interface PurchaseDialogProps {
  open: boolean;
  step: 'confirm' | 'success';
  confirm: {
    title: string;
    body: string;
    confirmLabel: string;
    pendingLabel: string;
    cancelLabel: string;
  };
  success: {
    title: string;
    body: string;
    /** Two or more draws the link list; the host passes none for the one/none variants. */
    communities?: PurchaseDialogCommunity[];
    /** The one-community variant's brand link ("Ir para a comunidade"). */
    primary?: { href: string; label: string };
    closeLabel: string;
  };
  /** The request is in flight: both buttons inert, Escape and the overlay ignored. */
  pending: boolean;
  /** A generic failure (network, 5xx): an inline `role="alert"` line under the body. */
  errorText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

const DIALOG_SPRING = { type: 'spring', stiffness: 380, damping: 26 } as const;

const FOOTER_BUTTON =
  'min-h-[44px] flex-1 py-3.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

export function PurchaseDialog({
  open,
  step,
  confirm,
  success,
  pending,
  errorText,
  onConfirm,
  onClose,
}: PurchaseDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // ONE ref for the step's focus target: "Confirmar" on the confirm step, the title on the success
  // step. The trap reads it when it arms (focus opens on "Confirmar") and at every Tab, so from the
  // success title Tab and Shift+Tab both stay inside the panel.
  const focusTarget = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();

  const close = pending ? undefined : onClose;
  useFocusTrap(panelRef, open, close, focusTarget);

  // The swap to success moves focus to the announced title (UI-D-386).
  useEffect(() => {
    if (open && step === 'success') focusTarget.current?.focus({ preventScroll: true });
  }, [open, step]);

  const isSuccess = step === 'success';
  const list = isSuccess && success.communities && success.communities.length > 1;
  const title = isSuccess ? success.title : confirm.title;
  const body = isSuccess ? success.body : confirm.body;

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center px-8">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            className="absolute inset-0 bg-black/60"
            onClick={close}
            data-purchase-overlay
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            tabIndex={-1}
            data-purchase-dialog={step}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 4 }}
            transition={reduceMotion ? { duration: 0 } : DIALOG_SPRING}
            className="relative w-full max-w-[300px] overflow-hidden rounded-2xl bg-bg-secondary shadow-2xl outline-none"
          >
            <div
              aria-live="polite"
              className="flex flex-col items-center px-5 pt-6 pb-5 text-center"
            >
              <span
                className={cn(
                  'mb-3 flex h-14 w-14 shrink-0 items-center justify-center rounded-full',
                  isSuccess ? 'bg-success/10 text-success' : 'bg-brand/10 text-brand',
                )}
              >
                {isSuccess ? (
                  <CircleCheck aria-hidden size={26} />
                ) : (
                  <ShoppingBag aria-hidden size={26} />
                )}
              </span>
              <h2
                id={titleId}
                ref={
                  isSuccess
                    ? (node) => {
                        focusTarget.current = node;
                      }
                    : undefined
                }
                tabIndex={isSuccess ? -1 : undefined}
                data-purchase-title
                className="max-w-full break-words text-base font-bold leading-snug text-text outline-none"
              >
                {title}
              </h2>
              <p
                id={bodyId}
                className="mt-1.5 max-w-full break-words text-sm leading-relaxed text-text-secondary"
              >
                {body}
              </p>
              {!isSuccess && errorText ? (
                <p
                  role="alert"
                  data-purchase-error
                  className="mt-3 max-w-full break-words text-sm font-normal text-danger"
                >
                  {errorText}
                </p>
              ) : null}
              {list ? (
                <ul
                  data-purchase-communities
                  className="mt-3 max-h-60 w-full overflow-y-auto text-left"
                >
                  {success.communities?.map((community) => (
                    <li key={community.href}>
                      <a
                        href={community.href}
                        className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                      >
                        {community.thumb ?? null}
                        <span className="min-w-0 flex-1 truncate text-sm font-bold">
                          {community.name}
                        </span>
                        <ChevronRight
                          aria-hidden
                          size={18}
                          className="shrink-0 text-text-tertiary"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex border-t border-border">
              {isSuccess ? (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    data-purchase-close
                    className={cn(FOOTER_BUTTON, 'text-text-secondary active:bg-bg-tertiary')}
                  >
                    {success.closeLabel}
                  </button>
                  {success.primary && !list ? (
                    <a
                      href={success.primary.href}
                      data-purchase-primary
                      className={cn(
                        FOOTER_BUTTON,
                        'inline-flex items-center justify-center border-l border-border px-2 text-center text-brand active:opacity-80',
                      )}
                    >
                      {success.primary.label}
                    </a>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={pending}
                    data-purchase-cancel
                    className={cn(
                      FOOTER_BUTTON,
                      'text-text-secondary active:bg-bg-tertiary disabled:opacity-50',
                    )}
                  >
                    {confirm.cancelLabel}
                  </button>
                  <button
                    type="button"
                    ref={(node) => {
                      focusTarget.current = node;
                    }}
                    onClick={pending ? undefined : onConfirm}
                    disabled={pending}
                    aria-busy={pending || undefined}
                    data-purchase-confirm
                    className={cn(
                      FOOTER_BUTTON,
                      'inline-flex items-center justify-center gap-2 border-l border-border text-brand transition-opacity active:opacity-80 disabled:opacity-50',
                    )}
                  >
                    {pending ? <Loader2 aria-hidden size={16} className="animate-spin" /> : null}
                    {pending ? confirm.pendingLabel : confirm.confirmLabel}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
