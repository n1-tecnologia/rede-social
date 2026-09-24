// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react';
import type { StoryMediaControls } from '@tria/module-stories/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
 * What is stubbed: the playback-token SERVER ACTION (a credential minted on the server) and the
 * VENDOR PACKAGE (a third party's custom element, which cannot register under happy-dom). What is
 * real: the bridge, its observer, its four listeners and both of its effects.
 *
 * The `StoryComposer.test.tsx` conventions are followed rather than a second style invented: the
 * happy-dom directive, hoisted spies, the server action mocked at its module path, and `act`
 * around everything that flushes an effect.
 */

const { playbackToken, play, pause } = vi.hoisted(() => ({
  playbackToken: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
}));

vi.mock('@/app/(app)/configuracoes/midia/actions', () => ({
  fetchPlaybackTokenAction: playbackToken,
}));

/**
 * The vendor player, replaced by a stand-in that mounts its `mux-player` element ONE TICK LATE and
 * gives it the media-element surface the bridge reaches for.
 *
 * The surface is attached in a REF CALLBACK rather than an effect: a ref callback runs during the
 * commit, before the bridge's `MutationObserver` can be delivered, so `play`/`pause` are already
 * on the node the first time the pause/mute effect touches it. `createElement` rather than JSX —
 * `mux-player` is not in `JSX.IntrinsicElements` and a test double is no reason to widen it.
 */
vi.mock('@mux/mux-player-react', async () => {
  const { createElement, useEffect, useState } = await import('react');
  return {
    default: function MuxPlayerStandIn() {
      const [mounted, setMounted] = useState(false);
      useEffect(() => {
        setMounted(true);
      }, []);
      if (!mounted) return null;
      return createElement('mux-player', {
        'data-testid': 'mux-player',
        ref: (node: (HTMLElement & Record<string, unknown>) | null) => {
          if (!node) return;
          node.currentTime = 0;
          node.duration = 0;
          node.muted = false;
          node.play = play;
          node.pause = pause;
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

type MediaLikeElement = HTMLElement & { currentTime?: number; duration?: number; muted?: boolean };

/**
 * The control double covers EVERY member of `StoryMediaControls` — `satisfies` is what keeps it
 * that way, so a handler added to the viewer's contract cannot be called into thin air from here.
 */
function makeControls(paused = false, muted = true) {
  return {
    active: true,
    paused,
    muted,
    onLoad: vi.fn(),
    onError: vi.fn(),
    onCanPlay: vi.fn(),
    onPlaying: vi.fn(),
    onTimeUpdate: vi.fn(),
  } satisfies StoryMediaControls;
}

type Controls = ReturnType<typeof makeControls>;

/** Flush until the deferred vendor element exists — the dynamic import and the stand-in each defer. */
async function mountedPlayer(): Promise<MediaLikeElement> {
  for (let tick = 0; tick < 20; tick += 1) {
    const element = document.querySelector('mux-player');
    if (element) return element as MediaLikeElement;
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

async function dispatch(element: MediaLikeElement, type: string) {
  await act(async () => {
    element.dispatchEvent(new Event(type));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  playbackToken.mockResolvedValue(TOKEN);
  play.mockResolvedValue(undefined);
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

  it('3. applies the paused and muted flags it is ALREADY HOLDING the moment the element appears', async () => {
    const controls: Controls = makeControls(true, true);
    render(<StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} />);

    const player = await mountedPlayer();
    // No prop change between the render and this assertion — that is the whole claim. The shipped
    // bridge queried once on the token commit, found nothing, and left the flags unapplied until
    // some later toggle happened to re-run the effect.
    await flush();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(player.muted).toBe(true);
    expect(play).toHaveBeenCalledTimes(0);
  });

  it('4. flipping paused to false calls the element’s play', async () => {
    const controls: Controls = makeControls(true, true);
    const { rerender } = render(
      <StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} />,
    );
    await mountedPlayer();
    await flush();

    rerender(
      <StoryVideo assetId={ASSET} storyId={STORY_ID} controls={{ ...controls, paused: false }} />,
    );
    await flush();

    expect(play).toHaveBeenCalledTimes(1);
  });

  it('5. hands the host a callable on attach, null on unmount, and leaves no live listener', async () => {
    const controls: Controls = makeControls();
    const bindPlay = vi.fn();
    const { unmount } = render(
      <StoryVideo assetId={ASSET} storyId={STORY_ID} controls={controls} onPlayRef={bindPlay} />,
    );

    const player = await mountedPlayer();
    await flush();
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
