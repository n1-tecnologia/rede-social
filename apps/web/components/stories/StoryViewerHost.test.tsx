// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const {
  catalog,
  feedCatalog,
  modCatalog,
  toast,
  like,
  unlike,
  playbackToken,
  loadHighlight,
  loadSheet,
  addToHighlight,
  removeFromHighlight,
} = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('stories').stories as Record<string, unknown>,
    feedCatalog: read('feed').feed as Record<string, unknown>,
    modCatalog: read('moderation').moderation as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    like: vi.fn(),
    unlike: vi.fn(),
    playbackToken: vi.fn(),
    loadHighlight: vi.fn(),
    loadSheet: vi.fn(),
    addToHighlight: vi.fn(),
    removeFromHighlight: vi.fn(),
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

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
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
    default: function MuxPlayerStandIn(props: { playbackId?: string }) {
      const [mounted, setMounted] = useState(false);
      useEffect(() => {
        setMounted(true);
      }, []);
      if (!mounted) return null;
      // `data-playback-id` is ADDITIVE and exists for case 14 only: with three elements mounted at
      // once, it is what traces an element back to the story that asked for its token. No other
      // case asserts a `playbackId` value.
      return createElement('mux-player', {
        'data-testid': 'mux-player',
        'data-playback-id': props.playbackId,
      });
    },
  };
});

/**
 * 05.2-05: the lazy highlight read is a SERVER ACTION — the seam a unit test stubs, for the reason
 * the playback token is: the request and its authorisation happen on the server.
 */
vi.mock('@/app/(app)/stories/highlight-actions', () => ({
  loadHighlightItemsAction: loadHighlight,
  loadHighlightSheetAction: loadSheet,
  addStoryToHighlightAction: addToHighlight,
  removeStoryFromHighlightAction: removeFromHighlight,
}));

/**
 * 05.2-10: `StoriesSurface` flushes the seen buffer through a SERVER ACTION too — stubbed at the same
 * seam (its own cases live in `StoriesSurface.test.tsx`).
 */
vi.mock('@/app/(app)/stories/story-actions', () => ({
  markStoriesSeenAction: vi.fn(async () => true),
}));

/**
 * 05.2-06: the host reads the highlight sheet's words with `useTranslations('stories')` on the
 * client (the composer's precedent). The stand-in answers from the SAME real catalog `lookup` reads,
 * and returns ONE stable reader, as next-intl's memoised hook does.
 */
const translate = (key: string, values?: Record<string, unknown>) => lookup(key, values);
vi.mock('next-intl', () => ({ useTranslations: () => translate }));

const { highlightGroupView, inicioGroups, inicioRow, storyViewerLabels } = await import(
  '@/lib/story-view'
);
const { StoryViewerHost } = await import('./StoryViewerHost');
const { StoriesSurface } = await import('./StoriesSurface');

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
    seen: false,
    authorAvatarUrl: null as string | null,
    ...overrides,
  };
}

/**
 * One TENANT group holding `items` — the shape every single-sequence caller hands the host. An
 * `items` override is folded into that one group so each case below reads as it always has.
 */
