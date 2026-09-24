'use client';

import type { StoryMediaControls } from '@tria/module-stories/ui';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { fetchPlaybackTokenAction } from '@/app/(app)/configuracoes/midia/actions';

/**
 * `<mux-player>` is a CUSTOM ELEMENT: it registers itself against `window.customElements` at import
 * time, which does not exist during a server render. `next/dynamic` with `ssr: false` is the
 * documented way to keep it out of the server bundle — the same posture `VideoPlayer` takes.
 */
const MuxPlayer = dynamic(() => import('@mux/mux-player-react'), { ssr: false });

/**
 * A story's VIDEO, full-bleed inside the viewer (UI-D-33, UI-D-34).
 *
 * **Why this is not `components/media/VideoPlayer`.** That component is the FEED's player: a padded
 * `aspect-video` card with a status pill and a retry button — the right shape for a 16:9 post and
 * the wrong one for a full-screen 9:16 story on black. More importantly, the viewer needs the
 * element's own `canplay` / `playing` / `timeupdate` / `error`, because UI-D-30 drives a video's
 * segment from the ASSET'S OWN TIME rather than from a fixed timer that desynchronises the instant
 * the network stalls. `VideoPlayer` exposes none of them. The two share the vendor element and the
 * token action; nothing else.
 *
 * **The playback token is minted PER REQUEST and never cached** (D-44, T-05-34). It is fetched when
 * this element mounts — i.e. when the viewer opens on this story — lives in this closure, and is
 * never embedded in the strip's payload, written to a cookie, put in the router cache or logged.
 * There is deliberately no `"use cache"`, no `unstable_cache` and no `revalidate` anywhere near it.
 *
 * **Muted and inline, always to start** (Pitfall 6): iOS autoplays muted inline video and nothing
 * else, and even then Low Power Mode refuses. That refusal is reported UP — the viewer decides what
 * to do about it — which is how "did not start" becomes a state rather than an impossibility.
 */
export interface StoryVideoProps {
  assetId: string;
  controls: StoryMediaControls;
  /** Set by the host so the viewer's play badge can start playback inside the user's own gesture. */
  onPlayRef?: (play: (() => void) | null) => void;
}

/** What the custom element exposes that this bridge uses — standard media-element surface. */
type PlayableElement = HTMLElement & {
  play?: () => Promise<void> | void;
  pause?: () => void;
  currentTime?: number;
  duration?: number;
  muted?: boolean;
};

