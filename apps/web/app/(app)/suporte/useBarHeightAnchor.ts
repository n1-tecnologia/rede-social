'use client';

import { type RefObject, useEffect } from 'react';

/** The messenger rule of the pane: within 80px of the bottom counts as "at the bottom". */
const NEAR_BOTTOM_PX = 80;

/**
 * Keeps the thread's scroll position stable when the case bar's height changes (UI-D-830, sketch 023
 * review outcome 1): the member's bar moves between about 82 and 118 px when a live state change makes
 * the "Meus chamados" link wrap, and the scroller (a flex child under it) grows or shrinks by exactly
 * that much while its top edge moves with the bar.
 *
 * The anchor rule of the pane's `ScrollIntent`:
 * - a reader who was **at the bottom** stays at the bottom;
 * - anyone else gets `scrollTop` moved by the same delta as the bar, so the content under their eyes
 *   stays where it was on screen.
 *
 * The bar is observed with a `ResizeObserver` (the first callback only records the baseline height). The
 * "was at the bottom" fact is the LAST one measured before the change (kept on every scroll and at the
 * baseline), because by the time the observer fires the layout has already moved. No polling, no clock,
 * no focus move; a runtime without `ResizeObserver` simply gets no anchoring.
 */
export function useBarHeightAnchor(
  barRef: RefObject<HTMLElement | null>,
  scrollerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const bar = barRef.current;
    const scroller = scrollerRef.current;
    if (!bar || !scroller || typeof ResizeObserver === 'undefined') return;

    let last: number | null = null;
    const distance = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    let atBottom = true;
    const onScroll = () => {
      atBottom = distance() <= NEAR_BOTTOM_PX;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver((entries) => {
      const height = entries[entries.length - 1]?.contentRect.height ?? bar.offsetHeight;
      if (last === null) {
        last = height;
        atBottom = distance() <= NEAR_BOTTOM_PX;
        return;
      }
      const delta = height - last;
      last = height;
      if (delta === 0) return;
      if (atBottom) scroller.scrollTop = scroller.scrollHeight;
      else scroller.scrollTop += delta;
    });
    observer.observe(bar);

    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [barRef, scrollerRef]);
}
