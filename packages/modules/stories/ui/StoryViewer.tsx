'use client';

import { IconButton, useFocusTrap, useMediaQuery } from '@rede-social/ui';
import { Loader2, Play, Volume2, VolumeX, X } from 'lucide-react';
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { STORY_DURATION_MS } from '../contracts/index';
import { StoryProgressBars } from './StoryProgressBars';
import { useStoryClock } from './useStoryClock';

/**
 * The full-screen story viewer (STORY-02, UI-D-30..UI-D-34) — surface 2 of the five the design
 * prototype does not have, drawn by sketch 003 and approved before this file was written. Since
 * 05.2-05 it plays a ROW of circles (D-107, UI-D-65, sketch 004).
 *
 * It is the prototype's own reels pager with the AXIS FLIPPED: a story sequence runs horizontally
 * and a dismiss runs downward, so `LIMIAR = 60`, the `0.35` rubber band, the easing curve and the
 * `|k − i| ≤ 1` neighbour window are ported as VALUES (Pitfall 12 — never as imports; that
 * directory is gitignored and is not a package).
 *
 * **The row (UI-D-65, R-D-M).** `groups` are the openable circles of the row, in row order, and the
 * position is the PAIR `(g, i)`:
 *
 * - a TAP moves one story inside the group. At a group's last story, next enters the NEXT group's
 *   first story; at a group's first story, previous enters the PREVIOUS group's LAST story — the
 *   exact mirror, so the state machine is symmetric (R A2);
 * - previous on the very first story of the row restarts that story's clock (there is nothing
 *   before it), and next after the row's last story closes the viewer (D-107 — a row on a loop
 *   would trap the member);
 * - a horizontal SWIPE skips a whole group (left = the next group's first story, right = the
 *   previous group's first story); ArrowLeft/ArrowRight keep tap semantics; swipe-down and Escape
 *   close from anywhere;
 * - a group whose items are `[]` is skipped in both directions; a group whose items are `null` has
 *   not been fetched yet and shows a LOADING frame while `onNeedGroup` asks the host for it; a
 *   group marked `failed` shows the group error with a retry (`onRetryGroup`).
 *
 * **Pitfall 4: every per-segment key is `${group.key}:${item.id}`.** The same story can sit in the
 * tenant group and in a highlight (D-111), or in two highlights (D-100). Keyed by the story id
 * alone, the two copies would share media, blocked and progress state and collide as React keys.
 *
 * **THREE THINGS A REVIEWER MUST NOT "FIX":**
 *
 * 1. **`DoubleTapHeart` is NOT mounted here, deliberately** (UI-D-31, Pitfall 7, A-5). A tap already
 *    means "advance", so the first tap of a double-tap would skip the story — the member would lose
 *    the story AND fail to like it, silently. Holding every advance for a ~300 ms disambiguation
 *    window is perceptible on the one gesture this screen exists for. Liking is the explicit 44×44
 *    heart the host puts in `actions`. The feed keeps double-tap because its card does not navigate.
 * 2. **There is no share control** (UI-D-32) — sharing is not in STORY-05 and the bottom row has
 *    exactly two actions.
 * 3. **The clock survives `prefers-reduced-motion`** (UI-D-30). Only the pager's TRANSITION
 *    collapses to an instant swap. Auto-advance is content pacing, not decoration; removing it
 *    would leave a viewer that does nothing on its own.
 *
 * **It ships no words (PWA-03) and resolves no route (MOD-02).** Every string is a `labels` prop,
 * the media is a node the HOST builds — the shipped video player binds an app-scoped server action
 * for its per-request playback token, which a module may not import — and the action row is handed
 * over whole. It fetches nothing either: a group's items arrive from the host.
 */

/** What the viewer hands the host's media renderer. The host reports; the viewer decides. */
export interface StoryMediaControls {
  /** True for the story being watched. Neighbours are mounted but must not play. */
  active: boolean;
  /** The single OR-ed pause boolean — the host pauses its own element on it. */
  paused: boolean;
  /** Starts `true`: iOS autoplays muted inline video and nothing else (Pitfall 6). */
  muted: boolean;
  /** The media can be shown. **The clock does not start until this fires** (UI loading/E03). */
  onLoad: () => void;
  /** The media cannot be shown: the error copy renders and the clock stays where it stopped. */
  onError: () => void;
  /** Video only. Arms the UI-D-34 autoplay check and counts as `onLoad`. */
  onCanPlay: () => void;
  /** Video only. Playback is really running, so the autoplay badge is not needed. */
  onPlaying: () => void;
  /** Video only. The asset's OWN time drives its segment — never a fixed timer. */
  onTimeUpdate: (currentSeconds: number, durationSeconds: number) => void;
}

export interface StoryViewerItem {
  id: string;
  mediaKind: 'image' | 'video';
  /** Empty renders NO caption node and the action row moves down (UI empty/E05). */
  caption: string;
  authorName: string;
  /** Server-formatted relative time (UI-D-14) — there is no clock in this render tree. */
  timeLabel: string;
  avatar: ReactNode;
  media: (controls: StoryMediaControls) => ReactNode;
  /** The host's like/comment row, built whole (the `LikeButton` lives in the app tier, MOD-02). */
  actions: ReactNode;
  /**
   * Called SYNCHRONOUSLY inside the play badge's click handler, so the host's `play()` still runs
   * inside the user gesture iOS requires. An effect after the fact would be one task too late.
   */
  onRequestPlay?: () => void;
}

