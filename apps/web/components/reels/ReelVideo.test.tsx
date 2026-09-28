// @vitest-environment happy-dom

import type { MediaPlayback } from '@rede-social/contracts/media';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Reels VIDEO element, on its own (REELS-06, UI-D-83, UI-D-85, UI-D-86, D-125, D-126).
 *
 * The technique is `StoryVideo.test.tsx`'s, extended for what this element adds:
 *
 *  - **`next/dynamic` is NOT mocked.** `MuxPlayer` arrives through `next/dynamic(…, { ssr: false })`,
 *    so the vendor element mounts LATE and the element has to observe for it. The vendor package is
 *    replaced by a stand-in that defers its own `mux-player` one further tick, so that condition holds
 *    whatever the bundler does with the dynamic import under vitest.
 *  - **The stand-in RECORDS the props it receives**, because most of this element's contract is what
 *    it hands the vendor: the two muted-preference opt-outs, `loop`, `nohotkeys`, no `autoPlay`, the
 *    preload per page and the fit variable.
 *  - **Its `play` is a `vi.fn` each case configures**: resolving, refusing with `NotAllowedError`,
 *    aborting with `AbortError`, or refusing twice.
 *
 * What is stubbed: the VENDOR PACKAGE (a third party's custom element, which cannot register under
 * happy-dom). What is real: the element, its observer, its listeners, its controller and its timer.
 * `vi.mock` stays top-level and the component is imported after it.
 */

const { play, pause, recorded, standIn } = vi.hoisted(() => ({
  play: vi.fn(),
  pause: vi.fn(),
  /** Every props object the stand-in rendered with, in order. */
  recorded: [] as Record<string, unknown>[],
  /** What the stand-in's element exposes as its derived poster URL (`undefined` = none). */
  standIn: { poster: undefined as string | undefined },
}));

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
        ref: (node: (HTMLElement & Record<string, unknown>) | null) => {
          if (!node || node.play === play) return;
          node.currentTime = 7;
          node.muted = true;
          node.play = play;
          node.pause = pause;
          Object.defineProperty(node, 'poster', {
            configurable: true,
            get: () => (recorded.at(-1)?.poster === '' ? '' : standIn.poster),
          });
        },
      });
    },
  };
});

const { ReelVideo } = await import('./ReelVideo');
type Controller = import('./ReelVideo').ReelVideoController;

const POST_ID = '0d000000-0000-4000-8000-0000000000e1';

const PLAYBACK: MediaPlayback = {
  playbackId: 'pb-reel-1',
  tokens: { playback: 'tok-playback', thumbnail: 'tok-thumbnail', storyboard: 'tok-storyboard' },
  expiresAt: '2026-09-26T22:00:00.000Z',
};

type MediaLikeElement = HTMLElement & { currentTime?: number; muted?: boolean };

function makeHandlers() {
  return {
    onController: vi.fn<(postId: string, controller: Controller | null) => void>(),
    onPlaying: vi.fn<(postId: string) => void>(),
    onWaiting: vi.fn<(postId: string) => void>(),
    onError: vi.fn<(postId: string) => void>(),
    onBlocked: vi.fn<(postId: string) => void>(),
    onSoundRefused: vi.fn<() => void>(),
  };
}

type Handlers = ReturnType<typeof makeHandlers>;

function renderReel(
  handlers: Handlers,
  overrides: Partial<{
    playback: MediaPlayback | null;
    width: number | null;
    height: number | null;
    current: boolean;
  }> = {},
) {
  return render(
    <ReelVideo
      postId={POST_ID}
      playback={overrides.playback === undefined ? PLAYBACK : overrides.playback}
      width={overrides.width === undefined ? 1080 : overrides.width}
      height={overrides.height === undefined ? 1920 : overrides.height}
      current={overrides.current ?? true}
      {...handlers}
    />,
  );
}

