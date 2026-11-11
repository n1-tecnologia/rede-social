'use client';

import {
  StoriesStrip,
  type StoriesStripProps,
  type StoryStripCircle,
} from '@rede-social/module-stories/ui';
import { Pencil, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadHighlightItemsAction } from '@/app/(app)/stories/highlight-actions';
import {
  type likeStoryAction,
  loadAuthorStoriesAction,
  markStoriesSeenAction,
  type unlikeStoryAction,
} from '@/app/(app)/stories/story-actions';
import { sendSeenBeacon } from '@/lib/seen-batch';
import {
  fillName,
  type RowCircleView,
  type StoryGroupView,
  type StoryViewerItemView,
  type StoryViewerLabelsView,
  tenantSeenDecoration,
  tenantSeenState,
} from '@/lib/story-view';
import {
  type StoryCommentsBinding,
  type StoryGroupState,
  StoryViewerHost,
} from './StoryViewerHost';
import { createStoryInteractions } from './story-interactions';

/**
 * A place's stories row and the viewer it opens (05-05, 05-06; grouped since 05.2-05).
 *
 * **Why this shell exists.** `lib/registry.tsx` (and the community page) compose the row on the
 * SERVER: which data, which labels, which circles and where they point are all decided there and
 * passed straight through. The circle's OPEN handler cannot be — it drives the viewer, which is
 * client state, and a server component cannot hold a hook. So the composition splits exactly the
 * way the feed's does, and every decision still lives on the server.
 *
 * **The viewer plays the row's OWN groups** (D-107, UI-D-65). `viewer.groups` are built from the
 * same reads the circles were, in the same order — circle `(g, 0)` opens `groups[g]` — so the two
 * can never disagree about which circle opens what. A group with items (the tenant circle, the
 * pinned row) costs no round trip; a HIGHLIGHT group arrives with `items: null` and is read lazily
 * through `loadHighlightItemsAction` when the member enters it, or just before (the viewer asks at
 * the previous group's last story). `/inicio`'s server render therefore never carries N×M items.
 * What this shell loads it KEEPS for the page's life, and it never asks twice for the same group
 * at once (T-05.2-24). Loaded groups are then FROZEN for the viewing session (UI partial/E04).
 *
 * **The modal is a shallow history entry, not an intercepting route.** Next 16 supports
 * `window.history.pushState` natively — it updates the URL and syncs the router WITHOUT rendering
 * another route — so the back gesture pops straight back to the page with the feed still mounted
 * underneath, and `app/(app)/stories/[storyId]/page.tsx` is what a deep link or a refresh resolves
 * to. Opening a group of the TENANT's stories pushes `/stories/{id}` of the story it opens on;
 * opening a HIGHLIGHT pushes the current URL unchanged, so back still closes and a refresh never
 * lands on a route that cannot rebuild the row (05.2-05 planning decision 3).
 *
 * **The seen state lives here for the page's life** (05.2-10: HIGHLIGHT-06, D-105, R-P5). The
 * viewer reports every segment it SHOWED (`onSegmentShown`: current, media ready — never mount). This
 * shell keeps two things:
 *  - a SESSION seen set, so closing the viewer re-derives the tenant circle's ring, name and resume
 *    index from the server's `seen` flags PLUS what was just watched — it greys the moment the last
 *    unseen story was shown, with no refresh (UI-D-61). Opening the circle resumes at the first
 *    unseen story (D-105), recomputed at every open;
 *  - a BUFFER of ids the server does not know yet, flushed through `markStoriesSeenAction` on close,
 *    on a group change, at `SEEN_FLUSH_AT` ids and on unmount, and through `sendSeenBeacon` (to the
 *    same-origin `POST /api/stories/views`) when the page hides (`visibilitychange`): a server action
 *    is a plain fetch the browser may abort on unload, a beacon / keepalive fetch outlives the page
 *    (review WR-07). An id the server already reported seen, or one already sent this session, is
 *    never sent again.
 * The write is background work: a failure is logged by shape and swallowed — never a toast, never a
 * navigation — and the session set keeps the ring honest for this page either way. There is NO
 * device-local copy (no browser storage) of any of it: D-79's rejection stands, the server is the truth.
 *
 * **So does what the member DID to a story** (CR-01 for stories, the Reels host's per-post state).
 * The viewer host unmounts on every close and the groups it plays are the page-load snapshot, so a
 * like or a comment held by the host died with it and the next open drew the snapshot again: an
 * empty heart, the old count. This shell creates ONE `StoryInteractions` store for the page's life
 * and hands it to every host it mounts, so the settled like pair and the comment count survive a
 * close and a reopen, and the same story in the tenant group, in a highlight and in the `loaded`
 * cache shows one state. It is memory only, like the seen set: the next server render is the truth.
 *
 * **2026-10-20, the client's FRONT.pdf.** The row's strip takes the host's desktop arrows
 * (`scrollLabels`, passed straight through), and the viewer gets the share (`viewer.share`, the
 * tenant's verified origin and name, composed on the server). When a curator deletes a story from
 * the viewer, the action skips its revalidation (the deleted story's own URL is on screen while
 * the viewer is open), so this shell drops that story from every group at once and, once the viewer
 * has closed and the page's URL is back, refreshes the route ONCE (`router.refresh()`): the server
 * then draws the row without it.
 */
