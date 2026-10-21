// @vitest-environment happy-dom

import type { StoryMediaControls } from '@rede-social/module-stories/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetVideoSound, videoSoundAudible } from '@/components/media/video-sound';

/**
 * The story viewer's VIDEO bridge, on its own (STORY-02, UI-D-30, UI-D-34, 05-11).
 *
 * `StoryViewerHost.test.tsx` proves the bridge inside the real viewer — a segment that fills from
 * the element's own time and hands over at the end. This file proves the bridge's OWN contract, at
 * the two edges the viewer cannot see: what it does the moment the vendor element appears, and
 * what it leaves behind when it goes.
 *
 * **The late mount is the subject, so `next/dynamic` is NOT mocked.** `MuxPlayer` arrives through
 * `next/dynamic(…, { ssr: false })`, which is exactly why the shipped bridge's one-shot
 * `querySelector` found nothing on the commit where the token resolved and never looked again
 * (05-VERIFICATION GAP 2, video half). Mocking the dynamic import to resolve eagerly would delete
 * that condition and hand back a green suite over the same bug. The vendor package is replaced by
 * a stand-in that defers its own element one further tick, so the condition holds no matter how
 * the bundler resolves the dynamic import under vitest.
 *
 * **2026-10-20 (the client's FRONT.pdf): no player bar, never paused, sound on.** The stand-in
 * records the props it is handed (the vendor chrome is switched off there) and its `play` answers
 * from a queue of browser outcomes, recording the mute it was asked with — so "a refusal keeps the
 * video playing muted" and "a touch on the stage turns the sound on" read as the browser's answers.
 * The playback rule itself (`video-sound.ts`) is REAL, and reset before every case.
 *
 * What is stubbed: the playback-token SERVER ACTION (a credential minted on the server) and the
 * VENDOR PACKAGE (a third party's custom element, which cannot register under happy-dom). What is
 * real: the bridge, its observer, its four listeners, both of its effects and the playback rule.
 */

type Outcome = 'ok' | 'NotAllowedError';

const { playbackToken, play, pause, recorded, outcomes } = vi.hoisted(() => ({
  playbackToken: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  /** Every props object the stand-in rendered with, in order. */
  recorded: [] as Record<string, unknown>[],
  /** What the next `play()` calls answer, in order; empty means "it plays". */
  outcomes: [] as Outcome[],
}));

vi.mock('@/app/(app)/configuracoes/midia/actions', () => ({
  fetchPlaybackTokenAction: playbackToken,
}));

type StandIn = HTMLElement & {
  currentTime?: number;
  duration?: number;
  muted?: boolean;
  paused?: boolean;
};

/**
 * The vendor player, replaced by a stand-in that mounts its `mux-player` element ONE TICK LATE and
 * gives it the media-element surface the bridge reaches for.
 *
 * The surface is attached in a REF CALLBACK rather than an effect: a ref callback runs during the
 * commit, before the bridge's `MutationObserver` can be delivered, so `play`/`pause` are already
 * on the node the first time the play/pause effect touches it. `createElement` rather than JSX —
 * `mux-player` is not in `JSX.IntrinsicElements` and a test double is no reason to widen it.
 */
vi.mock('@mux/mux-player-react', async () => {
  const { createElement, useEffect, useState } = await import('react');
  return {
    default: function MuxPlayerStandIn(props: Record<string, unknown>) {
      recorded.push(props);
      const [mounted, setMounted] = useState(false);
      useEffect(() => {
        setMounted(true);
      }, []);
      if (!mounted) return null;
      return createElement('mux-player', {
        'data-testid': 'mux-player',
        ref: (node: (StandIn & Record<string, unknown>) | null) => {
          if (!node || node.dataset.wired) return;
          node.dataset.wired = 'yes';
          node.currentTime = 0;
          node.duration = 0;
          node.muted = false;
          node.paused = true;
          node.play = () => {
            play(node.muted === true);
            const outcome = outcomes.shift() ?? 'ok';
            if (outcome === 'ok') {
              node.paused = false;
              return Promise.resolve();
            }
            return Promise.reject(Object.assign(new Error(outcome), { name: outcome }));
          };
          node.pause = () => {
            pause();
            node.paused = true;
          };
        },
      });
    },
  };
});

const { StoryVideo } = await import('./StoryVideo');

const ASSET = '0d000000-0000-4000-8000-0000000000b1';
/**
 * `storyId` is REQUIRED on `StoryVideoProps`: it is what keys the host's play registration per
 * story rather than per mount (CR-02). Every render site in this file carries it.
 */
const STORY_ID = '0d000000-0000-4000-8000-0000000000d1';

const TOKEN = {
  ok: true as const,
  playback: {
    playbackId: 'pb-story-1',
    tokens: { playback: 'tok-playback', thumbnail: 'tok-thumbnail', storyboard: 'tok-storyboard' },
  },
};

/**
 * The control double covers EVERY member of `StoryMediaControls` — `satisfies` is what keeps it
 * that way, so a handler added to the viewer's contract cannot be called into thin air from here.
 * The sound is ON by default (2026-10-20).
 */
