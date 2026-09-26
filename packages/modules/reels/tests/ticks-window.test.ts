import { describe, expect, it } from 'vitest';
import { REELS_TICK_WINDOW } from '../contracts/index';
import { ticksWindow } from '../ui/ticks';

/**
 * UI-D-89 — the position indicator of an open-ended keyset list, as a pure function.
 *
 * A tick per item cannot work for a list that keeps loading, so the indicator is a WINDOW of at most
 * seven ticks from the loaded range around the active reel, shifted inward at either end so it stays
 * seven wide. An edge tick is `faint` when something (loaded, or still behind `hasMore`) lies beyond
 * it — the "there is more" cue. Fewer than two items draw nothing.
 */
const ks = (ticks: { k: number }[]) => ticks.map((tick) => tick.k);
const faintKs = (ticks: { k: number; faint: boolean }[]) =>
  ticks.filter((tick) => tick.faint).map((tick) => tick.k);
const activeKs = (ticks: { k: number; active: boolean }[]) =>
  ticks.filter((tick) => tick.active).map((tick) => tick.k);

describe('ticksWindow (UI-D-89)', () => {
  it('draws nothing for a single item', () => {
    expect(ticksWindow(0, 1, false)).toEqual([]);
  });

  it('draws nothing for an empty list', () => {
    expect(ticksWindow(0, 0, true)).toEqual([]);
  });

  it('draws one tick per item for a short list, the current one active and none faint', () => {
    const ticks = ticksWindow(0, 3, false);
    expect(ks(ticks)).toEqual([0, 1, 2]);
    expect(activeKs(ticks)).toEqual([0]);
    expect(faintKs(ticks)).toEqual([]);
  });

  it('centres a 7-wide window in a long list, both edges faint', () => {
    const ticks = ticksWindow(10, 30, false);
    expect(ks(ticks)).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(activeKs(ticks)).toEqual([10]);
    expect(faintKs(ticks)).toEqual([7, 13]);
  });

  it('shifts the window inward at the start: only the right edge is faint', () => {
    const ticks = ticksWindow(0, 30, false);
    expect(ks(ticks)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(activeKs(ticks)).toEqual([0]);
    expect(faintKs(ticks)).toEqual([6]);
  });

  it('shifts the window inward at the end: only the left edge is faint', () => {
    const ticks = ticksWindow(29, 30, false);
    expect(ks(ticks)).toEqual([23, 24, 25, 26, 27, 28, 29]);
    expect(activeKs(ticks)).toEqual([29]);
    expect(faintKs(ticks)).toEqual([23]);
  });

  it('marks the right edge faint at the last loaded item while more pages exist (hasMore)', () => {
    const ticks = ticksWindow(9, 10, true);
    expect(ks(ticks)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(activeKs(ticks)).toEqual([9]);
    expect(faintKs(ticks)).toEqual([3, 9]);
  });

  it('never draws more than REELS_TICK_WINDOW ticks, wherever the index sits', () => {
    for (let index = 0; index < 40; index += 1) {
      expect(ticksWindow(index, 40, true).length).toBeLessThanOrEqual(REELS_TICK_WINDOW);
    }
    expect(REELS_TICK_WINDOW).toBe(7);
  });
});
