'use client';

import type { MediaStatus } from '@rede-social/contracts/media';
import { Button, Card, cn, IconButton, StatusPill, useMediaQuery, useToast } from '@rede-social/ui';
import { Loader2, Play, Volume2, VolumeX } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { fetchPlaybackTokenAction } from '@/app/(app)/configuracoes/midia/actions';
import {
  forgetVideo,
  pauseVideo,
  playVideo,
  type SoundPlayable,
  setVideoSoundWanted,
  useVideoSoundAudible,
  useVideoSoundWanted,
  videoSoundAudible,
  videoSoundWanted,
} from './video-sound';

/**
 * `<mux-player>` is a CUSTOM ELEMENT: it registers itself against `window.customElements` at import
 * time, which does not exist during a server render (RESEARCH A3). `next/dynamic` with
 * `ssr: false` is the documented way to keep it out of the server bundle entirely; the
 * `aspect-video bg-bg-tertiary` frame below is what the member sees until it loads, so there is no
 * layout shift and no spinner over a video.
 */
const MuxPlayer = dynamic(() => import('@mux/mux-player-react'), { ssr: false });

export type VideoPlayerStatus = MediaStatus;

export interface VideoPlayerProps {
  assetId: string;
  /** The asset's own status; only `ready` ever mints a token. */
  status: VideoPlayerStatus;
  /**
   * Inside a post (the REINE timeline, 2026-10-02): the frame runs edge to edge with square corners,
   * like a post's photos, instead of sitting in a padded, rounded box; the processing state is that
   * same bare frame (no card inside the post) and only the copy below keeps the `px-4` gutter. The
   * media library and the composer keep the padded player.
   */
  bleed?: boolean;
  /**
   * 08.5-08 (D-430, R-Pattern 6): where playback starts, in seconds — the member's stored
   * `lastPositionSeconds`, so the lesson resumes with no prompt. Absent → the start (feed, stories).
   */
  startTime?: number;
  /**
   * 08.5-08 (D-427, R-Pattern 6): the element's integer position and length on every `timeupdate`
   * (`tick`), on `pause` and on `ended`. The player owns NO cadence: the lesson player throttles the
   * ticks (`lib/progress-reporter.ts`). Absent → no listener at all (feed, stories, the admin
   * preview, which writes nothing — D-422).
   */
  onProgress?: (
    positionSeconds: number,
    durationSeconds: number,
    reason: VideoProgressReason,
  ) => void;
}

/** Why `onProgress` fired: a playback tick, a pause, or the end of the video. */
export type VideoProgressReason = 'tick' | 'pause' | 'ended';

/** What the progress listeners read from the event's target: the media element's clocks. */
type MediaClock = { currentTime?: number; duration?: number; paused?: boolean };

