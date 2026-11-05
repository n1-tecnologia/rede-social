'use client';

import { cn } from '@rede-social/ui';
import { createContext, type ReactNode, useContext } from 'react';

/**
 * Where the stage is drawn: the Reels TAB, under the shell's chrome, or the OVERLAY a single tap on
 * a feed video opens over the feed (2026-10-09), which covers the whole screen and has no BottomNav.
 */
export type ReelsStageVariant = 'tab' | 'overlay';

export interface ReelsStageProps {
  /** The region's accessible name — the catalog's "Reels" (`reels.region`), never a literal here. */
  label: string;
  /** `'tab'` when omitted. */
  variant?: ReelsStageVariant;
  children: ReactNode;
}

const ReelsStageVariantContext = createContext<ReelsStageVariant>('tab');

/**
 * The bottom inset of the pieces drawn over a page (the rail and the caption block). On the tab they
 * clear the shell's floating BottomNav (88 px over the safe area); the overlay has no BottomNav, so
 * they sit 24 px over the safe area. Spelled out in full, never interpolated, so Tailwind's scanner
 * sees both. From `md` both pieces use their own `md:bottom-6`.
 */
const BOTTOM_CLEARANCE: Record<ReelsStageVariant, string> = {
  tab: 'bottom-[calc(var(--safe-bottom)+88px)]',
  overlay: 'bottom-[calc(var(--safe-bottom)+24px)]',
};

/** The bottom inset class for a piece drawn on the stage around it (the tab's outside any stage). */
export function useReelsBottomClearance(): string {
  return BOTTOM_CLEARANCE[useContext(ReelsStageVariantContext)];
}

/**
 * 2026-10-23 — the player box's ROW: the whole stage on the phone; from md the row that holds the
 * box at the top centre, 8 px under the stage's top edge (the YouTube Shorts layout, the product
 * owner's request).
 */
export const REELS_ROW = 'absolute inset-0 md:flex md:items-start md:justify-center md:pt-2';

/**
 * 2026-10-23 — the player BOX, shared by the pager's column and the stage's other states
 * (`ReelsFrame`), so loading, empty and error sit exactly where the video does. The whole stage on
 * the phone, as before. From md a 9:16 box as tall as the stage allows while leaving 28 px under it
 * (16 px of gap and a 12 px peek at the next video), and never wider than the stage minus 80 px a
 * side (the rail beside it, the ↑/↓ at the edge): the width decides and the height follows, so the
 * box keeps its 9:16 on a narrow window.
 */
export const REELS_COLUMN =
  'relative h-full w-full md:aspect-[9/16] md:h-auto md:w-[min(calc((var(--screen-h)_-_36px)_*_9_/_16),calc(100%_-_160px))]';

/**
 * The player box the stage's states other than the video draw in (loading, empty, the stage error):
 * the whole stage on the phone, exactly as before, and the pager's rounded box from md. It is the
 * dark scope (UI-D-98): every tokenised primitive in it (`EmptyState`, the outline and brand
 * buttons) reads the dark values, on the black, whatever the member's theme around it.
 */
export function ReelsFrame({ children }: { children: ReactNode }) {
  return (
    <div className={REELS_ROW}>
      <div
        data-theme="dark"
        data-reels-frame=""
        className={cn(REELS_COLUMN, 'bg-black text-white md:overflow-hidden md:rounded-xl')}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The one full-screen ground every Reels state renders in — populated, loading, empty and the stage
 * error alike (UI-D-81, UI-D-82, UI-D-97, UI-D-98).
 *
 * - **A landmark.** A `<section>` with an accessible name is a `region`, so screen-reader users can
 *   jump to the video surface (UI-D-97).
 * - **Dark on the phone, the member's theme around the player on the desktop** (2026-10-23, the
 *   YouTube Shorts layout). The ground is black on the phone; from md it is the theme's page ground,
 *   so the rail, the caption block, the ↑/↓ and the comments panel beside the player read the
 *   member's light or dark theme. The DARK SCOPE (UI-D-98) moved from this element to the player box
 *   (the pager's clip, `ReelsFrame`): the whole stage on the phone, so the phone renders exactly as
 *   before. The comment `BottomSheet` and the toasts are rendered OUTSIDE this element, so they keep
 *   the member's own theme.
 * - **The z-order.** `z-40` (the prototype's) sits UNDER the shell's floating BottomNav (`z-50`),
 *   `BottomSheet` (`z-[55]`) and the toast stack (`z-[100]`), so the dark glass pill floats over the
 *   video and a sheet or toast always opens over it. In the overlay the stage lives inside the
 *   overlay's own `z-[52]` dialog, which already sits over the shell's chrome (and hides it).
 * - **Desktop.** On the tab, `md:left-[72px]` starts the stage right of the `DesktopRail` (its 72px
 *   glyphs since 2026-10-26), which stays visible and unchanged (UI-D-81d). The overlay covers the
 *   rail too (`md:left-0`). The stage
 *   is also what the player's "Tela cheia" takes full screen (`data-reels-stage`).
 * - **`touch-action: none`** stops the browser turning a vertical swipe into a page scroll, a
 *   pull-to-refresh or a back navigation — the pager owns every gesture on this ground.
 * - **The variant reaches the pieces drawn on it** through a context, so the rail and the caption
 *   lower themselves in the overlay (`useReelsBottomClearance`) without a prop threaded through the
 *   host's render functions.
 */
export function ReelsStage({ label, variant = 'tab', children }: ReelsStageProps) {
  return (
    <section
      aria-label={label}
      data-reels-stage={variant}
      className={cn(
        'fixed inset-0 z-40 overflow-hidden bg-black text-white md:bg-bg md:text-text',
        variant === 'overlay' ? 'md:left-0' : 'md:left-[72px]',
      )}
      style={{ touchAction: 'none' }}
    >
      <ReelsStageVariantContext.Provider value={variant}>
        {children}
      </ReelsStageVariantContext.Provider>
    </section>
  );
}
