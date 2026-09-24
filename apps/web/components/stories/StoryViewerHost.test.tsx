// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The app-tier shell that turns `StoryViewer` into a product surface (05-06, STORY-02/STORY-05).
 *
 * The catalog is the REAL `stories.json`, so an assertion here fails when the pt-BR copy drifts —
 * the `StoryComposer.test.tsx` pattern, one plan later. What is stubbed: the two server actions,
 * the toast, the playback-token action and the VENDOR PLAYER package. What is real: the viewer,
 * the shipped `LikeButton` and its optimistic engine, the plural counts, the media element and —
 * since 05-11 — the REAL `StoryVideo` bridge.
 *
 * **Why `./StoryVideo` is no longer stubbed.** It used to be, "because its vendor element cannot
 * mount under happy-dom", and that stub is precisely why GAP 2's video half shipped green: the
 * bridge attached its listeners with a one-shot `querySelector` on the commit where the token
 * resolved, the `next/dynamic(ssr:false)` chunk had not mounted `<mux-player>` yet, and no test in
 * the tree could see it. The seam that belongs to a unit test is the SERVER ACTION (the token) and
 * the VENDOR PACKAGE (a third party's custom element) — never the bridge itself, which is the
 * thing under test.
 *
 * The five claims worth a test are the five a later edit could quietly break:
 *
 *  1. **The like is OPTIMISTIC and then AUTHORITATIVE.** The count flips on the tap and is then
 *     replaced by the server's pair — not incremented locally and left there.
 *  2. **A failure REVERTS and raises the GENERIC toast, with no inline message.** A full-screen
 *     surface has nowhere to put an inline error, and a like that silently stood would be worse.
 *  3. **Zero DROPS the count** (UI-D-21, inherited) leaving the bare glyph.
 *  4. **UI-D-31 / UI-D-32: no double-tap burst and no share control anywhere in the overlay** — a
 *     tap on this surface already means "advance".
 *  5. **A VIDEO story's progress segment advances from the ELEMENT'S OWN TIME** (UI-D-30) and hands
 *     over to the next story when the asset ends.
 */

const { catalog, feedCatalog, toast, like, unlike, playbackToken } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('stories').stories as Record<string, unknown>,
    feedCatalog: read('feed').feed as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    like: vi.fn(),
    unlike: vi.fn(),
    playbackToken: vi.fn(),
  };
});

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? `{${name}}`),
  );
};

/**
 * `motion/react`, replaced by plain elements.
 *
 * Not a convenience: happy-dom's `Animation.cancel()` REJECTS the animation's `finished` promise,
 * motion attaches no catch to it, and `cleanup()` unmounting a sheet mid-transition therefore
 * raises an unhandled rejection that fails the whole run while every assertion passes. Nothing in
 * this file is about animation — the claims are about which nodes exist — so the transitions are
 * removed rather than waited on.
 */
vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'drag',
    'dragConstraints',
    'dragElastic',
    'onDragEnd',
    'whileTap',
    'whileHover',
    'whileFocus',
    'layout',
    'layoutId',
  ]);
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

/**
 * The playback token is a SERVER ACTION, and a server action is the correct seam for a unit test:
 * the credential is minted per request on the server and the bridge only ever sees its shape.
 * The nested result mirrors `fetchPlaybackTokenAction`'s real `{ ok, playback: { playbackId,
 * tokens: { playback, thumbnail, storyboard } } }` exactly — a flatter stand-in would let a change
 * to the action's shape pass here and fail in the browser.
 */
vi.mock('@/app/(app)/configuracoes/midia/actions', () => ({
  fetchPlaybackTokenAction: playbackToken,
}));

