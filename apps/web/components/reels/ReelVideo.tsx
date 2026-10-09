'use client';

import type { MediaPlayback } from '@rede-social/contracts/media';
import {
  REELS_AUTOPLAY_CHECK_MS,
  REELS_COVER_MAX_RATIO,
} from '@rede-social/module-reels/contracts';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPoster, rememberVideoRatio, useKnownVideoRatio } from '@/components/media/video-ratio';

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
  /** The video's asset: the key its learned proportion is remembered under (`video-ratio`). */
  assetId: string;
  /** The credential minted by the host's batched action, from its in-memory map; `null` = not yet. */
  playback: MediaPlayback | null;
  /** The stored intrinsic size; `null` for every video in practice (only images are probed). */
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
  videoWidth?: number;
  videoHeight?: number;
};

/**
 * UI-D-83, revised 2026-10-09: Reels is vertical-first. A portrait up to 4:5 fills the stage, and
 * so does a video whose proportion is not known yet (a video's size is never stored), so a 9:16
 * clip is never letterboxed while it is being learned. Anything wider is shown whole (`contain`)
 * over its own blurred poster: a landscape clip is never cropped to a sliver, nor framed in black.
 */
export function reelFit(ratio: number | null): 'cover' | 'contain' {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return 'cover';
  return ratio <= REELS_COVER_MAX_RATIO ? 'cover' : 'contain';
}

/** The stored `width / height`, or `null` when either side is unknown. */
function storedRatio(width: number | null, height: number | null): number | null {
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return width / height;
}

/** The backdrop's bitmap width: it is blurred into a wash, so a few dozen pixels are plenty. */
const BACKDROP_WIDTH = 64;

/**
 * Draws the poster ONCE into the backdrop canvas, at the poster's own proportion; the canvas's
 * `object-cover` then fills whatever box the stage has. A cross-origin image may be drawn for
 * display (the canvas is only tainted, and nothing reads it back).
 */
