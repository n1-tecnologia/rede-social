'use client';

import { useEffect } from 'react';

/**
 * UI E11/overflow (sketch 006, the 320px frame): three counted chips can exceed a 320px row, and the
 * chip nav then scrolls horizontally. When the ACTIVE chip starts outside the visible part of the row
 * (say "Não vão · 212" at 320px), this scrolls the NAV (never the page) just enough to show it whole
 * on load. It renders nothing and reads no clock.
 */
export function ActiveChipInView({ navId }: { navId: string }) {
  useEffect(() => {
    const nav = document.getElementById(navId);
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const overflowRight =
      active.offsetLeft + active.offsetWidth - (nav.scrollLeft + nav.clientWidth);
    if (overflowRight > 0) nav.scrollLeft += overflowRight + 16;
  }, [navId]);
  return null;
}
