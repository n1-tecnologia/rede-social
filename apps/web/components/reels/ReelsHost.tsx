'use client';

import type { MediaPlayback } from '@rede-social/contracts/media';
import {
  CommentSheet,
  type CommentSheetProps,
  type CountTemplates,
  type LikeOutcome,
  type LikeState,
} from '@rede-social/module-feed/ui';
import {
  REELS_BUFFERING_DELAY_MS,
  REELS_MINT_MAX_IDS,
  REELS_PREFETCH_DISTANCE,
  REELS_TOKEN_REMINT_MARGIN_MS,
} from '@rede-social/module-reels/contracts';
import {
  ReelPlaybackError,
  type ReelsLane,
  ReelsLanes,
  ReelsPager,
  type ReelsPagerItem,
  ReelsStage,
} from '@rede-social/module-reels/ui';
import { Button, EmptyState, IconButton, useToast } from '@rede-social/ui';
import { CircleAlert, Film, Loader2, Volume2, VolumeX } from 'lucide-react';
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  loadReelsPageAction,
  type MintResult,
  mintReelPlaybackAction,
  type ReelsPageResult,
} from '@/app/(app)/reels/reels-actions';
import { LinkButton } from '@/app/(auth)/LinkButton';
import { isCommunityLockedCode, useCommunityLockedRefusal } from '@/components/feed/FeedSurface';
import { useSharePost } from '@/components/feed/useSharePost';
import type { ReelView } from '@/lib/reels';
import { type ReelBinder, ReelOverlay, type ReelOverlayLabels } from './ReelOverlay';
import { ReelVideo, type ReelVideoController } from './ReelVideo';

/**
 * The Reels host (05.3-08) — THE composition point of the phase: the pager, the lanes, the video
 * element, the credentials, sound, every pause source, paging and every state the UI-SPEC names.
 *
 * **Why it lives in `apps/web`.** The pager and the over-video pieces are props-only module
 * components (`@rede-social/module-reels/ui`), the like engine and the comment sheet belong to
 * `@rede-social/module-feed`, and `turbo boundaries` denies a module → module edge. The server actions
 * (pages, credentials, likes, comments) and `useToast` are app-tier too. So this file owns the ONE
 * state machine, the way `StoryViewerHost` does for the story viewer.
 *
 * **Sound (D-126, UI-D-85).** `soundOn` starts `false` on every visit and dies with this component.
 * It is never written to storage, a cookie or the server. `soundOnRef` mirrors it so a `start()`
 * issued inside a gesture reads the value of THAT instant, never a stale closure (REELS-06
 * adjacency): a page that becomes current in the same instant the viewer muted plays muted. A
 * refused unmuted `play()` flips it back (`onSoundRefused`); the button is the only on-screen
 * control and is not rendered in the empty and full-stage error states.
 *
 * **The WebKit gesture rule.** The pager calls `onActivate(next)` synchronously inside the swipe,
 * key or click, BEFORE `onIndexChange`. Here that pauses the page being left and calls
 * `start(soundOnRef.current)` on the next page's already-mounted controller, so a sound-on
 * `play()` runs inside the user's gesture. WebKit counts `touchend`, not `pointerup`, as the
 * activation for unmuted playback, so the stage wrapper's `onTouchEnd` re-issues `resume` once for
 * the page that gesture activated (RESEARCH A3; idempotent — see `ReelVideo`'s `play`).
 *
 * **Pause sources are OR-ed (UI-D-86).** The viewer's own pause (tap, Space, the badge), the open
 * comment sheet (UI-D-90, D-82) and `document.visibilityState === 'hidden'`. Coming back from the
 * sheet or the background resumes only if the viewer had not paused — and only once BOTH have
 * cleared, in either order. The badge shows for the viewer's pause and for an autoplay-blocked page.
 * Since 2026-10-09 the HOLD is a fourth source, the story viewer's: a press held on the video pauses
 * it on that frame (no badge), and letting go resumes it inside the release when nothing else holds
 * it. A swipe or a lane change that ends the press ends the hold first (`holdingRef`), so the
 * release that arrives after it never resumes the page that was left.
 *
 * **The page's actions are the feed's** (D-128..D-131). Each mounted page renders a `ReelOverlay`
 * with the feed's like engine; the double tap reaches the current page's like-only binder. Share is
 * the shipped `useSharePost` over the server-composed link. ONE `CommentSheet` — the feed's threaded
 * sheet — is rendered as a SIBLING after the stage, outside its dark scope (UI-D-98), and while it
 * is open the pager ignores gestures and keys (UI-D-90).
 *
 * **Credentials (REELS-05, RESEARCH Pattern 5, D-44).** On every window change the ±1 window's
 * assets that lack a token valid for more than `REELS_TOKEN_REMINT_MARGIN_MS` are minted in ONE
 * `mintReelPlaybackAction` call, issued before any load-more due in the same change. The map is a
 * ref that lives for the visit only. A per-asset in-flight set makes a double retry one mint, and a
 * generation counter drops a result that arrives after the window moved away from its asset; a
 * result never replaces a token that outlives it.
 *
 * **Lanes (D-117..D-120, UI-D-84).** "Todos" (server-rendered) plus one lane per community, in the
 * API's order. A lane loads on first selection, keeps its list for the visit, and always opens at
 * its newest video with the slide transition off for that frame (`instantKey`). A page that
 * resolves after a lane change is written to ITS lane only. `onLaneStep` reaches the pager only
 * with two or more lanes (D-120).
 *
 * **Per-post interaction state (CR-01).** The pager unmounts every page outside the ±1 window, so
 * what the viewer did to a post cannot live in that page. This host owns each post's settled like
 * pair (the server's `{ liked, likeCount }` from the feed's like action) for the visit, in every
 * lane, keyed by post id, and seeds every mounted page from it (`withInteraction`): a page that
 * leaves the window and comes back, a lane left and re-selected, and the same post in "Todos" and
 * in its community lane all show the one state. The like engine in each page is only the in-flight
 * optimistic layer. The host keeps the last SERVER-confirmed pair per post (`confirmed`, tagged with
 * the number of the request that produced it) and publishes it into the map when the post's LATEST
 * request settles (`likeSeq`, the engine's own `requestId` rule), whatever that request's outcome:
 * an older request's `ok` answer is remembered but never re-seeds a mounted page mid-flight into a
 * state the viewer left, an answer that lands after its page unmounted is still recorded, and a
 * refused or rejected latest request still leaves the confirmed pair for a page that remounts
 * (WR-04) instead of the stale server read. Only an `ok` answer is ever confirmed. The
 * comment count lives in the same entry (`bumpCommentCount`), as an ABSOLUTE count seeded from the
 * count the viewer was shown plus the sheet's server-confirmed deltas, so a lane read made after
 * the comment, which already counts it, is never added to twice. For the rest of the visit the
 * host's entry wins over any later lane read of the same post (a read can predate the like); the
 * map is never persisted, dies with this component, and the next visit starts from the server.
 *
 * **No watch tracking.** Nothing here records what a member watched: no view, watch-time or
 * completion event exists. The only writes are the feed's own like and comment actions.
 */