/**
 * One circle of the row (UI-D-65, R-P6).
 *
 * - `items === null` means NOT LOADED: the loading frame shows and `onNeedGroup` fires. `[]` means
 *   loaded and EMPTY: the group is skipped in both directions. Both are the host's to decide.
 * - `failed` (with `items === null`) is a failed load: the group error and its retry render.
 * - `header` is read ONLY while the group has no story to show (loading, error); once it has one,
 *   the current story's own `avatar` / `authorName` / `timeLabel` are the header, as before.
 */
export interface StoryViewerGroup {
  key: string;
  items: readonly StoryViewerItem[] | null;
  failed?: boolean;
  header: { name: string; avatar: ReactNode };
}

export interface StoryViewerLabels {
  dialog: string;
  close: string;
  mute: string;
  unmute: string;
  previous: string;
  next: string;
  play: string;
  mediaError: string;
  retry: string;
  /** Announced while a group's items are being fetched (UI-D-65 loading, screen-reader only). */
  loadingGroup: string;
  /** The group-load failure sentence, above the shared retry (UI-D-65 error). */
  groupError: string;
  /**
   * `{group}: story {current} de {total}` — generated, bounded by the count, never member content
   * beyond the group's own name (long-text/E04).
   */
  position: (group: string, current: number, total: number) => string;
}