function host(overrides: Record<string, unknown> = {}) {
  const { items = [item()], ...rest } = overrides as { items?: ReturnType<typeof item>[] };
  return render(
    <StoryViewerHost
      groups={[
        {
          key: 'tenant',
          kind: 'tenant',
          highlightId: null,
          name: 'Direcao Rede Demo',
          avatar: { kind: 'avatar', src: null },
          items,
        },
      ]}
      labels={LABELS}
      onLike={like as never}
      onUnlike={unlike as never}
      onClose={() => {}}
      {...rest}
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

/**
 * `mountedPlayer`'s sibling: the same 20-tick flush, waiting for a COUNT of elements instead of the
 * first one. Case 14 mounts three at once and releases them one at a time, so "how many have
 * arrived" is the thing it has to be able to wait on.
 */
async function mountedPlayers(count: number): Promise<MediaLikeElement[]> {
  for (let tick = 0; tick < 20; tick += 1) {
    const found = document.querySelectorAll('mux-player');
    if (found.length >= count) return [...found] as MediaLikeElement[];
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error(
    `only ${document.querySelectorAll('mux-player').length} of ${count} vendor elements mounted`,
  );
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
    expect(screen.getByText('Direcao Rede Demo')).toBeTruthy();
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

  it('14. the play badge reaches the CURRENT story’s element and NEITHER neighbour’s (CR-02)', async () => {
    // `StoryViewer` mounts a 3-WIDE neighbour window (`Math.abs(k - index) <= 1`), so with the
    // middle story active all three `StoryVideo`s are mounted and all three register a play
    // callback. The host held ONE `playRef` for all of them, so the badge reached whichever element
    // attached LAST — typically an offscreen neighbour.
    //
    // WHICH ASSERTION CARRIES THE RED: **"story 2's spy is at zero"** — the neighbour this harness
    // FORCES to attach last. It is NOT "story 1 was played": the badge's own handler clears
    // `blocked[currentId]`, which drops `autoplayBlocked` out of the viewer's `paused`, which
    // re-runs `StoryVideo`'s pause/mute effect and plays the ACTIVE element on broken and fixed
    // code alike. A reader who mistakes that half for the evidence will mis-read the next failure
    // this case produces.
    const ASSET_0 = '0d000000-0000-4000-8000-0000000000c0';
    const ASSET_1 = '0d000000-0000-4000-8000-0000000000c1';
    const ASSET_2 = '0d000000-0000-4000-8000-0000000000c2';

    // THE ATTACH ORDER IS CHOSEN, NOT SAMPLED. Today's single slot is written by every mounted
    // bridge, the active one included, so if story 1 happened to attach last both neighbours would
    // sit at zero and this case would go green over the live bug. So the token promises are GATED
    // and released deliberately — and a neighbour is released last.
    const gates = new Map<string, (value: unknown) => void>();
    playbackToken.mockImplementation(
      (assetId: string) =>
        new Promise((resolve) => {
          gates.set(assetId, resolve);
        }),
    );
    const release = async (assetId: string) => {
      const open = gates.get(assetId);
      if (!open) throw new Error(`no gate for ${assetId}`);
      await act(async () => {
        // The playbackId echoes the asset id back, so an element can be traced to its story.
        open({
          ok: true,
          playback: {
            playbackId: assetId,
            tokens: { playback: 'tok-p', thumbnail: 'tok-t', storyboard: 'tok-s' },
          },
        });
        await Promise.resolve();
      });
    };

    host({
      initialIndex: 1,
      items: [
        item({ id: 'story-0', mediaKind: 'video', mediaAssetId: ASSET_0 }),
        item({ id: 'story-1', mediaKind: 'video', mediaAssetId: ASSET_1 }),
        item({ id: 'story-2', mediaKind: 'video', mediaAssetId: ASSET_2 }),
      ],
    });

    // All three bridges asked for a token before any of them is allowed to answer.
    for (let tick = 0; tick < 20 && gates.size < 3; tick += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(gates.size).toBe(3);

    // Released ONE AT A TIME: story 1 (active) first, then story 0, then story 2. The count and
    // `data-playback-id` assertions after each release hold both BEFORE and after the fix — they
    // describe the HARNESS, not the bug — and their whole job is to make a harness that stopped
    // forcing the order fail loudly instead of going quietly green.
    await release(ASSET_1);
    const afterFirst = await mountedPlayers(1);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]?.getAttribute('data-playback-id')).toBe(ASSET_1);

    await release(ASSET_0);
    const afterSecond = await mountedPlayers(2);
    expect(afterSecond).toHaveLength(2);
    const arrivedSecond = afterSecond.filter((el) => el !== afterFirst[0]);
    expect(arrivedSecond).toHaveLength(1);
    expect(arrivedSecond[0]?.getAttribute('data-playback-id')).toBe(ASSET_0);

    await release(ASSET_2);
    const all = await mountedPlayers(3);
    expect(all).toHaveLength(3);
    const arrivedThird = all.filter((el) => !afterSecond.includes(el));
    expect(arrivedThird).toHaveLength(1);
    expect(arrivedThird[0]?.getAttribute('data-playback-id')).toBe(ASSET_2);

    // Story 2 — a NEIGHBOUR — is now necessarily the last writer of the single unkeyed slot.
    const byStory = (assetId: string) => {
      const found = all.find((el) => el.getAttribute('data-playback-id') === assetId);
      if (!found) throw new Error(`no element for ${assetId}`);
      return found;
    };
    const element0 = byStory(ASSET_0);
    const element1 = byStory(ASSET_1);
    const element2 = byStory(ASSET_2);

    // The bound play closure reads `element.play` at CALL time, so assigning after attach is fine.
    const play0 = vi.fn();
    const play1 = vi.fn();
    const play2 = vi.fn();
    (element0 as unknown as { play: unknown }).play = play0;
    (element1 as unknown as { play: unknown }).play = play1;
    (element2 as unknown as { play: unknown }).play = play2;

    // Arm the badge on the ACTIVE story (UI-D-34: `canplay` arms a 400 ms check). Real timers —
    // no test in this file uses fake ones.
    await act(async () => {
      element1.dispatchEvent(new Event('canplay'));
    });
    const badge = await screen.findByTestId('story-autoplay-badge');

    // A DETERMINISTIC zero baseline, not a hopeful one: a neighbour's controls carry
    // `paused: paused || k !== index` so its effect only ever calls `pause()`, and the viewer's own
    // `paused` ORs in `autoplayBlocked`, so the armed active story is paused too. Clearing also
    // discards the one play the active element received on mount, before the badge armed.
    play0.mockClear();
    play1.mockClear();
    play2.mockClear();
    expect(play0).toHaveBeenCalledTimes(0);
    expect(play1).toHaveBeenCalledTimes(0);
    expect(play2).toHaveBeenCalledTimes(0);

    await act(async () => {
      fireEvent.click(badge);
    });

    expect(play0, 'the PREVIOUS neighbour must not be played').toHaveBeenCalledTimes(0);
    // ── THE RED ──────────────────────────────────────────────────────────────────────────────
    expect(
      play2,
      'the NEXT neighbour — forced to attach last — must not be played',
    ).toHaveBeenCalledTimes(0);
    expect(play1.mock.calls.length, 'the CURRENT story is the one that plays').toBeGreaterThan(0);

    // ── The owner-only-clear guard ───────────────────────────────────────────────────────────
    // REGRESSION GUARD, and it PASSES TODAY. It cannot be promoted into a second RED: pre-fix the
    // departing neighbour's `detach()` does null the shared slot, but the same tap unblocks the
    // viewer and the pause/mute effect plays the active element anyway — so the guard is blind to
    // the clearing bug by construction. No claim to the contrary is recorded here.
    await timeUpdate(element1, 5, 5);
    const viewer = screen.getByRole('dialog', { name: 'Story' });
    expect(viewer.getAttribute('data-story-index')).toBe('2');

    await act(async () => {
      element2.dispatchEvent(new Event('canplay'));
    });
    const badge2 = await screen.findByTestId('story-autoplay-badge');

    play1.mockClear();
    play2.mockClear();
    await act(async () => {
      fireEvent.click(badge2);
    });

    expect(
      play2.mock.calls.length,
      'the new current story reaches its own element',
    ).toBeGreaterThan(0);
    expect(play1, 'the story that left the window is not played').toHaveBeenCalledTimes(0);
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

/**
 * 08-03 (D-336, UI-D-276): story comments are moderated through the SAME shared list the feed uses.
 * The control's meaning comes from the row's server-derived `removal`; the host only supplies the
 * `moderation` copy (registry `storyCommentsProps(…, tm)`). The catalog is the REAL `moderation.json`.
 */
describe('StoryViewerHost — moderating a story comment (08-03, D-336)', () => {
  const moderation = (key: string) =>
    String(
      key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], modCatalog) ??
        key,
    );

  function moderatedBinding(removal: 'own' | 'moderation' | null) {
    const binding = commentsBinding();
    loadComments.mockResolvedValue({
      ok: true,
      items: [{ ...SEEDED_COMMENT, replyCount: 0, canDelete: removal !== null, removal }],
      nextCursor: null,
    });
    return {
      ...binding,
      labels: {
        ...binding.labels,
        moderation: {
          title: moderation('comment.title'),
          body: moderation('comment.body'),
          bodyWithReplies: moderation('comment.bodyWithReplies'),
          confirm: moderation('comment.confirm'),
          cancel: moderation('comment.cancel'),
          removedToast: moderation('comment.toasts.removed'),
        },
        item: { ...binding.labels.item, remove: moderation('comment.label') },
      },
    };
  }

  const openSheet = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));
    });
  };

  it("27. 'moderation' draws the trash control named for the author, and opens the moderation dialog", async () => {
    host({ comments: moderatedBinding('moderation') });
    await openSheet();

    const control = screen.getByRole('button', { name: 'Remover comentário de Bruno' });
    await act(async () => {
      fireEvent.click(control);
    });
    expect(screen.getByRole('dialog', { name: 'Remover comentário?' })).toBeTruthy();
    expect(
      screen.getByText(
        'O comentário de Bruno sai da conversa para todos os membros. Bruno não é avisado, e a remoção fica no histórico de moderação.',
      ),
    ).toBeTruthy();
  });

  it("28. 'own' keeps the shipped own label; null draws no control at all", async () => {
    host({ comments: moderatedBinding('own') });
    await openSheet();
    expect(screen.getByRole('button', { name: feed('comments.delete.label') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remover comentário de/ })).toBeNull();
    cleanup();

    const { container } = host({ comments: moderatedBinding(null) });
    await openSheet();
    expect(screen.getByText('Que story bonito.')).toBeTruthy();
    expect(container.ownerDocument.querySelectorAll('[data-comment-removal]')).toHaveLength(0);
  });
});

