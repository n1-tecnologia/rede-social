'use client';

import { Skeleton } from '@tria/ui';
import { StoryCircle, type StoryCircleVariant } from './StoryCircle';

/**
 * The `/inicio` home-slot row (UI-D-25, UI-D-26, UI-D-47) and — with another data source and the
 * neutral ring — 05-08's community "Destaques" row.
 *
 * **UI-D-26's empty is ALL OR NOTHING, and that is the component's most load-bearing behaviour.**
 * With nothing to draw it returns `null`: no node, no empty state, no reserved height, so the
 * `/inicio` column closes up and the feed rises. A member is not helped by a card announcing that
 * their organisation has broadcast nothing, and the feed's own empty state already owns "nada por
 * aqui" for that screen. An ADMIN with no active story still gets the own-circle ALONE, because it
 * is the only publish door (D-80) and a strip that disappeared would hide the feature exactly when
 * it is most needed.
 *
 * **D-78: one circle per active STORY, newest first** — never one per publisher. With V1's single
 * publisher, grouping would collapse the row to exactly one circle forever and read as a bug.
 *
 * **UI-D-47: identical geometry on desktop.** No arrows, no fade mask, no grid reflow. A circle row
 * is a phone idiom that survives unchanged inside the 680px column, and desktop-only chrome here
 * would be the first component in the product with something the mobile version lacks.
 *
 * Ships no words (PWA-03) and resolves no route (MOD-02): every string and the own-circle's href are
 * props the host chose.
 */

/** One active story, already projected and formatted by the host. */
export interface StoryCircleItem {
  id: string;
  /** The server-formatted relative time (UI-D-14) — never derived in render. */
  label: string;
  actionLabel: string;
  assetId: string | null;
  variantWidths: readonly number[];
}

/** The admin's leading circle. Present EXACTLY when the bootstrap carries `stories.story.publish`. */
export interface StoryStripOwnCircle {
  href: string;
  label: string;
  actionLabel: string;
  avatarUrl: string | null;
}

export interface StoriesStripProps {
  items: readonly StoryCircleItem[];
  /** `brand` in the live strip, `neutral` on a community page (UI-D-27). */
  ringVariant: Exclude<StoryCircleVariant, 'own'>;
  /** `aria-label` of the row's `role="list"` landmark. */
  regionLabel: string;
  loading?: boolean;
  own?: StoryStripOwnCircle;
  /** Opens the viewer at `index`. Absent until 05-06 ships the route; circles are then inert. */
  onOpen?: (index: number) => void;
}

/** The row's own classes, shared by the content and loading shapes so the swap cannot shift layout. */
const ROW = 'flex gap-4 overflow-x-auto overscroll-x-contain px-4 py-3 scrollbar-none';

/** Above-the-fold on `/inicio`: the first three thumbnails load eagerly, the rest lazily. */
const EAGER_CIRCLES = 3;

export function StoriesStrip({
  items,
  ringVariant,
  regionLabel,
  loading = false,
  own,
  onOpen,
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
  if (items.length === 0 && own === undefined) return null;

  return (
    // Tailwind's preflight sets `list-style: none` on every `ul`, and WebKit then DROPS the list
    // semantics entirely — the row stops being announced as a list of N items, which is the only
    // thing telling a screen-reader user how many stories are live. The explicit role restores it,
    // and the UI-SPEC's §Stories strip contract asks for `role="list"` by name.
    // biome-ignore lint/a11y/noRedundantRoles: see the note above — it is not redundant under preflight
    <ul className={ROW} role="list" aria-label={regionLabel} data-testid="stories-strip">
      {own ? (
        <li>
          <StoryCircle
            variant="own"
            label={own.label}
            actionLabel={own.actionLabel}
            avatarUrl={own.avatarUrl}
            href={own.href}
          />
        </li>
      ) : null}
      {items.map((item, index) => (
        <li key={item.id}>
          <StoryCircle
            variant={ringVariant}
            label={item.label}
            actionLabel={item.actionLabel}
            assetId={item.assetId}
            variantWidths={item.variantWidths}
            eager={index < EAGER_CIRCLES}
            onOpen={onOpen ? () => onOpen(index) : undefined}
          />
        </li>
      ))}
    </ul>
  );
}
