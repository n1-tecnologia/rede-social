import { REELS_TICK_WINDOW } from '../contracts/index';

/** One tick of the position indicator: its item index, whether it is the current reel, and the edge cue. */
export interface ReelsTick {
  /** The index, in the loaded list, of the item this tick stands for. */
  k: number;
  /** The current reel: drawn 16 px tall and solid white. */
  active: boolean;
  /**
   * An EDGE tick with more items beyond it — loaded but outside the window, or still behind
   * `hasMore` — drawn at `bg-white/20` as the "there is more" cue. The active tick keeps its solid
   * white even when it is also a faint edge (the last loaded reel while another page exists).
   */
  faint: boolean;
}

/**
 * UI-D-89 — the position indicator for an OPEN-ENDED keyset list, as a pure function.
 *
 * A tick per item cannot work for a list that keeps loading, so the indicator is a window of at most
 * `size` ticks (seven, the prototype's column length) drawn from the loaded range `[index − 3,
 * index + 3]`, clamped to the list and shifted inward at either end so it stays `size` wide. The
 * first tick is faint when items exist before the window; the last when items exist after it,
 * loaded or behind `hasMore`. Fewer than two loaded items draw nothing: one reel has no position.
 */
export function ticksWindow(
  index: number,
  loaded: number,
  hasMore: boolean,
  size: number = REELS_TICK_WINDOW,
): ReelsTick[] {
  if (loaded < 2 || size < 1) return [];
  const width = Math.min(size, loaded);
  const current = Math.min(Math.max(index, 0), loaded - 1);
  const start = Math.min(Math.max(current - Math.floor((width - 1) / 2), 0), loaded - width);
  const end = start + width - 1;
  const ticks: ReelsTick[] = [];
  for (let k = start; k <= end; k += 1) {
    const firstEdge = k === start && start > 0;
    const lastEdge = k === end && (end < loaded - 1 || hasMore);
    ticks.push({ k, active: k === current, faint: firstEdge || lastEdge });
  }
  return ticks;
}
