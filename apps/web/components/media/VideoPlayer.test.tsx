// @vitest-environment happy-dom

import type { MediaPlayback } from '@rede-social/contracts/media';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetVideoSound, videoSoundWanted } from './video-sound';

/**
 * 2026-10-20 — the media library's and the post composer's player without the vendor's bar (the
 * client's FRONT.pdf: no video of the app shows one). It plays by itself once half of it is on
 * screen, WITH sound by `video-sound`'s rule (reset before every case); a transparent button over
 * the frame pauses and resumes it, with the play badge while it is stopped; the sound button turns
 * the visit's sound on and off; a player error is the catalog's own line with "Tentar novamente".
 *
 * The technique is `FeedVideo.test.tsx`'s: the VENDOR PACKAGE is a stand-in that mounts its
 * `mux-player` one tick late (as `next/dynamic` does) and records the props it gets; its `play` and
 * `pause` are `vi.fn`s that flip `paused` and dispatch the media events. The token action and the
 * viewport (`IntersectionObserver`) are stubbed; the catalog is the REAL `media.json`.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { catalog, media, recorded, mintToken } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('media').media as Record<string, unknown>,
    media: { play: vi.fn(), pause: vi.fn() },
    /** Every props object the stand-in rendered with, in order. */
    recorded: [] as Record<string, unknown>[],
    mintToken: vi.fn(),
  };
});

// The toast springs in; a cancelled spring rejects AFTER the run under happy-dom.
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
          node.muted = false;
          node.play = () => media.play(node);
          node.pause = () => media.pause(node);
        },
      });
    },
  };
});

const { VideoPlayer } = await import('./VideoPlayer');

