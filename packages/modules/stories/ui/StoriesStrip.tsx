'use client';

import { Skeleton } from '@tria/ui';
import { StoryCircle, type StoryCircleDisc, type StoryCircleRing } from './StoryCircle';

/**
 * The `/inicio` home-slot row (UI-D-25, UI-D-26, UI-D-47, UI-D-59) and — with another data source —
 * a community page's "Destaques" row. It renders an ORDERED LIST OF CIRCLE DESCRIPTORS, nothing
 * more: which circles a viewer gets, in which order and behind which permission is the HOST's
 * decision, never this component's.
 *
 * **UI-D-26's empty is ALL OR NOTHING, and that is the component's most load-bearing behaviour.**
 * With no circle to draw it returns `null`: no node, no empty state, no reserved height, so the
 * `/inicio` column closes up and the feed rises. A member is not helped by a card announcing that
 * their organisation has broadcast nothing, and the feed's own empty state already owns "nada por
 * aqui" for that screen. An ADMIN still gets the `+` circle, because the host always hands it over
 * (D-108) — it is the only publish door (D-80).
 *
 * **D-104 / D-106: ONE tenant circle plays every active story, oldest → newest**, followed by the
 * place's highlights in the admin's order (`position, id`). The circle that says who is speaking is
 * the tenant — its logo and name — whatever the number of live stories; a highlight is where a
 * story ALSO stays, never where it is taken from.
 *
 * **Three descriptor kinds.** `link` is an `<a>` to a host route (the `+` circle; the manage
 * circle and empty highlights later). `open` is a `<button>` that calls `onOpen(group, index)` with
 * its OWN pair — the tenant circle, a pinned story, a highlight circle once the viewer is
 * group-aware — and is inert until the host supplies `onOpen`. `static` is always inert: a circle
 * with nowhere to go yet renders as a span, never as a button that does nothing when tapped.
 *
 * **UI-D-47: identical geometry on desktop.** No arrows, no fade mask, no grid reflow. A circle row
 * is a phone idiom that survives unchanged inside the 680px column, and desktop-only chrome here
 * would be the first component in the product with something the mobile version lacks.
 *
 * Ships no words (PWA-03) and resolves no route (MOD-02): every string and every href is a prop the
 * host chose.
 */

/** Fields every descriptor carries. `label` is ALREADY FORMATTED by the host (UI-D-14). */
interface StoryStripCircleBase {
  /** Stable React key within the row (a story id, a highlight id, `own`, `tenant`…). */
  key: string;
  label: string;
  actionLabel: string;
  ring: StoryCircleRing;
  disc: StoryCircleDisc;
}

/**
 * One circle of the row, in the order the host decided. `static` is a circle with nowhere to go
 * yet — an inert `<span>` even when the row has an `onOpen` (a highlight circle until the viewer
 * learns groups in plan 05).
 */
export type StoryStripCircle =
  | (StoryStripCircleBase & { kind: 'link'; href: string })
  | (StoryStripCircleBase & { kind: 'open'; group: number; index: number })
  | (StoryStripCircleBase & { kind: 'static' });

export interface StoriesStripProps {
  /** The row, in render order. Empty → no node at all (UI-D-26). */
  circles: readonly StoryStripCircle[];
  /** `aria-label` of the row's `role="list"` landmark. */
  regionLabel: string;
  loading?: boolean;
  /** Opens the viewer at `(group, index)`. Absent → every `open` circle is inert. */
  onOpen?: (group: number, index: number) => void;
}

/** The row's own classes, shared by the content and loading shapes so the swap cannot shift layout. */
const ROW = 'flex gap-4 overflow-x-auto overscroll-x-contain px-4 py-3 scrollbar-none';

/** Above-the-fold on `/inicio`: the first three discs load eagerly, the rest lazily. */
const EAGER_CIRCLES = 3;

export function StoriesStrip({ circles, regionLabel, loading = false, onOpen }: StoriesStripProps) {
  if (loading) {
    // Three 64px circles with 12px label bars at the REAL geometry (68px = 64 + the 2px ring and
    // its 2px inset), so the feed below does not jump when content replaces them.
    return (
      <div className={ROW} aria-hidden data-testid="stories-strip-loading">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            data-testid="story-circle-skeleton"
            className="flex shrink-0 flex-col items-center gap-1.5"
          >
            <Skeleton variant="circle" className="h-[68px] w-[68px]" />
            <Skeleton variant="text" className="h-3 w-10 rounded-full" />
          </span>
        ))}
      </div>
    );
  }

  // UI-D-26, in one line: nothing to draw means NO NODE. The slot collapses and the column closes.
  if (circles.length === 0) return null;

  return (
    // Tailwind's preflight sets `list-style: none` on every `ul`, and WebKit then DROPS the list
    // semantics entirely — the row stops being announced as a list of N items, which is the only
    // thing telling a screen-reader user how many circles there are. The explicit role restores it,
    // and the UI-SPEC's §Stories strip contract asks for `role="list"` by name.
    // biome-ignore lint/a11y/noRedundantRoles: see the note above — it is not redundant under preflight
    <ul className={ROW} role="list" aria-label={regionLabel} data-testid="stories-strip">
      {circles.map((circle, position) => (
        <li key={circle.key}>
          <StoryCircle
            ring={circle.ring}
            disc={circle.disc}
            label={circle.label}
            actionLabel={circle.actionLabel}
            eager={position < EAGER_CIRCLES}
            href={circle.kind === 'link' ? circle.href : undefined}
            onOpen={
              circle.kind === 'open' && onOpen
                ? () => onOpen(circle.group, circle.index)
                : undefined
            }
          />
        </li>
      ))}
    </ul>
  );
}
