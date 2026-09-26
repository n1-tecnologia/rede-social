// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MediaPlayback } from '@tria/contracts/media';
import type { ReelsPagerProps } from '@tria/module-reels/ui';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { ReelView } from '@/lib/reels';
import type { ReelsHostLabels, ReelsHostProps } from './ReelsHost';
import type { ReelVideoProps } from './ReelVideo';

/**
 * The Reels host (05.3-08) — the one state machine of the phase: lanes, lists and cursors, the
 * index, sound, the pause sources, the credential map and paging.
 *
 * The catalog is the REAL `reels.json` and `feed.json`, so a copy drift fails here. What is stubbed:
 * the two server actions, the toast and the VIDEO ELEMENT (a stand-in that registers a fake
 * controller once it has a credential, exactly when the real one's vendor element would appear).
 * What is real: the host, the pager (wrapped only to record its props), the lanes and the stage.
 */

type FakeController = {
  start: Mock<(wantSound: boolean) => void>;
  pause: Mock<() => void>;
  resume: Mock<(wantSound: boolean) => void>;
  setMuted: Mock<(muted: boolean) => void>;
};

const { reels, feed, toast, mint, loadPage, controllers, videoProps, pagerProps } =
  await vi.hoisted(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = (name: string) =>
      JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
    return {
      reels: read('reels').reels as Record<string, unknown>,
      feed: read('feed').feed as Record<string, unknown>,
      toast: { show: vi.fn(), dismiss: vi.fn() },
      mint: vi.fn(),
      loadPage: vi.fn(),
      /** The LATEST controller each post's element registered. */
      controllers: new Map<string, FakeController>(),
      /** The latest props each post's element rendered with. */
      videoProps: new Map<string, ReelVideoProps>(),
      pagerProps: [] as ReelsPagerProps[],
    };
  });

vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout']);
  const proxy = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const plain: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(props)) {
            if (!MOTION_ONLY.has(key)) plain[key] = value;
          }
          return createElement(tag, { ...plain, ref });
        }),
    },
  );
  return {
    motion: proxy,
    AnimatePresence: ({ children }: { children?: unknown }) => children,
    useReducedMotion: () => true,
  };
});

vi.mock('@tria/ui', async (orig) => ({
  ...(await orig<typeof import('@tria/ui')>()),
  useToast: () => toast,
}));

vi.mock('@/app/(app)/reels/reels-actions', () => ({
  mintReelPlaybackAction: mint,
  loadReelsPageAction: loadPage,
}));

/** The real pager, wrapped only so a case can read the props the host handed it. */
vi.mock('@tria/module-reels/ui', async (orig) => {
  const actual = await orig<typeof import('@tria/module-reels/ui')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    ReelsPager: (props: ReelsPagerProps) => {
      pagerProps.push(props);
      return createElement(actual.ReelsPager, props);
    },
  };
});

/**
 * The video element's stand-in: like the real one, it hands the host a controller only once it has
 * a credential (the vendor element mounts with `playback`), and `null` when it goes away.
 */
vi.mock('./ReelVideo', async () => {
  const { createElement, useEffect, useRef } = await import('react');
  return {
    ReelVideo: function ReelVideoStandIn(props: ReelVideoProps) {
      videoProps.set(props.postId, props);
      const own = useRef<FakeController | null>(null);
      if (own.current === null) {
        own.current = {
          start: vi.fn<(wantSound: boolean) => void>(),
          pause: vi.fn<() => void>(),
          resume: vi.fn<(wantSound: boolean) => void>(),
          setMuted: vi.fn<(muted: boolean) => void>(),
        };
      }
      const hasPlayback = props.playback !== null;
      const { postId, onController } = props;
      useEffect(() => {
        const controller = own.current;
        if (!hasPlayback || controller === null) return;
        controllers.set(postId, controller);
        onController(postId, controller);
        return () => onController(postId, null);
      }, [hasPlayback, postId, onController]);
      return createElement('div', {
        'data-testid': `reel-video-${props.postId}`,
        'data-playback': props.playback?.playbackId ?? '',
        'data-current': props.current ? 'true' : 'false',
      });
    },
  };
});