/* ── 05.2-05: the row of groups (D-107, UI-D-65, HIGHLIGHT-02/03) ────────────────────────────── */

const H1 = '0000000a-1111-4111-8111-000000000001';
const H2 = '0000000a-1111-4111-8111-000000000002';

function summary(id: string, title: string) {
  return {
    id,
    communityId: null,
    title,
    position: 0,
    coverAssetId: null,
    coverVariantWidths: [],
    coverStoryId: null,
    coverChosen: false,
    itemCount: 1,
  };
}

/** A deferred promise, so a case decides WHEN the lazy read answers. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('StoryViewerHost — a highlight group (05.2-05, UI-D-65)', () => {
  it('15. a highlight group’s TITLE heads the viewer while it loads and after its items arrive', () => {
    const onNeedGroup = vi.fn();
    const bastidores = highlightGroupView(summary(H1, 'Bastidores'));
    const loading = [bastidores];
    const props = {
      labels: LABELS,
      onLike: like as never,
      onUnlike: unlike as never,
      onClose: () => {},
      onNeedGroup,
    };
    const { rerender } = render(<StoryViewerHost groups={loading} {...props} />);

    // The loading frame (UI-D-65): the spinner, the group's header, the clock paused.
    expect(screen.getByTestId('story-group-loading')).toBeTruthy();
    expect(screen.getByText('Bastidores')).toBeTruthy();
    expect(screen.getByTestId('story-position').textContent).toBe('Carregando destaque…');
    expect(onNeedGroup).toHaveBeenCalledWith(0);

    rerender(<StoryViewerHost groups={[{ ...bastidores, items: [item()] }]} {...props} />);

    expect(screen.queryByTestId('story-group-loading')).toBeNull();
    // Every story in the group is headed by the group's title, not the tenant's name.
    expect(screen.getByText('Bastidores')).toBeTruthy();
    expect(screen.getByTestId('story-caption').textContent).toBe('Bastidores do encontro de hoje.');
    expect(screen.getByTestId('story-position').textContent).toBe('Bastidores: story 1 de 1');
  });

  it('16. a FAILED group shows the highlight error and its retry, which asks again', () => {
    const onRetryGroup = vi.fn();
    render(
      <StoryViewerHost
        groups={[{ ...highlightGroupView(summary(H1, 'Bastidores')), failed: true }]}
        labels={LABELS}
        onLike={like as never}
        onUnlike={unlike as never}
        onClose={() => {}}
        onRetryGroup={onRetryGroup}
      />,
    );

    const error = screen.getByTestId('story-group-error');
    expect(error.textContent).toContain('Não foi possível carregar este destaque.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetryGroup).toHaveBeenCalledWith(0);
  });
});

/**
 * The Início row, end to end at the unit level: the SAME builders `lib/registry.tsx` composes the
 * slot with (`inicioRow` for the circles, `inicioGroups` for the viewer), handed to the real
 * `StoriesSurface` — so "circle k opens group k" is asserted through the props the server really
 * passes, not through a restatement of them.
 */