export interface StoryViewerProps {
  /**
   * FROZEN for the life of the viewing session, group by group: a loaded group's items never change
   * under the member's finger. A story that expires — or that an admin deletes — mid-view plays out
   * its own segment and is absent only from the NEXT strip read (UI partial/E04). The only change
   * the viewer expects is a `null` group becoming loaded (or failed) when the host answers.
   */
  groups: readonly StoryViewerGroup[];
  initialGroup?: number;
  initialIndex?: number;
  /**
   * The host fetches group `g`'s items. Called when the member ENTERS a `null` group and — the
   * prefetch — when the current story is the last of its group and the next group is `null`. It
   * may be called more than once for the same group; the host dedupes.
   */
  onNeedGroup?: (group: number) => void;
  /** The retry in a failed group's error frame. */
  onRetryGroup?: (group: number) => void;
  /**
   * Fired ONCE each time a segment becomes the current one and its media is ready (image `onLoad`,
   * video `onCanPlay`) — never on mount and never for a pre-mounted neighbour. Plan 05.2-10's seen
   * state consumes it. The second argument is the key of the GROUP the segment was shown in: the
   * same story may sit in two groups, so the id alone cannot tell the host that the member moved to
   * another circle (the seen buffer flushes on a group change).
   */
  onSegmentShown?: (storyId: string, groupKey: string) => void;
  labels: StoryViewerLabels;
  onClose: () => void;
  /**
   * 05-07 feeds the open comment sheet in here — the SAME boolean the hold gesture writes, so
   * "hold to pause" and "the sheet is open" are one mechanism rather than two that can disagree.
   */
  externallyPaused?: boolean;
  /**
   * A node rendered INSIDE the dialog, above everything else — 05-07's `CommentSheet`.
   *
   * It is INJECTED rather than imported for the reason the action row is: `CommentSheet` lives in
   * `@rede-social/module-feed` and `turbo boundaries` denies a `module -> module` package edge (MOD-02),
   * so the composition happens in `apps/web`, which may reach both. 05-06 resolved the identical
   * edge for `LikeButton` the same way.
   *
   * It is a CHILD of the dialog root rather than a sibling, and that placement is load-bearing
   * twice over. The root's focus trap enumerates its own descendants, so a sheet rendered outside
   * it would have focus yanked back out from under it; and the sheet's own Escape handler calls
   * `stopPropagation` on the panel, which only shields the viewer's `onKeyDown` when the viewer is
   * an ANCESTOR. It sits outside the gesture stage, so a tap inside the sheet is never a tap on a
   * story.
   */
  overlay?: ReactNode;
  /** Injected by the unit test; defaults to the browser's own timer and frame scheduler. */
  now?: () => number;
  requestFrame?: (callback: (timestamp: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  /** UI-D-34's window between "can play" and "is playing". */
  autoplayCheckMs?: number;
}

/** The prototype's drag threshold (`LIMIAR`), for BOTH axes — one number, one feel. */
const DRAG_THRESHOLD_PX = 60;
/** The prototype's rubber band: the stack follows the finger at a fraction of the distance. */
const RUBBER_BAND = 0.35;
/** The prototype's settle. Collapsed to an instant swap under reduced motion. */
const PAGER_TRANSITION = 'transform 0.42s cubic-bezier(0.2, 0.715, 0.205, 0.99)';
/** A release later than this is a HOLD, not a tap. */
const TAP_MAX_MS = 200;
/** A release further than this is a DRAG, not a tap. */
const TAP_MAX_PX = 10;
/** Left third = previous, right two-thirds = next: the larger target matches the dominant direction. */
const PREVIOUS_ZONE = 1 / 3;
/** The prototype's two-stop veil (UI-D-33), kept verbatim so the ink reads over any photograph. */
const VEIL =
  'linear-gradient(180deg, rgba(0,0,0,0.5), transparent 22%, transparent 52%, rgba(0,0,0,0.72))';
/**
 * Above the shell's `z-50` BottomNav and below `ConfirmDialog` / `BottomSheet` at `z-[55]`, the
 * rung 05-05's publish frame already had to claim. The UI-SPEC says `z-50`; the nav really does
 * intercept there (a measured e2e failure, not a hypothesis), and a comment sheet must still open
 * over the viewer in 05-07.
 */
const VIEWER_Z = 'z-[52]';

type MediaState = 'loading' | 'ready' | 'error';

type MediaHandlers = Omit<StoryMediaControls, 'active' | 'paused' | 'muted'>;

/**
 * The viewer's position. `landLast` is the pending "land on the LAST story" of a previous group
 * that was entered before its items arrived (the mirror of next, R A2). `dir` is the direction of
 * the move that got here, so an empty group can be skipped the way the member was going. `serial`
 * counts navigations: it is what makes a revisit of the same segment a new showing (G9).
 */
type Position = { g: number; i: number; landLast: boolean; dir: 1 | -1; serial: number };

/** Pitfall 4's composite key — the ONE place a per-segment key is built. */
function segmentKey(group: { key: string }, item: { id: string }): string {
  return `${group.key}:${item.id}`;
}

/** A group the member can land on: not loaded yet (it will load), failed (it offers a retry) or non-empty. */
function enterable(group: StoryViewerGroup | undefined): boolean {
  return group !== undefined && (group.items === null || group.items.length > 0);
}

function nextEnterable(groups: readonly StoryViewerGroup[], from: number): number {
  for (let h = from + 1; h < groups.length; h += 1) if (enterable(groups[h])) return h;
  return -1;
}

function previousEnterable(groups: readonly StoryViewerGroup[], from: number): number {
  for (let h = Math.min(from, groups.length) - 1; h >= 0; h -= 1)
    if (enterable(groups[h])) return h;
  return -1;
}

/** One mounted pager slot: a story of the neighbour window and where it sits relative to the current. */
type Slot = { key: string; item: StoryViewerItem; rel: -1 | 0 | 1 };

export function StoryViewer({
  groups,
  initialGroup = 0,
  initialIndex = 0,
  onNeedGroup,
  onRetryGroup,
  onSegmentShown,
  labels,
  onClose,
  externallyPaused = false,
  overlay,
  now,
  requestFrame,
  cancelFrame,
  autoplayCheckMs = 400,
}: StoryViewerProps) {
  const [pos, setPos] = useState<Position>(() => {
    const g = Math.min(Math.max(initialGroup, 0), Math.max(groups.length - 1, 0));
    const length = groups[g]?.items?.length ?? 0;
    const i = Math.min(Math.max(initialIndex, 0), Math.max(length - 1, 0));
    return { g, i, landLast: false, dir: 1, serial: 0 };
  });
  const [drag, setDrag] = useState({ active: false, dx: 0, dy: 0 });
  const [holding, setHolding] = useState(false);
  const [keyboardPaused, setKeyboardPaused] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [muted, setMuted] = useState(true);
  // Every map below is keyed by `segmentKey(group, item)` — never by the story id (Pitfall 4).
  const [mediaState, setMediaState] = useState<Record<string, MediaState>>({});
  const [canPlay, setCanPlay] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState<Record<string, boolean>>({});
  const [blocked, setBlocked] = useState<Record<string, boolean>>({});
  const [videoProgress, setVideoProgress] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState<Record<string, number>>({});
  const [playAttempt, setPlayAttempt] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  /** A navigation: a new position AND a new showing of whatever lands in front of the member. */
  const move = useCallback((g: number, i: number, dir: 1 | -1, landLast = false) => {
    setPos((prev) => ({ g, i, landLast, dir, serial: prev.serial + 1 }));
  }, []);

  /* ── Where the member is ─────────────────────────────────────────────────────────────────────── */

  const group = groups[pos.g];
  const groupItems = group?.items && group.items.length > 0 ? group.items : null;
  // A pending "land on the last story" resolves the moment the items arrive — derived here, so the
  // first frame with items is already the right one; the effect below only tidies the state.
  const index = groupItems
    ? pos.landLast
      ? groupItems.length - 1
      : Math.min(pos.i, groupItems.length - 1)
    : 0;
  const current = groupItems?.[index] ?? null;
  /** What fills the screen: a story, or one of the three frames a group without one shows. */
  const frame: 'story' | 'loading' | 'error' | 'empty' =
    group === undefined
      ? 'empty'
      : group.items === null
        ? group.failed
          ? 'error'
          : 'loading'
        : group.items.length === 0
          ? 'empty'
          : 'story';
  const currentKey =
    current && group ? segmentKey(group, current) : `${group?.key ?? ''}:#${frame}`;
  const isVideo = current?.mediaKind === 'video';
  const currentState: MediaState = current ? (mediaState[currentKey] ?? 'loading') : 'loading';
  const autoplayBlocked = current !== null && blocked[currentKey] === true;

  /**
   * ONE boolean, three sources plus the two the surface owns: the hold gesture, the host's external
   * flag (05-07's comment sheet), document visibility — so backgrounding the PWA never burns a
   * story — the space key, and an expanded caption, because reading is the reason to stop.
   * A video that will not start joins them (UI-D-34): the bar must never fill over a frozen frame.
   */
  const paused =
    holding ||
    externallyPaused ||
    documentHidden ||
    keyboardPaused ||
    captionExpanded ||
    autoplayBlocked;

  /**
   * NEXT (UI-D-65): the next story of the group; at the group's last story (or from a loading or
   * error frame) the next enterable group's FIRST story; after the row's last story the viewer
   * CLOSES (D-107) — a row on a loop traps the member.
   */
  const goNext = useCallback(() => {
    if (groupItems && index < groupItems.length - 1) {
      move(pos.g, index + 1, 1);
      return;
    }
    const target = nextEnterable(groups, pos.g);
    if (target < 0) {
      onClose();
      return;
    }
    move(target, 0, 1);
  }, [groupItems, index, groups, pos.g, move, onClose]);

  const clock = useStoryClock({
    durationMs: STORY_DURATION_MS,
    // The clock waits for the media (a slow image must not burn five seconds invisibly), never
    // drives a VIDEO — a video's own time does, so a stall desynchronises nothing — and never runs
    // over a frame with no story in it (a group loading, failed or empty).
    paused: paused || current === null || currentState !== 'ready' || isVideo,
    itemKey: currentKey,
    onComplete: goNext,
    now,
    requestFrame,
    cancelFrame,
  });

  /**
   * PREVIOUS, the exact mirror of next (R A2): the previous story of the group; at the group's
   * first story the previous enterable group's LAST story (landing on it once its items arrive, if
   * they have not yet); on the row's very first story there is nothing before it, so its clock
   * restarts instead.
   */
  const goPrevious = useCallback(() => {
    if (groupItems && index > 0) {
      move(pos.g, index - 1, -1);
      return;
    }
    const target = previousEnterable(groups, pos.g);
    if (target < 0) {
      clock.restart();
      return;
    }
    const items = groups[target]?.items ?? null;
    move(target, items ? items.length - 1 : 0, -1, items === null);
  }, [groupItems, index, groups, pos.g, move, clock]);

  /** A left swipe (R-D-M): the next group's FIRST story, or close after the row's last group. */
  const skipNext = useCallback(() => {
    const target = nextEnterable(groups, pos.g);
    if (target < 0) {
      onClose();
      return;
    }
    move(target, 0, 1);
  }, [groups, pos.g, move, onClose]);

  /**
   * A right swipe (R-D-M): the previous group's FIRST story. In the row's first group there is no
   * previous group, so the swipe returns to that group's first story (restarting it if already
   * there) — the start of the row, as far back as a swipe can go.
   */
  const skipPrevious = useCallback(() => {
    const target = previousEnterable(groups, pos.g);
    if (target >= 0) {
      move(target, 0, -1);
      return;
    }
    if (index > 0) move(pos.g, 0, -1);
    else clock.restart();
  }, [groups, pos.g, index, move, clock]);

  /** Swipes and the X close through the latest `onClose` without re-arming the effects below. */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onNeedGroupRef = useRef(onNeedGroup);
  onNeedGroupRef.current = onNeedGroup;
  const onSegmentShownRef = useRef(onSegmentShown);
  onSegmentShownRef.current = onSegmentShown;

  /**
   * Tidies the two derived resolutions into state: a pending "land last" whose items arrived, and a
   * group that turned out EMPTY — skipped the way the member was going. Past the row's last group
   * that is a close (D-107); before the row's first, the nearest group ahead instead.
   */
  useEffect(() => {
    if (frame === 'story' && pos.landLast && groupItems) {
      setPos((prev) => ({ ...prev, i: groupItems.length - 1, landLast: false }));
      return;
    }
    if (frame !== 'empty') return;
    const target = pos.dir === 1 ? nextEnterable(groups, pos.g) : previousEnterable(groups, pos.g);
    if (target >= 0) {
      const items = groups[target]?.items ?? null;
      const last = pos.dir === -1;
      setPos((prev) => ({
        g: target,
        i: last && items ? items.length - 1 : 0,
        landLast: last && items === null,
        dir: prev.dir,
        serial: prev.serial + 1,
      }));
      return;
    }
    const ahead = pos.dir === -1 ? nextEnterable(groups, pos.g) : -1;
    if (ahead >= 0)
      setPos((prev) => ({ g: ahead, i: 0, landLast: false, dir: 1, serial: prev.serial + 1 }));
    else onCloseRef.current();
  }, [frame, pos.landLast, pos.dir, pos.g, groupItems, groups]);

  /** Entering a group that has not loaded asks the host for it (UI-D-65 loading). */
  useEffect(() => {
    if (frame === 'loading') onNeedGroupRef.current?.(pos.g);
  }, [frame, pos.g]);

  /**
   * The PREFETCH: while the member watches a group's last story, the next group's items are
   * requested, so crossing the boundary lands on a story rather than on a spinner.
   */
  const prefetch = (() => {
    if (!groupItems || index < groupItems.length - 1) return -1;
    const target = nextEnterable(groups, pos.g);
    const next = groups[target];
    return next && next.items === null && !next.failed ? target : -1;
  })();
  useEffect(() => {
    if (prefetch >= 0) onNeedGroupRef.current?.(prefetch);
  }, [prefetch]);

  /**
   * "Segment shown" (plan 05.2-10's seen state): ONE report per showing — the segment is the
   * current one AND its media is ready. A neighbour decoding in the pre-buffer is not shown; an
   * unrelated re-render is not a new showing; coming back to it after a move is.
   */
  const showing = `${pos.serial}|${currentKey}`;
  const shownRef = useRef<string | null>(null);
  const shownGroupKey = group?.key ?? '';
  useEffect(() => {
    if (!current || currentState !== 'ready' || shownRef.current === showing) return;
    shownRef.current = showing;
    onSegmentShownRef.current?.(current.id, shownGroupKey);
  }, [showing, current, currentState, shownGroupKey]);

  /** White status-bar ink over the media, REMOVED on unmount — the prototype's own hook. */
  useEffect(() => {
    const root = document.documentElement;
    // The CSS keyword rather than the prototype's hex: UI-03 allows colour literals in the token
    // file alone, and `white` is the same colour with none of the drift.
    root.style.setProperty('--statusbar-ink', 'white');
    return () => {
      root.style.removeProperty('--statusbar-ink');
    };
  }, []);

  /** Backgrounding the app pauses the sequence instead of spending it (T-05-38). */
  useEffect(() => {
    const onVisibility = () => setDocumentHidden(document.visibilityState === 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /** A skip closes an expanded caption; otherwise the next story would open already paused. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reset is keyed on the SEGMENT change
  useEffect(() => {
    setCaptionExpanded(false);
  }, [currentKey]);

  useFocusTrap(rootRef, true, onClose);

  /**
   * Focus lands on CLOSE, not on the first tab stop. `useFocusTrap` moves it to the first focusable
   * descendant — the previous-story zone — and the UI-SPEC asks for the exit. Declared AFTER the
   * trap so this effect runs second and wins.
   */
  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[data-story-close]')
      ?.focus({ preventScroll: true });
  }, []);

  /**
   * UI-D-34. "Did not start" is a STATE: `canplay` arms a short check, and if playback has not
   * begun by then the clock STAYS PAUSED and the badge renders. One tap starts both.
   */
  useEffect(() => {
    if (current?.mediaKind !== 'video') return;
    if (!canPlay[currentKey] || playing[currentKey]) return;
    const key = currentKey;
    const timer = setTimeout(() => {
      setBlocked((state) => ({ ...state, [key]: true }));
    }, autoplayCheckMs);
    return () => clearTimeout(timer);
  }, [current, currentKey, canPlay, playing, autoplayCheckMs]);

  /* ── The neighbour window ──────────────────────────────────────────────────────────────────────
   *
   * `i ± 1` inside the group, plus — at the group's edges — the next group's FIRST story (the
   * pre-buffer for the boundary, R-P6) and the previous group's LAST story (so a story leaving
   * across a boundary slides out instead of vanishing). Each slot sits at `rel` ∈ {-1, 0, 1} from
   * the current story and is keyed by its composite key, so a move REUSES the mounted node: the
   * decoded image in the pre-buffer is the one that slides in.
   */
  const slots = useMemo<Slot[]>(() => {
    const list: Slot[] = [];
    if (!group) return list;
    const lastOfPrevious = (): Slot | null => {
      const previous = groups[previousEnterable(groups, pos.g)];
      const items = previous?.items;
      const last = items?.[items.length - 1];
      return previous && last ? { key: segmentKey(previous, last), item: last, rel: -1 } : null;
    };
    const firstOfNext = (): Slot | null => {
      const next = groups[nextEnterable(groups, pos.g)];
      const first = next?.items?.[0];
      return next && first ? { key: segmentKey(next, first), item: first, rel: 1 } : null;
    };

    if (!groupItems) {
      const before = lastOfPrevious();
      if (before) list.push(before);
      return list;
    }
    const before = groupItems[index - 1];
    const here = groupItems[index];
    const after = groupItems[index + 1];
    const previousSlot = before
      ? ({ key: segmentKey(group, before), item: before, rel: -1 } as const)
      : lastOfPrevious();
    if (previousSlot) list.push(previousSlot);
    if (here) list.push({ key: segmentKey(group, here), item: here, rel: 0 });
    const nextSlot = after
      ? ({ key: segmentKey(group, after), item: after, rel: 1 } as const)
      : firstOfNext();
    if (nextSlot) list.push(nextSlot);
    return list;
  }, [group, groups, groupItems, index, pos.g]);

  /* ── The media controls ────────────────────────────────────────────────────────────────────────
   *
   * These used to be a render-time factory, and that factory was the root cause of GAP 2: it handed
   * every media child brand-new `onLoad`/`onError` functions on every pass, and a child that takes
   * a report callback as an effect dependency (`MediaImage` did) then re-arms its effect on every
   * pass — a loop that ran a verifier probe to a JavaScript heap out-of-memory. `MediaImage` is
   * fixed at its own end too, but a component that destabilises its children is a defect waiting
   * for the next consumer to rediscover, so it is fixed at BOTH ends.
   *
   * The structure is a per-segment cache over a live ref:
   *   1. the ref carries the only two VOLATILE things the handlers need (the current segment's key
   *      and the current `goNext`), so no handler has to close over them;
   *   2. the handlers are cached per COMPOSITE segment key for the viewer's life — each closes over
   *      its own key alone, and every state write is a functional updater, so nothing else needs
   *      capturing. A segment keeps the same handler identities however the row changes around it
   *      (a group loading, a move, a mute toggle);
   *   3. the control-object map is memoised over the four things that legitimately change it. A
   *      mute toggle SHOULD hand the video bridge a new object; a keystroke should not.
   */
  const liveRef = useRef({ currentKey, goNext });
  liveRef.current = { currentKey, goNext };

  const handlerCache = useRef(new Map<string, MediaHandlers>());
  const handlersFor = useCallback((key: string): MediaHandlers => {
    const cached = handlerCache.current.get(key);
    if (cached) return cached;
    const created: MediaHandlers = {
      onLoad: () => setMediaState((state) => ({ ...state, [key]: 'ready' })),
      onError: () => setMediaState((state) => ({ ...state, [key]: 'error' })),
      onCanPlay: () => {
        setMediaState((state) => ({ ...state, [key]: 'ready' }));
        setCanPlay((state) => ({ ...state, [key]: true }));
      },
      onPlaying: () => {
        setPlaying((state) => ({ ...state, [key]: true }));
        setBlocked((state) => ({ ...state, [key]: false }));
      },
      onTimeUpdate: (currentSeconds: number, durationSeconds: number) => {
        if (durationSeconds <= 0) return;
        const ratio = currentSeconds / durationSeconds;
        setVideoProgress((state) => ({ ...state, [key]: ratio }));
        // The live ref rather than a render closure: same rule, read at call time.
        if (ratio >= 1 && key === liveRef.current.currentKey) liveRef.current.goNext();
      },
    };
    handlerCache.current.set(key, created);
    return created;
  }, []);

  const mediaControls = useMemo(() => {
    const map = new Map<string, StoryMediaControls>();
    for (const slot of slots) {
      const active = slot.key === currentKey;
      map.set(slot.key, { active, paused: paused || !active, muted, ...handlersFor(slot.key) });
    }
    return map;
  }, [slots, currentKey, paused, muted, handlersFor]);

  /* ── Gestures ──────────────────────────────────────────────────────────────────────────────── */

  const clockNow =
    now ?? (() => (typeof performance === 'undefined' ? Date.now() : performance.now()));
  const press = useRef<{ x: number; y: number; t: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    press.current = { x: event.clientX, y: event.clientY, t: clockNow() };
    setDrag({ active: true, dx: 0, dy: 0 });
    // Hold-to-pause starts on PRESS. A tap pauses for the few milliseconds it lasts, which is free.
    setHolding(true);
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety (it keeps a fast drag attached); its absence changes nothing.
      }
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (!start) return;
    setDrag({ active: true, dx: event.clientX - start.x, dy: event.clientY - start.y });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    press.current = null;
    setDrag({ active: false, dx: 0, dy: 0 });
    setHolding(false);
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const elapsed = clockNow() - start.t;

    // A TAP: short and still. Anything else was a hold (already handled by the pause above) or a
    // drag — and a hold that moved nowhere must not also advance the story.
    if (elapsed <= TAP_MAX_MS && Math.abs(dx) <= TAP_MAX_PX && Math.abs(dy) <= TAP_MAX_PX) {
      const box = stageRef.current?.getBoundingClientRect();
      const width =
        box && box.width > 0 ? box.width : typeof window === 'undefined' ? 0 : window.innerWidth;
      const left = box && box.width > 0 ? box.left : 0;
      const zone = width > 0 ? (event.clientX - left) / width : 1;
      if (zone < PREVIOUS_ZONE) goPrevious();
      else goNext();
      return;
    }

    // The DOMINANT AXIS decides, so one gesture never both moves through the row AND dismisses.
    // Horizontal is a GROUP skip (R-D-M): Instagram's "swipe between accounts".
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx <= -DRAG_THRESHOLD_PX) skipNext();
      else if (dx >= DRAG_THRESHOLD_PX) skipPrevious();
      return;
    }
    // Down dismisses — from ANY frame, loading and error included; UP is deliberately inert.
    if (dy >= DRAG_THRESHOLD_PX) onClose();
  };