/** An element clock in whole seconds: never negative, never `NaN` (an unknown length reads 0). */
function wholeSeconds(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** What the element type exposes that this component reads — its OWN derived poster URL. */
type PosterReadable = { poster?: string };

/** The vendor node as this component drives it: the media surface `video-sound` plays. */
type PlayerElement = SoundPlayable & PosterReadable;

/** How often, and for how long, the poster probe waits for the custom element to upgrade. */
const POSTER_PROBE_STEP_MS = 120;
const POSTER_PROBE_TIMEOUT_MS = 3000;
/** How much of the frame must be on screen before it plays by itself. */
const IN_VIEW_RATIO = 0.5;

function subscribeHidden(listener: () => void) {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}
const readHidden = () => document.visibilityState === 'hidden';
const readHiddenOnServer = () => false;

/** media-chrome toggles play on a mouse click of the video by itself; the cover button decides. */
function stopVendorClick(event: MouseEvent<HTMLDivElement>) {
  event.stopPropagation();
}

/**
 * The three states of UI-SPEC §Video contract (D-43/D-44, E10). There is no fourth and no "empty":
 * the player is only ever rendered for an asset that exists.
 *
 * **`processing`** — an `aspect-video bg-bg-tertiary rounded-xl` frame with a centred `Loader2` 28
 * `text-brand` and the two copy lines. Under `prefers-reduced-motion: reduce` (which is what
 * Tailwind's `motion-reduce:` variant compiles to) the spinner does NOT spin and the copy carries
 * the state on its own.
 *
 * **`ready`** — the token is minted PER REQUEST against the caller's membership when the player
 * opens (D-44) and lives in this closure only: it is never cached, stored or put in a URL that
 * outlives the session. A failed mint and a mid-session expiry both surface the GENERIC toast plus a
 * ghost "Tentar novamente" that mints a fresh one — a raw player error, a provider status or a token
 * fragment never reaches the screen (T-03-51).
 *
 * **No player bar (2026-10-20, the client's FRONT.pdf: no video of the app shows one).** The vendor's
 * controls and its error dialog are hidden (`--controls: none`, `--dialog: none`, no hotkeys), and
 * the video plays the way the feed's does:
 *  - by itself once half of it is on screen, looping, and paused when it leaves or the tab hides;
 *    under reduced motion it waits for a tap. Every play goes through `video-sound`: WITH sound
 *    unless the member muted a video this visit, and a browser that refuses the sound outside a
 *    gesture keeps it PLAYING muted;
 *  - a transparent button over the whole frame pauses and resumes it (so no click ever reaches the
 *    vendor, which would toggle play by itself), with the play badge in the centre while it is
 *    stopped; on a video the browser kept muted that click turns the sound on instead, inside the
 *    gesture (its name then says so). The frame is NOT a `data-video-surface`: the module would
 *    unmute before this click and the click would then pause;
 *  - the sound button in the corner turns the visit's sound on or off inside its click;
 *  - a player error is this component's own catalog line over the frame (`feedVideo.error`) with
 *    "Tentar novamente" below it, which mints afresh and remounts the player (`mints` is its key).
 *
 * **`failed`** — the danger pill and the catalog line, with NO player frame rendered at all.
 *
 * **E10/partial (the held-out backstop):** a `ready` asset whose still does not resolve — the
 * provider has not generated it yet, or the thumbnail token was refused — must not draw a
 * broken-image glyph. There are exactly three cases, and `data-poster` reports which one happened:
 *
 *  1. the element exposes NO poster URL at all → `none`, and nothing was ever requested;
 *  2. it exposes one that loads → `derived`;
 *  3. it exposes one that fails → the probe catches it and the element is told `poster=""` → `none`.
 *
 * Both mechanisms are verified against `@mux/mux-player@3.13.4`'s `dist/base.mjs`, not assumed:
 * `get poster()` returns an explicitly set attribute — the empty string included — before deriving
 * anything, so `""` really does mean "no poster"; and its thumbnail-URL builder returns `undefined`
 * whenever a token is present whose decoded `aud` claim is not `'t'`. The local fake provider mints
 * deterministic NON-JWT tokens, so case 1 is what every local and CI run exercises: the player
 * itself declines to build a still and the frame falls back to its plain `bg-bg-tertiary` ground.
 * Case 3 is the one a real Mux thumbnail token (`aud: 't'`) can reach, and it is covered by the same
 * `none` outcome. This component never constructs a vendor URL — it only ever asks the element.
 */
export function VideoPlayer({
  assetId,
  status,
  bleed = false,
  startTime,
  onProgress,
}: VideoPlayerProps) {
  const t = useTranslations('media');
  const toast = useToast();
  const frameRef = useRef<HTMLDivElement | null>(null);

  const [tokens, setTokens] = useState<{
    playbackId: string;
    playback: string;
    thumbnail: string;
    storyboard: string;
  } | null>(null);
  /** Bumped on every mint, and the player's key: a retry always remounts the element. */
  const [mints, setMints] = useState(0);
  const [minting, setMinting] = useState(false);
  const [refused, setRefused] = useState(false);
  /** `undefined` = let the player derive its own poster; `''` = no poster at all (see the docblock). */
  const [poster, setPoster] = useState<string | undefined>(undefined);
  /** Which of the three poster cases this render is in — observable, so the backstop is testable. */
  const [posterState, setPosterState] = useState<'pending' | 'none' | 'derived'>('pending');

  const [element, setElement] = useState<PlayerElement | null>(null);
  const [playing, setPlaying] = useState(false);
  /** The player raised an error: the catalog line and the retry show. */
  const [failed, setFailed] = useState(false);
  /** The browser refused even a muted play: the badge shows until a click plays it. */
  const [blocked, setBlocked] = useState(false);
  const [visible, setVisible] = useState(false);
  /** The member's own choice: `null` none yet (autoplay decides), else play or pause. */
  const [choice, setChoice] = useState<'play' | 'pause' | null>(null);

  const hidden = useSyncExternalStore(subscribeHidden, readHidden, readHiddenOnServer);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const audible = useVideoSoundAudible();
  const wanted = useVideoSoundWanted();

  const mint = useCallback(async () => {
    setMinting(true);
    setRefused(false);
    setFailed(false);
    setBlocked(false);
    setPoster(undefined);
    setPosterState('pending');
    try {
      const result = await fetchPlaybackTokenAction(assetId);
      if (!result.ok) {
        setRefused(true);
        // ALWAYS the generic message: the refusal code is a catalog key, never a status or a
        // provider string, and the member is told to try again rather than told what broke.
        toast.show({ tone: 'error', message: t('errors.generic') });
        return;
      }
      setTokens({
        playbackId: result.playback.playbackId,
        playback: result.playback.tokens.playback,
        thumbnail: result.playback.tokens.thumbnail,
        storyboard: result.playback.tokens.storyboard,
      });
      setMints((count) => count + 1);
    } catch (unexpected) {
      // The raw value goes to the console only (T-02-147 / T-03-51).
      console.error('media.playback_token_failed', { error: String(unexpected) });
      setRefused(true);
      toast.show({ tone: 'error', message: t('errors.generic') });
    } finally {
      setMinting(false);
    }
  }, [assetId, t, toast]);

  useEffect(() => {
    if (status !== 'ready') return;
    void mint();
  }, [status, mint]);

  // E10/partial backstop — see the docblock for the three cases.
  //
  // The element is found through the FRAME, not through a React ref: `next/dynamic` wraps the
  // component and a forwarded ref is not guaranteed to reach the custom element, whereas the DOM
  // node is always there once it has upgraded. The short poll IS that upgrade window — a custom
  // element defined by a dynamically imported chunk is not upgraded on the first commit.
  useEffect(() => {
    if (!tokens) return;
    let cancelled = false;
    let probe: HTMLImageElement | null = null;
    let elapsed = 0;
    const timer = setInterval(() => {
      if (cancelled) return;
      elapsed += POSTER_PROBE_STEP_MS;
      const found = frameRef.current?.querySelector('mux-player') as PosterReadable | null;
      const url = found?.poster;
      if (!url) {
        // Case 1: the player declined to build a still. It stays declined — there is nothing to
        // probe and nothing that could draw a broken glyph.
        if (elapsed >= POSTER_PROBE_TIMEOUT_MS) {
          clearInterval(timer);
          if (!cancelled) setPosterState('none');
        }
        return;
      }
      clearInterval(timer);
      probe = new Image();
      probe.onload = () => {
        if (!cancelled) setPosterState('derived');
      };
      probe.onerror = () => {
        if (cancelled) return;
        // Case 3: `""` is what makes the getter answer "no poster" instead of re-deriving the URL
        // it just failed to load.
        setPoster('');
        setPosterState('none');
      };
      probe.src = url;
    }, POSTER_PROBE_STEP_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (probe) {
        probe.onerror = null;
        probe.onload = null;
      }
    };
  }, [tokens]);

  // The progress listeners exist only when the host asked for them (R-Pattern 6): a feed or story
  // video renders the element exactly as before, with no handler attached.
  //
  // A `tick` reports only while the element PLAYS: the `timeupdate` a load or the `startTime` seek
  // fires on a paused element would otherwise write a position the member never watched to (0
  // before the resume seek lands, for one) over their stored place.
  const report = (reason: VideoProgressReason) => (event: Event) => {
    const clock = event.target as MediaClock | null;
    if (reason === 'tick' && clock?.paused === true) return;
    onProgress?.(wholeSeconds(clock?.currentTime), wholeSeconds(clock?.duration), reason);
  };
  const progressHandlers = onProgress
    ? { onTimeUpdate: report('tick'), onPause: report('pause'), onEnded: report('ended') }
    : {};
  const resumeAt =
    typeof startTime === 'number' && Number.isFinite(startTime) && startTime > 0
      ? { startTime: Math.floor(startTime) }
      : {};

  // The vendor node mounts late (`next/dynamic` forwards no ref), so it is found through the frame,
  // the bridge `FeedVideo` and `ReelVideo` use. The frame exists in the `ready` state only.
  useEffect(() => {
    const frame = frameRef.current;
    if (status !== 'ready' || !frame) return;
    let attached: PlayerElement | null = null;

    const onPlaying = () => {
      setPlaying(true);
      setBlocked(false);
    };
    const onPause = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setFailed(true);
    };

    const detach = () => {
      const current = attached;
      if (!current) return;
      current.removeEventListener('playing', onPlaying);
      current.removeEventListener('pause', onPause);
      current.removeEventListener('error', onError);
      forgetVideo(current);
      attached = null;
      setElement(null);
      setPlaying(false);
    };

    const reconcile = () => {
      const found = frame.querySelector<PlayerElement>('mux-player');
      if (found === attached) return;
      detach();
      if (!found) return;
      attached = found;
      found.addEventListener('playing', onPlaying);
      found.addEventListener('pause', onPause);
      found.addEventListener('error', onError);
      setElement(found);
    };

    reconcile();
    const observer = new MutationObserver(reconcile);
    observer.observe(frame, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      detach();
    };
  }, [status]);

  useEffect(() => {
    const frame = frameRef.current;
    if (status !== 'ready' || !frame) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setVisible(entry.isIntersecting && entry.intersectionRatio >= IN_VIEW_RATIO);
      },
      { threshold: [0, IN_VIEW_RATIO, 1] },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [status]);

  const wants =
    element !== null &&
    !failed &&
    visible &&
    (choice === 'play' || (choice === null && !reduceMotion));
  const shouldPlay = wants && !hidden;
  const shouldPlayRef = useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;

  useEffect(() => {
    if (!element) return;
    if (shouldPlay) {
      playVideo(element, {
        stillWanted: () => shouldPlayRef.current,
        onBlocked: () => setBlocked(true),
      });
    } else {
      pauseVideo(element);
    }
  }, [element, shouldPlay]);

  /** The cover button: pause or resume, inside the click (WebKit only starts sound in a gesture). */
  const toggle = () => {
    if (!element || failed) return;
    // The browser kept it muted although the sound is on: this click is the gesture that turns it on.
    if (videoSoundWanted() && element.muted === true && element.paused === false) {
      setVideoSoundWanted(true);
      return;
    }
    if (element.paused === false) {
      setChoice('pause');
      pauseVideo(element);
      return;
    }
    setChoice('play');
    setBlocked(false);
    playVideo(element, {
      stillWanted: () => shouldPlayRef.current,
      onBlocked: () => setBlocked(true),
    });
  };

  if (status === 'failed' || status === 'rejected') {
    // NO player frame at all — there is nothing to play, and an empty 16:9 box would suggest there is.
    return (
      <div className="flex flex-col items-start gap-2 p-4" data-testid="video-failed">
        <StatusPill tone={status === 'failed' ? 'danger' : 'neutral'}>
          {t(status === 'failed' ? 'status.failed' : 'status.rejected')}
        </StatusPill>
        <p className="text-sm text-danger">{t('player.failed')}</p>
      </div>
    );
  }

  if (status !== 'ready') {
    const frame = (
      <div
        className={cn(
          'flex aspect-video w-full flex-col items-center justify-center gap-3 bg-bg-tertiary',
          bleed ? 'px-4' : 'rounded-xl',
        )}
      >
        <Loader2
          aria-hidden
          size={28}
          className="animate-spin text-brand motion-reduce:animate-none"
          data-testid="video-processing-spinner"
        />
        <p className="text-sm text-text-secondary">{t('player.processing.title')}</p>
        <p className="max-w-[280px] text-center text-xs text-text-tertiary">
          {t('player.processing.body')}
        </p>
      </div>
    );
    return bleed ? (
      <div data-testid="video-processing">{frame}</div>
    ) : (
      <Card className="p-4" data-testid="video-processing">
        {frame}
      </Card>
    );
  }

  const live = element !== null && !failed;
  // Stopped by the member, waiting for a tap (reduced motion) or refused by the browser; never
  // while the first frames are still loading.
  const badge = live && !playing && (!shouldPlay || blocked);
  // Playing muted with the sound on: the browser held it back, and a click turns the sound on.
  const heldBack = playing && wanted && !audible;
  const toggleLabel = heldBack
    ? t('feedVideo.unmute')
    : playing
      ? t('feedVideo.pause')
      : t('feedVideo.play');

  const retry =
    refused || failed ? (
      <Button type="button" variant="ghost" size="sm" loading={minting} onClick={() => void mint()}>
        {t('retry')}
      </Button>
    ) : null;

  return (
    <div
      className={cn('flex flex-col gap-3', !bleed && 'p-4')}
      data-testid="video-ready"
      data-playing={playing}
      // The backstop is OBSERVABLE rather than merely "nothing visibly broke" — a shadow-DOM poster
      // would hide the difference from a test.
      data-poster={posterState}
    >
      <div
        className={cn(
          'relative aspect-video w-full overflow-hidden bg-bg-tertiary',
          !bleed && 'rounded-xl',
        )}
      >
        <div ref={frameRef} className="h-full w-full" onClickCapture={stopVendorClick}>
          {tokens ? (
            <MuxPlayer
              key={mints}
              playbackId={tokens.playbackId}
              tokens={{
                playback: tokens.playback,
                thumbnail: tokens.thumbnail,
                storyboard: tokens.storyboard,
              }}
              streamType="on-demand"
              playsInline
              loop={onProgress ? undefined : true}
              nohotkeys
              noMutedPref
              noVolumePref
              poster={poster}
              style={{
                '--controls': 'none',
                '--dialog': 'none',
                '--media-background-color': 'transparent',
                height: '100%',
                width: '100%',
              }}
              {...resumeAt}
              {...progressHandlers}
            />
          ) : null}
        </div>

        {live ? (
          <button
            type="button"
            data-testid="video-player-toggle"
            aria-label={toggleLabel}
            onClick={toggle}
            className="absolute inset-0 z-[1] grid cursor-pointer place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
          >
            {badge ? (
              <span
                aria-hidden
                data-testid="video-player-badge"
                className="grid h-14 w-14 place-items-center rounded-full bg-black/60 text-white"
              >
                <Play size={24} className="fill-current" />
              </span>
            ) : null}
          </button>
        ) : null}

        {live ? (
          <IconButton
            icon={audible ? Volume2 : VolumeX}
            size={18}
            label={audible ? t('feedVideo.mute') : t('feedVideo.unmute')}
            onClick={() => setVideoSoundWanted(!videoSoundAudible())}
            data-testid="video-player-sound"
            data-video-sound=""
            className="absolute right-3 bottom-3 z-[2] bg-black/60 text-white hover:bg-black/70 active:bg-black/75 focus-visible:ring-white focus-visible:ring-offset-0"
          />
        ) : null}

        {failed ? (
          <p
            role="status"
            className="pointer-events-none absolute inset-0 z-[2] grid place-items-center bg-black/60 px-6 text-center text-sm text-white"
          >
            {t('feedVideo.error')}
          </p>
        ) : null}
      </div>

      {/* Edge to edge, only the retry keeps the post's `px-4` gutter (stretched like the padded
          player's own). */}
      {retry && bleed ? <div className="flex flex-col px-4">{retry}</div> : retry}
    </div>
  );
}