const PLAYBACK: MediaPlayback = {
  playbackId: 'pb-library-1',
  tokens: { playback: 'tok-playback', thumbnail: 'tok-thumbnail', storyboard: 'tok-storyboard' },
  expiresAt: '2026-10-20T22:00:00.000Z',
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

/** Reports `share` of every observed frame on screen. */
async function scrollTo(share: number) {
  await act(async () => {
    for (const observer of observers) {
      for (const target of observer.targets) {
        const entry = {
          target,
          isIntersecting: share > 0,
          intersectionRatio: share,
        } as unknown as IntersectionObserverEntry;
        observer.callback([entry], observer as unknown as IntersectionObserver);
      }
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

/** Flush until the deferred vendor element exists and the component attached to it. */
async function player(): Promise<StandInElement> {
  for (let tick = 0; tick < 30; tick += 1) {
    const found = document.querySelector<StandInElement>('mux-player');
    if (found) {
      await flush();
      return found;
    }
    await flush(1);
  }
  throw new Error('the vendor element never mounted');
}

function show(node: ReactElement) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

const ready = () => <VideoPlayer assetId="0e000000-0000-4000-8000-0000000000f1" status="ready" />;
const toggle = () => screen.getByTestId('video-player-toggle');
const soundButton = () => screen.queryByTestId('video-player-sound');
const badge = () => screen.queryByTestId('video-player-badge');

function refusal(name: 'NotAllowedError' | 'AbortError') {
  return new DOMException(`play() refused (${name})`, name);
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', ViewportStub);
  resetVideoSound();
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

describe('VideoPlayer — no player bar (2026-10-20)', () => {
  it('hands the vendor no controls, no dialog, loop and the preference opt-outs, and no muted', async () => {
    show(ready());
    await player();
    expect(mintToken).toHaveBeenCalledTimes(1);
    const props = recorded.at(-1);
    expect(props).toMatchObject({
      playbackId: 'pb-library-1',
      loop: true,
      playsInline: true,
      nohotkeys: true,
      noMutedPref: true,
      noVolumePref: true,
      streamType: 'on-demand',
    });
    expect(props && 'autoPlay' in props).toBe(false);
    expect(props && 'muted' in props).toBe(false);
    expect(props && 'accentColor' in props).toBe(false);
    const style = props?.style as Record<string, string> | undefined;
    expect(style?.['--controls']).toBe('none');
    expect(style?.['--dialog']).toBe('none');
  });

  it('a lesson that reports its progress does not loop, so the video can end, and resumes where it stopped', async () => {
    show(
      <VideoPlayer
        assetId="0e000000-0000-4000-8000-0000000000f1"
        status="ready"
        startTime={42}
        onProgress={vi.fn()}
      />,
    );
    await player();
    const props = recorded.at(-1);
    expect(props?.loop).toBeUndefined();
    expect(props).toMatchObject({ startTime: 42 });
    expect(props?.onTimeUpdate).toBeTypeOf('function');
    expect(props?.onPause).toBeTypeOf('function');
    expect(props?.onEnded).toBeTypeOf('function');
  });

  it('a click on the frame never reaches the vendor, which would toggle play by itself', async () => {
    show(ready());
    const element = await player();
    const vendorClick = vi.fn();
    element.addEventListener('click', vendorClick);
    fireEvent.click(element);
    expect(vendorClick).not.toHaveBeenCalled();
  });
});

describe('VideoPlayer — it plays by itself in view, with sound', () => {
  it('plays WITH sound once half of it is on screen, and pauses when it leaves', async () => {
    show(ready());
    const element = await player();
    expect(media.play).not.toHaveBeenCalled();
    // Nothing is playing yet and nothing asked it to: no badge over a video that is loading.
    await scrollTo(0.3);
    expect(media.play).not.toHaveBeenCalled();

    await scrollTo(0.6);
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(element.muted).toBe(false);
    expect(element.paused).toBe(false);
    expect(badge()).toBeNull();
    expect(soundButton()?.getAttribute('aria-label')).toBe(m('feedVideo.mute'));
    expect(toggle().getAttribute('aria-label')).toBe(m('feedVideo.pause'));

    await scrollTo(0);
    expect(element.paused).toBe(true);
  });

  it('under reduced motion it waits with the badge until a click', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    show(ready());
    const element = await player();
    await scrollTo(1);
    expect(media.play).not.toHaveBeenCalled();
    expect(badge()).not.toBeNull();

    fireEvent.click(toggle());
    await flush();
    expect(element.paused).toBe(false);
    expect(badge()).toBeNull();
  });
});

describe('VideoPlayer — the click and the sound button', () => {
  it('a click pauses (the badge shows) and another resumes; a paused video stays paused in view', async () => {
    show(ready());
    const element = await player();
    await scrollTo(1);
    expect(element.paused).toBe(false);

    fireEvent.click(toggle());
    await flush();
    expect(element.paused).toBe(true);
    expect(badge()).not.toBeNull();
    expect(toggle().getAttribute('aria-label')).toBe(m('feedVideo.play'));

    await scrollTo(0);
    await scrollTo(1);
    expect(element.paused).toBe(true);

    fireEvent.click(toggle());
    await flush();
    expect(element.paused).toBe(false);
    expect(badge()).toBeNull();
  });

  it('the sound button mutes the visit in place; again, and the sound is back inside the click', async () => {
    show(ready());
    const element = await player();
    await scrollTo(1);

    fireEvent.click(soundButton() as HTMLElement);
    expect(videoSoundWanted()).toBe(false);
    expect(element.muted).toBe(true);
    expect(element.paused).toBe(false);
    expect(soundButton()?.getAttribute('aria-label')).toBe(m('feedVideo.unmute'));
    expect(soundButton()?.hasAttribute('data-video-sound')).toBe(true);

    fireEvent.click(soundButton() as HTMLElement);
    expect(element.muted).toBe(false);
    await flush();
    expect(soundButton()?.getAttribute('aria-label')).toBe(m('feedVideo.mute'));
  });

  it('sound refused outside a gesture keeps it PLAYING muted; the click turns the sound on instead of pausing', async () => {
    const gesture = { open: false };
    media.play.mockImplementation((node: StandInElement) => {
      if (!node.muted && !gesture.open) return Promise.reject(refusal('NotAllowedError'));
      node.paused = false;
      node.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    });
    show(ready());
    const element = await player();
    await scrollTo(1);
    await flush();

    expect(element.muted).toBe(true);
    expect(element.paused).toBe(false);
    expect(soundButton()?.getAttribute('aria-label')).toBe(m('feedVideo.unmute'));
    // The click's name says what it does now.
    expect(toggle().getAttribute('aria-label')).toBe(m('feedVideo.unmute'));

    gesture.open = true;
    fireEvent.click(toggle());
    await flush();
    expect(element.muted).toBe(false);
    expect(element.paused).toBe(false);
    expect(toggle().getAttribute('aria-label')).toBe(m('feedVideo.pause'));
  });

  it('a play refused even muted shows the badge, and a click plays it', async () => {
    media.play
      .mockImplementationOnce(() => Promise.reject(refusal('NotAllowedError')))
      .mockImplementationOnce(() => Promise.reject(refusal('NotAllowedError')));
    show(ready());
    const element = await player();
    await scrollTo(1);
    await flush();
    expect(element.paused).toBe(true);
    expect(badge()).not.toBeNull();

    fireEvent.click(toggle());
    await flush();
    expect(element.paused).toBe(false);
    expect(badge()).toBeNull();
  });
});

describe('VideoPlayer — errors', () => {
  it('a player error is the catalog line over the frame and a retry that mints and remounts', async () => {
    show(ready());
    const first = await player();
    await act(async () => {
      first.dispatchEvent(new Event('error'));
    });
    expect(screen.getByText(m('feedVideo.error'))).toBeTruthy();
    expect(soundButton()).toBeNull();
    expect(screen.queryByTestId('video-player-toggle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: m('retry') }));
    await flush(10);
    expect(mintToken).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(m('feedVideo.error'))).toBeNull();
    const second = await player();
    expect(second).not.toBe(first);
    expect(soundButton()).not.toBeNull();
  });

  it('a refused mint shows the generic toast and the retry, and renders no player', async () => {
    mintToken.mockResolvedValue({ ok: false, code: 'generic' });
    show(ready());
    await flush(10);
    expect(document.querySelector('mux-player')).toBeNull();
    expect(await screen.findByText(m('errors.generic'))).toBeTruthy();
    expect(screen.getByRole('button', { name: m('retry') })).toBeTruthy();
  });

  it('a processing video keeps its frame and mints nothing; a failed one has no frame', async () => {
    const processing = show(
      <VideoPlayer assetId="0e000000-0000-4000-8000-0000000000f2" status="processing" />,
    );
    await flush();
    expect(screen.getByTestId('video-processing')).toBeTruthy();
    expect(mintToken).not.toHaveBeenCalled();
    processing.unmount();

    show(<VideoPlayer assetId="0e000000-0000-4000-8000-0000000000f3" status="failed" />);
    await flush();
    expect(screen.getByTestId('video-failed')).toBeTruthy();
    expect(document.querySelector('mux-player')).toBeNull();
    expect(mintToken).not.toHaveBeenCalled();
  });
});