  const onPointerCancel = () => {
    press.current = null;
    setDrag({ active: false, dx: 0, dy: 0 });
    setHolding(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // The arrows keep TAP semantics (one story), not the swipe's group skip.
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goNext();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goPrevious();
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      // Space is also the activation key: while a control has focus it belongs to that control.
      const target = event.target as HTMLElement | null;
      if (target && target !== event.currentTarget && target.closest('button, a, input, textarea'))
        return;
      event.preventDefault();
      setKeyboardPaused((value) => !value);
    }
  };

  /* ── Render ────────────────────────────────────────────────────────────────────────────────── */

  const horizontal = Math.abs(drag.dx) > Math.abs(drag.dy);
  const offsetX = drag.active && horizontal ? drag.dx * RUBBER_BAND : 0;
  const offsetY = drag.active && !horizontal && drag.dy > 0 ? drag.dy * RUBBER_BAND : 0;
  const slideTransition = reduceMotion ? 'none' : PAGER_TRANSITION;

  const progress = current ? (isVideo ? (videoProgress[currentKey] ?? 0) : clock.progress) : 0;
  /** A frame with no story still draws ONE empty segment (UI-D-65 loading). */
  const barItems = useMemo(() => groupItems ?? [{ id: `#${frame}` }], [groupItems, frame]);
  const positionLabel = useMemo(() => {
    if (frame === 'loading') return labels.loadingGroup;
    if (frame === 'error') return labels.groupError;
    if (!groupItems || !group) return '';
    return labels.position(group.header.name, index + 1, groupItems.length);
  }, [labels, frame, group, groupItems, index]);

