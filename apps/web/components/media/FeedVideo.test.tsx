// @vitest-environment happy-dom

import type { MediaPlayback } from '@rede-social/contracts/media';
import { PostMedia } from '@rede-social/module-feed/ui';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-05 — the feed's video, Instagram style: its own proportion, no player chrome, autoplay
 * muted in view (one at a time), one tap pauses (the sound button appears), two taps like.
 *
 * The technique is `ReelVideo.test.tsx`'s: the VENDOR PACKAGE is a stand-in that mounts its
 * `mux-player` one tick late (as `next/dynamic` does) and records the props it gets; its `play` and
 * `pause` are `vi.fn`s that flip `paused` and dispatch the media events. The token action, the
 * viewport (`IntersectionObserver`) and `VideoPlayer` are stubbed; the catalog is the REAL
 * `media.json`, so a drifting pt-BR line fails here.
 */

const { catalog, media, recorded, mintToken } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('media').media as Record<string, unknown>,
    media: { play: vi.fn(), pause: vi.fn(), videoWidth: 0, videoHeight: 0 },
    /** Every props object the stand-in rendered with, in order. */
    recorded: [] as Record<string, unknown>[],
    mintToken: vi.fn(),
  };
});

MotionGlobalConfig.skipAnimations = true;

const m = (key: string) =>
  String(
    key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog) ?? key,
  );

// STABLE, like next-intl's own: the component mints in an effect that depends on `t`.
const translate = (key: string) => m(key);
vi.mock('next-intl', () => ({ useTranslations: () => translate }));

// A PLAIN factory: the real module imports `lib/api` -> `lib/env`, which fail fast on env vars.
vi.mock('@/app/(app)/configuracoes/midia/actions', () => ({ fetchPlaybackTokenAction: mintToken }));

vi.mock('./VideoPlayer', () => ({
  VideoPlayer: ({ status }: { status: string }) => <div data-testid={`video-${status}`} />,
}));

type StandInElement = HTMLElement & {
  paused: boolean;
  muted: boolean;
  play: () => Promise<void>;
  pause: () => void;
};

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
        ref: (node: StandInElement | null) => {
          if (!node || node.dataset.wired) return;
          node.dataset.wired = 'yes';
          node.paused = true;
          node.muted = true;
          node.play = () => media.play(node);
          node.pause = () => media.pause(node);
          Object.defineProperty(node, 'videoWidth', { get: () => media.videoWidth });
          Object.defineProperty(node, 'videoHeight', { get: () => media.videoHeight });
        },
      });
    },
  };
});

const { FeedVideo, setFeedVideoSound } = await import('./FeedVideo');

const PLAYBACK: MediaPlayback = {
  playbackId: 'pb-feed-1',
  tokens: { playback: 'tok-playback', thumbnail: 'tok-thumbnail', storyboard: 'tok-storyboard' },
  expiresAt: '2026-10-05T22:00:00.000Z',
};

/* ── The viewport ─────────────────────────────────────────────────────────────────────────── */

const observers: { callback: IntersectionObserverCallback; targets: Element[] }[] = [];

class ViewportStub {
  readonly targets: Element[] = [];
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.targets.length = 0;
  }
  takeRecords() {
    return [];
  }
}

/** Reports `share` of the frame on screen (a 1000px-tall screen, a 400px-tall frame). */
async function scrollTo(frame: Element, share: number) {
  await act(async () => {
    for (const observer of observers) {
      if (!observer.targets.includes(frame)) continue;
      const entry = {
        target: frame,
        isIntersecting: share > 0,
        intersectionRatio: share,
        intersectionRect: { height: 400 * share },
        rootBounds: { height: 1000 },
      } as unknown as IntersectionObserverEntry;
      observer.callback([entry], observer as unknown as IntersectionObserver);
    }
  });
}

/* ── Helpers ──────────────────────────────────────────────────────────────────────────────── */

async function flush(times = 4) {
  for (let tick = 0; tick < times; tick += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Flush until every deferred vendor element exists. */
async function players(count = 1): Promise<StandInElement[]> {
  for (let tick = 0; tick < 30; tick += 1) {
    const found = [...document.querySelectorAll<StandInElement>('mux-player')];
    if (found.length >= count) {
      await flush();
      return found;
    }
    await flush(1);
  }
  throw new Error('the vendor element never mounted');
}

const frames = () => screen.getAllByTestId('feed-video-frame');
const frame = () => screen.getByTestId('feed-video-frame');
const soundButton = () => screen.queryByTestId('feed-video-sound');

/** One pointer that went down and up in place, then the double-tap window closing. */
async function tap(target: Element) {
  fireEvent.pointerDown(target, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(target, { clientX: 20, clientY: 20 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 340));
  });
}

async function doubleTap(target: Element) {
  for (let i = 0; i < 2; i += 1) {
    fireEvent.pointerDown(target, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(target, { clientX: 20, clientY: 20 });
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 340));
  });
}

function show(node: ReactElement) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