/** Everything the host shows, resolved on the server (PWA-03). Templates keep their placeholders. */
export type ReelsHostLabels = {
  region: string;
  lanesLabel: string;
  lanesAll: string;
  soundUnmute: string;
  soundMute: string;
  play: string;
  pause: string;
  previous: string;
  next: string;
  /** RAW "Vídeo {current}, de {author}" — the pager fills it. */
  position: string;
  /** RAW "Ver o perfil de {name}". */
  railAuthor: string;
  captionMore: string;
  captionLess: string;
  like: string;
  unlike: string;
  comment: string;
  share: string;
  /** RAW `feed.meta.likes.*` — the accessible full-number count. */
  likes: CountTemplates;
  emptyTitle: string;
  /** Already filled with the tenant's name. */
  emptyBody: string;
  emptyCta: string;
  errorLoad: string;
  errorRetry: string;
  errorPlayback: string;
  errorLoadMore: string;
  generic: string;
  copied: string;
  /** 08.2-09 (UI-D-376): `feed.errors.communityLocked`, the mid-session lock toast. */
  communityLocked: string;
};

/**
 * Everything the feed's `CommentSheet` needs except which post it is open on and whether it is open:
 * the page composes it with `feedCommentsProps` (D-59, one label and action block for every sheet).
 */
export type ReelsCommentsBinding = Omit<
  CommentSheetProps,
  'open' | 'onClose' | 'targetId' | 'onCountChange' | 'variant'
>;

export type ReelsHostProps = {
  /** The server-rendered first "Todos" page, or `null` when that read failed (UI-D-93a). */
  initial: { items: ReelView[]; nextCursor: string | null } | null;
  /** The communities holding a ready video, in the Comunidades order (D-76, D-119). */
  lanes: readonly { id: string; name: string }[];
  /** `feed.post.create` from the bootstrap: the empty state's "Criar publicação" (UI-D-94). */
  canPost: boolean;
  locale: string;
  /** The OS share sheet's title (T-04-52). */
  tenantName: string;
  onLike: (postId: string) => Promise<LikeOutcome>;
  onUnlike: (postId: string) => Promise<LikeOutcome>;
  /** The feed's threaded comment sheet (UI-D-90). */
  comments: ReelsCommentsBinding;
  labels: ReelsHostLabels;
};

type LaneStatus = 'idle' | 'loading' | 'ready' | 'error';
type LaneState = {
  items: ReelView[];
  nextCursor: string | null;
  status: LaneStatus;
  /** The last load-more failed: the prefetch stands down and the next end-swipe retries. */
  moreFailed: boolean;
};

/** What the viewer did to one post during this visit (CR-01): the settled like pair, the count. */
type ReelInteraction = { like?: LikeState; commentCount?: number };

/**
 * A post's view as the viewer last saw it: the SAME object when the visit has no entry for it (a
 * post nobody touched re-renders nothing), else a copy carrying the host's pair and count.
 */
function withInteraction(view: ReelView, entry: ReelInteraction | undefined): ReelView {
  if (entry === undefined) return view;
  return {
    ...view,
    ...(entry.like ? { viewerLiked: entry.like.liked, likeCount: entry.like.likeCount } : {}),
    ...(entry.commentCount === undefined ? {} : { commentCount: entry.commentCount }),
  };
}

const ALL = 'all';
const PANEL_ID = 'reels-panel';
const EMPTY_LANE: LaneState = { items: [], nextCursor: null, status: 'idle', moreFailed: false };

