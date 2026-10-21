'use client';

import type { MediaPlayback, MediaStatus } from '@rede-social/contracts/media';
import { usePostVideoGestures } from '@rede-social/module-feed/ui';
import { Button, DoubleTapHeart, IconButton, useMediaQuery, useToast } from '@rede-social/ui';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { fetchPlaybackTokenAction } from '@/app/(app)/configuracoes/midia/actions';
import { VideoPlayer } from './VideoPlayer';
import { probePosterRatio, rememberVideoRatio, useKnownVideoRatio } from './video-ratio';
import {
  forgetVideo,
  pauseVideo,
  playVideo,
  setVideoSoundWanted,
  useVideoSoundAudible,
  videoSoundAudible,
  videoSoundWanted,
} from './video-sound';

/**
 * `<mux-player>` is a CUSTOM ELEMENT that registers itself against `window.customElements` at import
 * time, so it stays out of the server bundle, the same posture `VideoPlayer` and `ReelVideo` take.
 */
const MuxPlayer = dynamic(() => import('@mux/mux-player-react'), { ssr: false });

/**
 * The frame takes the video's OWN ratio, so `cover` neither letterboxes nor crops it. Only the
 * extremes are trimmed: a phone screen recording taller than 9:16 and a panorama wider than the
 * widest photo (UI-D-09), never with black bars.
 */
export const FEED_VIDEO_MIN_RATIO = 9 / 16;
export const FEED_VIDEO_MAX_RATIO = 1.91;
/** Until the ratio is known (stored or learned): the tallest photo frame (UI-D-09). */
export const FEED_VIDEO_FALLBACK_RATIO = 4 / 5;

/** A learned `width / height` within the feed's clamps, or `null` when it is no ratio. */
function clampFeedVideoRatio(ratio: number | null): number | null {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.min(FEED_VIDEO_MAX_RATIO, Math.max(FEED_VIDEO_MIN_RATIO, ratio));
}

export function feedVideoRatio(
  width: number | null | undefined,
  height: number | null | undefined,
): number | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  return clampFeedVideoRatio(width / height);
}

/** How much of the frame must be on screen before it plays by itself. */
const IN_VIEW_RATIO = 0.6;
const IN_VIEW_STEPS = [0, 0.25, 0.5, 0.6, 0.75, 1];
/** A pointer that travels farther than this is a scroll, never a tap (UI-D-86's slop). */
const TAP_SLOP_PX = 10;

/** The standard media-element surface this component uses on the vendor node. */
type PlayableElement = HTMLElement & {
  play?: () => Promise<void> | void;
  pause?: () => void;
  muted?: boolean;
  paused?: boolean;
  poster?: string;
  videoWidth?: number;
  videoHeight?: number;
};

/* ── What every feed video of the visit shares ─────────────────────────────────────────────── */

type Listener = () => void;

/**
 * One video plays at a time. Every video that wants to play queues here and the NEWEST one plays
 * (the one the member scrolled to, or tapped); when it stops wanting to, the one before it resumes.
 */
let contenders: readonly string[] = [];
const turnListeners = new Set<Listener>();

function contend(id: string, wants: boolean): void {
  const rest = contenders.filter((other) => other !== id);
  const next = wants ? [...rest, id] : rest;
  if (next.length === contenders.length && next.every((other, i) => other === contenders[i])) {
    return;
  }
  contenders = next;
  for (const listener of turnListeners) listener();
}

function subscribeTurn(listener: Listener) {
  turnListeners.add(listener);
  return () => {
    turnListeners.delete(listener);
  };
}
const readTurn = () => contenders[contenders.length - 1] ?? null;
const readTurnOnServer = () => null;

function subscribeHidden(listener: Listener) {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}
const readHidden = () => document.visibilityState === 'hidden';
const readHiddenOnServer = () => false;

/**
 * 2026-10-09: while a full-screen surface plays over the feed (the Reels overlay a single tap
 * opens), every feed video stands down; the release gives each its turn back, and the one in view
 * resumes. A count of holders, each releasing once, so two holders never release each other.
 */
let suspensions = 0;
const suspendedListeners = new Set<Listener>();

function notifySuspended(): void {
  for (const listener of suspendedListeners) listener();
}