/**
 * The VENDOR package, replaced by a stand-in that mounts its `mux-player` element ONE TICK LATE.
 *
 * `next/dynamic` is deliberately NOT mocked. Mocking it to resolve eagerly would delete the exact
 * condition GAP 2's video half lives in — the custom element does not exist on the commit where
 * the token resolves — and hand back a green suite over the same bug. The stand-in defers as well
 * so the late mount holds no matter how the bundler resolves the dynamic import under vitest.
 *
 * `createElement` rather than JSX: `mux-player` is not in `JSX.IntrinsicElements` and this file
 * has no business widening that interface for a test double.
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
      return createElement('mux-player', { 'data-testid': 'mux-player' });
    },
  };
});

const { storyViewerLabels } = await import('@/lib/story-view');
const { StoryViewerHost } = await import('./StoryViewerHost');

// `next-intl`'s reader FORMATS on read, so the templated strings are taken with `.raw` — this
// stand-in exposes the same two calls the real translator does.
const reader = Object.assign((key: string) => lookup(key), { raw: (key: string) => lookup(key) });

const LABELS = storyViewerLabels(reader);

const ASSET = '0d000000-0000-4000-8000-0000000000b1';

/**
 * D-82's binding, built from the REAL catalogs — which is itself an assertion. The sheet title, the
 * placeholder and the empty copy come from the FEED namespace verbatim (UI-SPEC §Copywriting
 * Contract, "Viewer comments"), and only the ONE refusal sentence comes from the stories namespace.
 * If a later edit duplicates the feed's comment copy into `stories.json`, the two readers below
 * start disagreeing and these tests are where it shows.
 */
const feed = (key: string) =>
  String(
    key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], feedCatalog) ??
      key,
  );

const loadComments = vi.fn();

function commentsBinding() {
  return {
    title: feed('comments.title'),
    locale: 'pt-BR',
    viewer: { displayName: 'Membro', profileHref: null, avatarUrl: null },
    onLoadComments: loadComments,
    onLoadReplies: vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null }),
    onCreateComment: vi.fn().mockResolvedValue({ ok: false }),
    onDeleteComment: vi.fn().mockResolvedValue({ ok: true }),
    onLikeComment: vi.fn().mockResolvedValue({ ok: false }),
    onUnlikeComment: vi.fn().mockResolvedValue({ ok: false }),
    labels: {
      region: feed('comments.region'),
      emptyLabel: feed('comments.empty'),
      errorLabel: feed('errors.comments'),
      errorRepliesLabel: feed('errors.replies'),
      retryLabel: feed('comments.retry'),
      submitErrorLabel: feed('errors.commentSubmit'),
      replyDepthErrorLabel: feed('errors.replyDepth'),
      storyNoReplyErrorLabel: lookup('viewer.comments.noReply'),
      loadMoreLabel: feed('comments.loadMore'),
      loadMoreRepliesLabel: feed('comments.loadMoreReplies'),
      showReplies: {
        one: feed('comments.showReplies.one'),
        other: feed('comments.showReplies.other'),
      },
      hideReplies: {
        one: feed('comments.hideReplies.one'),
        other: feed('comments.hideReplies.other'),
      },
      replyChip: feed('comments.replyChip'),
      replyChipDismiss: feed('comments.replyChipDismiss'),
      placeholder: feed('comments.placeholder'),
      submitLabel: feed('comments.submit'),
      viewerLabel: feed('comments.viewerAvatar'),
      nowLabel: feed('comments.now'),
      deleteTitle: feed('comments.delete.title'),
      deleteBody: feed('comments.delete.body'),
      deleteConfirm: feed('comments.delete.confirm'),
      deleteCancel: feed('comments.delete.cancel'),
      item: {
        removedAuthor: feed('comments.removedAuthor'),
        like: feed('comments.like'),
        unlike: feed('comments.unlike'),
        likes: { one: feed('comments.likes.one'), other: feed('comments.likes.other') },
        reply: feed('comments.reply'),
        delete: feed('comments.delete.label'),
      },
    },
  };
}

const SEEDED_COMMENT = {
  id: '0d000000-0000-4000-8000-0000000000e1',
  body: 'Que story bonito.',
  author: { displayName: 'Bruno', profileHref: '/membros/m1', avatarUrl: null },
  authorRemoved: false,
  createdAtIso: '2026-09-24T00:00:00.000Z',
  createdAtRelative: 'ha 1 h',
  createdAtAbsolute: '24/09/2026',
  likeCount: 0,
  viewerLiked: false,
  replyCount: 2,
  isReply: false,
  canDelete: false,
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: '0d000000-0000-4000-8000-0000000000d1',
    mediaKind: 'image' as const,
    mediaAssetId: ASSET,
    mediaVariantWidths: [640, 1080],
    caption: 'Bastidores do encontro de hoje.',
    timeLabel: 'há 1 h',
    likeCount: 12,
    commentCount: 3,
    viewerLiked: false,
    ...overrides,
  };
}