describe('StoriesSurface — every Início circle opens its own group (05.2-05, D-107)', () => {
  const tenant = { displayName: 'Demo', logoUrl: null };

  function surface({ live }: { live: boolean }) {
    const sequence = live ? [item()] : [];
    const highlights = [summary(H1, 'Primeiro'), summary(H2, 'Segundo')];
    return render(
      <StoriesSurface
        regionLabel="Stories"
        circles={inicioRow(
          {
            canPublish: false,
            tenant,
            sequenceLength: sequence.length,
            highlights,
          },
          lookup,
        )}
        viewer={{
          groups: inicioGroups({
            tenant,
            sequence,
            highlightGroups: highlights.map(highlightGroupView),
          }),
          labels: LABELS,
          onLike: like as never,
          onUnlike: unlike as never,
        }}
      />,
    );
  }

  const openCircle = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
    return screen.getByRole('dialog', { name: 'Story' });
  };

  it('17. the tenant circle opens (0, 0) on its own story, and PREFETCHES the first highlight', async () => {
    loadHighlight.mockReturnValue(new Promise(() => {}));
    surface({ live: true });

    // 05.2-10 (UI-D-61): its one story is unseen, so the circle's name carries "Há stories novos.".
    const dialog = await openCircle('Abrir stories de Demo. Há stories novos.');
    expect(dialog.getAttribute('data-story-group')).toBe('0');
    expect(dialog.getAttribute('data-story-index')).toBe('0');
    // The tenant group's history entry names the story it opened on (planning decision 3).
    expect(window.location.pathname).toBe('/stories/0d000000-0000-4000-8000-0000000000d1');
    // Its only story is its last: the next group's items are already being fetched.
    expect(loadHighlight).toHaveBeenCalledTimes(1);
    expect(loadHighlight).toHaveBeenCalledWith(H1);
  });

  it('18. highlight circle k opens (k, 0): loading, ONE read, then its own stories — the URL untouched', async () => {
    const answer = deferred<unknown>();
    loadHighlight.mockReturnValue(answer.promise);
    surface({ live: true });
    const before = window.location.pathname;

    const dialog = await openCircle('Abrir destaque Segundo');
    expect(dialog.getAttribute('data-story-group')).toBe('2');
    expect(screen.getByTestId('story-group-loading')).toBeTruthy();
    // The header names the group (the strip's own circle label also reads "Segundo").
    expect(within(dialog).getByText('Segundo')).toBeTruthy();

    await act(async () => {
      answer.resolve({
        ok: true,
        items: [item({ id: '0d000000-0000-4000-8000-0000000000d9', caption: 'Do destaque.' })],
      });
    });

    expect(screen.queryByTestId('story-group-loading')).toBeNull();
    expect(screen.getByTestId('story-caption').textContent).toBe('Do destaque.');
    // In-flight dedupe: entering the group and re-rendering asked the server exactly once.
    expect(loadHighlight.mock.calls.filter(([id]) => id === H2)).toHaveLength(1);
    // A highlight group pushes the CURRENT url, so a refresh never lands on a route that cannot
    // rebuild the row (planning decision 3).
    expect(window.location.pathname).toBe(before);
  });

  it('19. with nothing live the groups are the highlights alone: the first highlight opens (0, 0)', async () => {
    loadHighlight.mockReturnValue(new Promise(() => {}));
    surface({ live: false });

    expect(screen.queryByRole('button', { name: 'Abrir stories de Demo' })).toBeNull();
    const dialog = await openCircle('Abrir destaque Primeiro');
    expect(dialog.getAttribute('data-story-group')).toBe('0');
    expect(loadHighlight).toHaveBeenCalledWith(H1);
  });

  it('20. a failed read shows the error; the retry reads again and the group plays', async () => {
    loadHighlight.mockResolvedValueOnce({ ok: false });
    surface({ live: false });

    await openCircle('Abrir destaque Segundo');
    expect(screen.getByTestId('story-group-error').textContent).toContain(
      'Não foi possível carregar este destaque.',
    );

    loadHighlight.mockResolvedValueOnce({
      ok: true,
      items: [item({ caption: 'Depois do erro.' })],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    });

    expect(loadHighlight.mock.calls.filter(([id]) => id === H2)).toHaveLength(2);
    expect(screen.queryByTestId('story-group-error')).toBeNull();
    expect(screen.getByTestId('story-caption').textContent).toBe('Depois do erro.');
  });
});