function paintBackdrop(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
  canvas.width = BACKDROP_WIDTH;
  canvas.height = Math.max(
    1,
    Math.round((BACKDROP_WIDTH * image.naturalHeight) / image.naturalWidth),
  );
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
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
 * `object-fit: var(--media-object-fit, contain)` for its inner video and its poster; a `className`
 * on the player has no effect there because `object-fit` is not inherited. `--controls: none` hides
 * every piece of vendor chrome.
 *
 * **The proportion is learned here (2026-10-09).** The stored size is the first source, but a
 * video never has one, so the element learns it from the poster probe (below) and from
 * `loadedmetadata`, and remembers it per asset in the tab (`video-ratio`, shared with the feed's
 * `FeedVideo`): a page that comes back, or a neighbour whose metadata preloaded, opens at its fit.
 * Until it is known the page is `cover` (`reelFit`). A wide clip is `contain` with NO black: the
 * vendor's own background is transparent, and behind the player a `<canvas>` holds the poster drawn
 * once, blurred and darkened, so the clip floats on its own colours.
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
 * plain black otherwise. The derived poster URL is loaded once in an off-DOM image (`loadPoster`):
 * its size is the video's proportion, and the image itself is the wide clip's backdrop. The vendor
 * sets `tokens` and then `playbackId` in its own effects, so the URL may only exist after the
 * element appeared; the observer also watches `playback-id` and probes once it does. A derived
 * poster URL that fails to load is replaced by `poster=""`, which the player reads as "no poster",
 * so a broken-image glyph is never drawn. Locally the fake provider's tokens are not JWTs, the
 * player derives no poster, and the frame stays black.
 */
export function ReelVideo(props: ReelVideoProps) {
  const { postId, assetId, playback, width, height, current } = props;
  const frameRef = useRef<HTMLDivElement | null>(null);

  /**
   * The latest props, read by the DOM listeners and the controller. Reading them through a ref
   * keeps the element's listeners attached ONCE per element instead of once per render.
   */
  const propsRef = useRef(props);
  propsRef.current = props;

  /** `''` once a derived poster failed to load; `undefined` lets the player derive its own. */
  const [poster, setPoster] = useState<string | undefined>(undefined);
  /** The loaded poster, drawn behind a wide clip; `null` until (or unless) it loads. */
  const [backdrop, setBackdrop] = useState<HTMLImageElement | null>(null);

  const learned = useKnownVideoRatio(assetId);
  const fit = reelFit(storedRatio(width, height) ?? learned);

  /** A new callback per poster, so React calls it when the canvas mounts or the poster changes. */
  const drawBackdrop = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas && backdrop) paintBackdrop(canvas, backdrop);
    },
    [backdrop],
  );

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
    /** The attached element's derived poster was sent to `loadPoster` (once per element). */
    let probed = false;
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
    /** The decoded size: the second source of the proportion, after the poster. */
    const onMetadata = () => {
      const videoWidth = element?.videoWidth ?? 0;
      const videoHeight = element?.videoHeight ?? 0;
      if (videoWidth > 0 && videoHeight > 0) {
        rememberVideoRatio(propsRef.current.assetId, videoWidth / videoHeight);
      }
    };

    /**
     * The derived poster, once it exists (see the docblock): its size is remembered as the asset's
     * proportion even if the page left meanwhile, and its image becomes the backdrop. One that does
     * not load becomes "no poster", never a broken-image glyph.
     */
    const probePoster = (found: PlayableElement) => {
      if (probed) return;
      const derived = found.poster;
      if (typeof derived !== 'string' || derived === '') return;
      probed = true;
      void loadPoster(derived).then((image) => {
        if (image) {
          rememberVideoRatio(propsRef.current.assetId, image.naturalWidth / image.naturalHeight);
        }
        if (element !== found) return;
        if (image) setBackdrop(image);
        else setPoster('');
      });
    };

    const attach = (found: PlayableElement) => {
      element = found;
      canPlay = false;
      played = false;
      probed = false;
      found.addEventListener('canplay', onCanPlay);
      found.addEventListener('playing', onPlaying);
      found.addEventListener('waiting', onWaiting);
      found.addEventListener('error', onError);
      found.addEventListener('loadedmetadata', onMetadata);
      if ((found.videoWidth ?? 0) > 0) onMetadata();
      probePoster(found);

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
      attached.removeEventListener('loadedmetadata', onMetadata);
      clearCheck();
      element = null;
      propsRef.current.onController(postId, null);
    };

    const reconcile = () => {
      const found = frame.querySelector<PlayableElement>('mux-player');
      if (found !== element) {
        detach();
        if (found) attach(found);
        return;
      }
      // The same element: its `playback-id` changed, so its poster may be derivable now.
      if (found) probePoster(found);
    };

    // Once immediately: a synchronous mount must not wait for a mutation that already happened.
    reconcile();
    const observer = new MutationObserver(reconcile);
    observer.observe(frame, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['playback-id'],
    });
    return () => {
      observer.disconnect();
      detach();
    };
  }, [postId]);

  return (
    <div
      ref={frameRef}
      className="absolute inset-0 bg-black"
      data-testid="reel-video"
      data-fit={fit}
    >
      {fit === 'contain' ? (
        // The wide clip's own poster, blurred and darkened, instead of black bars. Pixels only: the
        // token-bearing URL never reaches an attribute of the page.
        <div
          aria-hidden
          data-testid="reel-backdrop"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <canvas ref={drawBackdrop} className="h-full w-full scale-110 object-cover blur-2xl" />
          <span className="absolute inset-0 bg-black/40" />
        </div>
      ) : null}
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
            // No black of the vendor's own: the frame (cover) or the backdrop (contain) shows.
            '--media-background-color': 'transparent',
            // Positioned, so it paints over the backdrop (an absolute sibling before it).
            position: 'relative',
            height: '100%',
            width: '100%',
          }}
        />
      ) : null}
    </div>
  );
}