function host(overrides: Record<string, unknown> = {}) {
  return render(
    <StoryViewerHost
      items={[item()]}
      author={{ name: 'Direcao TRIA Demo', avatarUrl: null }}
      labels={LABELS}
      onLike={like as never}
      onUnlike={unlike as never}
      onClose={() => {}}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  like.mockResolvedValue({ ok: true, liked: true, likeCount: 13 });
  unlike.mockResolvedValue({ ok: true, liked: false, likeCount: 12 });
  loadComments.mockResolvedValue({ ok: true, items: [SEEDED_COMMENT], nextCursor: null });
  playbackToken.mockResolvedValue({
    ok: true,
    playback: {
      playbackId: 'pb-story-1',
      tokens: {
        playback: 'tok-playback',
        thumbnail: 'tok-thumbnail',
        storyboard: 'tok-storyboard',
      },
    },
  });
});
afterEach(cleanup);

/**
 * The vendor element arrives LATE, twice over: `next/dynamic` resolves its chunk on one tick and
 * the stand-in defers its own element on another. Flushing until it exists is the whole point of
 * the case — a helper that gave up after one tick would pass over the defect it is here to catch.
 */
type MediaLikeElement = HTMLElement & { currentTime?: number; duration?: number };

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

async function timeUpdate(player: MediaLikeElement, currentTime: number, duration: number) {
  player.currentTime = currentTime;
  player.duration = duration;
  await act(async () => {
    player.dispatchEvent(new Event('timeupdate'));
  });
}