function video(
  overrides: Partial<{ assetId: string; width: number | null; height: number | null }> = {},
) {
  return (
    <FeedVideo
      assetId={overrides.assetId ?? '0e000000-0000-4000-8000-0000000000a1'}
      status="ready"
      width={overrides.width === undefined ? 1080 : overrides.width}
      height={overrides.height === undefined ? 1920 : overrides.height}
    />
  );
}

function refusal(name: 'NotAllowedError' | 'AbortError') {
  return new DOMException(`play() refused (${name})`, name);
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  observers.length = 0;
  media.videoWidth = 0;
  media.videoHeight = 0;
  vi.stubGlobal('IntersectionObserver', ViewportStub);
  setFeedVideoSound(false);
  mintToken.mockResolvedValue({ ok: true, playback: PLAYBACK });
  media.play.mockImplementation((node: StandInElement) => {
    node.paused = false;
    node.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
  media.pause.mockImplementation((node: StandInElement) => {
    if (node.paused) return;
    node.paused = true;
    node.dispatchEvent(new Event('pause'));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FeedVideo — the frame takes the video’s own proportion', () => {
  it('a stored 1080×1920 video gets a 9:16 frame', async () => {
    show(video({ width: 1080, height: 1920 }));
    await players();
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(9 / 16, 4);
    // The box itself carries it (happy-dom serialises a bare number as "n / 1").
    expect(frame().style.aspectRatio).toMatch(/^0\.5625( \/ 1)?$/);
  });

  it('a landscape 1920×1080 video gets a 16:9 frame', async () => {
    show(video({ width: 1920, height: 1080 }));
    await players();
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(16 / 9, 4);
  });

  it('only the extremes are trimmed: a screen recording to 9:16, a panorama to 1.91:1', async () => {
    const tall = show(video({ width: 1080, height: 2340 }));
    await players();
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(9 / 16, 4);
    tall.unmount();

    show(video({ width: 3000, height: 1000 }));
    await players();
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(1.91, 4);
  });

  it('with no stored size it opens at 4:5, then takes the size the video decodes to', async () => {
    show(video({ assetId: '0e000000-0000-4000-8000-0000000000b2', width: null, height: null }));
    const [player] = await players();
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(0.8, 4);

    media.videoWidth = 1920;
    media.videoHeight = 1080;
    await act(async () => {
      player?.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(16 / 9, 4);
  });
});

describe('FeedVideo — no player chrome', () => {
  it('hands the vendor no controls, no dialog, cover, loop, muted and the preference opt-outs', async () => {
    show(video());
    await players();
    const props = recorded.at(-1);
    expect(props).toMatchObject({
      playbackId: 'pb-feed-1',
      loop: true,
      muted: true,
      playsInline: true,
      nohotkeys: true,
      noMutedPref: true,
      noVolumePref: true,
      streamType: 'on-demand',
    });
    expect(props && 'autoPlay' in props).toBe(false);
    const style = props?.style as Record<string, string> | undefined;
    expect(style?.['--controls']).toBe('none');
    expect(style?.['--dialog']).toBe('none');
    expect(style?.['--media-object-fit']).toBe('cover');
  });

  it('a mouse click never reaches the vendor, which would toggle play by itself', async () => {
    show(video());
    const [player] = await players();
    const vendorClick = vi.fn();
    player?.addEventListener('click', vendorClick);
    fireEvent.click(player as Element);
    expect(vendorClick).not.toHaveBeenCalled();
  });
});

describe('FeedVideo — it plays by itself once most of it is on screen', () => {
  it('plays muted at 60% and pauses when it leaves, showing no sound button', async () => {
    show(video());
    const [player] = await players();
    expect(media.play).not.toHaveBeenCalled();

    await scrollTo(frame(), 0.4);
    expect(media.play).not.toHaveBeenCalled();

    await scrollTo(frame(), 0.7);
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(player?.muted).toBe(true);
    expect(player?.paused).toBe(false);

    await scrollTo(frame(), 0);
    expect(player?.paused).toBe(true);
    // Paused by the scroll, not by the member: the frame stays bare.
    expect(soundButton()).toBeNull();
  });

  it('under reduced motion it waits paused, with the sound button, until a tap', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    show(video());
    await players();
    await scrollTo(frame(), 1);
    expect(media.play).not.toHaveBeenCalled();
    expect(soundButton()).not.toBeNull();

    await tap(frame());
    expect(media.play).toHaveBeenCalled();
    expect(soundButton()).toBeNull();
  });

  it('one video at a time: the newest in view plays and hands back when it leaves', async () => {
    show(
      <>
        {video({ assetId: '0e000000-0000-4000-8000-0000000000c1' })}
        {video({ assetId: '0e000000-0000-4000-8000-0000000000c2' })}
      </>,
    );
    const [first, second] = await players(2);
    const [frameA, frameB] = frames();

    await scrollTo(frameA as Element, 1);
    expect(first?.paused).toBe(false);

    await scrollTo(frameB as Element, 1);
    expect(second?.paused).toBe(false);
    expect(first?.paused).toBe(true);

    await scrollTo(frameB as Element, 0);
    expect(second?.paused).toBe(true);
    expect(first?.paused).toBe(false);
  });
});

describe('FeedVideo — the taps', () => {
  it('one tap pauses and shows the sound button; another resumes and hides it', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    expect(player?.paused).toBe(false);

    await tap(frame());
    expect(player?.paused).toBe(true);
    expect(soundButton()?.getAttribute('aria-label')).toBe(m('feedVideo.unmute'));

    await tap(frame());
    expect(player?.paused).toBe(false);
    expect(soundButton()).toBeNull();
  });

  it('a member pause holds while the video scrolls away and back', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    await tap(frame());
    await scrollTo(frame(), 0);
    await scrollTo(frame(), 1);
    expect(player?.paused).toBe(true);
    expect(soundButton()).not.toBeNull();
  });

  it('the sound button turns the sound on without resuming, and the next play has sound', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    await tap(frame());
    const plays = media.play.mock.calls.length;

    // Inside its own click, and its pointer never reaches the tap surface.
    const button = soundButton() as HTMLElement;
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 340));
    });
    expect(player?.muted).toBe(false);
    expect(player?.paused).toBe(true);
    expect(media.play.mock.calls.length).toBe(plays);
    expect(soundButton()?.getAttribute('aria-label')).toBe(m('feedVideo.mute'));

    await tap(frame());
    expect(player?.paused).toBe(false);
    expect(player?.muted).toBe(false);
  });

  it('two taps like the post through PostMedia and never pause it', async () => {
    const like = vi.fn();
    show(
      <PostMedia
        mediaKind="video"
        images={[]}
        video={video()}
        attachments={[]}
        onDoubleTapLike={like}
        labels={{ carousel: 'carousel', attachmentError: 'attachment-error' }}
      />,
    );
    const [player] = await players();
    await scrollTo(frame(), 1);

    await doubleTap(frame());
    expect(like).toHaveBeenCalledTimes(1);
    expect(player?.paused).toBe(false);
    expect(soundButton()).toBeNull();
  });

  it('a scroll that starts on the video is no tap', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    fireEvent.pointerDown(frame(), { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(frame(), { clientX: 20, clientY: 120 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 340));
    });
    expect(player?.paused).toBe(false);
  });

  it('the keyboard reaches the same toggle through the hidden button', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);

    fireEvent.click(screen.getByRole('button', { name: m('feedVideo.pause') }));
    await flush();
    expect(player?.paused).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: m('feedVideo.play') }));
    await flush();
    expect(player?.paused).toBe(false);
  });
});

