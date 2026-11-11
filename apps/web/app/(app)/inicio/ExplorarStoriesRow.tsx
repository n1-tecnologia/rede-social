'use client';

import { StoriesSurface, type StoriesSurfaceProps } from '@/components/stories/StoriesSurface';
import type { RowCircleView, StoryGroupView } from '@/lib/story-view';

/**
 * Explorar's story row (10-12: UI-D-697..UI-D-700, D-714, D-717) — the host composition between the
 * chip row and the feed, a thin client component over `StoriesSurface`.
 *
 * Which circles a viewer gets, in which order and behind which permission is the SERVER's decision
 * (`ExplorarBody`, `memberStoriesRow` in `lib/story-view.ts`): the member's own circle first, then one
 * circle per followed author. This shell only holds what is client state: the viewer and the lazy
 * author groups live in the surface, which reads an author's stories when the circle is tapped.
 *
 * **The ring is drawn here and nowhere else (D-704).** No avatar anywhere else in the product (the
 * profile, the member list, post headers, comments, the community byline) gains a story ring or an
 * unseen marker: opening that later is easy, closing it is not. This row is the only consumer.
 */
export type ExplorarStoriesRowProps = {
  /** The row as the server composed it: circles and the viewer groups they open, in the same order. */
  circles: readonly RowCircleView[];
  groups: readonly StoryGroupView[];
  regionLabel: string;
  scrollLabels: { previous: string; next: string };
  /** The viewer's props minus its groups (the shell owns those). Absent: nothing to open. */
  viewer?: Omit<NonNullable<StoriesSurfaceProps['viewer']>, 'groups'>;
};

export function ExplorarStoriesRow({
  circles,
  groups,
  regionLabel,
  scrollLabels,
  viewer,
}: ExplorarStoriesRowProps) {
  return (
    <StoriesSurface
      circles={circles}
      regionLabel={regionLabel}
      scrollLabels={scrollLabels}
      viewer={viewer && groups.length > 0 ? { ...viewer, groups } : undefined}
    />
  );
}