/** Suspends every feed video until the returned release is called (once; later calls do nothing). */
export function suspendFeedVideos(): () => void {
  suspensions += 1;
  notifySuspended();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suspensions -= 1;
    notifySuspended();
  };
}

function subscribeSuspended(listener: Listener) {
  suspendedListeners.add(listener);
  return () => {
    suspendedListeners.delete(listener);
  };
}
const readSuspended = () => suspensions > 0;
const readSuspendedOnServer = () => false;

/**
 * The browser is keeping this video muted although the member wants sound (`video-sound`'s "held
 * back"): it plays, muted, with the visit's sound on. The touch that lands on it then turns its
 * sound on (the module does, inside that touch), so that tap is not also a pause.
 */
function heldBack(element: PlayableElement | null): boolean {
  return (
    element !== null && videoSoundWanted() && element.muted === true && element.paused === false
  );
}

export interface FeedVideoProps {
  assetId: string;
  status: MediaStatus;
  /** The stored intrinsic size; `null` until the provider reports one (the local fake never does). */
  width: number | null;
  height: number | null;
}

/**
 * A post's video in the feed, Instagram style (2026-10-05): the video at its own proportion, edge to
 * edge, with NO player chrome. It plays looping once most of it is on screen, one video at a time.
 * Two taps like the post (the card's one toggle, from `usePostVideoGestures`).
 *
 * **One tap opens Reels at this video** (2026-10-09) when the card hands one (`onOpen` in
 * `usePostVideoGestures`: the tenant has Reels); without it one tap pauses or resumes, as before.
 * The sound button is therefore ALWAYS there while the video can play (bottom-right, over the frame),
 * since pausing first is no longer how the member reaches it. While a surface plays over the feed
 * (`suspendFeedVideos`) every video stands down. The frame takes focus from script only
 * (`tabIndex={-1}`), so the overlay can hand it back on close.
 *
 * **Sound on from the start (2026-10-20, the client's FRONT.pdf).** Every play goes through
 * `video-sound`, the rule all the app's videos share: WITH sound unless the member muted a video this
 * visit (the feed's, a story's or a Reel's: one choice), and a browser that refuses sound outside a
 * gesture leaves the video PLAYING muted, never paused, with the button reading "Ativar som". With
 * no Reels to open, the frame is a `data-video-surface`, so the next touch on it turns the sound on
 * inside that touch (what iOS needs), and that tap is then not also a pause (`heldBack`, read when
 * the press starts, before the module unmutes). A tap that opens Reels unmutes nothing: the feed's
 * video stands down at once under the overlay. A play refused even muted (Low Power Mode) waits
 * paused for a tap, as before.
 *
 * **What stays from `VideoPlayer`.** The processing and failed states are its frames, unchanged. The
 * playback token is minted per request when the frame opens (D-44) and lives in this closure only:
 * the player is keyed on a mint counter, never on the token. A refused mint shows the generic toast
 * and "Tentar novamente"; a player error shows the catalog line and the same retry.
 *
 * **The fit.** The frame carries the video's own ratio, clamped (see `feedVideoRatio`), and
 * `--media-object-fit: cover` fills it. A video's size is never stored, so the ratio is learned in
 * the browser and shared with Reels (`video-ratio`, 2026-10-09): one remembered in the tab shapes
 * the frame from the first render (a card that comes back opens at its shape); otherwise the
 * derived poster is probed as soon as the player has one, long before `loadedmetadata` (which an
 * iPhone may only fire after play), and `loadedmetadata` stays the second source. The vendor sets
 * `tokens` and then `playbackId` in its own effects, so the observer also watches `playback-id`
 * and probes once the poster exists. Until any of it arrives the frame is 4:5. From `md` the frame
 * also never grows taller than the screen: it narrows and centres, like the Reels column.
 *
 * **Gestures.** `DoubleTapHeart` owns the taps (`onSingleTap` opens or pauses, `onDoubleTap` likes,
 * with the Reels slop so a scroll is never a tap). media-chrome toggles play on a MOUSE click of the
 * video by itself, which would fight the single tap, so clicks inside the frame are stopped in the
 * capture phase before they reach the vendor. The member's own play runs inside the tap (WebKit
 * only lets sound start inside a gesture), and the sound button turns the visit's sound on or off
 * inside its click (`setVideoSoundWanted`) for the same reason. Keyboard and AT reach the pause
 * toggle through a visually hidden button that shows itself on focus (WCAG 2.2.2), and the sound
 * button is a real button.
 *
 * **Holding (2026-10-09).** A press held still for 200 ms (`DoubleTapHeart`'s hold) pauses the video
 * on that frame, like the story viewer, and the release resumes it when it should still play. The
 * hold is NOT the member's pause: `memberPaused` is untouched. Its release is no tap (it neither
 * opens, toggles the pause nor likes). The surface keeps the page's own
 * `touch-action` (vertical scroll, and the pinch-zoom WCAG 1.4.4 keeps), so a scroll that starts on
 * the video cancels the pointer, which ends the hold. A long press opens no callout or context menu
 * on the video (`-webkit-touch-callout: none`, `contextmenu` prevented), which would otherwise
 * cancel the pointer mid-hold.
 *
 * **Reduced motion.** Nothing autoplays: the video waits paused for a tap (which opens Reels when
 * the card offers it, and plays it in place otherwise).
 */
