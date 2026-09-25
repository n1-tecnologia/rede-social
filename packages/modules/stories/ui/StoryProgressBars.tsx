'use client';

/**
 * The segmented progress row at the top of the viewer (UI-D-30).
 *
 * **It renders from the SAME array the pager renders from** — the CURRENT group's (UI-D-65). The
 * count is `items.length`, never a number computed beside it — so the bars and the group cannot
 * disagree about how many stories there are. A group with no story to show yet (loading, error)
 * hands in ONE placeholder, so "zero bars" stays unreachable.
 *
 * **Every segment is keyed by its GROUP as well as its story** (Pitfall 4): the same story can open
 * one group and sit in the next (D-111), and crossing from N bars to M must re-render the row for M
 * rather than reuse a segment that belonged to another group.
 *
 * **It is DECORATIVE and it must stay that way.** `aria-hidden`, no text node, no `aria-label`, no
 * `role="progressbar"`. A screen reader hears the position ONCE, from the viewer's single polite
 * live region; a progressbar per segment would announce a percentage sixty times a second and make
 * the viewer unusable with assistive technology. It is also the reason long-text/E04 is N/A by
 * construction: there is no string here for a tenant's content to lengthen.
 *
 * **The active segment keeps its fill on a media failure.** The viewer simply stops feeding it a
 * new `progress`; the row never re-flows and the position never shifts beneath the member's finger.
 */

export interface StoryProgressBarsProps {
  /** The viewer's own sequence. Only `id` is read — the count and the keys come from it. */
  items: readonly { id: string }[];
  /** Which segment is active. Everything before it is full, everything after it is empty. */
  index: number;
  /** `0..1` for the ACTIVE segment only. */
  progress: number;
  /** The group these items belong to — the first half of every segment's key (Pitfall 4). */
  groupKey?: string;
}

/** `0..1` -> a CSS width. Clamped, so a video reporting a time past its own duration cannot overflow. */
function widthOf(value: number): string {
  return `${Math.min(100, Math.max(0, value * 100))}%`;
}

export function StoryProgressBars({
  items,
  index,
  progress,
  groupKey = '',
}: StoryProgressBarsProps) {
  return (
    // `flex-nowrap` is load-bearing rather than default-restating: 25 segments at 320px must share
    // ONE row (the overflow backstop). `gap-1` + `px-2` is the sketch's geometry verbatim.
    <div
      aria-hidden
      data-testid="story-progress-bars"
      // Published from the SAME array the segments are mapped from, so the e2e can measure the row
      // without counting DOM nodes — and so `items.length` is the only source of a segment count
      // anywhere in the viewer.
      data-story-count={items.length}
      className="pointer-events-none absolute right-0 left-0 z-[3] flex flex-nowrap gap-1 px-2"
      style={{ top: 'calc(var(--safe-top) + 8px)' }}
    >
      {items.map((item, k) => (
        <span
          key={`${groupKey}:${item.id}`}
          data-testid={`story-segment-${k}`}
          // `h-0.5` = 2px, the hairline the sketch draws, over `bg-white/35`. `flex-1` with
          // `min-w-0` is what keeps 25 of them legible instead of letting one push the row wide.
          className="h-0.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/35"
        >
          <span
            data-testid={`story-fill-${k}`}
            className="block h-full rounded-full bg-white"
            style={{ width: k < index ? '100%' : k === index ? widthOf(progress) : '0%' }}
          />
        </span>
      ))}
    </div>
  );
}