export function StoryVideo({ assetId, controls, onPlayRef }: StoryVideoProps) {
  const [tokens, setTokens] = useState<{
    playbackId: string;
    playback: string;
    thumbnail: string;
    storyboard: string;
  } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  /** The vendor element the listeners below are currently attached to, or null. */
  const playerRef = useRef<PlayableElement | null>(null);
  /**
   * How many times an element has been attached. Its ONLY job is to re-run the pause/mute effect
   * at the moment the element appears, so the flags the bridge is already holding are applied then
   * rather than at the next toggle.
   */
  const [attachments, setAttachments] = useState(0);

  /**
   * The controls object is rebuilt on every viewer render; reading it through a ref keeps the DOM
   * listeners below attached ONCE instead of being torn down sixty times a second.
   */
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchPlaybackTokenAction(assetId);
      if (cancelled) return;
      if (!result.ok) {
        // A refused or unmintable token is a media failure like any other: the viewer renders its
        // error copy and keeps the clock where it stopped. No provider string reaches the screen.
        controlsRef.current.onError();
        return;
      }
      setTokens({
        playbackId: result.playback.playbackId,
        playback: result.playback.tokens.playback,
        thumbnail: result.playback.tokens.thumbnail,
        storyboard: result.playback.tokens.storyboard,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  /**
   * The element's own events ARE the clock for a video segment — never a timer beside it.
   *
   * **The element is mounted by a CHILD THAT RESOLVES ASYNCHRONOUSLY, so this bridge OBSERVES for
   * it instead of guessing when it will arrive.** This effect used to key on `tokens` — a
   * dependency its body never read — on the reasoning that setting the token is what mounts
   * `<mux-player>`. It is not: `MuxPlayer` comes through `next/dynamic(…, { ssr: false })`, whose
   * chunk has not resolved on the commit where `tokens` first becomes non-null. The one-shot
   * `querySelector` returned null, the effect returned early, and neither dependency ever changed
   * again — so no `timeupdate` was ever forwarded, `videoProgress` stayed 0 and a video story
   * never progressed and never auto-advanced (05-VERIFICATION GAP 2, video half).
   *
   * **A ref callback on the player was considered and REJECTED**: `next/dynamic` does not forward
   * refs to the wrapped component, so a `ref={…}` on `<MuxPlayer>` is a second silent no-op with
   * exactly the same shape as the first. The observer is the mechanism.
   *
   * It keeps observing for the whole mount rather than disconnecting on first success — the
   * element is REPLACED when the asset changes, and a one-shot observer would reproduce the same
   * class of defect one level up.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const onCanPlay = () => controlsRef.current.onCanPlay();
    const onPlaying = () => controlsRef.current.onPlaying();
    const onError = () => controlsRef.current.onError();
    const onTimeUpdate = () => {
      const element = playerRef.current;
      if (!element) return;
      const duration = element.duration ?? 0;
      // UI-D-34: a duration the element cannot mean is IGNORED. A segment filling off a
      // meaningless number would tell the member they are watching something they are not.
      if (!Number.isFinite(duration) || duration <= 0) return;
      controlsRef.current.onTimeUpdate(element.currentTime ?? 0, duration);
    };

    const attach = (element: PlayableElement) => {
      playerRef.current = element;
      element.addEventListener('canplay', onCanPlay);
      element.addEventListener('playing', onPlaying);
      element.addEventListener('timeupdate', onTimeUpdate);
      element.addEventListener('error', onError);
      onPlayRef?.(() => {
        void element.play?.();
      });
      setAttachments((count) => count + 1);
    };

    const detach = () => {
      const element = playerRef.current;
      if (!element) return;
      element.removeEventListener('canplay', onCanPlay);
      element.removeEventListener('playing', onPlaying);
      element.removeEventListener('timeupdate', onTimeUpdate);
      element.removeEventListener('error', onError);
      playerRef.current = null;
      onPlayRef?.(null);
    };

    const reconcile = () => {
      const found = frame.querySelector<PlayableElement>('mux-player');
      if (found === playerRef.current) return;
      detach();
      if (found) attach(found);
    };

    // Once immediately — a SYNCHRONOUS mount must not wait for a mutation that already happened.
    reconcile();
    const observer = new MutationObserver(reconcile);
    observer.observe(frame, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      detach();
    };
  }, [onPlayRef]);

  /**
   * The viewer's ONE pause boolean reaches the element here, and nowhere else.
   *
   * `attachments` is a real dependency and a real read: before the first attachment there is no
   * element to apply anything to, and the moment there IS one, the flags this bridge is already
   * holding must be applied to it — without waiting for a later toggle. That second half of the
   * same defect is why `muted` and `paused` were silently ignored on arrival.
   */
  useEffect(() => {
    if (attachments === 0) return;
    const element = playerRef.current;
    if (!element) return;
    element.muted = controls.muted;
    if (controls.paused) element.pause?.();
    else void element.play?.();
  }, [controls.paused, controls.muted, attachments]);

  return (
    <div ref={frameRef} className="absolute inset-0" data-testid="story-video">
      {tokens ? (
        <MuxPlayer
          playbackId={tokens.playbackId}
          tokens={{
            playback: tokens.playback,
            thumbnail: tokens.thumbnail,
            storyboard: tokens.storyboard,
          }}
          streamType="on-demand"
          playsInline
          muted={controls.muted}
          autoPlay={controls.active && !controls.paused}
          // UI-D-33: a story is never cropped. The black ground is the surface.
          style={{ height: '100%', width: '100%' }}
          className="h-full w-full object-contain"
        />
      ) : null}
    </div>
  );
}
