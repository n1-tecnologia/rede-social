'use client';

import { AnimatePresence, motion, type PanInfo, useReducedMotion } from 'motion/react';
import { type ReactNode, useCallback, useId, useRef } from 'react';
import { cn } from '../cn';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useKeyboardInset } from '../hooks/useKeyboardInset';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Render the centred `max-w-[480px]` card instead of the sheet (desktop layouts). */
  desktopCard?: boolean;
  className?: string;
  /**
   * Who scrolls. `sheet` (the default): the body is the scroll container, padded 16px, and the
   * children flow inside it. `content`: the body keeps the SAME height cap (UI-D-18) but becomes an
   * unpadded flex column that never scrolls, and the children own the scroll. That is how a child
   * pins a footer BELOW its own scrollport (the comment composer, 04-UI-SPEC §Comment contract)
   * instead of floating it over the rows: a `sticky` footer inside the padded body resolves
   * `bottom: 0` against the scrollport CONTRACTED by that padding, so it sat 16px above the edge
   * and covered the last row.
   */
  scroll?: 'sheet' | 'content';
  /**
   * Where focus lands on open. `first` (the default): the first focusable descendant. `title`: the
   * heading itself, made focusable with `tabIndex={-1}` so it is never a Tab stop. It is for a
   * sheet whose first control is a text field: focusing the field inside the opening tap raises the
   * phone keyboard over a sheet that is still sliding in ("opening the comment sheet moves focus to
   * the sheet title", 04-UI-SPEC §Accessibility). Without a `title` it behaves as `first`.
   */
  initialFocus?: 'first' | 'title';
}

const SHEET_SPRING = { type: 'spring', damping: 28, stiffness: 300 } as const;

/**
 * The body's two shapes (see `scroll`). Both carry the ONE height cap, 80% of `--screen-h`
 * (UI-D-18), and `min-h-0`, so the body can shrink inside the flex-column panel when the panel is
 * capped above the phone keyboard.
 */
const BODY_CLASS = {
  sheet: 'min-h-0 max-h-[calc(var(--screen-h)*0.8)] overflow-y-auto overscroll-contain px-4 py-4',
  content: 'flex min-h-0 max-h-[calc(var(--screen-h)*0.8)] flex-col',
} as const;

/**
 * Modal bottom sheet: spring from the bottom, drag-down to dismiss, backdrop tap and Escape close,
 * focus trapped inside while open. Strings (title, content) arrive as props.
 *
 * **It stays above the phone keyboard** (04-UI-SPEC E12). The keyboard shrinks only the visual
 * viewport, and this root is sized to the layout one. While `useKeyboardInset` reports a keyboard,
 * the panel is capped at the visible height minus the top safe area and drops `pb-safe` (the home
 * indicator is under the keyboard), and the root pads its bottom by whatever of the covered strip
 * iOS has not already panned away, so the panel's floor is the keyboard's top edge either way. The
 * backdrop is `absolute inset-0` and still dims everything. The panel is a flex column, so a capped
 * body shrinks instead of pushing the title off the top. With no keyboard none of it applies.
 *
 * **Closing with the keyboard up drops the panel past that padding.** `AnimatePresence` animates
 * the exit on the element of the LAST open render, so the root keeps padding by `inset` while the
 * panel leaves (the keyboard is closing at the same time). A plain `y: '100%'` moves the panel by
 * its own height only: it came to rest on the strip the keyboard used to cover and vanished there
 * at unmount. The exit adds that same `inset` (`calc(100% + <inset>px)`, which motion converts to
 * pixels by measuring), so the panel always leaves through the bottom edge.
 *
 * **Rendered inline, never portaled.** The tenant's `--brand-*` vars live on `[data-brand-root]`,
 * and the platform preview relies on the sheet staying inside its device.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  desktopCard = false,
  className,
  scroll = 'sheet',
  initialFocus = 'first',
}: BottomSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const reduceMotion = useReducedMotion();
  const focusTitle = initialFocus === 'title';
  useFocusTrap(panelRef, open, onClose, focusTitle ? titleRef : undefined);
  const { inset, viewportHeight } = useKeyboardInset(open);
  const keyboardUp = viewportHeight !== null;

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
      : {
          initial: { y: '100%' },
          animate: { y: 0 },
          // The exit plays on the LAST open render, padding included (see the docblock): a panel
          // lifted by `inset` drops by that much more, or it ends on the keyboard's old strip.
          exit: { y: inset > 0 ? `calc(100% + ${inset}px)` : '100%' },
        };

  return (
    <AnimatePresence>
      {open ? (
        <div
          className={cn(
            'fixed inset-0 z-[55] flex',
            desktopCard ? 'items-center justify-center px-6' : 'items-end',
          )}
          style={inset > 0 ? { paddingBottom: inset } : undefined}
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
              'relative z-[55] flex flex-col bg-bg-secondary shadow-2xl outline-none',
              desktopCard ? 'w-full max-w-[480px] rounded-2xl' : 'w-full rounded-t-2xl',
              // `.pb-safe` is UNLAYERED in tokens.css, so a layered `pb-0` would lose to it: while
              // the keyboard is up the class is left out (the home indicator is under it).
              !desktopCard && !keyboardUp && 'pb-safe',
              className,
            )}
            style={
              keyboardUp ? { maxHeight: `calc(${viewportHeight}px - var(--safe-top))` } : undefined
            }
          >
            {desktopCard ? null : (
              <div className="flex shrink-0 justify-center pt-3 pb-2">
                <div aria-hidden className="h-1 w-12 rounded-full bg-handle" />
              </div>
            )}
            {title ? (
              <div className={cn('shrink-0 px-4 pb-3', desktopCard && 'pt-5')}>
                <h2
                  ref={titleRef}
                  id={titleId}
                  tabIndex={focusTitle ? -1 : undefined}
                  className={cn(
                    'text-center text-base font-bold text-text',
                    focusTitle && 'outline-none',
                  )}
                >
                  {title}
                </h2>
              </div>
            ) : null}
            <div className={BODY_CLASS[scroll]}>{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