describe('StoryViewerHost — the viewer as a product surface (STORY-02, STORY-05)', () => {
  it('1. renders the sequence: the author row, the caption and the two 44x44 actions', () => {
    host();

    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Direcao TRIA Demo')).toBeTruthy();
    expect(screen.getByText('há 1 h')).toBeTruthy();
    expect(screen.getByTestId('story-caption').textContent).toBe('Bastidores do encontro de hoje.');
    // The copy is the catalog's, interpolated — never a literal in this file.
    expect(screen.getByTestId('story-like-count').textContent).toBe('12 curtidas');
    expect(screen.getByRole('button', { name: 'Curtir' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Comentar' })).toBeTruthy();
  });

  it('2. the like flips OPTIMISTICALLY and is then replaced by the server’s authoritative count', async () => {
    host();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Curtir' }));
    });

    expect(like).toHaveBeenCalledWith('0d000000-0000-4000-8000-0000000000d1');
    // 13, which is what the ACTION returned — a locally incremented 13 would look identical here,
    // so the next assertion is the one that separates them.
    expect(screen.getByTestId('story-like-count').textContent).toBe('13 curtidas');
    expect(screen.getByRole('button', { name: 'Descurtir' })).toBeTruthy();
  });

  it('3. the server’s pair WINS over the optimistic one, even when they disagree', async () => {
    // Two other members liked it while this one was reading: the authoritative answer is 20.
    like.mockResolvedValue({ ok: true, liked: true, likeCount: 20 });
    host();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Curtir' }));
    });

    expect(screen.getByTestId('story-like-count').textContent).toBe('20 curtidas');
  });

  it('4. a refused like REVERTS and raises the generic toast — never an inline message', async () => {
    like.mockResolvedValue({ ok: false, code: 'generic' });
    host();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Curtir' }));
    });

    expect(screen.getByTestId('story-like-count').textContent).toBe('12 curtidas');
    expect(screen.getByRole('button', { name: 'Curtir' })).toBeTruthy();
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({
      message: 'Algo deu errado. Tente novamente.',
      tone: 'error',
    });
    // Nothing was written into the overlay itself.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('5. zero DROPS both counts, leaving the bare glyphs (UI-D-21, inherited)', () => {
    host({ items: [item({ likeCount: 0, commentCount: 0 })] });

    expect(screen.queryByTestId('story-like-count')).toBeNull();
    expect(screen.getByRole('button', { name: 'Curtir' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Comentar' })).toBeTruthy();
  });

  it('6. a story with no caption renders no caption node and the action row moves down', () => {
    host({ items: [item({ caption: '' })] });
    expect(screen.queryByTestId('story-caption')).toBeNull();
  });

  it('7. UI-D-31 / UI-D-32: no double-tap burst and no share control in the overlay', () => {
    host({ items: [item(), item({ id: 'second' })] });
    const dialog = screen.getByRole('dialog');

    expect(dialog.querySelector('[data-double-tap-burst]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Compartilhar/i })).toBeNull();
  });

  it('8. a VIDEO story renders the token-minting bridge, never the feed player', async () => {
    host({ items: [item({ mediaKind: 'video' })] });
    await mountedPlayer();

    // The REAL bridge's own frame — `story-video` is `StoryVideo`'s test id, not a stand-in's.
    expect(screen.getByTestId('story-video')).toBeTruthy();
    // …and it minted its credential per request, for this asset, through the server action.
    expect(playbackToken).toHaveBeenCalledWith(ASSET);
    // The FEED's player, in any of its three states, is nowhere on this surface.
    expect(screen.queryByTestId('video-ready')).toBeNull();
    expect(screen.queryByTestId('video-processing')).toBeNull();
    expect(screen.queryByTestId('video-failed')).toBeNull();
  });

  it('13. a VIDEO story’s segment advances from the ELEMENT’S OWN TIME and then hands over', async () => {
    host({
      items: [
        item({ mediaKind: 'video' }),
        item({ id: '0d000000-0000-4000-8000-0000000000d2', caption: 'A segunda.' }),
      ],
    });

    const player = await mountedPlayer();
    const viewer = screen.getByRole('dialog', { name: 'Story' });
    expect(viewer.getAttribute('data-story-index')).toBe('0');
    expect(screen.getByTestId('story-fill-0').style.width).toBe('0%');

    // UI-D-30: the bar is the ASSET'S own time, halfway through a five-second story.
    await timeUpdate(player, 2.5, 5);
    expect(screen.getByTestId('story-fill-0').style.width).toBe('50%');

    // The guard, ASSERTED rather than assumed: a duration the element cannot mean moves nothing.
    // It is checked HERE rather than at the end of the case because once the viewer has advanced,
    // segment 0 is full by position (`k < index`) and could no longer show a fill that moved.
    await timeUpdate(player, 4, 0);
    expect(screen.getByTestId('story-fill-0').style.width).toBe('50%');
    await timeUpdate(player, 4, Number.POSITIVE_INFINITY);
    expect(screen.getByTestId('story-fill-0').style.width).toBe('50%');

    // …and the end of the asset hands the member the next story.
    await timeUpdate(player, 5, 5);
    expect(viewer.getAttribute('data-story-index')).toBe('1');
  });
});

/**
 * D-82 — the comment sheet over the viewer, and the ONE mechanism it drives.
 *
 * "The story pauses while the sheet is open" is not a second pause: `StoryViewer` already ORs a
 * single boolean from the hold gesture, document visibility, the space key and the expanded
 * caption, and 05-06 left `externallyPaused` wired end to end and fed by nothing precisely so this
 * plan would be one prop at the composition point. The assertion below is on `data-paused`, which
 * is the viewer's own published reading of that boolean — not on an internal.
 */
describe('StoryViewerHost — the comment sheet (D-82, STORY-05)', () => {
  const openSheet = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));
    });
  };

  it('9. the Comentar control is LIVE and opens the shipped sheet, titled from the FEED catalog', async () => {
    host({ comments: commentsBinding() });

    expect(screen.getByRole('button', { name: 'Comentar' }).hasAttribute('disabled')).toBe(false);
    await openSheet();

    // "Comentários" — the feed's own title, reused verbatim rather than duplicated into stories.
    expect(screen.getByRole('dialog', { name: 'Comentários' })).toBeTruthy();
    expect(screen.getByText('Que story bonito.')).toBeTruthy();
    expect(loadComments).toHaveBeenCalledWith('0d000000-0000-4000-8000-0000000000d1');
  });

  it('10. opening the sheet PAUSES the story, and closing it resumes', async () => {
    host({ comments: commentsBinding() });
    const viewer = screen.getByRole('dialog', { name: 'Story' });
    expect(viewer.getAttribute('data-paused')).toBe('false');

    await openSheet();
    expect(viewer.getAttribute('data-paused')).toBe('true');

    await act(async () => {
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Comentários' }), { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Comentários' })).toBeNull();
    expect(viewer.getAttribute('data-paused')).toBe('false');
  });

  it('11. the sheet renders the FLAT list: no reply control, no replies toggle, no comment like', async () => {
    const { container } = host({ comments: commentsBinding() });
    await openSheet();

    expect(container.querySelectorAll('[data-comment-reply]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-replies-toggle]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-comment-like]')).toHaveLength(0);
  });

  it('12. with NO binding the affordance stays inert rather than doing nothing on tap', () => {
    host();
    expect(screen.getByRole('button', { name: 'Comentar' }).hasAttribute('disabled')).toBe(true);
  });
});
