'use client';

import { useCallback, useRef, useState } from 'react';
import { loadStoryAuthorsPageAction } from '@/app/(app)/stories/story-actions';
import { StoriesSurface, type StoriesSurfaceProps } from '@/components/stories/StoriesSurface';
import {
  type AuthorRowLabels,
  appendAuthors,
  type RowCircleView,
  type StoriesRowView,
  type StoryGroupView,
} from '@/lib/story-view';

/**
 * Explorar's story row (10-12: UI-D-697..UI-D-700, D-714, D-717) — the host composition between the
 * chip row and the feed, a thin client component over `StoriesSurface`.
 *
 * Which circles a viewer gets, in which order and behind which permission is the SERVER's decision
 * (`ExplorarBody`, `memberStoriesRow` and `moderatorStoriesRow` in `lib/story-view.ts`): the member's
 * own circle first and one circle per followed author, or the moderator's every-member row. This
 * shell holds only what is client state: the viewer and the lazy author groups live in the surface,
 * and here lives the moderator's PAGING.
 *
 * **The moderator's row pages 20 at a time** (UI-D-699, the cursor is the API's and OPAQUE). When the
 * row scrolls within one circle of its end the next page is read through `loadStoryAuthorsPageAction`,
 * one request at a time, with three trailing skeleton circles while it loads. The page lands AFTER the
 * circles already there (a membership already in the row is dropped), the groups number on, and the
 * cursor moves; the last page leaves no cursor, so the row stops asking. A failed page keeps every
 * loaded circle and adds ONE trailing "Recarregar" circle whose tap asks for the SAME cursor again;
 * while it is there the row does not ask on its own. A member's row is never paged (the follow graph
 * bounds it): it passes no `paging`.
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
  /** The moderator's paging: where the next page starts, the words of the author names and of the retry. */
  paging?: {
    nextCursor: string | null;
    labels: AuthorRowLabels;
    retry: { label: string; actionLabel: string };
  };
};

export function ExplorarStoriesRow({
  circles,
  groups,
  regionLabel,
  scrollLabels,
  viewer,
  paging,
}: ExplorarStoriesRowProps) {
  const [row, setRow] = useState<StoriesRowView>({
    circles: [...circles],
    groups: [...groups],
  });
  const [cursor, setCursor] = useState<string | null>(paging?.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** A ref beside the state: the gate must hold between two scroll events in one frame. */
  const inFlight = useRef(false);
  const labels = paging?.labels;

  const loadMore = useCallback(async () => {
    if (!labels || cursor === null || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setFailed(false);
    let result: Awaited<ReturnType<typeof loadStoryAuthorsPageAction>>;
    try {
      result = await loadStoryAuthorsPageAction(cursor);
    } catch {
      // A transport failure is the same answer as a refusal: the retry circle.
      result = { ok: false };
    }
    inFlight.current = false;
    setLoading(false);
    if (result.ok) {
      setRow((previous) => appendAuthors(previous, result.authors, labels));
      setCursor(result.nextCursor);
    } else {
      setFailed(true);
    }
  }, [labels, cursor]);

  const paged = paging !== undefined && cursor !== null;

  return (
    <StoriesSurface
      circles={row.circles}
      regionLabel={regionLabel}
      scrollLabels={scrollLabels}
      viewer={viewer && row.groups.length > 0 ? { ...viewer, groups: row.groups } : undefined}
      onReachEnd={paged && !failed ? () => void loadMore() : undefined}
      loadingMore={loading}
      retry={
        paged && failed && paging
          ? {
              label: paging.retry.label,
              actionLabel: paging.retry.actionLabel,
              onRetry: () => void loadMore(),
            }
          : undefined
      }
    />
  );
}