const { ReelsHost } = await import('./ReelsHost');

/* ── Fixtures ─────────────────────────────────────────────────────────────────────────────────── */

function lookup(catalog: Record<string, unknown>, key: string): string {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  if (typeof raw !== 'string') throw new Error(`missing catalog key ${key}`);
  return raw;
}
const r = (key: string) => lookup(reels, key);
const f = (key: string) => lookup(feed, key);

const TENANT = 'Tria Demo';

const LABELS: ReelsHostLabels = {
  region: r('region'),
  lanesLabel: r('lanes.label'),
  lanesAll: r('lanes.all'),
  soundUnmute: r('sound.unmute'),
  soundMute: r('sound.mute'),
  play: r('play'),
  pause: r('pause'),
  previous: r('previous'),
  next: r('next'),
  position: r('position'),
  railAuthor: r('rail.author'),
  captionMore: f('caption.more'),
  captionLess: r('caption.less'),
  like: f('actions.like'),
  unlike: f('actions.unlike'),
  comment: f('actions.comment'),
  share: f('actions.share'),
  likes: { one: f('meta.likes.one'), other: f('meta.likes.other') },
  emptyTitle: r('empty.title'),
  emptyBody: r('empty.body').replace('{tenant}', TENANT),
  emptyCta: f('empty.cta'),
  errorLoad: r('errors.load'),
  errorRetry: r('errors.retry'),
  errorPlayback: r('errors.playback'),
  errorLoadMore: r('errors.loadMore'),
  generic: f('errors.generic'),
  copied: f('share.copied'),
};

function postId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function view(n: number, overrides: Partial<ReelView> = {}): ReelView {
  const id = postId(n);
  return {
    id,
    caption: `Legenda ${n}`,
    shareUrl: `https://demo.example/post/${id}`,
    author: { displayName: `Autora ${n}`, profileHref: `/membros/m${n}`, avatarUrl: null },
    community: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    video: { assetId: `asset-${n}`, width: 1080, height: 1920 },
    ...overrides,
  };
}

