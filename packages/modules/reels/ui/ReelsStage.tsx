import type { ReactNode } from 'react';

export interface ReelsStageProps {
  /** The region's accessible name — the catalog's "Reels" (`reels.region`), never a literal here. */
  label: string;
  children: ReactNode;
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
 *   video and a sheet or toast always opens over it.
 * - **Desktop.** `md:left-60` starts the stage right of the 240 px `DesktopRail`, which stays
 *   visible and unchanged (UI-D-81d).
 * - **`touch-action: none`** stops the browser turning a vertical swipe into a page scroll, a
 *   pull-to-refresh or a back navigation — the pager owns every gesture on this ground.
 */
export function ReelsStage({ label, children }: ReelsStageProps) {
  return (
    <section
      aria-label={label}
      data-theme="dark"
      className="fixed inset-0 z-40 overflow-hidden bg-black text-white md:left-60"
      style={{ touchAction: 'none' }}
    >
      {children}
    </section>
  );
}