async function flush(times = 4) {
  for (let tick = 0; tick < times; tick += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Flush until the deferred vendor element exists — the dynamic import and the stand-in each defer. */
async function mountedPlayer(): Promise<MediaLikeElement> {
  for (let tick = 0; tick < 20; tick += 1) {
    const element = document.querySelector('mux-player');
    if (element) return element as MediaLikeElement;
    await flush(1);
  }
  throw new Error('the vendor element never mounted');
}

/** The props the stand-in received on its most recent render, once the dynamic import resolved. */
async function lastProps(): Promise<Record<string, unknown> | undefined> {
  await flush(20);
  return recorded.at(-1);
}

function controllerOf(handlers: Handlers): Controller {
  const controller = handlers.onController.mock.calls.findLast((call) => call[1] !== null)?.[1];
  if (!controller) throw new Error('no controller was handed to the host');
  return controller;
}

async function dispatch(element: MediaLikeElement, type: string) {
  await act(async () => {
    element.dispatchEvent(new Event(type));
  });
}

function refusal(name: 'NotAllowedError' | 'AbortError' | 'NotSupportedError') {
  return new DOMException(`play() refused (${name})`, name);
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  standIn.poster = undefined;
  play.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ReelVideo — props handed to the vendor element (D-125, D-126, UI-D-83)', () => {
  it('passes both muted-preference opt-outs, loop, nohotkeys, playsInline and on-demand, with no autoPlay and no vendor chrome', async () => {
    renderReel(makeHandlers());
    const props = await lastProps();

    expect(props).toMatchObject({
      playbackId: 'pb-reel-1',
      tokens: {
        playback: 'tok-playback',
        thumbnail: 'tok-thumbnail',
        storyboard: 'tok-storyboard',
      },
      noMutedPref: true,
      noVolumePref: true,
      nohotkeys: true,
      loop: true,
      playsInline: true,
      muted: true,
      streamType: 'on-demand',
    });
    expect(props && 'autoPlay' in props).toBe(false);
    expect(props?.className).toBeUndefined();
    expect((props?.style as Record<string, string> | undefined)?.['--controls']).toBe('none');
  });

  it('preload is auto on the current page and metadata on a neighbour', async () => {
    const { unmount } = renderReel(makeHandlers(), { current: true });
    expect((await lastProps())?.preload).toBe('auto');
    unmount();

    recorded.length = 0;
    renderReel(makeHandlers(), { current: false });
    expect((await lastProps())?.preload).toBe('metadata');
  });

  it('a 1080×1920 video fills the stage: --media-object-fit cover', async () => {
    renderReel(makeHandlers(), { width: 1080, height: 1920 });
    const style = (await lastProps())?.style as Record<string, string> | undefined;
    expect(style?.['--media-object-fit']).toBe('cover');
  });

  it('exactly the cover ratio (800×1000 = 0.8) still fills the stage', async () => {
    renderReel(makeHandlers(), { width: 800, height: 1000 });
    const style = (await lastProps())?.style as Record<string, string> | undefined;
    expect(style?.['--media-object-fit']).toBe('cover');
  });

  it('a 1920×1080 video is letterboxed: --media-object-fit contain', async () => {
    renderReel(makeHandlers(), { width: 1920, height: 1080 });
    const style = (await lastProps())?.style as Record<string, string> | undefined;
    expect(style?.['--media-object-fit']).toBe('contain');
  });

  it('null dimensions are letterboxed: --media-object-fit contain', async () => {
    renderReel(makeHandlers(), { width: null, height: null });
    const style = (await lastProps())?.style as Record<string, string> | undefined;
    expect(style?.['--media-object-fit']).toBe('contain');
  });

  it('with playback null no vendor element is rendered, only the black frame', async () => {
    const { getByTestId } = renderReel(makeHandlers(), { playback: null });
    await flush(10);

    expect(document.querySelector('mux-player')).toBeNull();
    expect(recorded).toHaveLength(0);
    expect(getByTestId('reel-video')).toBeTruthy();
  });
});

describe('ReelVideo — the controller the gesture calls (UI-D-85, RESEARCH Pattern 4)', () => {
  it('hands the host a controller once the element is attached', async () => {
    const handlers = makeHandlers();
    renderReel(handlers);
    await mountedPlayer();
    await flush();

    expect(handlers.onController.mock.calls.at(-1)?.[0]).toBe(POST_ID);
    expect(typeof handlers.onController.mock.calls.at(-1)?.[1]?.start).toBe('function');
  });

  it('start(false) rewinds to 0, mutes and calls play once', async () => {
    const handlers = makeHandlers();
    renderReel(handlers);
    const player = await mountedPlayer();
    await flush();

    player.muted = false;
    controllerOf(handlers).start(false);
    await flush();

    expect(player.currentTime).toBe(0);
    expect(player.muted).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('start(true) unmutes', async () => {
    const handlers = makeHandlers();
    renderReel(handlers);
    const player = await mountedPlayer();
    await flush();

    controllerOf(handlers).start(true);
    await flush();

    expect(player.muted).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('a NotAllowedError with sound falls back to muted, reports the refusal and plays again', async () => {
    play.mockRejectedValueOnce(refusal('NotAllowedError')).mockResolvedValueOnce(undefined);
    const handlers = makeHandlers();
    renderReel(handlers);
    const player = await mountedPlayer();
    await flush();

    controllerOf(handlers).start(true);
    await flush();

    expect(player.muted).toBe(true);
    expect(handlers.onSoundRefused).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(2);
    expect(handlers.onBlocked).not.toHaveBeenCalled();
  });

  it('a muted retry that is also refused reports blocked once', async () => {
    play
      .mockRejectedValueOnce(refusal('NotAllowedError'))
      .mockRejectedValueOnce(refusal('NotAllowedError'));
    const handlers = makeHandlers();
    renderReel(handlers);
    await mountedPlayer();
    await flush();

    controllerOf(handlers).start(true);
    await flush();

    expect(handlers.onSoundRefused).toHaveBeenCalledTimes(1);
    expect(handlers.onBlocked).toHaveBeenCalledTimes(1);
    expect(handlers.onBlocked).toHaveBeenCalledWith(POST_ID);
  });

  it('an AbortError after the host paused (a fast swipe interrupting play) is final: not blocked, not a sound refusal, not retried', async () => {
    play.mockRejectedValueOnce(refusal('AbortError'));
    const handlers = makeHandlers();
    renderReel(handlers);
    await mountedPlayer();
    await flush();

    const controller = controllerOf(handlers);
    controller.start(true);
    // The swipe leaves the page in the same gesture: the host pauses before the rejection lands.
    controller.pause();
    await flush();

    expect(handlers.onBlocked).not.toHaveBeenCalled();
    expect(handlers.onSoundRefused).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('05.3-09: an AbortError from the vendor attaching its source re-issues play with the element’s current sound state', async () => {
    // The browser's order on a page's first mount: play() with no source, the vendor sets its
    // source, the media load algorithm rejects the pending play with AbortError.
    play.mockRejectedValueOnce(refusal('AbortError'));
    const handlers = makeHandlers();
    renderReel(handlers);
    const element = await mountedPlayer();
    await flush();

    controllerOf(handlers).start(false);
    await flush();

    expect(play).toHaveBeenCalledTimes(2);
    expect(element.muted).toBe(true);
    expect(handlers.onBlocked).not.toHaveBeenCalled();
    expect(handlers.onSoundRefused).not.toHaveBeenCalled();
  });

  it('05.3-09: a source that keeps aborting is retried at most twice, then left alone', async () => {
    play.mockRejectedValue(refusal('AbortError'));
    const handlers = makeHandlers();
    renderReel(handlers);
    await mountedPlayer();
    await flush();

    controllerOf(handlers).start(false);
    await flush(12);

    expect(play).toHaveBeenCalledTimes(3);
    expect(handlers.onBlocked).not.toHaveBeenCalled();
  });

  it('any other rejection reports blocked', async () => {
    play.mockRejectedValueOnce(refusal('NotSupportedError'));
    const handlers = makeHandlers();
    renderReel(handlers);
    await mountedPlayer();
    await flush();

    controllerOf(handlers).start(false);
    await flush();

    expect(handlers.onBlocked).toHaveBeenCalledTimes(1);
    expect(handlers.onSoundRefused).not.toHaveBeenCalled();
  });

  it('resume keeps the position; pause and setMuted reach the element', async () => {
    const handlers = makeHandlers();
    renderReel(handlers);
    const player = await mountedPlayer();
    await flush();
    const controller = controllerOf(handlers);

    player.currentTime = 3;
    controller.resume(true);
    await flush();
    expect(player.currentTime).toBe(3);
    expect(player.muted).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);

    controller.pause();
    expect(pause).toHaveBeenCalledTimes(1);

    controller.setMuted(true);
    expect(player.muted).toBe(true);
  });
});

describe('ReelVideo — the autoplay check (UI-D-86)', () => {
  it('canplay on the current page and no playing within 400 ms reports blocked', async () => {
    const handlers = makeHandlers();
    renderReel(handlers, { current: true });
    const player = await mountedPlayer();
    await flush();

    vi.useFakeTimers();
    await dispatch(player, 'canplay');
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(handlers.onBlocked).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(handlers.onBlocked).toHaveBeenCalledTimes(1);
    expect(handlers.onBlocked).toHaveBeenCalledWith(POST_ID);
  });

  it('playing at 200 ms clears the check', async () => {
    const handlers = makeHandlers();
    renderReel(handlers, { current: true });
    const player = await mountedPlayer();
    await flush();

    vi.useFakeTimers();
    await dispatch(player, 'canplay');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    await dispatch(player, 'playing');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(handlers.onBlocked).not.toHaveBeenCalled();
  });

  it('canplay on a neighbour arms nothing', async () => {
    const handlers = makeHandlers();
    renderReel(handlers, { current: false });
    const player = await mountedPlayer();
    await flush();

    vi.useFakeTimers();
    await dispatch(player, 'canplay');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(handlers.onBlocked).not.toHaveBeenCalled();
  });

  it('a page the host paused is not reported blocked on a later canplay', async () => {
    const handlers = makeHandlers();
    renderReel(handlers, { current: true });
    const player = await mountedPlayer();
    await flush();
    controllerOf(handlers).pause();

    vi.useFakeTimers();
    await dispatch(player, 'canplay');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(handlers.onBlocked).not.toHaveBeenCalled();
  });

  it('resume on an element that is already playing (the sound toggle) is not reported blocked', async () => {
    const handlers = makeHandlers();
    renderReel(handlers, { current: true });
    const player = (await mountedPlayer()) as MediaLikeElement & { paused?: boolean };
    await flush();
    await dispatch(player, 'canplay');
    await dispatch(player, 'playing');

    // A playing element fires no second `playing` for a play() it is already doing.
    player.paused = false;
    vi.useFakeTimers();
    act(() => {
      controllerOf(handlers).resume(true);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(handlers.onBlocked).not.toHaveBeenCalled();
    expect(player.muted).toBe(false);
  });
});

describe('ReelVideo — events and lifecycle', () => {
  it('forwards error, waiting and playing with the post id', async () => {
    const handlers = makeHandlers();
    renderReel(handlers);
    const player = await mountedPlayer();
    await flush();

    await dispatch(player, 'error');
    expect(handlers.onError).toHaveBeenCalledWith(POST_ID);

    await dispatch(player, 'waiting');
    expect(handlers.onWaiting).toHaveBeenCalledWith(POST_ID);

    await dispatch(player, 'playing');
    expect(handlers.onPlaying).toHaveBeenCalledWith(POST_ID);
  });

  it('renders no error text of its own when the element errors', async () => {
    const handlers = makeHandlers();
    const { getByTestId } = renderReel(handlers);
    const player = await mountedPlayer();
    await flush();

    await dispatch(player, 'error');
    expect(getByTestId('reel-video').textContent).toBe('');
  });

  it('unregisters the controller with null on unmount and forwards nothing afterwards', async () => {
    const handlers = makeHandlers();
    const { unmount } = renderReel(handlers);
    const player = await mountedPlayer();
    await flush();

    unmount();
    expect(handlers.onController.mock.calls.at(-1)).toEqual([POST_ID, null]);

    await dispatch(player, 'playing');
    await dispatch(player, 'error');
    expect(handlers.onPlaying).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('a derived poster that fails to load is dropped, so no broken-image glyph is drawn (UI E04 empty)', async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage);
    standIn.poster = 'https://image.example/thumbnail.webp';

    renderReel(makeHandlers());
    await mountedPlayer();
    await flush(10);

    expect(recorded.at(-1)?.poster).toBe('');
  });

  it('with no derived poster (the fake provider) nothing is probed and the poster is left alone', async () => {
    const constructed = vi.fn();
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          constructed();
        }
      },
    );

    renderReel(makeHandlers());
    await mountedPlayer();
    await flush(10);

    expect(constructed).not.toHaveBeenCalled();
    expect(recorded.at(-1)?.poster).toBeUndefined();
  });
});

describe('ReelVideo — a re-minted credential (WR-02, D-44, D-125)', () => {
  function reel(handlers: Handlers, playback: MediaPlayback, current: boolean) {
    return (
      <ReelVideo
        postId={POST_ID}
        playback={playback}
        width={1080}
        height={1920}
        current={current}
        {...handlers}
      />
    );
  }

  it('the same credential in a new object, and a page turning neighbour and back, keep the element', async () => {
    const handlers = makeHandlers();
    const { rerender } = render(reel(handlers, PLAYBACK, true));
    const first = await mountedPlayer();
    await flush();
    const registrations = handlers.onController.mock.calls.length;

    rerender(reel(handlers, { ...PLAYBACK, tokens: { ...PLAYBACK.tokens } }, false));
    await flush(10);
    rerender(reel(handlers, { ...PLAYBACK, tokens: { ...PLAYBACK.tokens } }, true));
    await flush(10);

    expect(document.querySelector('mux-player')).toBe(first);
    expect(first.isConnected).toBe(true);
    expect(handlers.onController.mock.calls.length).toBe(registrations);
  });

  it('a new playback token remounts the vendor element, re-registers the controller and plays the new node', async () => {
    const handlers = makeHandlers();
    const { rerender } = render(reel(handlers, PLAYBACK, true));
    const first = await mountedPlayer();
    await flush();
    const firstController = controllerOf(handlers);
    const registrations = handlers.onController.mock.calls.length;

    const fresh: MediaPlayback = {
      ...PLAYBACK,
      tokens: { ...PLAYBACK.tokens, playback: 'tok-playback-2' },
      expiresAt: '2026-09-27T02:00:00.000Z',
    };
    rerender(reel(handlers, fresh, true));
    await flush(10);
    const second = await mountedPlayer();
    await flush(10);

    expect(first.isConnected).toBe(false);
    expect(second).not.toBe(first);
    const later = handlers.onController.mock.calls.slice(registrations);
    expect(later[0]).toEqual([POST_ID, null]);
    const secondController = later.at(-1)?.[1];
    expect(secondController).toBeTruthy();
    expect(secondController).not.toBe(firstController);
    expect((recorded.at(-1)?.tokens as { playback?: string } | undefined)?.playback).toBe(
      'tok-playback-2',
    );

    second.currentTime = 12;
    secondController?.start(false);
    await flush();
    expect(second.currentTime).toBe(0);
    expect(play).toHaveBeenCalled();
    expect(play.mock.contexts.at(-1)).toBe(second);
  });
});