function playback(assetId: string): MediaPlayback {
  return {
    playbackId: `pb-${assetId}`,
    tokens: { playback: `tok-${assetId}`, thumbnail: 'thumb', storyboard: 'board' },
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

function minted(ids: string[]) {
  return {
    ok: true,
    results: ids.map((assetId) => ({ assetId, ok: true, playback: playback(assetId) })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const noLike = vi.fn(async () => ({ ok: false }) as const);

function renderHost(overrides: Partial<ReelsHostProps> = {}) {
  const props: ReelsHostProps = {
    initial: { items: [view(1), view(2), view(3), view(4)], nextCursor: null },
    lanes: [],
    canPost: false,
    locale: 'pt-BR',
    tenantName: TENANT,
    onLike: noLike,
    onUnlike: noLike,
    comments: {
      title: f('comments.title'),
      locale: 'pt-BR',
      viewer: { displayName: 'Eu', profileHref: null, avatarUrl: null },
      labels: {} as never,
      onLoadComments: vi.fn(),
      onLoadReplies: vi.fn(),
      onCreateComment: vi.fn(),
      onDeleteComment: vi.fn(),
      onLikeComment: vi.fn(),
      onUnlikeComment: vi.fn(),
    },
    labels: LABELS,
    ...overrides,
  };
  return render(<ReelsHost {...props} />);
}

async function flush(times = 6) {
  for (let tick = 0; tick < times; tick += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function controllerOf(n: number): FakeController {
  const controller = controllers.get(postId(n));
  if (!controller) throw new Error(`page ${n} has no controller`);
  return controller;
}

function position(): string | null {
  return screen.getByTestId('reels-position').textContent;
}

async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key });
  });
  await flush();
}

let visibility: DocumentVisibilityState = 'visible';
async function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  controllers.clear();
  videoProps.clear();
  pagerProps.length = 0;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  mint.mockImplementation(async (ids: string[]) => minted(ids));
  loadPage.mockResolvedValue({ ok: true, items: [], nextCursor: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ── Credentials and the gesture (REELS-05, WebKit) ───────────────────────────────────────────── */

describe('ReelsHost — credentials and the gesture (REELS-05, RESEARCH Pattern 5)', () => {
  it('the first render mints pages 0 and 1 in ONE call, and the first video starts muted', async () => {
    renderHost();
    await flush();

    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledWith(['asset-1', 'asset-2']);
    expect(screen.getByTestId(`reel-video-${postId(1)}`).dataset.playback).toBe('pb-asset-1');
    expect(controllerOf(1).start).toHaveBeenCalledTimes(1);
    expect(controllerOf(1).start).toHaveBeenCalledWith(false);
    // A neighbour is mounted with its credential but never started.
    expect(controllerOf(2).start).not.toHaveBeenCalled();
  });

  it('onActivate(1) starts page 1 with start(false) BEFORE the index changes, and pauses page 0', async () => {
    renderHost();
    await flush();
    let positionAtStart: string | null = null;
    controllerOf(2).start.mockImplementation(() => {
      positionAtStart = position();
    });

    await press('ArrowDown');

    expect(controllerOf(1).pause).toHaveBeenCalledTimes(1);
    expect(controllerOf(2).start).toHaveBeenCalledWith(false);
    expect(positionAtStart).toBe('Vídeo 1, de Autora 1');
    expect(position()).toBe('Vídeo 2, de Autora 2');
    // The window moved: page 2 (index 2) is minted on its own, in one more call.
    expect(mint).toHaveBeenLastCalledWith(['asset-3']);
  });

  it('a stale mint result (the window moved to another lane before it resolved) is not stored', async () => {
    const first = deferred<ReturnType<typeof minted>>();
    mint.mockImplementationOnce(() => first.promise);
    loadPage.mockResolvedValue({ ok: true, items: [view(10)], nextCursor: null });
    renderHost({ lanes: [{ id: 'c1', name: 'Comunidade 1' }] });
    await flush();

    fireEvent.click(screen.getByRole('tab', { name: 'Comunidade 1' }));
    await flush();
    expect(loadPage).toHaveBeenCalledWith('c1', null);
    expect(mint).toHaveBeenLastCalledWith(['asset-10']);

    await act(async () => {
      first.resolve(minted(['asset-1', 'asset-2']));
    });
    await flush();

    // Back in Todos: nothing was stored, so the window is minted again and page 0 has no credential
    // until that fresh answer lands.
    const again = deferred<ReturnType<typeof minted>>();
    mint.mockImplementationOnce(() => again.promise);
    fireEvent.click(screen.getByRole('tab', { name: r('lanes.all') }));
    await flush();
    expect(mint).toHaveBeenLastCalledWith(['asset-1', 'asset-2']);
    expect(screen.getByTestId(`reel-video-${postId(1)}`).dataset.playback).toBe('');

    await act(async () => {
      again.resolve(minted(['asset-1', 'asset-2']));
    });
    await flush();
    expect(screen.getByTestId(`reel-video-${postId(1)}`).dataset.playback).toBe('pb-asset-1');
  });

  it('a lane page that resolves after the viewer left the lane is written to that lane only', async () => {
    const page = deferred<unknown>();
    loadPage.mockImplementationOnce(() => page.promise);
    renderHost({ lanes: [{ id: 'c1', name: 'Comunidade 1' }] });
    await flush();

    fireEvent.click(screen.getByRole('tab', { name: 'Comunidade 1' }));
    await flush();
    expect(screen.getByTestId('reels-stage-loading')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: r('lanes.all') }));
    await flush();

    await act(async () => {
      page.resolve({ ok: true, items: [view(10)], nextCursor: null });
    });
    await flush();
    expect(position()).toBe('Vídeo 1, de Autora 1');

    fireEvent.click(screen.getByRole('tab', { name: 'Comunidade 1' }));
    await flush();
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(position()).toBe('Vídeo 1, de Autora 10');
  });

  it('two retries while the fresh mint is in flight send ONE mint (REELS-08 idempotency)', async () => {
    mint.mockImplementationOnce(async () => ({
      ok: true,
      results: [
        { assetId: 'asset-1', ok: false, code: 'generic' },
        { assetId: 'asset-2', ok: true, playback: playback('asset-2') },
      ],
    }));
    renderHost();
    await flush();
    expect(screen.getByText(r('errors.playback'))).toBeTruthy();

    const retry = deferred<ReturnType<typeof minted>>();
    mint.mockImplementationOnce(() => retry.promise);
    const pill = screen.getByRole('button', { name: r('errors.retry') });
    fireEvent.click(pill);
    fireEvent.click(pill);
    await flush();
    expect(mint).toHaveBeenCalledTimes(2);
    expect(mint).toHaveBeenLastCalledWith(['asset-1']);

    await act(async () => {
      retry.resolve(minted(['asset-1']));
    });
    await flush();
    expect(screen.queryByText(r('errors.playback'))).toBeNull();
    expect(screen.getByTestId(`reel-video-${postId(1)}`).dataset.playback).toBe('pb-asset-1');
  });
});

/* ── Sound (D-126, UI-D-85) ───────────────────────────────────────────────────────────────────── */

describe('ReelsHost — sound for the visit (D-126, UI-D-85)', () => {
  it('turning sound on unmutes and plays the current video; later pages start with sound', async () => {
    renderHost();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: r('sound.unmute') }));
    expect(controllerOf(1).setMuted).toHaveBeenCalledWith(false);
    expect(controllerOf(1).resume).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: r('sound.mute') })).toBeTruthy();

    await press('ArrowDown');
    expect(controllerOf(2).start).toHaveBeenCalledWith(true);
    await press('ArrowDown');
    expect(controllerOf(3).start).toHaveBeenCalledWith(true);
  });

  it('a refused unmuted play flips the button back to "Ativar som" with no toast', async () => {
    renderHost();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: r('sound.unmute') }));

    await act(async () => {
      videoProps.get(postId(1))?.onSoundRefused();
    });
    expect(screen.getByRole('button', { name: r('sound.unmute') })).toBeTruthy();
    expect(toast.show).not.toHaveBeenCalled();

    await press('ArrowDown');
    expect(controllerOf(2).start).toHaveBeenCalledWith(false);
  });

  it('unmount forgets the choice: a remount starts muted, and nothing was stored', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { unmount } = renderHost();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: r('sound.unmute') }));
    unmount();
    controllers.clear();

    renderHost();
    await flush();
    expect(screen.getByRole('button', { name: r('sound.unmute') })).toBeTruthy();
    expect(controllerOf(1).start).toHaveBeenCalledWith(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
  });
});

