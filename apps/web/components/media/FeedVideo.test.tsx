// @vitest-environment happy-dom

import type { MediaPlayback } from '@rede-social/contracts/media';
import { PostMedia } from '@rede-social/module-feed/ui';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { knownVideoRatio, rememberVideoRatio, resetVideoRatios } from './video-ratio';

/**
 * 2026-10-05 — the feed's video, Instagram style: its own proportion, no player chrome, autoplay
 * muted in view (one at a time), one tap pauses, two taps like. 2026-10-09: one tap OPENS Reels when
 * the card offers it (`onOpen`), the sound button is always there while the video can play, and a
 * surface over the feed suspends every video (`suspendFeedVideos`).
 *
 * The technique is `ReelVideo.test.tsx`'s: the VENDOR PACKAGE is a stand-in that mounts its
 * `mux-player` one tick late (as `next/dynamic` does) and records the props it gets; its `play` and
 * `pause` are `vi.fn`s that flip `paused` and dispatch the media events. The token action, the
 * viewport (`IntersectionObserver`) and `VideoPlayer` are stubbed, and so is the `Image` the poster
 * probe loads (per case); the catalog is the REAL `media.json`, so a drifting pt-BR line fails here.
 * The tab's learned ratios (`video-ratio`) are emptied before every case.
 */

const { catalog, media, recorded, mintToken } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('media').media as Record<string, unknown>,
    /** The stand-in's media surface: `poster` is the URL the vendor would derive (none by default). */
    media: {
      play: vi.fn(),
      pause: vi.fn(),
      videoWidth: 0,
      videoHeight: 0,
      poster: undefined as string | undefined,
    },
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
          // `poster=""` from the component wins, as the vendor reads its own attribute first.
          Object.defineProperty(node, 'poster', {
            configurable: true,
            get: () => (recorded.at(-1)?.poster === '' ? '' : media.poster),
          });
        },
      });
    },
  };
});

const { FeedVideo, setFeedVideoSound, suspendFeedVideos } = await import('./FeedVideo');

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