  return (
    // `touchAction: 'none'` is what stops the browser stealing the drag and turning a swipe into a
    // scroll or a back-navigation — the single most important style in this file.
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
      tabIndex={-1}
      data-story-group={pos.g}
      data-story-index={index}
      data-paused={paused ? 'true' : 'false'}
      onKeyDown={onKeyDown}
      className={`fixed inset-0 ${VIEWER_Z} overflow-hidden bg-black text-white select-none`}
      style={{ touchAction: 'none' }}
    >
      <div
        ref={stageRef}
        data-testid="story-stage"
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          data-testid="story-pager"
          className="absolute inset-0"
          style={{
            // The pager follows the finger and settles back; each SLOT carries its own place in
            // the row, so a move slides the slots rather than the whole track.
            transform: `translate(${offsetX}px, ${offsetY}px)`,
            transition: drag.active || reduceMotion ? 'none' : PAGER_TRANSITION,
          }}
        >
          {slots.map((slot) => (
            // The neighbour window IS the pre-buffer: the next story has already decoded when the
            // move lands, so a pager frame is never an empty box — across a group boundary too.
            <div
              key={slot.key}
              data-segment-key={slot.key}
              className="absolute inset-0"
              style={{ transform: `translateX(${slot.rel * 100}%)`, transition: slideTransition }}
            >
              <div
                className="absolute inset-0 grid place-items-center"
                key={attempt[slot.key] ?? 0}
              >
                {(() => {
                  const controls = mediaControls.get(slot.key);
                  return controls ? slot.item.media(controls) : null;
                })()}
              </div>
            </div>
          ))}
        </div>

        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: VEIL }}
        />

        {/* The tap zones carry the two directions' accessible NAMES and are reachable by keyboard.
            They are `pointer-events-none` so a real tap lands on the stage above, where the same
            zone maths runs alongside the hold and drag detection — one gesture pipeline, not two. */}
        <div className="pointer-events-none absolute inset-0 flex">
          <button
            type="button"
            aria-label={labels.previous}
            onClick={goPrevious}
            className="h-full basis-1/3 focus-visible:outline-none"
          />
          <button
            type="button"
            aria-label={labels.next}
            onClick={goNext}
            className="h-full basis-2/3 focus-visible:outline-none"
          />
        </div>
      </div>

      {/* ── OUTSIDE the stage, deliberately (CR-04) ─────────────────────────────────────────────
          Every control below used to live INSIDE the div above, the one that owns
          `onPointerDown`/`onPointerMove`/`onPointerUp`. A tap on one therefore also ran the
          stage's tap-zone maths and advanced the story: the member pressed "play" and lost the
          story instead. The viewer must not mount two different meanings on the same tap.

          The isolation is STRUCTURAL rather than propagational — a control that is not in the
          subtree carrying the handlers cannot bubble into them, and there is no propagation-halting
          call anywhere in this file for a later edit to delete by accident. They keep their `z-[4]`, which sits above
          the stage in the same stacking context the header row (`z-[3]`) already uses.

          COVERAGE, stated accurately: `story-viewer.test.tsx` cases 12a-12c pin the structural half
          — the badge and the retry are siblings of the stage, and a tap on either does not advance.
          The HIT-TESTING half (a tap on the error COPY falling through to the stage via
          `pointer-events-none`) is asserted by NO automated test: happy-dom does not hit-test, and
          no browser-level spec in this repo drives these controls. It is carried as an open human
          check in the phase's verification pack (WR-09). */}

      {frame === 'loading' ? (
        // UI-D-65 loading: the black frame IS the root; the spinner is decoration (the live region
        // below carries the words), and it is transparent to taps so the row stays navigable.
        <div className="pointer-events-none absolute inset-0 z-[2] grid place-items-center">
          <Loader2
            data-testid="story-group-loading"
            size={24}
            aria-hidden
            className="animate-spin text-white/70"
          />
        </div>
      ) : null}

      {frame === 'error' ? (
        // UI-D-65 error: the shipped media-error block with the GROUP's sentence. The same two-part
        // idiom as below — the container ignores taps, only the retry takes one — so close and
        // swipe stay live over a group that could not load.
        <div
          data-testid="story-group-error"
          className="pointer-events-none absolute inset-0 z-[4] flex flex-col items-center justify-center gap-3 px-8 text-center"
        >
          <p className="text-sm">{labels.groupError}</p>
          <button
            type="button"
            onClick={() => onRetryGroup?.(pos.g)}
            className="pointer-events-auto text-sm font-bold underline"
          >
            {labels.retry}
          </button>
        </div>
      ) : null}

      {isVideo && autoplayBlocked ? (
        // The badge occupies only its own box, so the area around it stays tappable by the stage.
        <button
          type="button"
          data-testid="story-autoplay-badge"
          aria-label={labels.play}
          onClick={() => {
            setBlocked((state) => ({ ...state, [currentKey]: false }));
            setPlayAttempt((value) => value + 1);
            // Synchronously inside the gesture: iOS grants playback to the handler, not to a
            // later effect.
            current?.onRequestPlay?.();
          }}
          className="absolute top-1/2 left-1/2 z-[4] grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white"
          data-play-attempt={playAttempt}
        >
          <Play size={24} aria-hidden className="fill-current" />
        </button>
      ) : null}

      {current && currentState === 'error' ? (
        // `absolute inset-0` as a SIBLING of the stage would swallow every tap on the whole screen,
        // and the member could no longer advance past a failed story. So: the container is
        // transparent to hit-testing and only the control that needs a tap of its own takes one —
        // the same two-part idiom the veil and the tap-zone row use above, for the same reason.
        <div
          data-testid="story-media-error"
          className="pointer-events-none absolute inset-0 z-[4] flex flex-col items-center justify-center gap-3 px-8 text-center"
        >
          <p className="text-sm">{labels.mediaError}</p>
          <button
            type="button"
            onClick={() =>
              setAttempt((state) => {
                setMediaState((media) => ({ ...media, [currentKey]: 'loading' }));
                return { ...state, [currentKey]: (state[currentKey] ?? 0) + 1 };
              })
            }
            className="pointer-events-auto text-sm font-bold underline"
          >
            {labels.retry}
          </button>
        </div>
      ) : null}

      {/* The CURRENT group's bars only, reset on a group change (UI-D-65) — keyed by the group so
          crossing from N bars to M never reuses a stale segment. */}
      <StoryProgressBars
        items={barItems}
        index={index}
        progress={progress}
        groupKey={group?.key ?? ''}
      />

      {/* Exactly ONE polite region for the whole viewer: the bars are silent, so the position is
          announced once per story rather than sixty times a second. */}
      <span aria-live="polite" data-testid="story-position" className="sr-only">
        {positionLabel}
      </span>

      <div
        className="absolute right-0 left-0 z-[3] flex items-center gap-2.5 px-4"
        style={{ top: 'calc(var(--safe-top) + 24px)' }}
      >
        {current ? current.avatar : group?.header.avatar}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">
            {current ? current.authorName : group?.header.name}
          </span>
          {current ? (
            <span className="block text-xs text-white/75">{current.timeLabel}</span>
          ) : null}
        </span>
        <IconButton
          icon={muted ? VolumeX : Volume2}
          size={20}
          label={muted ? labels.unmute : labels.mute}
          onClick={() => setMuted((value) => !value)}
          className="bg-black/35 text-white"
        />
        <IconButton
          data-story-close=""
          icon={X}
          size={20}
          label={labels.close}
          onClick={onClose}
          className="text-white"
        />
      </div>

      <div
        className="absolute right-0 left-0 z-[3] px-4"
        style={{ bottom: 'calc(var(--safe-bottom) + 12px)' }}
      >
        {current && current.caption !== '' ? (
          // Collapsed it is three lines; expanded it scrolls INSIDE its own block, so a long
          // caption can never push the action row off the screen (UI overflow/E05).
          <button
            type="button"
            data-testid="story-caption"
            onClick={() => setCaptionExpanded((value) => !value)}
            className={`block w-full text-left text-base leading-relaxed drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] ${
              captionExpanded ? 'max-h-[40vh] overflow-y-auto' : 'line-clamp-3'
            }`}
          >
            {current.caption}
          </button>
        ) : null}
        <div className="-ml-2.5 mt-2 flex items-center gap-1">{current?.actions}</div>
      </div>

      {/* Last, so it paints over the veil, the caption and the action row; `BottomSheet` is
          `fixed inset-0 z-[55]`, a rung above this dialog's own `z-[52]`. */}
      {overlay}
    </div>
  );
}
