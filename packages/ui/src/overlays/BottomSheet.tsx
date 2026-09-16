'use client';

import { AnimatePresence, motion, type PanInfo, useReducedMotion } from 'motion/react';
import { type ReactNode, useCallback, useId, useRef } from 'react';
import { cn } from '../cn';
import { useFocusTrap } from '../hooks/useFocusTrap';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Render the centred `max-w-[480px]` card instead of the sheet (desktop layouts). */
  desktopCard?: boolean;
  className?: string;
}

const SHEET_SPRING = { type: 'spring', damping: 28, stiffness: 300 } as const;

/**
 * Modal bottom sheet: spring from the bottom, drag-down to dismiss, backdrop tap and Escape close,
 * focus trapped inside while open. Strings (title, content) arrive as props.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  desktopCard = false,
  className,
}: BottomSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  useFocusTrap(panelRef, open, onClose);

  const onDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.y > 100 || info.velocity.y > 500) onClose();
    },
    [onClose],
  );

  const panelMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : desktopCard
      ? {
          initial: { opacity: 0, scale: 0.96, y: 8 },
          animate: { opacity: 1, scale: 1, y: 0 },
          exit: { opacity: 0, scale: 0.98, y: 4 },
        }
      : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } };

  return (
    <AnimatePresence>
      {open ? (
        <div
          className={cn(
            'fixed inset-0 z-[55] flex',
            desktopCard ? 'items-center justify-center px-6' : 'items-end',
          )}
        >
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            {...panelMotion}
            transition={reduceMotion ? { duration: 0 } : SHEET_SPRING}
            drag={desktopCard || reduceMotion ? false : 'y'}
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={onDragEnd}
            className={cn(
              'relative z-[55] bg-bg-secondary shadow-2xl outline-none',
              desktopCard ? 'w-full max-w-[480px] rounded-2xl' : 'w-full rounded-t-2xl pb-safe',
              className,
            )}
          >
            {desktopCard ? null : (
              <div className="flex justify-center pt-3 pb-2">
                <div aria-hidden className="h-1 w-12 rounded-full bg-handle" />
              </div>
            )}
            {title ? (
              <div className={cn('px-4 pb-3', desktopCard && 'pt-5')}>
                <h2 id={titleId} className="text-center text-base font-bold text-text">
                  {title}
                </h2>
              </div>
            ) : null}
            <div className="max-h-[calc(var(--screen-h)*0.8)] overflow-y-auto overscroll-contain px-4 py-4">
              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
