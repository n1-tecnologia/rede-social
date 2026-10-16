// @vitest-environment happy-dom

import type { FeedListProps, FeedPageOutcome, PostCardView } from '@rede-social/module-feed/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReelView } from '@/lib/reels';
import type { ReelsOverlayBinding, ReelsOverlayProps } from '../reels/ReelsOverlay';
import type { FeedSurfaceProps } from './FeedSurface';

/**
 * 2026-10-09 — one tap on a feed video opens Reels OVER the list at that video, and the return arrow
 * closes it onto the same post (`FeedSurface` + `useReelsOverlay`).
 *
 * The claims:
 *  - each post remembers the cursor of the feed page that brought it (the first page has none), and
 *    opening reads the Reels page from THAT cursor, in this list's lane (the community's, or Todos);
 *  - a page that does not hold the post (or does not answer) falls back to `loadReelStartAction`;
 *    neither answering is the stage error, whose retry reads again;
 *  - the overlay is a shallow history entry on the SAME pathname: back (the arrow, Escape, the
 *    system) pops it, `popstate` closes it, the feed's videos get their turn back and the focus
 *    returns to the tapped video; a `?reel=` on arrival is dropped in place;
 *  - what the member did in Reels comes back as overrides with a fresh revision, and a refresh drops
 *    them.
 *
 * `FeedList` and `ReelsOverlay` are stand-ins that record the props they get (the list draws each
 * card's post id and a focusable frame, as `PostCard` and `FeedVideo` do); the actions, the video
 * store, the router and the toast are stubbed.
 */

const { lists, overlays, loadPage, loadStart, suspend, release, toast, refresh } = vi.hoisted(
  () => {
    const releaseFn = vi.fn();
    return {
      lists: [] as FeedListProps[],
      overlays: [] as ReelsOverlayProps[],
      loadPage: vi.fn(),
      loadStart: vi.fn(),
      release: releaseFn,
      suspend: vi.fn(() => releaseFn),
      toast: { show: vi.fn(), dismiss: vi.fn() },
      refresh: vi.fn(),
    };
  },
);

vi.mock('@rede-social/module-feed/ui', async (orig) => {
  const actual = await orig<typeof import('@rede-social/module-feed/ui')>();
  return {
    ...actual,
    FeedList: (props: FeedListProps) => {
      lists.push(props);
      return (
        <section>
          {props.initialItems.map((item) => (
            <div key={item.id} data-post-id={item.id}>
              <div data-feed-video="" tabIndex={-1} data-testid={`frame-${item.id}`} />
            </div>
          ))}
        </section>
      );
    },
  };
});

vi.mock('@/components/reels/ReelsOverlay', () => ({
  ReelsOverlay: (props: ReelsOverlayProps) => {
    overlays.push(props);
    return (
      <div role="dialog" aria-label="overlay" data-start={props.start.status}>
        <button type="button" onClick={props.onBack}>
          back
        </button>
      </div>
    );
  },
}));

vi.mock('@/components/reels/ReelsHost', () => ({ REELS_ALL_LANE: 'all' }));

vi.mock('@/app/(app)/reels/reels-actions', () => ({
  loadReelsPageAction: loadPage,
  loadReelStartAction: loadStart,
}));

