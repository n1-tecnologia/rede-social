'use client';

import { cn, useMediaQuery } from '@rede-social/ui';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from 'react';

/**
 * The lane row over the Reels stage (REELS-04, UI-D-84, D-117..D-120): "Todos" first, then one
 * lane per community in the order the host passes (D-76), as an ARIA tablist.
 *
 * **Hidden below two lanes (D-120).** With only "Todos" there is nothing to filter, so the row is
 * not rendered at all and only the sound button remains at the top. The host then passes the pager
 * no `onLaneStep`, so a horizontal swipe is a no-op.
 *
 * **The ARIA tabs pattern with automatic activation.** ←/→ move AND select (there is no separate
 * "activate" step), Home/End jump to the ends, and nothing wraps. The tabindex is roving: only the
 * active tab is in the tab order, so a keyboard user reaches the row in one Tab and the pager right
 * after it. Every tab's `aria-controls` names the pager's panel, and the host passes the active
 * tab's id to the pager as `labelledBy` (UI-D-97), which closes the tab/tabpanel pair.
 *
 * **Selecting the lane that is already active does nothing.** Re-selecting it would make the host
 * reset and refetch the list the member is already watching.
 *
 * **Held keys do not repeat a selection.** Every selection makes the host load a lane, and an
 * auto-repeating arrow would fire one of those per repeat (the flood T-05.3-13 mitigates for the
 * pager's own keys).
 *
 * **Overflow.** A scroller around an inner `mx-auto w-max` row: a row that fits is centred (the
 * print) without `justify-content: safe center`, and a long row scrolls from its start. The active
 * tab is scrolled into view on every change, instantly under reduced motion.
 *
 * **Pointers stop here.** The row sits over the pager's tap surface; a tap on a lane must never
 * also count as a tap (pause) or a double tap (like) on the video behind it.
 *
 * Props-only: every string, including "Todos" and the tablist's name, arrives from the host's
 * catalog (PWA-03).
 */
export type ReelsLane = {
  key: string;
  /** The visible label and the tab's accessible name. */
  label: string;
  /** The tab's DOM id; the host passes the active one to the pager as `labelledBy`. */
  tabId: string;
};

export type ReelsLanesProps = {
  lanes: ReelsLane[];
  activeKey: string;
  onSelect(key: string): void;
  /** The tablist's accessible name ("Filtrar vídeos por comunidade"). */
  label: string;
  /** The pager's panel id, named by every tab's `aria-controls`. */
  panelId: string;
};

/** The story caption's shipped text shadow, so labels stay legible over a bright frame. */
const SHADOW = 'drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]';
/** The white focus ring every control over video carries (UI-D-97). */
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

function stopPointer(event: ReactPointerEvent) {
  event.stopPropagation();
}

export function ReelsLanes({ lanes, activeKey, onSelect, label, panelId }: ReelsLanesProps) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const tabs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const tab = tabs.current.get(activeKey);
    if (!tab || typeof tab.scrollIntoView !== 'function') return;
    tab.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: reduceMotion ? 'instant' : 'smooth',
    });
  }, [activeKey, reduceMotion]);

  if (lanes.length < 2) return null;

  const select = (key: string) => {
    if (key !== activeKey) onSelect(key);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = index + 1;
        break;
      case 'ArrowLeft':
        next = index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = lanes.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (event.repeat) return;
    const lane = lanes[next];
    if (!lane || next === index) return;
    tabs.current.get(lane.key)?.focus();
    select(lane.key);
  };

  return (
    <div
      className="absolute top-[calc(var(--safe-top)+8px)] right-16 left-16 z-[3] md:top-4"
      onPointerDown={stopPointer}
      onPointerMove={stopPointer}
      onPointerUp={stopPointer}
      onPointerCancel={stopPointer}
    >
      <div className="overflow-x-auto overscroll-x-contain scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div role="tablist" aria-label={label} className="mx-auto flex w-max gap-4">
          {lanes.map((lane, index) => {
            const active = lane.key === activeKey;
            return (
              <button
                key={lane.key}
                ref={(node) => {
                  if (node) tabs.current.set(lane.key, node);
                  else tabs.current.delete(lane.key);
                }}
                type="button"
                role="tab"
                id={lane.tabId}
                aria-selected={active}
                aria-controls={panelId}
                tabIndex={active ? 0 : -1}
                onClick={() => select(lane.key)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  'inline-flex h-11 max-w-40 shrink-0 items-center px-1 text-sm',
                  active ? 'font-bold text-white' : 'font-normal text-white/70',
                  SHADOW,
                  RING,
                )}
              >
                {/* The underline sits on the label (UI-REVIEW fix 2), ~4 px under the text, while
                    the 44 px hit area stays on the tab. */}
                <span
                  className={cn(
                    'min-w-0 truncate border-b-2 pb-1',
                    active ? 'border-white' : 'border-transparent',
                  )}
                >
                  {lane.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