/* ── Pause sources (UI-D-86) ──────────────────────────────────────────────────────────────────── */

describe('ReelsHost — the OR-ed pause sources (UI-D-86)', () => {
  it('Space pauses (badge shown) and Space again resumes with ONE resume', async () => {
    renderHost();
    await flush();

    await press(' ');
    expect(controllerOf(1).pause).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('reels-play-badge')).toBeTruthy();

    await press(' ');
    expect(controllerOf(1).resume).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('reels-play-badge')).toBeNull();
  });

  it('the background pauses and coming back resumes, unless the viewer had paused', async () => {
    renderHost();
    await flush();

    await setVisibility('hidden');
    expect(controllerOf(1).pause).toHaveBeenCalledTimes(1);
    await setVisibility('visible');
    expect(controllerOf(1).resume).toHaveBeenCalledTimes(1);

    await press(' ');
    await setVisibility('hidden');
    await setVisibility('visible');
    expect(controllerOf(1).resume).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('reels-play-badge')).toBeTruthy();
  });

  it('an autoplay-blocked page shows the badge, and one tap on it resumes', async () => {
    renderHost();
    await flush();
    await act(async () => {
      videoProps.get(postId(1))?.onBlocked(postId(1));
    });
    fireEvent.click(screen.getByTestId('reels-play-badge'));
    expect(controllerOf(1).resume).toHaveBeenCalledWith(false);
    await flush();
    expect(screen.queryByTestId('reels-play-badge')).toBeNull();
  });
});

/* ── Paging (UI-D-92, UI-D-93c) ───────────────────────────────────────────────────────────────── */

