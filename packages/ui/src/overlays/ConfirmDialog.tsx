'use client';

import { Loader2, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../cn';
import { useFocusTrap } from '../hooks/useFocusTrap';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  icon?: LucideIcon;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` tints the icon and the confirm label with the destructive colour. */
  tone?: 'brand' | 'danger';
  /**
   * The confirmed action. While it is pending both footer buttons are disabled and the confirm
   * button spins; the dialog closes when it settles (the caller shows the success/error toast).
   */
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  /** Receives a rejection from `onConfirm`; when omitted the error is rethrown. */
  onError?: (error: unknown) => void;
  /**
   * Caps the body at 240px and lets it scroll inside the dialog (08.2-10, the store's lock warning
   * that names up to fifty communities): the title and both footer buttons stay on screen at 320px
   * however long the body is. Off by default; every short body renders exactly as before.
   */
  scrollBody?: boolean;
}

const DIALOG_SPRING = { type: 'spring', stiffness: 380, damping: 26 } as const;

/** Centred confirmation dialog (max-w 300, hairline-split footer) with a pending state. */
export function ConfirmDialog({
  open,
  title,
  body,
  icon: Icon,
  confirmLabel,
  cancelLabel,
  tone = 'brand',
  onConfirm,
  onClose,
  onError,
  scrollBody = false,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const close = pending ? undefined : onClose;
  useFocusTrap(panelRef, open, close);

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
    } catch (error) {
      if (!onError) throw error;
      onError(error);
    } finally {
      if (mounted.current) {
        setPending(false);
        onClose();
      }
    }
  };

  const danger = tone === 'danger';

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
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={body ? bodyId : undefined}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 4 }}
            transition={reduceMotion ? { duration: 0 } : DIALOG_SPRING}
            className="relative w-full max-w-[300px] overflow-hidden rounded-2xl bg-bg-secondary shadow-2xl outline-none"
          >
            <div className="flex flex-col items-center px-5 pt-6 pb-5 text-center">
              {Icon ? (
                <span
                  className={cn(
                    'mb-3 flex h-14 w-14 items-center justify-center rounded-full',
                    danger ? 'bg-danger/10 text-danger' : 'bg-brand/10 text-brand',
                  )}
                >
                  <Icon aria-hidden size={26} />
                </span>
              ) : null}
              <h2 id={titleId} className="break-words text-base font-bold leading-snug text-text">
                {title}
              </h2>
              {body ? (
                <p
                  id={bodyId}
                  data-confirm-body-scroll={scrollBody || undefined}
                  className={cn(
                    'mt-1.5 break-words text-sm leading-relaxed text-text-secondary',
                    scrollBody && 'max-h-60 w-full overflow-y-auto overscroll-contain',
                  )}
                >
                  {body}
                </p>
              ) : null}
            </div>
            <div className="flex border-t border-border">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="min-h-[44px] flex-1 py-3.5 text-sm font-bold text-text-secondary transition-colors active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                aria-busy={pending || undefined}
                className={cn(
                  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 border-l border-border py-3.5 text-sm font-bold transition-opacity active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-50',
                  danger ? 'text-danger' : 'text-brand',
                )}
              >
                {pending ? <Loader2 aria-hidden size={16} className="animate-spin" /> : null}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