/** A pointer pressed in place past the 200 ms hold; `release` lifts it. */
async function holdDown(target: Element) {
  fireEvent.pointerDown(target, { clientX: 20, clientY: 20 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
}

async function release(target: Element) {
  fireEvent.pointerUp(target, { clientX: 20, clientY: 20 });
  await flush();
}

/** Long enough for any single tap the release could have scheduled to fire. */
async function windowCloses() {
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

/** An `Image` stand-in: the poster loads at `size` on the next microtask, or fails. */
function stubPoster(size: { width: number; height: number } | 'error') {
  const requested: string[] = [];
  class PosterStandIn {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(url: string) {
      requested.push(url);
      queueMicrotask(() => {
        if (size === 'error') {
          this.onerror?.();
          return;
        }
        this.naturalWidth = size.width;
        this.naturalHeight = size.height;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal('Image', PosterStandIn);
  return requested;
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  observers.length = 0;
  media.videoWidth = 0;
  media.videoHeight = 0;
  media.poster = undefined;
  resetVideoRatios();
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

describe('FeedVideo — the ratio is learned early and remembered (2026-10-09, item 10)', () => {
  const ASSET = '0e000000-0000-4000-8000-0000000000b3';

  it('the poster probe gives the ratio before any metadata: a 9:16 video shows whole', async () => {
    const requested = stubPoster({ width: 1080, height: 1920 });
    media.poster = 'https://image.example/thumbnail.webp?token=t';
    show(video({ assetId: ASSET, width: null, height: null }));
    await players();
    await flush();

    expect(requested).toEqual(['https://image.example/thumbnail.webp?token=t']);
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(9 / 16, 4);
    // Remembered RAW for the tab, so Reels (and a later card) reuse it.
    expect(knownVideoRatio(ASSET)).toBeCloseTo(9 / 16, 6);
    // The token-bearing URL never lands in the page.
    expect(document.body.innerHTML).not.toContain('token=t');
  });

  it('a ratio the tab remembered shapes the frame on its first render, clamped like any other', async () => {
    rememberVideoRatio(ASSET, 9 / 16);
    const first = show(video({ assetId: ASSET, width: null, height: null }));
    // Before the player even mounts: no 4:5 first.
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(9 / 16, 4);
    first.unmount();

    rememberVideoRatio(ASSET, 3);
    show(video({ assetId: ASSET, width: null, height: null }));
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(1.91, 4);
  });

  it('a card that remounts in the same visit opens at the shape it learned, with no jump', async () => {
    const first = show(video({ assetId: ASSET, width: null, height: null }));
    const [player] = await players();
    media.videoWidth = 1920;
    media.videoHeight = 1080;
    await act(async () => {
      player?.dispatchEvent(new Event('loadedmetadata'));
    });
    first.unmount();

    show(video({ assetId: ASSET, width: null, height: null }));
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(16 / 9, 4);
  });

  it('a stored size wins over a learned ratio', async () => {
    rememberVideoRatio(ASSET, 16 / 9);
    show(video({ assetId: ASSET, width: 1080, height: 1920 }));
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(9 / 16, 4);
  });

  it('a derived poster that fails to load is dropped (no broken glyph) and teaches nothing', async () => {
    stubPoster('error');
    media.poster = 'https://image.example/missing.webp';
    show(video({ assetId: ASSET, width: null, height: null }));
    await players();
    await flush(6);

    expect(recorded.at(-1)?.poster).toBe('');
    expect(knownVideoRatio(ASSET)).toBeNull();
    expect(Number(frame().getAttribute('data-ratio'))).toBeCloseTo(0.8, 4);
  });

  it('a poster the vendor derives only after mount is probed once its playback-id arrives', async () => {
    const requested = stubPoster({ width: 1920, height: 1080 });
    show(video({ assetId: ASSET, width: null, height: null }));
    const [player] = await players();
    expect(requested).toHaveLength(0);

    // The vendor sets `tokens`, then `playbackId` (which writes `playback-id`), in its own effects.
    media.poster = 'https://image.example/late.webp';
    await act(async () => {
      player?.setAttribute('playback-id', 'pb-feed-1');
    });
    await flush();
    expect(requested).toEqual(['https://image.example/late.webp']);
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
  it('plays muted at 60% and pauses when it leaves, its sound button there throughout', async () => {
    show(video());
    const [player] = await players();
    expect(media.play).not.toHaveBeenCalled();

    await scrollTo(frame(), 0.4);
    expect(media.play).not.toHaveBeenCalled();

    await scrollTo(frame(), 0.7);
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(player?.muted).toBe(true);
    expect(player?.paused).toBe(false);

    expect(soundButton()).not.toBeNull();

    await scrollTo(frame(), 0);
    expect(player?.paused).toBe(true);
    expect(soundButton()).not.toBeNull();
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
    expect(soundButton()).not.toBeNull();
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
  it('with no Reels to open, one tap pauses and another resumes; the sound button stays', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    expect(player?.paused).toBe(false);

    await tap(frame());
    expect(player?.paused).toBe(true);
    expect(soundButton()?.getAttribute('aria-label')).toBe(m('feedVideo.unmute'));

    await tap(frame());
    expect(player?.paused).toBe(false);
    expect(soundButton()?.getAttribute('aria-label')).toBe(m('feedVideo.unmute'));
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

describe('FeedVideo — holding pauses on that frame (2026-10-09, item 12)', () => {
  it('holding pauses; letting go resumes, and the release is no tap', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    expect(player?.paused).toBe(false);

    await holdDown(frame());
    expect(player?.paused).toBe(true);

    await release(frame());
    expect(player?.paused).toBe(false);
    await windowCloses();
    expect(player?.paused).toBe(false);
  });

  it('a hold leaves the member’s pause alone: a paused video stays paused after it', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    await tap(frame());
    expect(player?.paused).toBe(true);
    const plays = media.play.mock.calls.length;

    await holdDown(frame());
    await release(frame());
    await windowCloses();
    expect(player?.paused).toBe(true);
    expect(media.play.mock.calls.length).toBe(plays);
    expect(soundButton()).not.toBeNull();
  });

  it('a hold never likes the post, through PostMedia', async () => {
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

    await holdDown(frame());
    await release(frame());
    await tap(frame());
    expect(like).not.toHaveBeenCalled();
    // The tap after the hold is a single tap of its own: it pauses.
    expect(player?.paused).toBe(true);
  });

  it('a scroll that takes the pointer mid-hold (pointercancel) resumes the video', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);

    await holdDown(frame());
    expect(player?.paused).toBe(true);
    fireEvent.pointerCancel(frame(), { clientX: 20, clientY: 60 });
    await flush();
    expect(player?.paused).toBe(false);
  });

  it('a long press opens no context menu and no callout over the video', async () => {
    show(video());
    await players();
    // `fireEvent` answers false when the event's default was prevented.
    expect(fireEvent.contextMenu(frame())).toBe(false);
    expect(frame().className).toContain('[-webkit-touch-callout:none]');
  });
});

describe('FeedVideo — one tap opens Reels when the card offers it (2026-10-09)', () => {
  /** The video inside a post whose card hands `onOpenVideo` (the tenant has Reels). */
  function inPost(onOpenVideo?: () => void, onDoubleTapLike?: () => void) {
    return (
      <PostMedia
        mediaKind="video"
        images={[]}
        video={video()}
        attachments={[]}
        onDoubleTapLike={onDoubleTapLike}
        onOpenVideo={onOpenVideo}
        labels={{ carousel: 'carousel', attachmentError: 'attachment-error' }}
      />
    );
  }

  it('one tap opens, once, and never pauses the video', async () => {
    const open = vi.fn();
    show(inPost(open));
    const [player] = await players();
    await scrollTo(frame(), 1);

    await tap(frame());
    expect(open).toHaveBeenCalledTimes(1);
    expect(player?.paused).toBe(false);
  });

  it('two taps still like, and never open', async () => {
    const open = vi.fn();
    const like = vi.fn();
    show(inPost(open, like));
    await players();
    await scrollTo(frame(), 1);

    await doubleTap(frame());
    expect(like).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('a hold and a scroll that starts on the video never open', async () => {
    const open = vi.fn();
    show(inPost(open));
    await players();
    await scrollTo(frame(), 1);

    await holdDown(frame());
    await release(frame());
    await windowCloses();
    fireEvent.pointerDown(frame(), { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(frame(), { clientX: 20, clientY: 120 });
    await windowCloses();
    expect(open).not.toHaveBeenCalled();
  });

  it('the keyboard toggle still pauses in place', async () => {
    const open = vi.fn();
    show(inPost(open));
    const [player] = await players();
    await scrollTo(frame(), 1);

    fireEvent.click(screen.getByRole('button', { name: m('feedVideo.pause') }));
    await flush();
    expect(player?.paused).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('the frame takes focus from script only, so the overlay can hand it back', async () => {
    show(video());
    await players();
    expect(frame().tabIndex).toBe(-1);
    expect(frame().hasAttribute('data-feed-video')).toBe(true);
  });
});

describe('FeedVideo — the sound button is always there while it can play (2026-10-09)', () => {
  it('while it plays, the button turns the sound on inside its click and it keeps playing', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    expect(player?.paused).toBe(false);

    const button = soundButton() as HTMLElement;
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    await windowCloses();
    expect(player?.muted).toBe(false);
    expect(player?.paused).toBe(false);
    expect(soundButton()?.getAttribute('aria-label')).toBe(m('feedVideo.mute'));
  });

  it('there is none before the player exists, nor over a video that will not play', async () => {
    const pending = new Promise<never>(() => undefined);
    mintToken.mockReturnValueOnce(pending);
    const first = show(video());
    await flush();
    expect(soundButton()).toBeNull();
    first.unmount();

    show(video());
    const [player] = await players();
    expect(soundButton()).not.toBeNull();
    await act(async () => {
      player?.dispatchEvent(new Event('error'));
    });
    expect(soundButton()).toBeNull();
  });
});

describe('FeedVideo — a surface over the feed suspends every video (2026-10-09)', () => {
  it('suspended, the playing video pauses; released, it plays again', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);
    expect(player?.paused).toBe(false);

    let release = () => {};
    await act(async () => {
      release = suspendFeedVideos();
    });
    expect(player?.paused).toBe(true);

    await act(async () => {
      release();
    });
    expect(player?.paused).toBe(false);
  });

  it('two holders: it waits for both, and a second release by one changes nothing', async () => {
    show(video());
    const [player] = await players();
    await scrollTo(frame(), 1);

    let first = () => {};
    let second = () => {};
    await act(async () => {
      first = suspendFeedVideos();
      second = suspendFeedVideos();
    });
    await act(async () => {
      first();
      first();
    });
    expect(player?.paused).toBe(true);

    await act(async () => {
      second();
    });
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