vi.mock('@/components/media/FeedVideo', () => ({ suspendFeedVideos: suspend }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { FeedSurface } = await import('./FeedSurface');

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function post(n: number): PostCardView {
  return { id: id(n) } as PostCardView;
}

function reel(n: number): ReelView {
  return { id: id(n) } as ReelView;
}

const REELS = { labels: { region: 'region' }, backLabel: 'back' } as ReelsOverlayBinding;

function surface(overrides: Partial<FeedSurfaceProps> = {}) {
  const props = {
    initialItems: [post(1), post(2)],
    initialCursor: 'cursor-2',
    canPost: false,
    captionTruncateAt: 200,
    locale: 'pt-BR',
    labels: {} as FeedSurfaceProps['labels'],
    onLoadMore: vi.fn(async (): Promise<FeedPageOutcome> => ({ ok: false })),
    onRefresh: vi.fn(async (): Promise<FeedPageOutcome> => ({ ok: false })),
    onLike: vi.fn(),
    onUnlike: vi.fn(),
    share: { title: 'tenant', copied: 'copied', error: 'error' },
    reels: REELS,
    ...overrides,
  } satisfies FeedSurfaceProps;
  const result = render(<FeedSurface {...props} />);
  return { props, ...result };
}

const list = () => {
  const last = lists.at(-1);
  if (!last) throw new Error('the list never rendered');
  return last;
};
const overlay = () => overlays.at(-1);

async function flush(times = 4) {
  for (let tick = 0; tick < times; tick += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function open(postId: string) {
  await act(async () => {
    list().onOpenVideo?.(postId);
  });
  await flush();
}

beforeEach(() => {
  lists.length = 0;
  overlays.length = 0;
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/inicio');
  // A shallow entry is popped by `back()`; happy-dom fires no `popstate` for it, so the stub does.
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.history.replaceState(null, '', '/inicio');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  loadPage.mockResolvedValue({ ok: true, items: [], nextCursor: null });
  loadStart.mockResolvedValue({ ok: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FeedSurface — opening Reels at the tapped video (2026-10-09)', () => {
  it('without Reels the list gets no open, and one tap keeps pausing', () => {
    surface({ reels: null });
    expect(list().onOpenVideo).toBeUndefined();
  });

  it('a first-page post: the Reels page from no cursor, in Todos, at its place in it', async () => {
    loadPage.mockResolvedValue({ ok: true, items: [reel(5), reel(1), reel(6)], nextCursor: 'n' });
    surface();

    await open(id(1));

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(loadPage).toHaveBeenCalledWith(null, null);
    expect(loadStart).not.toHaveBeenCalled();
    expect(overlay()?.lane).toBe('all');
    expect(overlay()?.start).toEqual({
      status: 'ready',
      items: [reel(5), reel(1), reel(6)],
      nextCursor: 'n',
      index: 1,
    });
  });

  it('opens at once on its loading state, on the SAME pathname, and suspends the feed’s videos', async () => {
    let answer: (value: unknown) => void = () => {};
    loadPage.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    surface();

    await act(async () => {
      list().onOpenVideo?.(id(2));
    });

    expect(screen.getByRole('dialog', { name: 'overlay' }).dataset.start).toBe('loading');
    expect(window.location.pathname).toBe('/inicio');
    expect(new URL(window.location.href).searchParams.get('reel')).toBe(id(2));
    expect(suspend).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer({ ok: true, items: [reel(2)], nextCursor: null });
    });
    await flush();
    expect(screen.getByRole('dialog', { name: 'overlay' }).dataset.start).toBe('ready');
  });

  it('a post a later page brought: THAT page’s cursor, in the community’s lane', async () => {
    const onLoadMore = vi.fn(
      async (): Promise<FeedPageOutcome> => ({
        ok: true,
        items: [post(11), post(12)],
        nextCursor: 'cursor-3',
      }),
    );
    loadPage.mockResolvedValue({ ok: true, items: [reel(12)], nextCursor: null });
    surface({ communityId: 'community-1', onLoadMore });

    await act(async () => {
      await list().onLoadMore('cursor-2');
    });
    expect(onLoadMore).toHaveBeenCalledWith('cursor-2');

    await open(id(12));
    expect(loadPage).toHaveBeenCalledWith('community-1', 'cursor-2');
    expect(overlay()?.lane).toBe('community-1');
    expect(overlay()?.start).toMatchObject({ status: 'ready', index: 0 });
  });

  it('a page that does not hold the post falls back: that video first, then its lane', async () => {
    loadPage.mockResolvedValue({ ok: true, items: [reel(7)], nextCursor: null });
    loadStart.mockResolvedValue({ ok: true, items: [reel(1), reel(7)], nextCursor: 'm' });
    surface({ communityId: 'community-1' });

    await open(id(1));

    expect(loadStart).toHaveBeenCalledWith(id(1), 'community-1');
    expect(overlay()?.start).toEqual({
      status: 'ready',
      items: [reel(1), reel(7)],
      nextCursor: 'm',
      index: 0,
    });
  });

  it('nothing answering is the stage error, and its retry reads again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    loadPage.mockRejectedValue(new Error('network'));
    surface();

    await open(id(1));
    expect(loadStart).toHaveBeenCalledTimes(1);
    expect(overlay()?.start).toEqual({ status: 'error' });

    loadPage.mockResolvedValue({ ok: true, items: [reel(1)], nextCursor: null });
    await act(async () => {
      overlay()?.onRetry();
    });
    await flush();
    expect(overlay()?.start).toMatchObject({ status: 'ready', index: 0 });
  });
});

describe('FeedSurface — coming back to the same post (2026-10-09)', () => {
  it('the arrow pops the entry; popstate closes, gives the videos back and focuses the tapped video', async () => {
    loadPage.mockResolvedValue({ ok: true, items: [reel(2)], nextCursor: null });
    surface();
    await open(id(2));

    fireEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(window.history.back).toHaveBeenCalledTimes(1);
    await flush();

    expect(screen.queryByRole('dialog', { name: 'overlay' })).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByTestId(`frame-${id(2)}`));
    expect(window.location.search).toBe('');
  });

  it('a start that lands after the overlay closed is dropped', async () => {
    let answer: (value: unknown) => void = () => {};
    loadPage.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    surface();
    await act(async () => {
      list().onOpenVideo?.(id(1));
    });
    await act(async () => {
      window.history.back();
    });
    await act(async () => {
      answer({ ok: true, items: [reel(1)], nextCursor: null });
    });
    await flush();
    expect(screen.queryByRole('dialog', { name: 'overlay' })).toBeNull();
  });

  it('a popstate that is not the overlay’s changes nothing', async () => {
    surface();
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(release).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'overlay' })).toBeNull();
  });

  it('a ?reel= in the address on arrival is dropped in place, and no overlay opens', () => {
    window.history.replaceState(null, '', `/inicio?a=1&reel=${id(1)}`);
    const length = window.history.length;
    surface();
    expect(window.location.pathname).toBe('/inicio');
    expect(window.location.search).toBe('?a=1');
    expect(window.history.length).toBe(length);
    expect(screen.queryByRole('dialog', { name: 'overlay' })).toBeNull();
  });

  /**
   * Review of 2026-10-09: a reload, or a back/forward load, that lands on the overlay's own entry
   * reopens it there instead of dropping the param, which left two entries of one page behind
   * (the page's "Voltar" then reloaded the same page).
   */
  for (const type of ['reload', 'back_forward'] as const) {
    it(`a ?reel= reached by a ${type} load reopens the overlay on that entry, and the arrow pops it`, async () => {
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
        { type },
      ] as unknown as PerformanceEntryList);
      loadPage.mockResolvedValue({ ok: true, items: [reel(1)], nextCursor: null });
      window.history.replaceState(null, '', `/inicio?reel=${id(1)}`);
      const length = window.history.length;

      surface();
      await flush();

      expect(screen.getByRole('dialog', { name: 'overlay' }).dataset.start).toBe('ready');
      expect(new URL(window.location.href).searchParams.get('reel')).toBe(id(1));
      expect(window.history.length).toBe(length);
      expect(suspend).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'back' }));
      expect(window.history.back).toHaveBeenCalledTimes(1);
      await flush();
      expect(screen.queryByRole('dialog', { name: 'overlay' })).toBeNull();
    });
  }

  it('POSITIVE CONTROL: the same reload without Reels only drops the param', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { type: 'reload' },
    ] as unknown as PerformanceEntryList);
    window.history.replaceState(null, '', `/inicio?reel=${id(1)}`);
    surface({ reels: null });
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('dialog', { name: 'overlay' })).toBeNull();
  });
});