/** A record without `key`, or the same record when it has none (no re-render for a no-op). */
function without(record: Record<string, true>, key: string): Record<string, true> {
  if (!record[key]) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function withKeys(record: Record<string, true>, keys: readonly string[]): Record<string, true> {
  if (keys.every((key) => record[key])) return record;
  const next = { ...record };
  for (const key of keys) next[key] = true;
  return next;
}

function stopPointer(event: ReactPointerEvent) {
  event.stopPropagation();
}

/** The ±1 window of a list (REELS_MOUNT_RADIUS), in page order. */
function windowOf(items: readonly ReelView[], index: number): ReelView[] {
  return items.slice(Math.max(0, index - 1), index + 2);
}

/** The controller of a page, when its element is mounted. */
function controllerIn(
  map: Map<string, ReelVideoController>,
  postId: string | null,
): ReelVideoController | undefined {
  return postId === null ? undefined : map.get(postId);
}

/** The post a given asset belongs to, in any loaded lane. */
function postOfAsset(laneStates: Record<string, LaneState>, assetId: string): string | null {
  for (const state of Object.values(laneStates)) {
    const view = state.items.find((item) => item.video.assetId === assetId);
    if (view) return view.id;
  }
  return null;
}

/** A post's view as the viewer is shown it: in the active lane, else in any loaded lane. */
function viewOf(
  laneStates: Record<string, LaneState>,
  activeLane: string,
  postId: string,
): ReelView | null {
  const active = laneStates[activeLane]?.items.find((item) => item.id === postId);
  if (active) return active;
  for (const state of Object.values(laneStates)) {
    const view = state.items.find((item) => item.id === postId);
    if (view) return view;
  }
  return null;
}

/** Expiring within the re-mint margin counts as missing (RESEARCH Pattern 5). */
function expiresSoon(playback: MediaPlayback): boolean {
  const expires = Date.parse(playback.expiresAt);
  return !Number.isFinite(expires) || expires - Date.now() <= REELS_TOKEN_REMINT_MARGIN_MS;
}

export function ReelsHost({
  initial,
  lanes,
  canPost,
  locale,
  tenantName,
  onLike,
  onUnlike,
  comments,
  labels,
}: ReelsHostProps) {
  const toast = useToast();

  /* ── Lanes, lists and cursors ─────────────────────────────────────────────────────────────── */

  const [laneStates, setLaneStates] = useState<Record<string, LaneState>>(() => ({
    [ALL]: initial
      ? { items: initial.items, nextCursor: initial.nextCursor, status: 'ready', moreFailed: false }
      : { ...EMPTY_LANE, status: 'error' },
  }));
  const [activeLane, setActiveLane] = useState(ALL);
  const [index, setIndex] = useState(0);
  const [instantKey, setInstantKey] = useState(0);

  /**
   * CR-01: each post's settled like pair and comment count for THIS visit, keyed by the post id
   * string exactly as the feed API returns it, so one post in two lanes is one entry. Like `soundOn`,
   * it dies with the host and is never persisted.
   */
  const [interactions, setInteractions] = useState<Record<string, ReelInteraction>>({});
  /**
   * The number of the latest like request per post. It decides WHEN the confirmed pair is
   * published: only once the post's latest request has settled, so a newer toggle in flight is never
   * overwritten by an older answer (WR-04).
   */
  const likeSeq = useRef(new Map<string, number>());
  /**
   * WR-04: the last SERVER-confirmed like pair per post for this visit, tagged with the seq of the
   * request that produced it. Like `interactions`, it is visit-scoped and never persisted.
   */
  const confirmed = useRef(new Map<string, { seq: number; like: LikeState }>());

  const lane = laneStates[activeLane] ?? EMPTY_LANE;
  const items = lane.items;
  const current = items[index] ?? null;
  const currentId = current?.id ?? null;

  /* ── Sound (D-126) and the pause sources (UI-D-86) ───────────────────────────────────────── */

  const [soundOn, setSoundOn] = useState(false);
  const soundOnRef = useRef(false);

  const [viewerPaused, setViewerPaused] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  /** THE post whose comments are open (UI-D-90), or null. The sheet is a pause source. */
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const sheetOpen = sheetFor !== null;
  /** The viewer is holding the video (2026-10-09). `holdingRef` is the same fact, synchronously. */
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);
  const effectivePaused = viewerPaused || documentHidden || sheetOpen || holding;

  /* ── Per-page flags ───────────────────────────────────────────────────────────────────────── */

  /** Autoplay blocked (no `playing` after `canplay`, or a refused muted play): the badge shows. */
  const [blocked, setBlocked] = useState<Record<string, true>>({});
  /** The video will not play (a failed mint or a player error): the page's retry block shows. */
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [spinner, setSpinner] = useState(false);
  /** Bumped when the credential map changes, so the pages re-read it. */
  const [, setTokenVersion] = useState(0);

  const blockedCurrent = currentId !== null && blocked[currentId] === true;
  const failedCurrent = currentId !== null && failed[currentId] === true;

  /** The latest render, for callbacks that must not change identity (they reach the pager). */
  const latest = useRef({
    laneStates,
    activeLane,
    items,
    index,
    currentId,
    viewerPaused,
    effectivePaused,
    documentHidden,
    sheetOpen,
    otherPaused: documentHidden || sheetOpen || holding,
    blockedCurrent,
    failed,
  });
  latest.current = {
    laneStates,
    activeLane,
    items,
    index,
    currentId,
    viewerPaused,
    effectivePaused,
    documentHidden,
    sheetOpen,
    otherPaused: documentHidden || sheetOpen || holding,
    blockedCurrent,
    failed,
  };

  /* ── Controllers (ReelVideo) ──────────────────────────────────────────────────────────────── */

  const controllers = useRef(new Map<string, ReelVideoController>());
  /** The page the last gesture activated: the stage's `touchend` resumes it once (WebKit). */
  const pendingResume = useRef<string | null>(null);
  /**
   * Set when a handler already started the current video in the same gesture that cleared the
   * viewer's pause: the pause effect then skips its own resume, so one gesture is one `play()`.
   */
  const suppressResume = useRef(false);

  const onController = useCallback((postId: string, controller: ReelVideoController | null) => {
    if (!controller) {
      controllers.current.delete(postId);
      return;
    }
    controllers.current.set(postId, controller);
    const state = latest.current;
    // The page is current when its element appears (the first video, a lane's first video, a
    // video whose credential arrived after it became current): it starts here, outside a gesture,
    // which browsers allow muted. With sound on, a refusal falls back to muted (UI-D-85).
    if (postId === state.currentId && !state.effectivePaused) {
      controller.start(soundOnRef.current);
    }
  }, []);

  /* ── Visibility (T-05-38) and the one pause effect ───────────────────────────────────────── */

  useEffect(() => {
    const onVisibility = () => setDocumentHidden(document.visibilityState === 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const pausedBefore = useRef(effectivePaused);
  useEffect(() => {
    if (pausedBefore.current === effectivePaused) return;
    pausedBefore.current = effectivePaused;
    const controller = controllerIn(controllers.current, latest.current.currentId);
    if (effectivePaused) {
      controller?.pause();
      return;
    }
    if (suppressResume.current) {
      suppressResume.current = false;
      return;
    }
    controller?.resume(soundOnRef.current);
  }, [effectivePaused]);

  /* ── Credentials: one batched mint per window change (REELS-05) ───────────────────────────── */

  const tokens = useRef(new Map<string, MediaPlayback>());
  const inFlight = useRef(new Set<string>());
  const generation = useRef(0);

  const mint = useCallback(async (assetIds: readonly string[]) => {
    const ids = assetIds
      .filter((assetId) => !inFlight.current.has(assetId))
      .slice(0, REELS_MINT_MAX_IDS);
    if (ids.length === 0) return;
    for (const assetId of ids) inFlight.current.add(assetId);
    const issuedAt = generation.current;

    let result: MintResult;
    try {
      result = await mintReelPlaybackAction(ids);
    } catch {
      result = { ok: false, code: 'generic' };
    }
    for (const assetId of ids) inFlight.current.delete(assetId);

    const state = latest.current;
    const stale = issuedAt !== generation.current;
    const inWindow = new Set(windowOf(state.items, state.index).map((view) => view.video.assetId));
    const outcomes = result.ok
      ? result.results
      : ids.map((assetId) => ({ assetId, ok: false as const, code: 'generic' as const }));

    const failedPosts: string[] = [];
    const recovered: string[] = [];
    let stored = false;
    for (const outcome of outcomes) {
      // The window moved on while this was in flight: an asset that left it is dropped, so a late
      // answer never lands on a page nobody is near (a lane change, a fast fling).
      if (stale && !inWindow.has(outcome.assetId)) continue;
      const postId = postOfAsset(state.laneStates, outcome.assetId);
      if (!outcome.ok) {
        if (postId) failedPosts.push(postId);
        continue;
      }
      // A result never replaces a token that outlives it.
      const held = tokens.current.get(outcome.assetId);
      if (held && Date.parse(held.expiresAt) > Date.parse(outcome.playback.expiresAt)) continue;
      tokens.current.set(outcome.assetId, outcome.playback);
      stored = true;
      if (postId) recovered.push(postId);
    }

    if (failedPosts.length > 0) setFailed((record) => withKeys(record, failedPosts));
    if (recovered.length > 0) {
      setFailed((record) => recovered.reduce((next, postId) => without(next, postId), record));
    }
    if (stored) setTokenVersion((version) => version + 1);
  }, []);

  /* ── Paging: the next keyset page at `loaded − REELS_PREFETCH_DISTANCE` ──────────────────── */

  const paging = useRef(new Set<string>());
  const errorLoadMore = labels.errorLoadMore;

  const loadMore = useCallback(
    (laneKey: string) => {
      const state = latest.current.laneStates[laneKey];
      if (state?.status !== 'ready' || state.nextCursor === null) return;
      if (paging.current.has(laneKey)) return;
      paging.current.add(laneKey);
      const cursor = state.nextCursor;
      void (async () => {
        let result: ReelsPageResult;
        try {
          result = await loadReelsPageAction(laneKey === ALL ? null : laneKey, cursor);
        } catch {
          result = { ok: false };
        }
        paging.current.delete(laneKey);
        if (!result.ok) {
          // One toast per failed attempt; the prefetch stands down and the next end-swipe retries.
          setLaneStates((previous) => {
            const lane = previous[laneKey];
            return lane ? { ...previous, [laneKey]: { ...lane, moreFailed: true } } : previous;
          });
          toast.show({ tone: 'error', message: errorLoadMore });
          return;
        }
        const page = result.items;
        const nextCursor = result.nextCursor;
        setLaneStates((previous) => {
          const lane = previous[laneKey];
          if (!lane) return previous;
          const seen = new Set(lane.items.map((item) => item.id));
          return {
            ...previous,
            [laneKey]: {
              ...lane,
              items: [...lane.items, ...page.filter((item) => !seen.has(item.id))],
              nextCursor,
              moreFailed: false,
            },
          };
        });
      })();
    },
    [toast, errorLoadMore],
  );

  const onEndReached = useCallback(() => {
    loadMore(latest.current.activeLane);
  }, [loadMore]);

  /** A lane's first page, on first selection and on the stage error's retry (UI-D-93a). */
  const loadingLanes = useRef(new Set<string>());
  const loadLane = useCallback((laneKey: string) => {
    if (loadingLanes.current.has(laneKey)) return;
    loadingLanes.current.add(laneKey);
    setLaneStates((previous) => ({
      ...previous,
      [laneKey]: { ...(previous[laneKey] ?? EMPTY_LANE), status: 'loading' },
    }));
    void (async () => {
      let result: ReelsPageResult;
      try {
        result = await loadReelsPageAction(laneKey === ALL ? null : laneKey, null);
      } catch {
        result = { ok: false };
      }
      loadingLanes.current.delete(laneKey);
      const next: LaneState = result.ok
        ? { items: result.items, nextCursor: result.nextCursor, status: 'ready', moreFailed: false }
        : { ...EMPTY_LANE, status: 'error' };
      // Written to THIS lane only, whichever lane is active when it lands (REELS-08 concurrency).
      setLaneStates((previous) => ({ ...previous, [laneKey]: next }));
    })();
  }, []);

  /**
   * The window changed (a page, a lane, a lane's first page arriving): mint what the ±1 window
   * lacks in ONE call, THEN ask for the next page if it is due — the mint goes first.
   */
  const windowKey = `${activeLane}|${windowOf(items, index)
    .map((view) => view.video.assetId)
    .join(',')}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the WINDOW is the trigger; `mint` and `loadMore` read the latest render through refs
  useEffect(() => {
    generation.current += 1;
    const state = latest.current;
    const missing = windowOf(state.items, state.index)
      .filter((view) => !state.failed[view.id])
      .map((view) => view.video.assetId)
      .filter((assetId) => {
        const held = tokens.current.get(assetId);
        return !held || expiresSoon(held);
      });
    if (missing.length > 0) void mint(missing);

    const laneState = state.laneStates[state.activeLane];
    if (
      laneState &&
      !laneState.moreFailed &&
      laneState.items.length > 0 &&
      state.index >= laneState.items.length - REELS_PREFETCH_DISTANCE
    ) {
      loadMore(state.activeLane);
    }
  }, [windowKey]);

  /* ── Buffering (UI-D-92) ──────────────────────────────────────────────────────────────────── */

  const playedCurrent = useRef(false);
  useEffect(() => {
    playedCurrent.current = false;
    setSpinner(false);
    if (currentId === null) return;
    const timer = setTimeout(() => {
      if (!playedCurrent.current) setSpinner(true);
    }, REELS_BUFFERING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [currentId]);

  const onPlaying = useCallback((postId: string) => {
    setBlocked((record) => without(record, postId));
    if (postId !== latest.current.currentId) return;
    playedCurrent.current = true;
    setSpinner(false);
  }, []);

  const onWaiting = useCallback((postId: string) => {
    if (postId === latest.current.currentId) setSpinner(true);
  }, []);

  const onBlocked = useCallback((postId: string) => {
    setBlocked((record) => withKeys(record, [postId]));
  }, []);

  const onVideoError = useCallback((postId: string) => {
    setFailed((record) => withKeys(record, [postId]));
  }, []);

  /** UI-D-85: the browser refused sound; the video already re-muted itself and played again. */
  const onSoundRefused = useCallback(() => {
    soundOnRef.current = false;
    setSoundOn(false);
  }, []);

  /* ── Gestures ─────────────────────────────────────────────────────────────────────────────── */

  /**
   * Ends a hold WITHOUT resuming anything: the press moved on (a swipe, a key, a lane change), so
   * its release must not resume the page that was left. True when a hold was running.
   */
  const dropHold = useCallback((): boolean => {
    if (!holdingRef.current) return false;
    holdingRef.current = false;
    setHolding(false);
    return true;
  }, []);

  const onActivate = useCallback(
    (next: number) => {
      const state = latest.current;
      const target = state.items[next];
      if (!target) return;
      controllerIn(controllers.current, state.currentId)?.pause();
      const held = dropHold();
      // The pause effect then sees the pause clear: the start below is this gesture's one play().
      if (state.viewerPaused || (held && state.effectivePaused)) suppressResume.current = true;
      if (state.viewerPaused) setViewerPaused(false);
      setBlocked((record) => without(record, target.id));
      // Inside the gesture, with the sound value of THIS instant.
      controllerIn(controllers.current, target.id)?.start(soundOnRef.current);
      pendingResume.current = target.id;
    },
    [dropHold],
  );

  /** A press held still on the video (the story viewer's hold): paused on that frame, no badge. */
  const onHoldStart = useCallback(() => {
    holdingRef.current = true;
    setHolding(true);
  }, []);

  /**
   * The hold was let go (or cancelled). Resume inside the release, once, unless another source
   * still holds the video (the pause effect resumes when it clears). An autoplay-blocked page was
   * not playing, so it stays waiting under its badge.
   */
  const onHoldEnd = useCallback(() => {
    // A swipe or a lane change already ended it: the page it paused is no longer the current one.
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    const state = latest.current;
    if (state.viewerPaused || state.documentHidden || state.sheetOpen) return;
    if (state.effectivePaused) suppressResume.current = true;
    if (state.blockedCurrent) return;
    controllerIn(controllers.current, state.currentId)?.resume(soundOnRef.current);
    // WebKit: the stage's `touchend` re-issues it once, inside the activation it counts.
    pendingResume.current = state.currentId;
  }, []);

  /** WebKit: `touchend` is the activation for unmuted playback; resume the activated page once. */
  const onTouchEnd = () => {
    const postId = pendingResume.current;
    if (postId === null) return;
    pendingResume.current = null;
    if (latest.current.effectivePaused) return;
    controllerIn(controllers.current, postId)?.resume(soundOnRef.current);
  };

  const onTogglePause = useCallback(() => {
    const state = latest.current;
    const postId = state.currentId;
    if (postId === null) return;
    pendingResume.current = null;
    if (state.viewerPaused || state.blockedCurrent) {
      setBlocked((record) => without(record, postId));
      if (state.viewerPaused) setViewerPaused(false);
      // Resume inside the tap, unless another source (the background, the sheet, a hold) still
      // holds it: then the pause effect resumes when that source clears.
      if (!state.otherPaused) {
        if (state.viewerPaused) suppressResume.current = true;
        controllerIn(controllers.current, postId)?.resume(soundOnRef.current);
      }
      return;
    }
    setViewerPaused(true);
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    const state = latest.current;
    const controller = controllerIn(controllers.current, state.currentId);
    controller?.setMuted(!next);
    // Turning sound ON plays inside the click, so a refusal surfaces (and re-mutes, UI-D-85).
    if (next && !state.effectivePaused && !state.blockedCurrent) controller?.resume(true);
  }, []);

  /** Per-page binders, registered by each page's overlay. */
  const binders = useRef(new Map<string, ReelBinder>());
  const bind = useCallback((postId: string, binder: ReelBinder | null) => {
    if (binder) binders.current.set(postId, binder);
    else binders.current.delete(postId);
  }, []);
  const onDoubleTap = useCallback(() => {
    const postId = latest.current.currentId;
    if (postId !== null) binders.current.get(postId)?.likeOnly();
  }, []);

  /* ── Comments and share (UI-D-90, UI-D-91) ────────────────────────────────────────────────── */

  const onComment = useCallback((postId: string) => {
    pendingResume.current = null;
    setSheetFor(postId);
  }, []);

  /**
   * Stable by habit (`BottomSheet`'s focus trap reads `onClose` through a ref and arms once per
   * opening). Closing resumes inside the close gesture when nothing else holds the video (sound
   * stays allowed).
   */
  const closeSheet = useCallback(() => {
    const state = latest.current;
    setSheetFor(null);
    if (!state.viewerPaused && !state.documentHidden && !holdingRef.current) {
      suppressResume.current = true;
      controllerIn(controllers.current, state.currentId)?.resume(soundOnRef.current);
    }
  }, []);

  const onShare = useSharePost(tenantName, { copied: labels.copied, error: labels.generic });
  const genericError = labels.generic;
  // UI-D-376 (08.2-09): a refusal with `community_locked` (access lost mid-session) closes the
  // sheet, toasts the locked copy and refreshes; the refreshed lane no longer carries the reel.
  const lockedRefusal = useCommunityLockedRefusal(labels.communityLocked);
  const onLocked = useCallback(() => {
    closeSheet();
    lockedRefusal();
  }, [closeSheet, lockedRefusal]);
  const onLikeError = useCallback(
    (code?: string) => {
      if (isCommunityLockedCode(code)) onLocked();
      else toast.show({ tone: 'error', message: genericError });
    },
    [toast, genericError, onLocked],
  );

  /**
   * The feed's like action, remembered (CR-01, WR-04). Every `ok` answer becomes the post's
   * confirmed pair unless a NEWER request's answer is already held (Next serialises server actions,
   * so answers normally arrive in order; the seq guard keeps an out-of-order older answer from
   * replacing a newer one). When the post's LATEST request settles — `ok`, refused or rejected —
   * the confirmed pair is written into the map, whether or not its page is still mounted, so a
   * remounted page starts from what the server last confirmed. The outcome goes back unchanged and a
   * rejection is rethrown, so the page's engine reverts and raises the toast exactly as the card's
   * does.
   */
  const trackLike = useCallback(
    async (postId: string, nextLiked: boolean): Promise<LikeOutcome> => {
      const seq = (likeSeq.current.get(postId) ?? 0) + 1;
      likeSeq.current.set(postId, seq);
      const publish = () => {
        // A newer request is in flight: it will publish when it settles.
        if (likeSeq.current.get(postId) !== seq) return;
        const pair = confirmed.current.get(postId)?.like;
        if (pair === undefined) return;
        setInteractions((map) => ({ ...map, [postId]: { ...map[postId], like: pair } }));
      };
      try {
        const outcome = nextLiked ? await onLike(postId) : await onUnlike(postId);
        if (outcome.ok) {
          const held = confirmed.current.get(postId);
          if (held === undefined || held.seq < seq) {
            confirmed.current.set(postId, {
              seq,
              like: { liked: outcome.liked, likeCount: outcome.likeCount },
            });
          }
        }
        publish();
        return outcome;
      } catch (error) {
        publish();
        throw error;
      }
    },
    [onLike, onUnlike],
  );
  const onLikeTracked = useCallback((postId: string) => trackLike(postId, true), [trackLike]);
  const onUnlikeTracked = useCallback((postId: string) => trackLike(postId, false), [trackLike]);

  /**
   * The sheet's server-confirmed `+1`/`-1` (D-59, D-62, UI-D-90), held per post as an ABSOLUTE
   * count: the first delta starts from the count the viewer was shown, so a lane read made after
   * the comment (which already counts it) is never added to twice.
   */
  const bumpCommentCount = useCallback((postId: string, delta: number) => {
    setInteractions((map) => {
      const entry = map[postId];
      const state = latest.current;
      const base =
        entry?.commentCount ??
        viewOf(state.laneStates, state.activeLane, postId)?.commentCount ??
        0;
      return { ...map, [postId]: { ...entry, commentCount: Math.max(0, base + delta) } };
    });
  }, []);

  const overlayLabels = useMemo<ReelOverlayLabels>(
    () => ({
      railAuthor: labels.railAuthor,
      captionMore: labels.captionMore,
      captionLess: labels.captionLess,
      like: labels.like,
      unlike: labels.unlike,
      comment: labels.comment,
      share: labels.share,
      likes: labels.likes,
    }),
    [labels],
  );

  /* ── Lanes ────────────────────────────────────────────────────────────────────────────────── */

  const laneList = useMemo<ReelsLane[]>(
    () => [
      { key: ALL, label: labels.lanesAll, tabId: 'reels-lane-all' },
      ...lanes.map((community) => ({
        key: community.id,
        label: community.name,
        tabId: `reels-lane-${community.id}`,
      })),
    ],
    [lanes, labels.lanesAll],
  );
  const multiLane = laneList.length >= 2;
  const activeTabId = laneList.find((entry) => entry.key === activeLane)?.tabId;

  const selectLane = useCallback(
    (key: string) => {
      const state = latest.current;
      if (key === state.activeLane) return;
      controllerIn(controllers.current, state.currentId)?.pause();
      pendingResume.current = null;
      setActiveLane(key);
      setIndex(0);
      setInstantKey((value) => value + 1);
      const target = state.laneStates[key];
      // A hold ends with the lane it was on (a horizontal swipe, or a second finger on a tab).
      const held = dropHold();
      if (state.viewerPaused || (held && state.effectivePaused)) suppressResume.current = true;
      if (state.viewerPaused) setViewerPaused(false);
      if (!target || target.status === 'idle' || target.status === 'error') {
        loadLane(key);
        return;
      }
      const first = target.items[0];
      if (!first) return;
      setBlocked((record) => without(record, first.id));
      // A loaded lane opens at its newest video, started inside the tap or swipe when its element
      // is already mounted; otherwise it starts when its element appears (`onController`).
      controllerIn(controllers.current, first.id)?.start(soundOnRef.current);
    },
    [loadLane, dropHold],
  );

  const onLaneStep = useCallback(
    (delta: 1 | -1) => {
      const position = laneList.findIndex((entry) => entry.key === latest.current.activeLane);
      const target = laneList[position + delta];
      if (target) selectLane(target.key);
    },
    [laneList, selectLane],
  );

  /* ── Pages ────────────────────────────────────────────────────────────────────────────────── */

  const views = useMemo(() => new Map(items.map((view) => [view.id, view])), [items]);
  const pagerItems = useMemo<ReelsPagerItem[]>(
    () => items.map((view) => ({ id: view.id, authorName: view.author.displayName })),
    [items],
  );

  /** UI-D-93b's retry: a fresh credential, one mint however often it is pressed. */
  const retryVideo = (view: ReelView) => {
    const assetId = view.video.assetId;
    if (inFlight.current.has(assetId)) return;
    tokens.current.delete(assetId);
    setBlocked((record) => without(record, view.id));
    void mint([assetId]);
  };

  const renderMedia = (item: ReelsPagerItem, state: { current: boolean }): ReactNode => {
    const view = views.get(item.id);
    if (!view) return null;
    if (failed[view.id]) {
      // A sized block centred on the page: taps on it never reach the tap surface (no pause), and
      // everywhere else the page stays a live swipe surface (REELS-08 adjacency).
      return (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div onPointerDown={stopPointer} onPointerUp={stopPointer} onPointerCancel={stopPointer}>
            <ReelPlaybackError
              message={labels.errorPlayback}
              retryLabel={labels.errorRetry}
              onRetry={() => retryVideo(view)}
            />
          </div>
        </div>
      );
    }
    return (
      <ReelVideo
        postId={view.id}
        assetId={view.video.assetId}
        playback={tokens.current.get(view.video.assetId) ?? null}
        width={view.video.width}
        height={view.video.height}
        current={state.current}
        onController={onController}
        onPlaying={onPlaying}
        onWaiting={onWaiting}
        onError={onVideoError}
        onBlocked={onBlocked}
        onSoundRefused={onSoundRefused}
      />
    );
  };

  const renderOverlay = (item: ReelsPagerItem, state: { current: boolean }): ReactNode => {
    const view = views.get(item.id);
    if (!view) return null;
    return (
      <ReelOverlay
        view={withInteraction(view, interactions[view.id])}
        current={state.current}
        locale={locale}
        labels={overlayLabels}
        onLike={onLikeTracked}
        onUnlike={onUnlikeTracked}
        onComment={onComment}
        onShare={onShare}
        onError={onLikeError}
        bind={bind}
      />
    );
  };

  /* ── Render ───────────────────────────────────────────────────────────────────────────────── */

  const lanesNode = multiLane ? (
    <ReelsLanes
      lanes={laneList}
      activeKey={activeLane}
      onSelect={selectLane}
      label={labels.lanesLabel}
      panelId={PANEL_ID}
    />
  ) : null;

  const soundButton = (
    <IconButton
      icon={soundOn ? Volume2 : VolumeX}
      size={20}
      label={soundOn ? labels.soundMute : labels.soundUnmute}
      onClick={toggleSound}
      className="absolute top-[calc(var(--safe-top)+8px)] right-4 z-[3] bg-black/35 text-white hover:bg-black/50 active:bg-black/60 focus-visible:ring-white focus-visible:ring-offset-0 md:top-4"
    />
  );

  const empty = lane.status === 'ready' && items.length === 0;
  let body: ReactNode;
  if (empty) {
    // UI-D-94. In "Todos" there is no lane row; an empty community lane keeps it, so the viewer
    // can step back. No sound button and no pager (so no keys, wheel or ↑/↓) either way.
    body = (
      <>
        {activeLane === ALL ? null : lanesNode}
        <div className="absolute inset-0 flex items-center justify-center">
          <EmptyState
            variant="plain"
            icon={Film}
            title={labels.emptyTitle}
            body={labels.emptyBody}
            action={
              canPost ? (
                // The shared Button's link form, with the white ring and no offset every control
                // on the dark Reels surface carries (UI-REVIEW fix 3).
                <LinkButton
                  href="/criar"
                  variant="brand"
                  size="md"
                  className="focus-visible:ring-white focus-visible:ring-offset-0"
                >
                  {labels.emptyCta}
                </LinkButton>
              ) : undefined
            }
          />
        </div>
      </>
    );
  } else if (lane.status === 'error') {
    // UI-D-93a: the stage error, the lane row still usable.
    body = (
      <>
        {lanesNode}
        <div className="absolute inset-0 flex items-center justify-center">
          <EmptyState
            variant="plain"
            icon={CircleAlert}
            title={labels.errorLoad}
            action={
              <Button variant="outline" size="md" onClick={() => loadLane(activeLane)}>
                {labels.errorRetry}
              </Button>
            }
          />
        </div>
      </>
    );
  } else if (lane.status !== 'ready') {
    // UI E02 loading: a lane selected for the first time, its tab already active.
    body = (
      <>
        {lanesNode}
        <div
          data-testid="reels-stage-loading"
          aria-busy
          className="absolute inset-0 grid place-items-center"
        >
          <Loader2
            aria-hidden
            size={24}
            className="animate-spin text-white/70 motion-reduce:animate-none"
          />
        </div>
      </>
    );
  } else {
    body = (
      <ReelsPager
        items={pagerItems}
        index={index}
        hasMore={lane.nextCursor !== null}
        onActivate={onActivate}
        onIndexChange={setIndex}
        onEndReached={onEndReached}
        onLaneStep={multiLane ? onLaneStep : undefined}
        renderMedia={renderMedia}
        renderOverlay={renderOverlay}
        top={
          <>
            {lanesNode}
            {soundButton}
          </>
        }
        paused={viewerPaused || blockedCurrent}
        showPlayBadge={(viewerPaused || blockedCurrent) && !failedCurrent}
        showSpinner={spinner && !effectivePaused && !blockedCurrent && !failedCurrent}
        onTogglePause={onTogglePause}
        onDoubleTap={onDoubleTap}
        onHoldStart={onHoldStart}
        onHoldEnd={onHoldEnd}
        onToggleSound={toggleSound}
        gesturesDisabled={sheetOpen}
        instantKey={String(instantKey)}
        panelId={multiLane ? PANEL_ID : undefined}
        labelledBy={multiLane ? activeTabId : undefined}
        labels={{
          play: labels.play,
          pause: labels.pause,
          previous: labels.previous,
          next: labels.next,
          position: labels.position,
        }}
      />
    );
  }

  return (
    <>
      <ReelsStage label={labels.region}>
        <div className="absolute inset-0" onTouchEnd={onTouchEnd}>
          {body}
        </div>
      </ReelsStage>
      {/* The feed's ONE sheet, threaded (D-59, D-62), OUTSIDE the stage's dark scope (UI-D-98). */}
      <CommentSheet
        {...comments}
        open={sheetOpen}
        onClose={closeSheet}
        // `''` is only ever read while the sheet is closed, and the sheet then renders nothing.
        targetId={sheetFor ?? ''}
        onCountChange={(delta) => {
          if (sheetFor !== null) bumpCommentCount(sheetFor, delta);
        }}
        onLocked={onLocked}
      />
    </>
  );
}