export function FeedVideo({ assetId, status, width, height }: FeedVideoProps) {
  // Processing, failed and rejected keep the shipped frames: there is nothing to play yet.
  if (status !== 'ready') return <VideoPlayer assetId={assetId} status={status} bleed />;
  return <ReadyFeedVideo assetId={assetId} width={width} height={height} />;
}

function ReadyFeedVideo({
  assetId,
  width,
  height,
}: {
  assetId: string;
  width: number | null;
  height: number | null;
}) {
  const t = useTranslations('media');
  const toast = useToast();
  const { onDoubleTapLike, onOpen } = usePostVideoGestures();
  const id = useId();
  const frameRef = useRef<HTMLDivElement | null>(null);

  const [playback, setPlayback] = useState<MediaPlayback | null>(null);
  /** Bumped on every mint, and the player's key: a retry always remounts the element. */
  const [mints, setMints] = useState(0);
  const [minting, setMinting] = useState(false);
  const [refused, setRefused] = useState(false);
  /** `''` once a derived poster failed to load; `undefined` lets the player derive its own. */
  const [poster, setPoster] = useState<string | undefined>(undefined);
  const [element, setElement] = useState<PlayableElement | null>(null);
  /** The raw ratio the tab learned for this asset (the poster, `loadedmetadata`, or Reels). */
  const learned = useKnownVideoRatio(assetId);
  const [view, setView] = useState({ visible: false, mostly: false });
  /** The member's own choice: `null` none yet (autoplay decides), `true` paused, `false` play. */
  const [memberPaused, setMemberPaused] = useState<boolean | null>(null);
  /** Bumped when the member plays a video that is not the newest contender, to take the turn. */
  const [claims, setClaims] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Pressed and held: paused on that frame until the release, the member's choice untouched. */
  const [held, setHeld] = useState(false);

  const audible = useVideoSoundAudible();
  const turn = useSyncExternalStore(subscribeTurn, readTurn, readTurnOnServer);
  const hidden = useSyncExternalStore(subscribeHidden, readHidden, readHiddenOnServer);
  const suspended = useSyncExternalStore(subscribeSuspended, readSuspended, readSuspendedOnServer);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const mint = useCallback(async () => {
    setMinting(true);
    setRefused(false);
    setFailed(false);
    setPoster(undefined);
    try {
      const result = await fetchPlaybackTokenAction(assetId);
      if (!result.ok) {
        setRefused(true);
        // ALWAYS the generic message, never a status or a provider string (T-03-51).
        toast.show({ tone: 'error', message: t('errors.generic') });
        return;
      }
      setPlayback(result.playback);
      setMints((count) => count + 1);
    } catch (unexpected) {
      console.error('media.playback_token_failed', { error: String(unexpected) });
      setRefused(true);
      toast.show({ tone: 'error', message: t('errors.generic') });
    } finally {
      setMinting(false);
    }
  }, [assetId, t, toast]);

  useEffect(() => {
    void mint();
  }, [mint]);

  // The vendor node mounts late (`next/dynamic` forwards no ref), so it is found through the frame,
  // the bridge `ReelVideo` and `StoryVideo` use.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let attached: PlayableElement | null = null;
    /** The attached element's derived poster went to the probe (once per element). */
    let probed = false;

    const onPlaying = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    /** The decoded size: the second source of the ratio, after the poster. */
    const onMetadata = () => {
      const videoWidth = attached?.videoWidth ?? 0;
      const videoHeight = attached?.videoHeight ?? 0;
      if (videoWidth > 0 && videoHeight > 0) rememberVideoRatio(assetId, videoWidth / videoHeight);
    };
    const onError = () => {
      setPlaying(false);
      setFailed(true);
    };

    /**
     * The derived poster, once it exists: its size is the video's ratio, remembered for the tab
     * (the frame follows through `useKnownVideoRatio`). A derived poster that does not load becomes
     * "no poster", never a broken-image glyph.
     */
    const probePoster = (found: PlayableElement) => {
      if (probed) return;
      const derived = found.poster;
      if (typeof derived !== 'string' || derived === '') return;
      probed = true;
      void probePosterRatio(derived).then((measured) => {
        if (measured !== null) rememberVideoRatio(assetId, measured);
        else if (attached === found) setPoster('');
      });
    };

    const attach = (found: PlayableElement) => {
      attached = found;
      probed = false;
      found.addEventListener('playing', onPlaying);
      found.addEventListener('pause', onPause);
      found.addEventListener('loadedmetadata', onMetadata);
      found.addEventListener('error', onError);
      if ((found.videoWidth ?? 0) > 0) onMetadata();
      probePoster(found);
      setElement(found);
    };

    const detach = () => {
      const current = attached;
      if (!current) return;
      current.removeEventListener('playing', onPlaying);
      current.removeEventListener('pause', onPause);
      current.removeEventListener('loadedmetadata', onMetadata);
      current.removeEventListener('error', onError);
      forgetVideo(current);
      attached = null;
      setElement(null);
      setPlaying(false);
    };

    const reconcile = () => {
      const found = frame.querySelector<PlayableElement>('mux-player');
      if (found !== attached) {
        detach();
        if (found) attach(found);
        return;
      }
      // The same element: its `playback-id` changed, so its poster may be derivable now.
      if (found) probePoster(found);
    };

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
  }, [assetId]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const screen = entry.rootBounds?.height ?? window.innerHeight;
        const visible = entry.isIntersecting;
        // A frame taller than the screen can never be 60% visible, so 60% of the SCREEN counts too.
        const mostly =
          visible &&
          (entry.intersectionRatio >= IN_VIEW_RATIO ||
            entry.intersectionRect.height >= screen * IN_VIEW_RATIO);
        setView((previous) =>
          previous.visible === visible && previous.mostly === mostly
            ? previous
            : { visible, mostly },
        );
      },
      { threshold: IN_VIEW_STEPS },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Autoplay needs most of the frame on screen; a video the member played keeps playing while any
  // of it is.
  const wants =
    element !== null &&
    !failed &&
    (memberPaused === false ? view.visible : memberPaused === null && !reduceMotion && view.mostly);

  // `claims` re-runs it so a tap moves this video to the end of the queue: its turn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `claims` is the re-run trigger
  useEffect(() => {
    contend(id, wants);
  }, [id, wants, claims]);
  useEffect(() => () => contend(id, false), [id]);

  // A hold pauses through here (the effect below pauses, then resumes on the release), never
  // through `memberPaused`, and it keeps the video's turn. So does a surface over the feed.
  const shouldPlay = wants && turn === id && !hidden && !held && !suspended;
  const shouldPlayRef = useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;

  useEffect(() => {
    if (!element) return;
    if (shouldPlay) playVideo(element, { stillWanted: () => shouldPlayRef.current });
    else pauseVideo(element);
  }, [element, shouldPlay]);

  const togglePause = useCallback(() => {
    if (!element || failed) return;
    if (element.paused === false) {
      setMemberPaused(true);
      pauseVideo(element);
      return;
    }
    setMemberPaused(false);
    setClaims((count) => count + 1);
    playVideo(element, { stillWanted: () => shouldPlayRef.current });
  }, [element, failed]);

  /**
   * This press lands on a video the browser kept muted: `video-sound` turns its sound on inside the
   * touch, so the tap it ends in must not pause it. Read when the press STARTS, before that unmute.
   */
  const unlocking = useRef(false);
  const notePress = useCallback(() => {
    unlocking.current = heldBack(element);
  }, [element]);

  const tapPause = useCallback(() => {
    if (unlocking.current) {
      unlocking.current = false;
      return;
    }
    togglePause();
  }, [togglePause]);

  // Inside the click: turning the sound on replays the playing video with sound in this gesture.
  const toggleSound = useCallback(() => {
    setVideoSoundWanted(!videoSoundAudible());
  }, []);

  const holdStart = useCallback(() => setHeld(true), []);
  const holdEnd = useCallback(() => setHeld(false), []);

  /** media-chrome plays/pauses on a mouse click of the video by itself; the single tap does it here. */
  const stopVendorClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  /** A long press opens no context menu over the video: it would cancel the pointer mid-hold. */
  const preventMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const ratio =
    feedVideoRatio(width, height) ?? clampFeedVideoRatio(learned) ?? FEED_VIDEO_FALLBACK_RATIO;
  // 2026-10-09: always there while the video can play — playing, paused or waiting — because one tap
  // may open Reels now, so pausing first is no longer how the member reaches it.
  const soundVisible = element !== null && !failed;

  return (
    <div className="flex flex-col gap-3" data-testid="video-ready" data-playing={playing}>
      <div
        className="relative mx-auto w-full md:w-[min(100%,calc((var(--screen-h)_-_7rem)_*_var(--feed-video-ratio)))]"
        style={{ '--feed-video-ratio': String(ratio) } as CSSProperties}
      >
        <DoubleTapHeart
          onDoubleTap={onDoubleTapLike}
          onSingleTap={onOpen ?? tapPause}
          tapSlopPx={TAP_SLOP_PX}
          onHoldStart={holdStart}
          onHoldEnd={holdEnd}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: it only notes a press, cancels the long-press menu and stops the vendor's click; the taps are DoubleTapHeart's and the keyboard path is the hidden pause button. */}
          <div
            ref={frameRef}
            data-testid="feed-video-frame"
            // Where the Reels overlay hands the focus back on close (from script only: no Tab stop).
            data-feed-video=""
            // A touch here turns a held-back video's sound on (`video-sound`), unless it opens Reels.
            data-video-surface={onOpen ? undefined : ''}
            tabIndex={-1}
            data-ratio={ratio}
            onPointerDownCapture={notePress}
            onClickCapture={stopVendorClick}
            onContextMenu={preventMenu}
            className="w-full cursor-pointer overflow-hidden bg-bg-tertiary [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
            style={{ aspectRatio: String(ratio) }}
          >
            {playback ? (
              <MuxPlayer
                key={mints}
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
                preload={view.mostly ? 'auto' : 'metadata'}
                poster={poster}
                style={{
                  '--controls': 'none',
                  '--dialog': 'none',
                  '--media-object-fit': 'cover',
                  '--media-background-color': 'transparent',
                  height: '100%',
                  width: '100%',
                }}
              />
            ) : null}
          </div>
        </DoubleTapHeart>

        {/* WCAG 2.2.2: pause without a gesture. Hidden until it has keyboard focus. */}
        <button
          type="button"
          aria-label={playing ? t('feedVideo.pause') : t('feedVideo.play')}
          disabled={element === null || failed}
          onClick={togglePause}
          className="sr-only focus:not-sr-only focus:absolute focus:top-1/2 focus:left-1/2 focus:z-[3] focus:grid focus:h-14 focus:w-14 focus:-translate-x-1/2 focus:-translate-y-1/2 focus:place-items-center focus:rounded-full focus:bg-black/60 focus:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {playing ? (
            <Pause aria-hidden size={24} className="fill-current" />
          ) : (
            <Play aria-hidden size={24} className="fill-current" />
          )}
        </button>

        {soundVisible ? (
          <IconButton
            icon={audible ? Volume2 : VolumeX}
            size={18}
            label={audible ? t('feedVideo.mute') : t('feedVideo.unmute')}
            onClick={toggleSound}
            data-testid="feed-video-sound"
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

      {refused || failed ? (
        <div className="flex flex-col px-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={minting}
            onClick={() => void mint()}
          >
            {t('retry')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