describe('FeedSurface — what was done in Reels shows on the cards (2026-10-09)', () => {
  it('each report is an override with a fresh revision; a refresh drops them', async () => {
    const onRefresh = vi.fn(
      async (): Promise<FeedPageOutcome> => ({ ok: true, items: [post(1)], nextCursor: null }),
    );
    loadPage.mockResolvedValue({ ok: true, items: [reel(1)], nextCursor: null });
    surface({ onRefresh });
    await open(id(1));

    await act(async () => {
      overlay()?.onInteraction?.(id(1), { viewerLiked: true, likeCount: 5, commentCount: 2 });
    });
    expect(list().itemOverrides).toEqual({
      [id(1)]: { viewerLiked: true, likeCount: 5, commentCount: 2, revision: 1 },
    });
    await act(async () => {
      overlay()?.onInteraction?.(id(1), { viewerLiked: true, likeCount: 5, commentCount: 3 });
    });
    expect(list().itemOverrides?.[id(1)]).toMatchObject({ commentCount: 3, revision: 2 });

    await act(async () => {
      await list().onRefresh();
    });
    expect(list().itemOverrides).toEqual({});
  });

  it('a new first page from the server drops them too', async () => {
    loadPage.mockResolvedValue({ ok: true, items: [reel(1)], nextCursor: null });
    const { props, rerender } = surface();
    await open(id(1));
    await act(async () => {
      overlay()?.onInteraction?.(id(1), { viewerLiked: true, likeCount: 5, commentCount: 2 });
    });
    expect(list().itemOverrides?.[id(1)]).toBeDefined();

    rerender(<FeedSurface {...props} initialItems={[post(1), post(3)]} />);
    expect(list().itemOverrides).toEqual({});
  });
});
