'use client';

import { StoriesStrip, type StoriesStripProps } from '@tria/module-stories/ui';

/**
 * `/inicio`'s stories strip — the client seam, copied from `components/feed/FeedSurface.tsx`.
 *
 * **Why this shell exists.** `lib/registry.tsx` composes the strip on the SERVER: which data, which
 * labels, whether the own-circle renders, and where it points are all decided there and passed
 * straight through. The circle's OPEN handler cannot be: it drives the viewer, which is client
 * state, and a server component cannot hold a hook. So the composition splits exactly the way the
 * feed's does, and this file is where 05-06 binds `onOpen` without moving a single decision off the
 * server.
 *
 * **Until 05-06 ships `/stories/[storyId]`, no handler is bound and none is invented here.** A
 * circle without `onOpen` renders as an inert `<span>` rather than as a button that does nothing —
 * the 04-09 posture for `createHref`, which stayed absent precisely so nothing linked to a 404.
 *
 * It renders `StoriesStrip` unchanged and adds no state, no branch and no label of its own.
 */
export type StoriesSurfaceProps = StoriesStripProps;

export function StoriesSurface(props: StoriesSurfaceProps) {
  return <StoriesStrip {...props} />;
}