function makeControls(paused = false, muted = false) {
  return {
    active: true,
    paused,
    muted,
    onLoad: vi.fn(),
    onError: vi.fn(),
    onCanPlay: vi.fn(),
    onPlaying: vi.fn(),
    onBlocked: vi.fn(),
    onTimeUpdate: vi.fn(),
  } satisfies StoryMediaControls;
}

type Controls = ReturnType<typeof makeControls>;

/** Flush until the deferred vendor element exists — the dynamic import and the stand-in each defer. */
async function mountedPlayer(): Promise<StandIn> {
  for (let tick = 0; tick < 20; tick += 1) {
    const element = document.querySelector('mux-player');
    if (element) {
      await flush();
      return element as StandIn;
    }
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error('the vendor element never mounted');
}

async function flush(times = 4) {
  for (let tick = 0; tick < times; tick += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function dispatch(element: StandIn, type: string) {
  await act(async () => {
    element.dispatchEvent(new Event(type));
  });
}

/** The mute each `play()` was asked with, in order (`true` = muted). */
const mutedAtPlay = () => play.mock.calls.map(([muted]) => muted as boolean);

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  outcomes.length = 0;
  resetVideoSound();
  playbackToken.mockResolvedValue(TOKEN);
});
afterEach(cleanup);

describe('StoryVideo — the viewer’s video bridge (STORY-02, UI-D-30, UI-D-34)', () => {
  it('1. attaches to an element that mounts LATE and forwards all four of its events', async () => {
    const controls: Controls = makeControls();
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} />);

    const player = await mountedPlayer();

    await dispatch(player, 'canplay');
    expect(controls.onCanPlay).toHaveBeenCalledTimes(1);

    await dispatch(player, 'playing');
    expect(controls.onPlaying).toHaveBeenCalledTimes(1);

    player.currentTime = 2.5;
    player.duration = 5;
    await dispatch(player, 'timeupdate');
    expect(controls.onTimeUpdate).toHaveBeenCalledTimes(1);
    // The ELEMENT'S own pair, forwarded verbatim — never a timer standing beside it.
    expect(controls.onTimeUpdate).toHaveBeenCalledWith(2.5, 5);

    await dispatch(player, 'error');
    expect(controls.onError).toHaveBeenCalledTimes(1);
  });

  it('2. IGNORES a time update whose duration is zero or non-finite', async () => {
    const controls: Controls = makeControls();
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} />);
    const player = await mountedPlayer();

    player.currentTime = 4;
    player.duration = 0;
    await dispatch(player, 'timeupdate');
    expect(controls.onTimeUpdate).toHaveBeenCalledTimes(0);

    player.duration = Number.POSITIVE_INFINITY;
    await dispatch(player, 'timeupdate');
    expect(controls.onTimeUpdate).toHaveBeenCalledTimes(0);
  });

  it('3. applies the paused flag it is ALREADY HOLDING the moment the element appears', async () => {
    const controls: Controls = makeControls(true);
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} />);

    await mountedPlayer();
    // No prop change between the render and this assertion — that is the whole claim. The shipped
    // bridge queried once on the token commit, found nothing, and left the flags unapplied until
    // some later toggle happened to re-run the effect.
    expect(pause).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(0);
  });

  it('4. flipping paused to false plays the element, WITH sound (2026-10-20)', async () => {
    const controls: Controls = makeControls(true);
    const { rerender } = render(
      <StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} />,
    );
    await mountedPlayer();

    rerender(
      <StoryVideo assetId={ASSET} storyId={STORY_ID} controls={{ ...controls, paused: false }} />,
    );
    await flush();

    expect(play).toHaveBeenCalledTimes(1);
    expect(mutedAtPlay()).toEqual([false]);
  });

  it('5. hands the host a callable on attach, null on unmount, and leaves no live listener', async () => {
    const controls: Controls = makeControls();
    const bindPlay = vi.fn();
    const { unmount } = render(
      <StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} onPlayRef={bindPlay} />,
    );

    const player = await mountedPlayer();
    // Two arguments now: the STORY ID the component was given, then the callable. The id is what
    // lets the host keep one registration per story instead of one shared slot (CR-02).
    expect(bindPlay.mock.calls.at(-1)?.[0]).toBe(STORY_ID);
    expect(typeof bindPlay.mock.calls.at(-1)?.[1]).toBe('function');

    unmount();
    expect(bindPlay.mock.calls.at(-1)?.[0]).toBe(STORY_ID);
    expect(bindPlay.mock.calls.at(-1)?.[1]).toBeNull();

    // A duration that WOULD have been forwarded, on the element the bridge has let go of.
    player.currentTime = 2.5;
    player.duration = 5;
    await dispatch(player, 'timeupdate');
    await dispatch(player, 'canplay');
    expect(controls.onTimeUpdate).toHaveBeenCalledTimes(0);
    expect(controls.onCanPlay).toHaveBeenCalledTimes(0);
  });

  it('6. a REFUSED token is a media failure, and no vendor element is mounted', async () => {
    playbackToken.mockResolvedValue({ ok: false, code: 'notReady' });
    const controls: Controls = makeControls();
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} />);
    await flush();

    // A refusal answers a KEY; the viewer renders its own error copy. No provider string, no
    // status and no expiry sentence reaches the screen (T-03-51).
    expect(controls.onError).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mux-player')).toBeNull();
    expect(document.querySelector('mux-player')).toBeNull();
  });
});