describe('FeedVideo — refusals and errors', () => {
  it('sound refused outside a gesture plays muted and turns the visit’s sound off', async () => {
    setFeedVideoSound(true);
    media.play.mockImplementation((node: StandInElement) => {
      if (!node.muted) return Promise.reject(refusal('NotAllowedError'));
      node.paused = false;
      node.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    });
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    await flush();

    expect(media.play).toHaveBeenCalledTimes(2);
    expect(player?.muted).toBe(true);
    expect(player?.paused).toBe(false);

    await tap(frame());
    expect(soundButton()?.getAttribute('aria-label')).toBe(m('feedVideo.unmute'));
  });

  it('a play the browser refuses even muted waits for a tap, sound button showing', async () => {
    media.play.mockImplementationOnce(() => Promise.reject(refusal('NotAllowedError')));
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    await flush();
    expect(player?.paused).toBe(true);
    expect(soundButton()).not.toBeNull();

    await tap(frame());
    expect(player?.paused).toBe(false);
  });

  it('a player error shows the catalog line and a retry that mints again', async () => {
    show(video());
    const [player] = await players();
    await act(async () => {
      player?.dispatchEvent(new Event('error'));
    });
    expect(screen.getByText(m('feedVideo.error'))).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: m('retry') }));
    await flush(10);
    expect(mintToken).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(m('feedVideo.error'))).toBeNull();
  });

  it('a refused mint shows the generic toast and the retry, and renders no player', async () => {
    mintToken.mockResolvedValue({ ok: false, code: 'generic' });
    show(video());
    await flush(10);
    expect(document.querySelector('mux-player')).toBeNull();
    expect(await screen.findByText(m('errors.generic'))).toBeTruthy();
    expect(screen.getByRole('button', { name: m('retry') })).toBeTruthy();
  });
});

describe('FeedVideo — before the video is ready', () => {
  it('a processing video keeps the VideoPlayer frame and mints nothing', async () => {
    show(
      <FeedVideo
        assetId="0e000000-0000-4000-8000-0000000000d1"
        status="processing"
        width={null}
        height={null}
      />,
    );
    await flush();
    expect(screen.getByTestId('video-processing')).toBeTruthy();
    expect(mintToken).not.toHaveBeenCalled();
  });
});
