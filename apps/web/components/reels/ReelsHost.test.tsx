// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { MediaPlayback } from '@tria/contracts/media';
import type { CommentsListLabels, CommentView } from '@tria/module-feed/ui';
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
 * the server actions, the toast and the VIDEO ELEMENT (a stand-in that registers a fake controller
 * once it has a credential, exactly when the real one's vendor element would appear). What is real:
 * the host, the pager (wrapped only to record its props), the lanes, the stage, and — for the page's
 * actions — the rail, the caption, the feed's like engine and the feed's threaded comment sheet.
 */

type FakeController = {
  start: Mock<(wantSound: boolean) => void>;
  pause: Mock<() => void>;
  resume: Mock<(wantSound: boolean) => void>;
  setMuted: Mock<(muted: boolean) => void>;
};

const {
  reels,
  feed,
  toast,
  mint,
  loadPage,
  loadComments,
  createComment,
  controllers,
  videoProps,
  pagerProps,
} = await vi.hoisted(async () => {
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
    loadComments: vi.fn(),
    createComment: vi.fn(),
    /** The LATEST controller each post's element registered. */
    controllers: new Map<string, FakeController>(),
    /** The latest props each post's element rendered with. */
    videoProps: new Map<string, ReelVideoProps>(),
    pagerProps: [] as ReelsPagerProps[],
  };
});

/**
 * `motion/react`, replaced by plain elements (happy-dom's `Animation.cancel()` rejects a promise
 * motion never catches). ONE component per tag, cached: a proxy that minted a new component type
 * on every `motion.div` access would remount the sheet's panel on every host re-render, and the
 * focus trap's Escape listener would stay behind on the detached node.
 */
vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'layout',
    'drag',
    'dragConstraints',
    'dragElastic',
    'onDragEnd',
  ]);
  const cache = new Map<string, unknown>();
  const proxy = new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        const cached = cache.get(tag);
        if (cached) return cached;
        const component = forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const plain: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(props)) {
            if (!MOTION_ONLY.has(key)) plain[key] = value;
          }
          return createElement(tag, { ...plain, ref });
        });
        cache.set(tag, component);
        return component;
      },
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

/** The sheet's label block, from the real feed catalog — the shape `feedCommentsProps` composes. */
function commentLabels(): CommentsListLabels {
  return {
    region: f('comments.region'),
    emptyLabel: f('comments.empty'),
    errorLabel: f('errors.comments'),
    errorRepliesLabel: f('errors.replies'),
    retryLabel: f('comments.retry'),
    submitErrorLabel: f('errors.commentSubmit'),
    replyDepthErrorLabel: f('errors.replyDepth'),
    storyNoReplyErrorLabel: f('errors.commentSubmit'),
    loadMoreLabel: f('comments.loadMore'),
    loadMoreRepliesLabel: f('comments.loadMoreReplies'),
    showReplies: { one: f('comments.showReplies.one'), other: f('comments.showReplies.other') },
    hideReplies: { one: f('comments.hideReplies.one'), other: f('comments.hideReplies.other') },
    replyChip: f('comments.replyChip'),
    replyChipDismiss: f('comments.replyChipDismiss'),
    placeholder: f('comments.placeholder'),
    submitLabel: f('comments.submit'),
    viewerLabel: f('comments.viewerAvatar'),
    nowLabel: f('comments.now'),
    deleteTitle: f('comments.delete.title'),
    deleteBody: f('comments.delete.body'),
    deleteConfirm: f('comments.delete.confirm'),
    deleteCancel: f('comments.delete.cancel'),
    item: {
      removedAuthor: f('comments.removedAuthor'),
      like: f('comments.like'),
      unlike: f('comments.unlike'),
      likes: { one: f('comments.likes.one'), other: f('comments.likes.other') },
      reply: f('comments.reply'),
      delete: f('comments.delete.label'),
    },
  };
}

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
      labels: commentLabels(),
      onLoadComments: loadComments,
      onLoadReplies: vi.fn(),
      onCreateComment: createComment,
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
  loadComments.mockResolvedValue({ ok: true, items: [], nextCursor: null });
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

/* ── One page's actions: like, comments, share (D-128..D-131, UI-D-87..UI-D-91) ───────────────── */

function currentPage(): HTMLElement {
  const page = document.querySelector<HTMLElement>('[data-reel-page="0"]');
  if (!page) throw new Error('page 0 is not rendered');
  return page;
}

async function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: f('actions.comment') }));
  await flush();
  return screen.getByRole('dialog', { name: f('comments.title') });
}

async function closeSheet() {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  });
  await flush();
}

