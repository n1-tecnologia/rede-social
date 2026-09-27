'use client';

import type { MediaPlayback } from '@tria/contracts/media';
import { REELS_AUTOPLAY_CHECK_MS, REELS_COVER_MAX_RATIO } from '@tria/module-reels/contracts';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

/**
 * `<mux-player>` is a CUSTOM ELEMENT that registers itself against `window.customElements` at import
 * time, which does not exist during a server render. `next/dynamic` with `ssr: false` keeps it out of
 * the server bundle, the same posture `VideoPlayer` and `StoryVideo` take.
 */
const MuxPlayer = dynamic(() => import('@mux/mux-player-react'), { ssr: false });

/**
 * What the host drives. The pager's gesture calls `start` SYNCHRONOUSLY for the page it activates,
 * so a `play()` with sound runs inside the user's own touch or key event (WebKit, RESEARCH Pitfall 1).
 */
export interface ReelVideoController {
  /** Rewind to 0 (UI-D-92: a page returned to restarts), apply the sound state, play. */
  start(wantSound: boolean): void;
  pause(): void;
  /** Apply the sound state and play from where the element stopped. */
  resume(wantSound: boolean): void;
  setMuted(muted: boolean): void;
}

export interface ReelVideoProps {
  postId: string;
  /** The credential minted by the host's batched action, from its in-memory map; `null` = not yet. */
  playback: MediaPlayback | null;
  width: number | null;
  height: number | null;
  /** The page the viewer is on (preload `auto`, autoplay check armed) versus a ±1 neighbour. */
  current: boolean;
  onController(postId: string, controller: ReelVideoController | null): void;
  onPlaying(postId: string): void;
  onWaiting(postId: string): void;
  onError(postId: string): void;
  onBlocked(postId: string): void;
  onSoundRefused(): void;
}

/**
 * How many times one start/resume re-issues a `play()` that a SOURCE LOAD aborted (see `play`). The
 * vendor sets its source at most twice on mount, so two is enough and a looping source still ends.
 */
const PLAY_ABORT_RETRIES = 2;

/** The standard media-element surface this element uses on the vendor node. */
type PlayableElement = HTMLElement & {
  play?: () => Promise<void> | void;
  pause?: () => void;
  currentTime?: number;
  muted?: boolean;
  paused?: boolean;
  poster?: string;
};

/**
 * UI-D-83. Portrait up to 4:5 fills the stage; anything wider, or a video whose dimensions are
 * unknown, is letterboxed on black so a landscape clip is never cropped to a sliver.
 */