/* ── 05.2-06: "Destacar" in the viewer (UI-D-66, UI-D-67, D-110 route 1, D-82) ─────────────────── */

const COMMUNITY = '0c000000-0000-4000-8000-00000000000a';
const H3 = '0000000a-1111-4111-8111-000000000003';

/** The sheet's opening read: Início with two highlights (one holding the story), one community. */
function sheetResult() {
  return {
    ok: true as const,
    selectedIds: [H1],
    places: [
      {
        key: 'home',
        label: 'Início',
        communityId: null,
        rows: [
          { id: H1, title: 'Bastidores', cover: null },
          { id: H2, title: 'Aulas', cover: null },
        ],
      },
      {
        key: COMMUNITY,
        label: 'Coral Rede Social',
        communityId: COMMUNITY,
        rows: [{ id: H3, title: 'Ensaios', cover: null }],
      },
    ],
  };
}

describe('StoryViewerHost — "Destacar" (05.2-06, UI-D-66, D-110 route 1)', () => {
  const STORY_ID = '0d000000-0000-4000-8000-0000000000d1';

  const openHighlightSheet = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Destacar' }));
    });
  };

  it('21. members get NO "Destacar"; a curator gets ONE, after the like and comment controls', () => {
    host({ canCurate: false });
    expect(screen.queryByRole('button', { name: 'Destacar' })).toBeNull();
    cleanup();

    host({ canCurate: true });
    const pill = screen.getByRole('button', { name: 'Destacar' });
    expect(screen.getAllByRole('button', { name: 'Destacar' })).toHaveLength(1);
    // It sits at the END of the action row: after the like and after the comment control.
    const row = [...(pill.parentElement?.querySelectorAll('button') ?? [])];
    const at = (node: Element) => row.indexOf(node as HTMLButtonElement);
    expect(at(pill)).toBeGreaterThan(at(screen.getByRole('button', { name: 'Curtir' })));
    expect(at(pill)).toBeGreaterThan(at(screen.getByRole('button', { name: 'Comentar' })));
    expect(pill.className).toContain('ml-auto');
  });

  it('22. the pill reads the CURRENT story’s sheet, opens the checklist, and the clock is paused while it is open', async () => {
    loadSheet.mockResolvedValue(sheetResult());
    host({ canCurate: true });
    const viewer = screen.getByRole('dialog', { name: 'Story' });
    expect(viewer.getAttribute('data-paused')).toBe('false');

    await openHighlightSheet();

    expect(loadSheet).toHaveBeenCalledWith(STORY_ID);
    const sheet = screen.getByRole('dialog', { name: 'Destacar story' });
    expect(within(sheet).getByText('Início')).toBeTruthy();
    expect(within(sheet).getByText('Coral Rede Social')).toBeTruthy();
    expect(
      within(sheet)
        .getByRole('switch', { name: 'Destacar em Bastidores, Início' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(sheet)
        .getByRole('switch', { name: 'Destacar em Ensaios, Coral Rede Social' })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(viewer.getAttribute('data-paused')).toBe('true');

    await act(async () => {
      fireEvent.keyDown(sheet, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Destacar story' })).toBeNull();
    expect(viewer.getAttribute('data-paused')).toBe('false');
  });

  it('23. a failed read opens NOTHING and raises the generic error toast', async () => {
    loadSheet.mockResolvedValue({ ok: false });
    host({ canCurate: true });

    await openHighlightSheet();

    expect(screen.queryByRole('dialog', { name: 'Destacar story' })).toBeNull();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: lookup('viewer.errors.generic'),
    });
    expect(screen.getByRole('dialog', { name: 'Story' }).getAttribute('data-paused')).toBe('false');
  });

  it('24. toggles write with revalidate:false; archived and full revert with their own toasts, success confirms', async () => {
    loadSheet.mockResolvedValue(sheetResult());
    host({ canCurate: true });
    await openHighlightSheet();
    const switchNamed = (name: string) =>
      within(screen.getByRole('dialog', { name: 'Destacar story' })).getByRole('switch', { name });

    // archived → the switch reverts and the archived toast fires.
    addToHighlight.mockResolvedValueOnce({ ok: false, code: 'archived' });
    await act(async () => {
      fireEvent.click(switchNamed('Destacar em Ensaios, Coral Rede Social'));
    });
    expect(addToHighlight).toHaveBeenCalledWith(STORY_ID, H3, {
      communityId: COMMUNITY,
      revalidate: false,
    });
    expect(switchNamed('Destacar em Ensaios, Coral Rede Social').getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'error',
      message: lookup('highlights.errors.archived'),
    });

    // full → reverts, and the toast names the limit from the contracts (100), never a typed number.
    addToHighlight.mockResolvedValueOnce({ ok: false, code: 'full' });
    await act(async () => {
      fireEvent.click(switchNamed('Destacar em Aulas, Início'));
    });
    expect(switchNamed('Destacar em Aulas, Início').getAttribute('aria-checked')).toBe('false');
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'error',
      message: lookup('highlights.errors.full', { limit: 100 }),
    });

    // success → stays on, "Story adicionado ao destaque."
    addToHighlight.mockResolvedValueOnce({ ok: true, highlightCount: 2 });
    await act(async () => {
      fireEvent.click(switchNamed('Destacar em Aulas, Início'));
    });
    expect(addToHighlight).toHaveBeenLastCalledWith(STORY_ID, H2, {
      communityId: null,
      revalidate: false,
    });
    expect(switchNamed('Destacar em Aulas, Início').getAttribute('aria-checked')).toBe('true');
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'success',
      message: 'Story adicionado ao destaque.',
    });

    // removal → "Story removido do destaque."; a generic failure elsewhere keeps its generic copy.
    removeFromHighlight.mockResolvedValueOnce({ ok: true, highlightCount: 1 });
    await act(async () => {
      fireEvent.click(switchNamed('Destacar em Bastidores, Início'));
    });
    expect(removeFromHighlight).toHaveBeenCalledWith(STORY_ID, H1, {
      communityId: null,
      revalidate: false,
    });
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'success',
      message: 'Story removido do destaque.',
    });

    removeFromHighlight.mockResolvedValueOnce({ ok: false, code: 'generic' });
    await act(async () => {
      fireEvent.click(switchNamed('Destacar em Aulas, Início'));
    });
    expect(switchNamed('Destacar em Aulas, Início').getAttribute('aria-checked')).toBe('true');
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'error',
      message: lookup('highlights.errors.generic'),
    });
  });

  it('25. the comment sheet still works beside it: opening comments pauses on its own', async () => {
    loadSheet.mockResolvedValue(sheetResult());
    host({ canCurate: true, comments: commentsBinding() });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));
    });
    expect(screen.getByRole('dialog', { name: 'Comentários' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Story' }).getAttribute('data-paused')).toBe('true');
  });

  it('26. with no highlight anywhere, "Criar destaque" goes to the manage screen of the PLACE the viewer was opened from', async () => {
    const empty = { ...sheetResult(), selectedIds: [], places: [] };
    const cta = () =>
      within(screen.getByRole('dialog', { name: 'Destacar story' })).getByRole('link', {
        name: lookup('highlights.sheet.emptyCta'),
      });

    // Opened from a community page: that community's manage screen.
    loadSheet.mockResolvedValue(empty);
    host({ canCurate: true, originCommunityId: COMMUNITY });
    await openHighlightSheet();
    expect(cta().getAttribute('href')).toBe(`/comunidades/${COMMUNITY}/destaques`);
    cleanup();

    // Opened from Início or a deep link: the Início manage screen.
    host({ canCurate: true });
    await openHighlightSheet();
    expect(cta().getAttribute('href')).toBe('/stories/destaques');
  });
});

