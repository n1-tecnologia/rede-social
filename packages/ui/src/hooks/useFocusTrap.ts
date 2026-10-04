'use client';

import { type RefObject, useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** Every armed trap's container, oldest first: the LAST one is the modal on top. */
const armed: HTMLElement[] = [];

/**
 * Modal focus contract shared by the overlays: on activation focus moves to `initialFocus` when
 * one is given, else to the first focusable descendant (or the container), Tab/Shift+Tab cycle
 * inside, Escape calls `onEscape`, and focus returns to the previously focused element on
 * deactivation.
 *
 * **It activates ONCE per opening.** `onEscape` is read at keydown time from a ref, never from the
 * effect's dependencies: hosts hand overlays inline arrows (`onClose={() => setOpen(null)}`), and
 * when every new identity re-ran the effect, each host re-render sent focus back to the opener and
 * then to the first focusable. In the comment sheet that pulled focus out of the field after every
 * comment sent, which drops the phone keyboard. `ref` and `initialFocus` are refs: stable objects.
 *
 * **`initialFocus` is for a target that is not a Tab stop**, such as a heading with
 * `tabIndex={-1}`. It and the container sit OUTSIDE the Tab ring: from either one, Tab enters at
 * the first control and Shift+Tab at the last, so focus never leaves the dialog. Any other element
 * that is not in the ring keeps the browser's own order, which leaves an inner trap (the
 * `ConfirmDialog` a comment list opens inside its sheet) the owner of its own Tab keys.
 *
 * **An opener that is gone hands the focus to the modal AROUND this one.** Arming once means no
 * later render repairs a lost focus, and the element to return to can leave the document while the
 * trap is open: a confirmed delete removes the comment's row, its trash button included, before
 * the `ConfirmDialog` it opened closes. Focus then fell to `<body>`, outside the comment sheet the
 * dialog sits in: Escape stopped closing the sheet and Tab walked the page behind its backdrop. So
 * the trap remembers, when it arms, the `aria-modal` element that ENCLOSES its container, and on
 * deactivation focuses that element instead whenever the opener is no longer in the document (or
 * was `<body>` itself). Every such element is focusable (`tabIndex={-1}`) and carries its own
 * trap, so Escape closes it and Tab enters its ring. A trap with no modal around it (a
 * `ConfirmDialog` rendered beside the sheet that opened it, as `PostMenu` does) returns the focus
 * exactly as before.
 *
 * **A key that lands OUTSIDE every trap belongs to the modal on top.** The focus can also leave
 * while the trap stays open: the focused control is removed with its row (the highlight editor's
 * immediate "Remover", which has no confirm), and the browser drops the focus on `<body>`, where
 * the container's own keydown listener never hears Escape or Tab. So each armed trap also listens
 * on the document, and only the LAST one armed (the topmost modal) acts, and only on keys whose
 * target is outside its container: Escape calls `onEscape`, Tab enters its ring (Shift+Tab at the
 * last control). A nested `ConfirmDialog` is the last one armed while it is open, so a stray
 * Escape closes the dialog, never the sheet under it.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  // Keep the latest handler in a ref so a new function identity per render does not tear the trap
  // down and arm it again (two focus moves, and the phone keyboard closing, on every re-render).
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const previous = document.activeElement as HTMLElement | null;
    // Read NOW, while the container is in the document: the modal this one is nested in, if any.
    const outer = root.parentElement?.closest<HTMLElement>('[aria-modal="true"]') ?? null;
    const [first] = focusables(root);
    (initialFocus?.current ?? first ?? root).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const firstItem = items[0] as HTMLElement;
      const lastItem = items[items.length - 1] as HTMLElement;
      const current = document.activeElement as HTMLElement | null;
      const outsideRing =
        current !== null &&
        (current === root || current === initialFocus?.current) &&
        !items.includes(current);
      if (outsideRing) {
        event.preventDefault();
        (event.shiftKey ? lastItem : firstItem).focus();
      } else if (event.shiftKey && current === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && current === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    // A key whose target is outside the container (the focus fell to <body>): only the modal on
    // top answers it, as if the focus were still inside.
    const onStrayKeyDown = (event: KeyboardEvent) => {
      if (armed[armed.length - 1] !== root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      if (event.key === 'Escape') {
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const items = focusables(root);
      const next = event.shiftKey ? items[items.length - 1] : items[0];
      (next ?? root).focus();
    };

    armed.push(root);
    root.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', onStrayKeyDown);
    return () => {
      root.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onStrayKeyDown);
      const at = armed.lastIndexOf(root);
      if (at !== -1) armed.splice(at, 1);
      // The opener while it is still in the document; otherwise the enclosing modal, if it still
      // is. With neither, the plain return every trap made before (a no-op on a detached node).
      const opener = previous !== document.body && previous?.isConnected ? previous : null;
      const target = opener ?? (outer?.isConnected ? outer : previous);
      target?.focus?.({ preventScroll: true });
    };
  }, [ref, active, initialFocus]);
}
