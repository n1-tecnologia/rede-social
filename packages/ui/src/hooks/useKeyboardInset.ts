'use client';

import { useEffect, useState } from 'react';

/** What the on-screen keyboard hides at the bottom of the screen, in CSS px. */
export interface KeyboardInset {
  /**
   * How far the layout viewport's bottom lies below the visible area: the padding that puts a
   * bottom-anchored element on the keyboard's top edge. `0` with no keyboard, and also once iOS
   * has panned the page all the way to reveal a focused field.
   */
  inset: number;
  /** The height still visible while a keyboard covers anything, panned or not; `null` otherwise. */
  viewportHeight: number | null;
  /**
   * The height the visual viewport lost to the layout viewport (`innerHeight -
   * visualViewport.height`), panned or not: the keyboard's own height while one is up, `0`
   * otherwise. It answers "is a keyboard up?", which `inset` cannot: a full pan takes `inset` to
   * `0` with the keyboard still on screen. Whatever else shrinks the visual viewport reads here
   * too (the browser's toolbars mid-collapse, an accessory bar), so a consumer that wants a real
   * keyboard sets its own floor (the BottomNav's is 100px).
   */
  keyboardHeight: number;
}

const NONE: KeyboardInset = { inset: 0, viewportHeight: null, keyboardHeight: 0 };

/** One reading of the visual viewport. A pinch-zoom shrinks it too, and that is not a keyboard. */
function measure(viewport: VisualViewport): KeyboardInset {
  if (Math.abs(viewport.scale - 1) > 0.01) return NONE;
  const lost = window.innerHeight - viewport.height;
  // Under 1px is the two viewports rounding differently, not a keyboard.
  if (lost < 1) return NONE;
  return {
    inset: Math.max(0, Math.round(lost - viewport.offsetTop)),
    viewportHeight: Math.round(viewport.height),
    keyboardHeight: Math.round(lost),
  };
}

/**
 * How much of the screen's bottom the phone keyboard covers while `active` (04-UI-SPEC E12: "with
 * the mobile keyboard open the sheet's input stays pinned above it").
 *
 * **Why it has to be measured.** iOS Safari, and Android Chrome's default `resizes-visual`, shrink
 * only `window.visualViewport` when the keyboard opens. The layout viewport keeps its height, so
 * `position: fixed`, `100dvh` and therefore `--screen-h` all stay sized as if there were no
 * keyboard, and anything anchored to the bottom (every `BottomSheet`) sits behind it. The strip
 * still to lift is what lies between the visual viewport's bottom edge and the layout viewport's:
 * `innerHeight - visualViewport.height - visualViewport.offsetTop`, `offsetTop` being how far iOS
 * already panned to reveal a focused field. A full pan leaves nothing to lift but still leaves only
 * `viewportHeight` on screen, which is why the two are reported apart. `keyboardHeight` is the
 * third reading, for a consumer that only asks whether a keyboard is up (the BottomNav steps aside
 * for one): what the visual viewport lost, which no pan changes.
 *
 * **Inert** (no inset, no `viewportHeight`, a `keyboardHeight` of 0) on the server and on the
 * first render (nothing here runs outside an effect), where `visualViewport` is missing
 * (happy-dom), while the page is pinch-zoomed, and whenever `active` is false; on a desktop the two
 * viewports match and there is nothing to report either. A sheet that opens with the keyboard
 * ALREADY up is read once on activation. After that the keyboard's own animation fires
 * `resize`/`scroll` many times a frame, so the listeners only schedule a read and at most one runs
 * per animation frame.
 */
export function useKeyboardInset(active: boolean): KeyboardInset {
  const [reading, setReading] = useState<KeyboardInset>(NONE);

  useEffect(() => {
    if (!active) return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    let frame: number | undefined;
    const read = () => {
      frame = undefined;
      const next = measure(viewport);
      // The same numbers keep the same object, so a keyboard that did not move re-renders nothing.
      setReading((previous) =>
        previous.inset === next.inset &&
        previous.viewportHeight === next.viewportHeight &&
        previous.keyboardHeight === next.keyboardHeight
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(read);
    };

    read();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      // The next opening starts from "no keyboard", never from the last sheet's reading.
      setReading(NONE);
    };
  }, [active]);

  return active ? reading : NONE;
}
