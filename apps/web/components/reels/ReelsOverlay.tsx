'use client';

import { useFocusTrap } from '@rede-social/ui';
import { useEffect, useRef } from 'react';
import type { ReelView } from '@/lib/reels';
import {
  REELS_ALL_LANE,
  type ReelInteractionReport,
  ReelsHost,
  type ReelsHostBinding,
} from './ReelsHost';

/**
 * Reels OVER the feed (2026-10-09, the product owner's request, reversing D-124): one tap on a feed
 * video opens this full-screen dialog already on that video, and its return arrow brings the member
 * back to the same post at the same place in the feed.
 *
 * **An overlay, not a navigation.** The feed stays mounted underneath with its pages and its scroll
 * position, so going back is closing a dialog, never re-rendering a route. The host that opens it
 * (`useReelsOverlay`) owns the history entry and the read of the start page; this file is the
 * dialog itself:
 *  - `role="dialog"` + `aria-modal`, named like the stage ("Reels"), with the shipped focus trap:
 *    focus moves in, Tab cycles inside, and Escape is the way back (`onBack`);
 *  - `fixed inset-0 z-[52]`, the full-screen rung the story viewer uses, so it covers the desktop rail
 *    as well; `data-shell-hide="chrome"` hides the TopBar and the BottomNav while it is mounted (the
 *    `aria-modal` hides the BottomNav on its own too);
 *  - the black ground shows at once, before the host has its start page.
 *
 * **Focus lands on the way back**, the story viewer's close rule, and again whenever the host is
 * remounted with the start page (the arrow it had is gone with it).
 *
 * **The host is `ReelsHost` in its overlay variant** (`onBack`): no lane row, the start page at the
 * tapped video in its own lane, the return arrow in every state, and a stage error whose retry reads
 * the start page again (`onRetry`). It is keyed on the start's status, so the page that arrives
 * seeds a fresh host instead of being merged into the loading one.
 */

/** What the server composes for the overlay (`reelsOverlayProps`): the host's binding and the arrow. */
export type ReelsOverlayBinding = ReelsHostBinding & {
  /** `reels.backToPost`, the return arrow's accessible name. */
  backLabel: string;
};

/** The page the overlay opens on: still being read, unreadable, or the page and the video's place. */
export type ReelsOverlayStart =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: ReelView[]; nextCursor: string | null; index: number };

export type ReelsOverlayProps = {
  binding: ReelsOverlayBinding;
  /** The lane the start page belongs to: the community's id, or "Todos" (the default). */
  lane?: string;
  start: ReelsOverlayStart;
  /** The return arrow and Escape: the opener pops its history entry. */
  onBack: () => void;
  /** The stage error's retry: the opener reads the start page again. */
  onRetry: () => void;
  onInteraction?: (postId: string, shown: ReelInteractionReport) => void;
};

/** The overlay offers no lane row: it continues the feed's own order in one lane. */
const NO_LANES: readonly { id: string; name: string }[] = [];

export function ReelsOverlay({
  binding,
  lane = REELS_ALL_LANE,
  start,
  onBack,
  onRetry,
  onInteraction,
}: ReelsOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef, true, onBack);

  // Declared AFTER the trap, so on the first mount this runs second and wins over its first stop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the START is the trigger — each status mounts a new host and a new arrow
  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[data-reels-back]')
      ?.focus({ preventScroll: true });
  }, [start.status]);

  const { backLabel, ...host } = binding;
  const ready = start.status === 'ready' ? start : null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={binding.labels.region}
      // A DECLARATION, as the story viewer's: while mounted, the shell hides its TopBar and BottomNav.
      data-shell-hide="chrome"
      data-reels-overlay=""
      tabIndex={-1}
      className="fixed inset-0 z-[52] bg-black"
    >
      <ReelsHost
        key={start.status}
        {...host}
        initial={ready ? { items: ready.items, nextCursor: ready.nextCursor } : null}
        initialIndex={ready?.index ?? 0}
        initialLane={lane}
        lanes={NO_LANES}
        pending={start.status === 'loading'}
        onBack={onBack}
        backLabel={backLabel}
        onRetry={onRetry}
        onInteraction={onInteraction}
      />
    </div>
  );
}