describe('StoryVideo — no player bar, never paused, sound on (2026-10-20, FRONT.pdf)', () => {
  it('7. the vendor gets NO chrome: no bar, no dialog, no hotkeys, no stored mute, no autoplay of its own', async () => {
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={makeControls()} />);
    await mountedPlayer();

    const props = recorded.at(-1) ?? {};
    expect(props).toMatchObject({
      playsInline: true,
      nohotkeys: true,
      noMutedPref: true,
      noVolumePref: true,
      streamType: 'on-demand',
    });
    expect(props.style).toMatchObject({ '--controls': 'none', '--dialog': 'none' });
    // The playback is the bridge's: the vendor neither autoplays nor holds a mute of its own.
    expect(props.autoPlay).toBeUndefined();
    expect(props.muted).toBeUndefined();
  });

  it('8. a click never reaches the player (its own handler would pause the story)', async () => {
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={makeControls()} />);
    const player = await mountedPlayer();
    const vendorClick = vi.fn();
    player.addEventListener('click', vendorClick);

    fireEvent.click(player);
    expect(vendorClick).not.toHaveBeenCalled();
  });

  it('9. it starts playing WITH sound the moment the element appears', async () => {
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={makeControls()} />);
    const player = await mountedPlayer();

    expect(mutedAtPlay()).toEqual([false]);
    expect(player.muted).toBe(false);
    expect(player.paused).toBe(false);
  });

  it('10. a member who muted gets the video playing muted', async () => {
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={makeControls(false, true)} />);
    const player = await mountedPlayer();

    expect(mutedAtPlay()).toEqual([true]);
    expect(player.paused).toBe(false);
  });

  it('11. a browser that refuses the sound gets the video playing MUTED, never paused and never blocked', async () => {
    outcomes.push('NotAllowedError');
    const controls = makeControls();
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} />);
    const player = await mountedPlayer();

    expect(mutedAtPlay()).toEqual([false, true]);
    expect(player.paused).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    expect(controls.onBlocked).not.toHaveBeenCalled();
    // The controls honestly read "Ativar som": the browser held the sound back.
    expect(videoSoundAudible()).toBe(false);
  });

  it('12. the next touch on the story stage turns the sound on, inside that touch', async () => {
    outcomes.push('NotAllowedError');
    render(
      <div data-video-surface="">
        <StoryVideo assetId={ASSET} storyId={STORY_ID} controls={makeControls()} />
      </div>,
    );
    const player = await mountedPlayer();
    expect(player.muted).toBe(true);

    await act(async () => {
      screen.getByTestId('story-video').dispatchEvent(new Event('touchend', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mutedAtPlay()).toEqual([false, true, false]);
    expect(player.muted).toBe(false);
    expect(videoSoundAudible()).toBe(true);
  });

  it('13. a refusal even MUTED is reported up (the viewer’s badge), and the badge’s callable plays inside the tap', async () => {
    outcomes.push('NotAllowedError', 'NotAllowedError');
    const controls = makeControls();
    const bindPlay = vi.fn();
    render(
      <StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} onPlayRef={bindPlay} />,
    );
    const player = await mountedPlayer();

    expect(controls.onBlocked).toHaveBeenCalledTimes(1);
    expect(player.paused).toBe(true);

    const playNow = bindPlay.mock.calls.at(-1)?.[1] as () => void;
    await act(async () => {
      playNow();
      await Promise.resolve();
    });
    expect(mutedAtPlay().at(-1)).toBe(false);
    expect(player.paused).toBe(false);
  });

  it('14. a story that should be playing and is not is started again at its first canplay', async () => {
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={makeControls()} />);
    const player = await mountedPlayer();
    expect(play).toHaveBeenCalledTimes(1);

    // The vendor had no source yet when it was asked: nothing started.
    player.paused = true;
    await dispatch(player, 'canplay');
    expect(play).toHaveBeenCalledTimes(2);

    // Already playing: a later canplay (a seek, a rebuffer) starts nothing twice.
    await dispatch(player, 'canplay');
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('15. a paused story no longer counts as a video the browser held the sound back from', async () => {
    outcomes.push('NotAllowedError');
    const controls = makeControls();
    const { rerender } = render(
      <StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} />,
    );
    await mountedPlayer();
    expect(videoSoundAudible()).toBe(false);

    rerender(
      <StoryVideo assetId={ASSET} storyId={STORY_ID} controls={{ ...controls, paused: true }} />,
    );
    await flush();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(videoSoundAudible()).toBe(true);
  });
});