export type StoriesSurfaceProps = Omit<StoriesStripProps, 'circles'> & {
  /**
   * The row as the server composed it. A `{ kind: 'manage' }` disc (05.2-09, UI-D-63) is plain data
   * because a React node cannot cross the server/client boundary; it is drawn HERE as the module's
   * `glyph` disc with the Pencil — "edit" whether or not highlights exist.
   */
  circles: readonly RowCircleView[];
  /**
   * Absent (a place with nothing to open) leaves every circle INERT — `StoryCircle` renders a plain
   * span rather than a button that does nothing, the 04-09 `createHref` posture.
   */
  viewer?: {
    /** One group per openable circle, in the circles' order. Highlights arrive with `items: null`. */
    groups: readonly StoryGroupView[];
    labels: StoryViewerLabelsView;
    onLike: typeof likeStoryAction;
    onUnlike: typeof unlikeStoryAction;
    /** D-82's sheet, composed on the server in `lib/registry.tsx` and passed straight through. */
    comments?: StoryCommentsBinding;
    /** `stories.story.manage` from the bootstrap: the viewer's "Destacar" pill (UI-D-66). */
    canCurate?: boolean;
    /**
     * The community whose page composed this row (absent on Início and the deep link). Only the
     * empty highlight sheet's "Criar destaque" reads it, to open THAT community's manage screen.
     */
    originCommunityId?: string;
    /**
     * 05.2-10 (UI-D-61): the tenant circle wears the seen ring. Its two accessible names, read from
     * the catalog on the server; present only where a tenant circle exists (Início).
     */
    seenRing?: { seenLabel: string; unseenLabel: string };
    /**
     * 10-12 (UI-D-699): the author circles' two accessible-name TEMPLATES (`{name}` slot), so the
     * surface can re-derive an author's ring and name on close from the session's seen set. Present
     * only where the row has author circles (Explorar).
     */
    authorRing?: { seen: string; unseen: string };
    /** 10-12 (UI-D-701): who gets "Mais opções" on a member group, passed straight to the viewer. */
    memberMenu?: { canModerate: boolean; canHighlight: boolean };
    /**
     * 2026-10-20: the viewer's share control — the tenant's VERIFIED primary origin and its display
     * name, both resolved on the server. Absent: no share control.
     */
    share?: { origin: string; title: string };
  };
};

type Opened = { group: number; index: number };

/** R-P5: the buffer is flushed when it reaches this many ids (the contract caps a batch at 50). */
const SEEN_FLUSH_AT = 10;

/**
 * The two plain-data glyph discs, drawn HERE because a React node cannot cross the server/client
 * boundary: the manage circle's `Pencil` 20 (UI-D-63 a) and a member's neutral `User` (10-12,
 * UI-D-698), both on the module's tertiary disc.
 */
function toStripCircle(circle: RowCircleView): StoryStripCircle {
  if (circle.disc.kind === 'manage') {
    return { ...circle, disc: { kind: 'glyph', icon: <Pencil aria-hidden size={20} /> } };
  }
  if (circle.disc.kind === 'person') {
    return { ...circle, disc: { kind: 'glyph', icon: <User aria-hidden size={28} /> } };
  }
  return circle as StoryStripCircle;
}