export function reelFit(width: number | null, height: number | null): 'cover' | 'contain' {
  if (width === null || height === null || width <= 0 || height <= 0) return 'contain';
  return width / height <= REELS_COVER_MAX_RATIO ? 'cover' : 'contain';
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

/**
 * One Reel's VIDEO, full-bleed on the black stage (REELS-06, UI-D-83, UI-D-85, UI-D-86).
 *
 * **Why not `VideoPlayer` or `StoryVideo`.** `VideoPlayer` is the feed's 16:9 card with vendor
 * controls, a status pill and its own token mint. `StoryVideo` is a segment clock: it plays once and
 * hands over at the end. A Reel LOOPS (D-125: no `ended` handler, never asks the host to advance),
 * has no clock, and must be started by the pager's gesture through a controller. This element keeps
 * `StoryVideo`'s proven bridge (a `MutationObserver` that attaches to the late-mounted `mux-player`,
 * because `next/dynamic` does not forward refs) and nothing else.
 *
 * **The two muted-preference opt-outs** (RESEARCH Pitfall 2, D-126). media-chrome stores
 * `media-chrome-pref-muted` when a member mutes any player (the feed card's controls do), and forces
 * an unmuted element back to that stored value unless the element opts out. Without both opt-outs
 * (the muted and the volume preference props below), a member who once muted a feed card would see
 * every Reel re-muted after they turned sound on. The hotkeys opt-out keeps the controller's own
 * Space/`m`/arrow handling from racing the route's keyboard map.
 *
 * **Play is imperative, from the gesture** (RESEARCH Pattern 4). There is no `autoPlay`: the host
 * calls `start` inside the pager's `onActivate`, which runs synchronously in the swipe, key or click
 * handler. An `AbortError` after the host paused (a fast swipe) is ignored; one caused by the
 * vendor attaching its source is re-issued (see `play`). A `NotAllowedError`
 * with sound falls back to muted, reports `onSoundRefused` and plays again, reporting `onBlocked`
 * only if that also fails. Anything else is `onBlocked`. Low Power Mode can leave `play()` pending
 * rather than rejecting, so a second detector runs: after `canplay` on the current page, no
 * `playing` within `REELS_AUTOPLAY_CHECK_MS` reports `onBlocked` (UI-D-86, from `StoryViewer`).
 *
 * **The fit rides `--media-object-fit`** (UI-D-83). The custom media element reads
 * `object-fit: var(--media-object-fit, contain)` for its inner video; a `className` on the player
 * has no effect there because `object-fit` is not inherited. `--controls: none` hides every piece of
 * vendor chrome.
 *
 * **The credential arrives from the host** (D-43, D-44). This element never mints: it receives the
 * playback from the host's visit-scoped in-memory map, filled by one batched server action. It never
 * renders an error message (a player `error` is reported as `onError(postId)` and the host shows
 * catalog copy) and holds no sound state (the visit-long sound state is the host's).
 *
 * **Credential swaps (WR-02).** A re-minted token is never written into a mounted element in place:
 * the vendor reloads its source when its playback token changes, and a video that was already
 * playing would stop on a still frame with no badge (the host would still believe it plays). The
 * player is keyed on its playback token instead, so a swap is an explicit remount: the observer
 * detaches the old element (`onController(postId, null)`), attaches the new one, and the host
 * restarts it through `onController` when it is the current, unpaused page. The same credential
 * re-rendered, or a neighbour becoming current, keeps the element, so the gesture's synchronous
 * `start` still finds it. The token lives only in React's in-memory key and the element property it
 * already had (never stored, logged or rendered as an attribute, T-05-34 unchanged).
 *
 * **Poster.** Before the first frame the element shows the provider's poster when one resolves and
 * plain black otherwise. A derived poster URL that fails to load is replaced by `poster=""`, which
 * the player reads as "no poster", so a broken-image glyph is never drawn. Locally the fake
 * provider's tokens are not JWTs, the player derives no poster, and the frame stays black.
 */
export function ReelVideo(props: ReelVideoProps) {
  const { postId, playback, width, height, current } = props;
  const frameRef = useRef<HTMLDivElement | null>(null);

  /**
   * The latest props, read by the DOM listeners and the controller. Reading them through a ref
   * keeps the element's listeners attached ONCE per element instead of once per render.
   */
  const propsRef = useRef(props);
  propsRef.current = props;

  /** `''` once a derived poster failed to load; `undefined` lets the player derive its own. */
  const [poster, setPoster] = useState<string | undefined>(undefined);

  /** The pending autoplay check, shared with the `current` effect below so leaving a page clears it. */
  const checkRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (current) return;
    if (checkRef.current !== null) {
      clearTimeout(checkRef.current);
      checkRef.current = null;
    }
  }, [current]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let element: PlayableElement | null = null;
    let probe: HTMLImageElement | null = null;
    /** The host paused this page (a tap, the comment sheet, a hidden tab): nothing is "blocked". */
    let hostPaused = false;
    /** `playing` has fired since the last start/resume. */
    let played = false;
    /** The element has reported `canplay` at least once. */
    let canPlay = false;

    const clearCheck = () => {
      if (checkRef.current === null) return;
      clearTimeout(checkRef.current);
      checkRef.current = null;
    };

    const armCheck = () => {
      clearCheck();
      if (!propsRef.current.current || hostPaused || played || !canPlay) return;
      checkRef.current = setTimeout(() => {
        checkRef.current = null;
        if (!played) propsRef.current.onBlocked(postId);
      }, REELS_AUTOPLAY_CHECK_MS);
    };

    /**
     * `play()` with RESEARCH Pattern 4's rejection handling, on the element it was asked of.
     *
     * **Two kinds of `AbortError`** (05.3-09, found in the browser). A `pause()` interrupting the
     * play — a swipe leaving the page, the viewer's tap, the comment sheet — is final: the host
     * paused, so nothing is retried. A SOURCE LOAD interrupting it is not. The host starts a page
     * the moment its element appears (the first video of a visit, a lane's first video, a retried
     * video), and the vendor attaches its media source a moment later; the media load algorithm
     * then resets `paused` and rejects the pending play with `AbortError`. Ignoring that left the
     * first video of every visit paused, and on a real stream the autoplay check would then have
     * shown "tap to play" instead of the muted autoplay UI E04 promises. So while the host still
     * wants the page playing, the play is re-issued (bounded), with the element's CURRENT mute
     * state so a `setMuted` in between is kept.
     */
    const play = (target: PlayableElement, wantSound: boolean, aborted = 0) => {
      hostPaused = false;
      // An element that is ALREADY playing (the host's sound toggle resumes it to catch a refusal)
      // fires no second `playing`, so resetting here would arm a check that can only report a
      // false "blocked". Only a paused element (or one that does not say) starts a new check.
      if (target.paused !== false) played = false;
      target.muted = !wantSound;
      const attempt = target.play?.();
      armCheck();
      if (!attempt || typeof attempt.catch !== 'function') return;
      attempt.catch((error: unknown) => {
        if (element !== target) return;
        const name = errorName(error);
        if (name === 'AbortError') {
          if (!hostPaused && aborted < PLAY_ABORT_RETRIES) {
            play(target, target.muted === false, aborted + 1);
          }
          return;
        }
        if (name === 'NotAllowedError' && !target.muted) {
          target.muted = true;
          propsRef.current.onSoundRefused();
          const retry = target.play?.();
          if (!retry || typeof retry.catch !== 'function') return;
          retry.catch((retryError: unknown) => {
            if (element !== target || errorName(retryError) === 'AbortError') return;
            propsRef.current.onBlocked(postId);
          });
          return;
        }
        propsRef.current.onBlocked(postId);
      });
    };

    const onCanPlay = () => {
      canPlay = true;
      armCheck();
    };
    const onPlaying = () => {
      played = true;
      clearCheck();
      propsRef.current.onPlaying(postId);
    };
    const onWaiting = () => propsRef.current.onWaiting(postId);
    const onError = () => {
      clearCheck();
      propsRef.current.onError(postId);
    };

    const attach = (found: PlayableElement) => {
      element = found;
      canPlay = false;
      played = false;
      found.addEventListener('canplay', onCanPlay);
      found.addEventListener('playing', onPlaying);
      found.addEventListener('waiting', onWaiting);
      found.addEventListener('error', onError);

      const derived = found.poster;
      if (typeof derived === 'string' && derived !== '') {
        probe = new Image();
        probe.onerror = () => {
          if (element === found) setPoster('');
        };
        probe.src = derived;
      }

      const controller: ReelVideoController = {
        start(wantSound) {
          found.currentTime = 0;
          play(found, wantSound);
        },
        pause() {
          hostPaused = true;
          clearCheck();
          found.pause?.();
        },
        resume(wantSound) {
          play(found, wantSound);
        },
        setMuted(muted) {
          found.muted = muted;
        },
      };
      propsRef.current.onController(postId, controller);
    };

    const detach = () => {
      const attached = element;
      if (!attached) return;
      attached.removeEventListener('canplay', onCanPlay);
      attached.removeEventListener('playing', onPlaying);
      attached.removeEventListener('waiting', onWaiting);
      attached.removeEventListener('error', onError);
      if (probe) {
        probe.onerror = null;
        probe = null;
      }
      clearCheck();
      element = null;
      propsRef.current.onController(postId, null);
    };

    const reconcile = () => {
      const found = frame.querySelector<PlayableElement>('mux-player');
      if (found === element) return;
      detach();
      if (found) attach(found);
    };

    // Once immediately: a synchronous mount must not wait for a mutation that already happened.
    reconcile();
    const observer = new MutationObserver(reconcile);
    observer.observe(frame, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      detach();
    };
  }, [postId]);

  const fit = reelFit(width, height);

  return (
    <div ref={frameRef} className="absolute inset-0 bg-black" data-testid="reel-video">
      {playback ? (
        <MuxPlayer
          key={playback.tokens.playback}
          playbackId={playback.playbackId}
          tokens={{
            playback: playback.tokens.playback,
            thumbnail: playback.tokens.thumbnail,
            storyboard: playback.tokens.storyboard,
          }}
          streamType="on-demand"
          playsInline
          loop
          nohotkeys
          noMutedPref
          noVolumePref
          muted
          preload={current ? 'auto' : 'metadata'}
          poster={poster}
          style={{
            '--controls': 'none',
            '--media-object-fit': fit,
            height: '100%',
            width: '100%',
          }}
        />
      ) : null}
    </div>
  );
}
