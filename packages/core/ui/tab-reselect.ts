import type { MouseEvent } from 'react';

/**
 * The shell's scroll root (`main#app-scroll`, `ScrollRoot`) back to the top: smooth, or at once
 * under `prefers-reduced-motion`. `scroller` is the root a caller already knows (the BottomNav
 * tracks the one that moved last); without it the shell's own root is used.
 */
export function scrollAppToTop(scroller?: HTMLElement | null): void {
  const root = scroller ?? document.getElementById('app-scroll');
  if (!root) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  root.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

function pathOf(href: string): string {
  const path = href.split(/[?#]/)[0] || '/';
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

/**
 * Re-tapping the tab the member is ALREADY on (2026-10-06, Instagram's gesture): on the tab's own
 * page, the tap takes the page back to the top instead of navigating to where it already is. On a
 * page below the tab (a post, a community) the tap still navigates to the tab, and a modified click
 * (a new tab or window, a middle click) is left to the browser. Returns whether it scrolled.
 *
 * Called from the tab link's `onClick`: `next/link` skips its navigation once the default is
 * prevented, and the link keeps the focus, so a keyboard Enter does the same as a tap.
 */
export function reselectTab(
  event: MouseEvent<HTMLAnchorElement>,
  pathname: string,
  href: string,
  scroller?: HTMLElement | null,
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (pathOf(pathname) !== pathOf(href)) return false;
  event.preventDefault();
  scrollAppToTop(scroller);
  return true;
}
