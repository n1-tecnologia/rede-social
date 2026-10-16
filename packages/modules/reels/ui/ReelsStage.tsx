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
 * The one full-screen ground every Reels state renders in — populated, loading, empty and the stage
 * error alike (UI-D-81, UI-D-82, UI-D-97, UI-D-98).
 *
 * - **A landmark.** A `<section>` with an accessible name is a `region`, so screen-reader users can
 *   jump to the video surface (UI-D-97).
 * - **Always dark.** The dark theme scope makes every tokenised primitive rendered on the black —
 *   `Avatar`'s fallback disc, `EmptyState`, the outline and brand buttons — read the dark values
 *   (UI-D-98). The comment `BottomSheet` and the toasts are rendered OUTSIDE this element, so they
 *   keep the member's own theme.
 * - **The z-order.** `z-40` (the prototype's) sits UNDER the shell's floating BottomNav (`z-50`),
 *   `BottomSheet` (`z-[55]`) and the toast stack (`z-[100]`), so the dark glass pill floats over the
 *   video and a sheet or toast always opens over it. In the overlay the stage lives inside the
 *   overlay's own `z-[52]` dialog, which already sits over the shell's chrome (and hides it).
 * - **Desktop.** On the tab, `md:left-60` starts the stage right of the 240 px `DesktopRail`, which
 *   stays visible and unchanged (UI-D-81d). The overlay covers the rail too (`md:left-0`).
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
      data-theme="dark"
      data-reels-stage={variant}
      className={cn(
        'fixed inset-0 z-40 overflow-hidden bg-black text-white',
        variant === 'overlay' ? 'md:left-0' : 'md:left-60',
      )}
      style={{ touchAction: 'none' }}
    >
      <ReelsStageVariantContext.Provider value={variant}>
        {children}
      </ReelsStageVariantContext.Provider>
    </section>
  );
}
