'use client';

import { Skeleton, useMediaQuery } from '@rede-social/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
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
 * the tenant — its name, and its logo or, since #2b (2026-10-03), the face of whoever published the
 * newest story, with the logo behind it (the `photo` disc) — whatever the number of live stories; a
 * highlight is where a story ALSO stays, never where it is taken from.
 *
 * **Three descriptor kinds.** `link` is an `<a>` to a host route (the `+` circle; the manage
 * circle and empty highlights later). `open` is a `<button>` that calls `onOpen(group, index)` with
 * its OWN pair — the tenant circle, a pinned story, a highlight circle once the viewer is
 * group-aware — and is inert until the host supplies `onOpen`. `static` is always inert: a circle
 * with nowhere to go yet renders as a span, never as a button that does nothing when tapped.
 *
 * **UI-D-47, amended on 2026-10-20 (the client's FRONT.pdf): arrows on desktop.** The circles keep
 * the phone's geometry everywhere (no fade mask, no grid reflow), but a host that names the arrows
 * (`scrollLabels`) gets two of them over the row's ends from `md` up, and ONLY while the row
 * overflows: on a desktop with a plain mouse a long row had no way to its last circles. Each pages
 * the row by its visible width less one circle, and the one at an end is disabled (and hidden).
 * They are pointer conveniences (`tabIndex={-1}`): the keyboard already walks the circles and the
 * browser scrolls the focused one into view. Without `scrollLabels` the row is exactly the phone's
 * scroller, on every screen (the platform preview passes none).
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
  /**
   * 2026-10-20: the desktop arrows' accessible names, chosen by the host. Absent → no arrows on any
   * screen, and the row renders exactly as before.
   */
  scrollLabels?: { previous: string; next: string };
}

/** The row's own classes, shared by the content and loading shapes so the swap cannot shift layout. */
const ROW =
  'flex gap-4 overflow-x-auto overscroll-x-contain px-4 py-3 scrollbar-none [&::-webkit-scrollbar]:hidden';

/** Above-the-fold on `/inicio`: the first three discs load eagerly, the rest lazily. */
const EAGER_CIRCLES = 3;

/** One arrow pages the row by its visible width less about one circle, so a circle stays in view. */
const PAGE_OVERLAP_PX = 80;
/** Sub-pixel scroll positions (a zoomed page) still count as the start or the end. */
const EDGE_SLOP_PX = 1;

export function StoriesStrip({
  circles,
  regionLabel,
  loading = false,
  onOpen,
  scrollLabels,
}: StoriesStripProps) {
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

  const items = circles.map((circle, position) => (
    <li key={circle.key}>
      <StoryCircle
        ring={circle.ring}
        disc={circle.disc}
        label={circle.label}
        actionLabel={circle.actionLabel}
        eager={position < EAGER_CIRCLES}
        href={circle.kind === 'link' ? circle.href : undefined}
        onOpen={
          circle.kind === 'open' && onOpen ? () => onOpen(circle.group, circle.index) : undefined
        }
      />
    </li>
  ));

  if (scrollLabels) {
    return (
      <ScrollableRow regionLabel={regionLabel} labels={scrollLabels}>
        {items}
      </ScrollableRow>
    );
  }

  return (
    // Tailwind's preflight sets `list-style: none` on every `ul`, and WebKit then DROPS the list
    // semantics entirely — the row stops being announced as a list of N items, which is the only
    // thing telling a screen-reader user how many circles there are. The explicit role restores it,
    // and the UI-SPEC's §Stories strip contract asks for `role="list"` by name.
    // biome-ignore lint/a11y/noRedundantRoles: see the note above — it is not redundant under preflight
    <ul className={ROW} role="list" aria-label={regionLabel} data-testid="stories-strip">
      {items}
    </ul>
  );
}

/** Where the row's scroll position stands: whether it overflows, and whether it is at either end. */
type Edges = { overflow: boolean; atStart: boolean; atEnd: boolean };

/**
 * The SAME list with the desktop arrows over its ends (UI-D-47 as amended on 2026-10-20). They exist
 * only while the row overflows, so a short row (or the server render, which cannot measure) draws
 * none and nothing shifts. The measure runs on scroll, on a resize, when the list's own box changes
 * and after every render (a circle added or removed), and only stores a change.
 */
function ScrollableRow({
  regionLabel,
  labels,
  children,
}: {
  regionLabel: string;
  labels: { previous: string; next: string };
  children: ReactNode;
}) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [edges, setEdges] = useState<Edges>({ overflow: false, atStart: true, atEnd: true });

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const max = list.scrollWidth - list.clientWidth;
    const next: Edges = {
      overflow: max > EDGE_SLOP_PX,
      atStart: list.scrollLeft <= EDGE_SLOP_PX,
      atEnd: list.scrollLeft >= max - EDGE_SLOP_PX,
    };
    setEdges((previous) =>
      previous.overflow === next.overflow &&
      previous.atStart === next.atStart &&
      previous.atEnd === next.atEnd
        ? previous
        : next,
    );
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    // Guarded: a browser (or a test DOM) without the observer still gets the scroll and resize paths.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(list);
    return () => {
      list.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure]);

  // After every render: the circles are the children, and adding one changes the scroll width
  // without changing the list's own box. `measure` stores only a change, so this cannot loop.
  useEffect(() => {
    measure();
  });

  const page = (direction: -1 | 1) => {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({
      left: direction * Math.max(PAGE_OVERLAP_PX, list.clientWidth - PAGE_OVERLAP_PX),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  };

  return (
    <div className="relative">
      <ul
        id={listId}
        ref={listRef}
        className={ROW}
        // biome-ignore lint/a11y/noRedundantRoles: the preflight note in `StoriesStrip` applies here too
        role="list"
        aria-label={regionLabel}
        data-testid="stories-strip"
      >
        {children}
      </ul>
      {edges.overflow ? (
        <>
          <ScrollArrow
            side="previous"
            label={labels.previous}
            controls={listId}
            disabled={edges.atStart}
            onPress={() => page(-1)}
          />
          <ScrollArrow
            side="next"
            label={labels.next}
            controls={listId}
            disabled={edges.atEnd}
            onPress={() => page(1)}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * One arrow: a 32px disc on the card surface inside a 44px-wide hit area as tall as the circles
 * (`top-3` is the row's own padding), from `md` up only. At its end of the row it is disabled and
 * hidden, so it neither covers the first or last circle nor takes a click.
 */
function ScrollArrow({
  side,
  label,
  controls,
  disabled,
  onPress,
}: {
  side: 'previous' | 'next';
  label: string;
  controls: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const Icon = side === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-controls={controls}
      data-stories-scroll={side}
      disabled={disabled}
      onClick={onPress}
      className={`absolute top-3 ${side === 'previous' ? 'left-0' : 'right-0'} hidden h-[68px] w-11 items-center justify-center md:flex disabled:invisible`}
    >
      <span className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-text shadow-md">
        <Icon aria-hidden size={18} />
      </span>
    </button>
  );
}