/* ── #2b (2026-10-03): the author's face in the viewer header ──────────────────────────────────── */

/**
 * The tenant circle now wears the face of the newest story's author, so the viewer it opens heads
 * each TENANT story with that story's author photo — the circle and the screen agree (UI-D-60's own
 * rationale) — while the NAME stays the tenant's (D-104). A highlight keeps its cover and title
 * (UI-D-65), whoever published the story inside it, and a photo that cannot be fetched gives way to
 * the group's own disc instead of a broken image.
 */
describe('StoryViewerHost — the author’s photo heads a tenant story (#2b)', () => {
  const FACE = '/v1/media/0000000f-1111-4111-8111-111111111111/w128';

  /**
   * happy-dom reports every `<img>` as `complete` with a zero `naturalWidth` — a failed fetch — so
   * the photo would give way on mount. The cases that need the photo itself force a decoded image,
   * and happy-dom's own accessors are restored afterwards.
   */
  function decodedImages(): () => void {
    const saved = ['complete', 'naturalWidth'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, key)] as const,
    );
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 128,
    });
    return () => {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(HTMLImageElement.prototype, key, descriptor);
        else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[key];
      }
    };
  }

  function tenantHost(items: ReturnType<typeof item>[]) {
    return render(
      <StoryViewerHost
        groups={[
          {
            key: 'tenant',
            kind: 'tenant',
            highlightId: null,
            name: 'Direcao Rede Demo',
            avatar: { kind: 'avatar', src: '/logo.png' },
            items,
          },
        ]}
        labels={LABELS}
        onLike={like as never}
        onUnlike={unlike as never}
        onClose={() => {}}
      />,
    );
  }

  it('27. a tenant story is headed by its AUTHOR’s photo, with the tenant’s name beside it', () => {
    const restore = decodedImages();
    try {
      tenantHost([item({ authorAvatarUrl: FACE })]);
      const dialog = screen.getByRole('dialog', { name: 'Story' });
      const photo = within(dialog).getByTestId('story-photo');
      expect(photo.querySelector('img')?.getAttribute('src')).toBe(FACE);
      expect(photo.querySelector('img')?.getAttribute('alt')).toBe('');
      // The header slot's 32px geometry, the shipped Avatar's own size.
      expect(photo.className).toContain('h-8');
      expect(photo.className).toContain('w-8');
      // The name is the GROUP's — the tenant speaks (D-104) — and the logo is not drawn beside it.
      expect(within(dialog).getByText('Direcao Rede Demo')).toBeTruthy();
      expect(dialog.querySelector('img[src="/logo.png"]')).toBeNull();
    } finally {
      restore();
    }
  });

  it('28. a photo that cannot be fetched gives way to the group’s own disc — the tenant logo — never a broken image', () => {
    const restore = decodedImages();
    try {
      tenantHost([item({ authorAvatarUrl: FACE })]);
      const dialog = screen.getByRole('dialog', { name: 'Story' });
      act(() => {
        fireEvent.error(dialog.querySelector(`img[src="${FACE}"]`) as HTMLImageElement);
      });
      expect(dialog.querySelector(`img[src="${FACE}"]`)).toBeNull();
      expect(dialog.querySelector('img[src="/logo.png"]')).not.toBeNull();
      expect(within(dialog).getByText('Direcao Rede Demo')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('29. a story whose author has NO photo keeps the group’s disc, exactly as before #2b', () => {
    const restore = decodedImages();
    try {
      tenantHost([item({ authorAvatarUrl: null })]);
      const dialog = screen.getByRole('dialog', { name: 'Story' });
      expect(within(dialog).queryByTestId('story-photo')).toBeNull();
      expect(dialog.querySelector('img[src="/logo.png"]')).not.toBeNull();
    } finally {
      restore();
    }
  });

  it('30. a HIGHLIGHT keeps its own cover and title in the header, whoever published the story inside it', () => {
    const restore = decodedImages();
    try {
      render(
        <StoryViewerHost
          groups={[
            {
              ...highlightGroupView(summary(H1, 'Bastidores')),
              items: [item({ authorAvatarUrl: FACE })],
            },
          ]}
          labels={LABELS}
          onLike={like as never}
          onUnlike={unlike as never}
          onClose={() => {}}
        />,
      );
      const dialog = screen.getByRole('dialog', { name: 'Story' });
      expect(dialog.querySelector(`img[src="${FACE}"]`)).toBeNull();
      expect(within(dialog).queryByTestId('story-photo')).toBeNull();
      // No resolvable cover: the title's monogram (UI-D-62) heads it, beside the title.
      expect(within(dialog).getByTestId('story-monogram').textContent).toBe('B');
      expect(within(dialog).getByText('Bastidores')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('31. each story wears ITS OWN author’s photo — a second publisher is never shown the first one’s face', () => {
    const restore = decodedImages();
    try {
      const SECOND = '/v1/media/0000000f-2222-4222-8222-222222222222/w128';
      tenantHost([
        item({ authorAvatarUrl: FACE }),
        item({ id: '0d000000-0000-4000-8000-0000000000d2', authorAvatarUrl: SECOND }),
      ]);
      const dialog = screen.getByRole('dialog', { name: 'Story' });
      expect(dialog.querySelector(`img[src="${FACE}"]`)).not.toBeNull();

      // ArrowRight is the tap-right semantics (UI-D-65): the next story of the group.
      fireEvent.keyDown(dialog, { key: 'ArrowRight' });
      expect(dialog.getAttribute('data-story-index')).toBe('1');
      expect(dialog.querySelector(`img[src="${SECOND}"]`)).not.toBeNull();
      expect(dialog.querySelector(`img[src="${FACE}"]`)).toBeNull();
    } finally {
      restore();
    }
  });
});