describe('ReelsHost — paging (UI-D-92, UI-D-93c)', () => {
  it('a failed next page shows ONE toast per attempt; the next end-swipe retries', async () => {
    loadPage.mockResolvedValue({ ok: false });
    renderHost({ initial: { items: [view(1), view(2)], nextCursor: 'cursor-1' } });
    await flush();

    // Due at once (index 0 ≥ 2 − 2), and the mint went first.
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(loadPage).toHaveBeenCalledWith(null, 'cursor-1');
    expect(mint.mock.invocationCallOrder[0]).toBeLessThan(
      loadPage.mock.invocationCallOrder[0] ?? 0,
    );
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: r('errors.loadMore') });

    await press('ArrowDown');
    expect(loadPage).toHaveBeenCalledTimes(1);

    await press('ArrowDown');
    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(toast.show).toHaveBeenCalledTimes(2);

    loadPage.mockResolvedValue({ ok: true, items: [view(3)], nextCursor: null });
    await press('ArrowDown');
    expect(loadPage).toHaveBeenCalledTimes(3);
    expect(toast.show).toHaveBeenCalledTimes(2);
    await press('ArrowDown');
    expect(position()).toBe('Vídeo 3, de Autora 3');
  });

  it('a failed first page renders the stage error; its retry loads Todos', async () => {
    loadPage.mockResolvedValue({ ok: true, items: [view(1)], nextCursor: null });
    renderHost({ initial: null });
    expect(screen.getByText(r('errors.load'))).toBeTruthy();
    expect(screen.queryByTestId('reels-pager')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: r('errors.retry') }));
    await flush();
    expect(loadPage).toHaveBeenCalledWith(null, null);
    expect(position()).toBe('Vídeo 1, de Autora 1');
  });
});

/* ── Empty state and lanes (UI-D-94, D-120) ───────────────────────────────────────────────────── */

describe('ReelsHost — the empty state and the lane row (UI-D-94, D-120)', () => {
  it('an empty Todos renders the empty state with no lanes, no sound button and no pager', async () => {
    renderHost({
      initial: { items: [], nextCursor: null },
      lanes: [{ id: 'c1', name: 'Comunidade 1' }],
    });
    await flush();

    expect(screen.getByText(r('empty.title'))).toBeTruthy();
    expect(screen.getByText(`Os vídeos publicados por ${TENANT} vão aparecer aqui.`)).toBeTruthy();
    expect(screen.queryByRole('link', { name: f('empty.cta') })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: r('sound.unmute') })).toBeNull();
    expect(screen.queryByTestId('reels-pager')).toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });

  it('an author gets "Criar publicação" to /criar in the empty state', async () => {
    renderHost({ initial: { items: [], nextCursor: null }, canPost: true });
    const cta = screen.getByRole('link', { name: f('empty.cta') });
    expect(cta.getAttribute('href')).toBe('/criar');
  });

  it('with one lane there is no tablist and the pager gets no onLaneStep', async () => {
    renderHost();
    await flush();
    expect(screen.queryByRole('tablist')).toBeNull();
    const props = pagerProps.at(-1);
    expect(props?.onLaneStep).toBeUndefined();
    expect(props?.panelId).toBeUndefined();
  });

  it('with two lanes the tablist names the pager panel and a lane step selects the next lane', async () => {
    loadPage.mockResolvedValue({ ok: true, items: [view(10)], nextCursor: null });
    renderHost({ lanes: [{ id: 'c1', name: 'Comunidade 1' }] });
    await flush();

    expect(screen.getByRole('tablist', { name: r('lanes.label') })).toBeTruthy();
    const props = pagerProps.at(-1);
    expect(props?.panelId).toBe('reels-panel');
    expect(props?.labelledBy).toBe('reels-lane-all');

    await act(async () => {
      pagerProps.at(-1)?.onLaneStep?.(1);
    });
    await flush();
    expect(loadPage).toHaveBeenCalledWith('c1', null);
    expect(position()).toBe('Vídeo 1, de Autora 10');
    expect(pagerProps.at(-1)?.labelledBy).toBe('reels-lane-c1');
  });
});