describe('ReelsHost — the like, the double tap and the rail (D-128, D-129, UI-D-87)', () => {
  it('a double tap on an unliked page likes once through the feed action; a second sends nothing', async () => {
    const like = vi.fn(async () => ({ ok: true, liked: true, likeCount: 1 }) as const);
    const unlike = vi.fn(async () => ({ ok: true, liked: false, likeCount: 0 }) as const);
    renderHost({ onLike: like, onUnlike: unlike });
    await flush();

    await act(async () => {
      pagerProps.at(-1)?.onDoubleTap();
    });
    await act(async () => {
      pagerProps.at(-1)?.onDoubleTap();
    });
    await flush();

    expect(like).toHaveBeenCalledTimes(1);
    expect(like).toHaveBeenCalledWith(postId(1));
    expect(unlike).not.toHaveBeenCalled();
    const heart = screen.getByRole('button', { name: f('actions.unlike') });
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    expect(currentPage().querySelector('[data-reel-count="like"]')?.textContent).toBe('1');
    // The double tap never pauses.
    expect(controllerOf(1).pause).not.toHaveBeenCalled();

    // The rail's heart is the same engine: it CAN unlike.
    fireEvent.click(heart);
    await flush();
    expect(unlike).toHaveBeenCalledTimes(1);
  });

  it('a refused like reverts and raises the generic toast (UI-D-93d)', async () => {
    renderHost();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: f('actions.like') }));
    await flush();

    expect(noLike).toHaveBeenCalledWith(postId(1));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: f('errors.generic') });
    expect(
      screen.getByRole('button', { name: f('actions.like') }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('the avatar opens the profile, the chip the community, and a linkified caption renders', async () => {
    renderHost({
      initial: {
        items: [
          view(1, {
            caption: 'Veja https://exemplo.com.br agora',
            community: {
              name: 'Aulas',
              href: '/comunidades/c1',
              ariaLabel: 'Ver a comunidade Aulas',
            },
          }),
          view(2),
        ],
        nextCursor: null,
      },
    });
    await flush();

    const page = within(currentPage());
    expect(page.getByRole('link', { name: 'Ver o perfil de Autora 1' }).getAttribute('href')).toBe(
      '/membros/m1',
    );
    expect(page.getByRole('link', { name: 'Ver a comunidade Aulas' }).getAttribute('href')).toBe(
      '/comunidades/c1',
    );
    expect(page.getByRole('link', { name: 'https://exemplo.com.br' })).toBeTruthy();
  });

  it('a post with no community shows no chip', async () => {
    renderHost();
    await flush();
    expect(currentPage().querySelector('a[href^="/comunidades/"]')).toBeNull();
  });
});

describe('ReelsHost — share (D-130, UI-D-91)', () => {
  it('a view with no shareUrl renders no share button', async () => {
    renderHost({ initial: { items: [view(1, { shareUrl: null })], nextCursor: null } });
    await flush();
    expect(screen.queryByRole('button', { name: f('actions.share') })).toBeNull();
    expect(screen.getByRole('button', { name: f('actions.comment') })).toBeTruthy();
  });

  it('share copies the server-composed link, shows "Link copiado." and never pauses the video', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderHost();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: f('actions.share') }));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`https://demo.example/post/${postId(1)}`);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: f('share.copied') });
    expect(controllerOf(1).pause).not.toHaveBeenCalled();
  });
});

describe('ReelsHost — the comment sheet over Reels (UI-D-90, D-59, D-82)', () => {
  it('opening the sheet pauses the video and the pager; closing it resumes once', async () => {
    renderHost();
    await flush();

    const dialog = await openSheet();
    expect(dialog).toBeTruthy();
    expect(loadComments.mock.calls[0]?.[0]).toBe(postId(1));
    expect(controllerOf(1).pause).toHaveBeenCalledTimes(1);
    expect(pagerProps.at(-1)?.gesturesDisabled).toBe(true);
    // The sheet is OUTSIDE the stage's dark scope (UI-D-98).
    expect(dialog.closest('[data-theme="dark"]')).toBeNull();

    await press('ArrowDown');
    expect(position()).toBe('Vídeo 1, de Autora 1');

    await closeSheet();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(controllerOf(1).resume).toHaveBeenCalledTimes(1);
    expect(controllerOf(1).resume).toHaveBeenCalledWith(false);
    expect(pagerProps.at(-1)?.gesturesDisabled).toBe(false);
  });

  it('closing the sheet while hidden does not resume; becoming visible does (one order)', async () => {
    renderHost();
    await flush();
    await openSheet();
    await setVisibility('hidden');
    await closeSheet();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(controllerOf(1).resume).not.toHaveBeenCalled();

    await setVisibility('visible');
    expect(controllerOf(1).resume).toHaveBeenCalledTimes(1);
  });

  it('becoming visible with the sheet open does not resume; closing it does (the other order)', async () => {
    renderHost();
    await flush();
    await openSheet();
    await setVisibility('hidden');
    await setVisibility('visible');
    expect(controllerOf(1).resume).not.toHaveBeenCalled();

    await closeSheet();
    expect(controllerOf(1).resume).toHaveBeenCalledTimes(1);
  });

  it('a viewer who had paused stays paused when the sheet closes', async () => {
    renderHost();
    await flush();
    await press(' ');
    await openSheet();
    await closeSheet();
    expect(controllerOf(1).resume).not.toHaveBeenCalled();
    expect(screen.getByTestId('reels-play-badge')).toBeTruthy();
  });

  it('a comment written in the sheet bumps the rail count by the session delta', async () => {
    const created: CommentView = {
      id: 'c-new',
      body: 'Que vídeo!',
      author: { displayName: 'Eu', profileHref: null, avatarUrl: null },
      authorRemoved: false,
      createdAtIso: new Date().toISOString(),
      createdAtRelative: 'agora',
      createdAtAbsolute: 'agora',
      likeCount: 0,
      viewerLiked: false,
      replyCount: 0,
      isReply: false,
      canDelete: true,
    };
    createComment.mockResolvedValue({ ok: true, comment: created });
    renderHost();
    await flush();
    expect(currentPage().querySelector('[data-reel-count="comment"]')?.textContent).toBe('');

    const dialog = await openSheet();
    const input = within(dialog).getByPlaceholderText(f('comments.placeholder'));
    fireEvent.change(input, { target: { value: 'Que vídeo!' } });
    const form = input.closest('form');
    if (!form) throw new Error('the comment field has no form');
    await act(async () => {
      fireEvent.submit(form);
    });
    await flush();

    expect(createComment).toHaveBeenCalledWith(postId(1), 'Que vídeo!', undefined);
    expect(currentPage().querySelector('[data-reel-count="comment"]')?.textContent).toBe('1');
  });
});