export function StoriesSurface({ viewer, circles: rowCircles, ...strip }: StoriesSurfaceProps) {
  const router = useRouter();
  const seenRing = viewer?.seenRing;
  /** Every story the viewer SHOWED in this page's life (R-P5) — the optimistic half of the ring. */
  const sessionSeen = useRef(new Set<string>());
  /** The session set as of the last close: what the ring is derived from (re-derived per close). */
  const [seenAtClose, setSeenAtClose] = useState<ReadonlySet<string>>(() => new Set());
  /** Shown ids the server does not know yet, waiting for the next flush. */
  const pending = useRef<string[]>([]);
  /** Ids already sent this session: never sent twice (a failed flush forgets its ids again). */
  const sent = useRef(new Set<string>());
  /** The group the last shown segment belonged to — a change of group flushes the buffer. */
  const lastShownGroup = useRef<string | null>(null);
  /** CR-01: the likes and comment counts of this page's life, handed to every host it mounts. */
  const [interactions] = useState(createStoryInteractions);

  const authorRing = viewer?.authorRing;
  const [opened, setOpened] = useState<Opened | null>(null);
  /** Highlight and author items read so far, by group key — kept for the page's life. */
  const [loaded, setLoaded] = useState<Record<string, StoryViewerItemView[]>>({});

  const circles = useMemo(
    () =>
      rowCircles.map((circle) => {
        const stripCircle = toStripCircle(circle);
        if (stripCircle.kind !== 'open') return stripCircle;
        const group = viewer?.groups[stripCircle.group];
        // UI-D-61: ONLY the circle that opens the tenant's own stories wears the seen ring; a
        // highlight circle is an archive and keeps the neutral ring the server gave it.
        if (seenRing && group?.kind === 'tenant' && group.items !== null) {
          return {
            ...stripCircle,
            ...tenantSeenDecoration(tenantSeenState(group.items, seenAtClose), seenRing),
          };
        }
        // 10-12 (UI-D-699): an AUTHOR's circle keeps the server's ring (`hasUnseen`) until the group
        // has been read; from then on the ring and the name follow what the session has shown, so
        // closing the viewer greys it with no refresh. The member's own circle never turns brand.
        if (authorRing && group?.kind === 'member' && group.member?.isSelf === false) {
          const items = group.items ?? loaded[group.key] ?? null;
          if (items === null) return stripCircle;
          const unseen = tenantSeenState(items, seenAtClose).anyUnseen;
          return {
            ...stripCircle,
            ring: unseen ? ('brand' as const) : ('neutral' as const),
            actionLabel: fillName(unseen ? authorRing.unseen : authorRing.seen, group.name),
          };
        }
        return stripCircle;
      }),
    [rowCircles, seenRing, authorRing, viewer?.groups, seenAtClose, loaded],
  );
  /** Group keys whose last read failed; cleared by the retry. */
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  /** Reads in flight, by group key: the in-flight dedupe (T-05.2-24). */
  const inFlight = useRef(new Set<string>());
  /** A mirror of `loaded` for the request path, which must not close over a stale render. */
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  /** 2026-10-20: the stories a curator deleted from the viewer, out of every group from then on. */
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  /** A deletion the server's row does not reflect yet: the route is refreshed once the viewer closes. */
  const refreshPending = useRef(false);
  /**
   * The filtered copy of an items array, cached per array AND per deleted set: re-filtering on every
   * memo pass would hand the host a new group object each time and re-mount its media.
   */
  const withoutDeleted = useRef(
    new WeakMap<
      StoryViewerItemView[],
      { deleted: ReadonlySet<string>; items: StoryViewerItemView[] }
    >(),
  );

  /** The circle that opened the viewer: focus returns to it on close (UI-SPEC §Accessibility). */
  const originRef = useRef<HTMLElement | null>(null);
  /** True while THIS component owns the pushed entry, so a close can pop exactly the one it added. */
  const pushedRef = useRef(false);

  /**
   * The server's groups with what the client has learned since: a highlight's loaded items, or
   * that its read failed. A group object is re-created ONLY when its own state changed, so the
   * host's per-group cache keeps every other group's media functions (and so its mounted media).
   */
  const mergedRef = useRef(
    new Map<
      string,
      {
        source: StoryGroupView;
        items: StoryViewerItemView[] | null;
        failed: boolean;
        merged: StoryGroupState;
      }
    >(),
  );
  const groups = useMemo<StoryGroupState[]>(
    () =>
      (viewer?.groups ?? []).map((source) => {
        const read = source.items ?? loaded[source.key] ?? null;
        let items = read;
        if (read !== null && deleted.size > 0 && read.some((item) => deleted.has(item.id))) {
          const hit = withoutDeleted.current.get(read);
          if (hit && hit.deleted === deleted) {
            items = hit.items;
          } else {
            items = read.filter((item) => !deleted.has(item.id));
            withoutDeleted.current.set(read, { deleted, items });
          }
        }
        const isFailed = items === null && failed[source.key] === true;
        const cached = mergedRef.current.get(source.key);
        if (
          cached &&
          cached.source === source &&
          cached.items === items &&
          cached.failed === isFailed
        )
          return cached.merged;
        const merged: StoryGroupState =
          items === source.items && !isFailed ? source : { ...source, items, failed: isFailed };
        mergedRef.current.set(source.key, { source, items, failed: isFailed, merged });
        return merged;
      }),
    [viewer?.groups, loaded, failed, deleted],
  );

  /**
   * The lazy read (R-P6). Only a HIGHLIGHT group or an AUTHOR group (10-12) that has no items yet is
   * ever requested, at most once at a time; a failure marks the group for the viewer's error frame
   * and is retried only on the member's own tap. It answers the items it read (or already held), or
   * `null` when the read failed or one is already in flight.
   */
  const requestGroup = useCallback(
    async (g: number): Promise<StoryViewerItemView[] | null> => {
      const group = viewer?.groups[g];
      if (!group || group.items !== null) return null;
      const { highlightId, member } = group;
      const read =
        highlightId !== null
          ? () => loadHighlightItemsAction(highlightId)
          : member
            ? () => loadAuthorStoriesAction(member.membershipId)
            : null;
      if (read === null) return null;
      const key = group.key;
      const held = loadedRef.current[key];
      if (held) return held;
      if (inFlight.current.has(key)) return null;
      inFlight.current.add(key);
      let items: StoryViewerItemView[] | null = null;
      try {
        const result = await read();
        if (result.ok) items = result.items;
      } catch (error) {
        // A transport failure is the same group error as a refusal; shape only in the log.
        console.error('stories.group_failed', { error: String(error) });
      } finally {
        inFlight.current.delete(key);
      }
      if (items) {
        const got = items;
        setLoaded((state) => ({ ...state, [key]: got }));
      } else {
        setFailed((state) => ({ ...state, [key]: true }));
      }
      return items;
    },
    [viewer?.groups],
  );

  /** What the server already reported seen, in every group this page knows — never re-sent. */
  const serverSeen = useMemo(() => {
    const ids = new Set<string>();
    for (const group of groups)
      for (const item of group.items ?? []) if (item.seen) ids.add(item.id);
    return ids;
  }, [groups]);
  const serverSeenRef = useRef(serverSeen);
  serverSeenRef.current = serverSeen;

  /**
   * Send the buffer. Fire and forget: the viewer never waits on it, and a failure is logged by
   * SHAPE (a count, never an id) and swallowed — no toast, no navigation (planning decision 4). A
   * failed batch is forgotten from `sent`, so a later showing of the same story may try again.
   * `via: 'beacon'` is the page-hide path only (WR-07); every in-page flush uses the action.
   */
  const flush = useCallback((via: 'action' | 'beacon' = 'action') => {
    const ids = pending.current;
    if (ids.length === 0) return;
    pending.current = [];
    for (const id of ids) sent.current.add(id);
    const failed = (reason: string) => {
      console.error('stories.seen_flush_failed', { count: ids.length, reason });
      for (const id of ids) sent.current.delete(id);
    };
    const send = via === 'beacon' ? sendSeenBeacon(ids) : markStoriesSeenAction(ids);
    send.then(
      (ok) => {
        if (!ok) failed('refused');
      },
      (error: unknown) => failed(error instanceof Error ? error.name : 'unknown'),
    );
  }, []);

  /** R-D-I: the viewer showed `storyId` (current, media ready) as part of group `groupKey`. */
  const onSegmentShown = useCallback(
    (storyId: string, groupKey: string) => {
      // A group change flushes what the previous circle collected BEFORE this story joins.
      if (lastShownGroup.current !== null && lastShownGroup.current !== groupKey) flush();
      lastShownGroup.current = groupKey;
      sessionSeen.current.add(storyId);
      if (
        serverSeenRef.current.has(storyId) ||
        sent.current.has(storyId) ||
        pending.current.includes(storyId)
      )
        return;
      pending.current.push(storyId);
      if (pending.current.length >= SEEN_FLUSH_AT) flush();
    },
    [flush],
  );

  /** Both close paths end here: flush, and re-derive the ring from the session set. */
  const onViewerClosed = useCallback(() => {
    flush();
    lastShownGroup.current = null;
    setSeenAtClose(new Set(sessionSeen.current));
  }, [flush]);

  // The page going to the background (tab switch, app switch, lock) may be the last chance to send,
  // so that flush leaves on the BEACON: a server action is a plain fetch the browser may abort on
  // unload, a beacon / keepalive fetch is delivered after the page is gone (WR-07). The unmount
  // flush below is an in-page navigation and keeps the action.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush('beacon');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flush]);

  const retryGroup = useCallback(
    (g: number) => {
      const key = viewer?.groups[g]?.key;
      if (key === undefined) return;
      // Back to the loading frame first, then the read — so the retry is visibly doing something.
      setFailed((state) => ({ ...state, [key]: false }));
      void requestGroup(g);
    },
    [viewer?.groups, requestGroup],
  );

  const close = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      // Popping is what restores the page's URL; the `popstate` listener below then clears the
      // state, so closing by gesture and closing by back button take the IDENTICAL path.
      window.history.back();
      return;
    }
    setOpened(null);
    onViewerClosed();
  }, [onViewerClosed]);

  /** A tap on an author's circle while its group is still being read: the second tap does nothing. */
  const opening = useRef(false);
  const open = useCallback(
    async (group: number, index: number) => {
      const target = groups[group];
      if (!target || opening.current) return;
      originRef.current = document.activeElement as HTMLElement | null;
      let items = target.items;
      if (items === null && target.kind === 'member') {
        // An author's circle resumes at its first unseen story, which is only known once the group
        // has been read: read it BEFORE the viewer opens. A failed read opens the viewer on the
        // group's error frame and its retry, never a dead circle (UI-D-700).
        opening.current = true;
        try {
          items = await requestGroup(group);
        } finally {
          opening.current = false;
        }
      }
      // D-105: the tenant circle resumes at its first unseen story — server flags plus what this
      // session already showed — recomputed at every open, so a re-open after watching is right. So
      // does another member's circle (10-12); the member's own group starts at its first story.
      const start =
        seenRing && target.kind === 'tenant' && items
          ? tenantSeenState(items, sessionSeen.current).resumeIndex
          : target.kind === 'member' && target.member?.isSelf === false && items
            ? tenantSeenState(items, sessionSeen.current).resumeIndex
            : index;
      const story = items?.[start];
      // A group of the tenant's or an author's stories names the story it opens on; a highlight keeps
      // the URL (planning decision 3) — either way back pops exactly this entry.
      const url =
        target.kind !== 'highlight' && story ? `/stories/${story.id}` : window.location.href;
      window.history.pushState(null, '', url);
      pushedRef.current = true;
      setOpened({ group, index: start });
    },
    [groups, seenRing, requestGroup],
  );

  useEffect(() => {
    const onPopState = () => {
      pushedRef.current = false;
      setOpened(null);
      onViewerClosed();
      // The focus return has to wait for the viewer's own focus trap to restore first, or the trap
      // would move focus back out from under it as it unmounts.
      queueMicrotask(() => originRef.current?.focus?.({ preventScroll: true }));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [onViewerClosed]);

  /** 2026-10-20: a curator deleted `storyId` from the viewer (which closes right after). */
  const onStoryDeleted = useCallback((storyId: string) => {
    refreshPending.current = true;
    setDeleted((previous) => new Set(previous).add(storyId));
  }, []);

  // Once the viewer has closed after a deletion — the page's own URL back in place (the popstate
  // above ran after Next's own restore) — the route is read again ONCE, so the row the server draws
  // no longer carries the deleted story.
  useEffect(() => {
    if (opened !== null || !refreshPending.current) return;
    refreshPending.current = false;
    router.refresh();
  }, [opened, router]);

  return (
    <>
      <StoriesStrip
        {...strip}
        circles={circles}
        onOpen={viewer && groups.length > 0 ? open : undefined}
      />
      {viewer && opened !== null ? (
        <StoryViewerHost
          groups={groups}
          initialGroup={opened.group}
          initialIndex={opened.index}
          onNeedGroup={(g) => void requestGroup(g)}
          onRetryGroup={retryGroup}
          onSegmentShown={onSegmentShown}
          labels={viewer.labels}
          onLike={viewer.onLike}
          onUnlike={viewer.onUnlike}
          comments={viewer.comments}
          canCurate={viewer.canCurate}
          originCommunityId={viewer.originCommunityId ?? null}
          interactions={interactions}
          share={viewer.share}
          onStoryDeleted={onStoryDeleted}
          memberMenu={viewer.memberMenu}
          onClose={close}
        />
      ) : null}
    </>
  );
}
